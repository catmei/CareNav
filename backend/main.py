"""FastAPI backend for Emergency Hospital Finder."""

import os
import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from elevenlabs import ElevenLabs

from backend.map_utils import fetch_overpass_hospitals, normalize_hospital
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

    return {"hospitals": enriched}


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
