"""FastAPI backend for Emergency Hospital Finder."""

import math
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .mock_data import MOCK_HOSPITALS

app = FastAPI(title="Emergency Hospital Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/hospitals")
def get_nearby_hospitals(
    lat: float = Query(..., description="User latitude"),
    lng: float = Query(..., description="User longitude"),
):
    """Return top 5 nearest hospitals with mock data (replaces Google Places API + Firecrawl)."""
    hospitals = []
    for h in MOCK_HOSPITALS:
        dist = haversine_distance(lat, lng, h["lat"], h["lng"])
        hospitals.append({**h, "distance_miles": round(dist, 1)})

    hospitals.sort(key=lambda x: x["distance_miles"])
    return {"hospitals": hospitals[:5]}


@app.get("/api/hospital/{hospital_id}")
def get_hospital_detail(hospital_id: str):
    """Return full detail for a single hospital (replaces Firecrawl Search)."""
    for h in MOCK_HOSPITALS:
        if h["id"] == hospital_id:
            return h
    return {"error": "Hospital not found"}


@app.get("/api/recommend")
def recommend_hospitals(
    lat: float = Query(...),
    lng: float = Query(...),
    symptoms: str = Query("", description="Comma-separated symptoms"),
    insurance: str = Query("", description="Insurance provider"),
):
    """Mock recommendation engine — returns top 2 best-fit hospitals."""
    scored = []
    symptom_list = [s.strip().lower() for s in symptoms.split(",") if s.strip()]
    insurance_lower = insurance.strip().lower()

    for h in MOCK_HOSPITALS:
        dist = haversine_distance(lat, lng, h["lat"], h["lng"])
        score = 100

        # Closer is better (up to 30 points)
        score -= min(dist * 6, 30)

        # Higher rating is better (up to 20 points)
        score += h["rating"] * 4

        # Specialty match (up to 30 points)
        specialties_lower = [s.lower() for s in h["specialties"]]
        for symptom in symptom_list:
            for spec in specialties_lower:
                if symptom in spec or spec in symptom:
                    score += 15

        # Insurance match (10 points)
        if insurance_lower:
            accepted_lower = [i.lower() for i in h["insurance_accepted"]]
            if any(insurance_lower in acc for acc in accepted_lower):
                score += 10

        # Shorter wait is better (up to 10 points)
        score -= h["er_wait_minutes"] * 0.25

        reasons = []
        if dist < 2:
            reasons.append(f"Only {round(dist, 1)} miles away")
        if h["rating"] >= 4.5:
            reasons.append(f"Highly rated ({h['rating']} stars)")
        for symptom in symptom_list:
            for spec in h["specialties"]:
                if symptom in spec.lower():
                    reasons.append(f"Specializes in {spec}")
        if insurance_lower:
            accepted_lower = [i.lower() for i in h["insurance_accepted"]]
            if any(insurance_lower in acc for acc in accepted_lower):
                reasons.append(f"Accepts {insurance}")
        if h["er_wait_minutes"] <= 20:
            reasons.append(f"Short ER wait (~{h['er_wait_minutes']} min)")

        if not reasons:
            reasons.append("Well-equipped emergency department")

        scored.append({
            **h,
            "distance_miles": round(dist, 1),
            "score": round(score, 1),
            "reasons": reasons,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return {"recommendations": scored[:2]}


# Serve frontend static files — must be last so API routes take priority
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
