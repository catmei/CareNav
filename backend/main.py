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
from pydantic import BaseModel

from backend.map_utils import fetch_google_hospitals, normalize_hospital
from backend.firecrawl_utils import firecrawl_search_l1, firecrawl_search_l2

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
    """Return the 5 nearest hospitals from Google Places (no Firecrawl).

    Firecrawl searches are deferred to Layer 1/Layer 2 after triage.
    """
    cache_path = Path(__file__).resolve().parent / "cached_hospitals.json"

    # If cache exists, skip API calls entirely
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))

    async with httpx.AsyncClient() as client:
        places = await fetch_google_hospitals(client, lat, lng)
        hospitals = [h for p in places if (h := normalize_hospital(p, lat, lng))]
        hospitals.sort(key=lambda x: x["distance_miles"])
        top5 = hospitals[:5]

    result = {"hospitals": top5}

    # Save for future runs
    cache_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    return result


class L1SearchRequest(BaseModel):
    triage_data: dict


@app.post("/api/hospitals/search-l1")
async def search_hospitals_l1(request: L1SearchRequest):
    """Layer 1: triage-informed Firecrawl search for each cached hospital."""
    cache_path = Path(__file__).resolve().parent / "cached_hospitals.json"
    if not cache_path.exists():
        raise HTTPException(status_code=400, detail="No cached hospitals. Call /api/hospitals/enriched first.")

    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    hospitals = cached.get("hospitals", [])

    async with httpx.AsyncClient() as client:
        search_results = await firecrawl_search_l1(client, hospitals, request.triage_data)

    return {"search_results": search_results}


class L2SearchRequest(BaseModel):
    query: str


@app.post("/api/hospitals/search-l2")
async def search_hospitals_l2(request: L2SearchRequest):
    """Layer 2: agent-driven refined Firecrawl search."""
    async with httpx.AsyncClient() as client:
        search_results = await firecrawl_search_l2(client, request.query)

    return {"search_results": search_results}


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
