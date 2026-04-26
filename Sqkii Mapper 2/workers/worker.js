const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const ALLOWED_HOSTS = new Set([
  "api-open.data.gov.sg",
  "s3.ap-southeast-1.amazonaws.com",
  "blobs.data.gov.sg",
]);

const MAX_MEDIA_PARTS = 8;
const MAX_INLINE_BYTES = 14 * 1024 * 1024;
const JIGSAW_MAX_MEDIA_PARTS = 16;
const SILVER_AI_RESPONSE_SCHEMA = {
  type: "object",
  required: ["overallSummary", "visualCues", "suggestions"],
  properties: {
    overallSummary: { type: "string" },
    visualCues: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        required: ["title", "reasoning", "confidence", "searchInstruction", "matchedPattern", "focusTarget", "focusRegion"],
        properties: {
          title: { type: "string" },
          reasoning: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          searchInstruction: { type: "string" },
          matchedPattern: { type: "string" },
          focusTarget: { type: "string" },
          focusRegion: {
            type: "object",
            required: ["mediaSlot", "x", "y", "width", "height"],
            properties: {
              mediaSlot: { type: "integer", minimum: 1, maximum: MAX_MEDIA_PARTS },
              x: { type: "number", minimum: 0, maximum: 1000 },
              y: { type: "number", minimum: 0, maximum: 1000 },
              width: { type: "number", minimum: 1, maximum: 1000 },
              height: { type: "number", minimum: 1, maximum: 1000 },
            },
          },
        },
      },
    },
  },
};
const JIGSAW_RESPONSE_SCHEMA = {
  type: "object",
  required: ["summary", "visualCues", "ocrExtracted", "candidates"],
  properties: {
    summary: { type: "string" },
    visualCues: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    ocrExtracted: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
      description: "All readable text extracted from the puzzle pieces: block numbers, road names, signs, MRT names, shop names, etc.",
    },
    candidates: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        required: ["name", "lat", "lng", "reasoning", "confidence", "confidenceScore", "crossCheck", "evidenceBreakdown", "streetViewHeading"],
        properties: {
          name: { type: "string", description: "Specific Singapore location name, e.g. 'Tampines Central Park near Block 234'" },
          lat: { type: "number", description: "Latitude of the candidate location, must be between 1.13 and 1.47" },
          lng: { type: "number", description: "Longitude of the candidate location, must be between 103.60 and 104.10" },
          reasoning: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low", "insufficient"] },
          confidenceScore: { type: "integer", minimum: 0, maximum: 100, description: "Numeric confidence: 95-100 confirmed, 80-94 strong candidate, 60-79 possible, <60 reject" },
          crossCheck: { type: "string" },
          evidenceBreakdown: {
            type: "object",
            required: ["buildingMatch", "textMatch", "roadLayout", "vegetation", "landmark", "skyline"],
            properties: {
              buildingMatch: { type: "string", enum: ["strong", "medium", "weak", "none"] },
              textMatch: { type: "string", description: "What text was matched or 'none'" },
              roadLayout: { type: "string", enum: ["strong", "medium", "weak", "none"] },
              vegetation: { type: "string", enum: ["strong", "medium", "weak", "none"] },
              landmark: { type: "string", description: "Specific landmark matched or 'none'" },
              skyline: { type: "string", enum: ["strong", "medium", "weak", "none"] },
            },
          },
          streetViewHeading: { type: "integer", minimum: 0, maximum: 359, description: "Best Street View camera heading (degrees) to match the puzzle image angle" },
        },
      },
    },
  },
};

function withCors(upstreamHeaders) {
  const headers = new Headers(upstreamHeaders || {});
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Vary", "Origin");
  return headers;
}

