const root = document.getElementById("htm-replica-root");

const MAP_STYLES = {
  htm: {
    label: "HTM Map",
    url: "https://worldwidemaps.sqkii.com/api/maps/purple/style.json",
  },
  streets: {
    label: "Streets",
    url: "https://worldwidemaps.sqkii.com/api/maps/Streets/style.json",
  },
  osm: {
    label: "Open Street Map",
    url: "https://worldwidemaps.sqkii.com/api/maps/OpenStreetMap/style.json",
  },
};

const STORAGE_KEY = "htm-circle-tool-replica-state-v1";

const mockUsers = [
  {
    email: "admin@sqkii.com",
    password: "Password123!",
    role: "ADMIN",
    has2FA: false,
    secret: "SQKII-7F3A-2B91",
  },
  {
    email: "ops@sqkii.com",
    password: "Password123!",
    role: "MASTER",
    has2FA: true,
    secret: "SQKII-9C20-8AA1",
  },
];

const defaultState = {
  route: "home",
  menuOpen: false,
  authPhase: "login",
  otpMode: "setup_2fa",
  pendingEmail: "",
  pendingSecret: "",
  loginError: "",
  otpError: "",
  otpValue: "",
  draftId: null,
  editorStep: 1,
  coinsTab: "pending",
  filters: {
    eventId: "",
    tagId: "",
    search: "",
  },
  mapStyle: "htm",
  session: null,
  secrets: [
    "HTM-APR-2026-SB-001",
    "HTM-APR-2026-SB-002",
    "HTM-APR-2026-SB-003",
  ],
  hints: [
    "Avoid road medians and active crossings.",
    "Keep the hiding spot publicly accessible.",
    "Ensure circles do not overlap restricted compounds.",
  ],
  members: [
    { id: "mem-1", name: "Ari", email: "ari@sqkii.com", role: "ADMIN" },
    { id: "mem-2", name: "Nadia", email: "nadia@sqkii.com", role: "OPS" },
    { id: "mem-3", name: "Joel", email: "joel@sqkii.com", role: "REVIEWER" },
  ],
  events: [
    {
      id: "evt-shopback",
      name: "ShopBack April Drop",
      tags: [
        { id: "tag-shopback", label: "ShopBack" },
        { id: "tag-premium", label: "Premium" },
      ],
    },
    {
      id: "evt-sqkii",
      name: "Sqkii Weekend Hunt",
      tags: [
        { id: "tag-sqkii", label: "Sqkii" },
        { id: "tag-limited", label: "Limited" },
      ],
    },
  ],
  stagingCoins: [],
  productionCoins: [],
  editorDraft: null,
};

function seedCoins() {
  return [
    {
      id: "coin-301",
      name: "Coin #11",
      eventId: "evt-shopback",
      eventName: "ShopBack April Drop",
      tagId: "tag-shopback",
      tagLabel: "ShopBack",
      serialNumber: "SB-24011",
      reward: "S$50 Voucher",
      prefix: "ShopBack",
      status: "pending",
      publishedAt: "",
      updatedAt: "2026-04-02T16:20:00.000Z",
      showScheduledCircleAt: "2026-04-04T10:00:00.000Z",
      startAt: "2026-04-05T10:00:00.000Z",
      endAt: "2026-04-05T17:00:00.000Z",
      shrinkInterval: 20,
      totalCircles: 6,
      totalPrivateCircles: 2,
      firstPublicRadius: 220,
      lastPublicRadius: 1400,
      firstPrivateRadius: 80,
      notes: "Hidden near the green corridor entrance.",
      lat: 1.30098,
      lng: 103.83946,
      metadata: {
        shopbackGoldenCoin: true,
      },
    },
    {
      id: "coin-298",
      name: "Coin #8",
      eventId: "evt-sqkii",
      eventName: "Sqkii Weekend Hunt",
      tagId: "tag-sqkii",
      tagLabel: "Sqkii",
      serialNumber: "SQ-24008",
      reward: "S$99 Cash",
      prefix: "Sqkii",
      status: "approved",
      publishedAt: "2026-04-01T14:20:00.000Z",
      updatedAt: "2026-04-01T11:20:00.000Z",
      showScheduledCircleAt: "2026-04-03T08:00:00.000Z",
      startAt: "2026-04-04T11:00:00.000Z",
      endAt: "2026-04-04T19:00:00.000Z",
      shrinkInterval: 25,
      totalCircles: 5,
      totalPrivateCircles: 1,
      firstPublicRadius: 250,
      lastPublicRadius: 1100,
      firstPrivateRadius: 120,
      notes: "Best viewed from the riverside walkway.",
      lat: 1.28964,
      lng: 103.85644,
      metadata: {
        shopbackGoldenCoin: false,
      },
    },
    {
      id: "coin-315",
      name: "Coin #14",
      eventId: "evt-shopback",
      eventName: "ShopBack April Drop",
      tagId: "tag-premium",
      tagLabel: "Premium",
      serialNumber: "SB-24014",
      reward: "S$150 Mystery Pack",
      prefix: "Premium",
      status: "draft",
      publishedAt: "",
      updatedAt: "2026-04-03T07:45:00.000Z",
      showScheduledCircleAt: "2026-04-06T12:00:00.000Z",
      startAt: "2026-04-07T12:00:00.000Z",
      endAt: "2026-04-07T20:00:00.000Z",
      shrinkInterval: 15,
      totalCircles: 7,
      totalPrivateCircles: 3,
      firstPublicRadius: 260,
      lastPublicRadius: 1600,
      firstPrivateRadius: 90,
      notes: "Draft coin still waiting for timing review.",
      lat: 1.3523,
      lng: 103.8198,
      metadata: {
        shopbackGoldenCoin: false,
      },
    },
  ];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hydrateState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const base = clone(defaultState);
  base.stagingCoins = seedCoins().filter((coin) => coin.status !== "approved");
  base.productionCoins = seedCoins().filter((coin) => coin.status === "approved");

  if (!saved) return base;

  try {
    const parsed = JSON.parse(saved);
    return {
      ...base,
      ...parsed,
      events: parsed.events || base.events,
      members: parsed.members || base.members,
      hints: parsed.hints || base.hints,
      secrets: parsed.secrets || base.secrets,
      stagingCoins: parsed.stagingCoins || base.stagingCoins,
      productionCoins: parsed.productionCoins || base.productionCoins,
      filters: { ...base.filters, ...(parsed.filters || {}) },
      session: parsed.session || null,
      authPhase: parsed.session ? "ready" : "login",
      loginError: "",
      otpError: "",
      otpValue: "",
      menuOpen: false,
    };
  } catch {
    return base;
  }
}

