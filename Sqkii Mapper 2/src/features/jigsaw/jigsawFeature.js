import {
  analyseJigsawImage,
  fetchPuzzlePieces,
  getOrCreatePuzzle,
  savePuzzlePiece,
  saveSelectedCandidate,
  stitchBoardImage,
  updatePuzzle,
  uploadAnalysisImage
} from './jigsawApi.js';
import { escapeHtml, isValidCoinBoundary, normalizeCoin } from './jigsawUtils.js';

const state = {
  supabase: null,
  mapleaf: null,
  mapgl: null,
  getActiveCoin: null,
  getLiveCoins: null,
  coin: null,
  puzzle: { grid_rows: 16, grid_cols: 16 },
  pieces: [],
  selectedFile: null,
  latestResult: null,
  workspaceMap: null,
  overlayMap: null,
  overlayStreetView: null,
  googleMapsPromise: null,
  scanGlobe: null,
  globeGlPromise: null,
  analysisPhase: 'idle',
  analysisStartedAt: 0,
  analysisMinSequenceMs: 4200,
  analysisPendingResult: null,
  analysisRevealTimer: null,
  googleMapOverlays: {
    workspace: [],
    overlay: []
  },
  currentRow: 0,
  currentCol: 0
};

const PUBLIC_BASE_URL = import.meta.env?.BASE_URL || '/';
const DEFAULT_GOOGLE_MAPS_API_KEY = 'AIzaSyAgZehd9LWQS0qnmOLSj0affmL546rRY0M';

function publicAssetUrl(path) {
  const base = PUBLIC_BASE_URL.endsWith('/') ? PUBLIC_BASE_URL : `${PUBLIC_BASE_URL}/`;
  return `${base}${String(path || '').replace(/^\/+/, '')}`;
}

function byId(id) {
  return document.getElementById(id);
}

function formatCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(6) : 'n/a';
}

function formatRadius(value) {
  const m = Number(value || 0);
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function getPieceAt(row, col) {
  return (state.pieces || []).find((piece) =>
    Number(piece.row_index) === Number(row) &&
    Number(piece.col_index) === Number(col)
  );
}

function setSelectedCell(row, col) {
  const rows = Number(state.puzzle?.grid_rows) || 4;
  const cols = Number(state.puzzle?.grid_cols) || 4;

  state.currentRow = Math.max(0, Math.min(rows - 1, Number(row) || 0));
  state.currentCol = Math.max(0, Math.min(cols - 1, Number(col) || 0));

  updateSelectedCellUI();
}

function googleMapsApiKey() {
  return String(
    import.meta.env?.VITE_GOOGLE_MAPS_API_KEY
    || window.SQKII_GOOGLE_MAPS_API_KEY
    || localStorage.getItem('sqkii_google_maps_api_key')
    || DEFAULT_GOOGLE_MAPS_API_KEY
    || ''
  ).trim();
}

function loadGoogleMapsApi() {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (state.googleMapsPromise) return state.googleMapsPromise;

  const key = googleMapsApiKey();
  if (!key) {
    return Promise.reject(new Error('Google Maps API key missing. Set VITE_GOOGLE_MAPS_API_KEY or localStorage sqkii_google_maps_api_key.'));
  }

  state.googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jigsaw-google-maps="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google.maps), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Maps API failed to load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.jigsawGoogleMaps = '1';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error('Google Maps API failed to load.'));
    document.head.appendChild(script);
  });
  return state.googleMapsPromise;
}

