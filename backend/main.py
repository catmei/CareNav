"""FastAPI backend for Emergency Hospital Finder."""

import asyncio
import httpx
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from backend.map_utils import fetch_overpass_hospitals, normalize_hospital, OVERPASS_URL
from backend.firecrawl_utils import firecrawl_search_hospital_details

app = FastAPI(title="Emergency Hospital Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/hospitals/enriched")
async def get_enriched_hospitals(
    lat: float = Query(..., description="User latitude"),
    lng: float = Query(..., description="User longitude"),
):
    """Return the 5 nearest hospitals, each enriched with 5 targeted web searches (25 total).

    Each hospital gains a ``web_details`` object with keys:
      official_website, contact_hours, specialties_services,
      insurance_accepted, patient_rating.
    Requires the FIRECRAWL_API_KEY environment variable.
    """
    elements = fetch_overpass_hospitals(lat, lng)
    hospitals = [h for el in elements if (h := normalize_hospital(el, lat, lng))]
    hospitals.sort(key=lambda x: x["distance_miles"])
    top5 = hospitals[:5]

    async with httpx.AsyncClient() as client:
        tasks = [firecrawl_search_hospital_details(client, h["name"]) for h in top5]
        web_details_per_hospital = await asyncio.gather(*tasks)

    enriched = [
        {**hospital, "web_details": web_details}
        for hospital, web_details in zip(top5, web_details_per_hospital)
    ]

    print(enriched)
    return {"hospitals": enriched}


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