const state = hydrateState();
const popupDate = new Intl.DateTimeFormat("en-SG", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

let map;
let mapLoaded = false;
let mountedMapStyle = null;

function persist() {
  const {
    loginError,
    otpError,
    otpValue,
    menuOpen,
    pendingEmail,
    pendingSecret,
    ...savedState
  } = state;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAdmin() {
  return state.session && ["ADMIN", "MASTER"].includes(state.session.role);
}

function formatDate(value) {
  return value ? popupDate.format(new Date(value)) : "Not scheduled";
}

function getEvent(eventId) {
  return state.events.find((event) => event.id === eventId) || null;
}

function getTag(eventId, tagId) {
  const event = getEvent(eventId);
  return event?.tags.find((tag) => tag.id === tagId) || null;
}

function routeTitle(route) {
  return {
    home: "Operations Dashboard",
    manage_coin: "Manage Coins",
    add_coin_circle: "Add Coin Circle",
    manage_team: "Manage Team",
    manage_event: "Manage Events",
    manage_hint: "Hints",
    secrets: "Secrets",
  }[route] || "Circle Tool";
}

function blankDraft() {
  const firstEvent = state.events[0];
  const firstTag = firstEvent?.tags[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const end = new Date(tomorrow);
  end.setHours(end.getHours() + 8);

  return {
    id: uid("coin"),
    name: `Coin #${state.stagingCoins.length + state.productionCoins.length + 1}`,
    eventId: firstEvent?.id || "",
    eventName: firstEvent?.name || "",
    tagId: firstTag?.id || "",
    tagLabel: firstTag?.label || "",
    serialNumber: "",
    reward: "S$50 Voucher",
    prefix: firstTag?.label || firstEvent?.name || "Sqkii",
    status: "draft",
    publishedAt: "",
    updatedAt: new Date().toISOString(),
    showScheduledCircleAt: tomorrow.toISOString(),
    startAt: tomorrow.toISOString(),
    endAt: end.toISOString(),
    shrinkInterval: 20,
    totalCircles: 6,
    totalPrivateCircles: 2,
    firstPublicRadius: 220,
    lastPublicRadius: 1400,
    firstPrivateRadius: 90,
    notes: "",
    lat: 1.30098,
    lng: 103.83946,
    metadata: {
      shopbackGoldenCoin: false,
    },
  };
}

function updateDraftRelations() {
  if (!state.editorDraft) return;

  const event = getEvent(state.editorDraft.eventId);
  const tag = getTag(state.editorDraft.eventId, state.editorDraft.tagId);

  state.editorDraft.eventName = event?.name || "";
  state.editorDraft.tagLabel = tag?.label || "";
  state.editorDraft.prefix = tag?.label || event?.name || state.editorDraft.prefix;

  if (!tag && event?.tags?.length) {
    state.editorDraft.tagId = event.tags[0].id;
    state.editorDraft.tagLabel = event.tags[0].label;
    state.editorDraft.prefix = event.tags[0].label;
  }
}

function saveDraft(statusOverride) {
  if (!state.editorDraft) return;

  updateDraftRelations();
  const draft = clone(state.editorDraft);
  draft.status = statusOverride || (draft.status === "pending" ? "pending" : "draft");
  draft.updatedAt = new Date().toISOString();

  const index = state.stagingCoins.findIndex((coin) => coin.id === draft.id);
  if (index >= 0) {
    state.stagingCoins[index] = draft;
  } else {
    state.stagingCoins.unshift(draft);
  }

  state.draftId = draft.id;
  persist();
}

function publishDraft() {
  if (!state.editorDraft) return;

  updateDraftRelations();
  const published = clone(state.editorDraft);
  published.status = "approved";
  published.publishedAt = new Date().toISOString();
  published.updatedAt = published.publishedAt;

  state.stagingCoins = state.stagingCoins.filter((coin) => coin.id !== published.id);
  state.productionCoins = [published, ...state.productionCoins.filter((coin) => coin.id !== published.id)];
  state.editorDraft = null;
  state.draftId = null;
  state.editorStep = 1;
  state.route = "manage_coin";
  state.coinsTab = "approved";
  persist();
}

function filteredCoins(list) {
  const search = state.filters.search.trim().toLowerCase();

  return list.filter((coin) => {
    if (state.filters.eventId && coin.eventId !== state.filters.eventId) return false;
    if (state.filters.tagId && coin.tagId !== state.filters.tagId) return false;

    if (!search) return true;

    return [
      coin.name,
      coin.eventName,
      coin.tagLabel,
      coin.serialNumber,
      coin.reward,
      coin.prefix,
    ]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(search));
  });
}

function filteredStagingCoins() {
  return filteredCoins(state.stagingCoins);
}

function filteredProductionCoins() {
  return filteredCoins(state.productionCoins);
}

function stepsForDraft() {
  return [
    "Coin Details",
    "Timing",
    "Map Placement",
    "Preview & Publish",
  ];
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function circlePolygon(centerLng, centerLat, radiusMeters, points = 72) {
  const coords = [];
  const earthRadius = 6378137;
  const latRadians = (centerLat * Math.PI) / 180;

  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const lng = centerLng + ((dx / earthRadius) * 180) / Math.PI / Math.cos(latRadians);
    const lat = centerLat + ((dy / earthRadius) * 180) / Math.PI;
    coords.push([lng, lat]);
  }

  return coords;
}

function coinPointFeature(coin, mode) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [Number(coin.lng), Number(coin.lat)],
    },
    properties: {
      id: coin.id,
      name: coin.name,
      eventName: coin.eventName,
      reward: coin.reward,
      status: coin.status,
      mode,
      schedule: formatDate(coin.startAt),
      circles: `${coin.totalCircles} public / ${coin.totalPrivateCircles} private`,
    },
  };
}