function loadGlobeGlApi() {
  if (window.Globe) return Promise.resolve(window.Globe);
  if (state.globeGlPromise) return state.globeGlPromise;

  state.globeGlPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jigsaw-globe-gl="1"]');

    if (existing) {
      existing.addEventListener('load', () => resolve(window.Globe), { once: true });
      existing.addEventListener('error', () => reject(new Error('Globe.gl failed to load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.dataset.jigsawGlobeGl = '1';
    script.async = true;
    script.defer = true;
    script.src = 'https://unpkg.com/globe.gl';

    script.onload = () => {
      if (window.Globe) resolve(window.Globe);
      else reject(new Error('Globe.gl loaded but window.Globe is unavailable.'));
    };

    script.onerror = () => reject(new Error('Globe.gl failed to load.'));

    document.head.appendChild(script);
  });

  return state.globeGlPromise;
}

function setStatus(message, isError = false) {
  const el = byId('jigsaw-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!isError);
}

function injectShell() {
  if (byId('jigsaw-workspace-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="jigsaw-workspace-modal" class="modal jigsaw-modal">
      <div class="jigsaw-workspace-card">
        <button id="jigsaw-close" class="style-editor-x jigsaw-close" aria-label="Close Sqkii Jigsaw Analyser">×</button>
        <div id="jigsaw-workspace-root"></div>
      </div>
    </div>
    <div id="jigsaw-predict-modal" class="modal jigsaw-choice-modal">
      <div class="modal-card jigsaw-choice-card">
        <button id="jigsaw-predict-close" class="style-editor-x jigsaw-close" aria-label="Close prediction options">×</button>
        <h3>Predict Location</h3>
        <p class="jigsaw-muted">Choose the input image for the radius-bounded analysis.</p>
        <input id="jigsaw-full-image-input" type="file" accept="image/*" hidden />
        <div class="jigsaw-choice-actions">
          <button id="jigsaw-use-board" class="btn jigsaw-primary">Use current board image</button>
          <button id="jigsaw-upload-full" class="btn">Upload full image</button>
        </div>
        <div class="jigsaw-safety-note">For public Singapore game clues only. AI results are approximate and require manual verification.</div>
      </div>
    </div>
    <div id="jigsaw-coin-picker-modal" class="modal jigsaw-choice-modal">
      <div class="modal-card jigsaw-choice-card jigsaw-coin-picker-card">
        <button id="jigsaw-coin-picker-close" class="style-editor-x jigsaw-close" aria-label="Close coin picker">×</button>
        <h3>Select Live Coin</h3>
        <p class="jigsaw-muted">Choose the live silver coin circle Jigsaw AI should be bounded to.</p>
        <div id="jigsaw-coin-picker-list" class="jigsaw-coin-picker-list"></div>
      </div>
    </div>
    <div id="jigsaw-analysis-overlay" class="modal jigsaw-analysis-modal">
      <div class="jigsaw-analysis-card">
        <button id="jigsaw-analysis-close" class="style-editor-x jigsaw-close" aria-label="Close analysis">×</button>
        <div id="jigsaw-analysis-root"></div>
      </div>
    </div>
  `);

  byId('jigsaw-close')?.addEventListener('click', closeWorkspace);
  byId('jigsaw-predict-close')?.addEventListener('click', closePredictModal);
  byId('jigsaw-analysis-close')?.addEventListener('click', closeAnalysisOverlay);
  byId('jigsaw-coin-picker-close')?.addEventListener('click', closeCoinPicker);
  byId('jigsaw-use-board')?.addEventListener('click', () => runPredictionFromBoard());
  byId('jigsaw-upload-full')?.addEventListener('click', () => byId('jigsaw-full-image-input')?.click());
  byId('jigsaw-full-image-input')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) runPredictionFromFullImage(file);
    event.target.value = '';
  });
}

function showModal(id) {
  byId(id)?.classList.add('visible');
  document.body.classList.add('q-body--prevent-scroll');
}

function hideModal(id) {
  byId(id)?.classList.remove('visible');
  if (!document.querySelector('.modal.visible')) document.body.classList.remove('q-body--prevent-scroll');
}

function closeWorkspace() {
  hideModal('jigsaw-workspace-modal');
}

function closePredictModal() {
  hideModal('jigsaw-predict-modal');
}

function closeAnalysisOverlay() {
  hideModal('jigsaw-analysis-overlay');

  clearTimeout(state.analysisRevealTimer);
  state.analysisRevealTimer = null;
  state.analysisPendingResult = null;
  state.analysisPhase = 'idle';

  try {
    if (state.scanGlobe?.pauseAnimation) {
      state.scanGlobe.pauseAnimation();
    }

    if (state.scanGlobe?._destructor) {
      state.scanGlobe._destructor();
    }
  } catch (error) {
    console.warn('[Jigsaw] Globe cleanup skipped', error);
  }

  state.scanGlobe = null;

  const root = byId('jigsaw-analysis-root');
  if (root) {
    root.dataset.rendered = '';
    root.innerHTML = '';
  }
}

function closeCoinPicker() {
  hideModal('jigsaw-coin-picker-modal');
}

function renderWorkspace() {
  const root = byId('jigsaw-workspace-root');
  if (!root || !state.coin || !state.puzzle) return;

  const coin = state.coin;
  const puzzle = state.puzzle;
  const rows = Number(puzzle.grid_rows) || 4;
  const cols = Number(puzzle.grid_cols) || 4;
  const totalPieces = rows * cols;
  const savedPieces = state.pieces.length;
  const latestLabel = state.latestResult?.final_label || 'Not analysed';

  root.innerHTML = `
    <header class="jigsaw-tactical-header jigsaw-polished-header">
      <div class="jigsaw-tactical-title">
        <div class="jigsaw-title-row">
          <h1>Sqkii Jigsaw Analyser</h1>
          <span class="jigsaw-coin-chip">${escapeHtml(coin.coin_name || 'Selected Coin')}</span>
        </div>
        <div class="jigsaw-network-sync">
          <span class="jigsaw-pulse-dot"></span>
          <span class="jigsaw-sync-text">Network Sync: Established</span>
          <span class="jigsaw-sync-separator">|</span>
          <span class="jigsaw-sync-text">Selected coin radius only</span>
        </div>
      </div>

      <div class="jigsaw-tactical-status-area">
        <div class="jigsaw-status-stack">
          <span id="jigsaw-status-label" class="jigsaw-status-label">
            Status: ${savedPieces} / ${totalPieces} Pieces Saved
          </span>
          <span class="jigsaw-status-subline">${escapeHtml(latestLabel)} · ${escapeHtml(formatRadius(coin.radius_m))} boundary</span>
        </div>
        <div class="jigsaw-progress-track">
          <div
            id="jigsaw-progress-fill"
            class="jigsaw-progress-fill"
            style="width: ${totalPieces ? (savedPieces / totalPieces) * 100 : 0}%;"
          ></div>
        </div>
      </div>
    </header>

    <div class="jigsaw-tactical-layout jigsaw-workspace-layout-polished">
      <section class="jigsaw-tactical-left">
        <div class="jigsaw-bracket-panel jigsaw-grid-panel jigsaw-board-panel">
          <div class="jigsaw-board-topbar">
            <div><h3>Puzzle Board</h3><p>Pieces are stitched by grid position before AI analysis.</p></div>
            <div class="jigsaw-board-meta"><span>Grid: ${rows} × ${cols}</span><span id="jigsaw-selected-cell-label">Selected: R${state.currentRow} C${state.currentCol}</span><span id="jigsaw-pieces-count-label">${savedPieces} / ${totalPieces}</span></div>
          </div>
          <div class="jigsaw-board-stage">
            <div class="jigsaw-grid-container">
              <div class="jigsaw-scanline"></div>
              <div id="jigsaw-grid" class="jigsaw-grid" style="--rows:${rows};--cols:${cols}">
                ${renderGridCells()}
                <div class="jigsaw-grid-overlay" aria-hidden="true">
                  <svg class="jigsaw-cut-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <defs>
                      <filter id="jigsawSelectionGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter>
                      <g id="jigsaw-piece-clip-defs">
                        ${renderPieceClips(rows, cols)}
                      </g>
                    </defs>

                    <g id="jigsaw-piece-image-layer">
                      ${renderPieceImages(rows, cols)}
                    </g>

                    <g class="jigsaw-selected-piece-layer" aria-hidden="true">
                      <path
                        id="jigsaw-selected-piece-glow"
                        d="${getPiecePath(rows, cols, state.currentRow, state.currentCol)}"
                        class="jigsaw-selected-piece-glow"
                      ></path>
                      <path
                        id="jigsaw-selected-piece-shape"
                        d="${getPiecePath(rows, cols, state.currentRow, state.currentCol)}"
                        class="jigsaw-selected-piece-shape"
                      ></path>
                    </g>
                  </svg>
                  <div
                    id="jigsaw-selected-piece-label"
                    class="jigsaw-sel-label"
                    style="left: ${(state.currentCol / cols) * 100}%; top: ${(state.currentRow / rows) * 100}%"
                  >
                    SEL
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="jigsaw-board-footer"><span>Click a cell to target placement.</span><span>Upload or paste image, then save.</span><span>AI search remains locked to the selected coin circle.</span></div>
        </div>
      </section>

      <aside class="jigsaw-tactical-right jigsaw-control-console">
        <div class="jigsaw-bracket-panel jigsaw-action-panel jigsaw-ai-scan-panel">
          <div class="jigsaw-action-glow"></div>
          <div class="jigsaw-action-header"><div><h4>AI Location Scan</h4><p>Prediction is locked to the selected coin circle.</p></div></div>
          <button id="jigsaw-predict" class="btn jigsaw-btn-tactical jigsaw-predict-main"><span class="jigsaw-btn-icon" aria-hidden="true">⌖</span><span class="jigsaw-btn-copy"><strong>Predict Location</strong><small>Scan selected coin radius</small></span></button>
        </div>
        <div class="jigsaw-bracket-panel jigsaw-ingest-panel">
          <div class="jigsaw-panel-header"><h3>Data Ingestion</h3><p>Save one revealed puzzle piece to the selected grid cell.</p></div>
          <input id="jigsaw-piece-input" type="file" accept="image/*" hidden />
          <div class="jigsaw-upload-actions">
            <button id="jigsaw-pick-piece" class="btn jigsaw-btn-outline" type="button">
              Upload or Paste Image
            </button>

            <button
              id="jigsaw-clear-piece"
              class="btn jigsaw-btn-outline jigsaw-clear-btn"
              type="button"
              ${state.selectedFile || getPieceAt(state.currentRow, state.currentCol) ? '' : 'disabled'}
            >
              ${state.selectedFile
                ? 'Clear Upload'
                : getPieceAt(state.currentRow, state.currentCol)
                  ? 'Remove Cell Piece'
                  : 'Clear Picture'}
            </button>
          </div>

          <div id="jigsaw-piece-preview" class="jigsaw-piece-preview">
            ${
              state.selectedFile
                ? escapeHtml(state.selectedFile.name)
                : getPieceAt(state.currentRow, state.currentCol)
                  ? `Saved piece in R${state.currentRow} C${state.currentCol}`
                  : 'No image selected'
            }
          </div>
          <div class="jigsaw-form-grid">
            <label>Grid<select id="jigsaw-grid-size" class="jigsaw-tactical-input">${[4, 6, 8, 16].map((size) => `<option value="${size}" ${Number(puzzle.grid_rows) === size && Number(puzzle.grid_cols) === size ? 'selected' : ''}>${size} × ${size}</option>`).join('')}</select></label>
            <label>Row<input id="jigsaw-row" type="number" min="0" max="${rows - 1}" value="${state.currentRow}" class="jigsaw-tactical-input" /></label>
            <label>Column<input id="jigsaw-col" type="number" min="0" max="${cols - 1}" value="${state.currentCol}" class="jigsaw-tactical-input" /></label>
          </div>
          <label class="jigsaw-notes-label">Notes for AI<textarea id="jigsaw-notes" placeholder="Looks like HDB near park..." class="jigsaw-tactical-input">${escapeHtml(puzzle.notes || '')}</textarea></label>
          <button id="jigsaw-save-piece" class="btn jigsaw-btn-tactical jigsaw-save-btn jigsaw-mt-2 ${state.selectedFile ? '' : 'is-disabled'}" ${state.selectedFile ? '' : 'disabled'}>Save Image</button>
          <div id="jigsaw-status" class="jigsaw-status"></div>
        </div>
        <div class="jigsaw-bracket-panel jigsaw-map-panel-tactical">
          <span class="jigsaw-telemetry-label">SAT.VIEW.A1</span>
          <div class="jigsaw-boundary-heading"><div><h4>Selected Boundary</h4><p>${escapeHtml(coin.coin_name || 'Selected Coin')}</p></div><span>${escapeHtml(formatRadius(coin.radius_m))}</span></div>
          <div id="jigsaw-workspace-map" class="jigsaw-map"></div>
          <div class="jigsaw-map-meta"><span>Centre ${escapeHtml(formatCoord(coin.center_lat))}, ${escapeHtml(formatCoord(coin.center_lng))}</span><span>Predictions outside this circle are rejected.</span></div>
          <button id="jigsaw-change-coin" class="btn jigsaw-btn-outline jigsaw-mt-2">Change Live Coin</button>
        </div>
      </aside>
    </div>
  `;
  bindWorkspaceEvents();
  renderWorkspaceMap();
  updateSelectedCellUI();
}

function renderGridCells() {
  const rows = Number(state.puzzle?.grid_rows) || 4;
  const cols = Number(state.puzzle?.grid_cols) || 4;
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isSelected =
        Number(row) === Number(state.currentRow) &&
        Number(col) === Number(state.currentCol);

      const hasPiece = !!getPieceAt(row, col);

      cells.push(`
        <button
          class="jigsaw-cell ${isSelected ? 'is-selected' : ''} ${hasPiece ? 'has-piece' : ''}"
          data-row="${row}"
          data-col="${col}"
          title="Row ${row}, Column ${col}${hasPiece ? ' - saved piece' : ''}"
          type="button"
        >
          <span>${row},${col}</span>
        </button>
      `);
    }
  }

  return cells.join('');
}

function renderPieceClips(rows, cols) {
  return state.pieces.map(p => `
    <clipPath id="clip-p-${p.row_index}-${p.col_index}">
      <path d="${getPiecePath(rows, cols, p.row_index, p.col_index)}" />
    </clipPath>
  `).join('');
}

function renderPieceImages(rows, cols) {
  const w = 100 / cols;
  const h = 100 / rows;
  return state.pieces.map(p => `
    <image href="${escapeHtml(p.image_url)}" 
           x="${p.col_index * w - w * 0.2}" 
           y="${p.row_index * h - h * 0.2}" 
           width="${w * 1.4}" 
           height="${h * 1.4}" 
           preserveAspectRatio="xMidYMid slice"
           clip-path="url(#clip-p-${p.row_index}-${p.col_index})" />
  `).join('');
}

function bindWorkspaceEvents() {
  byId('jigsaw-pick-piece')?.addEventListener('click', () => byId('jigsaw-piece-input')?.click());
  byId('jigsaw-clear-piece')?.addEventListener('click', clearSelectedPiece);

  byId('jigsaw-piece-input')?.addEventListener('change', (event) => {
    state.selectedFile = event.target.files?.[0] || null;
    updateSelectedCellUI();
  });

  byId('jigsaw-save-piece')?.addEventListener('click', saveCurrentPiece);
  byId('jigsaw-predict')?.addEventListener('click', openPredictModal);
  byId('jigsaw-change-coin')?.addEventListener('click', openCoinPicker);

  byId('jigsaw-grid-size')?.addEventListener('change', async (event) => {
    const size = Number(event.target.value) || 4;
    try {
      state.currentRow = Math.min(state.currentRow, size - 1);
      state.currentCol = Math.min(state.currentCol, size - 1);
      state.puzzle = await updatePuzzle(state.supabase, state.puzzle.id, { grid_rows: size, grid_cols: size });
      renderWorkspace();
    } catch (error) {
      setStatus(friendlyError(error), true);
    }
  });

  byId('jigsaw-row')?.addEventListener('input', (event) => {
    setSelectedCell(Number(event.target.value || 0), state.currentCol);
  });

  byId('jigsaw-col')?.addEventListener('input', (event) => {
    setSelectedCell(state.currentRow, Number(event.target.value || 0));
  });

  byId('jigsaw-grid')?.addEventListener('click', (event) => {
    const cell = event.target.closest('.jigsaw-cell');
    if (!cell) return;

    event.preventDefault();
    event.stopPropagation();

    setSelectedCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });

  document.addEventListener('paste', handlePasteOnce, { once: true });
}

function clearSelectedPiece() {
  const existingPiece = getPieceAt(state.currentRow, state.currentCol);

  // First priority: clear pending uploaded/pasted file.
  if (state.selectedFile) {
    state.selectedFile = null;

    const input = byId('jigsaw-piece-input');
    if (input) input.value = '';

    updateSelectedCellUI();
    setStatus('Selected upload cleared.');
    return;
  }

  // Second priority: delete already-saved Supabase piece from this selected cell.
  if (existingPiece) {
    removeSavedPieceAtSelectedCell();
    return;
  }

  setStatus('No upload or saved piece to clear for this selected cell.', true);
}

function updateSelectedCellUI() {
  const rows = Number(state.puzzle?.grid_rows) || 4;
  const cols = Number(state.puzzle?.grid_cols) || 4;
  const existingPiece = getPieceAt(state.currentRow, state.currentCol);

  const rowInput = byId('jigsaw-row');
  const colInput = byId('jigsaw-col');

  if (rowInput) rowInput.value = state.currentRow;
  if (colInput) colInput.value = state.currentCol;

  document.querySelectorAll('#jigsaw-grid .jigsaw-cell').forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const hasPiece = !!getPieceAt(row, col);

    cell.classList.toggle(
      'is-selected',
      row === Number(state.currentRow) && col === Number(state.currentCol)
    );

    cell.classList.toggle('has-piece', hasPiece);
  });

  const selectedText = byId('jigsaw-selected-cell-label');
  if (selectedText) {
    selectedText.textContent = `Selected: R${state.currentRow} C${state.currentCol}`;
  }

  const preview = byId('jigsaw-piece-preview');
  if (preview) {
    if (state.selectedFile) {
      preview.textContent = state.selectedFile.name;
    } else if (existingPiece) {
      preview.textContent = `Saved piece in R${state.currentRow} C${state.currentCol}`;
    } else {
      preview.textContent = 'No image selected';
    }
  }

  const clearBtn = byId('jigsaw-clear-piece');
  if (clearBtn) {
    const canClear = !!state.selectedFile || !!existingPiece;
    clearBtn.disabled = !canClear;

    if (state.selectedFile) {
      clearBtn.textContent = 'Clear Upload';
    } else if (existingPiece) {
      clearBtn.textContent = 'Remove Cell Piece';
    } else {
      clearBtn.textContent = 'Clear Picture';
    }
  }

  const saveBtn = byId('jigsaw-save-piece');
  if (saveBtn) {
    saveBtn.disabled = !state.selectedFile;
    saveBtn.classList.toggle('is-disabled', !state.selectedFile);
  }

  const selectedPath = getPiecePath(rows, cols, state.currentRow, state.currentCol);

  const selectedShape = byId('jigsaw-selected-piece-shape');
  const selectedGlow = byId('jigsaw-selected-piece-glow');

  if (selectedShape) selectedShape.setAttribute('d', selectedPath);
  if (selectedGlow) selectedGlow.setAttribute('d', selectedPath);

  const label = byId('jigsaw-selected-piece-label');
  if (label) {
    label.style.left = `${(state.currentCol / cols) * 100}%`;
    label.style.top = `${(state.currentRow / rows) * 100}%`;
  }
}

function renderPieceOverlayOnly() {
  const rows = Number(state.puzzle?.grid_rows) || 4;
  const cols = Number(state.puzzle?.grid_cols) || 4;

  const clipsHost = byId('jigsaw-piece-clip-defs');
  const imagesHost = byId('jigsaw-piece-image-layer');

  if (clipsHost) {
    clipsHost.innerHTML = renderPieceClips(rows, cols);
  }

  if (imagesHost) {
    imagesHost.innerHTML = renderPieceImages(rows, cols);
  }

  const piecesCount = byId('jigsaw-pieces-count-label');
  if (piecesCount) {
    piecesCount.textContent = `${state.pieces.length} / ${rows * cols}`;
  }

  const statusLabel = byId('jigsaw-status-label');
  if (statusLabel) {
    statusLabel.textContent = `Status: ${state.pieces.length} / ${rows * cols} Pieces Saved`;
  }

  const progressFill = byId('jigsaw-progress-fill');
  if (progressFill) {
    progressFill.style.width = `${(state.pieces.length / (rows * cols)) * 100}%`;
  }

  updateSelectedCellUI();
}

function renderGridLines(rows, cols) {
  let paths = '';
  for (let i = 1; i < cols; i++) {
    const x = (i / cols) * 100;
    paths += `<path d="M${x},0 V100" fill="none" stroke="rgba(0, 240, 255, 0.2)" stroke-width="0.3"></path>`;
  }
  for (let i = 1; i < rows; i++) {
    const y = (i / rows) * 100;
    paths += `<path d="M0,${y} H100" fill="none" stroke="rgba(0, 240, 255, 0.2)" stroke-width="0.3"></path>`;
  }
  return paths;
}

function getPiecePath(rows, cols, r, c) {
  const w = 100 / cols;
  const h = 100 / rows;
  const x = c * w;
  const y = r * h;

  // Board-specific side pattern:
  // visual row 1 outward, row 2 inward, row 3 inward, row 4 outward.
  // Repeats for larger grids so 8x8/16x16 still has a consistent rhythm.
  const verticalRowPattern = [1, -1, -1, 1];
  const rowSign = verticalRowPattern[((r % 4) + 4) % 4];

  // Horizontal separator pattern follows row boundaries.
  // Adjust this array if the base art changes.
  const horizontalBoundaryPattern = [1, -1, 1, -1];
  const horizontalEdgeSign = (rowIndex) => horizontalBoundaryPattern[((rowIndex % 4) + 4) % 4];

  // Smaller tab size to match the base board artwork more closely.
  const tab = Math.min(w, h) * 0.09;
  const k = 0.5522847498; // cubic approximation for a circular bump/cutout

  const fmt = (n) => Number(n.toFixed(4));
  const p = [];

  const line = (lx, ly) => {
    p.push(`L ${fmt(lx)} ${fmt(ly)}`);
  };

  const cubic = (x1, y1, x2, y2, x3, y3) => {
    p.push(`C ${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x3)} ${fmt(y3)}`);
  };

  function horizontalTabLTR(edgeY, cx, sign) {
    line(cx - tab, edgeY);
    cubic(
      cx - tab,
      edgeY + sign * k * tab,
      cx - k * tab,
      edgeY + sign * tab,
      cx,
      edgeY + sign * tab
    );
    cubic(
      cx + k * tab,
      edgeY + sign * tab,
      cx + tab,
      edgeY + sign * k * tab,
      cx + tab,
      edgeY
    );
  }

  function horizontalTabRTL(edgeY, cx, sign) {
    line(cx + tab, edgeY);
    cubic(
      cx + tab,
      edgeY + sign * k * tab,
      cx + k * tab,
      edgeY + sign * tab,
      cx,
      edgeY + sign * tab
    );
    cubic(
      cx - k * tab,
      edgeY + sign * tab,
      cx - tab,
      edgeY + sign * k * tab,
      cx - tab,
      edgeY
    );
  }

  function verticalTabTTB(edgeX, cy, sign) {
    line(edgeX, cy - tab);
    cubic(
      edgeX + sign * k * tab,
      cy - tab,
      edgeX + sign * tab,
      cy - k * tab,
      edgeX + sign * tab,
      cy
    );
    cubic(
      edgeX + sign * tab,
      cy + k * tab,
      edgeX + sign * k * tab,
      cy + tab,
      edgeX,
      cy + tab
    );
  }

  function verticalTabBTT(edgeX, cy, sign) {
    line(edgeX, cy + tab);
    cubic(
      edgeX + sign * k * tab,
      cy + tab,
      edgeX + sign * tab,
      cy + k * tab,
      edgeX + sign * tab,
      cy
    );
    cubic(
      edgeX + sign * tab,
      cy - k * tab,
      edgeX + sign * k * tab,
      cy - tab,
      edgeX,
      cy - tab
    );
  }

  const cx = x + w / 2;
  const cy = y + h / 2;

  p.push(`M ${fmt(x)} ${fmt(y)}`);

  // Top edge
  if (r === 0) {
    line(x + w, y);
  } else {
    horizontalTabLTR(y, cx, horizontalEdgeSign(r - 1));
    line(x + w, y);
  }

  // Right edge
  if (c === cols - 1) {
    line(x + w, y + h);
  } else {
    verticalTabTTB(x + w, cy, rowSign);
    line(x + w, y + h);
  }

  // Bottom edge
  if (r === rows - 1) {
    line(x, y + h);
  } else {
    horizontalTabRTL(y + h, cx, horizontalEdgeSign(r));
    line(x, y + h);
  }

  // Left edge
  if (c === 0) {
    line(x, y);
  } else {
    verticalTabBTT(x, cy, rowSign);
    line(x, y);
  }

  p.push('Z');
  return p.join(' ');
}

function handlePasteOnce(event) {
  if (!byId('jigsaw-workspace-modal')?.classList.contains('visible')) return;
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith('image/'));
  if (!item) return;
  const file = item.getAsFile();
  if (!file) return;

  state.selectedFile = new File([file], `pasted-${Date.now()}.png`, {
    type: file.type || 'image/png'
  });

  updateSelectedCellUI();
  document.addEventListener('paste', handlePasteOnce, { once: true });
}

async function removeSavedPieceAtSelectedCell() {
  const row = Number(state.currentRow || 0);
  const col = Number(state.currentCol || 0);
  const piece = getPieceAt(row, col);

  if (!piece) {
    setStatus('No saved piece found in this selected cell.', true);
    return;
  }

  const ok = window.confirm(`Remove saved piece at R${row} C${col}?`);
  if (!ok) return;

  try {
    setStatus(`Removing saved piece at R${row} C${col}...`);

    let query = state.supabase
      .from('jigsaw_pieces')
      .delete();

    if (piece.id) {
      query = query.eq('id', piece.id);
    } else {
      query = query
        .eq('puzzle_id', state.puzzle.id)
        .eq('row_index', row)
        .eq('col_index', col);
    }

    const { error } = await query;

    if (error) throw error;

    state.pieces = await fetchPuzzlePieces(state.supabase, state.puzzle.id);
    state.selectedFile = null;

    renderPieceOverlayOnly();

    setStatus(`Removed saved piece at R${row} C${col}.`);
  } catch (error) {
    setStatus(`Failed to remove saved piece. ${friendlyError(error)}`, true);
  }
}

async function saveCurrentPiece() {
  if (!state.selectedFile) {
    setStatus('Choose or paste an image first.', true);
    return;
  }
  try {
    const notes = byId('jigsaw-notes')?.value || '';
    state.puzzle.notes = notes;
    setStatus('Saving image to Supabase...');
    await savePuzzlePiece(state.supabase, {
      puzzle: state.puzzle,
      coin: state.coin,
      file: state.selectedFile,
      rowIndex: Number(byId('jigsaw-row')?.value || 0),
      colIndex: Number(byId('jigsaw-col')?.value || 0),
      notes
    });
    state.selectedFile = null;

    const input = byId('jigsaw-piece-input');
    if (input) input.value = '';

    state.pieces = await fetchPuzzlePieces(state.supabase, state.puzzle.id);
    renderPieceOverlayOnly();

    setStatus('Image saved.');
  } catch (error) {
    setStatus(`Supabase upload failed. ${friendlyError(error)}`, true);
  }
}

function openPredictModal() {
  if (!state.pieces.length) {
    setStatus('Upload at least one puzzle piece or upload a full image.', true);
  }
  showModal('jigsaw-predict-modal');
}

async function runPredictionFromBoard() {
  try {
    closePredictModal();
    openAnalysisOverlay('Stitching current board...');
    const notes = byId('jigsaw-notes')?.value || state.puzzle?.notes || '';
    const stitchedUrl = await stitchBoardImage(state.supabase, {
      puzzle: state.puzzle,
      pieces: state.pieces,
      cellSize: 128
    });
    await runAnalysis({
      input_type: 'stitched_board',
      image_url: stitchedUrl,
      stitched_image_url: stitchedUrl,
      notes
    });
  } catch (error) {
    openAnalysisOverlay(friendlyError(error), true);
  }
}

async function runPredictionFromFullImage(file) {
  try {
    closePredictModal();
    openAnalysisOverlay('Uploading full image...');
    const notes = byId('jigsaw-notes')?.value || state.puzzle?.notes || '';
    const imageUrl = await uploadAnalysisImage(state.supabase, { coin: state.coin, file });
    await runAnalysis({
      input_type: 'full_upload',
      image_url: imageUrl,
      stitched_image_url: null,
      notes
    });
  } catch (error) {
    openAnalysisOverlay(friendlyError(error), true);
  }
}

async function runAnalysis({ input_type, image_url, stitched_image_url, notes }) {
  const result = await analyseJigsawImage(state.supabase, {
    puzzle_id: state.puzzle.id,
    coin: state.coin,
    input_type,
    image_url,
    stitched_image_url,
    notes,
    onProgress: (message) => {
      const status = byId('jigsaw-cinematic-status');
      if (status) status.textContent = message;
    }
  });
  state.latestResult = result;
  openAnalysisOverlay('Analysis complete.');
  renderAnalysisResult(result);
  renderWorkspace();
}

function openAnalysisOverlay() {
  const root = byId('jigsaw-analysis-root');

  if (root?.dataset.rendered === 'cinematic' || root?.dataset.rendered === 'result') {
    return;
  }

  startAnalysisCinematic();
}


function startAnalysisCinematic() {
  showModal('jigsaw-analysis-overlay');

  const root = byId('jigsaw-analysis-root');
  if (!root) return;

  state.analysisPhase = 'globe';
  state.analysisStartedAt = Date.now();
  state.analysisPendingResult = null;

  root.dataset.rendered = 'cinematic';
  root.innerHTML = analysisCinematicShellHtml();

  setTimeout(() => {
    const img = document.getElementById('jigsaw-cinematic-singapore-png');

    if (img && img.complete && img.naturalWidth > 0) {
      console.log('[Jigsaw] Singapore PNG loaded:', img.src, img.naturalWidth, img.naturalHeight);
    } else {
      console.warn('[Jigsaw] Singapore PNG not loaded. Check public/assets path.');
    }
  }, 1000);

  renderScanGlobe(true);
  setAnalysisCinematicPhase('globe');

  clearTimeout(state.analysisRevealTimer);

  // Phase 1: globe scan
  state.analysisRevealTimer = setTimeout(() => {
    if (state.analysisPhase !== 'globe') return;
    setAnalysisCinematicPhase('singapore');
  }, 4000);
}

function setAnalysisCinematicPhase(phase) {
  const wrap = byId('jigsaw-analysis-cinematic');
  const status = byId('jigsaw-cinematic-status');
  const phaseLabel = byId('jigsaw-cinematic-phase-label');

  if (!wrap) return;

  wrap.classList.remove('phase-globe', 'phase-singapore', 'phase-target');
  wrap.classList.add(`phase-${phase}`);

  state.analysisPhase = phase;

  if (phase === 'globe') {
    if (status) status.textContent = 'Scanning regional context...';
    if (phaseLabel) phaseLabel.textContent = 'GLOBE SCAN IN PROGRESS';

    const controls = state.scanGlobe?.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.28;
    }
  }

  if (phase === 'singapore') {
    if (status) status.textContent = 'Zooming into Singapore boundary...';
    if (phaseLabel) phaseLabel.textContent = 'SINGAPORE BOUNDARY LOCKED';

    // Stop rotation here so Singapore stays in view.
    const controls = state.scanGlobe?.controls?.();
    if (controls) {
      controls.autoRotate = false;
      controls.enableRotate = false;
    }
  }

  if (phase === 'target') {
    if (status) status.textContent = 'Valid inside-radius target found.';
    if (phaseLabel) phaseLabel.textContent = 'TARGET LOCATED';

    const controls = state.scanGlobe?.controls?.();
    if (controls) {
      controls.autoRotate = false;
      controls.enableRotate = false;
    }
  }
}

function finishAnalysisCinematic(result) {
  state.latestResult = result;

  const elapsed = Date.now() - state.analysisStartedAt;
  const remaining = Math.max(0, state.analysisMinSequenceMs - elapsed);

  const doReveal = () => {
    setAnalysisCinematicPhase('target');

    const target = byId('jigsaw-cinematic-target');
    if (target) target.classList.add('is-visible');

    setTimeout(() => {
      revealAnalysisResultWindow(result);
    }, 900);
  };

  if (state.analysisPhase === 'globe') {
    // Move into Singapore phase first, then reveal
    setAnalysisCinematicPhase('singapore');

    setTimeout(() => {
      setTimeout(doReveal, remaining > 900 ? remaining - 900 : 0);
    }, 900);

    return;
  }

  if (state.analysisPhase === 'singapore') {
    setTimeout(doReveal, remaining);
    return;
  }

  doReveal();
}

function revealAnalysisResultWindow(result) {
  const root = byId('jigsaw-analysis-root');
  if (!root) return;

  root.dataset.rendered = 'result';
  root.innerHTML = analysisShellHtml();

  renderOverlayMap();
  renderStreetViewPanel();
  // We don't call renderAnalysisResult here because it's already rendered in shell via state.latestResult
  // or we can call it if it does DOM injection
  const resultsPanel = byId('jigsaw-overlay-results');
  if (resultsPanel) {
    resultsPanel.innerHTML = analysisResultHtml(result);
  }

  const layout = root.querySelector('.jigsaw-analysis-layout');
  if (layout) {
    layout.classList.add('jigsaw-analysis-reveal');
    requestAnimationFrame(() => {
      layout.classList.add('is-visible');
    });
  }
}

function setAnalysisProgress(message, isError = false) {
  const progress = byId('jigsaw-analysis-progress');
  if (!progress) return;

  progress.textContent = message || 'Scanning selected coin radius...';
  progress.classList.toggle('error', !!isError);
  progress.classList.toggle('is-running', !isError && !/complete/i.test(String(message || '')));
}

function analysisCinematicShellHtml() {
  const singaporeOutlineUrl = publicAssetUrl('assets/singapore-outline-transparent-white.png');

  return `
    <div id="jigsaw-analysis-cinematic" class="jigsaw-analysis-cinematic phase-globe">
      <div class="jigsaw-cinematic-bg-grid"></div>

      <div class="jigsaw-cinematic-stage">
        <div id="jigsaw-globe-gl" class="jigsaw-cinematic-globe"></div>

        <div class="jigsaw-cinematic-scanline"></div>

        <div id="jigsaw-cinematic-singapore-wrap" class="jigsaw-cinematic-singapore-wrap" aria-hidden="true">
          <img
            id="jigsaw-cinematic-singapore-png"
            src="${escapeHtml(singaporeOutlineUrl)}"
            alt=""
            class="jigsaw-cinematic-singapore-png"
            draggable="false"
            decoding="async"
            onerror="console.warn('[Jigsaw] Singapore PNG failed:', this.src); this.style.display='none';"
          />
          <div class="jigsaw-cinematic-singapore-local-scanline"></div>
        </div>

        <div class="jigsaw-cinematic-vignette"></div>
      </div>

      <div class="jigsaw-cinematic-copy">
        <div class="jigsaw-cinematic-kicker">Radius-Bounded Analysis</div>
        <h2>${escapeHtml(state.coin?.coin_name || 'Silver Coin')}</h2>
        <p id="jigsaw-cinematic-status">Scanning regional context...</p>
      </div>

      <div class="jigsaw-cinematic-footer">
        <div class="jigsaw-cinematic-pill">
          <span class="jigsaw-cinematic-dot"></span>
          <span id="jigsaw-cinematic-phase-label">GLOBE SCAN IN PROGRESS</span>
        </div>

        <div class="jigsaw-cinematic-radius">
          ${escapeHtml(formatRadius(state.coin?.radius_m))}
        </div>
      </div>

      <div id="jigsaw-cinematic-target" class="jigsaw-cinematic-target">
        TARGET LOCATED!
      </div>
    </div>
  `;
}

function analysisShellHtml() {
  const resultHtml = state.latestResult ? analysisResultHtml(state.latestResult) : '';

  return `
    <div class="jigsaw-analysis-layout jigsaw-analysis-polished jigsaw-analysis-compact">
      <section class="jigsaw-analysis-left">
        <div class="jigsaw-analysis-command-bar">
          <div class="jigsaw-analysis-copy">
            <h2>${escapeHtml(state.coin?.coin_name || 'Silver Coin')}</h2>
          </div>

          <div class="jigsaw-globegl-module" aria-hidden="true">
            <div id="jigsaw-globe-gl" class="jigsaw-globegl-stage"></div>
            <div class="jigsaw-globegl-hud">
              <span class="jigsaw-globegl-dot"></span>
              <span>Zooming to Singapore</span>
            </div>
          </div>

          <span class="jigsaw-radius-pill">${escapeHtml(formatRadius(state.coin?.radius_m))}</span>
        </div>

        <div id="jigsaw-analysis-progress" class="jigsaw-progress jigsaw-progress-compact ${resultHtml ? '' : 'is-running'}">
          Scanning selected coin radius...
        </div>

        <div class="jigsaw-step-track" aria-label="AI analysis steps">
          <div class="jigsaw-step-pill">
            <strong>01</strong>
            <span>OpenAI</span>
          </div>
          <div class="jigsaw-step-pill">
            <strong>02</strong>
            <span>Gemini</span>
          </div>
          <div class="jigsaw-step-pill">
            <strong>03</strong>
            <span>Reference</span>
          </div>
          <div class="jigsaw-step-pill">
            <strong>04</strong>
            <span>Radius</span>
          </div>
          <div class="jigsaw-step-pill">
            <strong>05</strong>
            <span>Weighted</span>
          </div>
        </div>

        <div id="jigsaw-overlay-results" class="jigsaw-results-panel jigsaw-results-panel--priority">
          ${resultHtml || '<div class="jigsaw-empty">Final ranked candidates will appear here after the scan.</div>'}
        </div>
      </section>

      <section class="jigsaw-analysis-right">
        <div class="jigsaw-map-shell jigsaw-analysis-map-card">
          <div class="jigsaw-map-title">Selected Coin Boundary</div>
          <div id="jigsaw-overlay-map" class="jigsaw-map"></div>
        </div>

        <div class="jigsaw-streetview-shell jigsaw-analysis-map-card">
          <div class="jigsaw-map-title">Google Street View Verification</div>
          <div id="jigsaw-streetview" class="jigsaw-streetview-panel">
            Street View loads for the top valid inside-radius candidate after analysis.
          </div>
        </div>
      </section>
    </div>
  `;
}

function analysisResultHtml(result) {
  const groups = result.candidate_groups || [];
  return `
    <div class="jigsaw-result-summary">
      <strong>${escapeHtml(result.final_label)}</strong>
      <span>Score ${escapeHtml(String(result.final_score || 0))}</span>
    </div>
    <div class="jigsaw-result-copy">${escapeHtml(result.reasoning || '')}</div>
    ${result.rejected_candidates?.length ? `<div class="jigsaw-rejected-note">Some AI guesses were rejected because they were outside the selected coin's search radius.</div>` : ''}
    <div class="jigsaw-candidates">
      ${groups.length ? groups.map((group, index) => `
        <div class="jigsaw-candidate">
          <div>
            <strong>${index + 1}. ${escapeHtml(group.location_name)}</strong>
            <span>${escapeHtml(formatCoord(group.lat))}, ${escapeHtml(formatCoord(group.lng))}</span>
          </div>
          <div class="jigsaw-candidate-meta">
            <span>${escapeHtml(group.label)}</span>
            <span>Weighted ${escapeHtml(String(group.weighted_score))}</span>
            <span>Street View ${escapeHtml(String(group.streetview?.verification_score ?? 'unavailable'))}</span>
          </div>
          <button class="btn small jigsaw-select-candidate" data-index="${index}">Select Location</button>
        </div>
      `).join('') : '<div class="jigsaw-empty">No valid candidates inside selected coin radius.</div>'}
    </div>
    <details class="jigsaw-rejected-list" ${result.rejected_candidates?.length ? '' : 'hidden'}>
      <summary>Rejected outside-radius guesses</summary>
      ${(result.rejected_candidates || []).map((candidate) => `<div>${escapeHtml(candidate.location_name)} (${escapeHtml(String(candidate.distance_from_coin_center_m))} m)</div>`).join('')}
    </details>
  `;
}

function bindAnalysisResultActions(result) {
  const root = byId('jigsaw-overlay-results');
  if (!root) return;
  const groups = result.candidate_groups || [];
  root.querySelectorAll('.jigsaw-select-candidate').forEach((button) => {
    button.addEventListener('click', async () => {
      const candidate = groups[Number(button.dataset.index)];
      try {
        await saveSelectedCandidate(state.supabase, {
          analysisId: result.analysis?.id,
          coin: state.coin,
          candidate,
          userNotes: state.puzzle?.notes || ''
        });
        button.textContent = 'Saved';
      } catch (error) {
        button.textContent = 'Save failed';
        console.warn('[Jigsaw] save selected candidate failed', error);
      }
    });
  });
}

function renderAnalysisResult(result) {
  finishAnalysisCinematic(result);
  bindAnalysisResultActions(result);

  setAnalysisProgress('Analysis complete.');

  renderOverlayMap();
  renderStreetViewPanel();
}

function clearGoogleOverlays(slot) {
  for (const overlay of state.googleMapOverlays[slot] || []) {
    try { overlay.setMap(null); } catch { }
  }
  state.googleMapOverlays[slot] = [];
}

function drawCoinCircleAndCandidates(map, candidates = [], slot = 'workspace') {
  if (!map || !state.coin || !window.google?.maps) return;
  clearGoogleOverlays(slot);
  const coin = state.coin;
  const maps = window.google.maps;
  const center = { lat: Number(coin.center_lat), lng: Number(coin.center_lng) };
  const bounds = new maps.LatLngBounds();
  const pushOverlay = (overlay) => {
    state.googleMapOverlays[slot].push(overlay);
    return overlay;
  };

  pushOverlay(new maps.Circle({
    map,
    center,
    radius: Number(coin.radius_m),
    strokeColor: '#22d3ee',
    strokeOpacity: 0.95,
    strokeWeight: 2,
    fillColor: '#2563eb',
    fillOpacity: 0.18
  }));

  pushOverlay(new maps.Marker({
    map,
    position: center,
    title: 'Selected coin center',
    icon: {
      path: maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: '#38bdf8',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2
    }
  }));

  const radiusDegrees = Number(coin.radius_m) / 111320;
  bounds.extend({ lat: center.lat - radiusDegrees, lng: center.lng - radiusDegrees });
  bounds.extend({ lat: center.lat + radiusDegrees, lng: center.lng + radiusDegrees });

  const validCandidates = (candidates || [])
    .filter((candidate) => candidate && Number.isFinite(Number(candidate.lat)) && Number.isFinite(Number(candidate.lng)))
    .forEach((candidate) => {
      const marker = pushOverlay(new maps.Marker({
        map,
        position: { lat: Number(candidate.lat), lng: Number(candidate.lng) },
        title: candidate.location_name || 'Candidate',
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#a78bfa',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        }
      }));
      const info = new maps.InfoWindow({
        content: `
          <strong>${escapeHtml(candidate.location_name || 'Candidate')}</strong><br>
          Score: ${escapeHtml(String(candidate.weighted_score || 'n/a'))}<br>
          Distance: ${escapeHtml(String(candidate.representative?.distance_from_coin_center_m || candidate.distance_from_coin_center_m || 'n/a'))} m<br>
          Street View: ${escapeHtml(String(candidate.streetview?.verification_score || 'n/a'))}
        `
      });
      marker.addListener('click', () => info.open({ map, anchor: marker }));
      bounds.extend(marker.getPosition());
    });

  map.fitBounds(bounds, 38);
}

async function createJigsawMap(id) {
  const el = byId(id);
  if (!el || !state.coin) return null;
  const maps = await loadGoogleMapsApi();
  const map = new maps.Map(el, {
    center: { lat: Number(state.coin.center_lat), lng: Number(state.coin.center_lng) },
    zoom: 14,
    mapTypeId: 'roadmap',
    fullscreenControl: false,
    streetViewControl: false,
    mapTypeControl: false,
    clickableIcons: false
  });
  return map;
}

function renderWorkspaceMap() {
  setTimeout(async () => {
    if (!byId('jigsaw-workspace-map')) return;
    try {
      state.workspaceMap = await createJigsawMap('jigsaw-workspace-map');
      drawCoinCircleAndCandidates(state.workspaceMap, state.latestResult?.candidate_groups || [], 'workspace');
    } catch (error) {
      renderMapError('jigsaw-workspace-map', error);
    }
  }, 60);
}

function renderOverlayMap() {
  setTimeout(async () => {
    if (!byId('jigsaw-overlay-map')) return;
    try {
      state.overlayMap = await createJigsawMap('jigsaw-overlay-map');
      drawCoinCircleAndCandidates(state.overlayMap, state.latestResult?.candidate_groups || [], 'overlay');
    } catch (error) {
      renderMapError('jigsaw-overlay-map', error);
    }
  }, 80);
}

async function renderScanGlobe(isCinematic = false) {
  const el = byId('jigsaw-globe-gl');
  if (!el) return;

  try {
    const Globe = await loadGlobeGlApi();

    el.innerHTML = '';

    const coinLat = Number(state.coin?.center_lat) || 1.3521;
    const coinLng = Number(state.coin?.center_lng) || 103.8198;

    const singaporePoint = {
      name: state.coin?.coin_name || 'Selected Coin Boundary',
      lat: coinLat,
      lng: coinLng,
      size: 0.65,
      color: 'rgba(0, 240, 255, 0.95)'
    };

    const scanOrigins = [
      { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
      { name: 'Seoul', lat: 37.5665, lng: 126.9780 },
      { name: 'Bangkok', lat: 13.7563, lng: 100.5018 },
      { name: 'Jakarta', lat: -6.2088, lng: 106.8456 },
      { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
      { name: 'Dubai', lat: 25.2048, lng: 55.2708 }
    ];

    const arcs = scanOrigins.map((origin, index) => ({
      order: index,
      startLat: origin.lat,
      startLng: origin.lng,
      endLat: singaporePoint.lat,
      endLng: singaporePoint.lng
    }));

    const points = [
      singaporePoint,
      ...scanOrigins.map((origin) => ({
        ...origin,
        size: 0.2,
        color: 'rgba(125, 244, 255, 0.58)'
      }))
    ];

    const width = el.clientWidth || (isCinematic ? 900 : 280);
    const height = el.clientHeight || (isCinematic ? 540 : 180);

    const globe = Globe()(el)
      .width(width)
      .height(height)
      .backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .showAtmosphere(true)
      .atmosphereColor('#00f0ff')
      .atmosphereAltitude(0.15)

      .pointsData(points)
      .pointLat((d) => d.lat)
      .pointLng((d) => d.lng)
      .pointColor((d) => d.color)
      .pointAltitude((d) => (d.name === singaporePoint.name ? 0.04 : 0.015))
      .pointRadius((d) => d.size)

      .arcsData(arcs)
      .arcStartLat((d) => d.startLat)
      .arcStartLng((d) => d.startLng)
      .arcEndLat((d) => d.endLat)
      .arcEndLng((d) => d.endLng)
      .arcColor(() => ['rgba(0, 240, 255, 0.2)', 'rgba(167, 139, 250, 0.82)'])
      .arcAltitude(0.24)
      .arcStroke(0.7)
      .arcDashLength(0.22)
      .arcDashGap(0.8)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime(2400)
      .arcsTransitionDuration(0)

      .pointOfView(
        {
          lat: 8,
          lng: 105,
          altitude: isCinematic ? 2.65 : 3.35
        },
        0
      );

    state.scanGlobe = globe;

    const controls = globe.controls?.();
    if (controls) {
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableRotate = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = isCinematic ? 0.28 : 0.65;
    }

    setTimeout(() => {
      if (!state.scanGlobe) return;

      state.scanGlobe.pointOfView(
        {
          lat: 4,
          lng: 104,
          altitude: isCinematic ? 1.35 : 2.35
        },
        1600
      );
    }, 600);

    setTimeout(() => {
      if (!state.scanGlobe) return;

      const controls = state.scanGlobe.controls?.();
      if (controls) {
        controls.autoRotate = false;
        controls.enableRotate = false;
      }

      state.scanGlobe.pointOfView(
        {
          lat: coinLat,
          lng: coinLng,
          altitude: isCinematic ? 0.48 : 1.65
        },
        1800
      );
    }, 2200);

    setTimeout(() => {
      if (!state.scanGlobe || !el.isConnected) return;
      state.scanGlobe
        .width(el.clientWidth || width)
        .height(el.clientHeight || height);
    }, 150);
  } catch (error) {
    el.innerHTML = `
      <div class="jigsaw-globegl-fallback">
        Globe scan unavailable
      </div>
    `;
    console.warn('[Jigsaw] Globe.gl scan failed', error);
  }
}

function renderMapError(id, error) {
  const el = byId(id);
  if (!el) return;
  el.innerHTML = `<div class="jigsaw-map-error">${escapeHtml(error?.message || error || 'Google Maps could not load.')}</div>`;
}

async function renderStreetViewPanel() {
  const el = byId('jigsaw-streetview');
  if (!el) return;
  const candidate = state.latestResult?.top_candidate || state.latestResult?.candidate_groups?.[0];
  if (!candidate) {
    el.innerHTML = '<div class="jigsaw-map-error">Street View loads for the top valid inside-radius candidate after analysis.</div>';
    return;
  }

  try {
    const maps = await loadGoogleMapsApi();
    const position = { lat: Number(candidate.lat), lng: Number(candidate.lng) };
    const service = new maps.StreetViewService();
    service.getPanorama({ location: position, radius: 80, source: maps.StreetViewSource.OUTDOOR }, (data, status) => {
      if (status !== maps.StreetViewStatus.OK || !data?.location?.latLng) {
        el.innerHTML = '<div class="jigsaw-map-error">Street View verification is unavailable for this candidate. Manual verification required.</div>';
        return;
      }
      state.overlayStreetView = new maps.StreetViewPanorama(el, {
        position: data.location.latLng,
        pov: { heading: Number(candidate.streetview?.best_heading || 90), pitch: 0 },
        zoom: 1,
        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false
      });
    });
  } catch (error) {
    el.innerHTML = `<div class="jigsaw-map-error">${escapeHtml(error?.message || error || 'Google Street View could not load.')}</div>`;
  }
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (/jigsaw_puzzles|jigsaw_pieces|jigsaw_analyses|does not exist/i.test(message)) {
    return 'Jigsaw Supabase tables are missing. Run supabase/supabase_schema_jigsaw.sql.';
  }
  if (/bucket not found|bucket.*not found|not found/i.test(message) && /bucket|storage/i.test(message)) {
    return 'Jigsaw storage buckets are missing. Re-run supabase/supabase_schema_jigsaw.sql; it now creates the buckets and storage policies.';
  }
  if (/row-level security|permission denied|not authorized|not allowed|violates row-level security/i.test(message)) {
    return 'Supabase blocked the upload. Re-run supabase/supabase_schema_jigsaw.sql to install the Jigsaw storage policies.';
  }
  if (/mime|file size|payload too large/i.test(message)) {
    return `Supabase rejected the file. Use PNG, JPEG, WEBP, or GIF under the bucket size limit. ${message}`;
  }
  if (/bucket|storage/i.test(message)) {
    return `Check Jigsaw storage setup. ${message}`;
  }
  return message;
}

async function openWorkspace(rawCoin) {
  injectShell();
  const coin = normalizeCoin(rawCoin);
  if (!coin.coin_id) coin.coin_id = `coin-${Date.now()}`;
  if (!isValidCoinBoundary(coin)) {
    alert('This coin does not have a valid search radius.');
    return;
  }
  state.coin = coin;
  showModal('jigsaw-workspace-modal');
  const root = byId('jigsaw-workspace-root');
  if (root) root.innerHTML = '<div class="jigsaw-loading">Loading Jigsaw workspace...</div>';
  try {
    state.puzzle = await getOrCreatePuzzle(state.supabase, coin);
    state.pieces = await fetchPuzzlePieces(state.supabase, state.puzzle.id);
    if (!state.pieces.length && (Number(state.puzzle.grid_rows) > 4 || Number(state.puzzle.grid_cols) > 4)) {
      state.puzzle = await updatePuzzle(state.supabase, state.puzzle.id, { grid_rows: 4, grid_cols: 4 });
    }
    renderWorkspace();
  } catch (error) {
    if (root) root.innerHTML = `<div class="jigsaw-loading error">${escapeHtml(friendlyError(error))}</div>`;
  }
}

async function openCoinPicker() {
  injectShell();
  const coins = await state.getLiveCoins?.() || [];
  const validCoins = coins.filter(isValidCoinBoundary);
  if (!validCoins.length) {
    alert('Please select a live coin first.');
    return;
  }
  if (validCoins.length === 1) {
    openWorkspace(validCoins[0]);
    return;
  }

  const list = byId('jigsaw-coin-picker-list');
  if (list) {
    list.innerHTML = validCoins.map((coin, index) => `
      <button class="jigsaw-coin-option" type="button" data-index="${index}">
        <strong>${escapeHtml(coin.coin_name || `Live coin ${index + 1}`)}</strong>
        <span>${escapeHtml(formatCoord(coin.center_lat))}, ${escapeHtml(formatCoord(coin.center_lng))}</span>
        <span>Radius ${escapeHtml(formatRadius(coin.radius_m))}</span>
      </button>
    `).join('');
    list.querySelectorAll('.jigsaw-coin-option').forEach((button) => {
      button.addEventListener('click', () => {
        const coin = validCoins[Number(button.dataset.index)];
        closeCoinPicker();
        openWorkspace(coin);
      });
    });
  }
  showModal('jigsaw-coin-picker-modal');
}

function addSilverRailButton() {
  const actions = document.querySelector('#silver-tool-rail .tool-rail-actions');
  if (!actions || byId('jigsaw-rail-open')) return;
  
  const button = document.createElement('button');
  button.id = 'jigsaw-rail-open';
  button.className = 'tool-rail-btn jigsaw-rail-btn';
  button.title = 'Jigsaw Predictor';
  button.setAttribute('aria-label', 'Jigsaw Predictor');
  
  button.innerHTML = `
    <img src="${escapeHtml(publicAssetUrl('assets/jigsaw-puzzle-piece.png'))}" alt="" />
  `;
  
  button.addEventListener('click', async () => {
    const coins = await state.getLiveCoins?.() || [];
    if (coins.length > 1) {
      openCoinPicker();
      return;
    }
    const coin = coins[0] || await state.getActiveCoin?.();
    if (!coin || !isValidCoinBoundary(coin)) {
      alert('Please select a live coin first.');
      return;
    }
    openWorkspace(coin);
  });
  actions.insertBefore(button, byId('silver-ai-open') || byId('sonar-btn'));
}

// Watch for tool rail re-renders
let railObserver = null;
function startRailObserver() {
  if (railObserver) return;
  railObserver = new MutationObserver(() => {
    addSilverRailButton();
  });
  railObserver.observe(document.body, { childList: true, subtree: true });
}

export function openJigsawWorkspace(rawCoin) {
  return openWorkspace(rawCoin);
}

export function initJigsawFeature(options = {}) {
  state.supabase = options.supabase;
  state.mapleaf = options.mapleaf;
  state.mapgl = options.mapgl;
  state.getActiveCoin = options.getActiveCoin;
  state.getLiveCoins = options.getLiveCoins;
  injectShell();
  addSilverRailButton();
  startRailObserver();
  window.SqkiiJigsaw = {
    open: openWorkspace,
    normalizeCoin
  };
}