function textResponse(message, status = 400) {
  return new Response(message, {
    status,
    headers: withCors({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function safeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeRetrievalContext(items) {
  return Array.isArray(items)
    ? items.slice(0, 5).map((item) => ({
        title: safeString(item?.title),
        searchInstruction: safeString(item?.searchInstruction),
        environmentType: safeString(item?.environmentType),
        surfaceType: safeString(item?.surfaceType),
        concealmentType: safeString(item?.concealmentType),
        matchedCues: Array.isArray(item?.matchedCues) ? item.matchedCues.slice(0, 8).map((cue) => safeString(cue)).filter(Boolean) : [],
        examples: Array.isArray(item?.examples)
          ? item.examples.slice(0, 3).map((example) => ({
              campaign: safeString(example?.campaign),
              coinNumber: example?.coinNumber,
              description: safeString(example?.description),
            }))
          : [],
      }))
    : [];
}

function normalizeLocationContext(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const accuracyMeters = Number(value?.accuracyMeters);
  return {
    lat,
    lng,
    accuracyMeters: Number.isFinite(accuracyMeters) ? accuracyMeters : null,
  };
}

function normalizeMedia(items) {
  const normalized = [];
  let totalBytes = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (normalized.length >= MAX_MEDIA_PARTS) break;
    const mimeType = safeString(item?.mimeType);
    const dataBase64 = safeString(item?.dataBase64);
    if (!mimeType.startsWith("image/") || !dataBase64) continue;

    const approxBytes = Math.floor((dataBase64.length * 3) / 4);
    totalBytes += approxBytes;
    if (totalBytes > MAX_INLINE_BYTES) {
      throw new Error("Uploaded media is too large after preprocessing. Try one shorter video or fewer photos.");
    }

    normalized.push({
      mimeType,
      dataBase64,
      label: safeString(item?.label),
      sourceKind: safeString(item?.sourceKind),
      frameTimeSec: Number.isFinite(Number(item?.frameTimeSec)) ? Number(item.frameTimeSec) : null,
    });
  }

  return normalized;
}

function normalizeJigsawPieces(items) {
  const normalized = [];
  let totalBytes = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (normalized.length >= JIGSAW_MAX_MEDIA_PARTS) break;
    const mimeType = safeString(item?.mimeType);
    const dataBase64 = safeString(item?.dataBase64);
    const slot = Number(item?.slot);
    if (!mimeType.startsWith("image/") || !dataBase64 || !Number.isFinite(slot)) continue;

    const approxBytes = Math.floor((dataBase64.length * 3) / 4);
    totalBytes += approxBytes;
    if (totalBytes > MAX_INLINE_BYTES) {
      throw new Error("Puzzle images are too large after preprocessing. Save fewer/lower-resolution screenshots first.");
    }

    normalized.push({
      slot: Math.max(1, Math.min(16, Math.round(slot))),
      mimeType,
      dataBase64,
      note: safeString(item?.note).slice(0, 600),
    });
  }

  return normalized.sort((a, b) => a.slot - b.slot);
}

function buildGeminiPrompt({ notes, retrievalContext, media, locationContext }) {
  const retrievalText = retrievalContext.length
    ? JSON.stringify(retrievalContext, null, 2)
    : "[]";

  const mediaSummary = media.map((item, index) => ({
    slot: index + 1,
    label: item.label || `upload-${index + 1}`,
    sourceKind: item.sourceKind || "image",
    frameTimeSec: item.frameTimeSec,
  }));

  return [
    "You are Silver AI Scout for Sqkii Mapper.",
    "Your job is to inspect uploaded hunt media and suggest the most likely silver coin hiding spots.",
    "Coins are usually hidden in public, finger-retrievable micro-spots such as behind, under, inside, in between, below, beside, or on top of ordinary fixtures.",
    "Prioritize exact search suggestions that mention a position keyword and an object keyword.",
    "Use the reviewed silver archive context as a strong prior, but let the images decide when there is a mismatch.",
    "If hunter GPS is provided, use it as live field context. Favor suggestions that make sense to inspect near the hunter's current position.",
    "Do not give safety advice or generic caution notes.",
    "Use this hunt rule strictly: the coin should be reachable without stepping onto grass.",
    "If an object like a lamp post is surrounded by a large grass patch and is not reachable from the side of a walkway or hardscape edge, do not suggest it as a hiding spot.",
    "Favor spots reachable from pavement, tiles, walkway edges, planter borders, bench edges, wall edges, drain edges, or similar public hardscape access.",
    "For every suggestion, identify the exact visible evidence region from the uploaded media that supports it.",
    "Return one focusTarget label such as bricks, bench leg, drain edge, planter edge, wall crack, pole base, curb edge, or leaves.",
    "Return one focusRegion bounding box in normalized 0..1000 coordinates using the media summary slot numbers.",
    "Make the box tight around the exact object or texture you are referring to, so the UI can crop that region from the user's image.",
    "Use normal everyday English in titles, labels, reasons, and instructions.",
    "Do not use underscores, code-like labels, or words like pattern recognition, seam, crevice, fixture interface, or micro-spot.",
    "Prefer common words like edge, side, corner, gap, bottom, top, brick edge, wall edge, bench leg, or drain side.",
    "",
    `Hunter notes: ${notes || "None provided."}`,
    `Hunter GPS: ${locationContext ? JSON.stringify(locationContext) : "Not available."}`,
    `Media summary: ${JSON.stringify(mediaSummary, null, 2)}`,
    "Reviewed archive context:",
    retrievalText,
    "",
    "Return valid JSON with this shape only:",
    "{",
    '  "overallSummary": "short summary",',
    '  "visualCues": ["cue 1", "cue 2"],',
    '  "suggestions": [',
    "    {",
    '      "title": "short spot title",',
    '      "reasoning": "why this matches the media",',
    '      "confidence": "high|medium|low",',
    '      "searchInstruction": "exact instruction with position plus object wording",',
    '      "matchedPattern": "archive pattern or visual pattern",',
    '      "focusTarget": "short visible object or texture name",',
    '      "focusRegion": { "mediaSlot": 1, "x": 120, "y": 220, "width": 260, "height": 240 }',
    "    }",
    "  ]",
    "}",
    "Give 3 to 5 suggestions ordered from best to worst.",
    "Keep each suggestion concise and practical.",
  ].join("\n");
}

function buildJigsawPrompt({ coinName, pieces, evidenceSummary, singaporeBounds }) {
  const pieceSummary = pieces.map((piece) => ({
    slot: piece.slot,
    note: piece.note || "",
  }));

  return [
    "You are a world-class Singapore-only visual geolocation analyst for a Sqkii puzzle hunt.",
    "You will inspect jigsaw puzzle screenshots. The photos may show only fragments of HDB blocks, trees, roads, parks, signs, shelters, canals, playgrounds, fitness corners, MRT/LRT tracks, or other Singapore outdoor clues.",
    "",
    "=== PHASE 1: OCR EXTRACTION ===",
    "First, carefully extract ALL readable text from every piece: HDB block numbers, road signs, MRT/LRT station names, bus stop numbers, shop signs, school names, park names, hawker centre names, condo names, church/temple names. Put every extracted text string in the ocrExtracted array.",
    "",
    "=== PHASE 2: VISUAL ANALYSIS ===",
    "Analyze visible geometry: HDB facade type and color, roof shape, number of floors, corridor style, void deck shape, playground equipment type, shelter/pavilion design, railing style, canal/drain shape, tree species, road markings, lamp post type, bench style, fitness corner equipment.",
    "List all specific visual clues in the visualCues array.",
    "",
    "=== PHASE 3: CANDIDATE GENERATION ===",
    "For each candidate location you propose:",
    "1. It MUST be in Singapore. Latitude must be between 1.13 and 1.47. Longitude must be between 103.60 and 104.10.",
    "2. Provide the EXACT lat/lng coordinates of the specific spot, not just a general area.",
    "3. Rate confidence as a number 0-100. Use this scale strictly:",
    "   95-100: confirmed — multiple exact visual matches including text, building shape, and layout",
    "   80-94: strong candidate — several geometry clues match, needs one more verification",
    "   60-79: possible — some clues match but too many unknowns",
    "   <60: reject — only vague similarity",
    "4. Provide an evidence breakdown rating each category: buildingMatch, textMatch, roadLayout, vegetation, landmark, skyline.",
    "5. Suggest the best Street View camera heading (0-359 degrees) that would match the angle shown in the puzzle image.",
    "",
    "=== RULES ===",
    "Never claim a candidate is confirmed unless the visible image contains distinctive evidence that could uniquely match that place.",
    "If the fragments are generic HDB blocks with no text and no unique features, say evidence is insufficient and give zero candidates.",
    "Low-confidence honesty is always preferred over a wrong confident answer.",
    "Reject if even one major geometry clue does not match.",
    "Only mark confidence >= 95 if at least 3 independent signals agree (OCR text + building shape + road layout).",
    "Restrict every candidate to Singapore only.",
    "",
    "Singapore bounds:",
    JSON.stringify(singaporeBounds || { minLat: 1.13, maxLat: 1.47, minLng: 103.6, maxLng: 104.1 }),
    "",
    `Coin: ${coinName || "Unnamed coin"}`,
    `Piece slots present: ${pieces.map((piece) => piece.slot).join(", ") || "none"}`,
    `Piece notes: ${JSON.stringify(pieceSummary, null, 2)}`,
    `Evidence summary: ${JSON.stringify(evidenceSummary || [], null, 2)}`,
    "",
    "Return valid JSON matching the schema. Give zero candidates if the evidence is too generic.",
  ].join("\n");
}

function buildDirectImagePrompt({ context, singaporeBounds }) {
  return [
    "You are a world-class visual geolocation analyst specializing exclusively in Singapore.",
    "You are analyzing one or more uploaded photos to determine the EXACT location in Singapore where each photo was taken.",
    "",
    "=== PHASE 1: OCR EXTRACTION ===",
    "Extract ALL readable text from the image(s): HDB block numbers, street names, road signs, MRT/LRT station names,",
    "bus stop numbers, shop names/signage, school names, park names, hawker centre names, condo names, church/temple names,",
    "vehicle license plates, building numbers, postal codes. Put every extracted text string in the ocrExtracted array.",
    "",
    "=== PHASE 2: VISUAL ANALYSIS ===",
    "Analyze all visual elements that can identify a Singapore location:",
    "- Architecture: HDB block type (point block, slab, corridor), facade color/pattern, number of floors, void deck style",
    "- Infrastructure: road markings, traffic lights, lamp posts, bus shelters, MRT/LRT elevated tracks",
    "- Nature: tree species (rain trees, angsanas, palms), park connectors, canal/drain types",
    "- Urban fixtures: playground equipment, fitness corners, covered linkways, overhead bridges",
    "- Signage & branding: Singapore-specific chains (NTUC, Sheng Siong, etc.), government signs",
    "- Skyline: visible distant buildings, cranes, construction, HDB estates in background",
    "List all specific visual clues found in the visualCues array.",
    "",
    "=== PHASE 3: CANDIDATE GENERATION ===",
    "Generate location candidates. For EACH candidate:",
    "1. It MUST be in Singapore. Latitude 1.13-1.47, Longitude 103.60-104.10.",
    "2. Provide EXACT lat/lng coordinates of the specific spot, not just a general area.",
    "3. Rate confidence 0-100 strictly:",
    "   95-100: confirmed — multiple exact matches (text + building + layout)",
    "   80-94: strong — several geometry clues match",
    "   60-79: possible — some clues match but unknowns remain",
    "   <60: reject — only vague similarity",
    "4. Provide evidence breakdown for: buildingMatch, textMatch, roadLayout, vegetation, landmark, skyline.",
    "5. Suggest the best Street View camera heading (0-359°) to match the photo angle.",
    "6. Provide detailed reasoning explaining WHY this is the location.",
    "",
    "=== RULES ===",
    "- Low-confidence honesty is always preferred over a wrong confident answer.",
    "- If the image shows a generic scene with no unique identifiers, give zero candidates.",
    "- Only mark confidence >= 95 if at least 3 independent signals agree.",
    "- Give up to 5 candidates ordered from most to least confident.",
    context ? `\nAdditional context from user: ${context}` : "",
    "",
    "Singapore bounds:",
    JSON.stringify(singaporeBounds || { minLat: 1.13, maxLat: 1.47, minLng: 103.6, maxLng: 104.1 }),
    "",
    "Return valid JSON matching the schema. Give zero candidates if the evidence is too generic.",
  ].join("\n");
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  // Skip thought parts from thinking models — only take text parts without the "thought" flag
  return parts
    .filter((part) => typeof part?.text === "string" && !part?.thought)
    .map((part) => part.text)
    .join("")
    .trim();
}

function parseGeminiJson(text) {
  if (!text) return null;
  const repair = (value) => String(value || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
  const parseRepaired = (value) => {
    try {
      return JSON.parse(repair(value));
    } catch {
      return null;
    }
  };

  // Strategy 1: direct JSON parse
  const direct = parseRepaired(text);
  if (direct) return direct;
  // Strategy 2: fenced code block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = parseRepaired(fenced[1]);
    if (parsed) return parsed;
  }
  // Strategy 3: extract the widest object or array from surrounding prose.
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    const parsed = parseRepaired(text.slice(firstObject, lastObject + 1));
    if (parsed) return parsed;
  }
  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    const parsed = parseRepaired(text.slice(firstArray, lastArray + 1));
    if (parsed) return parsed;
  }
  return null;
}

async function handleSilverAiAnalyze(request, env) {
  const body = await readJson(request);
  if (!body) return textResponse("Invalid JSON body", 400);
  if (!env?.GEMINI_API_KEY) return textResponse("Missing GEMINI_API_KEY secret", 503);

  let media;
  try {
    media = normalizeMedia(body.media);
  } catch (error) {
    return textResponse(error?.message || "Media validation failed", 400);
  }

  const notes = safeString(body.notes).slice(0, 4000);
  const retrievalContext = normalizeRetrievalContext(body.retrievalContext);
  const locationContext = normalizeLocationContext(body.locationContext);
  if (!media.length && !notes.trim()) {
    return textResponse("Provide at least one image/frame or some scene notes", 400);
  }

  const prompt = buildGeminiPrompt({ notes, retrievalContext, media, locationContext });
  const contents = [{
    role: "user",
    parts: [
      ...media.map((item) => ({
        inlineData: {
          mimeType: item.mimeType,
          data: item.dataBase64,
        },
      })),
      { text: prompt },
    ],
  }];

  const model = env.GEMINI_MODEL || "gemini-3-flash-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const geminiResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        role: "system",
        parts: [{ text: "You are a careful multimodal location analyst for Sqkii silver coin hunts. Return only JSON." }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: SILVER_AI_RESPONSE_SCHEMA,
        temperature: 0.25,
        topP: 0.9,
        maxOutputTokens: 1024,
        thinkingConfig: {
          thinkingLevel: "minimal",
        },
      },
    }),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    return jsonResponse(
      {
        error: "Gemini request failed",
        status: geminiResponse.status,
        detail: errorText.slice(0, 2000),
      },
      502,
    );
  }

  const geminiPayload = await geminiResponse.json();
  const text = extractGeminiText(geminiPayload);
  const parsed = parseGeminiJson(text);
  if (!parsed) {
    return jsonResponse(
      {
        error: "Gemini returned an unreadable response",
        finishReason: geminiPayload?.candidates?.[0]?.finishReason || null,
        rawText: text,
      },
      502,
    );
  }

  return jsonResponse({
    model,
    mediaCount: media.length,
    locationUsed: !!locationContext,
    result: parsed,
  });
}

