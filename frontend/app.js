import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@latest/+esm";

// === State ===
const state = {
  lat: null,
  lng: null,
  hospitals: [],
  sessionActive: false,
  conversation: null,
};

// === DOM refs ===
const $ = (sel) => document.querySelector(sel);
const locationStatus = $("#locationStatus");
const hospitalDetail = $("#hospitalDetail");
const liveCaption = $("#liveCaption");
const liveCaptionText = $("#liveCaptionText");
const voiceAgent = $("#voiceAgent");
const micButton = $("#micButton");
const voiceStatus = $("#voiceStatus");
const agentBadge = $("#agentBadge");
const addressModal = $("#addressModal");
const addressSubmit = $("#addressSubmit");
const retryLocation = $("#retryLocation");
const refreshBtn = $("#refreshBtn");
const locationChoiceModal = $("#locationChoiceModal");
const useGpsBtn = $("#useGpsBtn");
const enterAddressBtn = $("#enterAddressBtn");

// === Google Map ===
let map = null;
let userMarker = null;
let hospitalMarkers = [];
let mapsReady = false;

async function loadGoogleMaps() {
  if (mapsReady) return;
  try {
    const res = await fetch("/api/maps-key");
    if (!res.ok) throw new Error("Could not fetch maps key");
    const data = await res.json();
    const key = data.key;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY is empty");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async`;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    mapsReady = true;
  } catch (err) {
    console.error("Failed to load Google Maps:", err);
  }
}

