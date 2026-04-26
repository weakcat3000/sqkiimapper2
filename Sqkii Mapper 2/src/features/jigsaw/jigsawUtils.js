export function haversineMeters(lat1, lng1, lat2, lng2) {
  const nums = [lat1, lng1, lat2, lng2].map(Number);
  if (nums.some((value) => !Number.isFinite(value))) return Infinity;
  const [aLat, aLng, bLat, bLng] = nums;
  const toRad = (deg) => deg * Math.PI / 180;
  const earthRadiusMeters = 6371008.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function normalizeCoin(raw = {}) {
  const centerLat = Number(raw.center_lat ?? raw.centerLat ?? raw.lat);
  const centerLng = Number(raw.center_lng ?? raw.centerLng ?? raw.lng);
  const radiusM = Number(raw.radius_m ?? raw.radiusMeters ?? raw.radius);
  return {
    coin_id: String(raw.coin_id ?? raw.coinId ?? raw.id ?? '').trim(),
    coin_name: String(raw.coin_name ?? raw.coinName ?? raw.name ?? raw.coinLabel ?? 'Selected coin').trim(),
    center_lat: centerLat,
    center_lng: centerLng,
    radius_m: radiusM,
    status: String(raw.status ?? 'live').trim() || 'live'
  };
}

export function isValidCoinBoundary(coin) {
  const c = normalizeCoin(coin);
  return Number.isFinite(c.center_lat)
    && Number.isFinite(c.center_lng)
    && Number.isFinite(c.radius_m)
    && c.radius_m > 0;
}

export function validateCandidateInsideCoinCircle(candidate = {}, coin = {}) {
  const c = normalizeCoin(coin);
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lng);
  const distance = Number.isFinite(lat) && Number.isFinite(lng)
    ? haversineMeters(lat, lng, c.center_lat, c.center_lng)
    : Infinity;
  const inside = Number.isFinite(distance)
    && Number.isFinite(c.radius_m)
    && c.radius_m > 0
    && distance <= c.radius_m;

  return {
    ...candidate,
    lat,
    lng,
    inside_radius: inside,
    outside_radius: !inside,
    distance_from_coin_center_m: Number.isFinite(distance) ? Math.round(distance * 10) / 10 : null
  };
}

export function filterCandidatesInsideCoinCircle(candidates = [], coin = {}) {
  const validated = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => validateCandidateInsideCoinCircle(candidate, coin));
  return {
    validatedCandidates: validated,
    validCandidates: validated.filter((candidate) => candidate.inside_radius),
    rejectedOutsideRadiusCandidates: validated.filter((candidate) => !candidate.inside_radius)
  };
}

export function makeBoundaryPrompt(coin = {}) {
  const c = normalizeCoin(coin);
  return [
    'This is Singapore-only.',
    'The search area is strictly limited to the selected coin circle.',
    `The selected coin circle centre is ${c.center_lat}, ${c.center_lng}.`,
    `The radius is ${c.radius_m} metres.`,
    'Only suggest locations inside this circle.',
    'Do not suggest locations elsewhere in Singapore.'
  ].join('\n');
}

export function offsetLatLng(centerLat, centerLng, eastMeters, northMeters) {
  const lat = Number(centerLat);
  const lng = Number(centerLng);
  const dLat = northMeters / 111320;
  const dLng = eastMeters / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function distanceBetweenCandidates(a, b) {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

export function groupCandidatesByProximity(validCandidates = []) {
  const groups = [];
  const sorted = [...validCandidates].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

  for (const candidate of sorted) {
    let group = groups.find((item) => item.members.some((member) => distanceBetweenCandidates(member, candidate) <= 150));
    if (!group) {
      group = groups.find((item) => item.members.some((member) => distanceBetweenCandidates(member, candidate) <= 800));
    }
    if (!group) {
      group = {
        id: `group-${groups.length + 1}`,
        representative: candidate,
        members: [],
        agents: new Set(),
        samePlaceCount: 0,
        sameAreaCount: 0
      };
      groups.push(group);
    }
    group.members.push(candidate);
    if (candidate.agent_name) group.agents.add(candidate.agent_name);
  }

  return groups.map((group) => {
    const confidenceSum = group.members.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0);
    const avgLat = group.members.reduce((sum, item) => sum + item.lat, 0) / group.members.length;
    const avgLng = group.members.reduce((sum, item) => sum + item.lng, 0) / group.members.length;
    const samePlaceCount = group.members.filter((item) => distanceBetweenCandidates(group.representative, item) <= 150).length;
    const sameAreaCount = group.members.filter((item) => distanceBetweenCandidates(group.representative, item) <= 800).length;
    return {
      ...group,
      agents: [...group.agents],
      samePlaceCount,
      sameAreaCount,
      average_model_confidence: group.members.length ? confidenceSum / group.members.length : 0,
      location_name: group.representative.location_name || 'Candidate area',
      lat: avgLat,
      lng: avgLng
    };
  });
}

export function computeConfidenceLabel(groups = [], validCandidates = []) {
  if (!validCandidates.length) return 'No Valid Candidates Inside Selected Coin Radius';
  const bestAgreement = groups.reduce((max, group) => Math.max(max, group.agents.length), 0);
  if (bestAgreement >= 3) return 'Very High Confidence';
  if (bestAgreement >= 2) return 'Highly Accurate Candidate';
  return 'No Model Agreement';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

