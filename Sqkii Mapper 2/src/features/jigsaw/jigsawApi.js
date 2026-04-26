import { openaiVisionAgent, geminiVisionAgent, singaporeReferenceAgent } from './jigsawAgents.js';
import { normalizeCoin } from './jigsawUtils.js';
import { runWeightedVoting } from './jigsawVoting.js';

const PIECES_BUCKET = 'jigsaw-pieces';
const STITCHED_BUCKET = 'jigsaw-stitched-boards';
const ANALYSIS_UPLOADS_BUCKET = 'jigsaw-analysis-uploads';

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
  assertSupabase(supabase);
  const c = normalizeCoin(coin);
  const { data: analysis, error: insertError } = await supabase
    .from('jigsaw_analyses')
    .insert({
      puzzle_id,
      coin_id: c.coin_id,
      input_type,
      input_image_url: image_url || null,
      stitched_image_url: stitched_image_url || null,
      notes: notes || null,
      status: 'running'
    })
    .select('*')
    .single();
  if (insertError) throw insertError;

  const payload = {
    image_url: image_url || stitched_image_url,
    notes,
    coin: c,
    search_boundary: {
      country: 'Singapore',
      center_lat: c.center_lat,
      center_lng: c.center_lng,
      radius_m: c.radius_m
    }
  };

  onProgress?.('OpenAI Vision scanning selected coin circle...');
  const openai = await openaiVisionAgent(payload);
  onProgress?.('Gemini Vision checking only inside-radius options...');
  const gemini = await geminiVisionAgent(payload);
  onProgress?.('Singapore Reference Search rejecting out-of-circle matches...');
  const reference = await singaporeReferenceAgent(payload);
  onProgress?.('Running deterministic radius validation and weighted voting...');

  const agentResults = [openai, gemini, reference];
  const result = await runWeightedVoting({
    agentResults,
    coin: c,
    notes,
    inputImageUrl: payload.image_url
  });

  const rawResult = { agentResults, ...result };
  const { error: updateError } = await supabase
    .from('jigsaw_analyses')
    .update({
      status: 'complete',
      final_label: result.final_label,
      final_score: result.final_score,
      raw_result: rawResult
    })
    .eq('id', analysis.id);
  if (updateError) throw updateError;

  const candidateRows = [
    ...result.candidate_groups.map((group) => ({
      analysis_id: analysis.id,
      location_name: group.location_name,
      lat: group.lat,
      lng: group.lng,
      inside_radius: true,
      distance_from_coin_center_m: group.representative.distance_from_coin_center_m,
      model_votes: group.model_votes,
      weighted_score: group.weighted_score,
      streetview_score: group.streetview?.verification_score || null,
      label: group.label,
      reasoning: result.reasoning
    })),
    ...result.rejected_candidates.map((candidate) => ({
      analysis_id: analysis.id,
      location_name: candidate.location_name,
      lat: candidate.lat,
      lng: candidate.lng,
      inside_radius: false,
      distance_from_coin_center_m: candidate.distance_from_coin_center_m,
      model_votes: { [candidate.agent_name || 'Unknown agent']: true },
      weighted_score: 0,
      streetview_score: null,
      label: 'outside_radius',
      reasoning: 'Rejected because it is outside the selected coin circle.'
    }))
  ];

  if (candidateRows.length) {
    const { error: rowsError } = await supabase.from('jigsaw_candidates').insert(candidateRows);
    if (rowsError) throw rowsError;
  }

  return { analysis: { ...analysis, status: 'complete' }, ...result, raw_result: rawResult };
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
