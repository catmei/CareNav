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
const hospitalsList = $("#hospitalsList");
const conversationLog = $("#conversation");
const voiceAgent = $("#voiceAgent");
const micButton = $("#micButton");
const voiceStatus = $("#voiceStatus");
const agentBadge = $("#agentBadge");
const addressModal = $("#addressModal");
const addressSubmit = $("#addressSubmit");
const retryLocation = $("#retryLocation");
const refreshBtn = $("#refreshBtn");
const recommendationsSection = $("#recommendationsSection");
const recommendationsList = $("#recommendationsList");
const locationChoiceModal = $("#locationChoiceModal");
const useGpsBtn = $("#useGpsBtn");
const enterAddressBtn = $("#enterAddressBtn");

// === Map ===
let map = null;
let userMarker = null;
let hospitalMarkers = [];

function initMap(lat, lng) {
  if (!map) {
    map = L.map("map").setView([lat, lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);
  } else {
    map.setView([lat, lng], 13);
  }
}

function showUserOnMap() {
  initMap(state.lat, state.lng);
  if (userMarker) userMarker.remove();
  const icon = L.divIcon({
    className: "",
    html: '<div class="user-map-dot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  userMarker = L.marker([state.lat, state.lng], { icon }).addTo(map);
}

function plotHospitalsOnMap(hospitals) {
  hospitalMarkers.forEach((m) => m.remove());
  hospitalMarkers = [];

  hospitals.forEach((h, i) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="hospital-map-pin">${i + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const marker = L.marker([h.lat, h.lng], { icon }).addTo(map);
    marker.on("click", () => {
      hospitalMarkers.forEach((m) => {
        m.getElement()?.querySelector(".hospital-map-pin")?.classList.remove("selected-pin");
      });
      marker.getElement()?.querySelector(".hospital-map-pin")?.classList.add("selected-pin");
      const card = document.getElementById("card-" + h.id);
      if (card) { card.scrollIntoView({ behavior: "smooth" }); card.click(); }
    });
    hospitalMarkers.push(marker);
  });

  if (hospitals.length > 0) {
    const bounds = L.latLngBounds([
      [state.lat, state.lng],
      ...hospitals.map((h) => [h.lat, h.lng]),
    ]);
    map.fitBounds(bounds, { padding: [24, 24] });
  }
}

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
  locationChoiceModal.style.display = "flex";
  setLocationStatus("detecting", "Waiting for location...");

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
  hospitalsList.innerHTML = '<div class="empty-state"><p>Searching nearby hospitals...</p></div>';
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
    hospitalsList.innerHTML = '<div class="empty-state"><p>Error loading hospitals. Please try again.</p></div>';
  }
}

function renderHospitals(hospitals) {
  if (!hospitals.length) {
    hospitalsList.innerHTML = '<div class="empty-state"><p>No hospitals found nearby.</p></div>';
    return;
  }
  hospitalsList.innerHTML = hospitals
    .map(
      (h) => `
    <div class="hospital-card" id="card-${h.id}" onclick="toggleCard(this, '${h.id}')">
      <div class="card-top">
        <span class="card-name">${h.name}</span>
        ${h.rating !== null ? `<span class="card-rating">⭐ ${h.rating}</span>` : ""}
      </div>
      <div class="card-address">${h.address}</div>
      <div class="card-meta">
        <span class="meta-tag distance">${h.distance_miles} mi</span>
        ${h.er_wait_minutes !== null ? `<span class="meta-tag wait">~${h.er_wait_minutes} min wait</span>` : ""}
        <span class="meta-tag">${h.specialties[0] || "Hospital"}</span>
      </div>
      <div class="card-details">
        <div class="detail-section">
          <div class="detail-label">Hours</div>
          <div class="detail-text">${h.hours}</div>
        </div>
        <div class="detail-section">
          <div class="detail-label">Specialties</div>
          <div class="specialties-list">
            ${h.specialties.map((s) => `<span class="specialty-tag">${s}</span>`).join("")}
          </div>
        </div>
        ${h.insurance_accepted.length ? `
        <div class="detail-section">
          <div class="detail-label">Insurance Accepted</div>
          <div class="detail-text">${h.insurance_accepted.join(", ")}</div>
        </div>` : ""}
        ${h.website ? `
        <div class="detail-section">
          <div class="detail-label">Website</div>
          <div class="detail-text"><a href="${h.website}" target="_blank" rel="noopener">${h.website}</a></div>
        </div>` : ""}
        ${renderWebDetails(h.web_details)}
        <div class="card-actions">
          ${h.phone !== "N/A" ? `<a href="tel:${h.phone}" class="btn btn-call btn-sm">📞 Call ${h.phone}</a>` : ""}
          <a href="https://www.openstreetmap.org/?mlat=${h.lat}&mlon=${h.lng}#map=16/${h.lat}/${h.lng}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🗺 View on Map</a>
        </div>
      </div>
    </div>
  `
    )
    .join("");
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
      <div class="detail-label">Web Results</div>
      <div class="web-details-list">${items}</div>
    </div>`;
}

// Toggle card expand
function toggleCard(el, id) {
  document.querySelectorAll(".hospital-card").forEach((c) => {
    if (c !== el) c.classList.remove("expanded", "selected");
  });
  el.classList.toggle("expanded");
  el.classList.toggle("selected");
}

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
    addMessage("agent", "Please wait for hospitals to load before starting a voice session.");
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
      specialties: h.specialties,
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
        display_recommendations: async (params) => {
          showRecommendationsFromAgent(params);
          return "Recommendations displayed successfully in the UI.";
        },
      },
      onMessage: (msg) => {
        addMessage("agent", msg.message);
      },
      onUserTranscript: (transcript) => {
        // Only show final transcripts, not interim
        if (transcript.isFinal !== false) {
          addMessage("user", transcript.message);
        }
      },
      onStatusChange: (status) => {
        updateVoiceStatus(status);
      },
      onError: (error) => {
        console.error("ElevenLabs error:", error);
        addMessage("agent", "I'm having trouble with the connection. Please try again.");
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
  } catch (err) {
    console.error("Failed to start session:", err);
    voiceStatus.textContent = "Connection failed. Click to retry.";
    addMessage("agent", `Could not start voice session: ${err.message}`);
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

// === Display Recommendations from Agent's client tool ===
function showRecommendationsFromAgent(params) {
  const { hospital_1_name, hospital_1_reason, hospital_2_name, hospital_2_reason } = params;

  // Find matching hospitals from our data
  const rec1 = state.hospitals.find((h) =>
    h.name.toLowerCase().includes(hospital_1_name.toLowerCase()) ||
    hospital_1_name.toLowerCase().includes(h.name.toLowerCase())
  );
  const rec2 = state.hospitals.find((h) =>
    h.name.toLowerCase().includes(hospital_2_name.toLowerCase()) ||
    hospital_2_name.toLowerCase().includes(h.name.toLowerCase())
  );

  const recs = [
    { hospital: rec1, name: hospital_1_name, reason: hospital_1_reason },
    { hospital: rec2, name: hospital_2_name, reason: hospital_2_reason },
  ].filter((r) => r.hospital);

  if (recs.length === 0) return;

  recommendationsSection.style.display = "block";
  recommendationsList.innerHTML = recs
    .map(
      (r) => `
    <div class="rec-card">
      <div class="card-top">
        <span class="card-name">${r.hospital.name}</span>
        ${r.hospital.rating !== null ? `<span class="card-rating">⭐ ${r.hospital.rating}</span>` : ""}
      </div>
      <div class="card-address">${r.hospital.address}</div>
      <div class="card-meta">
        <span class="meta-tag distance">${r.hospital.distance_miles} mi</span>
        ${r.hospital.er_wait_minutes !== null ? `<span class="meta-tag wait">~${r.hospital.er_wait_minutes} min wait</span>` : ""}
      </div>
      <div class="rec-reasons">
        <div class="rec-reason">${r.reason}</div>
      </div>
      <div class="card-actions" style="margin-top:12px">
        ${r.hospital.phone !== "N/A" ? `<a href="tel:${r.hospital.phone}" class="btn btn-call">📞 Call ${r.hospital.name} — ${r.hospital.phone}</a>` : ""}
        <a href="https://www.openstreetmap.org/?mlat=${r.hospital.lat}&mlon=${r.hospital.lng}#map=16/${r.hospital.lat}/${r.hospital.lng}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🗺 View on Map</a>
      </div>
    </div>
  `
    )
    .join("");

  recommendationsSection.scrollIntoView({ behavior: "smooth" });
}

// === Chat helpers ===
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  const formatted = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  div.innerHTML = `<span class="msg-label">${role === "agent" ? "Agent" : "You"}</span><p>${formatted}</p>`;
  conversationLog.appendChild(div);
  conversationLog.scrollTop = conversationLog.scrollHeight;
}

// Expose toggleCard globally (used by onclick in rendered HTML)
window.toggleCard = toggleCard;
