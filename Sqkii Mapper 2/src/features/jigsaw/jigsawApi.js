import { normalizeCoin } from './jigsawUtils.js';

const PIECES_BUCKET = 'jigsaw-pieces';
const STITCHED_BUCKET = 'jigsaw-stitched-boards';
const ANALYSIS_UPLOADS_BUCKET = 'jigsaw-analysis-uploads';
const DEFAULT_JIGSAW_API_BASE = 'https://sqkiimapper.wk-yeow-2024.workers.dev';

function assertSupabase(supabase) {
  if (!supabase) throw new Error('Supabase is not connected.');
}

function storagePath(prefix, fileName) {
  const safeName = String(fileName || 'image.png').replace(/[^\w.-]+/g, '-');
  return `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
}

async function publicUrl(supabase, bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || '';
}

function jigsawAnalyseEndpoint() {
  const configured = import.meta.env?.VITE_JIGSAW_ANALYSE_URL
    || window.SQKII_JIGSAW_ANALYSE_URL
    || '';
  if (configured) return configured;

  if (/\.workers\.dev$/i.test(window.location.hostname)) return '/api/jigsaw/analyse';
  const base = (import.meta.env?.VITE_JIGSAW_API_BASE || window.SQKII_JIGSAW_API_BASE || DEFAULT_JIGSAW_API_BASE).replace(/\/+$/, '');
  return `${base}/api/jigsaw/analyse`;
}

async function readErrorMessage(response) {
  const fallback = `Analysis request failed (${response.status}).`;
  try {
    const data = await response.json();
    return data?.ui_error || data?.error || data?.message || fallback;
  } catch {
    try {
      return await response.text() || fallback;
    } catch {
      return fallback;
    }
  }
}

export async function getOrCreatePuzzle(supabase, coin) {
  assertSupabase(supabase);
  const c = normalizeCoin(coin);
  const { data: existing, error: selectError } = await supabase
    .from('jigsaw_puzzles')
    .select('*')
    .eq('coin_id', c.coin_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('jigsaw_puzzles')
      .update({
        coin_name: c.coin_name,
        center_lat: c.center_lat,
        center_lng: c.center_lng,
        radius_m: c.radius_m,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (updateError) throw updateError;
    return updated;
  }

  const { data, error } = await supabase
    .from('jigsaw_puzzles')
    .insert({
      coin_id: c.coin_id,
      coin_name: c.coin_name,
      center_lat: c.center_lat,
      center_lng: c.center_lng,
      radius_m: c.radius_m,
      grid_rows: 4,
      grid_cols: 4
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updatePuzzle(supabase, puzzleId, patch) {
  assertSupabase(supabase);
  const { data, error } = await supabase
    .from('jigsaw_puzzles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', puzzleId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPuzzlePieces(supabase, puzzleId) {
  assertSupabase(supabase);
  const { data, error } = await supabase
    .from('jigsaw_pieces')
    .select('*')
    .eq('puzzle_id', puzzleId)
    .order('row_index', { ascending: true })
    .order('col_index', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function savePuzzlePiece(supabase, { puzzle, coin, file, rowIndex, colIndex, notes }) {
  assertSupabase(supabase);
  if (!file) throw new Error('Choose an image first.');
  const c = normalizeCoin(coin);
  const path = storagePath(`${c.coin_id}/${puzzle.id}/${rowIndex}-${colIndex}`, file.name);
  const { error: uploadError } = await supabase.storage.from(PIECES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true
  });
  if (uploadError) throw uploadError;
  const imageUrl = await publicUrl(supabase, PIECES_BUCKET, path);

  const { data, error } = await supabase
    .from('jigsaw_pieces')
    .upsert({
      puzzle_id: puzzle.id,
      coin_id: c.coin_id,
      row_index: Number(rowIndex),
      col_index: Number(colIndex),
      image_url: imageUrl,
      notes: notes || null
    }, { onConflict: 'puzzle_id,row_index,col_index' })
    .select('*')
    .single();
  if (error) throw error;
  await updatePuzzle(supabase, puzzle.id, { notes: puzzle.notes || null });
  return data;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${url}`));
    image.src = url;
  });
}

export async function stitchBoardImage(supabase, { puzzle, pieces, cellSize = 128 }) {
  assertSupabase(supabase);
  if (!pieces?.length) throw new Error('Upload at least one puzzle piece or upload a full image.');
  const canvas = document.createElement('canvas');
  const rows = Number(puzzle.grid_rows) || 4;
  const cols = Number(puzzle.grid_cols) || 4;
  canvas.width = cols * cellSize;
  canvas.height = rows * cellSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#07111d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(96,165,250,0.18)';
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      ctx.strokeRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }

  for (const piece of pieces) {
    const image = await loadImage(piece.image_url);
    ctx.drawImage(image, Number(piece.col_index) * cellSize, Number(piece.row_index) * cellSize, cellSize, cellSize);
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.92));
  if (!blob) throw new Error('Could not stitch board image.');
  const path = storagePath(`${puzzle.coin_id}/${puzzle.id}`, 'stitched-board.png');
  const { error: uploadError } = await supabase.storage.from(STITCHED_BUCKET).upload(path, blob, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: true
  });
  if (uploadError) throw uploadError;
  return await publicUrl(supabase, STITCHED_BUCKET, path);
}

export async function uploadAnalysisImage(supabase, { coin, file }) {
  assertSupabase(supabase);
  const c = normalizeCoin(coin);
  const path = storagePath(c.coin_id, file.name);
  const { error } = await supabase.storage.from(ANALYSIS_UPLOADS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type
  });
  if (error) throw error;
  return await publicUrl(supabase, ANALYSIS_UPLOADS_BUCKET, path);
}

export async function analyseJigsawImage(supabase, { puzzle_id, coin, input_type, image_url, stitched_image_url, notes, onProgress }) {
  const c = normalizeCoin(coin);
  const payload = {
    puzzle_id,
    coin: {
      coin_id: c.coin_id,
      coin_name: c.coin_name,
      center_lat: c.center_lat,
      center_lng: c.center_lng,
      radius_m: c.radius_m
    },
    input_type,
    image_url: image_url || stitched_image_url,
    stitched_image_url: stitched_image_url || null,
    notes,
  };

  onProgress?.('Sending clue image to secure AI analysis endpoint...');
  const response = await fetch(jigsawAnalyseEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  onProgress?.('AI agents finished. Validating radius, votes, and Street View evidence...');
  const result = await response.json();
  return result;
}

export async function saveSelectedCandidate(supabase, { analysisId, coin, candidate, userNotes }) {
  assertSupabase(supabase);
  const c = normalizeCoin(coin);
  const { data, error } = await supabase
    .from('jigsaw_selected_candidates')
    .insert({
      analysis_id: analysisId,
      coin_id: c.coin_id,
      candidate_id: candidate?.candidate_id || null,
      location_name: candidate?.location_name || '',
      lat: candidate?.lat ?? null,
      lng: candidate?.lng ?? null,
      user_notes: userNotes || null
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