function initMap(lat, lng) {
  if (!mapsReady) return;
  if (!map) {
    map = new google.maps.Map(document.getElementById("map"), {
      center: { lat, lng },
      zoom: 13,
      styles: [
        { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
        { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#0e1626" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
        { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#255763" }] },
        { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
      ],
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
  } else {
    map.setCenter({ lat, lng });
    map.setZoom(13);
  }
}

function showUserOnMap() {
  if (!mapsReady) return;
  initMap(state.lat, state.lng);
  if (userMarker) userMarker.setMap(null);
  userMarker = new google.maps.Marker({
    position: { lat: state.lat, lng: state.lng },
    map,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: "#3b82f6",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 3,
    },
    title: "Your Location",
    zIndex: 999,
  });
}

function plotHospitalsOnMap(hospitals) {
  if (!mapsReady || !map) return;
  hospitalMarkers.forEach((m) => m.setMap(null));
  hospitalMarkers = [];

  const bounds = new google.maps.LatLngBounds();
  bounds.extend({ lat: state.lat, lng: state.lng });

  hospitals.forEach((h, i) => {
    const marker = new google.maps.Marker({
      position: { lat: h.lat, lng: h.lng },
      map,
      label: {
        text: String(i + 1),
        color: "#ffffff",
        fontWeight: "bold",
        fontSize: "12px",
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: "#F5A623",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      title: h.name,
    });

    marker.addListener("click", () => {
      selectHospital(h.id);
    });

    hospitalMarkers.push(marker);
    bounds.extend({ lat: h.lat, lng: h.lng });
  });

  if (hospitals.length > 0) {
    map.fitBounds(bounds, { padding: 40 });
  }
}

// === Init ===
document.addEventListener("DOMContentLoaded", async () => {
  locationChoiceModal.style.display = "flex";
  setLocationStatus("detecting", "Waiting for location...");

  // Start loading Google Maps early
  await loadGoogleMaps();

  useGpsBtn.addEventListener("click", () => {
    locationChoiceModal.style.display = "none";
    detectLocation();
  });

  enterAddressBtn.addEventListener("click", () => {
    locationChoiceModal.style.display = "none";
    showAddressModal();
  });

  micButton.addEventListener("click", toggleVoiceSession);
  refreshBtn.addEventListener("click", () => { if (state.lat) fetchHospitals(); });
  addressSubmit.addEventListener("click", handleAddressSubmit);
  retryLocation.addEventListener("click", () => { addressModal.style.display = "none"; detectLocation(); });
});

// === Geolocation ===
function detectLocation() {
  setLocationStatus("detecting", "Detecting location...");
  if (!navigator.geolocation) {
    setLocationStatus("error", "Geolocation not supported");
    showAddressModal();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = pos.coords.latitude;
      state.lng = pos.coords.longitude;
      setLocationStatus("active", `${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}`);
      showUserOnMap();
      fetchHospitals();
    },
    () => {
      setLocationStatus("error", "Location denied");
      showAddressModal();
    },
    { timeout: 10000 }
  );
}

function setLocationStatus(type, text) {
  locationStatus.className = "location-status " + (type === "detecting" ? "" : type);
  locationStatus.querySelector(".status-text").textContent = text;
}

function showAddressModal() {
  const input = $("#addressInput");
  if (!input.value) input.value = "476 5th Ave, New York, NY 10018";
  addressModal.style.display = "flex";
}

async function handleAddressSubmit() {
  const address = $("#addressInput").value.trim();
  if (!address) return;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (data.length > 0) {
      state.lat = parseFloat(data[0].lat);
      state.lng = parseFloat(data[0].lon);
      setLocationStatus("active", address);
    } else {
      state.lat = 40.7128;
      state.lng = -74.0060;
      setLocationStatus("active", "New York, NY (default)");
    }
  } catch {
    state.lat = 41.8781;
    state.lng = -87.6298;
    setLocationStatus("active", "Chicago, IL (default)");
  }

  addressModal.style.display = "none";
  showUserOnMap();
  fetchHospitals();
}

// === Fetch Hospitals ===
async function fetchHospitals() {
  hospitalDetail.innerHTML = '<div class="empty-state"><p>Searching nearby hospitals...</p></div>';
  try {
    const res = await fetch(`/api/hospitals/enriched?lat=${state.lat}&lng=${state.lng}`);
    const data = await res.json();
    state.hospitals = data.hospitals;
    renderHospitals(data.hospitals);
    plotHospitalsOnMap(data.hospitals);

    // Enable voice agent now that hospitals are loaded
    voiceStatus.textContent = `${data.hospitals.length} hospitals found — click to start voice session`;
    micButton.style.opacity = "1";
    micButton.style.pointerEvents = "auto";
  } catch (err) {
    hospitalDetail.innerHTML = '<div class="empty-state"><p>Error loading hospitals. Please try again.</p></div>';
  }
}

function renderHospitals(hospitals) {
  if (!hospitals.length) {
    hospitalDetail.innerHTML = '<div class="empty-state"><p>No hospitals found nearby.</p></div>';
    return;
  }

  // Show the first hospital by default
  selectHospital(hospitals[0].id);
}

function selectHospital(id, recommendation) {
  const h = state.hospitals.find((h) => h.id === id);
  if (!h) return;

  // Highlight marker on map
  const idx = state.hospitals.findIndex((h) => h.id === id);
  if (idx >= 0) {
    hospitalMarkers.forEach((m, i) => {
      m.setIcon({
        path: google.maps.SymbolPath.CIRCLE,
        scale: i === idx ? 16 : 14,
        fillColor: i === idx ? "#EA4335" : "#F5A623",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: i === idx ? 3 : 2,
      });
    });
  }

  // Format hours: show "Open 24 hours" once if all days are the same, otherwise list per line
  let hoursDisplay = h.hours;
  if (h.hours && h.hours !== "Call ahead") {
    const parts = h.hours.split("; ");
    const allSame = parts.length === 7 && parts.every((p) => p.includes("Open 24 hours"));
    if (allSame) {
      hoursDisplay = "Open 24 hours";
    } else {
      hoursDisplay = parts.join("<br>");
    }
  }

  // Recommendation badge
  const recBadge = recommendation
    ? `<div class="rec-badge"><span class="rec-badge-icon">✓</span> Recommended — ${recommendation}</div>`
    : "";

  // Render detail panel
  hospitalDetail.innerHTML = `
    <div class="hospital-detail-card${recommendation ? " recommended" : ""}" id="card-${h.id}">
      ${recBadge}
      <div class="detail-header">
        <div>
          <div class="card-name">${h.name}</div>
          <div class="card-address">${h.address}</div>
        </div>
        ${h.rating !== null ? `<span class="card-rating">⭐ ${h.rating}${h.user_ratings_total ? ` (${h.user_ratings_total})` : ""}</span>` : ""}
      </div>

      <div class="detail-info-row">
        <span class="meta-tag distance">${h.distance_miles} mi</span>
        ${h.er_wait_minutes !== null ? `<span class="meta-tag wait">~${h.er_wait_minutes} min wait</span>` : ""}
        <span class="detail-hours">${hoursDisplay}</span>
      </div>

      <div class="detail-actions-row">
        ${h.phone !== "N/A" ? `<a href="tel:${h.phone}" class="btn btn-call btn-sm">📞 ${h.phone}</a>` : ""}
        ${h.website ? `<a href="${h.website}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🌐 Website</a>` : ""}
        <a href="${h.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}`}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🗺 Directions</a>
      </div>

      ${h.insurance_accepted.length ? `
      <div class="detail-section">
        <div class="detail-label">Insurance</div>
        <div class="detail-text">${h.insurance_accepted.join(", ")}</div>
      </div>` : ""}
      ${renderWebDetails(h.web_details)}
    </div>
  `;

  if (recommendation) {
    hospitalDetail.scrollIntoView({ behavior: "smooth" });
  }
}

// === Web Details renderer ===
const WEB_DETAIL_LABELS = {
  specialties_services: "Specialties & Services",
  insurance_accepted:   "Insurance Accepted",
  patient_rating:       "Patient Rating & Reviews",
};

function renderWebDetails(web_details) {
  if (!web_details) return "";
  const items = Object.entries(WEB_DETAIL_LABELS)
    .map(([key, label]) => {
      const results = web_details[key];
      if (!results || !results.length) return "";
      const links = results.map((r) => `
        <a class="web-detail-title" href="${r.url}" target="_blank" rel="noopener">${r.title}</a>
        ${r.description ? `<div class="web-detail-desc">${r.description}</div>` : ""}`
      ).join("");
      return `
        <div class="web-detail-item">
          <div class="web-detail-label">${label}</div>
          ${links}
        </div>`;
    })
    .join("");
  if (!items.trim()) return "";
  return `
    <div class="detail-section web-details-section">
      <div class="firecrawl-toggle" onclick="toggleFirecrawl(this)">
        <span class="firecrawl-label">🔥 Firecrawl</span>
        <span class="firecrawl-arrow">&#9654;</span>
      </div>
      <div class="web-details-list firecrawl-collapsed">${items}</div>
    </div>`;
}

function toggleFirecrawl(el) {
  const list = el.nextElementSibling;
  const arrow = el.querySelector(".firecrawl-arrow");
  list.classList.toggle("firecrawl-collapsed");
  arrow.classList.toggle("firecrawl-open");
}
window.toggleFirecrawl = toggleFirecrawl;

// Select hospital (used by tabs and map markers)
// (selectHospital is defined above in renderHospitalTabs section)

// === ElevenLabs Voice Session ===
async function toggleVoiceSession() {
  if (state.sessionActive) {
    await stopSession();
  } else {
    await startSession();
  }
}

async function startSession() {
  if (state.hospitals.length === 0) {
    showCaption( "Please wait for hospitals to load before starting a voice session.");
    return;
  }

  voiceStatus.textContent = "Connecting...";

  try {
    // Get signed URL from backend
    const res = await fetch("/api/signed-url");
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to get signed URL");
    }
    const { signedUrl } = await res.json();

    // Prepare hospital data for the agent prompt
    const hospitalsForAgent = state.hospitals.map((h) => ({
      name: h.name,
      address: h.address,
      phone: h.phone,
      distance_miles: h.distance_miles,
      hours: h.hours,
      insurance_accepted: h.insurance_accepted,
      rating: h.rating,
      website: h.website,
      web_details: h.web_details,
    }));

    // Start ElevenLabs conversation
    state.conversation = await Conversation.startSession({
      signedUrl,
      dynamicVariables: {
        hospitals_data: JSON.stringify(hospitalsForAgent, null, 2),
      },
      clientTools: {
        update_triage_card: async (params) => {
          console.log("[update_triage_card] Called with params:", params);
          updateTriageCard(params);
          console.log("[update_triage_card] Card", params.card_number, "updated with:", params.answer);
          return "Triage card updated successfully.";
        },
        display_recommendation: async (params) => {
          showRecommendationFromAgent(params);
          return "Recommendation displayed successfully in the UI.";
        },
      },
      onMessage: (msg) => {
        showCaption(msg.message);
      },
      onUserTranscript: () => {
        // No-op: only show agent speech as live caption
      },
      onStatusChange: (status) => {
        updateVoiceStatus(status);
        if (status === "listening" || status === "processing") {
          clearCaption();
        }
      },
      onError: (error) => {
        console.error("ElevenLabs error:", error);
        showCaption( "I'm having trouble with the connection. Please try again.");
        stopSession();
      },
      onDisconnect: () => {
        stopSession();
      },
    });

    state.sessionActive = true;
    voiceAgent.classList.add("active");
    agentBadge.style.display = "inline-block";
    voiceStatus.textContent = "Session active — listening...";
    resetTriageCards();
  } catch (err) {
    console.error("Failed to start session:", err);
    voiceStatus.textContent = "Connection failed. Click to retry.";
    showCaption( `Could not start voice session: ${err.message}`);
  }
}

async function stopSession() {
  if (state.conversation) {
    try {
      await state.conversation.endSession();
    } catch {
      // Session may already be ended
    }
    state.conversation = null;
  }
  state.sessionActive = false;
  voiceAgent.classList.remove("active");
  agentBadge.style.display = "none";
  voiceStatus.textContent = "Session ended. Click to restart.";
  clearCaption();
  liveCaptionText.textContent = "Transcript will appear here...";
}

function updateVoiceStatus(status) {
  const statusMap = {
    connecting: "Connecting...",
    connected: "Connected — listening...",
    listening: "Listening...",
    speaking: "Agent speaking...",
    processing: "Thinking...",
    disconnected: "Disconnected",
  };
  voiceStatus.textContent = statusMap[status] || status;
}

// === Display Recommendation from Agent's client tool ===
function showRecommendationFromAgent(params) {
  const { hospital_name, reason } = params;

  const hospital = state.hospitals.find((h) =>
    h.name.toLowerCase().includes(hospital_name.toLowerCase()) ||
    hospital_name.toLowerCase().includes(h.name.toLowerCase())
  );

  if (!hospital) return;

  selectHospital(hospital.id, reason);
}

// === Triage Card Updates ===
function updateTriageCard({ card_number, answer }) {
  const num = Math.round(card_number);
  if (num < 1 || num > 5) return;

  const card = document.getElementById(`triageCard${num}`);
  const answerEl = document.getElementById(`triageAnswer${num}`);
  const statusEl = document.getElementById(`triageStatus${num}`);

  if (!card || !answerEl || !statusEl) return;

  card.classList.add("answered");
  answerEl.textContent = answer;
  statusEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // Highlight the next unanswered card as active
  for (let i = 1; i <= 5; i++) {
    const c = document.getElementById(`triageCard${i}`);
    if (c) c.classList.remove("active");
  }
  for (let i = num + 1; i <= 5; i++) {
    const c = document.getElementById(`triageCard${i}`);
    if (c && !c.classList.contains("answered")) {
      c.classList.add("active");
      break;
    }
  }
}

function resetTriageCards() {
  for (let i = 1; i <= 5; i++) {
    const card = document.getElementById(`triageCard${i}`);
    const answerEl = document.getElementById(`triageAnswer${i}`);
    const statusEl = document.getElementById(`triageStatus${i}`);
    if (card) card.classList.remove("answered", "active");
    if (answerEl) answerEl.textContent = "Waiting...";
    if (statusEl) statusEl.innerHTML = "";
  }
  // Mark first card as active
  const first = document.getElementById("triageCard1");
  if (first) first.classList.add("active");
}

// === Live Caption helpers ===
function showCaption(text) {
  const formatted = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, " ");
  liveCaptionText.innerHTML = formatted;
  liveCaption.classList.add("speaking");
}

function clearCaption() {
  liveCaption.classList.remove("speaking");
  liveCaptionText.textContent = "";
}

// === Debug Tools ===
const debugTriageBtn = $("#debugTriageBtn");
const debugRecommendBtn = $("#debugRecommendBtn");
const debugResetBtn = $("#debugResetBtn");

let debugTriageStep = 0;
const debugTriageData = [
  { card_number: 1, answer: "No, not life-threatening" },
  { card_number: 2, answer: "Headache and mild fever" },
  { card_number: 3, answer: "5/10 - Moderate" },
  { card_number: 4, answer: "Since yesterday" },
  { card_number: 5, answer: "Blue Cross" },
];

debugTriageBtn.addEventListener("click", () => {
  if (debugTriageStep === 0) resetTriageCards();
  if (debugTriageStep < debugTriageData.length) {
    const data = debugTriageData[debugTriageStep];
    updateTriageCard(data);
    showCaption(`[Debug] Triage card ${data.card_number}: ${data.answer}`);
    debugTriageStep++;
  } else {
    showCaption("[Debug] All triage cards filled. Try Simulate Recommend.");
  }
});

debugRecommendBtn.addEventListener("click", () => {
  if (state.hospitals.length === 0) {
    showCaption("[Debug] No hospitals loaded yet.");
    return;
  }
  const h = state.hospitals[0];
  showRecommendationFromAgent({
    hospital_name: h.name,
    reason: "Closest hospital with matching specialty and good reviews",
  });
  showCaption(`[Debug] Recommended: ${h.name}`);
});

debugResetBtn.addEventListener("click", () => {
  resetTriageCards();
  debugTriageStep = 0;
  clearCaption();
  liveCaptionText.textContent = "Transcript will appear here...";
  if (state.hospitals.length > 0) {
    selectHospital(state.hospitals[0].id);
  }
});

// Expose selectHospital globally (used by onclick in rendered HTML)
window.selectHospital = selectHospital;
