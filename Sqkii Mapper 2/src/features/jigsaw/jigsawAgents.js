import { makeBoundaryPrompt, normalizeCoin, offsetLatLng } from './jigsawUtils.js';

function agentInputEnvelope(input = {}) {
  const coin = normalizeCoin(input.coin || {});
  return {
    image_url: input.image_url,
    notes: input.notes || '',
    coin,
    search_boundary: {
      country: 'Singapore',
      center_lat: coin.center_lat,
      center_lng: coin.center_lng,
      radius_m: coin.radius_m
    },
    boundary_prompt: makeBoundaryPrompt(coin)
  };
}

function insidePoint(coin, eastRatio, northRatio) {
  const radius = Math.max(20, Number(coin.radius_m) || 80);
  return offsetLatLng(coin.center_lat, coin.center_lng, radius * eastRatio, radius * northRatio);
}

function outsidePoint(coin, eastRatio, northRatio) {
  const radius = Math.max(80, Number(coin.radius_m) || 80);
  return offsetLatLng(coin.center_lat, coin.center_lng, radius * eastRatio, radius * northRatio);
}

export async function openaiVisionAgent(input = {}) {
  const env = agentInputEnvelope(input);
  const coin = env.coin;
  const primary = insidePoint(coin, 0.18, -0.12);
  const alternate = outsidePoint(coin, 1.45, 0.8);
  await new Promise((resolve) => setTimeout(resolve, 320));
  return {
    agent_name: 'OpenAI Vision',
    boundary_prompt: env.boundary_prompt,
    primary_candidate: {
      location_name: `${coin.coin_name} north-east hardscape clue`,
      lat: primary.lat,
      lng: primary.lng,
      confidence: 0.78
    },
    alternate_candidates: [
      {
        location_name: 'Rejected mock: outside selected circle',
        lat: alternate.lat,
        lng: alternate.lng,
        confidence: 0.84
      }
    ],
    visual_clues: ['public walkway', 'park edge', 'flat concrete texture'],
    limitations: ['Mock agent only; real OpenAI Vision can be connected later.'],
    raw_notes: env.notes
  };
}

export async function geminiVisionAgent(input = {}) {
  const env = agentInputEnvelope(input);
  const coin = env.coin;
  const primary = insidePoint(coin, 0.2, -0.1);
  const alternate = outsidePoint(coin, -1.35, 0.65);
  await new Promise((resolve) => setTimeout(resolve, 420));
  return {
    agent_name: 'Gemini Vision',
    boundary_prompt: env.boundary_prompt,
    primary_candidate: {
      location_name: `${coin.coin_name} matching paved-open area`,
      lat: primary.lat,
      lng: primary.lng,
      confidence: 0.74
    },
    alternate_candidates: [
      {
        location_name: 'Rejected mock: elsewhere in Singapore',
        lat: alternate.lat,
        lng: alternate.lng,
        confidence: 0.81
      }
    ],
    visual_clues: ['open public area', 'low greenery', 'possible HDB estate edge'],
    limitations: ['Mock agent only; real Gemini Vision can be connected later.'],
    raw_notes: env.notes
  };
}

export async function singaporeReferenceAgent(input = {}) {
  const env = agentInputEnvelope(input);
  const coin = env.coin;
  const primary = insidePoint(coin, -0.22, 0.16);
  const alternate = outsidePoint(coin, 1.7, -0.25);
  await new Promise((resolve) => setTimeout(resolve, 360));
  return {
    agent_name: 'Singapore Reference Search',
    boundary_prompt: env.boundary_prompt,
    primary_candidate: {
      location_name: `${coin.coin_name} alternate valid SG reference match`,
      lat: primary.lat,
      lng: primary.lng,
      confidence: 0.61
    },
    alternate_candidates: [
      {
        location_name: 'Rejected mock: reference match outside radius',
        lat: alternate.lat,
        lng: alternate.lng,
        confidence: 0.9
      }
    ],
    visual_clues: ['Singapore public clue texture', 'possible estate footpath'],
    limitations: ['Mock reference search does not fetch external imagery.'],
    raw_notes: env.notes
  };
}

