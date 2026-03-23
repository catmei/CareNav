"""FastAPI backend for Emergency Hospital Finder."""

import os
import json
import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from elevenlabs import ElevenLabs

from backend.map_utils import fetch_google_hospitals, normalize_hospital
from backend.firecrawl_utils import firecrawl_search_hospital_details

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="Emergency Hospital Finder")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/hospitals/enriched")
async def get_enriched_hospitals(
    lat: float = Query(..., description="User latitude"),
    lng: float = Query(..., description="User longitude"),
):
    """Return the 5 nearest hospitals, each enriched with targeted web searches.

    Each hospital gains a ``web_details`` object with keys:
      specialties_services, insurance_accepted, patient_rating.
    Requires GOOGLE_MAPS_API_KEY and optionally FIRECRAWL_API_KEY.
    """
    cache_path = Path(__file__).resolve().parent / "cached_hospitals.json"

    # If cache exists, skip API calls entirely
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))

    async with httpx.AsyncClient() as client:
        # Fetch hospitals from Google Places API
        places = await fetch_google_hospitals(client, lat, lng)
        hospitals = [h for p in places if (h := normalize_hospital(p, lat, lng))]
        hospitals.sort(key=lambda x: x["distance_miles"])
        top5 = hospitals[:5]

        # Enrich with Firecrawl web search results
        fc_tasks = [firecrawl_search_hospital_details(client, h["name"]) for h in top5]
        web_details_per_hospital = await asyncio.gather(*fc_tasks)

    enriched = [
        {**hospital, "web_details": web_details}
        for hospital, web_details in zip(top5, web_details_per_hospital)
    ]

    result = {"hospitals": enriched}

    # Save for future runs
    cache_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    return result


@app.get("/api/maps-key")
def get_maps_key():
    """Return the Google Maps API key for the frontend."""
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_MAPS_API_KEY not configured")
    return {"key": api_key}


@app.get("/api/signed-url")
def get_signed_url():
    """Generate a signed URL for the ElevenLabs conversational AI session."""
    agent_id = os.getenv("ELEVENLABS_AGENT_ID", "")
    if not agent_id:
        raise HTTPException(status_code=500, detail="ELEVENLABS_AGENT_ID not configured")
    api_key = os.getenv("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")
    client = ElevenLabs(api_key=api_key)
    signed_url = client.conversational_ai.conversations.get_signed_url(
        agent_id=agent_id
    )
    return {"signedUrl": signed_url.signed_url}


# Serve frontend static files — must be last so API routes take priority
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
