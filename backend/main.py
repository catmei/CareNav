"""FastAPI backend for Emergency Hospital Finder."""

import math
import httpx
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Emergency Hospital Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SEARCH_RADIUS_METERS = 10000  # 10 km


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance in miles between two coordinates."""
    R = 3959  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_overpass_hospitals(lat: float, lng: float, radius: int = SEARCH_RADIUS_METERS) -> list:
    """Query Overpass API for nearby hospitals."""
    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:{radius},{lat},{lng});
      way["amenity"="hospital"](around:{radius},{lat},{lng});
      relation["amenity"="hospital"](around:{radius},{lat},{lng});
    );
    out center;
    """
    try:
        resp = httpx.post(OVERPASS_URL, data={"data": query}, timeout=30)
        resp.raise_for_status()
        return resp.json().get("elements", [])
    except Exception:
        return []


def normalize_hospital(element: dict, user_lat: float, user_lng: float) -> dict | None:
    """Convert an Overpass element into our hospital schema."""
    tags = element.get("tags", {})

    # Nodes have lat/lon directly; ways/relations have it under "center"
    lat = element.get("lat") or element.get("center", {}).get("lat")
    lng = element.get("lon") or element.get("center", {}).get("lon")
    if not lat or not lng:
        return None

    name = tags.get("name", "").strip()
    if not name:
        return None

    # Build address from OSM addr:* tags
    housenumber = tags.get("addr:housenumber", "").strip()
    street = tags.get("addr:street", "").strip()
    city = tags.get("addr:city", "").strip()
    state_tag = tags.get("addr:state", "").strip()
    addr_parts = [f"{housenumber} {street}".strip(), city, state_tag]
    address = ", ".join(p for p in addr_parts if p) or "Address not available"

    phone = (
        tags.get("phone", tags.get("contact:phone", tags.get("telephone", ""))).strip()
    )
    website = tags.get("website", tags.get("contact:website", "")).strip()
    hours = tags.get("opening_hours", "").strip() or "Call ahead"

    # healthcare:speciality is a semicolon-separated OSM tag
    spec_raw = tags.get("healthcare:speciality", "").strip()
    specialties = (
        [s.strip().title() for s in spec_raw.split(";") if s.strip()]
        if spec_raw
        else ["Emergency Medicine"]
    )

    dist = haversine_distance(user_lat, user_lng, lat, lng)

    return {
        "id": str(element["id"]),
        "name": name,
        "address": address,
        "phone": phone or "N/A",
        "lat": lat,
        "lng": lng,
        "distance_miles": round(dist, 1),
        "rating": None,           # not available from OSM
        "specialties": specialties,
        "er_wait_minutes": None,  # not available from OSM
        "insurance_accepted": [],
        "hours": hours,
        "website": website,
    }


@app.get("/api/hospitals")
def get_nearby_hospitals(
    lat: float = Query(..., description="User latitude"),
    lng: float = Query(..., description="User longitude"),
):
    """Return top 5 nearest hospitals via Overpass/OpenStreetMap."""
    elements = fetch_overpass_hospitals(lat, lng)
    hospitals = [h for el in elements if (h := normalize_hospital(el, lat, lng))]
    hospitals.sort(key=lambda x: x["distance_miles"])
    return {"hospitals": hospitals[:5]}


@app.get("/api/hospital/{hospital_id}")
def get_hospital_detail(hospital_id: str):
    """Fetch a single hospital by its OSM node/way ID."""
    query = f"""
    [out:json][timeout:10];
    (
      node({hospital_id});
      way({hospital_id});
      relation({hospital_id});
    );
    out center;
    """
    try:
        resp = httpx.post(OVERPASS_URL, data={"data": query}, timeout=15)
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
        if not elements:
            raise HTTPException(status_code=404, detail="Hospital not found")
        # Use dummy user coords — distance will be 0 since we have no user context here
        h = normalize_hospital(elements[0], 0, 0)
        if not h:
            raise HTTPException(status_code=404, detail="Hospital not found")
        return h
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Overpass API error")


@app.get("/api/recommend")
def recommend_hospitals(
    lat: float = Query(...),
    lng: float = Query(...),
    symptoms: str = Query("", description="Comma-separated symptoms"),
    insurance: str = Query("", description="Insurance provider"),
):
    """Return top 2 best-fit hospitals from real Overpass data."""
    elements = fetch_overpass_hospitals(lat, lng)
    hospitals = [h for el in elements if (h := normalize_hospital(el, lat, lng))]

    symptom_list = [s.strip().lower() for s in symptoms.split(",") if s.strip()]
    scored = []

    for h in hospitals:
        dist = h["distance_miles"]
        score = 100

        # Closer is better (up to 30 points)
        score -= min(dist * 6, 30)

        # Specialty match (15 points each)
        specialties_lower = [s.lower() for s in h["specialties"]]
        for symptom in symptom_list:
            for spec in specialties_lower:
                if symptom in spec or spec in symptom:
                    score += 15

        reasons = []
        if dist < 2:
            reasons.append(f"Only {dist} miles away")
        for symptom in symptom_list:
            for spec in h["specialties"]:
                if symptom in spec.lower():
                    reasons.append(f"Specializes in {spec}")
        if not reasons:
            reasons.append("Well-equipped emergency department")

        scored.append({**h, "score": round(score, 1), "reasons": reasons})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return {"recommendations": scored[:2]}


# Serve frontend static files — must be last so API routes take priority
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