async function handleJigsawPredict(request, env) {
  const body = await readJson(request);
  if (!body) return textResponse("Invalid JSON body", 400);
  if (!env?.GEMINI_API_KEY) return textResponse("Missing GEMINI_API_KEY secret", 503);

  // Support two modes: puzzle pieces OR direct images
  const isDirectMode = Array.isArray(body.directImages) && body.directImages.length > 0;

  let inlineParts = [];
  let prompt;

  if (isDirectMode) {
    // Direct image upload mode (like findpiclocation.com)
    const directImages = body.directImages.slice(0, 5);
    for (const img of directImages) {
      const base64 = safeString(img?.dataBase64);
      const mime = safeString(img?.mimeType, "image/jpeg");
      if (!base64) continue;
      inlineParts.push({ inlineData: { mimeType: mime, data: base64 } });
    }
    if (!inlineParts.length) return textResponse("Provide at least one image", 400);

    const context = safeString(body.additionalContext).slice(0, 500);
    prompt = buildDirectImagePrompt({ context, singaporeBounds: body.singaporeBounds });
  } else {
    // Puzzle pieces mode (original)
    let pieces;
    try {
      pieces = normalizeJigsawPieces(body.pieces);
    } catch (error) {
      return textResponse(error?.message || "Puzzle media validation failed", 400);
    }
    if (!pieces.length) return textResponse("Provide at least one puzzle piece image", 400);

    inlineParts = pieces.map((piece) => ({
      inlineData: { mimeType: piece.mimeType, data: piece.dataBase64 },
    }));
    prompt = buildJigsawPrompt({
      coinName: safeString(body.coinName).slice(0, 200),
      pieces,
      evidenceSummary: Array.isArray(body.evidenceSummary) ? body.evidenceSummary.slice(0, 16) : [],
      singaporeBounds: body.singaporeBounds,
    });
  }

  const contents = [{
    role: "user",
    parts: [...inlineParts, { text: prompt }],
  }];

  const model = env.GEMINI_MODEL || "gemini-3-flash-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const geminiResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        role: "system",
        parts: [{ text: "You are a conservative Singapore-only visual geolocation analyst. Return only JSON and never overclaim." }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: JIGSAW_RESPONSE_SCHEMA,
        temperature: 0.15,
        topP: 0.85,
        maxOutputTokens: 4000,
        thinkingConfig: {
          thinkingLevel: "minimal",
        },
      },
    }),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    return jsonResponse(
      {
        error: "Gemini request failed",
        status: geminiResponse.status,
        detail: errorText.slice(0, 2000),
      },
      502,
    );
  }

  const geminiPayload = await geminiResponse.json();
  const text = extractGeminiText(geminiPayload);
  const parsed = parseGeminiJson(text);
  if (!parsed) {
    return jsonResponse(
      {
        error: "Gemini returned an unreadable response",
        finishReason: geminiPayload?.candidates?.[0]?.finishReason || null,
        rawText: text,
      },
      502,
    );
  }

  return jsonResponse({
    model,
    mode: isDirectMode ? "direct" : "puzzle",
    result: parsed,
  });
}

