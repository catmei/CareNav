// === State ===
const state = {
  lat: null,
  lng: null,
  hospitals: [],
  sessionActive: false,
  triageStep: 0,
  triageData: { symptoms: "", severity: "", duration: "", insurance: "" },
};

// === DOM refs ===
const $ = (sel) => document.querySelector(sel);
const locationStatus = $("#locationStatus");
const hospitalsList = $("#hospitalsList");
const conversation = $("#conversation");
const voiceAgent = $("#voiceAgent");
const micButton = $("#micButton");
const voiceStatus = $("#voiceStatus");
const agentBadge = $("#agentBadge");
const textInput = $("#textInput");
const sendButton = $("#sendButton");
const addressModal = $("#addressModal");
const addressSubmit = $("#addressSubmit");
const retryLocation = $("#retryLocation");
const refreshBtn = $("#refreshBtn");
const recommendationsSection = $("#recommendationsSection");
const recommendationsList = $("#recommendationsList");
const locationChoiceModal = $("#locationChoiceModal");
const useGpsBtn = $("#useGpsBtn");
const enterAddressBtn = $("#enterAddressBtn");

// === Triage conversation flow ===
const triageQuestions = [
  { key: "symptoms", question: "Can you describe your symptoms or what happened? For example: chest pain, broken arm, difficulty breathing, allergic reaction." },
  { key: "severity", question: "On a scale of 1 to 10, how severe would you rate your situation? Or describe it as mild, moderate, or severe." },
  { key: "duration", question: "How long have you been experiencing these symptoms?" },
  { key: "insurance", question: "Do you have a preferred insurance provider? This helps me find hospitals that accept your plan. You can skip this if you prefer." },
];

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
      // Reset all pins to default color
      hospitalMarkers.forEach((m) => {
        m.getElement()?.querySelector(".hospital-map-pin")?.classList.remove("selected-pin");
      });
      // Highlight clicked pin
      marker.getElement()?.querySelector(".hospital-map-pin")?.classList.add("selected-pin");
      const card = document.getElementById("card-" + h.id);
      if (card) { card.scrollIntoView({ behavior: "smooth" }); card.click(); }
    });
    hospitalMarkers.push(marker);
  });

  // Fit map to show user + all hospitals
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
  // Show location choice first — don't request GPS without consent
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
  sendButton.addEventListener("click", handleSend);
  textInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSend(); });
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

// === Voice Session (Mock) ===
function toggleVoiceSession() {
  if (state.sessionActive) {
    stopSession();
  } else {
    startSession();
  }
}

function startSession() {
  state.sessionActive = true;
  state.triageStep = 0;
  voiceAgent.classList.add("active");
  agentBadge.style.display = "inline-block";
  voiceStatus.textContent = "Session active — listening...";

  setTimeout(() => {
    if (state.hospitals.length > 0) {
      addMessage("agent", `I've found ${state.hospitals.length} hospitals near you. Let me ask a few questions to find the best match for your situation.`);
      setTimeout(() => askTriageQuestion(), 1000);
    } else {
      addMessage("agent", "I'm still looking for hospitals near you. In the meantime, let me understand your situation.");
      setTimeout(() => askTriageQuestion(), 1000);
    }
  }, 500);
}

function stopSession() {
  state.sessionActive = false;
  voiceAgent.classList.remove("active");
  agentBadge.style.display = "none";
  voiceStatus.textContent = "Session ended. Click to restart.";
  addMessage("agent", "Session ended. Click the microphone to start a new session.");
}

function askTriageQuestion() {
  if (state.triageStep < triageQuestions.length) {
    const q = triageQuestions[state.triageStep];
    addMessage("agent", q.question);
  }
}

// === Chat / Text Input ===
function handleSend() {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = "";

  addMessage("user", text);

  if (!state.sessionActive) {
    startSession();
    return;
  }

  if (state.triageStep < triageQuestions.length) {
    const key = triageQuestions[state.triageStep].key;
    state.triageData[key] = text;
    state.triageStep++;

    if (state.triageStep < triageQuestions.length) {
      setTimeout(() => {
        addMessage("agent", "Got it, thank you.");
        setTimeout(() => askTriageQuestion(), 800);
      }, 500);
    } else {
      setTimeout(() => {
        addMessage("agent", "Thank you for all that information. Let me analyze the hospitals near you and find the best match...");
        setTimeout(() => fetchRecommendations(), 1500);
      }, 500);
    }
  }
}

async function fetchRecommendations() {
  try {
    const params = new URLSearchParams({
      lat: state.lat,
      lng: state.lng,
      symptoms: state.triageData.symptoms,
      insurance: state.triageData.insurance,
    });
    const res = await fetch(`/api/recommend?${params}`);
    const data = await res.json();
    showRecommendations(data.recommendations);
  } catch {
    addMessage("agent", "I had trouble getting recommendations. Please check the hospital list above for options.");
  }
}

function showRecommendations(recs) {
  if (!recs || recs.length < 2) {
    addMessage("agent", "I couldn't find enough hospitals to compare. Please check the list above.");
    return;
  }
  const r1 = recs[0];
  const r2 = recs[1];

  addMessage(
    "agent",
    `Based on your symptoms, location, and preferences, I recommend two hospitals:\n\n` +
    `**1. ${r1.name}** — ${r1.distance_miles} miles away\n` +
    `${r1.reasons.join(". ")}.\n\n` +
    `**2. ${r2.name}** — ${r2.distance_miles} miles away\n` +
    `${r2.reasons.join(". ")}.\n\n` +
    `Would you like to call either of these hospitals?`
  );

  recommendationsSection.style.display = "block";
  recommendationsList.innerHTML = recs
    .map(
      (r) => `
    <div class="rec-card">
      <div class="card-top">
        <span class="card-name">${r.name}</span>
        ${r.rating !== null ? `<span class="card-rating">⭐ ${r.rating}</span>` : ""}
      </div>
      <div class="card-address">${r.address}</div>
      <div class="card-meta">
        <span class="meta-tag distance">${r.distance_miles} mi</span>
        ${r.er_wait_minutes !== null ? `<span class="meta-tag wait">~${r.er_wait_minutes} min wait</span>` : ""}
      </div>
      <div class="rec-reasons">
        ${r.reasons.map((reason) => `<div class="rec-reason">${reason}</div>`).join("")}
      </div>
      <div class="card-actions" style="margin-top:12px">
        ${r.phone !== "N/A" ? `<a href="tel:${r.phone}" class="btn btn-call">📞 Call ${r.name} — ${r.phone}</a>` : ""}
        <a href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=16/${r.lat}/${r.lng}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🗺 View on Map</a>
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
  conversation.appendChild(div);
  conversation.scrollTop = conversation.scrollHeight;
}

// Expose toggleCard globally
window.toggleCard = toggleCard;
