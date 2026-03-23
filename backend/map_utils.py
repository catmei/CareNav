"""Hospital data utilities using Google Places API (New)."""

import os
import math
import httpx

PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
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


async def fetch_google_hospitals(
    client: httpx.AsyncClient, lat: float, lng: float, radius: int = SEARCH_RADIUS_METERS
) -> list:
    """Query Google Places Nearby Search for hospitals."""
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        return []

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.id,"
            "places.displayName,"
            "places.formattedAddress,"
            "places.nationalPhoneNumber,"
            "places.internationalPhoneNumber,"
            "places.rating,"
            "places.userRatingCount,"
            "places.websiteUri,"
            "places.regularOpeningHours,"
            "places.googleMapsUri,"
            "places.location,"
            "places.types"
        ),
    }

    body = {
        "includedTypes": ["hospital"],
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius),
            }
        },
        "maxResultCount": 20,
    }

    try:
        resp = await client.post(PLACES_NEARBY_URL, json=body, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json().get("places", [])
    except Exception:
        return []


def normalize_hospital(place: dict, user_lat: float, user_lng: float) -> dict | None:
    """Convert a Google Places result into our hospital schema."""
    display_name = place.get("displayName", {})
    name = display_name.get("text", "").strip() if isinstance(display_name, dict) else str(display_name).strip()
    if not name:
        return None

    location = place.get("location", {})
    lat = location.get("latitude")
    lng = location.get("longitude")
    if not lat or not lng:
        return None

    address = place.get("formattedAddress", "Address not available")

    phone = (
        place.get("nationalPhoneNumber", "")
        or place.get("internationalPhoneNumber", "")
    )

    website = place.get("websiteUri", "")

    # Parse opening hours
    reg_hours = place.get("regularOpeningHours", {})
    weekday_descriptions = reg_hours.get("weekdayDescriptions", [])
    hours = "; ".join(weekday_descriptions) if weekday_descriptions else "Call ahead"

    rating = place.get("rating")
    user_ratings_total = place.get("userRatingCount")

    google_maps_url = place.get("googleMapsUri", "")

    dist = haversine_distance(user_lat, user_lng, lat, lng)

    return {
        "id": place.get("id", ""),
        "name": name,
        "address": address,
        "phone": phone or "N/A",
        "lat": lat,
        "lng": lng,
        "distance_miles": round(dist, 1),
        "rating": rating,
        "user_ratings_total": user_ratings_total,
        "er_wait_minutes": None,  # not available from Google
        "insurance_accepted": [],
        "hours": hours,
        "website": website,
        "google_maps_url": google_maps_url,
    }