const JIGSAW_AGENT_RESPONSE_SCHEMA = {
  type: "object",
  required: ["agent_name", "candidates", "overall_notes"],
  properties: {
    agent_name: { type: "string" },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["location_name", "lat", "lng", "confidence", "reasoning", "visual_clues", "limitations"],
        properties: {
          location_name: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reasoning: { type: "string" },
          visual_clues: { type: "array", items: { type: "string" }, maxItems: 10 },
          limitations: { type: "array", items: { type: "string" }, maxItems: 8 },
        },
      },
    },
    overall_notes: { type: "string" },
  },
};

const JIGSAW_STREETVIEW_RESPONSE_SCHEMA = {
  type: "object",
  required: [
    "verification_score",
    "best_heading",
    "best_streetview_image_index",
    "visual_match_level",
    "matching_features",
    "mismatching_features",
    "pixel_similarity_notes",
    "manual_verification_required",
  ],
  properties: {
    verification_score: { type: "integer", minimum: 0, maximum: 100 },
    best_heading: { type: "integer", minimum: 0, maximum: 315 },
    best_streetview_image_index: { type: "integer", minimum: 0, maximum: 7 },
    visual_match_level: {
      type: "string",
      enum: ["unlikely_match", "weak_match", "possible_match", "likely_match", "strong_match"],
    },
    matching_features: { type: "array", items: { type: "string" }, maxItems: 10 },
    mismatching_features: { type: "array", items: { type: "string" }, maxItems: 10 },
    pixel_similarity_notes: { type: "string" },
    manual_verification_required: { type: "boolean" },
  },
};
const MODELS = {
  geminiMain: "gemini-3-flash-preview",
  qwenVision: "qwen/qwen2.5-vl-72b-instruct:free",
  nemotronVerifier: "nvidia/nemotron-nano-12b-v2-vl:free",
};
const OPENROUTER_QWEN_MODELS = [
  "qwen/qwen2.5-vl-72b-instruct:free",
  "qwen/qwen-2.5-vl-7b-instruct:free",
  "openrouter/free",
];
const OPENROUTER_NEMOTRON_MODELS = [
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "openrouter/free",
];

function normalizeCoinBoundary(raw = {}) {
  return {
    coin_id: safeString(raw.coin_id || raw.coinId || raw.id).trim(),
    coin_name: safeString(raw.coin_name || raw.coinName || raw.name || "Selected coin").trim() || "Selected coin",
    center_lat: Number(raw.center_lat ?? raw.centerLat ?? raw.lat),
    center_lng: Number(raw.center_lng ?? raw.centerLng ?? raw.lng),
    radius_m: Number(raw.radius_m ?? raw.radiusMeters ?? raw.radius),
  };
}

function isValidCoinBoundary(coin) {
  return Number.isFinite(coin.center_lat)
    && Number.isFinite(coin.center_lng)
    && Number.isFinite(coin.radius_m)
    && coin.radius_m > 0;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const nums = [lat1, lng1, lat2, lng2].map(Number);
  if (nums.some((value) => !Number.isFinite(value))) return Infinity;
  const toRad = (deg) => deg * Math.PI / 180;
  const [aLat, aLng, bLat, bLng] = nums;
  const earthRadiusMeters = 6371008.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validateCandidateInsideCoinCircle(candidate = {}, coin = {}) {
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lng);
  const distance = Number.isFinite(lat) && Number.isFinite(lng)
    ? haversineMeters(lat, lng, coin.center_lat, coin.center_lng)
    : Infinity;
  const inside = Number.isFinite(distance) && distance <= Number(coin.radius_m);
  return {
    ...candidate,
    lat,
    lng,
    inside_radius: inside,
    distance_from_coin_center_m: Number.isFinite(distance) ? Math.round(distance * 10) / 10 : null,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fetchImageAsInlineData(imageUrl, label = "image") {
  if (!imageUrl) throw new Error("Upload at least one puzzle piece or upload a full image.");
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "sqkiimapper-jigsaw-ai/1.0" },
  });
  if (!response.ok) throw new Error(`Could not fetch ${label} image.`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  if (!mimeType.startsWith("image/")) throw new Error(`${label} URL did not return an image.`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_INLINE_BYTES) throw new Error(`${label} image is too large for AI analysis.`);
  return {
    inlineData: {
      mimeType,
      data: arrayBufferToBase64(buffer),
    },
  };
}

function normalizeAgentOutput(parsed, fallbackAgentName) {
  const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  return {
    agent_name: safeString(parsed?.agent_name, fallbackAgentName) || fallbackAgentName,
    candidates: candidates.slice(0, 3).map((candidate) => ({
      location_name: safeString(candidate?.location_name || candidate?.name, "Candidate area").slice(0, 220),
      lat: Number(candidate?.lat),
      lng: Number(candidate?.lng),
      confidence: Math.max(0, Math.min(1, Number(candidate?.confidence) || 0)),
      reasoning: safeString(candidate?.reasoning).slice(0, 1600),
      visual_clues: Array.isArray(candidate?.visual_clues) ? candidate.visual_clues.slice(0, 10).map((item) => safeString(item)).filter(Boolean) : [],
      limitations: Array.isArray(candidate?.limitations) ? candidate.limitations.slice(0, 8).map((item) => safeString(item)).filter(Boolean) : [],
    })).filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)),
    overall_notes: safeString(parsed?.overall_notes).slice(0, 1600),
  };
}