function currentEditorFeatureCollection() {
  if (!state.editorDraft) {
    return { type: "FeatureCollection", features: [] };
  }

  const draft = state.editorDraft;
  const features = [];

  features.push({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [Number(draft.lng), Number(draft.lat)],
    },
    properties: {
      id: draft.id,
      name: draft.name,
      eventName: draft.eventName,
      reward: draft.reward,
      status: draft.status,
      mode: "editor",
      schedule: formatDate(draft.startAt),
      circles: `${draft.totalCircles} public / ${draft.totalPrivateCircles} private`,
    },
  });

  const publicRadii = [draft.firstPublicRadius, Math.round((draft.firstPublicRadius + draft.lastPublicRadius) / 2), draft.lastPublicRadius];
  publicRadii.forEach((radius, index) => {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [circlePolygon(Number(draft.lng), Number(draft.lat), radius)],
      },
      properties: {
        visibility: "public",
        order: index + 1,
      },
    });
  });

  if (draft.totalPrivateCircles > 0) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [circlePolygon(Number(draft.lng), Number(draft.lat), Number(draft.firstPrivateRadius))],
      },
      properties: {
        visibility: "private",
        order: 1,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function getMapCenter() {
  if (state.editorDraft) {
    return [Number(state.editorDraft.lng), Number(state.editorDraft.lat)];
  }

  if (state.productionCoins[0]) {
    return [Number(state.productionCoins[0].lng), Number(state.productionCoins[0].lat)];
  }

  return [103.8198, 1.3521];
}

function popupHtml(feature) {
  const props = feature.properties || {};
  return `
    <div class="popup-card">
      <div class="tiny-kicker">${props.mode || "coin"} marker</div>
      <h4 class="coin-card-title">${props.name || "Untitled coin"}</h4>
      <div class="coin-card-meta">
        <span>${props.eventName || "No event"}</span>
        <span>${props.reward || "No reward"}</span>
      </div>
      <div class="detail-row"><span>Status</span><strong>${props.status || "draft"}</strong></div>
      <div class="detail-row"><span>Schedule</span><strong>${props.schedule || "Not scheduled"}</strong></div>
      <div class="detail-row"><span>Circles</span><strong>${props.circles || "0"}</strong></div>
    </div>
  `;
}

function addGeoJsonSource(id, data) {
  const source = map.getSource(id);
  if (source) {
    source.setData(data);
    return;
  }

  map.addSource(id, {
    type: "geojson",
    data,
  });
}

function addLayerIfMissing(layer) {
  if (!map.getLayer(layer.id)) {
    map.addLayer(layer);
  }
}

function mountMapLayers() {
  if (!mapLoaded) return;

  addGeoJsonSource("htm-production-coins", {
    type: "FeatureCollection",
    features: state.productionCoins.map((coin) => coinPointFeature(coin, "production")),
  });
  addGeoJsonSource("htm-staging-coins", {
    type: "FeatureCollection",
    features: state.stagingCoins.map((coin) => coinPointFeature(coin, "staging")),
  });
  addGeoJsonSource("htm-editor-features", currentEditorFeatureCollection());

  addLayerIfMissing({
    id: "htm-editor-circles-fill",
    type: "fill",
    source: "htm-editor-features",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": [
        "match",
        ["get", "visibility"],
        "private",
        "#6841bd",
        "#0ca7a4",
      ],
      "fill-opacity": [
        "match",
        ["get", "visibility"],
        "private",
        0.16,
        0.11,
      ],
    },
  });

  addLayerIfMissing({
    id: "htm-editor-circles-line",
    type: "line",
    source: "htm-editor-features",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": [
        "match",
        ["get", "visibility"],
        "private",
        "#a885ff",
        "#14dad7",
      ],
      "line-width": 2,
      "line-dasharray": [
        "match",
        ["get", "visibility"],
        "private",
        ["literal", [1, 1]],
        ["literal", [2, 1.5]],
      ],
    },
  });

  addLayerIfMissing({
    id: "htm-production-points",
    type: "circle",
    source: "htm-production-coins",
    paint: {
      "circle-radius": 7,
      "circle-color": "#0ca7a4",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  addLayerIfMissing({
    id: "htm-staging-points",
    type: "circle",
    source: "htm-staging-coins",
    paint: {
      "circle-radius": 6,
      "circle-color": "#f5bf3b",
      "circle-stroke-color": "#2a153f",
      "circle-stroke-width": 2,
    },
  });

  addLayerIfMissing({
    id: "htm-editor-point",
    type: "circle",
    source: "htm-editor-features",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 8,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#6841bd",
      "circle-stroke-width": 3,
    },
  });
}

function syncMapData() {
  if (!map || !mapLoaded) return;

  addGeoJsonSource("htm-production-coins", {
    type: "FeatureCollection",
    features: state.productionCoins.map((coin) => coinPointFeature(coin, "production")),
  });
  addGeoJsonSource("htm-staging-coins", {
    type: "FeatureCollection",
    features: state.stagingCoins.map((coin) => coinPointFeature(coin, "staging")),
  });
  addGeoJsonSource("htm-editor-features", currentEditorFeatureCollection());

  const center = getMapCenter();
  map.jumpTo({
    center,
    zoom: state.editorDraft ? 14.8 : 11.2,
  });
}

function ensureMap() {
  if (!state.session) return;

  const container = document.getElementById("htm-replica-map");
  if (!container || typeof maplibregl === "undefined") return;

  const styleUrl = MAP_STYLES[state.mapStyle]?.url || MAP_STYLES.htm.url;

  if (map && mountedMapStyle !== styleUrl) {
    map.remove();
    map = undefined;
    mapLoaded = false;
    mountedMapStyle = null;
  }

  if (!map) {
    map = new maplibregl.Map({
      container,
      style: styleUrl,
      center: getMapCenter(),
      zoom: state.editorDraft ? 14.8 : 11.2,
      attributionControl: false,
    });

    mountedMapStyle = styleUrl;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    map.on("load", () => {
      mapLoaded = true;
      mountMapLayers();
      syncMapData();
    });

    map.on("click", (event) => {
      if (state.route !== "add_coin_circle" || !state.editorDraft) return;

      state.editorDraft.lng = Number(event.lngLat.lng.toFixed(6));
      state.editorDraft.lat = Number(event.lngLat.lat.toFixed(6));
      persist();
      render();
    });

    ["htm-production-points", "htm-staging-points", "htm-editor-point"].forEach((layerId) => {
      map.on("click", layerId, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;

        new maplibregl.Popup({ closeButton: true, offset: 18 })
          .setLngLat(feature.geometry.coordinates)
          .setHTML(popupHtml(feature))
          .addTo(map);
      });

      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return;
  }

  if (mapLoaded) {
    syncMapData();
  }
}

function destroyMap() {
  if (map) {
    map.remove();
  }

  map = undefined;
  mapLoaded = false;
  mountedMapStyle = null;
}

function setRoute(route) {
  if (route === "add_coin_circle" && !state.editorDraft) {
    state.editorDraft = blankDraft();
    updateDraftRelations();
  }

  state.route = route;
  if (route !== "add_coin_circle") {
    state.editorStep = 1;
  }
  persist();
  render();
}

function signOut() {
  state.session = null;
  state.authPhase = "login";
  state.pendingEmail = "";
  state.pendingSecret = "";
  state.loginError = "";
  state.otpError = "";
  state.otpValue = "";
  persist();
  render();
}

function openDraft(draft) {
  state.editorDraft = clone(draft);
  state.draftId = draft.id;
  state.editorStep = 1;
  state.route = "add_coin_circle";
  persist();
  render();
}

function openNewDraft() {
  state.editorDraft = blankDraft();
  updateDraftRelations();
  state.draftId = state.editorDraft.id;
  state.editorStep = 1;
  state.route = "add_coin_circle";
  persist();
  render();
}

function statusClass(status) {
  return {
    pending: "status-pending",
    approved: "status-approved",
    draft: "status-draft",
  }[status] || "status-draft";
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function otpDialogHtml() {
  return `
    <div class="dialog-backdrop">
      <div class="dialog">
        <div class="dialog-header">
          <div>
            <div class="section-kicker">${state.otpMode === "setup_2fa" ? "Setup 2FA" : "Verify OTP"}</div>
            <h2 class="dialog-title">Finish the secure sign in</h2>
            <p class="dialog-copy">
              Use the replica OTP code <span class="mono">246 810</span> to continue.
            </p>
          </div>
          <button class="icon-btn" data-action="cancel-otp" aria-label="Close">x</button>
        </div>
        <div class="secret-grid">
          <div class="otp-box">
            <div class="tiny-kicker">Authenticator secret</div>
            <div class="secret-code">${escapeHtml(state.pendingSecret || "SQKII-DEMO-2FA")}</div>
            <p class="auth-note">This mirrors the original tool's setup flow, but uses local mock data only.</p>
          </div>
          <div class="qr-card">
            <div>
              <div class="tiny-kicker">QR Placeholder</div>
              <div class="panel-title">Scan in Authenticator</div>
              <p class="panel-copy">Any six-digit equivalent is accepted as <span class="mono">246810</span>.</p>
            </div>
          </div>
        </div>
        <form id="otp-form" class="field-grid">
          <label class="field">
            <span class="field-label">One-time password</span>
            <input
              class="otp-input"
              name="otp"
              value="${escapeHtml(state.otpValue)}"
              placeholder="246 810"
              autocomplete="one-time-code"
            />
          </label>
          ${state.otpError ? `<div class="error-text">${escapeHtml(state.otpError)}</div>` : ""}
          <div class="dialog-actions">
            <button class="btn btn-primary" type="submit">Verify and enter</button>
            <button class="btn btn-ghost" type="button" data-action="cancel-otp">Back</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function loginHtml() {
  return `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="brand-kicker"># HuntTheMouse</div>
        <h1 class="auth-title">HTM Circle Tool Replica</h1>
        <p class="auth-copy">
          A front-end recreation of the internal ops workflow for managing coin circles, reviews, and publish flow.
        </p>
        <form id="login-form" class="field-grid">
          <label class="field">
            <span class="field-label">Email</span>
            <input name="email" type="email" value="${escapeHtml(state.pendingEmail)}" placeholder="admin@sqkii.com" />
          </label>
          <label class="field">
            <span class="field-label">Password</span>
            <input name="password" type="password" placeholder="Password123!" />
          </label>
          ${state.loginError ? `<div class="error-text">${escapeHtml(state.loginError)}</div>` : ""}
          <div class="auth-actions">
            <button class="btn btn-primary btn-block" type="submit">Sign in to circle ops</button>
          </div>
        </form>
        <div class="helper-box">
          <div class="section-kicker">Demo Accounts</div>
          <div class="helper-list">
            <div><span class="mono">admin@sqkii.com</span> / <span class="mono">Password123!</span></div>
            <div><span class="mono">ops@sqkii.com</span> / <span class="mono">Password123!</span></div>
          </div>
        </div>
        <p class="auth-note">Replica note: no live API calls are made and all edits stay in local storage.</p>
      </div>
      ${state.authPhase === "otp" ? otpDialogHtml() : ""}
    </div>
  `;
}

function menuHtml() {
  const items = [
    ["home", "Home"],
    ["manage_coin", "Manage Coins"],
    ["add_coin_circle", "Add Coin Circle"],
    ["manage_team", "Manage Team"],
    ["manage_event", "Manage Events"],
    ["manage_hint", "Hints"],
    ["secrets", "Secrets"],
  ];

  return `
    <div class="route-chip-row">
      ${items
        .map(
          ([route, label]) => `
            <button class="route-chip ${state.route === route ? "is-active" : ""}" data-action="route" data-route="${route}">
              ${label}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function coinCardHtml(coin, mode) {
  return `
    <article class="coin-card">
      <div class="coin-card-head">
        <div>
          <div class="tiny-kicker">${escapeHtml(coin.prefix || "Coin")}</div>
          <h3 class="coin-card-title">${escapeHtml(coin.name)}</h3>
          <div class="coin-card-meta">
            <span>${escapeHtml(coin.eventName)}</span>
            <span>${escapeHtml(coin.tagLabel)}</span>
            <span>${escapeHtml(coin.serialNumber || "No serial")}</span>
          </div>
        </div>
        <span class="status-pill ${statusClass(coin.status)}">${escapeHtml(coin.status)}</span>
      </div>
      <div class="detail-row"><span>Reward</span><strong>${escapeHtml(coin.reward)}</strong></div>
      <div class="detail-row"><span>Starts</span><strong>${formatDate(coin.startAt)}</strong></div>
      <div class="detail-row"><span>Circles</span><strong>${coin.totalCircles} public / ${coin.totalPrivateCircles} private</strong></div>
      <div class="detail-row"><span>Location</span><strong>${Number(coin.lat).toFixed(4)}, ${Number(coin.lng).toFixed(4)}</strong></div>
      <div class="coin-card-actions">
        ${mode !== "production" ? `<button class="btn btn-secondary" data-action="edit-draft" data-id="${coin.id}">Open Editor</button>` : ""}
        <button class="btn btn-ghost" data-action="clone-coin" data-id="${coin.id}" data-mode="${mode}">Duplicate</button>
      </div>
    </article>
  `;
}

function homeHtml() {
  return `
    <section class="panel-block">
      <div class="section-kicker">Overview</div>
      <h2 class="panel-title">Coin operations at a glance</h2>
      <p class="panel-copy">A replica of the internal dashboard for staging, approving, and placing coin circles on the map.</p>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${state.productionCoins.length}</div>
          <div class="stat-label">Approved Coins</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${state.stagingCoins.length}</div>
          <div class="stat-label">Pending Review</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${state.members.length}</div>
          <div class="stat-label">Ops Members</div>
        </div>
      </div>
    </section>
    <section class="panel-block">
      <div class="toolbar-row">
        <button class="btn btn-primary" data-action="new-draft">Create coin circle</button>
        <button class="btn btn-ghost" data-action="route" data-route="manage_coin">Open queue</button>
      </div>
    </section>
    <section class="panel-block">
      <div class="section-kicker">Latest Production Coins</div>
      <div class="coin-list">
        ${state.productionCoins.slice(0, 2).map((coin) => coinCardHtml(coin, "production")).join("")}
      </div>
    </section>
  `;
}

function manageCoinsHtml() {
  const activeCoins = state.coinsTab === "approved" ? filteredProductionCoins() : filteredStagingCoins();
  const selectedEvent = getEvent(state.filters.eventId);
  const availableTags = selectedEvent?.tags || state.events.flatMap((event) => event.tags);

  return `
    <section class="panel-block">
      <div class="toolbar-row">
        <button class="btn btn-primary" data-action="new-draft">Create coin circle</button>
        <button class="btn btn-ghost" data-action="reset-filters">Reset filters</button>
      </div>
      <div class="tab-row">
        <button class="tab-chip ${state.coinsTab === "pending" ? "is-active" : ""}" data-action="set-tab" data-tab="pending">Pending Review</button>
        <button class="tab-chip ${state.coinsTab === "approved" ? "is-active" : ""}" data-action="set-tab" data-tab="approved">Approved Coins</button>
      </div>
      <div class="filter-grid">
        <label class="field">
          <span class="field-label">Event</span>
          <select data-field="filters.eventId">
            <option value="">All events</option>
            ${state.events.map((event) => `<option value="${event.id}" ${state.filters.eventId === event.id ? "selected" : ""}>${escapeHtml(event.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Tag</span>
          <select data-field="filters.tagId">
            <option value="">All tags</option>
            ${availableTags.map((tag) => `<option value="${tag.id}" ${state.filters.tagId === tag.id ? "selected" : ""}>${escapeHtml(tag.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Search</span>
          <input data-field="filters.search" value="${escapeHtml(state.filters.search)}" placeholder="Coin, reward, serial..." />
        </label>
      </div>
    </section>
    <section class="panel-block">
      <div class="section-kicker">${state.coinsTab === "approved" ? "Production" : "Staging"}</div>
      <h2 class="panel-title">${activeCoins.length} matching coins</h2>
      <div class="coin-list">
        ${activeCoins.length ? activeCoins.map((coin) => coinCardHtml(coin, state.coinsTab === "approved" ? "production" : "staging")).join("") : `<div class="empty-state"><div class="panel-title">No coins found</div><p class="empty-copy">Try another filter combination or create a new draft.</p></div>`}
      </div>
    </section>
  `;
}

function editorFieldsHtml() {
  const draft = state.editorDraft || blankDraft();
  const event = getEvent(draft.eventId);
  const tags = event?.tags || [];

  if (state.editorStep === 1) {
    return `
      <div class="wizard-grid">
        <label class="field">
          <span class="field-label">Event</span>
          <select data-field="editorDraft.eventId">
            ${state.events.map((item) => `<option value="${item.id}" ${draft.eventId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Tag</span>
          <select data-field="editorDraft.tagId">
            ${tags.map((tag) => `<option value="${tag.id}" ${draft.tagId === tag.id ? "selected" : ""}>${escapeHtml(tag.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Coin Name</span>
          <input data-field="editorDraft.name" value="${escapeHtml(draft.name)}" />
        </label>
        <label class="field">
          <span class="field-label">Serial Number</span>
          <input data-field="editorDraft.serialNumber" value="${escapeHtml(draft.serialNumber)}" placeholder="SB-24021" />
        </label>
        <label class="field">
          <span class="field-label">Reward</span>
          <input data-field="editorDraft.reward" value="${escapeHtml(draft.reward)}" />
        </label>
        <label class="field">
          <span class="field-label">Public Circles</span>
          <input data-field="editorDraft.totalCircles" data-type="number" type="number" min="1" value="${draft.totalCircles}" />
        </label>
        <label class="field">
          <span class="field-label">Private Circles</span>
          <input data-field="editorDraft.totalPrivateCircles" data-type="number" type="number" min="0" value="${draft.totalPrivateCircles}" />
        </label>
        <label class="field span-2">
          <span class="field-label">Notes</span>
          <textarea data-field="editorDraft.notes">${escapeHtml(draft.notes)}</textarea>
        </label>
      </div>
    `;
  }

  if (state.editorStep === 2) {
    return `
      <div class="wizard-grid">
        <label class="field">
          <span class="field-label">Show Scheduled Circle</span>
          <input data-field="editorDraft.showScheduledCircleAt" data-type="datetime" type="datetime-local" value="${toLocalInputValue(draft.showScheduledCircleAt)}" />
        </label>
        <label class="field">
          <span class="field-label">Start Time</span>
          <input data-field="editorDraft.startAt" data-type="datetime" type="datetime-local" value="${toLocalInputValue(draft.startAt)}" />
        </label>
        <label class="field">
          <span class="field-label">End Time</span>
          <input data-field="editorDraft.endAt" data-type="datetime" type="datetime-local" value="${toLocalInputValue(draft.endAt)}" />
        </label>
        <label class="field">
          <span class="field-label">Shrink Interval (mins)</span>
          <input data-field="editorDraft.shrinkInterval" data-type="number" type="number" min="5" value="${draft.shrinkInterval}" />
        </label>
        <label class="field">
          <span class="field-label">First Public Radius</span>
          <input data-field="editorDraft.firstPublicRadius" data-type="number" type="number" min="50" value="${draft.firstPublicRadius}" />
        </label>
        <label class="field">
          <span class="field-label">Last Public Radius</span>
          <input data-field="editorDraft.lastPublicRadius" data-type="number" type="number" min="100" value="${draft.lastPublicRadius}" />
        </label>
        <label class="field">
          <span class="field-label">First Private Radius</span>
          <input data-field="editorDraft.firstPrivateRadius" data-type="number" type="number" min="20" value="${draft.firstPrivateRadius}" />
        </label>
      </div>
    `;
  }

  if (state.editorStep === 3) {
    return `
      <div class="helper-box">
        <div class="section-kicker">Map Placement</div>
        <h3 class="panel-title">Drop the coin on the live map</h3>
        <p class="panel-copy">Click anywhere on the map to update the preview marker and regenerate the public/private circle overlays.</p>
      </div>
      <div class="wizard-grid">
        <label class="field">
          <span class="field-label">Latitude</span>
          <input data-field="editorDraft.lat" data-type="number" type="number" step="0.000001" value="${draft.lat}" />
        </label>
        <label class="field">
          <span class="field-label">Longitude</span>
          <input data-field="editorDraft.lng" data-type="number" type="number" step="0.000001" value="${draft.lng}" />
        </label>
      </div>
    `;
  }

  return `
    <div class="coin-card">
      <div class="coin-card-head">
        <div>
          <div class="tiny-kicker">${escapeHtml(draft.eventName)}</div>
          <h3 class="coin-card-title">${escapeHtml(draft.name)}</h3>
          <div class="coin-card-meta">
            <span>${escapeHtml(draft.tagLabel)}</span>
            <span>${escapeHtml(draft.serialNumber || "Serial pending")}</span>
          </div>
        </div>
        <span class="status-pill ${statusClass(draft.status)}">${escapeHtml(draft.status)}</span>
      </div>
      <div class="detail-row"><span>Reward</span><strong>${escapeHtml(draft.reward)}</strong></div>
      <div class="detail-row"><span>Schedule</span><strong>${formatDate(draft.startAt)} to ${formatDate(draft.endAt)}</strong></div>
      <div class="detail-row"><span>Circles</span><strong>${draft.totalCircles} public / ${draft.totalPrivateCircles} private</strong></div>
      <div class="detail-row"><span>Placement</span><strong>${Number(draft.lat).toFixed(4)}, ${Number(draft.lng).toFixed(4)}</strong></div>
    </div>
  `;
}

function editorHtml() {
  const draft = state.editorDraft || blankDraft();
  const steps = stepsForDraft();

  return `
    <section class="panel-block wizard-shell">
      <div class="section-kicker">Coin Circle Wizard</div>
      <h2 class="panel-title">${escapeHtml(draft.name)}</h2>
      <div class="step-row">
        ${steps
          .map(
            (step, index) => `
              <button class="step-chip ${state.editorStep === index + 1 ? "is-active" : ""}" data-action="go-step" data-step="${index + 1}">
                <div class="step-number">${index + 1}</div>
                <div class="step-label">${escapeHtml(step)}</div>
              </button>
            `
          )
          .join("")}
      </div>
      ${editorFieldsHtml()}
      <div class="wizard-actions">
        <button class="btn btn-ghost" data-action="route" data-route="manage_coin">Back to queue</button>
        ${state.editorStep > 1 ? `<button class="btn btn-secondary" data-action="prev-step">Previous</button>` : ""}
        ${state.editorStep < 4 ? `<button class="btn btn-primary" data-action="next-step">Next step</button>` : ""}
        <button class="btn btn-warning" data-action="save-pending">Save for review</button>
        <button class="btn btn-ghost" data-action="save-draft">Save draft</button>
        ${state.editorStep === 4 ? `<button class="btn btn-primary" data-action="publish-draft">Upload to production</button>` : ""}
      </div>
    </section>
    <section class="helper-box">
      <div class="section-kicker">Replica behavior</div>
      <ul class="helper-list">
        <li>All changes are stored locally in your browser only.</li>
        <li>Publishing moves the coin from staging into the approved production list.</li>
        <li>Clicking the map updates the editor marker and preview circles.</li>
      </ul>
    </section>
  `;
}

function placeholderHtml(route) {
  if (route === "manage_team") {
    return `
      <section class="panel-block">
        <div class="section-kicker">Ops Roster</div>
        <h2 class="panel-title">Manage Team</h2>
        <div class="member-list">
          ${state.members
            .map(
              (member) => `
                <div class="member-row">
                  <div>
                    <strong>${escapeHtml(member.name)}</strong>
                    <div class="member-meta">${escapeHtml(member.email)}</div>
                  </div>
                  <span class="mini-chip">${escapeHtml(member.role)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  if (route === "manage_event") {
    return `
      <section class="panel-block">
        <div class="section-kicker">Live Events</div>
        <h2 class="panel-title">Manage Events</h2>
        <div class="event-list">
          ${state.events
            .map(
              (event) => `
                <div class="event-row">
                  <div>
                    <strong>${escapeHtml(event.name)}</strong>
                    <div class="event-meta">${event.tags.map((tag) => tag.label).join(" / ")}</div>
                  </div>
                  <span class="mini-chip">${event.tags.length} tags</span>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  if (route === "manage_hint") {
    return `
      <section class="panel-block">
        <div class="section-kicker">Hide Rules</div>
        <h2 class="panel-title">Hints</h2>
        <div class="circle-list">
          ${state.hints.map((hint) => `<div class="circle-row"><span>${escapeHtml(hint)}</span></div>`).join("")}
        </div>
      </section>
    `;
  }

  return `
    <section class="panel-block">
      <div class="section-kicker">Secure Vault</div>
      <h2 class="panel-title">Secrets</h2>
      <div class="secret-list">
        ${state.secrets
          .map(
            (secret, index) => `
              <div class="secret-row">
                <span class="mono">${escapeHtml(secret)}</span>
                <span class="mini-chip">${index + 1}</span>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function sidebarHtml() {
  let body = homeHtml();

  if (state.route === "manage_coin") body = manageCoinsHtml();
  if (state.route === "add_coin_circle") body = editorHtml();
  if (["manage_team", "manage_event", "manage_hint", "secrets"].includes(state.route)) {
    body = placeholderHtml(state.route);
  }

  return `
    <aside class="shell-sidebar">
      <div class="shell-topbar">
        <div>
          <div class="brand-kicker">HTM Circle Tool</div>
          <div class="shell-title">${routeTitle(state.route)}</div>
          <div class="shell-subtitle">${escapeHtml(state.session?.email || "")}</div>
        </div>
        <div class="icon-stack">
          <button class="icon-btn" data-action="route" data-route="home" aria-label="Home">H</button>
          <button class="icon-btn" data-action="new-draft" aria-label="Create">+</button>
        </div>
      </div>
      <div class="sidebar-scroll">
        ${menuHtml()}
        ${body}
      </div>
      <div class="shell-footer">
        <span>${escapeHtml(state.session?.role || "")} access</span>
        <button class="btn btn-ghost" data-action="sign-out">Sign out</button>
      </div>
    </aside>
  `;
}

function shellHtml() {
  return `
    <div class="htm-app">
      <div class="shell">
        ${sidebarHtml()}
        <section class="map-stage">
          <div id="htm-replica-map"></div>
          <div class="map-topbar">
            <div class="floating-card">
              <div class="map-caption">Live Preview</div>
              <h3 class="map-overlay-title">${state.editorDraft ? escapeHtml(state.editorDraft.name) : "Circle Map"}</h3>
              <div class="map-legend-note">
                ${state.route === "add_coin_circle" ? "Click the map to position the active coin." : "Preview staging and production markers across Singapore."}
              </div>
            </div>
            <div class="map-style-panel">
              <span class="tiny-kicker">Map style</span>
              <select data-field="mapStyle">
                ${Object.entries(MAP_STYLES)
                  .map(([key, style]) => `<option value="${key}" ${state.mapStyle === key ? "selected" : ""}>${escapeHtml(style.label)}</option>`)
                  .join("")}
              </select>
            </div>
          </div>
          <div class="legend-card">
            <div class="map-caption">Legend</div>
            <div class="legend-grid">
              <div class="legend-item"><span class="legend-dot" style="background:#0ca7a4"></span><span>Production coin</span></div>
              <div class="legend-item"><span class="legend-dot" style="background:#f5bf3b"></span><span>Staging coin</span></div>
              <div class="legend-item"><span class="legend-dot" style="background:#ffffff"></span><span>Editor preview</span></div>
              <div class="legend-item"><span class="legend-dot" style="background:#6841bd"></span><span>Private circle</span></div>
            </div>
            <p class="map-legend-note">Replica map pulls the same public Sqkii style endpoints but does not call the live circle API.</p>
          </div>
        </section>
      </div>
    </div>
  `;
}

function setByPath(path, rawValue, type) {
  const segments = path.split(".");
  let target = state;

  for (let index = 0; index < segments.length - 1; index += 1) {
    target = target[segments[index]];
  }

  const lastKey = segments[segments.length - 1];
  let value = rawValue;

  if (type === "number") {
    value = rawValue === "" ? 0 : Number(rawValue);
  }

  if (type === "datetime") {
    value = rawValue ? new Date(rawValue).toISOString() : "";
  }

  target[lastKey] = value;

  if (path.startsWith("editorDraft.")) {
    updateDraftRelations();
  }

  if (path === "filters.eventId") {
    state.filters.tagId = "";
  }
}

function render() {
  destroyMap();
  root.innerHTML = state.session ? shellHtml() : loginHtml();
  bindUi();
  ensureMap();
}

function bindUi() {
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");
      const matchedUser = mockUsers.find((user) => user.email === email && user.password === password);

      if (!matchedUser) {
        state.loginError = "Invalid email or password for the replica account.";
        render();
        return;
      }

      state.loginError = "";
      state.pendingEmail = matchedUser.email;
      state.pendingSecret = matchedUser.secret;
      state.otpMode = matchedUser.has2FA ? "verify_2fa" : "setup_2fa";
      state.authPhase = "otp";
      render();
    });
  }

  const otpForm = document.getElementById("otp-form");
  if (otpForm) {
    otpForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(otpForm);
      const otp = String(formData.get("otp") || "").replace(/\s+/g, "");
      const matchedUser = mockUsers.find((user) => user.email === state.pendingEmail);

      if (!matchedUser || otp !== "246810") {
        state.otpError = "The replica OTP code is 246 810.";
        state.otpValue = otp;
        render();
        return;
      }

      state.session = {
        email: matchedUser.email,
        role: matchedUser.role,
      };
      state.authPhase = "ready";
      state.otpError = "";
      state.otpValue = "";
      state.route = "home";
      persist();
      render();
    });
  }

  root.querySelectorAll("[data-field]").forEach((element) => {
    element.addEventListener("change", (event) => {
      const target = event.currentTarget;
      setByPath(target.dataset.field, target.value, target.dataset.type);
      persist();
      render();
    });
  });

  root.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const target = event.currentTarget;
      const { action } = target.dataset;

      if (action === "route") {
        setRoute(target.dataset.route);
        return;
      }

      if (action === "sign-out") {
        signOut();
        return;
      }

      if (action === "new-draft") {
        openNewDraft();
        return;
      }

      if (action === "edit-draft") {
        const draft = state.stagingCoins.find((coin) => coin.id === target.dataset.id);
        if (draft) openDraft(draft);
        return;
      }

      if (action === "clone-coin") {
        const sourceList = target.dataset.mode === "production" ? state.productionCoins : state.stagingCoins;
        const sourceCoin = sourceList.find((coin) => coin.id === target.dataset.id);
        if (!sourceCoin) return;
        state.editorDraft = {
          ...clone(sourceCoin),
          id: uid("coin"),
          name: `${sourceCoin.name} Copy`,
          status: "draft",
          publishedAt: "",
          updatedAt: new Date().toISOString(),
        };
        state.route = "add_coin_circle";
        state.editorStep = 1;
        persist();
        render();
        return;
      }

      if (action === "set-tab") {
        state.coinsTab = target.dataset.tab;
        persist();
        render();
        return;
      }

      if (action === "reset-filters") {
        state.filters = { eventId: "", tagId: "", search: "" };
        persist();
        render();
        return;
      }

      if (action === "go-step") {
        state.editorStep = Number(target.dataset.step);
        persist();
        render();
        return;
      }

      if (action === "next-step") {
        state.editorStep = Math.min(4, state.editorStep + 1);
        persist();
        render();
        return;
      }

      if (action === "prev-step") {
        state.editorStep = Math.max(1, state.editorStep - 1);
        persist();
        render();
        return;
      }

      if (action === "save-draft") {
        saveDraft("draft");
        state.route = "manage_coin";
        state.coinsTab = "pending";
        render();
        return;
      }

      if (action === "save-pending") {
        saveDraft("pending");
        state.route = "manage_coin";
        state.coinsTab = "pending";
        render();
        return;
      }

      if (action === "publish-draft") {
        publishDraft();
        return;
      }

      if (action === "cancel-otp") {
        state.authPhase = "login";
        state.otpError = "";
        state.otpValue = "";
        render();
      }
    });
  });
}

render();
