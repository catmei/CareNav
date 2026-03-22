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
const mapPlaceholder = $("#mapPlaceholder");
const userDot = $("#userDot");

// === Triage conversation flow ===
const triageQuestions = [
  { key: "symptoms", question: "Can you describe your symptoms or what happened? For example: chest pain, broken arm, difficulty breathing, allergic reaction." },
  { key: "severity", question: "On a scale of 1 to 10, how severe would you rate your situation? Or describe it as mild, moderate, or severe." },
  { key: "duration", question: "How long have you been experiencing these symptoms?" },
  { key: "insurance", question: "Do you have a preferred insurance provider? This helps me find hospitals that accept your plan. You can skip this if you prefer." },
];

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
  detectLocation();
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
  addressModal.style.display = "flex";
}

function handleAddressSubmit() {
  // Mock geocoding — use Chicago coordinates as default
  state.lat = 41.8781;
  state.lng = -87.6298;
  setLocationStatus("active", $("#addressInput").value || "Chicago, IL (default)");
  addressModal.style.display = "none";
  showUserOnMap();
  fetchHospitals();
}

// === Map ===
function showUserOnMap() {
  userDot.style.display = "block";
  const noteEl = mapPlaceholder.querySelector(".map-note");
  if (noteEl) noteEl.textContent = "Your location detected";
}

function plotHospitalsOnMap(hospitals) {
  // Remove existing markers
  mapPlaceholder.querySelectorAll(".hospital-marker").forEach((m) => m.remove());

  hospitals.forEach((h, i) => {
    const marker = document.createElement("div");
    marker.className = "hospital-marker";
    // Spread markers around the center dot
    const angle = (i / hospitals.length) * 2 * Math.PI - Math.PI / 2;
    const radius = 30 + h.distance_miles * 15;
    const x = 50 + Math.cos(angle) * Math.min(radius, 40);
    const y = 50 + Math.sin(angle) * Math.min(radius, 35);
    marker.style.left = x + "%";
    marker.style.top = y + "%";
    marker.innerHTML = `
      <div class="marker-dot"></div>
      <div class="marker-label">${h.name.split(" ")[0]}</div>
    `;
    marker.addEventListener("click", () => {
      const card = document.getElementById("card-" + h.id);
      if (card) { card.scrollIntoView({ behavior: "smooth" }); card.click(); }
    });
    mapPlaceholder.appendChild(marker);
  });
}

// === Fetch Hospitals ===
async function fetchHospitals() {
  hospitalsList.innerHTML = '<div class="empty-state"><p>Searching nearby hospitals...</p></div>';
  try {
    const res = await fetch(`/api/hospitals?lat=${state.lat}&lng=${state.lng}`);
    const data = await res.json();
    state.hospitals = data.hospitals;
    renderHospitals(data.hospitals);
    plotHospitalsOnMap(data.hospitals);
  } catch (err) {
    hospitalsList.innerHTML = '<div class="empty-state"><p>Error loading hospitals. Please try again.</p></div>';
  }
}

function renderHospitals(hospitals) {
  hospitalsList.innerHTML = hospitals
    .map(
      (h) => `
    <div class="hospital-card" id="card-${h.id}" onclick="toggleCard(this, '${h.id}')">
      <div class="card-top">
        <span class="card-name">${h.name}</span>
        <span class="card-rating">⭐ ${h.rating}</span>
      </div>
      <div class="card-address">${h.address}</div>
      <div class="card-meta">
        <span class="meta-tag distance">${h.distance_miles} mi</span>
        <span class="meta-tag wait">~${h.er_wait_minutes} min wait</span>
        <span class="meta-tag">${h.specialties[0]}</span>
      </div>
      <div class="card-details">
        <div class="detail-section">
          <div class="detail-label">About</div>
          <div class="detail-text">${h.firecrawl_summary.official_info}</div>
        </div>
        <div class="detail-section">
          <div class="detail-label">Patient Reviews</div>
          <div class="detail-text">${h.firecrawl_summary.reviews_summary}</div>
        </div>
        <div class="detail-section">
          <div class="detail-label">Recent News</div>
          <div class="detail-text">${h.firecrawl_summary.recent_news}</div>
        </div>
        <div class="detail-section">
          <div class="detail-label">Specialties</div>
          <div class="specialties-list">
            ${h.specialties.map((s) => `<span class="specialty-tag">${s}</span>`).join("")}
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-label">Insurance Accepted</div>
          <div class="detail-text">${h.insurance_accepted.join(", ")}</div>
        </div>
        <div class="card-actions">
          <a href="tel:${h.phone}" class="btn btn-call btn-sm">📞 Call ${h.phone}</a>
        </div>
      </div>
    </div>
  `
    )
    .join("");
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

  // Start triage after a beat
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

  // Process triage answer
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
      // All questions answered — get recommendations
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
  const r1 = recs[0];
  const r2 = recs[1];

  addMessage(
    "agent",
    `Based on your symptoms, location, and preferences, I recommend two hospitals:\n\n` +
    `**1. ${r1.name}** — ${r1.distance_miles} miles away (${r1.rating} stars)\n` +
    `${r1.reasons.join(". ")}.\n\n` +
    `**2. ${r2.name}** — ${r2.distance_miles} miles away (${r2.rating} stars)\n` +
    `${r2.reasons.join(". ")}.\n\n` +
    `Would you like to call either of these hospitals? I can provide their phone number.`
  );

  // Show recommendation cards
  recommendationsSection.style.display = "block";
  recommendationsList.innerHTML = recs
    .map(
      (r) => `
    <div class="rec-card">
      <div class="card-top">
        <span class="card-name">${r.name}</span>
        <span class="card-rating">⭐ ${r.rating}</span>
      </div>
      <div class="card-address">${r.address}</div>
      <div class="card-meta">
        <span class="meta-tag distance">${r.distance_miles} mi</span>
        <span class="meta-tag wait">~${r.er_wait_minutes} min wait</span>
      </div>
      <div class="rec-reasons">
        ${r.reasons.map((reason) => `<div class="rec-reason">${reason}</div>`).join("")}
      </div>
      <div class="card-actions" style="margin-top:12px">
        <a href="tel:${r.phone}" class="btn btn-call">📞 Call ${r.name} — ${r.phone}</a>
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
  // Simple markdown-ish bold support
  const formatted = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  div.innerHTML = `<span class="msg-label">${role === "agent" ? "Agent" : "You"}</span><p>${formatted}</p>`;
  conversation.appendChild(div);
  conversation.scrollTop = conversation.scrollHeight;
}

// Expose toggleCard globally
window.toggleCard = toggleCard;