function failedAgent(agentName, message) {
  return {
    agent_name: agentName,
    candidates: [],
    overall_notes: message,
    failed: true,
    error: message,
  };
}

function buildMainJigsawPrompt({ image_url, notes, coin }) {
  return [
    "You are analysing a public Singapore coin-hunting puzzle image.",
    "",
    "Your task:",
    "Suggest likely public locations for the image, but only inside the selected coin search radius.",
    "",
    "Hard constraints:",
    "- Country: Singapore only.",
    `- Selected coin centre: ${coin.center_lat}, ${coin.center_lng}`,
    `- Selected coin radius: ${coin.radius_m} metres`,
    "- Do not suggest candidates outside this circle.",
    "- If unsure, still provide your best public-location guesses inside the selected coin radius when possible.",
    "- Do not identify people, private homes, schools, workplaces, or routines.",
    "- Use only public visual clues.",
    "",
    "Look for:",
    "- HDB blocks",
    "- parks",
    "- roads and road geometry",
    "- MRT / LRT tracks",
    "- bridges",
    "- shelters",
    "- shopfronts",
    "- signs",
    "- terrain",
    "- skyline",
    "- greenery",
    "- water bodies",
    "- distinctive building shapes",
    "- public infrastructure",
    "",
    `Image URL for reference only: ${image_url}`,
    `Notes: ${notes || "None provided."}`,
    "",
    "Return structured JSON only:",
    JSON.stringify({
      agent_name: "...",
      candidates: [{
        location_name: "...",
        lat: 0,
        lng: 0,
        confidence: 0,
        reasoning: "...",
        visual_clues: ["..."],
        limitations: ["..."],
      }],
      overall_notes: "...",
    }, null, 2),
  ].join("\n");
}

function buildNemotronPrompt({ image_url, notes, coin }) {
  return [
    "You are the verifier and disagreement resolver for a Singapore public coin-hunting geolocation task.",
    "",
    "You are given a puzzle image, notes, and the selected coin radius.",
    "",
    "Your task:",
    "- Generate likely candidates inside the selected coin circle.",
    "- Challenge weak assumptions.",
    "- Prefer candidates with public visual evidence.",
    "- Explain what visual clues support and weaken each candidate.",
    "- Do not suggest anything outside the radius.",
    "- If unsure, still provide your best public-location guesses inside the selected coin radius when possible.",
    "- Do not identify people, private homes, schools, workplaces, or routines.",
    "",
    `Country: Singapore only.`,
    `Selected coin centre: ${coin.center_lat}, ${coin.center_lng}`,
    `Selected coin radius: ${coin.radius_m} metres`,
    `Image URL for reference only: ${image_url}`,
    `Notes: ${notes || "None provided."}`,
    "",
    "Return structured JSON only using the candidate schema.",
  ].join("\n");
}

