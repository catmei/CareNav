"""Map and hospital data utilities (Overpass / OpenStreetMap)."""

import math
import httpx

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