async function geminiJsonRequest({ env, model, systemText, parts, schema, maxOutputTokens = 2500, temperature = 0.2 }) {
  if (!env?.GEMINI_API_KEY) {
    const error = new Error("AI service key missing on server.");
    error.status = 503;
    throw error;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        role: "system",
        parts: [{ text: systemText }],
      },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        temperature,
        topP: 0.9,
        maxOutputTokens,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini analysis unavailable. ${detail.slice(0, 400)}`);
  }

  const payload = await response.json();
  const text = extractGeminiText(payload);
  const parsed = parseGeminiJson(text);
  if (!parsed) throw new Error("Model malformed response.");
  return parsed;
}

async function geminiVisionAgentBackend({ env, payload, imagePart }) {
  try {
    const parsed = await geminiJsonRequest({
      env,
      model: env.GEMINI_MODEL || MODELS.geminiMain,
      systemText: "You are a careful Singapore public geolocation analyst. Return JSON only. Never overclaim.",
      parts: [imagePart, { text: buildMainJigsawPrompt(payload) }],
      schema: JIGSAW_AGENT_RESPONSE_SCHEMA,
    });
    return normalizeAgentOutput(parsed, "gemini_3_flash");
  } catch (error) {
    return failedAgent("gemini_3_flash", /malformed/i.test(error?.message) ? "Model malformed response." : "Gemini analysis unavailable.");
  }
}

function extractOpenRouterText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").join("").trim();
  }
  return "";
}

function fallbackExtractAgentJsonFromText(text, agentName) {
  const source = safeString(text);
  if (!source.trim()) return null;
  const candidates = [];
  const coordinatePattern = /([A-Za-z0-9][^,\n]{4,160}?)\s*(?:\(|-|:|,)?\s*(?:lat(?:itude)?\s*[:=]?\s*)?([1]\.\d{4,})\s*[, ]+\s*(?:lng|lon|longitude)?\s*[:=]?\s*(10[34]\.\d{4,})/gi;
  let match;
  while ((match = coordinatePattern.exec(source)) && candidates.length < 3) {
    candidates.push({
      location_name: match[1].replace(/^[\s\-:*#0-9.]+/, "").trim().slice(-180) || "Candidate area",
      lat: Number(match[2]),
      lng: Number(match[3]),
      confidence: 0.45,
      reasoning: "Recovered from a non-JSON model response.",
      visual_clues: [],
      limitations: ["Model response was not valid JSON; coordinates were extracted from text."],
    });
  }
  if (!candidates.length) return null;
  return {
    agent_name: agentName,
    candidates,
    overall_notes: "Recovered candidates from malformed model text.",
  };
}

async function openrouterVisionAgent({ env, payload, model, models, agentName, prompt }) {
  if (!env?.OPENROUTER_API_KEY) {
    return failedAgent(agentName, "AI service key missing on server.");
  }
  const modelList = Array.isArray(models) && models.length ? models : [model].filter(Boolean);
  let lastError = "OpenRouter model unavailable. Try again later or switch model.";

  for (const modelId of modelList) {
    try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://wk-yeow-2024.github.io/sqkiimapper2/",
        "X-Title": "Sqkii Mapper Jigsaw AI",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "system",
            content: "Return structured JSON only. Analyze public Singapore game clue geolocation only. Never identify people or private information.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: payload.image_url } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.25,
        max_tokens: 1800,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      const unavailable = /not found|unavailable|disabled|rate|quota|model/i.test(detail) || [400, 404, 429].includes(response.status);
        lastError = unavailable ? "OpenRouter model unavailable. Try again later or switch model." : `OpenRouter analysis unavailable (${response.status}).`;
        continue;
    }

    const data = await response.json();
      const text = extractOpenRouterText(data);
      const parsed = parseGeminiJson(text) || fallbackExtractAgentJsonFromText(text, agentName);
      if (!parsed) {
        lastError = "Model malformed response.";
        continue;
      }
      return {
        ...normalizeAgentOutput(parsed, agentName),
        used_model: modelId,
      };
    } catch {
      lastError = "OpenRouter model unavailable. Try again later or switch model.";
    }
  }

  return failedAgent(agentName, lastError);
}

function flattenAgentCandidates(agentResults) {
  const flattened = [];
  for (const result of agentResults || []) {
    const agentName = result?.agent_name || "unknown_agent";
    for (const [index, candidate] of (result?.candidates || []).entries()) {
      flattened.push({
        ...candidate,
        agent_name: agentName,
        agent_rank: index + 1,
        used_model: result?.used_model || null,
      });
    }
  }
  return flattened;
}

function shouldGeocodeCandidate(candidate = {}) {
  const name = safeString(candidate.location_name);
  return /(?:\bblk\b|\bblock\b|\b\d{1,4}\b).*(?:jalan|road|rd|street|st|avenue|ave|drive|dr|crescent|close|lane|link|bukit|merah|hdb)/i.test(name)
    || /(?:jalan|road|street|avenue|drive|crescent|close|lane|link)\s+[a-z]/i.test(name);
}

async function geocodeCandidateWithGoogle(env, candidate, coin) {
  if (!env?.GOOGLE_MAPS_API_KEY || !shouldGeocodeCandidate(candidate)) return candidate;
  const query = `${candidate.location_name}, Singapore`;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("region", "sg");
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return candidate;
    const data = await response.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    const location = first?.geometry?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return candidate;

    const geocoded = {
      ...candidate,
      original_lat: Number(candidate.lat),
      original_lng: Number(candidate.lng),
      lat,
      lng,
      coordinate_source: "google_geocoding",
      geocoded_address: safeString(first?.formatted_address),
      geocode_distance_from_original_m: Number.isFinite(Number(candidate.lat)) && Number.isFinite(Number(candidate.lng))
        ? Math.round(haversineMeters(candidate.lat, candidate.lng, lat, lng) * 10) / 10
        : null,
    };
    const validated = validateCandidateInsideCoinCircle(geocoded, coin);
    return {
      ...geocoded,
      geocode_inside_selected_radius: validated.inside_radius,
      geocode_distance_from_coin_center_m: validated.distance_from_coin_center_m,
    };
  } catch {
    return candidate;
  }
}

async function validateAgentCandidates(agentResults, coin, env) {
  const flattened = flattenAgentCandidates(agentResults);
  const corrected = [];
  for (const candidate of flattened) {
    corrected.push(await geocodeCandidateWithGoogle(env, candidate, coin));
  }
  return corrected.map((candidate) => validateCandidateInsideCoinCircle(candidate, coin));
}

function distanceBetweenCandidates(a, b) {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

function groupCandidatesByProximity(validCandidates) {
  const groups = [];
  const sorted = [...validCandidates].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

  for (const candidate of sorted) {
    let group = groups.find((item) => item.members.some((member) => distanceBetweenCandidates(member, candidate) <= 200));
    if (!group) group = groups.find((item) => item.members.some((member) => distanceBetweenCandidates(member, candidate) <= 800));
    if (!group) {
      group = {
        id: `group-${groups.length + 1}`,
        representative: candidate,
        members: [],
        agents: new Set(),
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
    const samePlaceCount = group.members.filter((item) => distanceBetweenCandidates(group.representative, item) <= 200).length;
    const sameAreaCount = group.members.filter((item) => distanceBetweenCandidates(group.representative, item) <= 800).length;
    return {
      ...group,
      agents: [...group.agents],
      samePlaceCount,
      sameAreaCount,
      average_model_confidence: group.members.length ? confidenceSum / group.members.length : 0,
      location_name: group.representative.location_name || "Candidate area",
      lat: Math.round(avgLat * 1e7) / 1e7,
      lng: Math.round(avgLng * 1e7) / 1e7,
    };
  });
}

function computeConfidenceLabel(groups, validCandidates) {
  if (!validCandidates.length) return "No Valid Candidates Inside Selected Coin Radius";
  const bestAgreement = groups.reduce((max, group) => Math.max(max, group.agents.length), 0);
  if (bestAgreement >= 3) return "Very High Confidence";
  if (bestAgreement >= 2) return "Highly Accurate Candidate";
  return "No Model Agreement";
}

function streetViewUnavailable(reason = "Street View verification unavailable. Manual verification required.") {
  return {
    available: false,
    verification_score: null,
    best_heading: null,
    best_streetview_image_index: null,
    visual_match_level: "unavailable",
    matching_features: [],
    mismatching_features: [reason],
    pixel_similarity_notes: reason,
    manual_verification_required: true,
  };
}

async function fetchStreetViewImages(env, candidate) {
  if (!env?.GOOGLE_MAPS_API_KEY) return { images: [], error: "Street View verification unavailable. Manual verification required." };
  const headings = [0, 45, 90, 135, 180, 225, 270, 315];
  const images = [];
  for (const heading of headings) {
    const url = new URL("https://maps.googleapis.com/maps/api/streetview");
    url.searchParams.set("size", "640x640");
    url.searchParams.set("location", `${candidate.lat},${candidate.lng}`);
    url.searchParams.set("heading", String(heading));
    url.searchParams.set("pitch", "0");
    url.searchParams.set("fov", "80");
    url.searchParams.set("source", "outdoor");
    url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
    const response = await fetch(url.toString());
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "";
    if (!response.ok || !mimeType.startsWith("image/")) continue;
    const buffer = await response.arrayBuffer();
    images.push({
      heading,
      part: {
        inlineData: {
          mimeType,
          data: arrayBufferToBase64(buffer),
        },
      },
    });
  }
  return images.length ? { images } : { images: [], error: "Google Street View Static API failed." };
}

async function verifyCandidateWithStreetView({ env, puzzleImagePart, candidate, coin }) {
  const validated = validateCandidateInsideCoinCircle(candidate, coin);
  if (!validated.inside_radius) return streetViewUnavailable("Candidate is outside selected coin radius.");
  const { images, error } = await fetchStreetViewImages(env, candidate);
  if (!images.length) return streetViewUnavailable(error);

  const prompt = [
    "You are verifying whether a public puzzle clue image visually matches Google Street View images near a candidate location.",
    "",
    "Compare Image A, the puzzle/clue image, against the Street View images.",
    "",
    "Focus on public visual features and pixel-level visual similarity:",
    "- road geometry",
    "- camera angle",
    "- building silhouettes",
    "- facade colours",
    "- rooflines",
    "- tree lines",
    "- greenery density",
    "- pavement",
    "- railings",
    "- fences",
    "- shelters",
    "- lamp posts",
    "- MRT/LRT tracks",
    "- bridges",
    "- shopfronts",
    "- road markings",
    "- skyline composition",
    "",
    "Do not identify people, faces, licence plates, private homes, schools, workplaces, or personal routines.",
    "",
    `Candidate: ${candidate.location_name} (${candidate.lat}, ${candidate.lng})`,
    `Selected coin centre/radius: ${coin.center_lat}, ${coin.center_lng}, ${coin.radius_m}m`,
    `Street View image index to heading map: ${JSON.stringify(images.map((item, index) => ({ index, heading: item.heading })))}`,
    "",
    "Return JSON only. Always include manual_verification_required: true.",
    "Score guide: 90-100 very strong visual match, 70-89 likely match, 50-69 possible but uncertain, 30-49 weak, 0-29 unlikely.",
  ].join("\n");

  try {
    const parsed = await geminiJsonRequest({
      env,
      model: env.GEMINI_MODEL || MODELS.geminiMain,
      systemText: "You compare public Street View imagery against clue images. Return JSON only and never call a result proof.",
      parts: [
        puzzleImagePart,
        ...images.map((item) => item.part),
        { text: prompt },
      ],
      schema: JIGSAW_STREETVIEW_RESPONSE_SCHEMA,
      maxOutputTokens: 1600,
      temperature: 0.1,
    });
    const headingMap = images.map((item) => item.heading);
    const index = Math.max(0, Math.min(headingMap.length - 1, Number(parsed.best_streetview_image_index) || 0));
    return {
      available: true,
      verification_score: Math.max(0, Math.min(100, Math.round(Number(parsed.verification_score) || 0))),
      best_heading: headingMap.includes(Number(parsed.best_heading)) ? Number(parsed.best_heading) : headingMap[index],
      best_streetview_image_index: index,
      visual_match_level: safeString(parsed.visual_match_level, "possible_match"),
      matching_features: Array.isArray(parsed.matching_features) ? parsed.matching_features.slice(0, 10).map((item) => safeString(item)).filter(Boolean) : [],
      mismatching_features: Array.isArray(parsed.mismatching_features) ? parsed.mismatching_features.slice(0, 10).map((item) => safeString(item)).filter(Boolean) : [],
      pixel_similarity_notes: safeString(parsed.pixel_similarity_notes).slice(0, 1400),
      manual_verification_required: true,
    };
  } catch {
    return streetViewUnavailable("Street View verification unavailable. Manual verification required.");
  }
}

function scoreGroups({ groups, streetviewResults, coin, notes }) {
  return groups.map((group) => {
    const streetview = streetviewResults.find((item) => item.group_id === group.id)?.verification || null;
    const modelAgreementScore = Math.min(1, group.agents.length / 3);
    const avgConfidence = Math.max(0, Math.min(1, Number(group.average_model_confidence || 0)));
    const streetScore = Number.isFinite(Number(streetview?.verification_score)) ? Number(streetview.verification_score) / 100 : 0;
    const radiusFit = Math.max(0, 1 - (Number(group.representative.distance_from_coin_center_m || 0) / Math.max(1, Number(coin.radius_m || 1))));
    const notesScore = notes ? 0.75 : 0.45;
    const notesRadiusScore = (radiusFit * 0.75) + (notesScore * 0.25);
    const weightedScore = (modelAgreementScore * 0.45) + (avgConfidence * 0.20) + (streetScore * 0.25) + (notesRadiusScore * 0.10);
    const modelVotes = Object.fromEntries(group.agents.map((agent) => {
      const match = group.members.find((member) => member.agent_name === agent);
      return [agent, {
        confidence: match?.confidence ?? null,
        location_name: match?.location_name || group.location_name,
      }];
    }));
    return {
      ...group,
      streetview,
      model_votes: modelVotes,
      weighted_score: Math.round(weightedScore * 1000) / 10,
      score_breakdown: {
        model_agreement: Math.round(modelAgreementScore * 45 * 10) / 10,
        average_model_confidence: Math.round(avgConfidence * 20 * 10) / 10,
        streetview_visual_match: Math.round(streetScore * 25 * 10) / 10,
        notes_radius_fit: Math.round(notesRadiusScore * 10 * 10) / 10,
      },
      label: group.agents.length >= 3 ? "3/3 inside-radius agreement" : group.agents.length >= 2 ? "2/3 inside-radius agreement" : "single-model valid candidate",
    };
  }).sort((a, b) => b.weighted_score - a.weighted_score);
}

function getSupabaseConfig(env) {
  const url = safeString(env?.SUPABASE_URL).replace(/\/+$/, "");
  const key = safeString(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_ANON_KEY);
  if (!url || !key) return null;
  return { url, key };
}

async function supabaseRest(env, path, init = {}) {
  const config = getSupabaseConfig(env);
  if (!config) throw new Error("Supabase env missing on server.");
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "apikey": config.key,
      "Authorization": `Bearer ${config.key}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 800) || "Supabase request failed.");
  if (response.status === 204) return null;
  return response.json();
}

async function createJigsawAnalysisRow(env, { puzzle_id, coin, input_type, image_url, stitched_image_url, notes }) {
  const rows = await supabaseRest(env, "jigsaw_analyses?select=*", {
    method: "POST",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify({
      puzzle_id,
      coin_id: coin.coin_id,
      input_type,
      input_image_url: image_url || null,
      stitched_image_url: stitched_image_url || null,
      notes: notes || null,
      status: "running",
    }),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function updateJigsawAnalysisRow(env, analysisId, patch) {
  if (!analysisId) return null;
  await supabaseRest(env, `jigsaw_analyses?id=eq.${encodeURIComponent(analysisId)}`, {
    method: "PATCH",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify(patch),
  });
  return { id: analysisId, ...patch };
}

async function insertJigsawCandidateRows(env, rows) {
  if (!rows.length) return;
  await supabaseRest(env, "jigsaw_candidates", {
    method: "POST",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify(rows),
  });
}

async function analyseJigsawImageBackend(input, env) {
  const coin = normalizeCoinBoundary(input.coin || {});
  if (!isValidCoinBoundary(coin)) {
    const error = new Error("This coin does not have a valid search radius.");
    error.status = 400;
    throw error;
  }
  const imageUrl = safeString(input.image_url || input.stitched_image_url);
  if (!imageUrl) {
    const error = new Error("Upload at least one puzzle piece or upload a full image.");
    error.status = 400;
    throw error;
  }
  if (!env?.GEMINI_API_KEY) {
    const error = new Error("AI service key missing on server.");
    error.status = 503;
    throw error;
  }

  const notes = safeString(input.notes).slice(0, 4000);
  const payload = {
    image_url: imageUrl,
    notes,
    coin,
    search_boundary: {
      country: "Singapore",
      center_lat: coin.center_lat,
      center_lng: coin.center_lng,
      radius_m: coin.radius_m,
    },
  };

  let analysis = null;
  let persistenceWarning = "";
  try {
    analysis = await createJigsawAnalysisRow(env, {
      puzzle_id: safeString(input.puzzle_id) || null,
      coin,
      input_type: safeString(input.input_type, "unknown"),
      image_url: imageUrl,
      stitched_image_url: safeString(input.stitched_image_url) || null,
      notes,
    });
  } catch (error) {
    persistenceWarning = error?.message || "Supabase save unavailable.";
  }

  let puzzleImagePart;
  try {
    puzzleImagePart = await fetchImageAsInlineData(imageUrl, "puzzle");
  } catch (error) {
    try {
      if (analysis?.id) {
        await updateJigsawAnalysisRow(env, analysis.id, {
          status: "failed",
          raw_result: { error: error?.message || "Could not fetch puzzle image." },
        });
      }
    } catch { /* keep original image error */ }
    throw error;
  }
  const [gemini, qwen, nemotron] = await Promise.all([
    geminiVisionAgentBackend({ env, payload, imagePart: puzzleImagePart }),
    openrouterVisionAgent({
      env,
      payload,
      models: OPENROUTER_QWEN_MODELS,
      agentName: "qwen_2_5_vl",
      prompt: buildMainJigsawPrompt(payload),
    }),
    openrouterVisionAgent({
      env,
      payload,
      models: OPENROUTER_NEMOTRON_MODELS,
      agentName: "nemotron_nano_12b_vl",
      prompt: buildNemotronPrompt(payload),
    }),
  ]);

  const agentResults = [gemini, qwen, nemotron];
  const validatedCandidates = await validateAgentCandidates(agentResults, coin, env);
  const validCandidates = validatedCandidates.filter((candidate) => candidate.inside_radius);
  const rejectedCandidates = validatedCandidates.filter((candidate) => !candidate.inside_radius);
  let groups = groupCandidatesByProximity(validCandidates);
  const preliminaryGroups = groups.map((group) => ({
    ...group,
    model_votes: Object.fromEntries(group.agents.map((agent) => [agent, true])),
    weighted_score: Math.round(((Math.min(1, group.agents.length / 3) * 0.45) + (Math.max(0, Math.min(1, group.average_model_confidence)) * 0.20)) * 1000) / 10,
  })).sort((a, b) => b.weighted_score - a.weighted_score);

  const streetviewResults = [];
  for (const group of preliminaryGroups.slice(0, 3)) {
    const verification = await verifyCandidateWithStreetView({
      env,
      puzzleImagePart,
      candidate: group.representative,
      coin,
    });
    streetviewResults.push({
      group_id: group.id,
      candidate_name: group.location_name,
      verification,
    });
  }

  groups = scoreGroups({ groups, streetviewResults, coin, notes });
  const finalLabel = computeConfidenceLabel(groups, validCandidates);
  const topCandidate = groups[0] || null;
  const finalScore = topCandidate ? topCandidate.weighted_score : 0;
  const reasoning = topCandidate
    ? `Weighted voting used only ${validCandidates.length} inside-radius candidate(s). Outside-radius guesses were rejected before scoring. Street View verification is AI-assisted and requires manual verification.`
    : "No valid candidates inside selected coin radius.";

  const rawResult = {
    analysis_payload: payload,
    agent_results: agentResults,
    rejected_outside_radius_candidates: rejectedCandidates,
    candidate_groups: groups,
    streetview_results: streetviewResults,
    final_score_breakdown: topCandidate?.score_breakdown || null,
    persistence_warning: persistenceWarning || null,
  };

  const result = {
    analysis: analysis ? { ...analysis, status: "complete", final_label: finalLabel, final_score: finalScore } : null,
    final_label: finalLabel,
    final_score: finalScore,
    top_candidate: topCandidate,
    candidate_groups: groups,
    rejected_candidates: rejectedCandidates,
    validated_candidates: validatedCandidates,
    streetview_results: streetviewResults,
    model_votes: agentResults.map((agent) => ({
      agent_name: agent.agent_name,
      failed: !!agent.failed,
      error: agent.error || null,
      candidate_count: agent.candidates?.length || 0,
      candidates: (agent.candidates || []).map((candidate) => ({
        location_name: candidate.location_name,
        confidence: candidate.confidence,
      })),
    })),
    reasoning,
    limitations: [
      "The selected coin circle is the hard prediction boundary.",
      "Street View verification is AI-assisted visual comparison, not proof.",
      "Results are approximate and require manual verification.",
      "People and private information are intentionally ignored.",
    ],
    raw_result: rawResult,
    persistence_warning: persistenceWarning || null,
  };

  try {
    if (analysis?.id) {
      await updateJigsawAnalysisRow(env, analysis.id, {
        status: "complete",
        final_label: finalLabel,
        final_score: finalScore,
        raw_result: rawResult,
      });
      const candidateRows = [
        ...groups.map((group) => ({
          analysis_id: analysis.id,
          location_name: group.location_name,
          lat: group.lat,
          lng: group.lng,
          inside_radius: true,
          distance_from_coin_center_m: group.representative.distance_from_coin_center_m,
          model_votes: group.model_votes,
          weighted_score: group.weighted_score,
          streetview_score: group.streetview?.verification_score ?? null,
          label: group.label,
          reasoning: group.representative.reasoning || reasoning,
        })),
        ...rejectedCandidates.map((candidate) => ({
          analysis_id: analysis.id,
          location_name: candidate.location_name,
          lat: candidate.lat,
          lng: candidate.lng,
          inside_radius: false,
          distance_from_coin_center_m: candidate.distance_from_coin_center_m,
          model_votes: { [candidate.agent_name || "unknown_agent"]: true },
          weighted_score: 0,
          streetview_score: null,
          label: "outside_radius",
          reasoning: "Rejected because it is outside the selected coin circle.",
        })),
      ];
      await insertJigsawCandidateRows(env, candidateRows);
    }
  } catch (error) {
    result.persistence_warning = error?.message || "Supabase save unavailable.";
    result.raw_result.persistence_warning = result.persistence_warning;
  }

  return result;
}

async function handleJigsawAnalyse(request, env) {
  const body = await readJson(request);
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);
  try {
    return jsonResponse(await analyseJigsawImageBackend(body, env));
  } catch (error) {
    return jsonResponse(
      {
        error: error?.message || "Jigsaw analysis failed.",
        ui_error: error?.message || "Jigsaw analysis failed.",
      },
      error?.status || 500,
    );
  }
}

async function handleProxyRequest(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse("Only GET/HEAD supported", 405);
  }

  const incoming = new URL(request.url);
  const rawUrl = incoming.searchParams.get("url");
  if (!rawUrl) return textResponse("Missing ?url=");

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return textResponse("Invalid url");
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return textResponse("Host not allowed", 403);
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: { "User-Agent": "sqkiimapper-proxy/1.0" },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: withCors(upstream.headers),
    });
  } catch (err) {
    return textResponse(`Upstream fetch failed: ${String(err?.message || err)}`, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    const incoming = new URL(request.url);
    if (incoming.pathname === "/api/silver-ai/analyze") {
      if (request.method !== "POST") return textResponse("Only POST supported", 405);
      return handleSilverAiAnalyze(request, env);
    }

    if (incoming.pathname === "/api/jigsaw/predict") {
      if (request.method !== "POST") return textResponse("Only POST supported", 405);
      return handleJigsawPredict(request, env);
    }

    if (incoming.pathname === "/api/jigsaw/analyse") {
      if (request.method !== "POST") return textResponse("Only POST supported", 405);
      return handleJigsawAnalyse(request, env);
    }

    return handleProxyRequest(request);
  },
};
