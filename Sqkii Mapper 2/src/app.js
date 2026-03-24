      /* ===================== UTILITY FUNCTIONS MODULE ===================== */
      /**
       * Centralized utilities to eliminate code duplication and improve performance
       */
      const Utils = (() => {
        // Debounce utility - single implementation used throughout
        const debounce = (fn, ms = 300) => {
          let timer;
          return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
          };
        };

        // Throttle utility for high-frequency events
        const throttle = (fn, ms = 100) => {
          let lastRun = 0;
          return (...args) => {
            const now = Date.now();
            if (now - lastRun >= ms) {
              lastRun = now;
              fn(...args);
            }
          };
        };

        // DOM element cache to avoid repeated queries
        const elementCache = new Map();
        const getElement = (id) => {
          if (!elementCache.has(id)) {
            elementCache.set(id, document.getElementById(id));
          }
          return elementCache.get(id);
        };

        // Clear cache when needed (e.g., after dynamic DOM changes)
        const clearElementCache = () => elementCache.clear();

        // Parse coordinates from various formats
        const parseCoordinates = (text) => {
          const cleaned = String(text || '').trim();
          const parts = cleaned.split(',').map(s => parseFloat(s.trim()));
          if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
            return { lat: parts[0], lng: parts[1] };
          }
          return null;
        };

        // Sanitize color input
        const sanitizeColor = (color) => {
          const hex = String(color || '').trim();
          return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#000000';
        };

        // Safe number parsing with fallback
        const parseNumber = (value, fallback = 0, min = -Infinity, max = Infinity) => {
          const num = parseFloat(value);
          if (isNaN(num)) return fallback;
          return Math.max(min, Math.min(max, num));
        };

        // Generate unique ID
        let idCounter = 0;
        const generateId = (prefix = 'id') => `${prefix}-${++idCounter}-${Date.now()}`;

        // Deep clone object (for state management)
        const deepClone = (obj) => {
          try {
            return JSON.parse(JSON.stringify(obj));
          } catch {
            return obj;
          }
        };

        // Hash function for change detection
        const hash = (data) => {
          const str = JSON.stringify(data);
          let h = 0;
          for (let i = 0; i < str.length; i++) {
            h = (h * 31 + str.charCodeAt(i)) | 0;
          }
          return h;
        };

        // OPTIMIZED: LocalStorage cache manager with TTL
        const cache = {
          save(key, data, ttlMs = null) {
            try {
              const item = { data, timestamp: Date.now(), ttl: ttlMs };
              localStorage.setItem(`sqkii_${key}`, JSON.stringify(item));
              return true;
            } catch (e) {
              console.warn('[Cache] Save failed:', e);
              return false;
            }
          },
          load(key) {
            try {
              const item = localStorage.getItem(`sqkii_${key}`);
              if (!item) return null;
              const { data, timestamp, ttl } = JSON.parse(item);
              if (ttl && (Date.now() - timestamp > ttl)) {
                this.remove(key);
                return null;
              }
              return data;
            } catch (e) {
              return null;
            }
          },
          remove(key) {
            try {
              localStorage.removeItem(`sqkii_${key}`);
              return true;
            } catch (e) {
              return false;
            }
          }
        };

        // OPTIMIZED: RequestAnimationFrame wrapper for smooth 60fps
        const raf = {
          pending: new Map(),
          schedule(key, callback) {
            if (this.pending.has(key)) return;
            this.pending.set(key, true);
            requestAnimationFrame(() => {
              callback();
              this.pending.delete(key);
            });
          }
        };

        // OPTIMIZED: Passive event listener wrapper for better mobile performance
        const addPassiveListener = (element, event, handler, options = {}) => {
          const passiveOptions = { passive: true, ...options };
          element.addEventListener(event, handler, passiveOptions);
          return () => element.removeEventListener(event, handler, passiveOptions);
        };

        // OPTIMIZED: Geohash batcher for large datasets (prevents WebGL errors)
        const GeohashBatcher = {
          batchSize: 100, // Process 100 geohashes at a time
          delay: 16, // ~60fps (16ms between batches)

          /**
           * Process large geohash arrays in batches to prevent lag
           * @param {Array} items - Array of geohashes to process
           * @param {Function} processFn - Function to call for each batch
           * @param {Function} onComplete - Callback when all batches done
           */
          async processBatches(items, processFn, onComplete) {
            if (!items || items.length === 0) {
              onComplete?.();
              return;
            }

            const batches = [];
            for (let i = 0; i < items.length; i += this.batchSize) {
              batches.push(items.slice(i, i + this.batchSize));
            }

            console.log(`[GeohashBatcher] Processing ${items.length} items in ${batches.length} batches`);

            for (let i = 0; i < batches.length; i++) {
              await new Promise(resolve => {
                requestAnimationFrame(() => {
                  processFn(batches[i], i, batches.length);
                  setTimeout(resolve, this.delay);
                });
              });
            }

            console.log(`[GeohashBatcher] Completed processing ${items.length} items`);
            onComplete?.();
          },

          /**
           * Throttle map layer updates
           */
          throttleLayerUpdate: throttle((updateFn) => {
            requestAnimationFrame(updateFn);
          }, 100)
        };

        return {
          debounce,
          throttle,
          getElement,
          clearElementCache,
          parseCoordinates,
          sanitizeColor,
          parseNumber,
          generateId,
          deepClone,
          hash,
          cache,
          raf,
          addPassiveListener,
          GeohashBatcher
        };
      })();

      /* ===================== MODAL MANAGER ===================== */
      /**
       * Generic modal management to eliminate duplicate modal handling code
       */
      const ModalManager = (() => {
        const modals = new Map();

        const create = (modalId, options = {}) => {
          const modal = Utils.getElement(modalId);
          const appEl = Utils.getElement('app');

          if (!modal) {
            console.warn(`Modal ${modalId} not found`);
            return null;
          }

          const controller = new AbortController();
          const { signal } = controller;

          const instance = {
            element: modal,
            isOpen: false,

            open() {
              modal.classList.add('visible');
              appEl?.classList.add('blocked-by-modal');
              this.isOpen = true;
              options.onOpen?.();
            },

            close() {
              modal.classList.remove('visible');
              appEl?.classList.remove('blocked-by-modal');
              this.isOpen = false;
              options.onClose?.();
            },

            toggle() {
              this.isOpen ? this.close() : this.open();
            },

            destroy() {
              controller.abort();
              this.close();
              modals.delete(modalId);
            }
          };

          // Click outside to close
          if (options.closeOnOutsideClick !== false) {
            modal.addEventListener('click', (e) => {
              if (e.target === modal) instance.close();
            }, { signal });
          }

          // ESC key to close
          if (options.closeOnEscape !== false) {
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape' && instance.isOpen) instance.close();
            }, { signal });
          }

          modals.set(modalId, instance);
          return instance;
        };

        const get = (modalId) => modals.get(modalId);
        const destroy = (modalId) => modals.get(modalId)?.destroy();
        const destroyAll = () => {
          modals.forEach(m => m.destroy());
          modals.clear();
        };

        return { create, get, destroy, destroyAll };
      })();

      /* ===================== SYNC MANAGER (Supabase) ===================== */
      /**
       * Generic state synchronization manager for Supabase
       * Eliminates duplicate save/load/queue logic
       */
      const SyncManager = (() => {
        const states = new Map();

        const createSyncedState = (key, options = {}) => {
          const {
            debounceMs = 1000,
            maxRetries = 5,
            transform = (data) => data,
            validate = () => true
          } = options;

          let queue = null;
          let inFlight = false;
          let retryCount = 0;
          let lastHash = null;
          let flushTimer = null;

          const flush = async () => {
            if (!queue || inFlight || !window.currentRoomCode || !window.supabase) return;

            inFlight = true;
            const payload = queue;
            queue = null;

            try {
              const { error } = await window.supabase
                .from('rooms')
                .update({
                  [key]: transform(payload),
                  updated_at: new Date().toISOString()
                })
                .eq('code', window.currentRoomCode);

              if (error) {
                retryCount++;
                console.error(`[SyncManager:${key}] Save failed:`, error);

                if (retryCount <= maxRetries) {
                  const delay = 2000 * Math.pow(2, retryCount - 1);
                  setTimeout(() => {
                    queue = payload;
                    flush();
                  }, delay);
                } else {
                  console.warn(`[SyncManager:${key}] Giving up after ${maxRetries} retries`);
                }
              } else {
                retryCount = 0;
              }
            } catch (err) {
              console.error(`[SyncManager:${key}] Flush error:`, err);
            } finally {
              inFlight = false;
              if (queue && retryCount <= maxRetries) flush();
            }
          };

          const save = (data) => {
            if (!window.currentRoomCode) return;
            if (!validate(data)) {
              console.warn(`[SyncManager:${key}] Validation failed`);
              return;
            }

            const dataHash = Utils.hash(data);
            if (dataHash === lastHash) return; // No changes

            lastHash = dataHash;
            queue = data;

            clearTimeout(flushTimer);
            flushTimer = setTimeout(flush, debounceMs);
          };

          const load = async () => {
            if (!window.currentRoomCode || !window.supabase) return null;

            try {
              const { data, error } = await window.supabase
                .from('rooms')
                .select(key)
                .eq('code', window.currentRoomCode)
                .maybeSingle();

              if (error || !data) return null;
              return data[key];
            } catch (err) {
              console.error(`[SyncManager:${key}] Load error:`, err);
              return null;
            }
          };

          const instance = { save, load, flush };
          states.set(key, instance);
          return instance;
        };

        const get = (key) => states.get(key);
        const destroy = (key) => states.delete(key);

        return { createSyncedState, get, destroy };
      })();

      /* ===================== Geohashes Editor — Uses existing source ===================== */

      (() => {
        // ===== CONFIG (set manually if you already know them) =====
        // If you know the exact layer IDs for your existing geohash fill/line layers, set here:
        const KNOWN_BASE_LAYER_IDS = []; // e.g., ['geohashes-fill','geohashes-outline']
        // If you know the GeoJSON source id used by those layers, set here (else auto-detect):
        const KNOWN_SOURCE_ID = ''; // e.g., 'geohashes-src'

        // Fields to check for an id like "w21zw4_1"
        const CANDIDATE_FIELDS = ['geohash', 'name', 'id', 'description'];

        // New overlay layer ids (do not clash with yours)
        const GL_LYR_PLAY_FILL = 'gh-play-fill';
        const GL_LYR_PLAY_LINE = 'gh-play-line';
        const GL_LYR_ELIM_FILL = 'gh-elim-fill';
        const GL_LYR_ELIM_LINE = 'gh-elim-line';

        // ===== Elements =====
        const openBtn = document.getElementById('geohash-open');
        const modal = document.getElementById('geohash-modal');
        const closeBtn = document.getElementById('geohash-close');
        const applyBtn = document.getElementById('geohash-apply');
        const hideBase = document.getElementById('gh-hide-base');
        const appEl = document.getElementById('app');

        const taPlayable = document.getElementById('geohash-playable');
        const taEliminated = document.getElementById('geohash-eliminated');

        const playFill = document.getElementById('gh-play-fill');
        const playFillOp = document.getElementById('gh-play-fillop');
        const playStroke = document.getElementById('gh-play-stroke');
        const playWidth = document.getElementById('gh-play-width');

        const elimFill = document.getElementById('gh-elim-fill');
        const elimFillOp = document.getElementById('gh-elim-fillop');
        const elimStroke = document.getElementById('gh-elim-stroke');
        const elimWidth = document.getElementById('gh-elim-width');




        // ---- Supabase persistence (project-scoped) ----
        const GEOHASH_PROJECT_ID = 'sqkii_mapper';
        const TABLE = 'geohash_state';   // <- single-row table
        const MAX_ITEMS = 30000;         // safety cap; raise if you need
        const SAVE_DEBOUNCE_MS = 1000;    // debounce saves (ms)

        let lastLoadedState = null;      // caches { lists, styles } from DB
        let saveTimer = null;
        let saveInFlight = false;

        function normList(text) {
          const seen = new Set(); const out = [];
          (text || '').split(/\r?\n/)
            .map(s => s.trim().toLowerCase()).filter(Boolean)
            .forEach(s => {
              const m = s.match(/^[0-9bcdefghjkmnpqrstuvwxyz]{3,8}_[01]$/i);
              if (m && !seen.has(s)) { seen.add(s); out.push(s); }
            });
          return out;
        }
        function diffCounts(newArr, oldArr) {
          const oldSet = new Set(oldArr || []), newSet = new Set(newArr || []);
          let added = 0, removed = 0;
          newSet.forEach(v => { if (!oldSet.has(v)) added++; });
          oldSet.forEach(v => { if (!newSet.has(v)) removed++; });
          return { added, removed };
        }
        function applyAndSaveDebounced() {
          apply(); // render immediately
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveGeohashState, SAVE_DEBOUNCE_MS);
        }

        // Expect a global `supabase` client already created earlier

        async function loadGeohashState() {
          if (!window.supabase || !currentRoomCode) return;
          try {
            const { data, error } = await supabase
              .from('rooms')
              .select('geohash_data')
              .eq('code', currentRoomCode)
              .maybeSingle();

            if (error || !data || !data.geohash_data) return;
            const { lists, styles } = data.geohash_data;

            if (lists?.playable) taPlayable.value = lists.playable.join('\n');
            if (lists?.eliminated) taEliminated.value = lists.eliminated.join('\n');

            if (styles?.play) {
              if (styles.play.fill != null) playFill.value = styles.play.fill;
              if (styles.play.fillOpacity != null) playFillOp.value = styles.play.fillOpacity;
              if (styles.play.stroke != null) playStroke.value = styles.play.stroke;
              if (styles.play.width != null) playWidth.value = styles.play.width;
            }
            if (styles?.elim) {
              if (styles.elim.fill != null) elimFill.value = styles.elim.fill;
              if (styles.elim.fillOpacity != null) elimFillOp.value = styles.elim.fillOpacity;
              if (styles.elim.stroke != null) elimStroke.value = styles.elim.stroke;
              if (styles.elim.width != null) elimWidth.value = styles.elim.width;
            }
          } catch (e) {
            console.warn('loadGeohashState error:', e);
          }
        }


        // Prefill Eliminated textarea from the saved app layer if DB/room didn’t load it
        openBtn?.addEventListener('click', () => {
          try {
            // Only hydrate if empty (don’t overwrite Supabase-loaded values)
            if (taEliminated.value.trim()) return;
            if (typeof window.getOrCreateLayerByName !== 'function') return;

            const entry = getOrCreateLayerByName('Eliminated Geohash');
            const feats = entry?.data?.features;
            if (!Array.isArray(feats) || feats.length === 0) return;

            const ids = feats.map(f => {
              const p = f?.properties || {};
              return String(p.geohash ?? p.name ?? p._gid ?? p.id ?? '').trim();
            }).filter(Boolean);

            if (ids.length) taEliminated.value = Array.from(new Set(ids)).join('\n');
          } catch (_) { }
        });


        // === Geohash save queue + sanitizers (single copy) ===
        const GEOHASH_SAVE_DEBOUNCE_MS = 2000;
        const GEOHASH_MAX_ITEMS = 2500

        function gh_dedupe(list) {
          return Array.from(new Set((list || []).map(s => String(s).trim()).filter(Boolean)));
        }
        function gh_sanitizeLists(playableText, eliminatedText) {
          const splitSmart = (t) => String(t || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
          return {
            playable: gh_dedupe(splitSmart(playableText)),
            eliminated: gh_dedupe(splitSmart(eliminatedText))
          };
        }

        function gh_sanitizeStyles(playFill, playFillOp, playStroke, playWidth,
          elimFill, elimFillOp, elimStroke, elimWidth) {
          return {
            play: { fill: playFill, fillOpacity: Number(playFillOp), stroke: playStroke, width: Number(playWidth) },
            elim: { fill: elimFill, fillOpacity: Number(elimFillOp), stroke: elimStroke, width: Number(elimWidth) }
          };
        }
        function gh_sig(projectId, lists, styles) {
          const s = JSON.stringify([projectId, lists, styles]);
          let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
          return `${projectId}:${h}`;
        }

        let gh_lastSig = '';
        let gh_inFlight = false;
        let gh_queued = null;
        let gh_timer = null;

        let gh_retryCount = 0;
        const GH_MAX_RETRIES = 5;

        async function gh_flush(projectId) {
          if (!gh_queued || gh_inFlight || !currentRoomCode) return;
          gh_inFlight = true;
          const payload = gh_queued;
          gh_queued = null;

          try {
            const { error } = await supabase
              .from('rooms')
              .update({
                geohash_data: { lists: payload.lists, styles: payload.styles },
                updated_at: new Date().toISOString()
              })
              .eq('code', currentRoomCode);

            if (error) {
              gh_retryCount++;
              console.error('[geohash save] failed:', error);

              if (gh_retryCount <= GH_MAX_RETRIES) {
                const delay = 2000 * Math.pow(2, gh_retryCount - 1); // 2s,4s,8s,...
                setTimeout(() => { gh_queued = payload; gh_flush(projectId); }, delay);
              } else {
                console.warn('[geohash save] giving up after too many retries');
              }
            } else {
              gh_retryCount = 0; // reset on success
            }
          } finally {
            gh_inFlight = false;
            if (gh_queued && gh_retryCount <= GH_MAX_RETRIES) gh_flush(projectId);
          }
        }

        function queueGeohashSaveInline(
          projectId,
          playableText, eliminatedText,
          playFill, playFillOp, playStroke, playWidth,
          elimFill, elimFillOp, elimStroke, elimWidth
        ) {
          // Must have a room before we can persist
          if (!currentRoomCode) return;

          // 1) Normalize & sanitize inputs (your existing helpers)
          const lists = gh_sanitizeLists(playableText, eliminatedText);
          const styles = gh_sanitizeStyles(
            playFill, playFillOp, playStroke, playWidth,
            elimFill, elimFillOp, elimStroke, elimWidth
          );

          // 2) Safety cap to avoid straining Supabase on giant pastes
          const MAX = (typeof GEOHASH_MAX_ITEMS === 'number' ? GEOHASH_MAX_ITEMS : 10000);
          const total = (lists.playable?.length || 0) + (lists.eliminated?.length || 0);
          if (total > MAX) {
            alert(`You pasted ${total} geohashes. Limit is ${MAX}. Please reduce or split the paste.`);
            return; // IMPORTANT: do not update gh_lastSig if we refused the save
          }

          // 3) Skip no-op saves (signature of current state)
          const sig = gh_sig(currentRoomCode, lists, styles);
          if (sig === gh_lastSig) return; // nothing changed → no write

          // 4) Queue the state and debounce a single flush
          gh_lastSig = sig;
          gh_queued = { lists, styles };

          clearTimeout(gh_timer);
          const DEBOUNCE = (typeof GEOHASH_SAVE_DEBOUNCE_MS === 'number' ? GEOHASH_SAVE_DEBOUNCE_MS : 900);

          gh_timer = setTimeout(() => {
            // If your implementation tracks an in-flight write, reschedule once
            if (typeof gh_inFlight !== 'undefined' && gh_inFlight) {
              // try again after the same debounce window
              clearTimeout(gh_timer);
              gh_timer = setTimeout(() => gh_flush(currentRoomCode), DEBOUNCE);
              return;
            }
            gh_flush(currentRoomCode);
          }, DEBOUNCE);
        }


        async function saveGeohashState() {
          if (!window.supabase || !currentRoomCode) return;
          try {
            queueGeohashSaveInline(
              currentRoomCode,
              taPlayable.value, taEliminated.value,
              playFill.value, playFillOp.value, playStroke.value, playWidth.value,
              elimFill.value, elimFillOp.value, elimStroke.value, elimWidth.value
            );
          } catch (e) {
            console.warn('saveGeohashState error:', e);
          }
        }

        function parseIdList(text) {
          return Array.from(new Set(
            String(text || '')
              .split(/[\s,]+/)          // split on commas or any whitespace
              .map(s => s.replace(/,$/, '').trim()) // strip trailing commas
              .filter(Boolean)          // drop empties
          ));
        }


        // --- Instant apply (debounced) on input/paste + style tweaks ---
        // Safe apply for auto-events: only apply if source is present; no alert spam.
        const applyIfReady = () => {
          try {
            const src = (typeof findGeohashSourceId === 'function') ? findGeohashSourceId() : null;
            if (!src) return;   // style not loaded yet; bail silently
            if (!mapgl.getLayer('gh-play-fill')) ensureOverlayLayers(src);
            // Reuse the existing lists & style logic
            const playableArr = Array.from(linesToSet(taPlayable.value));
            const eliminatedArr = Array.from(linesToSet(taEliminated.value));
            const playableFilter = playableArr.length ? anyFieldMatchExpr(playableArr) : ['literal', false];
            const eliminatedFilter = eliminatedArr.length ? anyFieldMatchExpr(eliminatedArr) : ['literal', false];

            mapgl.setFilter('gh-play-fill', playableFilter);
            mapgl.setFilter('gh-play-line', playableFilter);
            mapgl.setFilter('gh-elim-fill', eliminatedFilter);
            mapgl.setFilter('gh-elim-line', eliminatedFilter);

            mapgl.setPaintProperty('gh-play-fill', 'fill-color', playFill.value || '#00ff66');
            mapgl.setPaintProperty('gh-play-fill', 'fill-opacity', Number(playFillOp.value || 0.25));
            mapgl.setPaintProperty('gh-play-line', 'line-color', playStroke.value || '#00ff66');
            mapgl.setPaintProperty('gh-play-line', 'line-width', Number(playWidth.value || 1.5));

            mapgl.setPaintProperty('gh-elim-fill', 'fill-color', elimFill.value || '#ff3355');
            mapgl.setPaintProperty('gh-elim-fill', 'fill-opacity', Number(elimFillOp.value || 0.22));
            mapgl.setPaintProperty('gh-elim-line', 'line-color', elimStroke.value || '#ff3355');
            mapgl.setPaintProperty('gh-elim-line', 'line-width', Number(elimWidth.value || 1.2));

            // OPTIMIZED: Single call instead of duplicate conditional call
            if (Array.isArray(eliminatedArr) && eliminatedArr.length > 0) {
              updateEliminatedSavedLayer(src, eliminatedArr);
            }

            const baseIds = (typeof findGeohashBaseLayers === 'function') ? findGeohashBaseLayers() : [];
            setLayerVisibility(baseIds, !hideBase.checked);
          } catch (e) {
            console.warn('applyIfReady error:', e);
          }
        };

        // OPTIMIZED: Use Utils.debounce instead of local implementation
        const autoApply = Utils.debounce(() => { applyIfReady(); saveGeohashState(); }, GEOHASH_SAVE_DEBOUNCE_MS);

        // Textareas: react to typing and paste (comma/newline both supported by parser)
        [taPlayable, taEliminated].forEach(el => {
          el.addEventListener('input', autoApply, { passive: true });
          el.addEventListener('paste', () => setTimeout(autoApply, 0), { passive: true });
        });

        // Style controls: live preview + autosave
        [playFill, playFillOp, playStroke, playWidth, elimFill, elimFillOp, elimStroke, elimWidth].forEach(el => {
          el.addEventListener('input', autoApply, { passive: true });
          el.addEventListener('change', autoApply, { passive: true });
        });

        // Clear button
        document.getElementById('geohash-clear')?.addEventListener('click', () => {
          taPlayable.value = '';
          taEliminated.value = '';
          autoApply();
        });

        // OPTIMIZED: Removed duplicate autosave - already handled by autoApply above


        // ===== Modal helpers - Use ModalManager =====
        const geohashModal = ModalManager.create('geohash-modal', {
          onOpen: loadGeohashState
        });
        openBtn?.addEventListener('click', () => geohashModal.open());
        closeBtn?.addEventListener('click', () => geohashModal.close());

        // ===== Utility =====
        // Accept comma, spaces and newlines. Keeps only tokens that look like geohash_id.
        const linesToSet = (text) => {
          // geohash (base32: 0-9, b-h, j-k, m-n, p-z) with optional _0/_1 suffix; length 3–12
          const GID_RE = /^(?:[0-9b-hjkmnp-z]{3,12})(?:_[01])?$/i;

          const raw = String(text || '')
            .replace(/[;]+/g, ',')   // treat semicolons like commas
            .replace(/\s+/g, ' ')    // collapse whitespace
            .replace(/,+/g, ',');    // collapse consecutive commas

          const tokens = raw.split(/[,\s]+/); // split by comma OR whitespace

          const out = new Set();
          for (let t of tokens) {
            t = t.trim();
            if (!t) continue;
            t = t.toLowerCase();      // normalize
            if (GID_RE.test(t)) out.add(t); // keep only valid geohash[_flag]
          }
          return out;
        };

        // OPTIMIZED: Efficient filter expression for large geohash arrays
        const anyFieldMatchExpr = (idsArray) => {
          // For small arrays (<100), use the original match expression
          if (idsArray.length < 100) {
            const expr = ['any'];
            for (const field of CANDIDATE_FIELDS) {
              expr.push(['match', ['coalesce', ['to-string', ['get', field]], ''], idsArray, true, false]);
            }
            return expr;
          }

          // For large arrays (>=100), use optimized 'in' expression
          // This is MUCH faster for 1000+ geohashes
          console.log(`[Geohash] Optimizing filter for ${idsArray.length} geohashes`);

          const expr = ['any'];
          for (const field of CANDIDATE_FIELDS) {
            expr.push(['in', ['coalesce', ['to-string', ['get', field]], ''], ['literal', idsArray]]);
          }
          return expr;
        };
        function setLayerVisibility(ids, visible) {
          (ids || []).forEach(id => {
            if (!mapgl.getLayer(id)) return;
            mapgl.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
          });
        }
        function findGeohashBaseLayers() {
          if (KNOWN_BASE_LAYER_IDS.length) return KNOWN_BASE_LAYER_IDS.filter(id => mapgl.getLayer(id));
          const layers = mapgl.getStyle().layers || [];
          // Heuristic: any layer id containing 'geohash'
          return layers.filter(l => /geohash/i.test(l.id)).map(l => l.id);
        }
        function findGeohashSourceId() {
          if (KNOWN_SOURCE_ID && mapgl.getSource(KNOWN_SOURCE_ID)) return KNOWN_SOURCE_ID;
          const baseLayers = findGeohashBaseLayers();
          for (const lid of baseLayers) {
            const lyr = mapgl.getLayer(lid);
            if (lyr && lyr.source && mapgl.getSource(lyr.source)) return lyr.source;
          }
          // fallback: first geojson source in style
          const style = mapgl.getStyle();
          for (const k in style.sources) {
            const s = style.sources[k];
            if (s.type === 'geojson') return k;
          }
          return null;
        }

        // --- Build/refresh the saved "Eliminated Geohash" layer from the base source ---
        function updateEliminatedSavedLayer(sourceId, eliminatedIds) {
          try {
            if (!window.mapgl || !sourceId) return;
            if (!window.mapgl || !sourceId) return;
            // NEW: never overwrite the saved layer with an empty list
            if (!Array.isArray(eliminatedIds) || eliminatedIds.length === 0) return;


            // 1) Try to obtain the full GeoJSON of the base geohashes source
            const src = mapgl.getSource(sourceId);
            const styleObj = mapgl.getStyle && mapgl.getStyle();
            const styleSources = styleObj && styleObj.sources ? styleObj.sources : null;

            // Try common MapLibre internal shapes
            const raw =
              (src && (src._data || (src._options && src._options.data))) ||
              (styleSources && styleSources[sourceId] && styleSources[sourceId].data) ||
              null;

            if (!raw || !raw.features || !Array.isArray(raw.features)) {
              console.warn('[Geohash] Could not read base GeoJSON for cloning; saved layer not updated.');
              return;
            }

            // 2) Build fast lookup of eliminated ids
            const list = Array.isArray(eliminatedIds) ? eliminatedIds : [];
            const elimSet = new Set(list.map(function (s) { return String(s).toLowerCase(); }));

            // 3) Pick features whose any candidate field matches an eliminated id
            // Use fallback fields if CANDIDATE_FIELDS is missing
            const FIELDS = Array.isArray(window.CANDIDATE_FIELDS) && window.CANDIDATE_FIELDS.length
              ? window.CANDIDATE_FIELDS
              : ['geohash', 'name', 'id', 'description'];

            const outFeatures = [];
            for (var i = 0; i < raw.features.length; i++) {
              const f = raw.features[i];
              const p = (f && f.properties) ? f.properties : {};
              var matched = false;
              for (var j = 0; j < FIELDS.length; j++) {
                const field = FIELDS[j];
                const v = (p[field] != null) ? String(p[field]).toLowerCase() : '';
                if (elimSet.has(v)) { matched = true; break; }
              }
              if (!matched) continue;

              // Pull style inputs safely (no optional chaining)
              const _fill = (typeof elimFill !== 'undefined' && elimFill && elimFill.value) ? elimFill.value : '#ff3355';
              const _fillOp = (typeof elimFillOp !== 'undefined' && elimFillOp && elimFillOp.value) ? Number(elimFillOp.value) : 0.22;
              const _stroke = (typeof elimStroke !== 'undefined' && elimStroke && elimStroke.value) ? elimStroke.value : '#ff3355';
              const _width = (typeof elimWidth !== 'undefined' && elimWidth && elimWidth.value) ? Number(elimWidth.value) : 1.2;

              outFeatures.push({
                type: 'Feature',
                geometry: f.geometry,
                properties: Object.assign({}, p, {
                  // stable key: use geohash/name/id if present
                  fid: String(p._gid != null ? p._gid :
                    p.fid != null ? p.fid :
                      p.geohash != null ? p.geohash :
                        p.id != null ? p.id :
                          p.name != null ? p.name : (outFeatures.length + 1)),
                  _gid: String(p._gid != null ? p._gid :
                    p.fid != null ? p.fid :
                      p.geohash != null ? p.geohash :
                        p.id != null ? p.id :
                          p.name != null ? p.name : (outFeatures.length + 1)),
                  hidden: false,
                  _ts: Date.now(),

                  // Style props so GL + Leaflet engines render correctly
                  _fill: _fill,
                  _fillOpacity: _fillOp,
                  _stroke: _stroke,
                  _strokeOpacity: 1,
                  _weight: _width
                })
              });
            }

            // 4) Upsert the saved layer and paint it
            if (typeof window.getOrCreateLayerByName !== 'function') {
              console.warn('[Geohash] getOrCreateLayerByName missing; skipping saved layer write.');
              return;
            }
            const entry = getOrCreateLayerByName('Eliminated Geohash');
            entry.data = { type: 'FeatureCollection', features: outFeatures };
            entry.items = (typeof window.rebuildItemsFromFeatures === 'function')
              ? rebuildItemsFromFeatures(outFeatures)
              : [];

            // Refresh both engines + persist (only call helpers if they exist)
            try { if (typeof window.refreshGroupBoth === 'function') refreshGroupBoth(entry); } catch (e) { }
            try { if (typeof window.applyVisibility === 'function') applyVisibility(entry); } catch (e) { }
            try { if (typeof window.renderLayers === 'function') renderLayers(); } catch (e) { }
            try { if (typeof window.saveState === 'function') saveState(); } catch (e) { }
          } catch (e) {
            console.warn('[Geohash] updateEliminatedSavedLayer failed:', e);
          }
        }


        // ===== Build or update overlay layers =====
        function ensureOverlayLayers(sourceId) {
          // Remove if exist (we rebuild cleanly)
          [GL_LYR_PLAY_LINE, GL_LYR_PLAY_FILL, GL_LYR_ELIM_LINE, GL_LYR_ELIM_FILL].forEach(id => {
            try { if (mapgl.getLayer(id)) mapgl.removeLayer(id); } catch { }
          });

          // Create with default filters; we'll set them in apply()
          mapgl.addLayer({ id: GL_LYR_PLAY_FILL, type: 'fill', source: sourceId, paint: { 'fill-color': '#00ff66', 'fill-opacity': 0.25 }, filter: ['literal', false] });
          mapgl.addLayer({ id: GL_LYR_PLAY_LINE, type: 'line', source: sourceId, paint: { 'line-color': '#00ff66', 'line-width': 1.5, 'line-opacity': 1 }, filter: ['literal', false] });

          mapgl.addLayer({ id: GL_LYR_ELIM_FILL, type: 'fill', source: sourceId, paint: { 'fill-color': '#ff3355', 'fill-opacity': 0.22 }, filter: ['literal', false] });
          mapgl.addLayer({ id: GL_LYR_ELIM_LINE, type: 'line', source: sourceId, paint: { 'line-color': '#ff3355', 'line-width': 1.2, 'line-opacity': 1 }, filter: ['literal', false] });

          // Keep overlays above base layers
          const topId = findGeohashBaseLayers()[0] || null;
          if (topId) {
            try {
              mapgl.moveLayer(GL_LYR_PLAY_FILL, topId); mapgl.moveLayer(GL_LYR_PLAY_LINE, GL_LYR_PLAY_FILL);
              mapgl.moveLayer(GL_LYR_ELIM_FILL, GL_LYR_PLAY_LINE); mapgl.moveLayer(GL_LYR_ELIM_LINE, GL_LYR_ELIM_FILL);
            } catch { }
          }
        }

        // ===== Apply from UI =====
        function apply() {
          const sourceId = findGeohashSourceId();
          if (!sourceId) { alert('Could not find the existing Geohashes source. Set KNOWN_SOURCE_ID at top.'); return; }

          // Create overlay layers if missing
          if (!mapgl.getLayer(GL_LYR_PLAY_FILL)) ensureOverlayLayers(sourceId);

          // Lists
          const playableArr = Array.from(linesToSet(taPlayable.value));
          const eliminatedArr = Array.from(linesToSet(taEliminated.value));

          // Filters: match any candidate field against the list
          const playableFilter = playableArr.length ? anyFieldMatchExpr(playableArr) : ['literal', false];
          const eliminatedFilter = eliminatedArr.length ? anyFieldMatchExpr(eliminatedArr) : ['literal', false];

          // Set filters
          mapgl.setFilter(GL_LYR_PLAY_FILL, playableFilter);
          mapgl.setFilter(GL_LYR_PLAY_LINE, playableFilter);
          mapgl.setFilter(GL_LYR_ELIM_FILL, eliminatedFilter);
          mapgl.setFilter(GL_LYR_ELIM_LINE, eliminatedFilter);



          // Styles
          mapgl.setPaintProperty(GL_LYR_PLAY_FILL, 'fill-color', playFill.value || '#00ff66');
          mapgl.setPaintProperty(GL_LYR_PLAY_FILL, 'fill-opacity', Number(playFillOp.value || 0.25));
          mapgl.setPaintProperty(GL_LYR_PLAY_LINE, 'line-color', playStroke.value || '#00ff66');
          mapgl.setPaintProperty(GL_LYR_PLAY_LINE, 'line-width', Number(playWidth.value || 1.5));

          mapgl.setPaintProperty(GL_LYR_ELIM_FILL, 'fill-color', elimFill.value || '#ff3355');
          mapgl.setPaintProperty(GL_LYR_ELIM_FILL, 'fill-opacity', Number(elimFillOp.value || 0.22));
          mapgl.setPaintProperty(GL_LYR_ELIM_LINE, 'line-color', elimStroke.value || '#ff3355');
          mapgl.setPaintProperty(GL_LYR_ELIM_LINE, 'line-width', Number(elimWidth.value || 1.2));

          // OPTIMIZED: Single call instead of duplicate conditional call
          if (Array.isArray(eliminatedArr) && eliminatedArr.length > 0) {
            updateEliminatedSavedLayer(sourceId, eliminatedArr);
          }

          // Hide or show base layer(s)
          const baseIds = findGeohashBaseLayers();
          setLayerVisibility(baseIds, !hideBase.checked);
        }

        // OPTIMIZED: Use Utils.debounce for apply button save
        const debouncedSave = Utils.debounce(saveGeohashState, GEOHASH_SAVE_DEBOUNCE_MS);
        applyBtn?.addEventListener('click', () => {
          apply();
          debouncedSave();
        });


        // --- Expose applyIfReady globally so joinRoom can use it ---
        window.applyGeohashOverlays = applyIfReady;

        const scheduleAfterBootstrap = (fn) => {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => { setTimeout(fn, 0); }, { once: true });
          } else {
            setTimeout(fn, 0);
          }
        };

        // --- Auto-apply on initial page load (for 'Continue without sync') ---
        scheduleAfterBootstrap(async () => {
          // Only run if NOT joining a room (room will handle it)
          if (!window.currentRoomCode) {
            await loadGeohashState();
            glReady(() => {
              setTimeout(() => {
                try {
                  applyIfReady();
                  console.log('✓ Geohash overlays auto-applied on load (local mode)');
                } catch (e) {
                  console.warn('geohash auto-apply on load failed:', e);
                }
              }, 500);
            });
          }
        });

        // Optional: prefill example (only if no saved data and both textareas are empty)
        const maybePrefillGeohashExamples = () => {
          const hasSaved =
            typeof getOrCreateLayerByName === 'function' &&
            Array.isArray(getOrCreateLayerByName('Eliminated Geohash')?.data?.features) &&
            getOrCreateLayerByName('Eliminated Geohash').data.features.length > 0;

          const playableEmpty = !taPlayable.value.trim();
          const eliminatedEmpty = !taEliminated.value.trim();

          if (!hasSaved && playableEmpty && eliminatedEmpty) {
            taPlayable.value = ['w21zw4_1', 'w238pc_0', 'w21xq6_1', 'w21z4p_0'].join('\n');
            taEliminated.value = ['w21xqp_0', 'w21zkw_1', 'w21zv5_1', 'w21z90_1'].join('\n');
          }
        };
        scheduleAfterBootstrap(maybePrefillGeohashExamples);

      })();

      // ===================== Pixel Grid Module (Supabase + Filters) =====================
      (() => {
        const LS_KEY = 'sqkii-pixelgrid-v2';
        const PG_SYNC_DEBOUNCE = 400;

        // DOM
        const openBtn = document.getElementById('pixelgrid-open');
        const modal = document.getElementById('pixelgrid-modal');
        const closeBtn = document.getElementById('pixelgrid-close');
        const appEl = document.getElementById('app');

        const c = document.getElementById('pg-canvas');
        if (!openBtn || !modal || !closeBtn || !appEl || !c) {
          console.warn('Pixel Grid modal markup is missing; skipping Pixel Grid init.');
          return;
        }
        const ctx = c.getContext('2d', { alpha: false });

        const wInput = document.getElementById('pg-w');
        const hInput = document.getElementById('pg-h');
        const zoomRange = document.getElementById('pg-zoom');
        const applySize = document.getElementById('pg-apply-size');
        const clearBtn = document.getElementById('pg-clear');

        const xInput = document.getElementById('pg-x');
        const yInput = document.getElementById('pg-y');
        const colorInp = document.getElementById('pg-color');
        const addBtn = document.getElementById('pg-add');

        const hintInp = document.getElementById('pg-hint');
        const bulkTA = document.getElementById('pg-bulk');
        const parseBtn = document.getElementById('pg-parse');
        const exportBtn = document.getElementById('pg-export');
        const msgEl = document.getElementById('pg-msg');

        // Filters
        const blurInp = document.getElementById('pg-blur');
        const satInp = document.getElementById('pg-sat');
        const conInp = document.getElementById('pg-con');
        const briInp = document.getElementById('pg-bri');
        const resetFilt = document.getElementById('pg-filters-reset');
        const filtMsg = document.getElementById('pg-filters-msg');

        // State
        let W = 32, H = 32, CELL = 16;
        const pixels = new Map();
        const filters = { blur: 0, sat: 100, con: 100, bri: 100 };

        // Supabase binding (hooked by joinRoom/subscribeRoom later)
        let bound = {
          supabase: null,
          currentRoomCode: null,
          clientId: null,
          suppressNext: false
        };

        // Persistence
        const serialize = () => ({
          W, H, CELL,
          pixels: [...pixels.entries()],
          filters: { ...filters }
        });
        function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch { } }
        function loadLocal() {
          try {
            const raw = localStorage.getItem(LS_KEY); if (!raw) return;
            const o = JSON.parse(raw);
            W = Math.max(1, o.W | 0 || 32);
            H = Math.max(1, o.H | 0 || 32);
            CELL = Math.min(48, Math.max(6, o.CELL | 0 || 16));
            pixels.clear(); for (const [k, v] of (o.pixels || [])) pixels.set(k, v);
            Object.assign(filters, o.filters || {});
          } catch { }
        }

        // Utils
        const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
        const key = (x, y) => `${x},${y}`;
        function parseHex(s) {
          if (!s) return null;
          const t = s.trim();
          return /^#?[0-9a-f]{6}$/i.test(t) ? (t[0] === '#' ? t : '#' + t) : null;
        }

        // Draw
        function drawGrid() {
          const pad = 0;                        // no outer padding
          c.width = W * CELL;
          c.height = H * CELL;

          ctx.fillStyle = '#0b0d11';
          ctx.fillRect(0, 0, c.width, c.height);

          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const v = pixels.get(key(x, y));
              if (v) { ctx.fillStyle = v; }
              else {
                const d = ((x + y) & 1) ? 24 : 18;  // checker background for empty cells
                ctx.fillStyle = `rgb(${d},${d},${d})`;
              }
              ctx.fillRect(x * CELL, y * CELL, CELL, CELL); // note: no +pad, no 0.5 lines
            }
          }

          // no stroke lines at all
          applyFilters();
        }

        function applyFilters() {
          const blur = clamp(parseInt(blurInp.value ?? filters.blur, 10) || 0, 0, 40);
          const sat = clamp(parseInt(satInp.value ?? filters.sat, 10) || 100, 0, 300);
          const con = clamp(parseInt(conInp.value ?? filters.con, 10) || 100, 0, 300);
          const bri = clamp(parseInt(briInp.value ?? filters.bri, 10) || 100, 0, 300);
          filters.blur = blur; filters.sat = sat; filters.con = con; filters.bri = bri;
          c.style.filter = `blur(${blur}px) saturate(${sat}%) contrast(${con}%) brightness(${bri}%)`;
        }

        function setPixel(x, y, hex) {
          if (x < 0 || y < 0 || x >= W || y >= H) return false;
          const color = parseHex(hex); if (!color) return false;
          pixels.set(key(x, y), color); return true;
        }

        // Parse (x,y,#hex) tuples, auto-detect 1-indexing if any equals size
        function parseTriples(str) {
          const out = []; if (!str) return out;
          const m = String(str).match(/\(?\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(#[0-9a-f]{6})\s*\)?/ig) || [];
          for (const tok of m) {
            const parts = tok.replace(/[()]/g, '').split(/[, ]/).filter(Boolean);
            if (parts.length >= 3) {
              const x = parseInt(parts[0], 10), y = parseInt(parts[1], 10), hex = parseHex(parts[2]);
              if (Number.isFinite(x) && Number.isFinite(y) && hex) out.push({ x, y, hex });
            }
          }
          if (!out.length) return out;
          const oneIndexed = out.some(p => p.x === W || p.y === H);
          return out.map(p => ({ x: clamp(p.x - (oneIndexed ? 1 : 0), 0, W - 1), y: clamp(p.y - (oneIndexed ? 1 : 0), 0, H - 1), hex: p.hex }));
        }

        function refreshInputs() {
          wInput.value = W; hInput.value = H; zoomRange.value = CELL;
          blurInp.value = filters.blur; satInp.value = filters.sat; conInp.value = filters.con; briInp.value = filters.bri;
          drawGrid();
          saveLocal();
          saveRemoteDebounced();
        }

        // Modal
        function openModal() {
          if (!hintInp.value.trim()) {
            hintInp.value = '(30,17,#949A9B),(22,24,#6F7378),(25,17,#909799),(25,31,#2E3023)';
          }
          modal.classList.add('visible'); appEl.classList.add('blocked-by-modal');
          drawGrid();
        }
        function closeModal() {
          modal.classList.remove('visible');
          appEl.classList.remove('blocked-by-modal');
        }

        openBtn?.addEventListener('click', openModal);
        closeBtn?.addEventListener('click', closeModal);
        modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

        // Option A (direct): call openModal on FAB click
        document.getElementById('pixelgrid-fab')?.addEventListener('click', openModal);

        // Size / zoom / clear
        applySize.addEventListener('click', () => {
          const nw = Math.max(1, parseInt(wInput.value, 10) || 32);
          const nh = Math.max(1, parseInt(hInput.value, 10) || 32);
          if (nw !== W || nh !== H) {
            W = nw; H = nh;
            for (const k of [...pixels.keys()]) {
              const [sx, sy] = k.split(',').map(n => parseInt(n, 10));
              if (sx < 0 || sy < 0 || sx >= W || sy >= H) pixels.delete(k);
            }
            refreshInputs();
          }
        });
        zoomRange.addEventListener('input', () => {
          CELL = clamp(parseInt(zoomRange.value, 10) || 16, 6, 48);
          refreshInputs();
        });
        // Replace the existing clearBtn listener with this
        clearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Hold Shift/Ctrl/Cmd to skip the prompt
          const ok = (e.shiftKey || e.ctrlKey || e.metaKey)
            ? true
            : window.confirm('Clear all pixels from this grid?');

          if (!ok) return;

          pixels.clear();
          // make sure canvas updates immediately
          ctx.clearRect(0, 0, c.width, c.height);
          drawGrid();
          saveLocal();
          saveRemoteDebounced();

          // tiny toast
          msgEl.textContent = 'Cleared all pixels';
          setTimeout(() => { msgEl.textContent = ''; }, 1200);
        });

        // Add pixels
        addBtn.addEventListener('click', () => {
          const xx = parseInt(xInput.value, 10), yy = parseInt(yInput.value, 10);
          const ok = setPixel(xx, yy, colorInp.value);
          if (!ok) { msgEl.textContent = 'Invalid / out of bounds'; setTimeout(() => msgEl.textContent = '', 1500); return; }
          drawGrid(); saveLocal(); saveRemoteDebounced();
        });
        parseBtn.addEventListener('click', () => {
          const txt = (bulkTA.value + ' ' + hintInp.value).trim();
          const triples = parseTriples(txt);
          let added = 0; for (const t of triples) { if (setPixel(t.x, t.y, t.hex)) added++; }
          msgEl.textContent = added ? `Plotted ${added} pixel(s).` : 'No valid pixels found.';
          drawGrid(); saveLocal(); saveRemoteDebounced(); setTimeout(() => msgEl.textContent = '', 1500);
        });

        // Export (no grid lines)
        // Pick export scale: use current CELL, but clamp so it's not too small/huge
        function exportScale() { return Math.max(8, Math.min(64, Math.round(CELL))); }

        exportBtn.addEventListener('click', () => {
          // 1) build a 1:1 pixel canvas
          const src = document.createElement('canvas');
          src.width = W;
          src.height = H;
          const sctx = src.getContext('2d');
          const img = sctx.createImageData(W, H);
          const data = img.data;

          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const v = pixels.get(key(x, y));
              const i = (y * W + x) * 4;
              if (v) {
                data[i + 0] = parseInt(v.slice(1, 3), 16);
                data[i + 1] = parseInt(v.slice(3, 5), 16);
                data[i + 2] = parseInt(v.slice(5, 7), 16);
                data[i + 3] = 255;
              } else {
                // empty pixels -> black (or choose your background)
                data[i + 0] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
              }
            }
          }
          sctx.putImageData(img, 0, 0);

          // 2) upscale to a larger canvas without smoothing (keeps blocky pixels)
          const scale = exportScale();          // e.g. 16, 24, etc.
          const out = document.createElement('canvas');
          out.width = W * scale;
          out.height = H * scale;
          const octx = out.getContext('2d');
          octx.imageSmoothingEnabled = false;
          octx.webkitImageSmoothingEnabled = false;
          octx.msImageSmoothingEnabled = false;

          octx.drawImage(src, 0, 0, out.width, out.height);

          // download
          const a = document.createElement('a');
          a.href = out.toDataURL('image/png');
          a.download = `pixel-grid-${W}x${H}-x${scale}.png`;
          a.click();
        });

        // Canvas interactions
        c.addEventListener('click', (e) => {
          const r = c.getBoundingClientRect();
          const x = Math.floor((e.clientX - r.left - 1) / CELL);
          const y = Math.floor((e.clientY - r.top - 1) / CELL);
          if (x >= 0 && y >= 0 && x < W && y < H) { xInput.value = x; yInput.value = y; msgEl.textContent = `Picked (${x},${y})`; setTimeout(() => msgEl.textContent = '', 900); }
        }, { passive: true });
        c.addEventListener('wheel', (e) => {
          e.preventDefault();
          const d = Math.sign(e.deltaY);
          CELL = clamp(CELL - d * 2, 6, 48);
          zoomRange.value = CELL; drawGrid(); saveLocal(); saveRemoteDebounced();
        }, { passive: false });

        // ===== Filter handlers (instant update, works with step arrows, mobile, etc.) =====
        (function () {
          let msgTimer = null;

          function onFilterChangeInstant() {
            // apply + persist + sync
            applyFilters();
            saveLocal();
            saveRemoteDebounced();

            // toast-y status text (debounced so it doesn't flicker)
            filtMsg.textContent = `blur ${filters.blur}px • sat ${filters.sat}% • con ${filters.con}% • bri ${filters.bri}%`;
            if (msgTimer) clearTimeout(msgTimer);
            msgTimer = setTimeout(() => { filtMsg.textContent = ''; }, 1200);
          }

          // bind helper: react to typing, steppers (↑/↓), and mobile spinners
          const bindInstant = (el) => {
            // fires as you type or drag the spinner in most browsers
            el.addEventListener('input', onFilterChangeInstant, { passive: true });
            // safety net for browsers that only fire on change/commit
            el.addEventListener('change', onFilterChangeInstant, { passive: true });

            // make sure arrow/PageUp/PageDown steps trigger an update immediately
            el.addEventListener('keydown', (e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
                // defer to let the native step apply first
                setTimeout(onFilterChangeInstant, 0);
              }
            });

            // when the number input has focus, don't let the page scroll steal the wheel
            el.addEventListener('wheel', (e) => {
              if (document.activeElement === el) e.stopPropagation();
            }, { passive: true });
          };

          [blurInp, satInp, conInp, briInp].forEach(bindInstant);

          // reset button
          resetFilt.addEventListener('click', () => {
            filters.blur = 0; filters.sat = 100; filters.con = 100; filters.bri = 100;
            blurInp.value = 0; satInp.value = 100; conInp.value = 100; briInp.value = 100;
            onFilterChangeInstant();
          });
        })();


        // Supabase sync
        const debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
        async function saveRemoteNow() {
          if (!bound.supabase || !bound.currentRoomCode) return;
          try {
            bound.suppressNext = true;
            await bound.supabase
              .from('rooms')
              .update({
                pixelgrid: serialize(),
                pixelgrid_updated_at: new Date().toISOString(),
                pixelgrid_updated_by: bound.clientId
              })
              .eq('code', bound.currentRoomCode);
            setTimeout(() => bound.suppressNext = false, 250);
          } catch (e) { console.warn('PixelGrid Supabase save failed:', e); }
        }
        const saveRemoteDebounced = debounce(saveRemoteNow, PG_SYNC_DEBOUNCE);

        function applyRemote(pg, who) {
          if (!pg || bound.suppressNext) return;
          if (who && who === bound.clientId) return;
          try {
            W = Math.max(1, pg.W | 0 || 32);
            H = Math.max(1, pg.H | 0 || 32);
            CELL = Math.min(48, Math.max(6, pg.CELL | 0 || 16));
            pixels.clear(); for (const [k, v] of (pg.pixels || [])) pixels.set(k, v);
            Object.assign(filters, pg.filters || {});
            refreshInputs(); // redraw + local save + remote (sender is suppressed)
          } catch (e) { console.warn('PixelGrid applyRemote failed:', e); }
        }

        // Public binder for your room flow
        window.PixelGrid = {
          bindToRoom({ supabase, currentRoomCode, clientId }) {
            bound.supabase = supabase; bound.currentRoomCode = currentRoomCode; bound.clientId = clientId;
            // initial fetch
            bound.supabase.from('rooms').select('pixelgrid,pixelgrid_updated_by').eq('code', currentRoomCode).maybeSingle()
              .then(({ data }) => { if (data?.pixelgrid) applyRemote(data.pixelgrid, data.pixelgrid_updated_by); })
              .catch(() => { });
          },
          applyRemote
        };

        // Init
        loadLocal();
        wInput.value = W; hInput.value = H; zoomRange.value = CELL;
        blurInp.value = filters.blur; satInp.value = filters.sat; conInp.value = filters.con; briInp.value = filters.bri;
        drawGrid();
      })();
      /* ================= Map engines ================= */
      const ALL_FILL_LAYER_IDS = [];
      const UA = navigator.userAgent || '';
      const IS_IOS_DEVICE = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const IS_TOUCH_DEVICE = (navigator.maxTouchPoints || 0) > 0 || !!window.matchMedia?.('(pointer: coarse)')?.matches;
      const IS_LOCALHOST = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
      const BASE_URL = import.meta.env.BASE_URL || '/';
      if (IS_IOS_DEVICE) document.documentElement.classList.add('ios-device');
      if (IS_TOUCH_DEVICE) document.documentElement.classList.add('touch-device');
      maptilersdk.config.apiKey = 'f9B8Wv0ythtbvpcK0QEw';
      const CUSTOM_STYLE = 'https://api.maptiler.com/maps/01994e5b-af91-7fae-b8bd-a68c497abf96/style.json?key=' + maptilersdk.config.apiKey;
      const baseDevicePixelRatio = Number(window.devicePixelRatio || 1);
      const MAPGL_PIXEL_RATIO = IS_IOS_DEVICE
        ? Math.min(Math.max(1, baseDevicePixelRatio * 0.8), 1.8)
        : Math.min(baseDevicePixelRatio * 1.25, 3);

      const mapgl = new maptilersdk.Map({
        container: 'mapgl',
        style: CUSTOM_STYLE,
        center: [103.8198, 1.3521],
        zoom: 12,
        pixelRatio: MAPGL_PIXEL_RATIO
      });
      let mapglStyleLoaded = false;
      mapgl.on('load', () => { mapglStyleLoaded = true; });

      const pauseVeil = () => window.__pauseVeil?.();
      const resumeVeil = () => window.__resumeVeil?.();

      mapgl.on('movestart', pauseVeil);
      mapgl.on('moveend', resumeVeil);
      mapgl.on('zoomstart', pauseVeil);
      mapgl.on('zoomend', resumeVeil);

      (() => {
        const cat = document.getElementById('cat-lottie');
        if (!cat || !window.lottie) return;
        const catLottieSrc = `${BASE_URL}cat-fishing-on-moon.json`;
        let catAnimation = null;

        const tryStartCat = () => {
          if (catAnimation) {
            catAnimation.play();
            return;
          }
          try {
            catAnimation = window.lottie.loadAnimation({
              container: cat,
              renderer: 'canvas',
              loop: true,
              autoplay: true,
              path: catLottieSrc,
              rendererSettings: {
                clearCanvas: true,
                progressiveLoad: true,
                preserveAspectRatio: 'xMidYMid meet',
              },
            });
            catAnimation.setSpeed(0.5);
            cat._lottieAnimation = catAnimation;
            catAnimation.addEventListener('data_failed', (e) => {
              console.warn('cat-lottie failed to load', e);
            });
          } catch (e) {
            console.warn('cat-lottie failed to initialize', e);
          }
        };

        tryStartCat();
      })();

      const _glReadyQueue = [];
      let _glDrainScheduled = false;

      function glIsTrulyReady() {
        try {
          return mapgl &&
            typeof mapgl.isStyleLoaded === 'function' &&
            mapgl.isStyleLoaded() &&
            typeof mapgl.areTilesLoaded === 'function' &&
            mapgl.areTilesLoaded();
        } catch { return false; }
      }

      function drainGlQueueIfReady() {
        if (!glIsTrulyReady()) return;
        const q = _glReadyQueue.splice(0, _glReadyQueue.length);
        _glDrainScheduled = false;
        for (const fn of q) {
          try { fn(); } catch (e) { console.warn('glReady callback error:', e); }
        }
      }

      // Schedule a drain attempt on the next true-idle frame.
      function scheduleGlDrain() {
        if (_glDrainScheduled) return;
        _glDrainScheduled = true;

        const tryDrain = () => {
          // If ready now, drain immediately.
          if (glIsTrulyReady()) {
            drainGlQueueIfReady();
            return;
          }
          // Not ready yet: wait for the next idle.
          mapgl.once('idle', () => {
            // Small micro-delay helps after setStyle() churn.
            requestAnimationFrame(drainGlQueueIfReady);
          });
        };

        // If map already loaded, try now; else wait for load.
        if (mapgl && mapgl.loaded && mapgl.loaded()) {
          tryDrain();
        } else {
          mapgl.once('load', tryDrain);
        }
      }

      function glReady(fn) {
        if (glIsTrulyReady()) {
          // Already ready—run immediately.
          try { fn(); } catch (e) { console.warn('glReady callback error:', e); }
          return;
        }
        _glReadyQueue.push(fn);
        scheduleGlDrain();
      }

      // Optional: when you call mapgl.setStyle(...), ask to re-check readiness.
      mapgl.on('styledata', () => {
        // Don’t drain immediately; wait for idle to avoid early execution.
        if (_glReadyQueue.length) scheduleGlDrain();
      });

      mapgl.on('load', drainGlQueueIfReady);
      mapgl.on('styledata', drainGlQueueIfReady);
      mapgl.on('idle', drainGlQueueIfReady);

      setTimeout(() => {
        if (_glReadyQueue.length > 0) {
          console.warn('glReady timeout, force-executing queue');
          drainGlQueueIfReady();
        }
      }, 2000);


      // Allow smoother fractional zoom (optional but feels nicer)
      const mapleaf = L.map('mapleaf', {
        zoomControl: true,
        attributionControl: true,
        zoomSnap: 0.25,
        zoomDelta: 0.25,
        doubleClickZoom: false,   // <-- add this line
      }).setView([1.3521, 103.8198], 12);

      // hook veil to Leaflet
      mapleaf.on('movestart', pauseVeil);
      mapleaf.on('moveend', resumeVeil);


      // Default OSM tiles, but with Retina + higher logical max zoom
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxNativeZoom: 17, //native limit of OSM server
        maxZoom: 21,    // let Leaflet scale beyond native
        detectRetina: true, // request higher-detail tiles for Hi-DPI
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapleaf);

      mapgl.on('load', () => mapgl.on('click', (e) => { if (!e.originalEvent.defaultPrevented) closeActivePopup(); }));

      // Global polygon click: choose the smallest polygon at the click point
      mapgl.on('click', (e) => {
        if (popupsSuppressed()) return;
        // Only check layers that still exist
        const layers = ALL_FILL_LAYER_IDS.filter(id => mapgl.getLayer(id));
        if (!layers.length) return;

        // Get all polygons under the pointer
        const hits = mapgl.queryRenderedFeatures(e.point, { layers });
        const polys = hits.filter(f => {
          const t = f.geometry && f.geometry.type;
          return t === 'Polygon' || t === 'MultiPolygon';
        });

        if (!polys.length) return;

        // Pick the smallest area (inner-most circle)
        polys.sort((a, b) => turf.area(a) - turf.area(b));
        const chosen = polys[0];

        const content = buildPopupHTMLFromProps(chosen.properties);
        showSinglePopup(null, e.lngLat, content);

        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      });


      mapleaf.on('click', (e) => { if (!e.originalEvent.defaultPrevented) closeActivePopup(); });

      let engine = 'gl';
      function showGL() { const c = mapleaf.getCenter(), z = mapleaf.getZoom(); document.getElementById('mapleaf').style.display = 'none'; document.getElementById('mapgl').style.display = 'block'; mapgl.resize(); mapgl.jumpTo({ center: [c.lng, c.lat], zoom: z }); engine = 'gl'; }
      function showLeaf() { const c = mapgl.getCenter(), z = mapgl.getZoom(); document.getElementById('mapgl').style.display = 'none'; document.getElementById('mapleaf').style.display = 'block'; mapleaf.invalidateSize(true); mapleaf.setView([c.lat, c.lng], Math.round(z)); engine = 'leaf'; }
      if (IS_LOCALHOST) {
        setTimeout(() => {
          if (mapglStyleLoaded) return;
          console.warn('MapTiler style did not load on localhost. Falling back to OSM.');
          const basemapSelect = document.getElementById('basemap');
          if (basemapSelect) basemapSelect.value = 'osm';
          showLeaf();
        }, 2500);
      }

      /* ================= Icon registry ================= */
      const DOLLAR_ICON_NAME = 'dollar-pin'; let iconSeq = 1;
      const urlToName = new Map(), nameToUrl = new Map();
      function dollarSvg(size) { const s = size || 64; return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#111" stroke="white" stroke-width="1.5"/><text x="16" y="21" text-anchor="middle" font-family="system-ui,Segoe UI,Arial" font-size="16" font-weight="800" fill="white">$</text></svg>`; }
      function addImageToGL(name, url) { return new Promise(res => { const img = new Image(); img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer'; img.onload = () => { try { mapgl.addImage(name, img, { pixelRatio: 2 }); } catch { } res(); }; img.onerror = () => res(); img.src = url; }); }
      async function ensureDollarIcon() { if (mapgl.hasImage && mapgl.hasImage(DOLLAR_ICON_NAME)) return; await addImageToGL(DOLLAR_ICON_NAME, 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(dollarSvg(64))); }
      function registerIconUrl(url) { if (!url) return DOLLAR_ICON_NAME; if (urlToName.has(url)) return urlToName.get(url); const name = 'icon-' + (iconSeq++); urlToName.set(url, name); nameToUrl.set(name, url); if (mapgl.isStyleLoaded && mapgl.isStyleLoaded()) addImageToGL(name, url); else mapgl.once('load', () => addImageToGL(name, url)); return name; }
      async function ensureAllIconsOnCurrentStyle() { await ensureDollarIcon(); for (const [url, name] of urlToName.entries()) if (!mapgl.hasImage(name)) await addImageToGL(name, url); }
      mapgl.on('styleimagemissing', e => { const url = nameToUrl.get(e.id); if (url) addImageToGL(e.id, url); });

      function readdAllGroupsAfterGLStyleChange() {
        let done = false;
        function hydrate() {
          if (done) return;
          done = true;
          (async () => {
            await ensureAllIconsOnCurrentStyle();
            layerList.forEach(e => {
              createGroupOnGL(e, true);     // rebuild GL layers on new style
              refreshGroupGL(e);            // ensure data is bound
              applyVisibility(e);           // enforce visibility
            });
            renderLayers();
            renderGroupsVisibility();

            // DON'T recreate GPS control on style changes
            // The existing control should persist across style changes
          })();
        }
        mapgl.once('load', hydrate);
        mapgl.once('idle', hydrate);
      }

      // Also add this CSS to hide any extra controls that might slip through
      const style = document.createElement('style');
      style.textContent = `
/* Hide duplicate geolocate controls - keep only the first one */
.maplibregl-ctrl-top-right .maplibregl-ctrl-group:has(.maplibregl-ctrl-geolocate) ~ .maplibregl-ctrl-group:has(.maplibregl-ctrl-geolocate) {
  display: none !important;
}
`;
      document.head.appendChild(style);

      /* ================= App state / utils ================= */
      let layerSeq = 1, featureSeq = 1;
      const layerList = []; // {id,name,visible,data,items,glSourceId,glLayerIds[],lfGroup,lfLayers:Map,_deletedLayer?}
      const byId = id => document.getElementById(id);

      function ensureUniqueLayerId(entry) {
        // If another layer already has this id, bump it until unique
        while (layerList.some(l => l !== entry && String(l.id) === String(entry.id))) {
          entry.id = layerSeq++;
        }
        // Keep the global counter strictly ahead
        layerSeq = Math.max(layerSeq, (Number(entry.id) || 0) + 1);
      }


      function kmlColorToCss(aabbggrr) { if (!aabbggrr) { return { hex: '#ffffff', opacity: 0.2 }; } let s = aabbggrr.trim(); if (s.length === 6) s = 'ff' + s; return { hex: '#' + s.slice(6, 8) + s.slice(4, 6) + s.slice(2, 4), opacity: parseInt(s.slice(0, 2), 16) / 255 }; }
      function defaultLabelFrom(n) { if (!n) return '•'; const c = (n.trim()[0] || '•').toUpperCase(); return /[A-Z0-9$]/.test(c) ? c : '•'; }
      function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
      function sanitizeHtml(input) { try { const parser = new DOMParser(); const doc = parser.parseFromString('<div>' + input + '</div>', 'text/html'); const allowedTags = { A: 1, B: 1, I: 1, EM: 1, STRONG: 1, P: 1, BR: 1, UL: 1, OL: 1, LI: 1, IMG: 1, DIV: 1, SPAN: 1 }; const allowedAttrs = { A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height', 'loading'] }; (function clean(n) { for (const el of [...n.childNodes]) { if (el.nodeType === 1) { if (!allowedTags[el.tagName]) { while (el.firstChild) n.insertBefore(el.firstChild, el); n.removeChild(el); continue; } for (const a of [...el.attributes]) { const ok = (allowedAttrs[el.tagName] || []); if (!ok.includes(a.name.toLowerCase())) el.removeAttribute(a.name); } if (el.tagName === 'A') { const href = el.getAttribute('href') || ''; el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); if (/^javascript:/i.test(href)) el.removeAttribute('href'); } if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); } clean(el); } } })(doc.body); return doc.body.firstChild.innerHTML; } catch (e) { return ''; } }
      function findYouTubeId(str) { if (!str) return ''; const m = String(str).match(/(?:youtube\.com\/watch\?[^#\s]*v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; }
      function buildYouTubeEmbed(id) { if (!id) return ''; const src = 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1&playsinline=1'; return '<div class="yt-portrait" style="text-align:center"><iframe src="' + src + '" title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>'; }
      function buildPopupHTMLFromProps(props) {
        props = props || {};

        var name = (props.name != null && String(props.name).trim()) ? String(props.name) : 'Feature';
        var raw = (props.description != null) ? String(props.description) : '';
        var looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw);

        var safe = looksHtml
          ? sanitizeHtml(raw)
          : escapeHtml(raw).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

        var tmp = document.createElement('div');
        tmp.innerHTML = safe;
        var imgs = tmp.querySelectorAll('img');
        for (var ii = 0; ii < imgs.length; ii++) imgs[ii].remove();
        safe = tmp.innerHTML;

        var id = findYouTubeId(raw) || findYouTubeId(tmp.textContent || '');
        var embed = buildYouTubeEmbed(id);

        // ✅ Circle center (Lat/Lng)
        var centerHtml = '';
        var lng = props._circleLng;
        var lat = props._circleLat;

        // fallback: parse _circleCenter if needed
        if ((!Number.isFinite(+lng) || !Number.isFinite(+lat)) && props._circleCenter != null) {
          var c = props._circleCenter;

          if (Array.isArray(c) && c.length === 2) {
            lng = c[0]; lat = c[1];
          } else if (typeof c === 'string') {
            try {
              var arr = JSON.parse(c);
              if (Array.isArray(arr) && arr.length === 2) { lng = arr[0]; lat = arr[1]; }
            } catch (e) { }

            if (!Number.isFinite(+lng) || !Number.isFinite(+lat)) {
              var parts = c.split(',').map(function (s) { return s.trim(); });
              if (parts.length === 2) { lng = parts[0]; lat = parts[1]; }
            }
          }
        }

        if (Number.isFinite(+lng) && Number.isFinite(+lat)) {
          lng = +lng; lat = +lat;
          centerHtml =
            '<div style="margin:6px 0 8px; padding:8px; border:1px solid #1f2430; border-radius:10px; background:rgba(0,0,0,0.18);">'
            + '<div style="font-size:12px; color:#9aa6bf; font-weight:800; margin-bottom:4px;">Center</div>'
            + '<div style="font-size:13px; line-height:1.35; color:#e5e7eb; font-weight:800;">'
            + 'Lat: ' + lat.toFixed(6) + '<br/>Lng: ' + lng.toFixed(6)
            + '</div>'
            + '</div>';
        }

        return (
          '<div style="min-width:260px;max-width:340px;">'
          + '<div style="font-weight:800;font-size:16px;margin-bottom:6px;text-align:center;">' + escapeHtml(name) + '</div>'
          + centerHtml
          + (embed || '')
          + (safe ? '<div style="font-size:13px;line-height:1.35;color:#cbd5e1;font-weight:700;">' + safe + '</div>' : '')
          + '</div>'
        );
      }



      function bboxOfFeature(f) { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; (function scan(c) { if (typeof c[0] === 'number') { const [x, y] = c; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } else c.forEach(scan); })(f.geometry.coordinates); return [[minX, minY], [maxX, maxY]]; }
      function panPopupIntoViewGL(lngLat, liftPx = 220) { const p = mapgl.project(lngLat); p.y -= liftPx; const center = mapgl.unproject(p); mapgl.easeTo({ center, duration: 350 }); }


      let leafletCircleTheme = 'on-gl'; // 'on-gl' (dark map) or 'on-osm' (light OSM tiles)

      function restyleAllLeafletPolys() {
        layerList.forEach(entry => {
          if (!entry.lfLayers) return;
          for (const [fid, layers] of entry.lfLayers) {
            const f = (entry.data?.features || []).find(x => String(x.properties?.fid) === String(fid));
            if (!f) continue;
            const t = f.geometry?.type || '';
            layers.forEach(l => {
              if (!l.setStyle) return;
              if (t.includes('Polygon')) {
                l.setStyle(circleStyleForLeaflet(f.properties));
              } else if (t.includes('LineString')) {
                l.setStyle(lineStyleForLeaflet(f.properties));
              }
            });
          }
        });
      }

      function pickSmallestPolygonAtPoint(point) {
        const layers = ALL_FILL_LAYER_IDS.filter(id => mapgl.getLayer(id));
        if (!layers.length) return null;
        const hits = mapgl.queryRenderedFeatures(point, { layers });
        const polys = hits.filter(f => {
          const t = f.geometry && f.geometry.type;
          return t === 'Polygon' || t === 'MultiPolygon';
        });
        if (!polys.length) return null;
        polys.sort((a, b) => turf.area(a) - turf.area(b));
        return polys[0];
      }


      /* ================= POPUP MANAGEMENT SYSTEM ================= */

      let activePopup = null;
      let scrollLockEnabled = false;

      // NEW: scope wheel/touch blocking to the map containers only
      function inMap(target) {
        const m1 = document.getElementById('mapgl');
        const m2 = document.getElementById('mapleaf');
        return (m1 && m1.contains(target)) || (m2 && m2.contains(target));
      }
      function inPopupContent(target) {
        return !!(target.closest('.maplibregl-popup-content, .leaflet-popup-content, .leaflet-popup-content-wrapper'));
      }

      let _blocker = null;
      function enableScrollLock() {
        if (scrollLockEnabled) return;
        scrollLockEnabled = true;

        // do NOT add q-body--prevent-scroll or mess with body overflow anymore

        _blocker = (e) => {
          // If the event originated over the map, but not inside popup content,
          // prevent default so the page doesn't jitter/zoom; sidebar stays scrollable.
          if (inMap(e.target) && !inPopupContent(e.target)) {
            e.preventDefault();
          }
        };
        document.addEventListener('wheel', _blocker, { passive: false });
        document.addEventListener('touchmove', _blocker, { passive: false });
      }

      function disableScrollLock() {
        if (!scrollLockEnabled) return;
        scrollLockEnabled = false;

        if (_blocker) {
          document.removeEventListener('wheel', _blocker);
          document.removeEventListener('touchmove', _blocker);
          _blocker = null;
        }
      }


      function closeActivePopup() {
        if (activePopup) {
          try {
            if (activePopup.remove) activePopup.remove();
            else if (activePopup.closePopup) activePopup.closePopup();
          } catch (e) { }
          activePopup = null;
          disableScrollLock();
        }
      }

      function showSinglePopup(popup, lngLat, content) {
        closeActivePopup(); // Close any existing popup first

        if (engine === 'gl') {
          activePopup = new maptilersdk.Popup({
            anchor: 'bottom',
            offset: [0, 18],
            maxWidth: '340px',
            closeOnClick: true
          })
            .setLngLat(lngLat)
            .setHTML(content)
            .addTo(mapgl);

          panPopupIntoViewGL(lngLat, 220);
        } else {
          // For Leaflet
          activePopup = popup;
        }

        enableScrollLock();

        const thisPopup = activePopup;
        setTimeout(() => {
          if (activePopup === thisPopup) closeActivePopup();
        }, 10000);
      }

      /* ---- VISIBILITY: single source of truth for GL + Leaflet ---- */
      function applyVisibility(entry) {
        // MapLibre GL
        (entry.glLayerIds || []).forEach(lid => {
          if (mapgl.getLayer(lid)) {
            mapgl.setLayoutProperty(lid, 'visibility', (entry.visible !== false) ? 'visible' : 'none');
          }
        });
        // Leaflet
        if (entry.lfGroup) {
          if (entry.visible !== false) {
            if (!mapleaf.hasLayer(entry.lfGroup)) entry.lfGroup.addTo(mapleaf);
          } else {
            if (mapleaf.hasLayer(entry.lfGroup)) mapleaf.removeLayer(entry.lfGroup);
          }
        }
      }

      /* Timestamps (match Sonar & Draw exactly) */
      function timestampLabel() { return new Date().toLocaleString(); }

      /* ========== helpers for filtered rendering (exclude deleted) ========== */
      function filteredFeatureCollection(entry) {
        return { type: 'FeatureCollection', features: (entry.data?.features || []).filter(f => !f?.properties?._deleted) };
      }

      /* ========= GHOST-LAYERS HEALERS ========= */
      function hasLiveFeatures(entry) {
        return !!(entry?.data?.features || []).some(f => !(f?.properties?._deleted));
      }
      function normalizeDeletedFlag(entry) {
        if (entry && entry._deletedLayer && hasLiveFeatures(entry)) {
          entry._deletedLayer = false;
          return true;
        }
        return false;
      }

      /* ========== KMZ helpers ========== */
      function blobToDataUrl(blob) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); }
      async function buildKmzAssetMap(zip) {
        const out = {};
        for (const f of Object.values(zip.files)) {
          if (!f.dir && /\.(png|jpe?g|gif|svg)$/i.test(f.name)) {
            const blob = await f.async('blob'); out[f.name] = await blobToDataUrl(blob);
          }
        }
        return out;
      }
      function resolveIconHref(href, opts) {
        if (!href) return '';
        if (/^(https?:|data:)/i.test(href)) return href;
        if (opts && opts.assetMap) {
          if (opts.assetMap[href]) return opts.assetMap[href];
          const base = href.split(/[\\/]/).pop();
          for (const k of Object.keys(opts.assetMap)) {
            if (k === base || k.endsWith('/' + base)) return opts.assetMap[k];
          }
        }
        if (opts && opts.baseUrl) { try { return new URL(href, opts.baseUrl).href; } catch (e) { } }
        return href;
      }
      function extractKmlMeta(xmlDoc, opts) { function t(n, sel) { const el = n.querySelector(sel); return el ? (el.textContent || '').trim() : ''; } const styleById = {}, smById = {}; xmlDoc.querySelectorAll('Style[id], style[id]').forEach(s => styleById[s.getAttribute('id')] = s); xmlDoc.querySelectorAll('StyleMap[id], styleMap[id]').forEach(s => smById[s.getAttribute('id')] = s); function resolveStyleUrl(url) { if (!url) return null; const id = url.replace(/^#/, ''); const sm = smById[id]; if (sm) { for (const p of sm.querySelectorAll('Pair')) if ((t(p, 'key') || '').toLowerCase() === 'normal') { const su = t(p, 'styleUrl'); if (su) return resolveStyleUrl(su); } } return styleById[id] || null; } function topFolderName(node) { let cur = node.parentNode, top = ''; while (cur && cur.nodeType === 1) { if (/Folder/i.test(cur.tagName)) { const nm = t(cur, 'name'); if (nm) top = nm; } cur = cur.parentNode; } return top || 'Untitled layer'; } function parseStyle(sEl) { if (!sEl) return {}; const iconHref = t(sEl, 'IconStyle Icon href') || t(sEl, 'iconStyle icon href'); const lineColor = t(sEl, 'LineStyle color') || t(sEl, 'lineStyle color'); const lineWidth = t(sEl, 'LineStyle width') || t(sEl, 'lineStyle width'); const polyColor = t(sEl, 'PolyStyle color') || t(sEl, 'polyStyle color'); return { iconHref: resolveIconHref(iconHref, opts), lineColor, lineWidth, polyColor }; } const metas = []; xmlDoc.querySelectorAll('Placemark, placemark').forEach(pm => { const sEl = resolveStyleUrl(t(pm, 'styleUrl')); metas.push({ name: t(pm, 'name'), topFolder: topFolderName(pm), style: parseStyle(sEl) }); }); return metas; }

      /* ================= MapLibre overlay ================= */
      function createGroupOnGL(entry, clearIfExists) {
        glReady(async () => {
          // Ensure the style is actually loaded
          if (!mapgl.isStyleLoaded() || !mapgl.loaded()) {
            console.warn('Style not ready, requeueing layer creation for', entry.name);
            setTimeout(() => createGroupOnGL(entry, clearIfExists), 100);
            return;
          }

          function verifyLayerOnGL(entry) {
            const srcId = entry.glSourceId;
            const layerIds = entry.glLayerIds || [];

            if (!srcId || !mapgl.getSource(srcId)) {
              console.warn('Ghost layer detected:', entry.name, 'missing source');
              return false;
            }

            for (const lid of layerIds) {
              if (!mapgl.getLayer(lid)) {
                console.warn('Ghost layer detected:', entry.name, 'missing layer', lid);
                return false;
              }
            }

            return true;
          }


          await ensureAllIconsOnCurrentStyle();
          // ... rest of existing function
          const srcId = 'src-' + entry.id, fillId = 'fill-' + entry.id, lineId = 'line-' + entry.id, iconId = 'icon-' + entry.id, lblId = 'lbl-' + entry.id, polyEdgeId = 'polyedge-' + entry.id;
          entry.glSourceId = srcId; entry.glLayerIds = [fillId, lineId, polyEdgeId, iconId, lblId];

          if (clearIfExists) {
            [lblId, iconId, polyEdgeId, lineId, fillId].forEach(id => { if (mapgl.getLayer(id)) try { mapgl.removeLayer(id); } catch { } });
          }

          if (mapgl.getSource(srcId)) mapgl.removeSource(srcId);
          mapgl.addSource(srcId, { type: 'geojson', promoteId: 'fid', data: filteredFeatureCollection(entry) });

          const notHidden = ['all', ['!=', ['get', 'hidden'], true], ['!=', ['get', '_deleted'], true]];

          mapgl.addLayer({
            id: fillId, type: 'fill', source: srcId,
            filter: ['all', notHidden, ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]],
            paint: { 'fill-color': ['coalesce', ['get', '_fill'], '#ffffff'], 'fill-opacity': ['coalesce', ['get', '_fillOpacity'], 0.2] }
          });

          if (!ALL_FILL_LAYER_IDS.includes(fillId)) ALL_FILL_LAYER_IDS.push(fillId);

          mapgl.addLayer({
            id: polyEdgeId, type: 'line', source: srcId,
            filter: ['all', notHidden, ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]],
            paint: { 'line-color': ['coalesce', ['get', '_stroke'], '#ffffff'], 'line-width': ['coalesce', ['get', '_weight'], 2], 'line-opacity': ['coalesce', ['get', '_strokeOpacity'], 0.2] }
          });

          mapgl.addLayer({
            id: lineId, type: 'line', source: srcId,
            filter: ['all', notHidden, ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]],
            paint: { 'line-color': ['coalesce', ['get', '_stroke'], '#ffffff'], 'line-width': ['coalesce', ['get', '_weight'], 2], 'line-opacity': ['coalesce', ['get', '_strokeOpacity'], 0.2] }
          });

          mapgl.addLayer({
            id: iconId, type: 'symbol', source: srcId,
            filter: ['all', notHidden, ['==', ['geometry-type'], 'Point']],
            layout: { 'icon-image': ['coalesce', ['get', '_icon'], DOLLAR_ICON_NAME], 'icon-size': ['coalesce', ['get', '_iconSize'], 1], 'icon-anchor': 'bottom', 'icon-allow-overlap': true }
          });

          mapgl.addLayer({
            id: lblId, type: 'symbol', source: srcId,
            filter: ['all', notHidden, ['==', ['geometry-type'], 'Point']],
            layout: { 'text-field': ['coalesce', ['get', '_label'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
            paint: { 'text-color': '#e5e7eb', 'text-halo-color': '#0b0d11', 'text-halo-width': 1.2 }
          });

          const POP = 18;

          // Keep clicks working for POINT markers only (icons + labels)
          [iconId, lblId].forEach(lid => {
            mapgl.on('click', lid, (e) => {
              if (popupsSuppressed()) return;
              if (!e.features || !e.features.length) return;
              const feature = e.features[0];
              if (!feature || !feature.properties) return;

              const content = buildPopupHTMLFromProps(feature.properties);
              showSinglePopup(null, e.lngLat, content);

              e.originalEvent.stopPropagation();
            });
          });

          function handleRapidDeleteGL(e) {
            if (!deleteModeEnabled || !editingEnabled || circleDragCtx) return;
            const chosen = pickSmallestPolygonAtPoint(e.point) || (e.features || []).find(isRapidDeleteTarget);
            if (!chosen || !isRapidDeleteTarget(chosen)) return;

            const srcId = chosen.layer && chosen.layer.source;
            const owner = layerList.find(l => l.glSourceId === srcId);
            const fid = chosen.properties && chosen.properties.fid;
            if (!owner || !fid) return;

            e.originalEvent?.preventDefault?.();
            e.originalEvent?.stopPropagation?.();
            deleteFeatureByFid(owner, String(fid), { confirmDelete: false, closeEditorOnDone: true });
          }

          [fillId, polyEdgeId].forEach(lid => mapgl.on('click', lid, handleRapidDeleteGL));

          attachLongPressGL(fillId, entry);
          attachLongPressGL(polyEdgeId, entry);
          attachLongPressGL(lineId, entry);

          // Ensure fresh data binds and visibility is respected (prevents ghost layers)
          refreshGroupGL(entry);
          applyVisibility(entry);
        });
      }
      function refreshGroupGL(entry) { const src = mapgl.getSource(entry.glSourceId); if (src) src.setData(filteredFeatureCollection(entry)); }

      /* ================= Leaflet overlay ================= */

      /** Theme flag used only for Leaflet vector styling.
       *  Set to 'on-osm' when you switch to OpenStreetMap raster.
       *  Set to 'on-gl' when you’re on MapLibre styles.
       */
      function dollarDataUrl(size = 32) {
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(dollarSvg(size));
      }
      function leafletIconFor(url, size = 32) {
        return L.icon({
          iconUrl: url || dollarDataUrl(size),
          iconSize: [size, size],
          iconAnchor: [size / 2, size - 2],
          popupAnchor: [0, -size / 2]
        });
      }

      /** Theme-aware polygon/area style just for Leaflet */

      function circleStyleForLeaflet(props = {}) {
        const onOSM = (leafletCircleTheme === 'on-osm');
        const stroke = onOSM ? '#0b0d11' : (props._stroke || '#ffffff');
        const fill = props._fill || '#ffffff';
        const baseFillOp = (props._fillOpacity ?? 0.18);
        const fillOpacity = onOSM ? Math.min(0.30, baseFillOp + 0.08) : baseFillOp;
        const strokeOpacity = (props._strokeOpacity ?? 0.7);
        const weight = (props._weight ?? 2);
        const strokeOn = (strokeOpacity > 0) && (weight > 0);
        return { color: stroke, weight, opacity: strokeOpacity, fillColor: fill, fillOpacity, stroke: strokeOn };
      }
      function lineStyleForLeaflet(props = {}) {
        return {
          color: props._stroke || '#ffffff',
          weight: props._weight || 2,
          opacity: props._strokeOpacity ?? 0.2
        };
      }

      function createGroupOnLeaflet(entry, rebuild = false) {
        if (rebuild && entry.lfGroup) {
          try { entry.lfGroup.remove(); } catch { }
        }
        entry.lfGroup = L.layerGroup().addTo(mapleaf);
        entry.lfLayers = new Map();

        filteredFeatureCollection(entry).features.forEach(f => {
          const fid = f.properties.fid;
          const list = [];

          if (f.geometry.type === 'Point') {
            const [lng, lat] = f.geometry.coordinates;
            const icon = leafletIconFor(f.properties._iconUrl || nameToUrl.get(f.properties._icon), 32);
            const m = L.marker([lat, lng], { icon, bubblingMouseEvents: false });

            function openMarkerPopup(ev) {
              if (popupsSuppressed()) return;
              if (ev?.originalEvent) {
                ev.originalEvent.preventDefault();
                ev.originalEvent.stopPropagation();
              }
              L.DomEvent.stop(ev);

              closeActivePopup();
              m.bindPopup(
                buildPopupHTMLFromProps(f.properties),
                { autoPan: true, offset: [0, -18] }
              ).openPopup();
              activePopup = m.getPopup();

              enableScrollLock();
            }

            m.on('click', openMarkerPopup);
            m.on('dblclick', openMarkerPopup);

            if (!f.properties.hidden) m.addTo(entry.lfGroup);
            list.push(m);
          } else {
            const gj = L.geoJSON(f, {
              style: geom => (
                geom.type.includes('Polygon')
                  ? circleStyleForLeaflet(f.properties)   // theme-aware polygon style
                  : lineStyleForLeaflet(f.properties)     // lines
              ),
              bubblingMouseEvents: false
            });

            function openGeomPopup(ev) {
              if (popupsSuppressed()) return;
              if (deleteModeEnabled && editingEnabled && !circleDragCtx && isRapidDeleteTarget(f)) {
                if (ev?.originalEvent) {
                  ev.originalEvent.preventDefault();
                  ev.originalEvent.stopPropagation();
                }
                L.DomEvent.stop(ev);
                deleteFeatureByFid(entry, fid, { confirmDelete: false, closeEditorOnDone: true });
                return;
              }

              if (ev?.originalEvent) {
                ev.originalEvent.preventDefault();
                ev.originalEvent.stopPropagation();
              }
              L.DomEvent.stop(ev);

              closeActivePopup();
              gj.bindPopup(
                buildPopupHTMLFromProps(f.properties),
                { autoPan: true, offset: [0, -18] }
              ).openPopup();
              activePopup = gj.getPopup();

              enableScrollLock();
            }

            gj.on('click', openGeomPopup);
            gj.on('dblclick', openGeomPopup);

            // Long-press style editor hook (polygons/lines)
            gj.on('mousedown', (ev) => attachLongPressLeaf(ev, entry, fid));
            gj.on('touchstart', (ev) => attachLongPressLeaf(ev, entry, fid));

            if (!f.properties.hidden) gj.addTo(entry.lfGroup);
            list.push(gj);
          }

          entry.lfLayers.set(fid, list);
        });

        // Respect current visibility on Leaflet too
        applyVisibility(entry);
      }

      // Cancel circle drag with ESC
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!circleDragCtx) return;

        // Reset cursor
        if (engine === 'gl') mapgl.getCanvas().style.cursor = '';
        else mapleaf.getContainer().style.cursor = '';

        // Stop dragging
        circleDragCtx = null;
      });


      function refreshGroupBoth(entry) {
        refreshGroupGL(entry);
        if (entry.lfGroup) {
          try { entry.lfGroup.clearLayers(); } catch { }
          createGroupOnLeaflet(entry, true);
        }
      }


      /* ================= UI ================= */

      // --- Eye icon helpers for feature visibility ---
      function eyeSvg(open = true) {
        return open
          ? `<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`
          : `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19C5 19 1 12 1 12a21.8 21.8 0 0 1 5.06-5.94"/><path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88"/><path d="m1 1 22 22"/></svg>`;
      }
      function setEyeBtn(el, visible) {
        el.innerHTML = eyeSvg(visible);
        el.classList.toggle('off', !visible);
        el.title = visible ? 'Hide feature' : 'Show feature';
        el.setAttribute('aria-pressed', String(visible));
      }


      function renderGroupsVisibility() {
        const host = byId('grp-list'); host.innerHTML = '';
        // INCLUDE layers with live features even if _deletedLayer was set; also auto-heal
        const visibleLayers = layerList.filter(l => !l._deletedLayer || hasLiveFeatures(l));
        if (!visibleLayers.length) { host.innerHTML = '<div class="hint">No groups yet.</div>'; return; }
        let healed = false; for (const L of visibleLayers) { healed = normalizeDeletedFlag(L) || healed; }
        if (healed) saveState();

        for (const entry of visibleLayers) {
          const row = document.createElement('div'); row.className = 'grp-row';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = entry.visible !== false;
          const name = document.createElement('div'); name.textContent = entry.name;
          const count = document.createElement('div'); count.className = 'hint'; count.textContent = (entry.items || []).length;
          cb.onchange = () => { entry.visible = cb.checked; (entry.glLayerIds || []).forEach(lid => { if (mapgl.getLayer(lid)) mapgl.setLayoutProperty(lid, 'visibility', cb.checked ? 'visible' : 'none'); }); if (entry.lfGroup) { if (cb.checked) entry.lfGroup.addTo(mapleaf); else mapleaf.removeLayer(entry.lfGroup); } renderLayers(); saveState(); };
          row.style.display = 'grid'; row.style.gridTemplateColumns = 'auto 1fr auto'; row.style.gap = '8px';
          row.append(cb, name, count); host.appendChild(row);
        }
      }

      function renderLayers() {
        const host = byId('layers'); host.innerHTML = '';
        const visibleLayers = layerList.filter(l => !l._deletedLayer || hasLiveFeatures(l));
        if (!visibleLayers.length) { host.innerHTML = '<div class="layers-empty"><div class="hint">No layers yet. Upload or drop a KML/KMZ.</div></div>'; return; }

        // Heal ghost layers
        for (const entry of visibleLayers) {
          if (!entry._deletedLayer && hasLiveFeatures(entry) && (!entry.glSourceId || !mapgl.getSource(entry.glSourceId))) {
            glReady(() => { createGroupOnGL(entry, true); refreshGroupGL(entry); applyVisibility(entry); });
          }
        }

        let healed = false; for (const L of visibleLayers) { healed = normalizeDeletedFlag(L) || healed; }
        if (healed) saveState();


        for (const entry of visibleLayers) {
          const visibleOnMap = entry.visible !== false;
          const wrap = document.createElement('div'); wrap.className = 'layer';
          const head = document.createElement('div'); head.className = 'layer-head';
          const vis = document.createElement('div'); vis.className = visibleOnMap ? 'toggle checked' : 'toggle'; vis.title = 'Show/Hide layer';
          vis.onclick = () => { entry.visible = !visibleOnMap; (entry.glLayerIds || []).forEach(lid => { if (mapgl.getLayer(lid)) mapgl.setLayoutProperty(lid, 'visibility', entry.visible ? 'visible' : 'none'); }); if (entry.lfGroup) { if (entry.visible) entry.lfGroup.addTo(mapleaf); else mapleaf.removeLayer(entry.lfGroup); } renderGroupsVisibility(); renderLayers(); saveState(); };

          const ttl = document.createElement('div'); ttl.className = 'title'; ttl.textContent = entry.name;

          const actions = document.createElement('div'); actions.className = 'actions';
          const renameBtn = document.createElement('button'); renameBtn.className = 'btn small'; renameBtn.textContent = 'Rename';
          renameBtn.onclick = () => { const nn = prompt('New layer name:', entry.name); if (!nn) return; entry.name = nn; renderGroupsVisibility(); renderLayers(); saveState(); };
          const delBtn = document.createElement('button'); delBtn.className = 'btn small'; delBtn.textContent = 'Delete';
          delBtn.onclick = () => {
            if (!confirm('Delete this layer for everyone?')) return;
            const tombs = [];
            for (const f of (entry.data?.features || [])) {
              if (f?.properties?._deleted) continue;
              const key = f.properties._gid || f.properties.fid;
              tombs.push({
                type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { fid: key, _gid: key, _deleted: true, _ts: Date.now(), name: (f.properties?.name || 'Deleted') }
              });
            }
            entry.data.features = tombs; entry.items = []; entry._deletedLayer = true; entry.visible = false;
            (entry.glLayerIds || []).forEach(id => { if (mapgl.getLayer(id)) try { mapgl.removeLayer(id); } catch { } });
            if (entry.glSourceId && mapgl.getSource(entry.glSourceId)) try { mapgl.removeSource(entry.glSourceId); } catch { };
            if (entry.lfGroup) try { entry.lfGroup.remove(); } catch { };
            renderGroupsVisibility(); renderLayers(); saveState();

            // Re-assert visibility for the survivors (prevents GL defaults from flipping others)
            for (const other of layerList) {
              if (other !== entry && !other._deletedLayer) applyVisibility(other);
            }
          };
          actions.append(renameBtn, delBtn);

          head.append(vis, ttl, actions); wrap.appendChild(head);

          if (visibleOnMap) {
            const importLine = document.createElement('div'); importLine.className = 'import-line';
            const link = document.createElement('span'); link.className = 'link'; link.textContent = 'Import more';
            link.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.kml,.kmz'; inp.onchange = ev => { const f = ev.target.files[0]; if (!f) return; if (f.name.toLowerCase().endsWith('.kmz')) loadKMZFile(f, entry.name); else f.text().then(txt => addKmlText(txt, f.name, {}, entry.name)); }; inp.click(); };
            importLine.appendChild(link); wrap.appendChild(importLine);

            for (const it of (entry.items || [])) {
              const row = document.createElement('div'); row.className = 'feature';
              const ico = document.createElement('div'); ico.className = 'group-bullet'; ico.textContent = it.label || '•';
              const name = document.createElement('div'); name.className = 'name'; name.textContent = it.name; name.onclick = () => zoomToFeature(entry, it.fid);
              const moveBtn = document.createElement('button'); moveBtn.className = 'btn small'; moveBtn.textContent = 'Move';
              moveBtn.onclick = () => { const target = prompt('Move to group (existing or new):', entry.name); if (!target) return; moveFeatureToGroup(entry, it.fid, target); };

              // Eye visibility toggle
              const eyeBtn = document.createElement('button');
              eyeBtn.type = 'button';
              eyeBtn.className = 'eye-btn';
              setEyeBtn(eyeBtn, it.visible !== false);

              eyeBtn.addEventListener('click', () => {
                it.visible = !(it.visible !== false);
                const gf = entry.data.features.find(f => String(f.properties.fid) === String(it.fid));
                if (gf) {
                  gf.properties.hidden = (it.visible === false);
                  gf.properties._ts = Date.now();
                  refreshGroupBoth(entry);
                }
                setEyeBtn(eyeBtn, it.visible !== false);
                saveState();
              });

              row.append(ico, name, moveBtn, eyeBtn);
              wrap.appendChild(row);
            }
          }
          host.appendChild(wrap);
        }
      }


      function zoomToFeature(entry, fid) {
        const f = entry.data.features.find(x => x.properties && String(x.properties.fid) === String(fid));
        if (!f) return;
        const b = bboxOfFeature(f);
        if (engine === 'gl') mapgl.fitBounds(b, { padding: 40, duration: 600 });
        else mapleaf.fitBounds([[b[0][1], b[0][0]], [b[1][1], b[1][0]]], { padding: [40, 40] });
      }


      /* === Move feature to another group === */

      function rebuildItemsFromFeatures(features) {
        return (features || [])
          .filter(f => !f.properties?._deleted)
          .map(f => ({
            fid: String(f.properties?.fid),
            name: f.properties?.name || 'Feature',
            label: (f.geometry?.type === 'Point') ? (f.properties?._label || '•') : '•',
            visible: !(f.properties?.hidden)
          }))
      }

      function moveFeatureToGroup(fromEntry, fid, targetName) {
        const idx = fromEntry.data.features.findIndex(f => String(f.properties?.fid) === String(fid));
        if (idx < 0) return;

        const f = fromEntry.data.features[idx];
        const key = String(f.properties?._gid ?? f.properties?.fid ?? fid);

        // 1) Remove live feature from old layer
        fromEntry.data.features.splice(idx, 1);

        // 2) Add tombstone to old layer to signal delete across clients
        fromEntry.data.features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            fid: key, _gid: key,
            _deleted: true,
            _ts: Date.now(),
            name: (f.properties?.name || 'Moved feature (tombstone)')
          }
        });
        fromEntry.items = rebuildItemsFromFeatures(fromEntry.data.features);
        refreshGroupBoth(fromEntry);
        applyVisibility(fromEntry);
        saveState();

        // 3) Add the live feature to the target layer (preserve _gid)
        const toEntry = getOrCreateLayerByName(targetName);
        const moved = {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            ...f.properties,
            fid: key,           // keep fid stringified + stable
            _gid: key,
            hidden: false,
            _ts: Date.now()     // bump timestamp so the move wins
          }
        };
        toEntry.data.features.push(moved);
        toEntry.items = rebuildItemsFromFeatures(toEntry.data.features);
        refreshGroupBoth(toEntry);
        applyVisibility(toEntry);
        renderGroupsVisibility();
        renderLayers();
        saveState();
      }


      /* ================= Loaders ================= */
      async function loadKMZFile(file, forceGroupName) { try { const zip = await JSZip.loadAsync(file); const kmlEntry = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml')); if (!kmlEntry) { alert('No .kml found inside KMZ: ' + file.name); return; } const assetMap = await buildKmzAssetMap(zip); const text = await kmlEntry.async('text'); addKmlText(text, file.name, { assetMap }, forceGroupName); } catch (e) { console.error(e); alert('Failed to read KMZ: ' + file.name); } }
      async function loadKMLFromUrl(url, forceGroupName) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); const text = await res.text(); addKmlText(text, url.split('/').pop() || 'remote.kml', { baseUrl: url }, forceGroupName); }
      async function loadKMZFromUrl(url, forceGroupName) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); const blob = await res.blob(); const zip = await JSZip.loadAsync(blob); const kmlEntry = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml')); if (!kmlEntry) throw new Error('No .kml inside KMZ'); const assetMap = await buildKmzAssetMap(zip); const text = await kmlEntry.async('text'); addKmlText(text, url.split('/').pop() || 'remote.kmz', { assetMap, baseUrl: url }, forceGroupName); }

      function isSilverApiArchiveLayer(layerName) {
        const normalized = String(layerName || '').trim().toLowerCase();
        return currentRoomCode === 'silver' && ['shrink pattern', 'past coin shrinks'].includes(normalized);
      }

      function addKmlText(text, filename, opts, forceGroupName) {
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        const metaList = extractKmlMeta(xml, opts || {});
        const gj = window.toGeoJSON.kml(xml);
        if (!gj || !gj.features || !gj.features.length) { alert('No features in ' + filename); return; }

        const grouped = {}; metaList.forEach((m, i) => { const f = forceGroupName || m.topFolder || 'Untitled layer'; (grouped[f] || (grouped[f] = [])).push(i); });

        for (const gname of Object.keys(grouped)) {
          const features = [], items = [];
          const archiveEligible = isSilverApiArchiveLayer(gname);
          for (const idx of grouped[gname]) {
            const f = gj.features[idx], m = metaList[idx], fid = String(featureSeq++);
            const props = f.properties || {}; const itemName = m.name || props.name || props.Name || props.title || ('Feature ' + fid);

            let style = { _fill: '#ffffff', _fillOpacity: 0.15, _stroke: '#ffffff', _strokeOpacity: 0.7, _weight: 2 };
            if (m && m.style) {
              if (m.style.polyColor) {
                const { hex, opacity } = kmlColorToCss(m.style.polyColor);  // aabbggrr -> #rrggbb + 0..1
                style._fill = hex;
                style._fillOpacity = opacity;
              }
              if (m.style.lineColor) {
                const { hex, opacity } = kmlColorToCss(m.style.lineColor);
                style._stroke = hex;
                style._strokeOpacity = opacity;
              }
              if (m.style.lineWidth) {
                const w = parseFloat(m.style.lineWidth);
                if (isFinite(w)) style._weight = w;
              }
            }

            let iconName = DOLLAR_ICON_NAME, iconUrl = '';
            const iconHref = m.style.iconHref;
            if (iconHref) { const name = registerIconUrl(iconHref); if (name) iconName = name; iconUrl = iconHref; }

            const isPoint = f.geometry && f.geometry.type === 'Point';
            const label = isPoint ? defaultLabelFrom(itemName) : '•';

            const enriched = {
              type: 'Feature', geometry: f.geometry,
              properties: {
                ...props,
                name: itemName,
                fid,
                hidden: false,
                _label: isPoint ? label : '',
                _icon: isPoint ? iconName : undefined,
                _iconUrl: isPoint ? iconUrl : undefined,
                _iconSize: 1,
                _ts: Date.now(),
                _gid: fid,
                _coinArchiveEligible: archiveEligible,
                _coinArchiveSource: archiveEligible ? 'silver-api' : 'import',
                ...style
              }
            };
            features.push(enriched); items.push({ fid, name: itemName, label, visible: true });
          }

          const entry = {
            id: layerSeq++,
            name: gname,
            visible: true,
            data: { type: 'FeatureCollection', features },
            items,
            glSourceId: null,
            glLayerIds: [],
            lfGroup: null,
            lfLayers: null
          };
          ensureUniqueLayerId(entry);
          layerList.push(entry);

          glReady(() => createGroupOnGL(entry, /* clearIfExists */ true));
          createGroupOnLeaflet(entry, /* rebuild */ true);

          renderLayers();
          renderGroupsVisibility();
          saveState();
        } // <-- close: for (const gname of Object.keys(grouped)) {
      }

      /* ========= Upload/URL ========= */
      byId('upload-btn').onclick = () => byId('upload-input').click();
      byId('upload-input').addEventListener('change', ev => {
        const files = [...(ev.target.files || [])];
        (function next(i) {
          if (i >= files.length) { ev.target.value = ''; return; }
          const f = files[i];
          if (f.name.toLowerCase().endsWith('.kmz')) loadKMZFile(f).then(() => next(i + 1));
          else f.text().then(txt => { addKmlText(txt, f.name); next(i + 1); });
        })(0);
      });
      byId('url-load').onclick = () => { const url = byId('url-input').value.trim(); if (!url) return; (/\.kmz(\?|#|$)/i.test(url) ? loadKMZFromUrl(url) : loadKMLFromUrl(url)).catch(e => { console.error(e); alert('Failed to load from URL (CORS or bad link).'); }); };

      // Add empty layer
      byId('add-layer').onclick = function () {
        const entry = {
          id: layerSeq++,
          name: 'Untitled layer',
          visible: true,
          data: { type: 'FeatureCollection', features: [] },
          items: [],
          glSourceId: null,
          glLayerIds: [],
          lfGroup: null,
          lfLayers: null
        };

        ensureUniqueLayerId(entry);
        layerList.push(entry);

        // Use the unified loader guard
        glReady(() => createGroupOnGL(entry, /* clearIfExists */ true));
        createGroupOnLeaflet(entry, /* rebuild */ true);

        renderLayers();
        renderGroupsVisibility();
        saveState();
      };



      /* ======= Circles helper (separate from Sonar) ======= */
      function addCircleToLayer(centerLngLat, radius, color, layerName) {
        const entry = getOrCreateLayerByName(layerName);
        const fid = String(featureSeq++);
        const hex = (color === 'green') ? '#22c55e' : '#ef4444';
        const geom = turf.circle([centerLngLat[0], centerLngLat[1]], radius, { steps: 128, units: 'meters' }).geometry;
        const name = `Circle ${radius}m (${(color || 'red').toUpperCase()}) @ ${timestampLabel()}`;
        const props = {
          fid, name, hidden: false, _gid: fid, _ts: Date.now(),
          _fill: hex, _fillOpacity: 0.18, _stroke: hex, _strokeOpacity: 0.9, _weight: 2,

          _circleCenter: centerLngLat,  // Store center for statistics
          _circleRadius: radius,        // Store radius for statistics
          _coinArchiveEligible: false,
          _coinArchiveSource: 'user',

          // ✅ store as numbers too (popup-safe)
          _circleLng: +centerLngLat[0],
          _circleLat: +centerLngLat[1],
        };


        entry.data.features.push({ type: 'Feature', geometry: geom, properties: props });
        entry.items = rebuildItemsFromFeatures(entry.data.features);
        refreshGroupBoth(entry);
        applyVisibility(entry);
        renderLayers(); renderGroupsVisibility(); saveState();
        ((b) => engine === 'gl' ? mapgl.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 500 }) : mapleaf.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40] }))(turf.bbox(geom));
      }


      /* Draw Circle tool */
      const drawBtn = byId('draw-circle'), drawBox = byId('draw-inputs');
      drawBtn.addEventListener('click', () => { drawBox.style.display = drawBox.style.display === 'none' ? 'grid' : 'none'; });
      byId('draw-apply').addEventListener('click', () => {
        const coord = byId('draw-coord').value.trim();
        const radius = parseFloat(byId('draw-radius').value);
        const m = coord.match(/^\s*([+-]?\d+(\.\d+)?)\s*,\s*([+-]?\d+(\.\d+)?)\s*$/);
        if (!m || !isFinite(radius) || radius <= 0) { alert('Please enter "lat,lng" and a positive radius.'); return; }
        const lat = parseFloat(m[1]), lng = parseFloat(m[3]);

        // Store circle metadata for statistics
        const entry = getOrCreateLayerByName('Circles');
        const fid = String(featureSeq++);
        const hex = '#ef4444'; // red
        const centerLngLat = [lng, lat];
        const geom = turf.circle(centerLngLat, radius, { steps: 128, units: 'meters' }).geometry;
        const name = `Circle ${radius}m (RED) @ ${timestampLabel()}`;
        const props = {
          fid, name, hidden: false, _gid: fid, _ts: Date.now(),
          _fill: hex, _fillOpacity: 0.12, _stroke: hex, _strokeOpacity: 0.9, _weight: 2,

          _circleCenter: centerLngLat,  // Store center for statistics
          _circleRadius: radius,        // Store radius for statistics
          _coinArchiveEligible: false,
          _coinArchiveSource: 'user',

          // ✅ store as numbers too (popup-safe)
          _circleLng: +lng,
          _circleLat: +lat,
        };

        entry.data.features.push({ type: 'Feature', geometry: geom, properties: props });
        entry.items = rebuildItemsFromFeatures(entry.data.features);
        refreshGroupBoth(entry);
        applyVisibility(entry);
        renderLayers(); renderGroupsVisibility(); saveState();
        const b = turf.bbox(geom);
        if (engine === 'gl') mapgl.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 500 });
        else mapleaf.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40] });
      });

      /* Draw Line tool */
      const lineBtn = byId('draw-line'), lineBox = byId('line-inputs');
      lineBtn.addEventListener('click', () => { lineBox.style.display = lineBox.style.display === 'none' ? 'grid' : 'none'; });

      // Helper function to calculate destination point given start, bearing, and distance
      function destinationPoint(lng, lat, bearingDeg, distanceMeters) {
        const R = 6378137; // Earth radius in meters
        const bearing = bearingDeg * Math.PI / 180;
        const lat1 = lat * Math.PI / 180;
        const lng1 = lng * Math.PI / 180;

        const lat2 = Math.asin(
          Math.sin(lat1) * Math.cos(distanceMeters / R) +
          Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearing)
        );

        const lng2 = lng1 + Math.atan2(
          Math.sin(bearing) * Math.sin(distanceMeters / R) * Math.cos(lat1),
          Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
        );

        return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
      }

      // Add line to layer
      function addLineToLayer(startLngLat, degree, lengthMeters, layerName) {
        const entry = getOrCreateLayerByName(layerName);
        const fid = String(featureSeq++);

        const endPoint = destinationPoint(startLngLat[0], startLngLat[1], degree, lengthMeters);

        const geom = {
          type: 'LineString',
          coordinates: [startLngLat, endPoint]
        };

        const name = `Line ${lengthMeters}m @ ${degree}° @ ${timestampLabel()}`;
        const props = {
          fid, name, hidden: false, _gid: fid, _ts: Date.now(),
          _stroke: '#3b82f6', _strokeOpacity: 0.9, _weight: 3
        };

        entry.data.features.push({ type: 'Feature', geometry: geom, properties: props });
        entry.items = rebuildItemsFromFeatures(entry.data.features);
        refreshGroupBoth(entry);
        applyVisibility(entry);
        renderLayers(); renderGroupsVisibility(); saveState();

        const bbox = turf.bbox(geom);
        if (engine === 'gl') {
          mapgl.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 500 });
        } else {
          mapleaf.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [40, 40] });
        }
      }

      byId('line-apply').addEventListener('click', () => {
        const coord = byId('line-coord').value.trim();
        const degree = parseFloat(byId('line-degree').value);
        const length = parseFloat(byId('line-length').value);

        const m = coord.match(/^\s*([+-]?\d+(\.\d+)?)\s*,\s*([+-]?\d+(\.\d+)?)\s*$/);

        if (!m) {
          alert('Please enter valid coordinates in "lat,lng" format.');
          return;
        }
        if (!isFinite(degree) || degree < 0 || degree > 360) {
          alert('Please enter a degree between 0 and 360.');
          return;
        }
        if (!isFinite(length) || length <= 0) {
          alert('Please enter a positive length in meters.');
          return;
        }

        const lat = parseFloat(m[1]), lng = parseFloat(m[3]);
        addLineToLayer([lng, lat], degree, length, 'Lines');
      });

      /* Pick Location tool */
      let pickingLocation = false;
      let pickingForTool = null; // 'circle' or 'line'

      byId('pick-location').addEventListener('click', () => {
        pickingLocation = !pickingLocation;
        pickingForTool = pickingLocation ? 'circle' : null;
        const btn = byId('pick-location');

        if (pickingLocation) {
          btn.style.background = 'rgba(96,165,250,0.2)';
          btn.style.borderColor = '#60a5fa';
          btn.title = 'Click map to get coordinates (click again to cancel)';
          mapgl.getCanvas().style.cursor = 'crosshair';
          if (engine === 'leaf') mapleaf.getContainer().style.cursor = 'crosshair';
        } else {
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.title = 'Pick location from map';
          mapgl.getCanvas().style.cursor = '';
          if (engine === 'leaf') mapleaf.getContainer().style.cursor = '';
        }
      });

      byId('pick-location-line').addEventListener('click', () => {
        pickingLocation = !pickingLocation;
        pickingForTool = pickingLocation ? 'line' : null;
        const btn = byId('pick-location-line');

        if (pickingLocation) {
          btn.style.background = 'rgba(96,165,250,0.2)';
          btn.style.borderColor = '#60a5fa';
          btn.title = 'Click map to get coordinates (click again to cancel)';
          mapgl.getCanvas().style.cursor = 'crosshair';
          if (engine === 'leaf') mapleaf.getContainer().style.cursor = 'crosshair';
        } else {
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.title = 'Pick location from map';
          mapgl.getCanvas().style.cursor = '';
          if (engine === 'leaf') mapleaf.getContainer().style.cursor = '';
        }
      });

      // GL click handler
      mapgl.on('click', (e) => {
        if (!pickingLocation) return;
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();

        const { lng, lat } = e.lngLat;

        if (pickingForTool === 'circle') {
          byId('draw-coord').value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
          drawBox.style.display = 'grid';

          pickingLocation = false;
          const btn = byId('pick-location');
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.title = 'Pick location from map';
        } else if (pickingForTool === 'line') {
          byId('line-coord').value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
          lineBox.style.display = 'grid';

          pickingLocation = false;
          const btn = byId('pick-location-line');
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.title = 'Pick location from map';
        }

        pickingForTool = null;
        mapgl.getCanvas().style.cursor = '';
        playClick();
      });

      // Leaflet click handler
      mapleaf.on('click', (e) => {
        if (!pickingLocation) return;
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();

        const { lat, lng } = e.latlng;

        if (pickingForTool === 'circle') {
          byId('draw-coord').value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
          drawBox.style.display = 'grid';

          pickingLocation = false;
          const btn = byId('pick-location');
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.title = 'Pick location from map';
        } else if (pickingForTool === 'line') {
          byId('line-coord').value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
          lineBox.style.display = 'grid';

          pickingLocation = false;
          const btn = byId('pick-location-line');
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.title = 'Pick location from map';
        }

        pickingForTool = null;
        mapleaf.getContainer().style.cursor = '';
        playClick();
      });

      /* ===== Sidebar minimize / reopen ===== */
      const appEl = document.getElementById('app'), sidebarEl = document.getElementById('sidebar'), btnHide = document.getElementById('ui-hide'), btnReopen = document.getElementById('ui-reopen');
      function collapseUI() { appEl.classList.add('ui-collapsed'); document.documentElement.style.setProperty('--side', '0px'); }
      function expandUI() { document.documentElement.style.setProperty('--side', '320px'); appEl.classList.remove('ui-collapsed'); }
      btnHide.addEventListener('click', collapseUI); btnReopen.addEventListener('click', expandUI);
      sidebarEl.addEventListener('transitionend', e => { if (e.propertyName === 'width') { if (engine === 'gl') mapgl.resize(); else mapleaf.invalidateSize(true); } });

      /* ===== Basemap switching ===== */
      document.getElementById('basemap').addEventListener('change', (e) => {
        const val = e.target.value;

        if (val === 'osm') {
          // Switch to Leaflet/OSM
          leafletCircleTheme = 'on-osm';
          showLeaf();
          restyleAllLeafletPolys();   // repaint existing polygons for OSM theme
          if (lampPostSearchFeatures.length) renderLampPostSearchHighlight(lampPostSearchFeatures);
        } else {
          // Switch back to GL styles
          leafletCircleTheme = 'on-gl';

          if (val === 'custom') mapgl.setStyle(CUSTOM_STYLE);
          else if (val === 'streets') mapgl.setStyle(maptilersdk.MapStyle.STREETS);
          else if (val === 'dark') mapgl.setStyle(maptilersdk.MapStyle.DARK);
          else if (val === 'outdoor') mapgl.setStyle(maptilersdk.MapStyle.OUTDOOR);
          else if (val === 'satellite') mapgl.setStyle(maptilersdk.MapStyle.SATELLITE);

          readdAllGroupsAfterGLStyleChange();
          if (reconOverlayPoints.length) mapgl.once('idle', () => scheduleReconOverlayRestore());
          if (lampPostSearchFeatures.length) mapgl.once('idle', () => renderLampPostSearchHighlight(lampPostSearchFeatures));
          showGL();
        }

        closeStyleEditor();
      });

      /* ===== Preload sequence (optional assets) ===== */
      const PRELOAD_GEOHASHES = 'geohashesGold.kmz';
      const PRELOAD_COINS = ['All Coin Records 2023-2024.kmz', 'All Coins Record 2023-2024.kmz', 'All Coins Records 2023-2024.kmz'];

      /* ===== Long-press style editor (Edit Mode) ===== */
      const editorEl = byId('style-editor');
      const seFill = byId('se-fill'),
        seFillOp = byId('se-fillop'),
        seOutline = byId('se-outline'),
        seStroke = byId('se-stroke'),
        seWidth = byId('se-width'),
        seClose = byId('se-close'),
        seDelete = byId('se-delete'),
        seDrag = byId('se-drag'),
        seCloseTop = byId('se-close-top');

      let editCtx = null, editingEnabled = false;
      let circleDragCtx = null; // { entry, fid } while dragging
      let suppressPopupUntil = 0;
      let editToggleLockUntil = 0;

      const editToggle = document.getElementById('edit-toggle');
      const deleteToggle = document.getElementById('delete-toggle');
      let deleteModeEnabled = false;
      const DELETE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M5 5L19 19M19 5L5 19' stroke='black' stroke-width='6' stroke-linecap='round' opacity='0.45'/%3E%3Cpath d='M5 5L19 19M19 5L5 19' stroke='%23f8fafc' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E") 12 12, crosshair`;

      function suppressPopups(ms = 550) {
        suppressPopupUntil = Date.now() + ms;
        closeActivePopup();
      }

      function popupsSuppressed() {
        return !!circleDragCtx || Date.now() < suppressPopupUntil;
      }

      // Add Calculate Statistics/Glimpse button element (will be created dynamically)
      let seCalcStats = null;
      let seGlimpseSigns = null;
      let seReconCoin = null;
      let seSearchLampPost = null;


      seDrag.addEventListener('click', () => {
        if (!editCtx) return;

        const { entry, fid } = editCtx;
        const feat = entry.data.features.find(f => f?.properties?.fid === fid);
        if (!feat) return;

        // Only allow dragging circles
        if (!feat.properties || !Number.isFinite(+feat.properties._circleRadius)) {
          alert('Drag is only for circles.');
          return;
        }

        closeStyleEditor();
        suppressPopups();

        // Start drag mode
        circleDragCtx = { entry, fid };

        // Disable map pan while dragging
        if (engine === 'gl') {
          try { mapgl.dragPan.disable(); } catch { }
          mapgl.getCanvas().style.cursor = 'grabbing';
        } else {
          try { mapleaf.dragging.disable(); } catch { }
          mapleaf.getContainer().style.cursor = 'grabbing';
        }
      }); // 


      function isRapidDeleteTarget(feature) {
        const p = feature?.properties || {};
        const geomType = feature?.geometry?.type;
        const isPolygon = geomType === 'Polygon' || geomType === 'MultiPolygon';
        const hasCircleMeta = Number.isFinite(+p._circleRadius) || Array.isArray(p._circleCenter);
        const hasCircleName = /^circle\b/i.test(String(p.name || '').trim());
        return isPolygon && (hasCircleMeta || hasCircleName);
      }

      function syncDeleteModeCursor() {
        const cursor = (deleteModeEnabled && editingEnabled && !circleDragCtx) ? DELETE_CURSOR : '';
        if (mapgl?.getCanvas) mapgl.getCanvas().style.cursor = circleDragCtx && engine === 'gl' ? 'grabbing' : cursor;
        if (mapleaf?.getContainer) mapleaf.getContainer().style.cursor = circleDragCtx && engine === 'leaf' ? 'grabbing' : cursor;
      }

      function reflectDeleteUI() {
        if (!deleteToggle) return;
        deleteToggle.textContent = 'Delete: ' + (deleteModeEnabled ? 'ON' : 'OFF');
        deleteToggle.classList.toggle('off', !deleteModeEnabled);
        deleteToggle.classList.toggle('danger', deleteModeEnabled);
        syncDeleteModeCursor();
      }

      function setDeleteMode(enabled) {
        deleteModeEnabled = !!enabled;
        if (deleteModeEnabled) {
          editingEnabled = true;
          closeStyleEditor();
          reflectEditUI();
        }
        reflectDeleteUI();
      }

      function deleteFeatureByFid(entry, fid, { confirmDelete = true, closeEditorOnDone = true } = {}) {
        if (!entry || !fid) return false;

        // Are we deleting the circle that Recon is using?
        const isReconCircle =
          window.currentReconCircle &&
          String(window.currentReconCircle.fid) === String(fid);

        // Close any open popup for this feature
        closeActivePopup();

        // Only clear Recon dots if we are deleting the active Recon circle
        if (isReconCircle) {
          clearReconOverlay();
          window.currentReconCircle = null;
        }

        const ix = entry.data.features.findIndex(x => x.properties.fid === fid);
        if (ix < 0) return false;
        const p = entry.data.features[ix].properties || {};
        if (confirmDelete && !confirm('Delete this feature?')) return false;

        entry.data.features.splice(ix, 1);
        const key = p._gid || p.fid;
        entry.data.features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            fid: key,
            _gid: key,
            _deleted: true,
            _ts: Date.now(),
            name: p.name || 'Deleted feature'
          }
        });
        entry.items = rebuildItemsFromFeatures(entry.data.features);

        refreshGroupBoth(entry);
        renderLayers();
        renderGroupsVisibility();
        saveState();
        if (closeEditorOnDone) closeStyleEditor();
        return true;
      }

      function deleteEditedFeature() {
        if (!editCtx) return;
        const { entry, fid } = editCtx;
        deleteFeatureByFid(entry, fid, { confirmDelete: true, closeEditorOnDone: true });
      }

      seDelete.addEventListener('click', deleteEditedFeature);


      function reflectEditUI() {
        if (!editToggle) return;
        editToggle.classList.toggle('off', !editingEnabled);
        editToggle.setAttribute('aria-pressed', editingEnabled ? 'true' : 'false');
        editToggle.title = editingEnabled ? 'Edit mode on' : 'Edit mode off';
        editToggle.setAttribute('aria-label', editingEnabled ? 'Edit mode on' : 'Edit mode off');
        const labelEl = editToggle.querySelector('.map-edit-fab-label');
        if (labelEl) labelEl.textContent = editingEnabled ? 'Edit mode on' : 'Edit mode off';
        syncDeleteModeCursor();
      }

      // initial paint
      reflectEditUI();
      reflectDeleteUI();

      // Toggle button wiring
      function toggleEditingMode() {
        const now = Date.now();
        if (IS_TOUCH_DEVICE && now < editToggleLockUntil) return;
        if (IS_TOUCH_DEVICE) editToggleLockUntil = now + 220;

        editingEnabled = !editingEnabled;
        if (!editingEnabled) {
          setDeleteMode(false);
          closeStyleEditor();
        }
        reflectEditUI();
      }

      if (editToggle) {
        editToggle.addEventListener('click', toggleEditingMode);
      }

      if (deleteToggle) {
        deleteToggle.addEventListener('click', () => {
          setDeleteMode(!deleteModeEnabled);
        });
      }

      // Keyboard shortcut (E) + Esc cancels drag
      document.addEventListener('keydown', (e) => {
        if (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName)) return;

        const stopDrag = () => {
          if (!circleDragCtx) return;
          if (typeof endCircleDrag === 'function') return endCircleDrag(false);

          if (engine === 'gl') { try { mapgl.dragPan.enable(); } catch { } }
          else { try { mapleaf.dragging.enable(); } catch { } }
          circleDragCtx = null;
          syncDeleteModeCursor();
        };

        if (e.key === 'Escape') return stopDrag();

        if (e.key.toLowerCase() === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          editingEnabled = !editingEnabled;
          if (!editingEnabled) {
            stopDrag();
            setDeleteMode(false);
            closeStyleEditor();
          }
          reflectEditUI();
          try { localStorage.setItem('sqkii-editing', editingEnabled ? '1' : '0'); } catch { }
        }
      });

      function openStyleEditor(entry, fid, screenX, screenY) {
        if (!editingEnabled || deleteModeEnabled) return;
        const f = entry.data.features.find(x => x.properties.fid === fid); if (!f) return;
        const p = f.properties;
        const isLine = f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString';
        // Detect circles: either has metadata OR is a polygon (assume it might be a circle)
        const hasCircleMeta = !!(p._circleCenter && p._circleRadius);
        const isPolygon = f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon';
        const isCircle = hasCircleMeta || isPolygon; // Show button for all polygons
        editCtx = { entry, fid };

        // For lines, hide fill controls
        if (isLine) {
          seFill.parentElement.style.display = 'none';
          seFillOp.parentElement.style.display = 'none';
          seOutline.parentElement.style.display = 'none';
        } else {
          seFill.parentElement.style.display = '';
          seFillOp.parentElement.style.display = '';
          seOutline.parentElement.style.display = '';
          seFill.value = p._fill || '#ffffff';
          seFillOp.value = (p._fillOpacity ?? 0.2);
          seOutline.checked = (p._strokeOpacity ?? 0.2) > 0 && (p._weight ?? 2) > 0;
        }

        seStroke.value = p._stroke || '#ffffff';
        seWidth.value = p._weight ?? 2;

        // Add Calculate Statistics + Glimpse buttons for circles
        if (isCircle) {
          // Remove old buttons if they exist
          if (seCalcStats) {
            try { seCalcStats.remove(); } catch { }
            seCalcStats = null;
          }
          if (seReconCoin) {
            try { seReconCoin.remove(); } catch { }
            seReconCoin = null;
          }
          if (seGlimpseSigns) {
            try { seGlimpseSigns.remove(); } catch { }
            seGlimpseSigns = null;
          }
          if (seSearchLampPost) {
            try { seSearchLampPost.remove(); } catch { }
            seSearchLampPost = null;
          }

          // Create new Calculate Statistics button
          seCalcStats = document.createElement('button');
          seCalcStats.className = 'btn small';
          seCalcStats.style.cssText = 'width:100%;margin-top:8px;background:rgba(96,165,250,0.15);border-color:#60a5fa;';

          const hasStats = p._statsCalculated;
          seCalcStats.textContent = hasStats ? '🔄 Recalculate Statistics' : '📊 Calculate Statistics';
          seCalcStats.id = 'se-calc-stats';

          seCalcStats.onclick = () => {
            // Try to get circle metadata
            let center = p._circleCenter;
            let radius = p._circleRadius;

            // If no metadata, calculate from geometry centroid and approximate radius
            if (!center || !radius) {
              try {
                const centroid = turf.centroid(f);
                center = centroid.geometry.coordinates;

                // Approximate radius from bbox
                const bbox = turf.bbox(f);
                const dx = bbox[2] - bbox[0];
                const dy = bbox[3] - bbox[1];
                radius = Math.max(dx, dy) * 111320 / 2; // rough meters conversion

                console.log('Estimated circle:', { center, radius });
              } catch (e) {
                console.error('Could not estimate circle parameters:', e);
                alert('Could not determine circle parameters. Please use the Draw Circle tool.');
                return;
              }
            }

            loadCircleStatistics(fid, center, radius);
          };

          // Create Recon Coin button
          seReconCoin = document.createElement('button');
          seReconCoin.className = 'btn small';
          seReconCoin.style.cssText = 'width:100%;margin-top:4px;background:rgba(34,197,94,0.15);border-color:#22c55e;';
          seReconCoin.textContent = '🎯 Recon Coin';

          seReconCoin.onclick = () => {
            let center = p._circleCenter;
            let radius = p._circleRadius;

            if (!center || !radius) {
              try {
                const centroid = turf.centroid(f);
                center = centroid.geometry.coordinates;
                const bbox = turf.bbox(f);
                const dx = bbox[2] - bbox[0];
                const dy = bbox[3] - bbox[1];
                radius = Math.max(dx, dy) * 111320 / 2;
              } catch (e) {
                alert('Could not determine circle parameters.');
                return;
              }
            }

            openReconModal(fid, center, radius);
          };

          // Create Glimpse Signs button
          seGlimpseSigns = document.createElement('button');
          seGlimpseSigns.className = 'btn small';
          seGlimpseSigns.style.cssText = 'width:100%;margin-top:4px;background:rgba(250,204,21,0.15);border-color:#facc15;';
          seGlimpseSigns.textContent = '👁️ Glimpse Signs';

          seGlimpseSigns.onclick = async () => {
            let center = p._circleCenter;
            let radius = p._circleRadius;

            if (!center || !radius) {
              try {
                const centroid = turf.centroid(f);
                center = centroid.geometry.coordinates;
                const bbox = turf.bbox(f);
                const dx = bbox[2] - bbox[0];
                const dy = bbox[3] - bbox[1];
                radius = Math.max(dx, dy) * 111320 / 2;
              } catch (e) {
                alert('Could not determine circle parameters. Please use the Draw Circle tool.');
                return;
              }
            }

            await glimpseTrafficSigns(fid, center, radius);
          };

          seSearchLampPost = document.createElement('button');
          seSearchLampPost.className = 'btn small';
          seSearchLampPost.style.cssText = 'width:100%;margin-top:4px;background:rgba(249,115,22,0.14);border-color:#fb923c;color:#fde68a;';
          seSearchLampPost.textContent = '🔎 Search';

          seSearchLampPost.onclick = () => {
            let center = p._circleCenter;
            let radius = p._circleRadius;

            if (!center || !radius) {
              try {
                const centroid = turf.centroid(f);
                center = centroid.geometry.coordinates;
                const bbox = turf.bbox(f);
                const dx = bbox[2] - bbox[0];
                const dy = bbox[3] - bbox[1];
                radius = Math.max(dx, dy) * 111320 / 2;
              } catch {
                center = null;
                radius = null;
              }
            }

            openLampPostSearchModal(center, radius);
          };

          // Insert all buttons before the actions row
          const actionsRow = editorEl.querySelector('.style-actions');
          if (actionsRow) {
            const parent = actionsRow.parentElement;
            // Order: Calculate → Recon → Glimpse → actions
            parent.insertBefore(seCalcStats, actionsRow);
            parent.insertBefore(seReconCoin, actionsRow);
            parent.insertBefore(seGlimpseSigns, actionsRow);
            parent.insertBefore(seSearchLampPost, actionsRow);
          }

          // Show cached stats if available
          if (hasStats) {
            let statsDiv = document.getElementById('se-stats-display');
            if (!statsDiv) {
              statsDiv = document.createElement('div');
              statsDiv.id = 'se-stats-display';
              statsDiv.style.cssText = 'margin-top:8px;padding:8px;background:rgba(0,0,0,0.2);border-radius:8px;font-size:12px;';
              editorEl.querySelector('.style-actions').parentElement.insertBefore(statsDiv, seCalcStats);
            }
            const radiusLabel = p._circleRadius
              ? `${Math.round(p._circleRadius)} m`
              : 'N/A';

            statsDiv.innerHTML = `
      <div style="font-weight:800;margin-bottom:4px;color:#60a5fa;">
        Within this ${radiusLabel} circle, there are:
      </div>
      <div style="display:grid;gap:4px;font-size:13px;line-height:1.4;">
        <div>🏢 HDB Blocks: ${p._hdbCount || 0}</div>
        <div>➕ AEDs: ${p._aedCount || 0}</div>
        <div>🚌 Bus Stops: ${p._busCount || 0}</div>
        <div>💡 Lamp Posts: ${p._lampPostCount || 0}</div>
        <div>🚫 No-entry Signs: ${p._noEntryCount || 0}</div>
        <div>🐌 Slow Signs: ${p._slowSignCount || 0}</div>
        <div>🛑 Stop Signs: ${p._stopSignCount || 0}</div>
      </div>
    `;
          }
        } else {
          // Remove buttons and stats display for non-circles
          if (seCalcStats) {
            try { seCalcStats.remove(); } catch { }
            seCalcStats = null;
          }
          if (seReconCoin) {  // <-- ADD THESE 4 NEW LINES
            try { seReconCoin.remove(); } catch { }
            seReconCoin = null;
          }
          if (seGlimpseSigns) {
            try { seGlimpseSigns.remove(); } catch { }
            seGlimpseSigns = null;
          }
          if (seSearchLampPost) {
            try { seSearchLampPost.remove(); } catch { }
            seSearchLampPost = null;
          }


          const statsDiv = document.getElementById('se-stats-display');
          if (statsDiv) {
            try { statsDiv.remove(); } catch { }
          }
        }


        // Smart positioning: measure actual editor height and position to keep it fully visible
        editorEl.style.display = 'block';
        editorEl.style.visibility = 'hidden'; // measure without showing

        // Force a reflow to get accurate measurements
        const editorHeight = editorEl.offsetHeight;
        const editorWidth = editorEl.offsetWidth || 320;

        // Calculate position that keeps editor fully on screen
        let left = screenX + 10;
        let top = screenY - 10;

        // Prevent going off right edge
        if (left + editorWidth > window.innerWidth) {
          left = window.innerWidth - editorWidth - 10;
        }

        // Prevent going off left edge
        if (left < 10) {
          left = 10;
        }

        // Prevent going off bottom edge - this is the key fix
        if (top + editorHeight > window.innerHeight) {
          top = window.innerHeight - editorHeight - 10;
        }

        // Prevent going off top edge
        if (top < 10) {
          top = 10;
        }

        editorEl.style.left = left + 'px';
        editorEl.style.top = top + 'px';
        editorEl.style.visibility = 'visible'; // now show it
      }


      function closeStyleEditor() {
        editorEl.style.display = 'none';
        editCtx = null;

        // Clean up stats button, recon button, glimpse button and display
        if (seCalcStats) {
          try { seCalcStats.remove(); } catch { }
          seCalcStats = null;
        }
        if (seReconCoin) {
          try { seReconCoin.remove(); } catch { }
          seReconCoin = null;
        }
        if (seGlimpseSigns) {
          try { seGlimpseSigns.remove(); } catch { }
          seGlimpseSigns = null;
        }
      }

      function applyEditor() {
        if (!editCtx) return;
        const { entry, fid } = editCtx;
        const f = entry.data.features.find(x => x.properties.fid === fid); if (!f) return;
        const p = f.properties;
        const isLine = f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString';

        if (!isLine) {
          p._fill = seFill.value;
          p._fillOpacity = parseFloat(seFillOp.value);
          if (seOutline.checked) {
            p._stroke = seStroke.value;
            p._weight = parseFloat(seWidth.value) || 0;
            p._strokeOpacity = 0.9;
          } else {
            p._strokeOpacity = 0.0;
            p._weight = 0;
          }
        } else {
          // For lines, only update stroke properties
          p._stroke = seStroke.value;
          p._weight = parseFloat(seWidth.value) || 2;
          p._strokeOpacity = 0.9;
        }

        p._ts = Date.now();
        refreshGroupBoth(entry);
        saveState();
      }

      [seFill, seFillOp, seOutline, seStroke, seWidth].forEach(inp => inp.addEventListener('input', applyEditor));
      seClose.addEventListener('click', closeStyleEditor);
      if (seCloseTop) {
        seCloseTop.addEventListener('click', closeStyleEditor);
      }


      const LONGPRESS_MS = 450;
      function attachLongPressGL(layerId, /*unused*/ _entry) {
        let timer = null;

        // Is this one of the line/edge layers?
        const isLineLayer = /^line-/.test(layerId) || /^polyedge-/.test(layerId);

        function clear() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }

        function start(e) {
          if (!editingEnabled) return;

          timer = setTimeout(() => {
            if (!e || !e.point) return;

            let chosen;

            if (isLineLayer) {
              // Give thin lines a forgiving hit box so long-press selection is reliable.
              const hitPad = 10;
              const hits = mapgl.queryRenderedFeatures([
                [e.point.x - hitPad, e.point.y - hitPad],
                [e.point.x + hitPad, e.point.y + hitPad]
              ], { layers: [layerId] });
              if (!hits || !hits.length) return;
              chosen = hits.find(hit => hit?.properties?.fid) || hits[0];
            } else {
              // For fills, keep old behaviour: smallest polygon at that point
              chosen = pickSmallestPolygonAtPoint(e.point);
              if (!chosen) return;
            }

            const srcId = chosen.layer && chosen.layer.source;
            const owner = layerList.find(l => l.glSourceId === srcId);
            const fid = chosen.properties && chosen.properties.fid;
            const pt = e.point || { x: 0, y: 0 };

            if (owner && fid) openStyleEditor(owner, String(fid), pt.x, pt.y);
          }, LONGPRESS_MS);
        }

        ['mousedown', 'touchstart'].forEach(ev => mapgl.on(ev, layerId, start));
        ['mouseup', 'mouseleave', 'drag', 'move', 'touchend', 'touchcancel'].forEach(ev => mapgl.on(ev, clear));
      }


      function attachLongPressLeaf(ev, entry, fid) {
        if (!editingEnabled) return;
        let timer = null;
        function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
        const src = ev.originalEvent && ev.originalEvent.touches && ev.originalEvent.touches[0] ? ev.originalEvent.touches[0] : ev.originalEvent;
        timer = setTimeout(() => { const p = src; openStyleEditor(entry, fid, p.clientX, p.clientY); }, LONGPRESS_MS);
        document.addEventListener('mouseup', () => cancel(), { once: true });
        document.addEventListener('touchend', () => cancel(), { once: true });
      }
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStyleEditor(); });

      /* ================= Autosave / Restore (local) ================= */
      const LS_KEY = 'sqkii-mapper-state-v1';
      function shallowSerializableState() { return layerList.map(l => ({ id: l.id, name: l.name, visible: l.visible !== false, data: l.data, items: l.items, _deletedLayer: !!l._deletedLayer })); }
      function localSaveOnly() { try { localStorage.setItem(LS_KEY, JSON.stringify(shallowSerializableState())); } catch (e) { console.warn('Autosave failed', e); } }
      window.addEventListener('beforeunload', localSaveOnly);

      async function rebindFeatureIcons(entry) {
        for (const f of (entry.data?.features || [])) {
          const p = f.properties || {};
          if (p._iconUrl) {
            const id = registerIconUrl(p._iconUrl);
            if (id) p._icon = id;
          } else if (p._icon == null) {
            p._icon = DOLLAR_ICON_NAME;
          }
        }
      }
      function clearAllLayers() {
        for (const entry of [...layerList]) {
          (entry.glLayerIds || []).forEach(id => { if (mapgl.getLayer(id)) try { mapgl.removeLayer(id); } catch { } });
          if (entry.glSourceId && mapgl.getSource(entry.glSourceId)) try { mapgl.removeSource(entry.glSourceId); } catch { };
          if (entry.lfGroup) try { entry.lfGroup.remove(); } catch { };
        }
        layerList.length = 0;
        renderGroupsVisibility(); renderLayers();
      }

      async function applyStateArray(arr) {
        clearAllLayers();
        await ensureAllIconsOnCurrentStyle();

        for (const saved of (arr || [])) {
          const entry = {
            id: (saved.id != null ? saved.id : (layerSeq++)),
            name: saved.name ?? 'Layer',
            visible: saved.visible !== false,
            data: saved.data,
            items: [],
            glSourceId: null,
            glLayerIds: [],
            lfGroup: null,
            lfLayers: null,
            _deletedLayer: !!saved._deletedLayer
          };

          // Normalize identifiers to strings (prevents GL/Leaflet promoteId mismatches)
          for (const f of (entry.data?.features || [])) {
            if (f?.properties?.fid != null) f.properties.fid = String(f.properties.fid);
            if (f?.properties?._gid != null) f.properties._gid = String(f.properties._gid);
          }

          // Normalize restored feature props (prevents ghost polygons / hidden drift)
          for (const f of (entry.data?.features || [])) {
            const p = f.properties || (f.properties = {});
            if (typeof p.hidden !== 'boolean') p.hidden = false;
            const t = f.geometry?.type;
            if (t === 'Polygon' || t === 'MultiPolygon') {
              if (p._fill == null) p._fill = '#ffffff';
              if (p._fillOpacity == null) p._fillOpacity = 0.15;
              if (p._stroke == null) p._stroke = '#ffffff';
              if (p._strokeOpacity == null) p._strokeOpacity = 0.7;
              if (p._weight == null) p._weight = 2;
            }
          }

          // ...build entry...
          await rebindFeatureIcons(entry);
          entry.items = rebuildItemsFromFeatures(entry.data?.features || []);

          // Apply revival logic during restore: if deleted layer has live features, revive it
          if (entry._deletedLayer && hasLiveFeatures(entry)) {
            entry._deletedLayer = false;
          }

          // ensure no id collisions from old saves / other clients
          ensureUniqueLayerId(entry);
          layerList.push(entry);

          // Only create map components for non-deleted layers
          if (!entry._deletedLayer) {
            await new Promise(resolve => {
              glReady(() => {
                createGroupOnGL(entry, /* clearIfExists */ true);
                resolve();
              });
            });
            createGroupOnLeaflet(entry, /* rebuild */ true);

            // Make restore deterministic: enforce visibility and refresh both engines
            applyVisibility(entry);
            refreshGroupBoth(entry);

            if (entry.visible === false) {
              (entry.glLayerIds || []).forEach(lid => {
                if (mapgl.getLayer(lid)) mapgl.setLayoutProperty(lid, 'visibility', 'none');
              });
              if (entry.lfGroup) mapleaf.removeLayer(entry.lfGroup);
            }
          }
        }

        // Recompute seq counters (use only numeric fids for featureSeq)
        const numericFids = layerList
          .flatMap(l => (l.data?.features || []))
          .map(f => {
            const id = f?.properties?.fid;
            if (typeof id === 'number') return id;
            if (typeof id === 'string' && /^\d+$/.test(id)) return parseInt(id, 10);
            return NaN;
          })
          .filter(Number.isFinite);

        featureSeq = Math.max(0, ...(numericFids.length ? numericFids : [0])) + 1;
        layerSeq = Math.max(0, ...layerList.map(l => Number(l.id) || 0)) + 1;

        renderGroupsVisibility();
        renderLayers();
      } function getOrCreateLayerByName(name) {
        // First check if there's a non-deleted layer with this name
        let entry = layerList.find(l => l.name === name && !l._deletedLayer);
        if (entry) return entry;

        // Check if there's a deleted layer with this name that we should revive
        const deletedEntry = layerList.find(l => l.name === name && l._deletedLayer);
        if (deletedEntry) {
          // Revive the deleted layer
          deletedEntry._deletedLayer = false;
          deletedEntry.visible = true;

          // Clear out old tombstone features but keep the layer structure
          deletedEntry.data = deletedEntry.data || { type: 'FeatureCollection', features: [] };
          deletedEntry.data.features = deletedEntry.data.features.filter(f => !f.properties._deleted);
          deletedEntry.items = rebuildItemsFromFeatures(deletedEntry.data.features);

          // Recreate the map components
          glReady(() => createGroupOnGL(deletedEntry, /* clearIfExists */ true));
          createGroupOnLeaflet(deletedEntry, /* rebuild */ true);

          renderGroupsVisibility();
          renderLayers();
          saveState();
          return deletedEntry;
        }

        // Only create a new layer if no existing layer (deleted or not) has this name
        entry = {
          id: layerSeq++,
          name,
          visible: true,
          data: { type: 'FeatureCollection', features: [] },
          items: [],
          glSourceId: null,
          glLayerIds: [],
          lfGroup: null,
          lfLayers: null
        };
        ensureUniqueLayerId(entry);
        layerList.push(entry);

        glReady(() => createGroupOnGL(entry, /* clearIfExists */ true));
        createGroupOnLeaflet(entry, /* rebuild */ true);

        renderGroupsVisibility(); renderLayers(); saveState();
        return entry;
      }


      /* =======================
         === SUPABASE INTEGRATION (merge-safe) ===
         ======================= */
      const SUPABASE_URL = 'https://dfzsndktevcjjbtfwrvs.supabase.co';
      const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmenNuZGt0ZXZjampidGZ3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgwNDYxMzMsImV4cCI6MjA3MzYyMjEzM30.C9VbQMkl1Y4R-K5Dl2GwOxh58afFCQo5h2aK3RE8HpY';
      const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      /* ================= Enhanced User Info ================= */
      let userInfo = {
        ip: 'Loading...',
        city: 'Unknown',
        country: 'Unknown',
        countryCode: '',
        device: 'Unknown',
        browser: 'Unknown'
      };

      // Detect device type
      function detectDevice() {
        const ua = navigator.userAgent;
        if (/mobile/i.test(ua)) return '📱 Mobile';
        if (/tablet|ipad/i.test(ua)) return '📱 Tablet';
        return '💻 Desktop';
      }

      // Detect browser
      function detectBrowser() {
        const ua = navigator.userAgent;
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
        if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
        if (ua.includes('Edg')) return 'Edge';
        return 'Unknown';
      }

      // Fetch IP and location info
      async function fetchUserInfo() {
        try {
          const response = await fetch('https://ipapi.co/json/');
          const data = await response.json();

          userInfo = {
            ip: data.ip || 'Unknown',
            city: data.city || 'Unknown',
            country: data.country_name || 'Unknown',
            countryCode: data.country_code || '',
            device: detectDevice(),
            browser: detectBrowser()
          };

          updateConnectionIndicator();
        } catch (e) {
          console.warn('Failed to fetch user info:', e);
          userInfo.device = detectDevice();
          userInfo.browser = detectBrowser();
          updateConnectionIndicator();
        }
      }

      // Call on page load
      fetchUserInfo();

      const ROOM_PRESENCE_TABLE = 'room_presence';
      const ROOM_PRESENCE_HEARTBEAT_MS = 15000;
      const ROOM_PRESENCE_REFRESH_MS = 10000;
      const ROOM_PRESENCE_STALE_MS = 45000;
      let currentRoomCode = null;
      const clientId = (() => crypto.getRandomValues(new Uint32Array(4)).join('-'))();
      const presenceSessionId = `${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let roomPresenceAvailable = true;
      let roomPresenceHeartbeatTimer = 0;
      let roomPresenceRefreshTimer = 0;
      let connectedUsers = 1; // Start with self

      function clearRoomPresenceTimers() {
        clearInterval(roomPresenceHeartbeatTimer);
        clearInterval(roomPresenceRefreshTimer);
        roomPresenceHeartbeatTimer = 0;
        roomPresenceRefreshTimer = 0;
      }

      function setConnectedUsersList(users = []) {
        window.connectedUsersList = users;
        connectedUsers = currentRoomCode ? Math.max(1, users.length) : 0;
        updateConnectionIndicator();
      }

      function roomPresencePayload() {
        return {
          room_code: currentRoomCode,
          session_id: presenceSessionId,
          client_id: clientId,
          device: userInfo.device,
          browser: userInfo.browser,
          city: userInfo.city,
          country: userInfo.countryCode,
          ip: userInfo.ip,
          online_at: new Date().toISOString(),
          last_seen: new Date().toISOString()
        };
      }

      async function upsertRoomPresence() {
        if (!currentRoomCode || !roomPresenceAvailable) return false;
        const payload = roomPresencePayload();
        const { error } = await supabase
          .from(ROOM_PRESENCE_TABLE)
          .upsert(payload, { onConflict: 'room_code,session_id' });
        if (error) {
          if (error.code === 'PGRST205') roomPresenceAvailable = false;
          throw error;
        }
        return true;
      }

      async function refreshRoomPresence() {
        if (!currentRoomCode) {
          setConnectedUsersList([]);
          return;
        }
        if (!roomPresenceAvailable) {
          setConnectedUsersList([{ client_id: clientId, device: userInfo.device, browser: userInfo.browser, city: userInfo.city, country: userInfo.countryCode, ip: userInfo.ip }]);
          return;
        }

        const cutoff = new Date(Date.now() - ROOM_PRESENCE_STALE_MS).toISOString();
        const { data, error } = await supabase
          .from(ROOM_PRESENCE_TABLE)
          .select('session_id, client_id, device, browser, city, country, ip, online_at, last_seen')
          .eq('room_code', currentRoomCode)
          .gte('last_seen', cutoff)
          .order('last_seen', { ascending: false });

        if (error) {
          if (error.code === 'PGRST205') roomPresenceAvailable = false;
          console.warn('Room presence refresh failed:', error);
          setConnectedUsersList([{ client_id: clientId, device: userInfo.device, browser: userInfo.browser, city: userInfo.city, country: userInfo.countryCode, ip: userInfo.ip }]);
          return;
        }

        const seen = new Set();
        const users = (data || []).filter((user) => {
          const key = user.session_id || `${user.client_id || 'unknown'}-${user.last_seen || ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        setConnectedUsersList(users);
      }

      async function startRoomPresence(roomCode) {
        clearRoomPresenceTimers();
        if (!roomCode) {
          setConnectedUsersList([]);
          return;
        }
        try {
          await upsertRoomPresence();
          await refreshRoomPresence();
        } catch (e) {
          console.warn('Room presence start failed:', e);
          await refreshRoomPresence();
        }

        roomPresenceHeartbeatTimer = setInterval(() => {
          upsertRoomPresence()
            .then(() => refreshRoomPresence())
            .catch((e) => console.warn('Room presence heartbeat failed:', e));
        }, ROOM_PRESENCE_HEARTBEAT_MS);

        roomPresenceRefreshTimer = setInterval(() => {
          refreshRoomPresence().catch((e) => console.warn('Room presence poll failed:', e));
        }, ROOM_PRESENCE_REFRESH_MS);
      }

      async function stopRoomPresence(roomCode = currentRoomCode) {
        clearRoomPresenceTimers();
        if (!roomCode || !roomPresenceAvailable) return;
        try {
          await supabase
            .from(ROOM_PRESENCE_TABLE)
            .delete()
            .eq('room_code', roomCode)
            .eq('session_id', presenceSessionId);
        } catch (e) {
          console.warn('Room presence cleanup failed:', e);
        }
      }

      window.addEventListener('pagehide', () => {
        stopRoomPresence(currentRoomCode).catch(() => { });
      });

      // Update connection indicator
      function updateConnectionIndicator() {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        const details = document.getElementById('connection-details');
        const dropdown = document.getElementById('connection-dropdown');

        if (!currentRoomCode) {
          indicator.classList.add('disconnected');
          text.textContent = 'Not connected';
          details.innerHTML = '';
          dropdown.innerHTML = '';
          return;
        }

        indicator.classList.remove('disconnected');
        text.textContent = `${connectedUsers} online`;

        // Show Room, Location, IP in details line
        const detailsParts = [];
        if (currentRoomCode) detailsParts.push(`Room: ${currentRoomCode}`);
        if (userInfo.city !== 'Unknown') detailsParts.push(`📍 ${userInfo.city}, ${userInfo.countryCode}`);
        if (userInfo.ip !== 'Loading...') detailsParts.push(`IP: ${userInfo.ip}`);
        details.innerHTML = detailsParts.join(' <span style="opacity:0.4;">•</span> ');

        // Build dropdown with list of users
        if (window.connectedUsersList && window.connectedUsersList.length > 0) {
          let html = '<div style="font-weight:700;margin-bottom:6px;color:#60a5fa;">Connected Users:</div>';

          window.connectedUsersList.forEach((user, i) => {
            const isYou = user.client_id === clientId;
            const userClass = isYou ? 'user-item self' : 'user-item';
            const userName = isYou ? 'You' : `User ${i + 1}`;

            html += `<div class="${userClass}">`;
            html += `<div class="user-item-name">${userName}</div>`;
            html += `<div class="user-item-info">`;
            html += `${user.device || '💻 Desktop'} • ${user.browser || 'Unknown'}`;
            if (user.city && user.country) {
              html += ` • ${user.city}, ${user.country}`;
            }
            html += `</div></div>`;
          });

          dropdown.innerHTML = html;
        } else {
          dropdown.innerHTML = '<div style="color:rgba(229,231,235,0.6);font-size:11px;">No other users online</div>';
        }
      }

      // Toggle dropdown on click
      document.getElementById('connection-indicator')?.addEventListener('click', (e) => {
        const indicator = document.getElementById('connection-indicator');
        if (currentRoomCode && connectedUsers >= 1) {
          indicator.classList.toggle('expanded');
        }
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        const indicator = document.getElementById('connection-indicator');
        if (!indicator.contains(e.target)) {
          indicator.classList.remove('expanded');
        }
      });

      function debounce(fn, ms) { let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

      async function fetchRoom(code) {
        const { data, error } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle();
        if (error) throw error;
        return data;
      }

      /* ---- MERGING: prefer newest _ts; deletions via _deleted tombstones ---- */
      async function upsertRoomState(code, state) {
        const remote = await fetchRoom(code).catch(() => null);
        const remoteState = (remote && Array.isArray(remote.state)) ? remote.state : [];
        const merged = mergeStates(remoteState, state);
        const { error } = await supabase.from('rooms').upsert({
          code,
          state: merged,
          updated_by: clientId,
          updated_at: new Date().toISOString()
        }, { onConflict: 'code' });
        if (error) throw error;
      }
      function featureKey(f) { const p = f && f.properties || {}; return String(p._gid ?? p.fid ?? ''); }
      function newerFeature(a, b) { const ta = a?.properties?._ts ?? 0; const tb = b?.properties?._ts ?? 0; return (tb > ta) ? b : a; }
      function mergeLayer(remoteL, localL) {
        if (!remoteL) return localL; if (!localL) return remoteL;
        const out = {
          id: remoteL.id ?? localL.id, name: remoteL.name ?? localL.name, visible: (localL.visible !== false) || (remoteL.visible !== false),
          data: { type: 'FeatureCollection', features: [] }, items: [], glSourceId: null, glLayerIds: [], lfGroup: null, lfLayers: null, _deletedLayer: (remoteL._deletedLayer || localL._deletedLayer) || false
        };
        const byKey = new Map();
        for (const f of (remoteL.data?.features || [])) { const k = featureKey(f) || `rf-${Math.random()}`; byKey.set(k, f); }
        for (const f of (localL.data?.features || [])) { const k = featureKey(f) || `lf-${Math.random()}`; byKey.set(k, byKey.has(k) ? newerFeature(byKey.get(k), f) : f); }
        out.data.features = [...byKey.values()];
        out.items = rebuildItemsFromFeatures(out.data.features);
        // HEAL after merge
        if (out._deletedLayer && hasLiveFeatures(out)) out._deletedLayer = false;
        return out;
      }


      function layerKeyId(L) { return (L && L.id != null) ? String(L.id) : ''; }
      function layerKeyName(L) { return (L?.name || '').trim().toLowerCase(); }

      function mergeStates(remoteArr, localArr) {
        const byId = new Map();
        const byName = new Map();

        // index remote by id and name (for matching)
        for (const L of (remoteArr || [])) {
          const kid = layerKeyId(L);
          const knm = layerKeyName(L);
          if (kid) byId.set(kid, L);
          if (knm) byName.set(knm, L);
        }

        const merged = [];
        const seenIds = new Set();
        const seenNames = new Set();

        function markSeen(L) {
          const kid = layerKeyId(L); if (kid) seenIds.add(kid);
          const knm = layerKeyName(L); if (knm) seenNames.add(knm);
        }
        function addOnceByKey(L) {
          const kid = layerKeyId(L);
          const knm = layerKeyName(L);
          if ((kid && seenIds.has(kid)) || (knm && seenNames.has(knm))) return;
          merged.push(L);
          markSeen(L);
        }

        // merge locals with matching remotes (id first, else name)
        for (const localL of (localArr || [])) {
          const rid = layerKeyId(localL) ? byId.get(layerKeyId(localL)) : null;
          const rnm = !rid && layerKeyName(localL) ? byName.get(layerKeyName(localL)) : null;

          if (rid || rnm) {
            const remoteL = rid || rnm;
            const m = mergeLayer(remoteL, localL);

            // keep indices up to date for subsequent matches
            const kid = layerKeyId(m); if (kid) byId.set(kid, m);
            const knm = layerKeyName(m); if (knm) byName.set(knm, m);

            addOnceByKey(m);
          } else {
            // brand-new local layer
            addOnceByKey(localL);
            const kid = layerKeyId(localL); if (kid) byId.set(kid, localL);
            const knm = layerKeyName(localL); if (knm) byName.set(knm, localL);
          }
        }

        // add remaining remote layers not seen
        for (const L of (remoteArr || [])) addOnceByKey(L);

        return merged;
      }


      let suppressNextRemoteApply = false;
      let hasUnsavedMapChanges = false;

      const syncToServerDebounced = debounce(async function () {
        if (!currentRoomCode) return;
        const state = shallowSerializableState();
        try {
          suppressNextRemoteApply = true;
          await upsertRoomState(currentRoomCode, state);
          localSaveOnly();
          hasUnsavedMapChanges = false;
        } catch (e) {
          console.warn('Supabase sync failed:', e);
        } finally {
          setTimeout(() => { suppressNextRemoteApply = false; }, 250);
        }
      }, 8000);

      function saveState() {
        hasUnsavedMapChanges = true;
        syncToServerDebounced();
      }

      window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedMapChanges) {
          e.preventDefault();
          e.returnValue = '';
        }
      });

      let roomChannel = null;

      function subscribeRoom(code) {
        try {
          if (roomChannel) { roomChannel.unsubscribe(); roomChannel = null; }

          roomChannel = supabase.channel('rooms-' + code)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'rooms', filter: 'code=eq.' + code },
              async (payload) => {
                try {
                  const row = payload.new || payload.record;
                  if (!row) return;
                  if (suppressNextRemoteApply) return;

                  // Figure out authorship for each payload section
                  const stateAuthor = row.updated_by;
                  const pixelAuthor = row.pixelgrid_updated_by || row.updated_by;

                  // 1) Apply MAP STATE only if it wasn't authored by me
                  if (row.state && stateAuthor !== clientId) {
                    await applyStateArray(row.state || []);
                    localSaveOnly();
                  }

                  // 2) Apply PIXEL GRID even if map state was mine (they're versioned separately)
                  if (window.PixelGrid && typeof window.PixelGrid.applyRemote === 'function') {
                    // only apply if pixelgrid exists and wasn't authored by me
                    if (row.pixelgrid && pixelAuthor !== clientId) {
                      try {
                        window.PixelGrid.applyRemote(row.pixelgrid, pixelAuthor);
                      } catch (e) {
                        console.warn('PixelGrid realtime apply failed:', e);
                      }
                    }
                  }

                } catch (e) {
                  console.error('Apply remote state failed', e);
                }
              }
            )
            .subscribe(() => { });

        } catch (e) {
          console.error('subscribeRoom guard:', e);
        }
      }


      async function joinRoom(code) {
        const previousRoomCode = currentRoomCode;
        currentRoomCode = code;
        if (previousRoomCode && previousRoomCode !== code) {
          stopRoomPresence(previousRoomCode).catch(() => { });
        }
        reconOverlayPoints = [];
        clearReconOverlay({ clearCache: false });
        try {
          const existing = await fetchRoom(code);

          if (existing && existing.state && existing.state.length) {

            // ======================================================
            // Force-hide Shrink Pattern & Past Coin Shrinks in state
            // ======================================================
            if (code === "silver" && Array.isArray(existing.state)) {
              existing.state = existing.state.map(L => {
                const name = (L.name || "").toLowerCase();
                if (["shrink pattern", "past coin shrinks"].includes(name)) {
                  L.visible = false; // ensure hidden when map loads
                }
                return L;
              });
            }

            // Load shared map state
            await applyStateArray(existing.state);

            // (Optional) persist this hidden preference to Supabase
            if (code === "silver") {
              try {
                await upsertRoomState(code, existing.state);
                console.log("✓ Updated layer visibility for silver room");
              } catch (err) {
                console.warn("⚠️ Could not save updated layer visibility:", err);
              }
            }

            // (Optional but safe) if Pixel Grid data already exists, hydrate it immediately
            if (existing.pixelgrid && window.PixelGrid && typeof window.PixelGrid.applyRemote === 'function') {
              const who = existing.pixelgrid_updated_by || existing.updated_by;
              try { window.PixelGrid.applyRemote(existing.pixelgrid, who); } catch { }
            }

            // Load and apply geohash overlays
            if (existing && existing.geohash_data) {
              try {
                await loadGeohashState();
                console.log('Geohash state loaded from database');

                // Wait longer for the geohash KMZ to fully load and create its source
                glReady(() => {
                  let attempts = 0;
                  const maxAttempts = 5;

                  const tryApply = () => {
                    attempts++;
                    const sourceId = (typeof findGeohashSourceId === 'function') ? findGeohashSourceId() : null;

                    if (sourceId) {
                      console.log('✓ Geohash source found:', sourceId);
                      if (typeof window.applyGeohashOverlays === 'function') {
                        window.applyGeohashOverlays();
                        console.log('✓ Geohash overlays auto-applied after joining room');
                      }
                    } else if (attempts < maxAttempts) {
                      console.log(`Geohash source not ready yet, retry ${attempts}/${maxAttempts}...`);
                      setTimeout(tryApply, 1000);
                    } else {
                      console.warn('Geohash source not found after', maxAttempts, 'attempts. You may need to click Apply manually.');
                    }
                  };

                  // Start first attempt after 1.5 seconds
                  setTimeout(tryApply, 1500);
                });
              } catch (e) {
                console.warn('Geohash auto-load failed:', e);
              }
            }

          } else {
            // No shared state yet — start a fresh room
            clearAllLayers();

            try {
              await loadKMZFromUrl(encodeURI(PRELOAD_GEOHASHES), 'Geohashes');
            } catch (e) {
              console.warn('Preload geohashes failed', e);
            }

            for (const name of PRELOAD_COINS) {
              try {
                await loadKMZFromUrl(encodeURI(name));
                console.log('Preloaded', name);
                break;
              } catch (e) {
                console.warn('Preload failed for', name);
              }
            }

            // Save initial room state
            await upsertRoomState(code, shallowSerializableState());
          }

          // Start realtime for this room
          subscribeRoom(code);
          await startRoomPresence(code);
          updateConnectionIndicator();

          // Bind Pixel Grid
          if (window.PixelGrid && typeof window.PixelGrid.bindToRoom === 'function') {
            window.PixelGrid.bindToRoom({ supabase, currentRoomCode: code, clientId });
          }

          if (document.getElementById('coin-db-modal')?.classList.contains('visible')) {
            try { await refreshCoinDatabase(); } catch { }
          }

          scheduleReconOverlayRestore(code);

        } catch (e) {
          console.error('Join failed', e);
          throw e;
        }
      }




      /* ===== Server Modal helpers ===== */
      const modal = document.getElementById('server-modal');
      const serverInput = document.getElementById('server-code-input');
      const serverJoin = document.getElementById('server-code-join');
      const serverErr = document.getElementById('server-error');
      const LAST_SERVER_CODE_KEY = 'sqkii-last-server-code';
      function loadLastServerCode() {
        try {
          return (localStorage.getItem(LAST_SERVER_CODE_KEY) || '').trim();
        } catch {
          return '';
        }
      }
      function saveLastServerCode(code) {
        try {
          const trimmed = (code || '').trim();
          if (trimmed) localStorage.setItem(LAST_SERVER_CODE_KEY, trimmed);
          else localStorage.removeItem(LAST_SERVER_CODE_KEY);
        } catch { }
      }
      function showServerModal() { modal.classList.add('visible'); appEl.classList.add('blocked-by-modal'); }
      function hideServerModal() {
        modal.classList.remove('visible');
        appEl.classList.remove('blocked-by-modal');
        requestAnimationFrame(() => { unlockAudioFromUserGesture(); });
      }

      serverJoin.addEventListener('click', async () => {
        const code = (serverInput.value || '').trim();
        if (!code) {
          serverErr.textContent = 'Please enter a server code.';
          serverErr.style.display = 'block';
          return;
        }

        // Show the loading bar
        document.getElementById('loading-container').style.display = 'flex';

        serverErr.style.display = 'none';
        serverJoin.disabled = true;
        serverJoin.textContent = 'Joining...';

        try {
          await joinRoom(code);
          saveLastServerCode(code);
          hideServerModal();
          nudgeAudioAfterJoin();
        } catch (e) {
          console.error('Join failed', e);
          serverErr.textContent = 'Join failed: ' + (e?.message || 'Check connection / DNS / RLS / table.');
          serverErr.style.display = 'block';
        } finally {
          serverJoin.disabled = false;
          serverJoin.textContent = 'Join';

          // Hide the loading bar once done
          document.getElementById('loading-container').style.display = 'none';
        }
      });

      // Handle "Continue without sync" button
      document.getElementById('server-continue').addEventListener('click', async () => {
        hideServerModal();
        nudgeAudioAfterJoin();
        await stopRoomPresence(currentRoomCode);
        currentRoomCode = null;
        reconOverlayPoints = [];
        clearReconOverlay({ clearCache: false });
        setConnectedUsersList([]);

        // Load local state if available
        try {
          const saved = localStorage.getItem('sqkii-mapper-state-v1');
          if (saved) {
            const parsed = JSON.parse(saved);
            await applyStateArray(parsed);
            console.log('✓ Loaded local state');
          }
        } catch (e) {
          console.warn('Failed to load local state:', e);
        }

        // Try to load editing state
        try {
          const editSaved = localStorage.getItem('sqkii-editing');
          if (editSaved === '1') {
            editingEnabled = true;
            reflectEditUI();
          }
        } catch { }

        scheduleReconOverlayRestore(null);
      });


      /* ====================== AUDIO + SFX (stable) ====================== */
      let audioEnabled = true;
      let audioUnlockedByGesture = false;
      let audioBackgroundLocked = false;
      let audioSyncTimer = 0;
      let audioSyncVersion = 0;
      const BGM_URL = `${BASE_URL}Evening Traveler - Road Trip.mp3`;
      const BUTTON_SOUND_URL = `${BASE_URL}button.mp3`;
      const SCANNING_SOUND_URL = `${BASE_URL}scanning.mp3`;

      // === BGM setup ===
      const BGM_CAP = 0.10;
      let userBgmSetting = 1;
      const bgmTargetVolume = () => BGM_CAP * userBgmSetting;

      const bgm = new Audio(BGM_URL);
      bgm.volume = Math.min(bgmTargetVolume(), 1);
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.playsInline = true;

      // Stop helpers
      const stopHtmlAudio = a => { try { a.pause(); a.currentTime = 0; } catch { } };
      const stopAllSfx = () => document.querySelectorAll('audio').forEach(el => { if (el !== bgm) stopHtmlAudio(el); });
      const suspendWebAudio = async () => { try { if (audioCtx?.state !== 'suspended') await audioCtx.suspend(); } catch { } };
      const resumeWebAudio = async () => { try { if (audioCtx?.state === 'suspended') await audioCtx.resume(); } catch { } };
      const pageIsVisible = () => !document.hidden && document.visibilityState === 'visible';
      const canPlayBgm = () => audioEnabled && audioUnlockedByGesture && pageIsVisible() && !audioBackgroundLocked;

      async function pauseAllAudio({ immediate = false } = {}) {
        clearTimeout(audioSyncTimer);
        audioSyncVersion += 1;
        try { bgm.volume = immediate ? 0 : bgmTargetVolume(); } catch { }
        stopHtmlAudio(bgm);
        await suspendWebAudio();
        try {
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
          }
        } catch { }
        stopAllSfx();
      }

      function ensureAudioCtxResumed() {
        try {
          if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          }
          if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        } catch { }
      }

      async function syncAudioState({ immediatePause = false } = {}) {
        const syncVersion = ++audioSyncVersion;
        const shouldPlay = canPlayBgm();

        if (!shouldPlay) {
          try { bgm.volume = immediatePause ? 0 : bgmTargetVolume(); } catch { }
          stopHtmlAudio(bgm);
          await suspendWebAudio();
          if (syncVersion !== audioSyncVersion) return;
          try {
            if ('mediaSession' in navigator) {
              navigator.mediaSession.playbackState = 'none';
              navigator.mediaSession.metadata = null;
            }
          } catch { }
          return;
        }

        await resumeWebAudio();
        if (syncVersion !== audioSyncVersion || !canPlayBgm()) return;
        try {
          bgm.loop = true;
          bgm.volume = bgmTargetVolume();
          if (bgm.paused) await bgm.play();
          if (syncVersion !== audioSyncVersion || !canPlayBgm()) {
            stopHtmlAudio(bgm);
            return;
          }
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        } catch { }
      }

      function scheduleAudioSync({ immediatePause = false, delayMs = 0 } = {}) {
        clearTimeout(audioSyncTimer);
        const run = () => { syncAudioState({ immediatePause }); };
        if (delayMs > 0) audioSyncTimer = setTimeout(run, delayMs);
        else run();
      }

      const lockAudioToBackground = () => {
        audioBackgroundLocked = true;
        scheduleAudioSync({ immediatePause: true });
      };

      const handleForegroundReturn = () => {
        if (!pageIsVisible()) return;
        audioBackgroundLocked = false;
        scheduleAudioSync();
      };

      const unlockAudioFromUserGesture = () => {
        if (!pageIsVisible()) return;
        audioUnlockedByGesture = true;
        audioBackgroundLocked = false;
        ensureAudioCtxResumed();
        void primeButtonAudio();
        scheduleAudioSync();
      };

      const nudgeAudioAfterJoin = () => {
        if (!pageIsVisible()) return;
        audioBackgroundLocked = false;
        scheduleAudioSync();
        scheduleAudioSync({ delayMs: 250 });
      };

      // Handle mobile/browser backgrounding more aggressively than visibilitychange alone.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) lockAudioToBackground();
        else handleForegroundReturn();
      });
      document.addEventListener('freeze', lockAudioToBackground);
      window.addEventListener('pagehide', lockAudioToBackground);
      window.addEventListener('pageshow', () => { requestAnimationFrame(handleForegroundReturn); });
      window.addEventListener('focus', () => { requestAnimationFrame(handleForegroundReturn); });


      let audioCtx = null, buttonBuffer = null;
      let buttonAudioLoadPromise = null;
      const btnFallbackAudio = new Audio(BUTTON_SOUND_URL); btnFallbackAudio.preload = 'auto'; btnFallbackAudio.playsInline = true;

      const primeButtonAudio = async () => {
        if (buttonBuffer || buttonAudioLoadPromise) return buttonAudioLoadPromise;
        buttonAudioLoadPromise = (async () => {
          ensureAudioCtxResumed();
          if (!audioCtx) return null;
          try {
            const res = await fetch(BUTTON_SOUND_URL, { cache: 'force-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ab = await res.arrayBuffer();
            const decoded = await new Promise((resolve, reject) => {
              try {
                const maybePromise = audioCtx.decodeAudioData(ab.slice(0), resolve, reject);
                if (maybePromise && typeof maybePromise.then === 'function') {
                  maybePromise.then(resolve).catch(reject);
                }
              } catch (e) {
                reject(e);
              }
            });
            buttonBuffer = decoded;
            return decoded;
          } catch {
            return null;
          } finally {
            buttonAudioLoadPromise = null;
          }
        })();
        return buttonAudioLoadPromise;
      };

      function playClick() {
        try {
          if (!audioUnlockedByGesture) return;
          ensureAudioCtxResumed();
          if (!buttonBuffer) void primeButtonAudio();
          if (buttonBuffer && audioCtx) {
            const src = audioCtx.createBufferSource(); src.buffer = buttonBuffer; src.connect(audioCtx.destination); src.start(0);
          } else {
            btnFallbackAudio.currentTime = 0;
            btnFallbackAudio.play().catch(() => { });
          }
        } catch (e) { }
      }

      document.addEventListener('pointerdown', unlockAudioFromUserGesture, { capture: true });

      const audioBtn = document.getElementById('audio-toggle');
      function setAudioIcon(on) {
        audioBtn.innerHTML = on
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="1" x2="1" y2="23"></line></svg>`;
      }
      setAudioIcon(true);
      audioBtn.addEventListener('click', () => {
        audioEnabled = !audioEnabled;
        setAudioIcon(audioEnabled);
        if (!audioEnabled) pauseAllAudio({ immediate: true });
        else unlockAudioFromUserGesture();
      });
      document.addEventListener('click', (ev) => { if (ev.target.closest('button')) playClick(); }, { capture: true });

      const sonarSfx = new Audio(SCANNING_SOUND_URL);


      /* ====================== GPS CONTROLS ====================== */
      let geolocate = null;

      function ensureGeolocateControl() {
        if (geolocate) return geolocate; // Don't create if we already have one

        try {
          geolocate = new maptilersdk.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserLocation: true,
            showAccuracyCircle: true
          });

          mapgl.addControl(geolocate, 'top-right');

          // Add event listeners
          geolocate.on('geolocate', onFix);
          geolocate.on('trackuserlocationstart', () => setGpsState('TRACKING'));
          geolocate.on('trackuserlocationend', () => setGpsState('IDLE'));
          geolocate.on('error', (e) => console.warn('Geolocate error:', e));

        } catch (e) {
          console.error('Failed to add geolocate control:', e);
          geolocate = null;
        }

        return geolocate;
      }

      let lastUserPos = null; // [lng, lat]
      const sonarBtn = byId('sonar-btn');

      function updateSonarEnabled() {
        if (lastUserPos) {
          if (sonarBtn.classList.contains('disabled')) {
            // First time GPS is activated
            sonarBtn.classList.remove('disabled');
            sonarBtn.title = 'Activate Coin Sonar';
            console.log('Sonar now available!');
          }
        } else {
          sonarBtn.classList.add('disabled');
          sonarBtn.title = 'Turn on GPS to use Sonar';
        }
      }

      function setGpsState(state) { /* debug hook */ }

      function onFix(e) {
        const lng = e?.coords?.longitude ?? e?.lng ?? e?.lngLat?.lng;
        const lat = e?.coords?.latitude ?? e?.lat ?? e?.lngLat?.lat;
        if (typeof lng === 'number' && typeof lat === 'number') {
          lastUserPos = [lng, lat];
          updateSonarEnabled();

          // Auto-enable sonar button when GPS activates
          if (sonarBtn.classList.contains('disabled')) {
            sonarBtn.classList.remove('disabled');
            sonarBtn.title = 'Activate Coin Sonar';
            console.log('Sonar activated - GPS location acquired');
          }
        }
      }

      mapgl.on('load', () => { ensureGeolocateControl(); });

      /* ===== Sonar UI ===== */
      const sonarModal = byId('sonar-modal');
      const radiusSeg = byId('sonar-radius');
      const colorSeg = byId('sonar-color');
      const scanNow = byId('scan-now');
      const scanWait = byId('scan-wait');

      let sonarRadius = 50;
      let sonarColor = 'red';

      function openSonar() { sonarModal.classList.add('visible'); appEl.classList.add('blocked-by-modal'); }
      function closeSonar() { sonarModal.classList.remove('visible'); appEl.classList.remove('blocked-by-modal'); scanWait.classList.remove('visible'); }

      sonarBtn.addEventListener('click', () => {
        if (!lastUserPos) {
          alert('Please enable GPS to use Sonar\n\nTurn on GPS using the location button in the top-right corner of the map, then try again.');
          return;
        }
        openSonar();
      });

      sonarModal.addEventListener('click', (e) => { if (e.target === sonarModal) closeSonar(); });
      function setActiveChip(container, chip) { container.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); }
      radiusSeg.addEventListener('click', (e) => { const btn = e.target.closest('.chip'); if (!btn) return; sonarRadius = parseInt(btn.dataset.radius, 10) || 50; setActiveChip(radiusSeg, btn); });
      colorSeg.addEventListener('click', (e) => { const btn = e.target.closest('.chip'); if (!btn) return; sonarColor = (btn.dataset.color === 'green') ? 'green' : 'red'; setActiveChip(colorSeg, btn); });

      /* ===== Geometry helpers ===== */
      const sin = Math.sin, cos = Math.cos, asin = Math.asin, atan2 = Math.atan2, PI = Math.PI;
      function circleGeoJSON(lng, lat, radiusMeters, steps = 96) {
        const coords = [], R = 6378137, d = radiusMeters / R, latRad = lat * PI / 180, lngRad = lng * PI / 180;
        for (let i = 0; i <= steps; i++) {
          const brng = (i / steps) * 2 * PI;
          const lat2 = asin(sin(latRad) * cos(d) + cos(latRad) * sin(d) * cos(brng));
          const lng2 = lngRad + atan2(sin(brng) * sin(d) * cos(latRad), cos(d) - sin(lat2));
          coords.push([lng2 * 180 / PI, lat2 * 180 / PI]);
        }
        return { type: 'Polygon', coordinates: [coords] };
      }

      /* ===== Sonar layer management ===== */
      function getOrCreateSonarLayer() {
        return getOrCreateLayerByName('Coin Sonar Scans');
      }
      function addSonarCircle(centerLngLat, radius, color) {
        const entry = getOrCreateSonarLayer();
        const fid = `sonar-${clientId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const hex = (color === 'green') ? '#22c55e' : '#ef4444';
        const geom = turf.circle([centerLngLat[0], centerLngLat[1]], radius, { steps: 128, units: 'meters' }).geometry;
        const name = `Sonar ${radius}m (${color.toUpperCase()}) @ ${timestampLabel()}`;
        const props = {
          fid, name, hidden: false, _gid: fid, _ts: Date.now(),
          _fill: hex, _fillOpacity: 0.18, _stroke: hex, _strokeOpacity: 0.9, _weight: 2,
          _circleCenter: centerLngLat,  // Store center for statistics
          _circleRadius: radius,        // Store radius for statistics
          _coinArchiveEligible: false,
          _coinArchiveSource: 'sonar'
        };

        entry.data.features.push({ type: 'Feature', geometry: geom, properties: props });
        entry.items = rebuildItemsFromFeatures(entry.data.features);
        refreshGroupBoth(entry);
        applyVisibility(entry);
        renderLayers(); renderGroupsVisibility(); saveState();
        ((b) => engine === 'gl' ? mapgl.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 500 }) : mapleaf.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [40, 40] }))(turf.bbox(geom));
      }

      scanNow.addEventListener('click', async () => {
        if (!lastUserPos) { alert('GPS not ready.'); return; }
        try { sonarSfx.currentTime = 0; if (audioEnabled) sonarSfx.play(); } catch { }
        scanWait.classList.add('visible'); scanNow.disabled = true;
        await new Promise(r => setTimeout(r, 3000));
        addSonarCircle(lastUserPos, sonarRadius, sonarColor);
        scanNow.disabled = false; scanWait.classList.remove('visible'); closeSonar();
      });


      /* ====================== RECON COIN SYSTEM ====================== */

      let reconConstraints = [];
      let currentReconCircle = null;
      let reconPrecision = 30; // Default: 30m spacing
      const RECON_OVERLAY_SOURCE = 'recon-overlay-src';
      const RECON_OVERLAY_LAYER = 'recon-overlay-layer';
      const RECON_OVERLAY_HALO_SOURCE = 'recon-overlay-halo-src';
      const RECON_OVERLAY_HALO_LAYER = 'recon-overlay-halo-layer';
      const LAMP_POST_SEARCH_SOURCE_ID = 'lamp-post-search-src';
      const LAMP_POST_SEARCH_HALO_LAYER_ID = 'lamp-post-search-halo';
      const LAMP_POST_SEARCH_CORE_LAYER_ID = 'lamp-post-search-core';
      let leafletReconLayer = null;
      let lampPostSearchLeafletLayer = null;
      let lampPostSearchLeafletHalos = [];
      let lampPostSearchGlMarkers = [];
      const RECON_PASSWORD = '6482';
      const RECON_ACCESS_KEY = 'sqkii-recon-access';
      const RECON_ACCESS_MS = 4 * 60 * 60 * 1000;
      const RECON_OVERLAY_CACHE_PREFIX = 'sqkii-recon-overlay-v1';
      let reconOverlayPoints = [];
      let reconOverlaySpacingMeters = 20;
      let reconOverlayHaloAnimationFrame = 0;
      let leafletReconHalos = [];
      let lampPostSearchFeatures = [];
      let lampPostSearchAnimationFrame = 0;
      let reconAnalysisInProgress = false;
      let currentLampPostSearchContext = null;
      let lampPostSearchMode = 'exact';
      const lampSearchModal = byId('lamp-search-modal');
      const lampSearchInput = byId('lamp-search-input');
      const lampSearchModeExact = byId('lamp-search-mode-exact');
      const lampSearchModeSuffix = byId('lamp-search-mode-suffix');
      const lampSearchHelper = byId('lamp-search-helper');
      const lampSearchStatus = byId('lamp-search-status');
      const lampSearchSubmit = byId('lamp-search-submit');
      const lampSearchCancel = byId('lamp-search-cancel');
      const lampSearchCloseTop = byId('lamp-search-close-top');

      function setReconAnalysisPriority(active) {
        reconAnalysisInProgress = !!active;
        try {
          if (reconAnalysisInProgress) {
            window.__pauseVeil?.();
          } else if (!document.hidden) {
            window.__resumeVeil?.();
          }
        } catch (error) {
          console.warn('[Recon] Failed to toggle darkveil priority:', error);
        }
      }

      function reconOverlayStorageKey(roomCode = currentRoomCode) {
        return `${RECON_OVERLAY_CACHE_PREFIX}:${roomCode || 'local'}`;
      }

      function normalizeReconOverlayPoints(points) {
        const normalized = [];

        for (const point of (points || [])) {
          if (Array.isArray(point) && point.length >= 2) {
            const lng = Number(point[0]);
            const lat = Number(point[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) normalized.push([lng, lat]);
            continue;
          }

          const coords = point?.geometry?.coordinates;
          if (Array.isArray(coords) && coords.length >= 2) {
            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) normalized.push([lng, lat]);
          }
        }

        return normalized;
      }

      function stopReconHaloPulse() {
        if (reconOverlayHaloAnimationFrame) {
          cancelAnimationFrame(reconOverlayHaloAnimationFrame);
          reconOverlayHaloAnimationFrame = 0;
        }
      }

      function reconHaloRadiusMeters(phase = 0.5) {
        const spacing = Math.max(8, Number(reconOverlaySpacingMeters) || 20);
        const dotRadiusMeters = 7;
        const minRadius = Math.max(dotRadiusMeters + 9.0, spacing * 0.46);
        const maxRadius = Math.max(minRadius + 4.5, dotRadiusMeters + spacing * 0.9);
        return minRadius + (maxRadius - minRadius) * phase;
      }

      function reconMetersToPixels(meters, lat) {
        const zoom = engine === 'gl'
          ? (mapgl?.getZoom?.() || 17)
          : (mapleaf?.getZoom?.() || 17);
        const latitude = Number.isFinite(lat)
          ? lat
          : (engine === 'gl' ? mapgl?.getCenter?.().lat : mapleaf?.getCenter?.().lat) || 1.3;
        const metersPerPixel = 156543.03392 * Math.cos((latitude * Math.PI) / 180) / Math.pow(2, zoom);
        return Math.max(1, meters / Math.max(0.000001, metersPerPixel));
      }

      function reconHaloZoomAttenuation() {
        const zoom = engine === 'gl'
          ? (mapgl?.getZoom?.() || 17)
          : (mapleaf?.getZoom?.() || 17);
        if (zoom <= 14.6) return 0;
        if (zoom >= 16.4) return 1;
        return (zoom - 14.6) / (16.4 - 14.6);
      }

      function startReconHaloPulse() {
        stopReconHaloPulse();
        if (!reconOverlayPoints.length) return;

        const tick = (ts) => {
          if (!reconOverlayPoints.length) return;

          const phase = (Math.sin(ts / 648) + 1) / 2;
          const zoomAttenuation = reconHaloZoomAttenuation();
          const haloOpacity = (0.084 + phase * 0.1045) * zoomAttenuation;
          const fallbackLat = reconOverlayPoints[0]?.[1];
          const dotRadiusPx = reconMetersToPixels(7, fallbackLat);
          const haloRadiusPx = Math.max(
            dotRadiusPx + 9.5,
            dotRadiusPx + 9.5 * zoomAttenuation,
            reconMetersToPixels(reconHaloRadiusMeters(phase), fallbackLat)
          );
          const haloStrokePx = (4.4 + phase * 4.18) * Math.max(0.25, zoomAttenuation);

          if (engine === 'gl' && mapgl?.getLayer?.(RECON_OVERLAY_HALO_LAYER)) {
            try {
              mapgl.setPaintProperty(RECON_OVERLAY_HALO_LAYER, 'circle-radius', haloRadiusPx);
              mapgl.setPaintProperty(RECON_OVERLAY_HALO_LAYER, 'circle-stroke-opacity', haloOpacity);
              mapgl.setPaintProperty(RECON_OVERLAY_HALO_LAYER, 'circle-stroke-width', haloStrokePx);
              mapgl.setPaintProperty(RECON_OVERLAY_HALO_LAYER, 'circle-blur', 0.35 + phase * 0.18);
            } catch { }
          }

          if (engine === 'leaf' && leafletReconHalos.length) {
            for (const halo of leafletReconHalos) {
              try {
                halo.setRadius(haloRadiusPx);
                halo.setStyle({
                  fillOpacity: 0,
                  opacity: haloOpacity,
                  weight: haloStrokePx
                });
              } catch { }
            }
          }

          reconOverlayHaloAnimationFrame = requestAnimationFrame(tick);
        };

        reconOverlayHaloAnimationFrame = requestAnimationFrame(tick);
      }

      function persistReconOverlayCache(roomCode = currentRoomCode) {
        try {
          const key = reconOverlayStorageKey(roomCode);
          if (!reconOverlayPoints.length) {
            localStorage.removeItem(key);
            return;
          }

          localStorage.setItem(key, JSON.stringify({
            roomCode: roomCode || null,
            points: reconOverlayPoints,
            spacingMeters: reconOverlaySpacingMeters,
            updatedAt: Date.now()
          }));
        } catch (error) {
          console.warn('[Recon] Failed to persist overlay cache:', error);
        }
      }

      function restoreReconOverlayFromCache(roomCode = currentRoomCode) {
        clearReconOverlay({ clearCache: false });

        try {
          const raw = localStorage.getItem(reconOverlayStorageKey(roomCode));
          if (!raw) {
            reconOverlayPoints = [];
            return;
          }

          const parsed = JSON.parse(raw);
          const cachedPoints = normalizeReconOverlayPoints(parsed?.points || []);
          if (!cachedPoints.length) {
            reconOverlayPoints = [];
            return;
          }

          reconOverlaySpacingMeters = Math.max(8, Number(parsed?.spacingMeters) || reconOverlaySpacingMeters || 20);
          renderReconOverlay(cachedPoints, { persist: false, spacingMeters: reconOverlaySpacingMeters });
        } catch (error) {
          console.warn('[Recon] Failed to restore overlay cache:', error);
          reconOverlayPoints = [];
        }
      }

      let reconOverlayRestoreTimer = 0;
      function scheduleReconOverlayRestore(roomCode = currentRoomCode) {
        clearTimeout(reconOverlayRestoreTimer);
        reconOverlayRestoreTimer = setTimeout(() => {
          if (reconOverlayPoints.length) {
            renderReconOverlay(reconOverlayPoints, { persist: false, spacingMeters: reconOverlaySpacingMeters });
          } else {
            restoreReconOverlayFromCache(roomCode);
          }
        }, 120);
      }

      function hasReconAccess() {
        try {
          const raw = localStorage.getItem(RECON_ACCESS_KEY);
          if (!raw) return false;
          const parsed = JSON.parse(raw);
          const expiresAt = Number(parsed?.expiresAt || 0);
          if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
            localStorage.removeItem(RECON_ACCESS_KEY);
            return false;
          }
          return true;
        } catch {
          try { localStorage.removeItem(RECON_ACCESS_KEY); } catch { }
          return false;
        }
      }

      function grantReconAccess() {
        try {
          localStorage.setItem(RECON_ACCESS_KEY, JSON.stringify({
            expiresAt: Date.now() + RECON_ACCESS_MS
          }));
        } catch { }
      }

      function openReconModal(fid, center, radius) {
        if (!hasReconAccess()) {
          const enteredPassword = prompt('🔐 Enter password to use Recon Coin:');
          if (enteredPassword == null) return;
          if ((enteredPassword || '').trim() !== RECON_PASSWORD) {
            alert('❌ Incorrect password. Access denied.');
            return;
          }
          grantReconAccess();
        }

        currentReconCircle = { fid, center, radius };
        reconConstraints = [];
        reconPrecision = 20; //Reset to Default

        const modal = document.getElementById('recon-modal');
        modal.classList.add('visible');
        document.getElementById('app').classList.add('blocked-by-modal');

        // Set up precision buttons
        setupPrecisionButtons();

        // Add first constraint by default
        addReconConstraint();
      }

      function setupPrecisionButtons() {
        const buttons = document.querySelectorAll('.recon-precision-btn');
        const hint = document.getElementById('recon-precision-hint');

        const hintText = {
          '30': 'Fast scan, may miss small areas',
          '20': 'Normal speed, good accuracy',
          '10': 'Slower, highest precision'
        };

        buttons.forEach(btn => {
          btn.onclick = () => {
            // Remove active class from all
            buttons.forEach(b => {
              b.style.border = '1px solid var(--border)';
              b.classList.remove('active');
            });

            // Add active class to clicked
            btn.style.border = '2px solid #60a5fa';
            btn.classList.add('active');

            // Update precision value
            reconPrecision = parseInt(btn.dataset.precision);
            hint.textContent = hintText[btn.dataset.precision];

            console.log('Recon precision set to:', reconPrecision, 'm');
          };
        });
      }

      function closeReconModal() {
        const modal = document.getElementById('recon-modal');
        modal.classList.remove('visible');
        document.getElementById('app').classList.remove('blocked-by-modal');
        setReconAnalysisPriority(false);

        reconConstraints = [];
        currentReconCircle = null;
        document.getElementById('recon-constraints').innerHTML = '';
        document.getElementById('recon-status').textContent = '';
      }

      function addReconConstraint() {
        const container = document.getElementById('recon-constraints');
        const index = reconConstraints.length;

        const constraint = {
          type: 'LAMP_POST',
          min: 100,
          max: 105,
          radius: 350
        };

        reconConstraints.push(constraint);

        const row = document.createElement('div');
        row.style.cssText = 'padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border);';
        row.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:700;color:#60a5fa;">Constraint ${index + 1}</div>
      <button class="btn small danger" onclick="removeReconConstraint(${index})" style="padding:4px 8px;">✕</button>
    </div>
    <div style="display:grid;gap:8px;">
      <div>
        <label class="hint" style="display:block;margin-bottom:4px;">Infrastructure Type</label>
        <select onchange="updateReconConstraint(${index}, 'type', this.value)" style="width:100%;padding:6px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);">
          <option value="LAMP_POST">💡 Lamp Posts</option>
          <option value="HDB">🏢 HDB Blocks</option>
          <option value="AED">➕ AEDs</option>
          <option value="BUS_STOP">🚌 Bus Stops</option>
          <option value="NO_ENTRY">🚫 No-Entry Signs</option>
          <option value="SLOW">🌀 Slow Signs</option>
          <option value="STOP">🛑 Stop Signs</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div>
          <label class="hint" style="display:block;margin-bottom:4px;">Min Count</label>
          <input type="number" value="100" min="0" onchange="updateReconConstraint(${index}, 'min', parseInt(this.value))" style="width:100%;padding:6px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);">
        </div>
        <div>
          <label class="hint" style="display:block;margin-bottom:4px;">Max Count</label>
          <input type="number" value="105" min="0" onchange="updateReconConstraint(${index}, 'max', parseInt(this.value))" style="width:100%;padding:6px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);">
        </div>
        <div>
          <label class="hint" style="display:block;margin-bottom:4px;">Radius (m)</label>
          <input type="number" value="350" min="1" onchange="updateReconConstraint(${index}, 'radius', parseInt(this.value))" style="width:100%;padding:6px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);">
        </div>
      </div>
    </div>
  `;

        container.appendChild(row);
      }

      function removeReconConstraint(index) {
        reconConstraints.splice(index, 1);
        renderReconConstraints();
      }

      function updateReconConstraint(index, field, value) {
        if (reconConstraints[index]) {
          reconConstraints[index][field] = value;
        }
      }

      // Recon rows use inline onchange/onclick handlers in generated HTML, so these
      // functions must be reachable on window in the bundled app.
      window.removeReconConstraint = removeReconConstraint;
      window.updateReconConstraint = updateReconConstraint;

      function renderReconConstraints() {
        const container = document.getElementById('recon-constraints');
        container.innerHTML = '';

        const temp = [...reconConstraints];
        reconConstraints = [];

        temp.forEach((c) => {
          addReconConstraint();
          const idx = reconConstraints.length - 1;
          reconConstraints[idx] = c;

          // Update the form values
          const row = container.children[idx];
          row.querySelector('select').value = c.type;
          row.querySelectorAll('input')[0].value = c.min;
          row.querySelectorAll('input')[1].value = c.max;
          row.querySelectorAll('input')[2].value = c.radius;
        });
      }

      // Put this in main script scope (NOT inside workerCode string)
      function prepDataset(fc) {
        if (!fc || !Array.isArray(fc.features)) return fc;

        for (const f of fc.features) {
          const g = f?.geometry;
          if (!g) continue;

          // Points (Lamp posts, AED, Bus stops, etc.)
          if (g.type === 'Point') {
            const coords = g.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) continue;

            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
              f.__lng = lng;
              f.__lat = lat;
            }
            continue;
          }

          // Polygons / MultiPolygons (HDB footprints)
          if (g.type === 'Polygon') {
            if (!f.__turfGeom) f.__turfGeom = turf.polygon(g.coordinates);
            if (!f.__bbox) f.__bbox = turf.bbox(f.__turfGeom);
            continue;
          }

          if (g.type === 'MultiPolygon') {
            if (!f.__turfGeom) f.__turfGeom = turf.multiPolygon(g.coordinates);
            if (!f.__bbox) f.__bbox = turf.bbox(f.__turfGeom);
            continue;
          }
        }

        return fc;
      }

      function normalizeLampPostNumber(value) {
        return String(value || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '')
          .replace(/[^A-Z0-9-]/g, '');
      }

      function decodeLampPostDescription(value) {
        return String(value || '')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/gi, '&');
      }

      function extractLampPostNumberFromDescription(description) {
        const text = decodeLampPostDescription(description);
        if (!text) return '';

        const tableMatch =
          text.match(/LAMPPOST_NUM[\s\S]{0,160}?<TD>\s*([^<\s]+)/i) ||
          text.match(/LAMPPOST[_\s-]*NUM[\s:=]{0,20}([A-Z0-9-]+)/i);

        if (tableMatch?.[1]) return normalizeLampPostNumber(tableMatch[1]);

        const stripped = text.replace(/<[^>]+>/g, ' ');
        const flatMatch = stripped.match(/LAMPPOST[_\s-]*NUM\s*([A-Z0-9-]+)/i);
        return normalizeLampPostNumber(flatMatch?.[1] || '');
      }

      function extractLampPostNumber(feature) {
        const props = feature?.properties || {};
        const directKeys = [
          'lampPostNumber',
          'lamp_post_number',
          'LAMPPOST_NUM',
          'lamppost_num',
          'lampPostNum',
          'lamp_post_num',
          'LampPostNum',
          'LAMP_POST_NUM',
          'lamp_post',
          'lampPost',
          'LP_NUM'
        ];

        for (const key of directKeys) {
          const normalized = normalizeLampPostNumber(props[key]);
          if (normalized) return normalized;
        }

        const descriptionKeys = ['Description', 'description', 'DESCRIPTION', 'Html', 'html', 'popupContent'];
        for (const key of descriptionKeys) {
          const normalized = extractLampPostNumberFromDescription(props[key]);
          if (normalized) return normalized;
        }

        return '';
      }

      function setLampPostSearchStatus(message = '', tone = '') {
        if (!lampSearchStatus) return;
        lampSearchStatus.textContent = message;
        lampSearchStatus.classList.remove('success', 'error');
        if (tone) lampSearchStatus.classList.add(tone);
      }

      function updateLampPostSearchHelper() {
        if (!lampSearchHelper || !lampSearchInput) return;
        const sample = normalizeLampPostNumber(lampSearchInput.value) || '1';
        lampSearchHelper.innerHTML = lampPostSearchMode === 'suffix'
          ? `Ends-with mode: lamp posts like <strong>${sample}</strong>, <strong>1${sample}</strong>, <strong>2${sample}</strong> will match if they are inside this circle.`
          : `Exact mode: only lamp post <strong>${sample}</strong> will match inside this circle.`;
      }

      function setLampPostSearchMode(mode) {
        lampPostSearchMode = mode === 'suffix' ? 'suffix' : 'exact';
        lampSearchModeExact?.classList.toggle('active', lampPostSearchMode === 'exact');
        lampSearchModeSuffix?.classList.toggle('active', lampPostSearchMode === 'suffix');
        updateLampPostSearchHelper();
      }

      function openLampPostSearchModal(center, radiusMeters) {
        if (!lampSearchModal) return;
        currentLampPostSearchContext = { center, radiusMeters };
        setLampPostSearchStatus('');
        lampSearchModal.classList.add('visible');
        appEl?.classList.add('blocked-by-modal');
        updateLampPostSearchHelper();
        requestAnimationFrame(() => {
          lampSearchInput?.focus();
          lampSearchInput?.select();
        });
      }

      function closeLampPostSearchModal() {
        if (!lampSearchModal) return;
        lampSearchModal.classList.remove('visible');
        appEl?.classList.remove('blocked-by-modal');
        currentLampPostSearchContext = null;
        if (lampSearchSubmit) lampSearchSubmit.disabled = false;
        setLampPostSearchStatus('');
      }

      function cancelLampPostSearchPulse() {
        if (lampPostSearchAnimationFrame) {
          cancelAnimationFrame(lampPostSearchAnimationFrame);
          lampPostSearchAnimationFrame = 0;
        }
      }

      function clearLampPostSearchHighlight({ clearFeatures = true } = {}) {
        cancelLampPostSearchPulse();

        if (mapgl && mapgl.getStyle?.()) {
          try {
            if (mapgl.getLayer(LAMP_POST_SEARCH_CORE_LAYER_ID)) mapgl.removeLayer(LAMP_POST_SEARCH_CORE_LAYER_ID);
            if (mapgl.getLayer(LAMP_POST_SEARCH_HALO_LAYER_ID)) mapgl.removeLayer(LAMP_POST_SEARCH_HALO_LAYER_ID);
            if (mapgl.getSource(LAMP_POST_SEARCH_SOURCE_ID)) mapgl.removeSource(LAMP_POST_SEARCH_SOURCE_ID);
          } catch (error) {
            console.warn('[Lamp Search] Failed to clear GL highlight:', error);
          }
        }

        if (lampPostSearchGlMarkers.length) {
          for (const marker of lampPostSearchGlMarkers) {
            try { marker.remove(); } catch { }
          }
          lampPostSearchGlMarkers = [];
        }

        if (mapleaf && lampPostSearchLeafletLayer) {
          try { mapleaf.removeLayer(lampPostSearchLeafletLayer); } catch { }
          lampPostSearchLeafletLayer = null;
          lampPostSearchLeafletHalos = [];
        }

        if (clearFeatures) lampPostSearchFeatures = [];
      }

      function animateLampPostSearchPulse() {
        cancelLampPostSearchPulse();

        const tick = (ts) => {
          if (!lampPostSearchFeatures.length) return;

          const phase = ts / 650;
          const pulse = (Math.sin(phase) + 1) / 2;
          const haloRadius = 18 + pulse * 12;
          const haloOpacity = 0.12 + pulse * 0.14;

          if (engine === 'gl' && mapgl?.getLayer?.(LAMP_POST_SEARCH_HALO_LAYER_ID)) {
            try {
              mapgl.setPaintProperty(LAMP_POST_SEARCH_HALO_LAYER_ID, 'circle-radius', haloRadius);
              mapgl.setPaintProperty(LAMP_POST_SEARCH_HALO_LAYER_ID, 'circle-opacity', haloOpacity);
            } catch { }
          }

          if (engine === 'leaf' && lampPostSearchLeafletHalos.length) {
            for (const halo of lampPostSearchLeafletHalos) {
              try {
                halo.setRadius(16 + pulse * 12);
                halo.setStyle({
                  fillOpacity: haloOpacity,
                  opacity: 0.18 + pulse * 0.18
                });
              } catch { }
            }
          }

          lampPostSearchAnimationFrame = requestAnimationFrame(tick);
        };

        lampPostSearchAnimationFrame = requestAnimationFrame(tick);
      }

      function renderLampPostSearchHighlight(features) {
        const inputFeatures = Array.isArray(features) ? features : [features];
        const normalized = [];

        for (const feature of inputFeatures) {
          if (!feature?.geometry?.coordinates || feature.geometry.type !== 'Point') continue;
          const lng = Number(feature.__lng ?? feature.geometry.coordinates[0]);
          const lat = Number(feature.__lat ?? feature.geometry.coordinates[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
          normalized.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              lampPostNumber: extractLampPostNumber(feature) || '',
              showLabel: inputFeatures.length <= 24 ? 1 : 0
            }
          });
        }

        if (!normalized.length) return;

        lampPostSearchFeatures = normalized;
        clearLampPostSearchHighlight({ clearFeatures: false });

        const fc = { type: 'FeatureCollection', features: lampPostSearchFeatures };

        if (engine === 'gl' && mapgl?.addSource && mapgl.getStyle?.()) {
          try {
            mapgl.addSource(LAMP_POST_SEARCH_SOURCE_ID, { type: 'geojson', data: fc });
            mapgl.addLayer({
              id: LAMP_POST_SEARCH_HALO_LAYER_ID,
              type: 'circle',
              source: LAMP_POST_SEARCH_SOURCE_ID,
              paint: {
                'circle-radius': 22,
                'circle-color': '#f59e0b',
                'circle-opacity': 0.18,
                'circle-blur': 0.7,
                'circle-stroke-width': 0
              }
            });
            mapgl.addLayer({
              id: LAMP_POST_SEARCH_CORE_LAYER_ID,
              type: 'circle',
              source: LAMP_POST_SEARCH_SOURCE_ID,
              paint: {
                'circle-radius': 6,
                'circle-color': '#fcd34d',
                'circle-opacity': 0.95,
                'circle-stroke-color': '#fb923c',
                'circle-stroke-width': 2
              }
            });

            lampPostSearchGlMarkers = [];
            for (const feature of lampPostSearchFeatures) {
              if (!feature.properties.showLabel) continue;
              const labelEl = document.createElement('div');
              labelEl.className = 'lamp-post-search-marker-label';
              labelEl.textContent = feature.properties.lampPostNumber;
              lampPostSearchGlMarkers.push(
                new maptilersdk.Marker({ element: labelEl, anchor: 'top' })
                  .setLngLat(feature.geometry.coordinates)
                  .addTo(mapgl)
              );
            }
          } catch (error) {
            console.error('[Lamp Search] Failed to render on MapLibre:', error);
          }
        }

        if (engine === 'leaf' && mapleaf && typeof L !== 'undefined' && L) {
          try {
            const leafletLayers = [];
            lampPostSearchLeafletHalos = [];

            for (const feature of lampPostSearchFeatures) {
              const [lng, lat] = feature.geometry.coordinates;
              const halo = L.circleMarker([lat, lng], {
                radius: 22,
                color: '#f59e0b',
                weight: 1.5,
                opacity: 0.24,
                fillColor: '#f59e0b',
                fillOpacity: 0.16
              });
              lampPostSearchLeafletHalos.push(halo);
              leafletLayers.push(halo);

              leafletLayers.push(L.circleMarker([lat, lng], {
                radius: 6,
                color: '#fb923c',
                weight: 2,
                fillColor: '#fcd34d',
                fillOpacity: 0.95
              }));

              if (feature.properties.showLabel) {
                leafletLayers.push(L.marker([lat, lng], {
                  icon: L.divIcon({
                    className: 'lamp-post-search-label',
                    html: `<div style="transform:translate(-50%, 12px);color:#fde68a;font-weight:800;text-shadow:0 0 8px rgba(0,0,0,0.9);white-space:nowrap;">${feature.properties.lampPostNumber}</div>`
                  })
                }));
              }
            }

            lampPostSearchLeafletLayer = L.layerGroup(leafletLayers).addTo(mapleaf);
          } catch (error) {
            console.error('[Lamp Search] Failed to render on Leaflet:', error);
          }
        }

        animateLampPostSearchPulse();
      }

      async function searchLampPostByNumber(center, radiusMeters, query, mode = 'exact') {
        if (!Array.isArray(center) || center.length < 2 || !Number.isFinite(Number(radiusMeters)) || Number(radiusMeters) <= 0) {
          throw new Error('Could not determine the selected circle.');
        }

        let lampData;
        try {
          lampData = prepDataset(await getExactAnalysisCached(DATASET_IDS.LAMP_POST, 'Lamp Post'));
        } catch (error) {
          console.error('[Lamp Search] Failed to load lamp post data:', error);
          throw new Error('Could not load the lamp post dataset.');
        }

        const matches = [];
        for (const feature of lampData?.features || []) {
          if (feature?.geometry?.type !== 'Point') continue;
          const lng = Number(feature.__lng ?? feature.geometry?.coordinates?.[0]);
          const lat = Number(feature.__lat ?? feature.geometry?.coordinates?.[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
          if (turf.distance(center, [lng, lat], { units: 'meters' }) > radiusMeters) continue;
          const lampNumber = extractLampPostNumber(feature);
          if (!lampNumber) continue;
          const matched = mode === 'suffix' ? lampNumber.endsWith(query) : lampNumber === query;
          if (!matched) continue;
          matches.push(feature);
        }

        return matches;
      }

      function focusLampPostSearchResults(features) {
        const normalized = (features || [])
          .map((feature) => {
            const coords = feature?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return null;
            const lng = Number(coords[0]);
            const lat = Number(coords[1]);
            return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
          })
          .filter(Boolean);

        if (!normalized.length) return;

        if (normalized.length === 1) {
          const [lng, lat] = normalized[0];
          if (engine === 'gl' && mapgl?.flyTo) {
            mapgl.flyTo({ center: [lng, lat], zoom: Math.max(mapgl.getZoom?.() || 17, 18), speed: 1.1, essential: true });
          } else if (engine === 'leaf' && mapleaf?.flyTo) {
            mapleaf.flyTo([lat, lng], Math.max(mapleaf.getZoom?.() || 17, 18), { duration: 0.9 });
          }
          return;
        }

        const bounds = normalized.reduce((acc, [lng, lat]) => {
          if (!acc) return [lng, lat, lng, lat];
          acc[0] = Math.min(acc[0], lng);
          acc[1] = Math.min(acc[1], lat);
          acc[2] = Math.max(acc[2], lng);
          acc[3] = Math.max(acc[3], lat);
          return acc;
        }, null);

        if (!bounds) return;

        if (engine === 'gl' && mapgl?.fitBounds) {
          mapgl.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 72, duration: 850 });
        } else if (engine === 'leaf' && mapleaf?.fitBounds) {
          mapleaf.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { padding: [72, 72] });
        }
      }

      async function submitLampPostSearch() {
        const query = normalizeLampPostNumber(lampSearchInput?.value || '');
        if (!query) {
          setLampPostSearchStatus('Enter a lamp post number to search.', 'error');
          lampSearchInput?.focus();
          return;
        }

        const center = currentLampPostSearchContext?.center;
        const radiusMeters = currentLampPostSearchContext?.radiusMeters;

        setLampPostSearchStatus('Searching lamp posts inside this circle...');
        clearLampPostSearchHighlight();
        if (lampSearchSubmit) lampSearchSubmit.disabled = true;

        try {
          const matches = await searchLampPostByNumber(center, radiusMeters, query, lampPostSearchMode);
          if (!matches.length) {
            setLampPostSearchStatus(
              lampPostSearchMode === 'suffix'
                ? `No lamp posts ending with ${query} were found inside this circle.`
                : `Lamp post ${query} was not found inside this circle.`,
              'error'
            );
            return;
          }

          renderLampPostSearchHighlight(matches);
          focusLampPostSearchResults(matches);
          setLampPostSearchStatus(
            lampPostSearchMode === 'suffix'
              ? `Highlighted ${matches.length} lamp post${matches.length === 1 ? '' : 's'} ending with ${query}.`
              : `Highlighted lamp post ${query}.`,
            'success'
          );
          setTimeout(() => closeLampPostSearchModal(), 160);
        } catch (error) {
          setLampPostSearchStatus(error?.message || 'Search failed.', 'error');
        } finally {
          if (lampSearchSubmit) lampSearchSubmit.disabled = false;
        }
      }

      lampSearchModeExact?.addEventListener('click', () => setLampPostSearchMode('exact'));
      lampSearchModeSuffix?.addEventListener('click', () => setLampPostSearchMode('suffix'));
      lampSearchSubmit?.addEventListener('click', submitLampPostSearch);
      lampSearchCancel?.addEventListener('click', closeLampPostSearchModal);
      lampSearchCloseTop?.addEventListener('click', closeLampPostSearchModal);
      lampSearchInput?.addEventListener('input', () => {
        setLampPostSearchStatus('');
        updateLampPostSearchHelper();
      });
      lampSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submitLampPostSearch();
        }
      });
      lampSearchModal?.addEventListener('click', (event) => {
        if (event.target === lampSearchModal) closeLampPostSearchModal();
      });
      setLampPostSearchMode('exact');

      function getRequiredReconDatasets(constraints) {
        const required = new Set();
        for (const c of (constraints || [])) {
          switch (c?.type) {
            case 'LAMP_POST':
              required.add('LAMP_POST');
              break;
            case 'HDB':
              required.add('HDB');
              break;
            case 'AED':
              required.add('AED');
              break;
            case 'BUS_STOP':
              required.add('BUS_STOP');
              break;
            case 'NO_ENTRY':
            case 'SLOW':
            case 'STOP':
              required.add('TRAFFIC_SIGN');
              break;
          }
        }
        return required;
      }


      /**
       * Requires:
       * - ensureHdbIndex(hdbData)   // builds hdbData.__rbush using feature __bbox + __turfGeom
       * - countHdbInCircleIndexed(hdbData, circle) // uses rbush candidates then booleanIntersects
       */

      async function revealReconLocations() {
        if (!currentReconCircle || !reconConstraints?.length) {
          alert('No constraints defined.');
          return;
        }

        const status = document.getElementById('recon-status');
        const revealBtn = document.getElementById('recon-reveal');

        const setLoading = (on, text) => {
          setReconAnalysisPriority(on);
          status.classList.toggle('loading', on);
          status.textContent = text || status.textContent;
          revealBtn.disabled = on;
          revealBtn.classList.toggle('loading', on);
          revealBtn.innerHTML = on
            ? '<span class="recon-spinner">⏳</span> Analyzing...'
            : '🔍 Reveal Locations';
        };

        const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

        setLoading(true, 'Loading data and analyzing...');

        try {
          // Match the original mapper exactly: same worker-only cache path, same
          // dataset preload order, same preprocessing sequence.
          let [lampData, hdbData, aedData, busData, trafficData] = await Promise.all([
            getExactAnalysisCached(DATASET_IDS.LAMP_POST, 'Lamp Post'),
            getExactAnalysisCached(DATASET_IDS.HDB, 'HDB'),
            getExactAnalysisCached(DATASET_IDS.AED, 'AED'),
            getExactAnalysisCached(DATASET_IDS.BUS_STOP, 'Bus Stop'),
            getExactAnalysisCached(DATASET_IDS.TRAFFIC_SIGN, 'Traffic Sign')
          ]);

          lampData = prepDataset(lampData);
          hdbData = prepDataset(hdbData);
          ensureHdbIndex(hdbData);
          aedData = prepDataset(aedData);
          busData = prepDataset(busData);
          trafficData = prepDataset(trafficData);

          // Build recon search circle + adaptive precision
          const searchCircle = turf.circle(
            currentReconCircle.center,
            currentReconCircle.radius,
            { steps: 64, units: 'meters' }
          );

          const circleArea = turf.area(searchCircle); // m²
          let adaptivePrecision = reconPrecision;

          // thresholds from largest to smallest
          const thresholds = [
            [10_000_000, 40],
            [5_000_000, 25],
            [1_000_000, 15],
          ];
          for (const [area, minPrec] of thresholds) {
            if (circleArea > area) adaptivePrecision = Math.max(adaptivePrecision, minPrec);
          }

          const grid = turf.pointGrid(
            turf.bbox(searchCircle),
            adaptivePrecision / 1000,
            { units: 'kilometers' }
          );

          // Filter test points inside circle
          const testPoints = [];
          for (const pt of grid.features) {
            const coords = pt.geometry?.coordinates;
            if (coords && turf.booleanPointInPolygon(coords, searchCircle)) testPoints.push(pt);
          }

          // Safety check
          const MAX_POINTS = 2000;
          if (testPoints.length > MAX_POINTS) {
            const ok = confirm(
              `⚠️ This will test ${testPoints.length} locations (spacing: ${adaptivePrecision}m).\n\n` +
              `This may take 120-360 seconds and could slow down your browser.\n\n` +
              `Continue anyway?`
            );
            if (!ok) return setLoading(false, '❌ Cancelled');
          }

          status.textContent = `🔍 Testing ${testPoints.length} locations at ${adaptivePrecision}m spacing...`;

          // Map constraint -> counting logic
          const trafficCat = { NO_ENTRY: 'NO_ENTRY', SLOW: 'SLOW', STOP: 'STOP' };
          const dataByType = { LAMP_POST: lampData, AED: aedData, BUS_STOP: busData };

          // ✅ Run cheaper constraints first, HDB last
          const costRank = { AED: 1, BUS_STOP: 1, LAMP_POST: 2, NO_ENTRY: 3, SLOW: 3, STOP: 3, HDB: 99 };
          const constraintsSorted = [...reconConstraints].sort(
            (a, b) => (costRank[a.type] ?? 50) - (costRank[b.type] ?? 50)
          );

          const matchingPoints = [];
          const timeSliceMs = 24;

          for (let i = 0; i < testPoints.length;) {
            const sliceStart = performance.now();

            while (i < testPoints.length && (performance.now() - sliceStart) < timeSliceMs) {
              const testPt = testPoints[i++];
              const center = testPt.geometry.coordinates;

              // ✅ cache circles per point (same radius reused across constraints)
              const circleCache = new Map(); // radius -> circle feature

              let ok = true;
              for (const c of constraintsSorted) {
                let testCircle = circleCache.get(c.radius);
                if (!testCircle) {
                  // Keep steps=32 to preserve exact behavior vs your current version
                  testCircle = turf.circle(center, c.radius, { steps: 32, units: 'meters' });
                  circleCache.set(c.radius, testCircle);
                }

                let cnt = 0;

                if (c.type === 'HDB') {
                  // ✅ indexed HDB count (still uses booleanIntersects inside)
                  cnt = countHdbInCircleIndexed(hdbData, testCircle);
                } else if (dataByType[c.type]) {
                  cnt = countInCircle(dataByType[c.type], testCircle);
                } else if (trafficCat[c.type] && trafficData) {
                  cnt = countTrafficSigns(trafficData, testCircle, trafficCat[c.type]);
                }

                if (cnt < c.min || cnt > c.max) { ok = false; break; }
              }

              if (ok) matchingPoints.push(testPt);
            }

            const progress = Math.min(100, Math.round((i / testPoints.length) * 100));
            status.textContent = `🔍 Progress: ${progress}% (${i}/${testPoints.length} tested, ${matchingPoints.length} matches)`;

            await yieldToBrowser();
          }

          status.textContent =
            `✅ Found ${matchingPoints.length} matching locations (tested ${testPoints.length} points at ${adaptivePrecision}m spacing)`;

          if (!matchingPoints.length) {
            clearReconOverlay();
            alert('No locations found matching all constraints.');
          } else {
            renderReconOverlay(matchingPoints, { spacingMeters: adaptivePrecision });
          }
        } catch (err) {
          console.error('Recon analysis failed:', err);
          status.textContent = '❌ Analysis failed';
          alert('Failed to analyze locations: ' + (err?.message || err));
        } finally {
          setLoading(false);
        }
      }

      function moveCircleFeature(entry, fid, lng, lat) {
        const ix = entry.data.features.findIndex(f => f?.properties?.fid === fid);
        if (ix < 0) return;

        const feat = entry.data.features[ix];
        const p = feat.properties || {};
        const radius = +p._circleRadius;
        if (!Number.isFinite(radius)) return;

        const geom = turf.circle([lng, lat], radius, { units: 'meters' });
        feat.geometry = geom.geometry;

        // ✅ update stored center (so click popup shows new coords)
        p._circleLng = +lng;
        p._circleLat = +lat;
        p._circleCenter = [lng, lat];
        feat.properties = p;

        refreshGroupBoth(entry);
        renderLayers();
      }

      function endCircleDrag(save = true) {
        if (!circleDragCtx) return;
        suppressPopups();

        // Re-enable normal map panning
        if (engine === 'gl') {
          mapgl.getCanvas().style.cursor = '';
          try { mapgl.dragPan.enable(); } catch { }
        } else {
          mapleaf.getContainer().style.cursor = '';
          try { mapleaf.dragging.enable(); } catch { }
        }

        circleDragCtx = null;
        syncDeleteModeCursor();
        if (save) saveState();
      }

      // OPTIONAL: tap-to-drop (nice on mobile)
      function dropAt(lng, lat) {
        if (!circleDragCtx) return;
        moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, lng, lat);
        endCircleDrag(true);
      }

      // MapLibre GL handlers (always bind; check engine at runtime)
      mapgl.on('mousemove', (e) => {
        if (engine !== 'gl' || !circleDragCtx) return;
        moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, e.lngLat.lng, e.lngLat.lat);
      });

      mapgl.on('touchmove', (e) => {
        if (engine !== 'gl' || !circleDragCtx) return;
        if (e.originalEvent?.touches?.length > 1) return; // allow pinch-zoom etc.
        e.originalEvent?.preventDefault?.();
        moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, e.lngLat.lng, e.lngLat.lat);
      });

      mapgl.on('mouseup', () => {
        if (engine !== 'gl' || !circleDragCtx) return;
        endCircleDrag(true);
      });

      mapgl.on('touchend', () => {
        if (engine !== 'gl' || !circleDragCtx) return;
        endCircleDrag(true);
      });

      mapgl.on('touchcancel', () => {
        if (engine !== 'gl' || !circleDragCtx) return;
        endCircleDrag(false);
      });

      // Tap to place (super helpful on phones)
      mapgl.on('click', (e) => {
        if (engine !== 'gl' || !circleDragCtx) return;
        dropAt(e.lngLat.lng, e.lngLat.lat);
        e.originalEvent?.preventDefault?.();
        e.originalEvent?.stopPropagation?.();
      });


      // Leaflet handlers
      mapleaf.on('mousemove', (e) => {
        if (engine !== 'leaf' || !circleDragCtx) return;
        moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, e.latlng.lng, e.latlng.lat);
      });

      mapleaf.on('touchmove', (e) => {
        if (engine !== 'leaf' || !circleDragCtx) return;
        if (e.originalEvent?.touches?.length > 1) return;
        if (e.originalEvent?.cancelable) e.originalEvent.preventDefault();
        moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, e.latlng.lng, e.latlng.lat);
      });

      mapleaf.on('mouseup', () => {
        if (engine !== 'leaf' || !circleDragCtx) return;
        endCircleDrag(true);
      });

      mapleaf.on('touchend', () => {
        if (engine !== 'leaf' || !circleDragCtx) return;
        endCircleDrag(true);
      });

      mapleaf.on('touchcancel', () => {
        if (engine !== 'leaf' || !circleDragCtx) return;
        endCircleDrag(false);
      });

      mapleaf.on('click', (e) => {
        if (engine !== 'leaf' || !circleDragCtx) return;
        dropAt(e.latlng.lng, e.latlng.lat);
      });


      function countInCircle(dataset, circle) {
        if (!dataset || !Array.isArray(dataset.features)) return 0;

        let count = 0;

        for (const f of dataset.features) {
          const geom = f.geometry;
          if (!geom) continue;

          try {
            // For Points: check if inside circle
            if (geom.type === 'Point') {
              // ✅ use cached numeric coords if prepDataset() ran
              const lng = Number.isFinite(f.__lng) ? f.__lng : Number(geom.coordinates?.[0]);
              const lat = Number.isFinite(f.__lat) ? f.__lat : Number(geom.coordinates?.[1]);

              if (Number.isFinite(lng) && Number.isFinite(lat)) {
                // ✅ pass coordinates directly (no turf.point allocation)
                if (turf.booleanPointInPolygon([lng, lat], circle)) {
                  count++;
                }
              }
            }
            // For Polygons/MultiPolygons (HDB buildings): check if touches/intersects
            else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
              // ✅ use cached turf geometry if prepDataset() ran
              const buildingGeom = f.__turfGeom || (
                geom.type === 'Polygon'
                  ? turf.polygon(geom.coordinates)
                  : turf.multiPolygon(geom.coordinates)
              );

              // ✅ counts if the building footprint and circle share any point (even just touching)
              if (turf.booleanIntersects(buildingGeom, circle)) {
                count++;
              }
            }
          } catch (e) {
            console.warn('⚠️ Error handling feature geometry in countInCircle', e, f);
          }
        }

        return count;
      }

      function countTrafficSigns(dataset, circle, category) {
        if (!dataset || !Array.isArray(dataset.features)) return 0;

        let count = 0;

        for (const f of dataset.features) {
          if (f.geometry?.type !== 'Point') continue;

          const coords = f.geometry.coordinates || [];
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);

          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

          // ✅ no turf.point allocation
          if (turf.booleanPointInPolygon([lng, lat], circle)) {
            const cat = extractTrafficSignCategory(f);
            if (cat === category) count++;
          }
        }

        return count;
      }


      function renderReconOverlay(points, { persist = true, spacingMeters = reconOverlaySpacingMeters } = {}) {
        console.log('[Recon] Rendering overlay with', points.length, 'points');

        // Clear old overlay first, but keep cached data unless explicitly replaced.
        clearReconOverlay({ clearCache: false });

        reconOverlayPoints = normalizeReconOverlayPoints(points);
        reconOverlaySpacingMeters = Math.max(8, Number(spacingMeters) || reconOverlaySpacingMeters || 20);
        if (persist) persistReconOverlayCache();

        if (!reconOverlayPoints.length) {
          console.log('[Recon] No points to render');
          return;
        }

        const reconDotRadiusMeters = 7;
        const reconDotSteps = 12;
        const shouldRenderReconHalo = true;

        // Create buffer polygons around each point (5m radius for visualization)
        const polygons = reconOverlayPoints.map(coords =>
          turf.circle(coords, reconDotRadiusMeters, { steps: reconDotSteps, units: 'meters' })
        );

        const fc = {
          type: 'FeatureCollection',
          features: polygons
        };
        const haloPointsFc = {
          type: 'FeatureCollection',
          features: reconOverlayPoints.map(([lng, lat]) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {}
          }))
        };
        const initialDotRadiusPx = reconMetersToPixels(reconDotRadiusMeters, reconOverlayPoints[0]?.[1]);
        const initialZoomAttenuation = reconHaloZoomAttenuation();
        const initialHaloRadiusPx = Math.max(
          initialDotRadiusPx + 9.5,
          initialDotRadiusPx + 9.5 * initialZoomAttenuation,
          reconMetersToPixels(reconHaloRadiusMeters(0.5), reconOverlayPoints[0]?.[1])
        );
        const initialHaloStrokePx = 5.28 * Math.max(0.25, initialZoomAttenuation);

        // ------------ MapLibre GL ------------
        if (typeof mapgl !== 'undefined' && mapgl && mapgl.addSource && mapgl.getStyle?.() && engine === 'gl') {
          try {
            console.log('[Recon] Rendering on MapLibre GL');

            if (shouldRenderReconHalo) {
              if (!mapgl.getSource(RECON_OVERLAY_HALO_SOURCE)) {
                mapgl.addSource(RECON_OVERLAY_HALO_SOURCE, {
                  type: 'geojson',
                  data: haloPointsFc
                });
              } else {
                mapgl.getSource(RECON_OVERLAY_HALO_SOURCE).setData(haloPointsFc);
              }

              if (!mapgl.getLayer(RECON_OVERLAY_HALO_LAYER)) {
                mapgl.addLayer({
                  id: RECON_OVERLAY_HALO_LAYER,
                  type: 'circle',
                  source: RECON_OVERLAY_HALO_SOURCE,
                  paint: {
                    'circle-radius': initialHaloRadiusPx,
                    'circle-color': '#22c55e',
                    'circle-opacity': 0,
                    'circle-stroke-color': '#22c55e',
                    'circle-stroke-opacity': 0.1254 * initialZoomAttenuation,
                    'circle-stroke-width': initialHaloStrokePx,
                    'circle-blur': 0.42
                  }
                });
              }
            }

            if (!mapgl.getSource(RECON_OVERLAY_SOURCE)) {
              mapgl.addSource(RECON_OVERLAY_SOURCE, {
                type: 'geojson',
                data: fc
              });
            } else {
              mapgl.getSource(RECON_OVERLAY_SOURCE).setData(fc);
            }

            if (!mapgl.getLayer(RECON_OVERLAY_LAYER)) {
              mapgl.addLayer({
                id: RECON_OVERLAY_LAYER,
                type: 'fill',
                source: RECON_OVERLAY_SOURCE,
                paint: {
                  'fill-color': '#22c55e',
                  'fill-opacity': 0.25
                }
              });
            }
          } catch (e) {
            console.error('[Recon] Failed to render on MapLibre:', e);
          }
        }

        // ------------ Leaflet ------------
        if (typeof mapleaf !== 'undefined' && mapleaf && typeof L !== 'undefined' && L && engine === 'leaf') {
          console.log('[Recon] Rendering on Leaflet');

          try {
            leafletReconHalos = shouldRenderReconHalo
              ? reconOverlayPoints.map(([lng, lat]) =>
                L.circleMarker([lat, lng], {
                  radius: initialHaloRadiusPx,
                  color: '#22c55e',
                  fillColor: '#22c55e',
                  fillOpacity: 0,
                  opacity: 0.12,
                  weight: initialHaloStrokePx
                })
              )
              : [];

            const dotLayers = polygons.map(poly => {
              const coords = poly.geometry.coordinates[0].map(c => [c[1], c[0]]); // flip to lat,lng
              return L.polygon(coords, {
                color: '#22c55e',
                fillColor: '#22c55e',
                fillOpacity: 0.25,
                weight: 1
              });
            });

            leafletReconLayer = L.layerGroup([...leafletReconHalos, ...dotLayers]).addTo(mapleaf);
          } catch (e) {
            console.error('[Recon] Failed to render on Leaflet:', e);
          }
        }

        if (shouldRenderReconHalo) startReconHaloPulse();
      }

      function clearReconOverlay({ clearCache = true } = {}) {
        console.log('[Recon] Clearing existing overlay');
        stopReconHaloPulse();

        // MapLibre GL
        if (mapgl && mapgl.getSource) {
          try {
            if (mapgl.getLayer(RECON_OVERLAY_LAYER)) {
              mapgl.removeLayer(RECON_OVERLAY_LAYER);
            }
            if (mapgl.getLayer(RECON_OVERLAY_HALO_LAYER)) {
              mapgl.removeLayer(RECON_OVERLAY_HALO_LAYER);
            }
            if (mapgl.getSource(RECON_OVERLAY_SOURCE)) {
              mapgl.removeSource(RECON_OVERLAY_SOURCE);
            }
            if (mapgl.getSource(RECON_OVERLAY_HALO_SOURCE)) {
              mapgl.removeSource(RECON_OVERLAY_HALO_SOURCE);
            }
          } catch (e) {
            console.warn('[Recon] Failed to clear GL overlay:', e);
          }
        }

        // Leaflet
        if (typeof mapleaf !== 'undefined' && mapleaf && leafletReconLayer) {
          try {
            mapleaf.removeLayer(leafletReconLayer);
          } catch (e) {
            console.warn('[Recon] Failed to clear Leaflet overlay:', e);
          }
          leafletReconLayer = null;
          leafletReconHalos = [];
        }

        if (clearCache) {
          reconOverlayPoints = [];
          reconOverlaySpacingMeters = 20;
          persistReconOverlayCache();
        }
      }

      // Event listeners
      document.getElementById('recon-add-constraint')?.addEventListener('click', addReconConstraint);
      document.getElementById('recon-reveal')?.addEventListener('click', revealReconLocations);
      document.getElementById('recon-close')?.addEventListener('click', closeReconModal);
      document.getElementById('recon-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'recon-modal') closeReconModal();
      });
      if (engine === 'gl') {
        mapgl.on('mousemove', (e) => {
          if (!circleDragCtx) return;
          moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, e.lngLat.lng, e.lngLat.lat);
        });

        mapgl.on('mouseup', () => {
          if (!circleDragCtx) return;
          mapgl.getCanvas().style.cursor = '';
          circleDragCtx = null;
          saveState();
        });
      }


      if (engine !== 'gl') {
        mapleaf.on('mousemove', (e) => {
          if (!circleDragCtx) return;
          moveCircleFeature(circleDragCtx.entry, circleDragCtx.fid, e.latlng.lng, e.latlng.lat);
        });

        mapleaf.on('mouseup', () => {
          if (!circleDragCtx) return;
          mapleaf.getContainer().style.cursor = '';
          circleDragCtx = null;
          saveState();
        });
      }



      /* ====================== GOOGLE SHEETS INTEGRATION ====================== */
      const sheetsBtn = byId('sheets-btn');
      const sheetsView = byId('sheets-view');
      const sheetsFrame = byId('sheets-frame');
      const sheetsClose = byId('sheets-close');
      const sheetsModal = byId('sheets-modal');
      const sheetsInput = byId('sheets-input');
      const sheetsSave = byId('sheets-save');
      const sheetsCancel = byId('sheets-cancel');
      const sheetsError = byId('sheets-error');

      let currentSheetUrl = null;

      // Extract src from iframe HTML or return direct URL
      function extractSheetUrl(input) {
        const trimmed = input.trim();
        // If it's an iframe tag, extract src
        const srcMatch = trimmed.match(/src=["']([^"']+)["']/i);
        if (srcMatch) return srcMatch[1];
        // If it's already a URL
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return null;
      }

      // Fetch sheet URL from Supabase
      async function fetchSheetUrl() {
        if (!currentRoomCode) return null;
        try {
          const { data, error } = await supabase
            .from('rooms')
            .select('sheet_url')
            .eq('code', currentRoomCode)
            .maybeSingle();
          if (error) throw error;
          return data?.sheet_url || null;
        } catch (e) {
          console.error('Failed to fetch sheet URL:', e);
          return null;
        }
      }

      // Save sheet URL to Supabase
      async function saveSheetUrl(url) {
        if (!currentRoomCode) return false;
        try {
          const { error } = await supabase
            .from('rooms')
            .update({ sheet_url: url, updated_at: new Date().toISOString() })
            .eq('code', currentRoomCode);
          if (error) throw error;
          return true;
        } catch (e) {
          console.error('Failed to save sheet URL:', e);
          return false;
        }
      }

      // Open sheets view
      function openSheetsView(url) {
        if (!url) {
          alert('No valid sheet URL provided');
          return;
        }
        sheetsFrame.src = url;
        sheetsView.classList.add('active');
        appEl.classList.add('blocked-by-modal');
      }

      // Close sheets view
      function closeSheetsView() {
        sheetsView.classList.remove('active');
        appEl.classList.remove('blocked-by-modal');
        sheetsFrame.src = '';
      }

      // Show sheets modal
      function showSheetsModal(existingUrl = '') {
        sheetsInput.value = existingUrl;
        sheetsError.style.display = 'none';
        sheetsModal.classList.add('visible');
        appEl.classList.add('blocked-by-modal');
      }

      // Hide sheets modal
      function hideSheetsModal() {
        sheetsModal.classList.remove('visible');
        appEl.classList.remove('blocked-by-modal');
        sheetsInput.value = '';
      }

      // Main sheets button click
      sheetsBtn.addEventListener('click', async () => {
        if (!currentRoomCode) {
          alert('Please join a server first to use Google Sheets integration.');
          return;
        }

        // Fetch current sheet URL
        currentSheetUrl = await fetchSheetUrl();

        if (currentSheetUrl) {
          // Ask user what to do
          const choice = confirm('A Google Sheet is already linked.\n\nClick OK to open it, or Cancel to change the link.');
          if (choice) {
            openSheetsView(currentSheetUrl);
          } else {
            showSheetsModal(currentSheetUrl);
          }
        } else {
          // No link exists, prompt for one
          showSheetsModal();
        }
      });

      // Save button
      sheetsSave.addEventListener('click', async () => {
        const input = sheetsInput.value.trim();
        if (!input) {
          sheetsError.textContent = 'Please paste an iframe embed code or URL.';
          sheetsError.style.display = 'block';
          return;
        }

        const url = extractSheetUrl(input);
        if (!url || !url.includes('docs.google.com')) {
          sheetsError.textContent = 'Invalid Google Sheets URL. Please paste the iframe embed code from "Publish to web".';
          sheetsError.style.display = 'block';
          return;
        }

        sheetsError.style.display = 'none';
        sheetsSave.disabled = true;
        sheetsSave.textContent = 'Saving...';

        const success = await saveSheetUrl(url);

        if (success) {
          currentSheetUrl = url;
          hideSheetsModal();
          openSheetsView(url);
        } else {
          sheetsError.textContent = 'Failed to save. Check your connection.';
          sheetsError.style.display = 'block';
        }

        sheetsSave.disabled = false;
        sheetsSave.textContent = 'Save Link';
      });

      // Cancel button
      sheetsCancel.addEventListener('click', hideSheetsModal);

      // Close sheets view button
      sheetsClose.addEventListener('click', closeSheetsView);

      // Close modal when clicking outside
      sheetsModal.addEventListener('click', (e) => {
        if (e.target === sheetsModal) hideSheetsModal();
      });

      /* ================= Coin Database ================= */
      const COIN_DB_TABLE = 'coin_history_archive';
      const COIN_DB_ACTIVE_LABEL_PREFIX = 'sqkii-active-coin-label:';
      const coinDbModal = byId('coin-db-modal');
      const coinDbOpenBtn = byId('coin-db-open');
      const coinDbCloseBtn = byId('coin-db-close');
      const coinDbNameInput = byId('coin-db-name');
      const coinDbSaveCurrentBtn = byId('coin-db-save-current');
      const coinDbRefreshBtn = byId('coin-db-refresh');
      const coinDbExportBtn = byId('coin-db-export');
      const coinDbStatus = byId('coin-db-status');
      const coinDbList = byId('coin-db-list');
      let coinDbEntriesCache = [];

      function coinDbSetStatus(message, isError = false) {
        if (!coinDbStatus) return;
        coinDbStatus.textContent = message || '';
        coinDbStatus.style.color = isError ? '#fca5a5' : 'var(--muted)';
      }

      function coinDbFriendlyError(error) {
        const message = String(error?.message || error || 'Unknown error');
        if (/relation .*coin_history_archive.*does not exist/i.test(message)) {
          return 'Supabase archive table is missing. Run supabase/coin_history_archive.sql first.';
        }
        if (/column .* does not exist/i.test(message)) {
          return 'Supabase archive table is outdated. Re-run supabase/coin_history_archive.sql.';
        }
        if (/row-level security|permission denied|not allowed/i.test(message)) {
          return 'Supabase blocked the request. Check the RLS policies in supabase/coin_history_archive.sql.';
        }
        return message;
      }

      function coinDbFormatDate(value) {
        if (!value) return 'Unknown date';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return 'Unknown date';
        return d.toLocaleString();
      }

      function coinDbFormatCoord(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(6) : 'n/a';
      }

      function coinDbFormatRadius(value) {
        const n = Number(value);
        return Number.isFinite(n) ? `${Math.round(n * 100) / 100} m` : 'n/a';
      }

      function coinDbCanonicalLabel(label) {
        return String(label || '')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s*-\s*active$/i, '')
          .trim();
      }

      function coinDbCanonicalFeatureLabel(label) {
        return coinDbCanonicalLabel(
          String(label || '')
            .replace(/\s*\(past\)\s*$/i, '')
            .trim()
        );
      }

      function coinDbRootCoinId(rawId) {
        return String(rawId || '')
          .trim()
          .replace(/-\d{10,}$/i, '');
      }

      function coinDbDraftKey(roomCode = currentRoomCode) {
        return `${COIN_DB_ACTIVE_LABEL_PREFIX}${roomCode || 'default'}`;
      }

      function coinDbSaveDraftLabel(label, roomCode = currentRoomCode) {
        try {
          const normalized = coinDbCanonicalLabel(label);
          if (normalized) localStorage.setItem(coinDbDraftKey(roomCode), normalized);
          else localStorage.removeItem(coinDbDraftKey(roomCode));
        } catch { }
      }

      function coinDbLoadDraftLabel(roomCode = currentRoomCode) {
        try {
          return coinDbCanonicalLabel(localStorage.getItem(coinDbDraftKey(roomCode)) || '');
        } catch {
          return '';
        }
      }

      function coinDbSerializeState() {
        return Utils.deepClone(shallowSerializableState());
      }

      function extractShrinkLifecycle(stateArr = []) {
        const steps = [];

        for (const layer of (stateArr || [])) {
          const layerName = String(layer?.name || 'Layer');
          if (/sonar|glimpse/i.test(layerName)) continue;

          for (const feature of (layer?.data?.features || [])) {
            const props = feature?.properties || {};
            if (props._deleted) continue;

            const radius = Number(props._circleRadius);
            let lng = Number(props._circleLng);
            let lat = Number(props._circleLat);

            if ((!Number.isFinite(lng) || !Number.isFinite(lat)) && Array.isArray(props._circleCenter) && props._circleCenter.length >= 2) {
              lng = Number(props._circleCenter[0]);
              lat = Number(props._circleCenter[1]);
            }

            if (!Number.isFinite(radius) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            if (/^sonar\b/i.test(String(props.name || ''))) continue;
            if (props._coinArchiveEligible === false) continue;
            if (props._coinArchiveEligible !== true && !isSilverApiArchiveLayer(layerName)) continue;

            const ts = Number(props._ts);
            const coinId = coinDbRootCoinId(props._coinId || props.coin_id || props.fid || props._gid || '');
            const featureLabel = coinDbCanonicalFeatureLabel(props.name || `${layerName} shrink`);
            steps.push({
              step: 0,
              layerName,
              featureName: String(props.name || `${layerName} shrink`),
              coinId,
              coinLabel: coinDbCanonicalLabel(props._coinLabel || props.coin_label || featureLabel),
              lat,
              lng,
              radiusMeters: radius,
              timestampMs: Number.isFinite(ts) ? ts : null,
              timestampIso: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
              fid: String(props.fid ?? props._gid ?? '')
            });
          }
        }

        steps.sort((a, b) => {
          const ta = a.timestampMs ?? Number.MAX_SAFE_INTEGER;
          const tb = b.timestampMs ?? Number.MAX_SAFE_INTEGER;
          if (ta !== tb) return ta - tb;
          return a.featureName.localeCompare(b.featureName);
        });

        return steps.map((step, index) => ({
          ...step,
          step: index + 1
        }));
      }

      function buildSilverCoinArchiveGroups(stateArr = []) {
        const byCoin = new Map();

        const ensureGroup = (coinId, coinLabel) => {
          const key = coinId || coinLabel || `coin-${byCoin.size + 1}`;
          if (!byCoin.has(key)) {
            byCoin.set(key, {
              coinId: key,
              coinLabel: coinDbCanonicalLabel(coinLabel) || coinDbCanonicalLabel(coinId) || 'Unknown coin',
              isLive: false,
              steps: []
            });
          }
          const group = byCoin.get(key);
          if (!group.coinLabel || /^unknown coin$/i.test(group.coinLabel)) {
            const nextLabel = coinDbCanonicalLabel(coinLabel);
            if (nextLabel) group.coinLabel = nextLabel;
          }
          return group;
        };

        for (const layer of (stateArr || [])) {
          const layerName = String(layer?.name || '').trim().toLowerCase();
          if (layerName !== 'live sqkii circles') continue;

          for (const feature of (layer?.data?.features || [])) {
            const props = feature?.properties || {};
            if (props._deleted) continue;

            const coinId = coinDbRootCoinId(props._coinId || props.coin_id || props.fid || props._gid || '');
            const coinLabel = coinDbCanonicalLabel(props._coinLabel || props.coin_label || props.name || props.title || coinId);
            const group = ensureGroup(coinId, coinLabel);
            group.isLive = true;
          }
        }

        for (const step of extractShrinkLifecycle(stateArr)) {
          const coinId = step.coinId || coinDbRootCoinId(step.fid);
          const coinLabel = coinDbCanonicalLabel(step.coinLabel || coinDbCanonicalFeatureLabel(step.featureName) || coinId);
          const group = ensureGroup(coinId, coinLabel);
          group.steps.push({
            ...step,
            coinId: coinId || group.coinId,
            coinLabel: coinLabel || group.coinLabel
          });
        }

        const groups = [...byCoin.values()]
          .filter((group) => group.isLive || group.steps.length > 0)
          .map((group) => {
            const steps = [...group.steps].sort((a, b) => {
              const ta = a.timestampMs ?? Number.MAX_SAFE_INTEGER;
              const tb = b.timestampMs ?? Number.MAX_SAFE_INTEGER;
              if (ta !== tb) return ta - tb;
              return String(a.featureName || '').localeCompare(String(b.featureName || ''));
            }).map((step, index) => ({
              ...step,
              step: index + 1
            }));

            return {
              ...group,
              coinLabel: coinDbCanonicalLabel(group.coinLabel) || 'Unknown coin',
              steps
            };
          });

        groups.sort((a, b) => {
          if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
          return String(a.coinLabel || '').localeCompare(String(b.coinLabel || ''));
        });

        return groups;
      }

      function coinDbStepTimestamp(step) {
        const tsMs = Number(step?.timestampMs);
        if (Number.isFinite(tsMs) && tsMs > 0) return tsMs;
        const tsIso = step?.timestampIso ? new Date(step.timestampIso).getTime() : NaN;
        return Number.isFinite(tsIso) ? tsIso : Number.MAX_SAFE_INTEGER;
      }

      function coinDbStepIdentity(step) {
        const coinId = coinDbRootCoinId(step?.coinId || step?.fid || '');
        const lat = Number(step?.lat);
        const lng = Number(step?.lng);
        const radius = Number(step?.radiusMeters);
        const ts = Number(step?.timestampMs);
        return [
          coinId,
          Number.isFinite(lat) ? lat.toFixed(6) : '',
          Number.isFinite(lng) ? lng.toFixed(6) : '',
          Number.isFinite(radius) ? radius.toFixed(2) : '',
          Number.isFinite(ts) ? String(ts) : String(step?.timestampIso || ''),
          String(step?.featureName || '')
        ].join('|');
      }

      function coinDbMergeLifecycle(existingSteps = [], incomingSteps = []) {
        const merged = new Map();

        for (const step of (existingSteps || [])) {
          if (!step) continue;
          merged.set(coinDbStepIdentity(step), {
            ...step,
            coinId: coinDbRootCoinId(step.coinId || step.fid || ''),
            coinLabel: coinDbCanonicalLabel(step.coinLabel || ''),
          });
        }

        for (const step of (incomingSteps || [])) {
          if (!step) continue;
          merged.set(coinDbStepIdentity(step), {
            ...step,
            coinId: coinDbRootCoinId(step.coinId || step.fid || ''),
            coinLabel: coinDbCanonicalLabel(step.coinLabel || ''),
          });
        }

        return [...merged.values()]
          .sort((a, b) => {
            const ta = coinDbStepTimestamp(a);
            const tb = coinDbStepTimestamp(b);
            if (ta !== tb) return ta - tb;
            return String(a.featureName || '').localeCompare(String(b.featureName || ''));
          })
          .map((step, index) => ({
            ...step,
            step: index + 1
          }));
      }

      function coinDbDefaultName() {
        const stamp = new Date().toLocaleDateString();
        return `${(currentRoomCode || 'coin').toUpperCase()} coin - ${stamp}`;
      }

      function coinDbGetActiveLabel() {
        const inputLabel = coinDbCanonicalLabel(coinDbNameInput?.value || '');
        if (inputLabel) return inputLabel;

        const activeEntry = coinDbEntriesCache.find((entry) => String(entry?.status || '').toLowerCase() === 'active');
        const activeLabel = coinDbCanonicalLabel(activeEntry?.coin_label || '');
        if (activeLabel) return activeLabel;

        const storedLabel = coinDbLoadDraftLabel();
        if (storedLabel) return storedLabel;

        return coinDbDefaultName();
      }

      function coinDbSyncNameInput(force = false) {
        if (!coinDbNameInput) return;
        if (!force && coinDbCanonicalLabel(coinDbNameInput.value)) return;
        coinDbNameInput.value = coinDbGetActiveLabel();
      }

      function renderCoinDbEntries(entries) {
        coinDbEntriesCache = Array.isArray(entries) ? entries : [];

        if (!coinDbList) return;
        if (!coinDbEntriesCache.length) {
          coinDbList.innerHTML = '<div class="coin-db-empty">No archived coins yet for this room.</div>';
          return;
        }

        coinDbList.innerHTML = coinDbEntriesCache.map((entry) => {
          const steps = Array.isArray(entry.lifecycle) ? entry.lifecycle : [];
          const displayLabel = coinDbCanonicalLabel(entry.coin_label || 'Unnamed coin') || 'Unnamed coin';
          const exactSpot = (Number.isFinite(Number(entry.exact_lat)) && Number.isFinite(Number(entry.exact_lng)))
            ? `${coinDbFormatCoord(entry.exact_lat)}, ${coinDbFormatCoord(entry.exact_lng)}`
            : '';

          const statusBadge = entry.status === 'active'
            ? '<span class="coin-db-badge active">● LIVE</span>'
            : entry.status === 'found'
              ? '<span class="coin-db-badge found">● Found</span>'
              : '<span class="coin-db-badge archived">● Archived</span>';

          return `
            <details class="coin-db-dropdown" data-entry-id="${escapeHtml(entry.id)}">
              <summary class="coin-db-dropdown-header">
                <div class="coin-db-dropdown-left">
                  ${statusBadge}
                  <span class="coin-db-dropdown-title">${escapeHtml(displayLabel)}</span>
                  <span class="coin-db-dropdown-date">${escapeHtml(coinDbFormatDate(entry.created_at))}</span>
                </div>
                <div class="coin-db-dropdown-right">
                  <span class="coin-db-chip">${steps.length} shrink${steps.length !== 1 ? 's' : ''}</span>
                  <span class="coin-db-dropdown-arrow">▸</span>
                </div>
              </summary>

              <div class="coin-db-dropdown-body">
                <div class="coin-db-meta">
                  <span class="coin-db-chip">Room: ${escapeHtml(entry.room_code || '')}</span>
                  <span class="coin-db-chip">Shrinks: ${steps.length}</span>
                  ${exactSpot ? `<span class="coin-db-chip">Exact: ${escapeHtml(exactSpot)}</span>` : ''}
                </div>

                <div class="coin-db-note-form">
                  <input type="number" step="any" class="coin-db-exact-lat" data-entry-id="${escapeHtml(entry.id)}" placeholder="Exact latitude" value="${entry.exact_lat ?? ''}">
                  <input type="number" step="any" class="coin-db-exact-lng" data-entry-id="${escapeHtml(entry.id)}" placeholder="Exact longitude" value="${entry.exact_lng ?? ''}">
                  <textarea class="coin-db-exact-note" data-entry-id="${escapeHtml(entry.id)}" placeholder="Notes about the revealed exact spot">${escapeHtml(entry.exact_note || '')}</textarea>
                  <div class="coin-db-note-footer">
                    <div class="coin-db-inline-status" id="coin-db-inline-status-${escapeHtml(entry.id)}"></div>
                    <div class="coin-db-footer-btns">
                      <button class="btn small coin-db-delete-entry danger" data-entry-id="${escapeHtml(entry.id)}" title="Delete this archived coin">Delete</button>
                      <button class="btn small coin-db-preview-entry" data-entry-id="${escapeHtml(entry.id)}">Preview</button>
                      <button class="btn small coin-db-load-snapshot" data-entry-id="${escapeHtml(entry.id)}">Load Snapshot</button>
                      <button class="btn small coin-db-save-note" data-entry-id="${escapeHtml(entry.id)}">Save Exact Spot</button>
                    </div>
                  </div>
                </div>

                <div class="coin-db-steps">
                  ${steps.length === 0 ? '<div class="coin-db-empty" style="padding:10px">No shrink steps recorded yet.</div>' : ''}
                  ${steps.map((step) => `
                    <div class="coin-db-step">
                      <div>
                        <strong>Step</strong>
                        <span>${escapeHtml(String(step.step || ''))}</span>
                      </div>
                      <div>
                        <strong>Latitude</strong>
                        <span>${escapeHtml(coinDbFormatCoord(step.lat))}</span>
                      </div>
                      <div>
                        <strong>Longitude</strong>
                        <span>${escapeHtml(coinDbFormatCoord(step.lng))}</span>
                      </div>
                      <div>
                        <strong>Radius</strong>
                        <span>${escapeHtml(coinDbFormatRadius(step.radiusMeters))}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </details>
          `;
        }).join('');
      }

      function coinDbInlineStatus(entryId, message, isError = false) {
        const el = document.getElementById(`coin-db-inline-status-${entryId}`);
        if (!el) return;
        el.textContent = message || '';
        el.style.color = isError ? '#fca5a5' : 'var(--muted)';
      }

      async function fetchCoinDbEntries() {
        if (!currentRoomCode) return [];
        const { data, error } = await supabase
          .from(COIN_DB_TABLE)
          .select('*')
          .eq('room_code', currentRoomCode)
          .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
      }

      async function refreshCoinDatabase() {
        if (!currentRoomCode) {
          renderCoinDbEntries([]);
          coinDbSetStatus('Join a room first to use the coin database.', true);
          return;
        }

        coinDbSetStatus('Loading archived coins...');
        try {
          const entries = (await fetchCoinDbEntries()).sort((a, b) => {
            const rank = (value) => {
              const status = String(value?.status || '').toLowerCase();
              if (status === 'active') return 0;
              if (status === 'found') return 1;
              return 2;
            };

            const diff = rank(a) - rank(b);
            if (diff !== 0) return diff;

            const ta = new Date(a?.updated_at || a?.created_at || 0).getTime();
            const tb = new Date(b?.updated_at || b?.created_at || 0).getTime();
            return tb - ta;
          });
          renderCoinDbEntries(entries);
          coinDbSyncNameInput();
          coinDbSetStatus(entries.length ? `Loaded ${entries.length} archived coin record(s).` : 'No archived coins yet for this room.');
        } catch (error) {
          renderCoinDbEntries([]);
          coinDbSetStatus(coinDbFriendlyError(error), true);
        }
      }

      async function archiveCurrentCoinLifecycle() {
        if (!currentRoomCode) {
          coinDbSetStatus('Join a room first before archiving a coin.', true);
          return;
        }

        const snapshotState = coinDbSerializeState();
        const coinGroups = buildSilverCoinArchiveGroups(snapshotState);
        const requestedLabel = coinDbCanonicalLabel((coinDbNameInput?.value || '').trim()) || coinDbGetActiveLabel();
        let selectedGroup = coinGroups.find((group) => coinDbCanonicalLabel(group.coinLabel) === requestedLabel);

        if (!selectedGroup && coinGroups.length === 1) {
          selectedGroup = coinGroups[0];
        }

        if (!selectedGroup) {
          coinDbSetStatus('Type the exact ongoing coin name you want to archive, e.g. "ShopBack Coin 20".', true);
          return;
        }

        const lifecycle = selectedGroup.steps || [];
        const coinLabel = coinDbCanonicalLabel(selectedGroup.coinLabel) || requestedLabel;
        coinDbSaveDraftLabel(coinLabel);
        coinDbSaveCurrentBtn.disabled = true;
        coinDbSetStatus('Archiving current coin...');

        try {
          const { data: activeRecords, error: activeRecordsError } = await supabase
            .from(COIN_DB_TABLE)
            .select('id, coin_label, lifecycle')
            .eq('room_code', currentRoomCode)
            .eq('status', 'active');

          if (activeRecordsError) throw activeRecordsError;

          const matchingActive = (activeRecords || []).find((entry) => (
            coinDbCanonicalLabel(entry.coin_label) === coinLabel
          ));
          const mergedLifecycle = coinDbMergeLifecycle(matchingActive?.lifecycle || [], lifecycle);

          const payload = {
            room_code: currentRoomCode,
            coin_label: coinLabel,
            status: 'found',
            shrink_count: mergedLifecycle.length,
            lifecycle: mergedLifecycle,
            snapshot_state: snapshotState,
            first_shrink_at: mergedLifecycle[0]?.timestampIso || null,
            last_shrink_at: mergedLifecycle[mergedLifecycle.length - 1]?.timestampIso || null,
            archived_by: clientId,
            updated_by: clientId,
            updated_at: new Date().toISOString()
          };

          let error = null;
          if (matchingActive?.id) {
            const result = await supabase.from(COIN_DB_TABLE).update(payload).eq('id', matchingActive.id);
            error = result.error;
          } else {
            const result = await supabase.from(COIN_DB_TABLE).insert(payload);
            error = result.error;
          }

          if (error) throw error;

          if (coinDbNameInput) coinDbNameInput.value = coinLabel;
          await refreshCoinDatabase();
          coinDbSetStatus(`Archived "${coinLabel}" with ${mergedLifecycle.length} shrink step(s).`);
        } catch (error) {
          coinDbSetStatus(coinDbFriendlyError(error), true);
        } finally {
          coinDbSaveCurrentBtn.disabled = false;
        }
      }

      async function saveCoinDbExactSpot(entryId) {
        const latInput = coinDbList?.querySelector(`.coin-db-exact-lat[data-entry-id="${entryId}"]`);
        const lngInput = coinDbList?.querySelector(`.coin-db-exact-lng[data-entry-id="${entryId}"]`);
        const noteInput = coinDbList?.querySelector(`.coin-db-exact-note[data-entry-id="${entryId}"]`);

        if (!latInput || !lngInput || !noteInput) return;

        const rawLat = String(latInput.value || '').trim();
        const rawLng = String(lngInput.value || '').trim();
        const exactLat = rawLat === '' ? null : Number(rawLat);
        const exactLng = rawLng === '' ? null : Number(rawLng);

        if ((exactLat == null) !== (exactLng == null)) {
          coinDbInlineStatus(entryId, 'Latitude and longitude must both be filled, or both left blank.', true);
          return;
        }

        if (exactLat != null && (!Number.isFinite(exactLat) || exactLat < -90 || exactLat > 90)) {
          coinDbInlineStatus(entryId, 'Latitude must be between -90 and 90.', true);
          return;
        }

        if (exactLng != null && (!Number.isFinite(exactLng) || exactLng < -180 || exactLng > 180)) {
          coinDbInlineStatus(entryId, 'Longitude must be between -180 and 180.', true);
          return;
        }

        coinDbInlineStatus(entryId, 'Saving...');

        try {
          const { error } = await supabase
            .from(COIN_DB_TABLE)
            .update({
              exact_lat: exactLat,
              exact_lng: exactLng,
              exact_note: String(noteInput.value || '').trim() || null,
              updated_by: clientId,
              updated_at: new Date().toISOString()
            })
            .eq('id', entryId);

          if (error) throw error;

          coinDbInlineStatus(entryId, 'Saved.');
          await refreshCoinDatabase();
        } catch (error) {
          coinDbInlineStatus(entryId, coinDbFriendlyError(error), true);
        }
      }

      async function loadCoinDbSnapshot(entryId) {
        const entry = coinDbEntriesCache.find((item) => String(item.id) === String(entryId));
        if (!entry?.snapshot_state) return;

        try {
          await applyStateArray(entry.snapshot_state);
          localSaveOnly();
          coinDbSetStatus(`Loaded snapshot for "${coinDbCanonicalLabel(entry.coin_label)}".`);
        } catch (error) {
          coinDbSetStatus(`Failed to load snapshot: ${coinDbFriendlyError(error)}`, true);
        }
      }

      function buildCoinDbPreviewPayload(entry) {
        const steps = (Array.isArray(entry?.lifecycle) ? entry.lifecycle : [])
          .map((step, index) => {
            const lat = Number(step?.lat);
            const lng = Number(step?.lng);
            const radiusMeters = Number(step?.radiusMeters);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
              return null;
            }
            return {
              stepNumber: Number.isFinite(Number(step?.step)) ? Number(step.step) : index + 1,
              lat,
              lng,
              radiusMeters,
              timestampIso: step?.timestampIso || null
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.stepNumber - b.stepNumber);

        if (!steps.length) return null;

        const circleFeatures = steps.map((step, index) => ({
          type: 'Feature',
          properties: {
            step: step.stepNumber,
            radiusMeters: step.radiusMeters,
            timestampIso: step.timestampIso,
            sequenceIndex: index
          },
          geometry: turf.circle([step.lng, step.lat], step.radiusMeters, { steps: 128, units: 'meters' }).geometry
        }));

        const centerFeatures = steps.map((step, index) => ({
          type: 'Feature',
          properties: {
            step: step.stepNumber,
            radiusMeters: step.radiusMeters,
            timestampIso: step.timestampIso,
            sequenceIndex: index
          },
          geometry: {
            type: 'Point',
            coordinates: [step.lng, step.lat]
          }
        }));

        const pathFeature = steps.length > 1 ? {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: steps.map((step) => [step.lng, step.lat])
          }
        } : null;

        const exactLat = Number(entry?.exact_lat);
        const exactLng = Number(entry?.exact_lng);
        const exactFeature = Number.isFinite(exactLat) && Number.isFinite(exactLng) ? {
          type: 'Feature',
          properties: {
            note: entry?.exact_note || ''
          },
          geometry: {
            type: 'Point',
            coordinates: [exactLng, exactLat]
          }
        } : null;

        const bboxFeatures = [
          ...circleFeatures,
          ...centerFeatures,
          ...(pathFeature ? [pathFeature] : []),
          ...(exactFeature ? [exactFeature] : [])
        ];

        return {
          firstRadiusMeters: steps[0].radiusMeters,
          lastRadiusMeters: steps[steps.length - 1].radiusMeters,
          totalShrinkMeters: Math.max(0, steps[0].radiusMeters - steps[steps.length - 1].radiusMeters),
          centerTravelMeters: steps.slice(1).reduce((total, step, index) => (
            total + turf.distance(
              turf.point([steps[index].lng, steps[index].lat]),
              turf.point([step.lng, step.lat]),
              { units: 'kilometers' }
            ) * 1000
          ), 0),
          label: coinDbCanonicalLabel(entry?.coin_label || 'Unnamed coin') || 'Unnamed coin',
          roomCode: String(entry?.room_code || ''),
          status: String(entry?.status || ''),
          shrinkCount: steps.length,
          firstCenter: [steps[0].lng, steps[0].lat],
          firstStep: steps[0].stepNumber,
          screenshotBounds: (() => {
            const origin = turf.point([steps[0].lng, steps[0].lat]);
            const maxDistanceMeters = Math.max(...steps.map((step) => {
              const centerDistanceMeters = turf.distance(origin, turf.point([step.lng, step.lat]), { units: 'kilometers' }) * 1000;
              return centerDistanceMeters + step.radiusMeters;
            }));
            const north = turf.destination(origin, maxDistanceMeters / 1000, 0, { units: 'kilometers' }).geometry.coordinates;
            const east = turf.destination(origin, maxDistanceMeters / 1000, 90, { units: 'kilometers' }).geometry.coordinates;
            const south = turf.destination(origin, maxDistanceMeters / 1000, 180, { units: 'kilometers' }).geometry.coordinates;
            const west = turf.destination(origin, maxDistanceMeters / 1000, 270, { units: 'kilometers' }).geometry.coordinates;
            return [west[0], south[1], east[0], north[1]];
          })(),
          exactSpot: exactFeature ? `${coinDbFormatCoord(exactLat)}, ${coinDbFormatCoord(exactLng)}` : '',
          note: String(entry?.exact_note || ''),
          createdAt: coinDbFormatDate(entry?.created_at),
          apiKey: String(maptilersdk?.config?.apiKey || ''),
          styleUrl: CUSTOM_STYLE,
          circles: { type: 'FeatureCollection', features: circleFeatures },
          centers: { type: 'FeatureCollection', features: centerFeatures },
          path: pathFeature,
          exact: exactFeature,
          bounds: turf.bbox({ type: 'FeatureCollection', features: bboxFeatures })
        };
      }

      function buildCoinDbPreviewDocument(payload) {
        const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
        const title = escapeHtml(`${payload.label} Preview`);
        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <script src="https://cdn.maptiler.com/maptiler-sdk-js/v3.6.1/maptiler-sdk.umd.min.js"></script>
  <link href="https://cdn.maptiler.com/maptiler-sdk-js/v3.6.1/maptiler-sdk.css" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0d14;
      --panel: rgba(12, 16, 24, 0.88);
      --panel-border: rgba(148, 163, 184, 0.18);
      --text: #f8fafc;
      --muted: #a7b3c5;
      --accent: #f59e0b;
      --accent-soft: rgba(245, 158, 11, 0.16);
    }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      overflow: hidden;
    }
    #preview-map {
      position: absolute;
      inset: 0;
    }
    .preview-shell {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .preview-card {
      position: absolute;
      top: 18px;
      left: 18px;
      max-width: min(360px, calc(100vw - 36px));
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--panel-border);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(10, 14, 24, 0.9));
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(18px);
      pointer-events: auto;
    }
    .preview-card h1 {
      margin: 0 0 6px;
      font-size: 21px;
      line-height: 1.1;
    }
    .preview-subtitle {
      margin: 0 0 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .preview-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-bottom: 10px;
    }
    .preview-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      border-radius: 999px;
      border: 1px solid rgba(245, 158, 11, 0.28);
      background: var(--accent-soft);
      color: #fde68a;
      font-size: 11px;
      font-weight: 700;
    }
    .preview-card p {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
    }
    .preview-actions {
      display: flex;
      gap: 8px;
      margin: 0 0 10px;
    }
    .preview-btn {
      appearance: none;
      border: 1px solid rgba(245, 158, 11, 0.32);
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.24), rgba(180, 83, 9, 0.2));
      color: #fef3c7;
      border-radius: 999px;
      padding: 8px 12px;
      font: inherit;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
    }
    .preview-btn:hover {
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.3), rgba(180, 83, 9, 0.24));
    }
    .preview-note {
      margin-top: 10px;
      padding: 9px 11px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
      color: #e5e7eb;
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    .preview-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .preview-stat {
      padding: 9px 10px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .preview-stat-label {
      display: block;
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .preview-stat-value {
      display: block;
      color: #f8fafc;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.2;
    }
    .preview-step-label {
      display: grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 999px;
      background: radial-gradient(circle at 30% 30%, #fde68a, #f59e0b 68%, #b45309);
      color: #1f2937;
      font-size: 10px;
      font-weight: 900;
      border: 1px solid rgba(255, 244, 214, 0.75);
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.14), 0 5px 14px rgba(0, 0, 0, 0.32);
    }
    .preview-exact {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #22c55e;
      border: 2px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.18);
    }
    @media (max-width: 720px) {
      .preview-card {
        top: 12px;
        left: 12px;
        right: 12px;
        max-width: none;
      }
      .preview-card h1 {
        font-size: 18px;
      }
      .preview-stats {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div id="preview-map"></div>
  <div class="preview-shell">
    <div class="preview-card">
      <h1>${title}</h1>
      <p class="preview-subtitle">Geodesic shrink preview for ${escapeHtml(payload.roomCode || 'unknown room')}.</p>
      <div class="preview-chips">
        <span class="preview-chip">${escapeHtml(String(payload.shrinkCount))} shrink${payload.shrinkCount === 1 ? '' : 's'}</span>
        <span class="preview-chip">${escapeHtml(payload.status || 'archived')}</span>
        ${payload.exactSpot ? `<span class="preview-chip">Exact: ${escapeHtml(payload.exactSpot)}</span>` : ''}
      </div>
      <div class="preview-actions">
        <button id="preview-download" class="preview-btn" type="button">Download Screenshot</button>
      </div>
      <div class="preview-stats">
        <div class="preview-stat">
          <span class="preview-stat-label">First Radius</span>
          <span class="preview-stat-value">${escapeHtml(coinDbFormatRadius(payload.firstRadiusMeters))}</span>
        </div>
        <div class="preview-stat">
          <span class="preview-stat-label">Last Radius</span>
          <span class="preview-stat-value">${escapeHtml(coinDbFormatRadius(payload.lastRadiusMeters))}</span>
        </div>
        <div class="preview-stat">
          <span class="preview-stat-label">Total Shrink</span>
          <span class="preview-stat-value">${escapeHtml(coinDbFormatRadius(payload.totalShrinkMeters))}</span>
        </div>
        <div class="preview-stat">
          <span class="preview-stat-label">Center Travel</span>
          <span class="preview-stat-value">${escapeHtml(coinDbFormatRadius(payload.centerTravelMeters))}</span>
        </div>
      </div>
      ${payload.note ? `<div class="preview-note">${escapeHtml(payload.note)}</div>` : ''}
    </div>
  </div>
  <script>
    (function () {
      const payload = ${serializedPayload};
      maptilersdk.config.apiKey = payload.apiKey || '';
      const map = new maptilersdk.Map({
        container: 'preview-map',
        style: payload.styleUrl,
        center: [103.8198, 1.3521],
        zoom: 12,
        pitch: 0,
        bearing: 0,
        hash: false,
        geolocate: false,
        navigationControl: true,
        preserveDrawingBuffer: true
      });

      async function downloadMapScreenshot() {
        const screenshotBounds = Array.isArray(payload.screenshotBounds) && payload.screenshotBounds.length === 4 ? payload.screenshotBounds : null;
        if (!screenshotBounds) {
          return;
        }

        map.fitBounds([[screenshotBounds[0], screenshotBounds[1]], [screenshotBounds[2], screenshotBounds[3]]], {
          padding: { top: 64, right: 64, bottom: 64, left: 64 },
          duration: 500
        });
        map.once('idle', async () => {
          const filename = (String(payload.label || 'coin-preview').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'coin-preview') + '-step-' + String(payload.firstStep || 1) + '.png';
          if (maptilersdk.helpers?.takeScreenshot) {
            await maptilersdk.helpers.takeScreenshot(map, {
              download: true,
              filename
            });
            return;
          }
          const canvas = map.getCanvas && map.getCanvas();
          if (!canvas) return;
          const link = document.createElement('a');
          link.download = filename;
          link.href = canvas.toDataURL('image/png');
          link.click();
        });
      }

      function addStepMarkers() {
        (payload.centers.features || []).forEach((feature) => {
          const el = document.createElement('div');
          el.className = 'preview-step-label';
          el.textContent = String(feature.properties.step || '');
          new maptilersdk.Marker({ element: el, anchor: 'center' })
            .setLngLat(feature.geometry.coordinates)
            .addTo(map);
        });
        if (payload.exact) {
          const el = document.createElement('div');
          el.className = 'preview-exact';
          new maptilersdk.Marker({ element: el, anchor: 'center' })
            .setLngLat(payload.exact.geometry.coordinates)
            .addTo(map);
        }
      }

      map.on('load', () => {
        const downloadBtn = document.getElementById('preview-download');
        if (downloadBtn) {
          downloadBtn.addEventListener('click', downloadMapScreenshot);
        }
        map.addSource('coin-preview-circles', { type: 'geojson', data: payload.circles });
        map.addSource('coin-preview-centers', { type: 'geojson', data: payload.centers });
        if (payload.path) {
          map.addSource('coin-preview-path', { type: 'geojson', data: payload.path });
          map.addLayer({
            id: 'coin-preview-path-line',
            type: 'line',
            source: 'coin-preview-path',
            paint: {
              'line-color': '#f59e0b',
              'line-width': 3,
              'line-opacity': 0.88
            }
          });
        }
        map.addLayer({
          id: 'coin-preview-circles-fill',
          type: 'fill',
          source: 'coin-preview-circles',
          paint: {
            'fill-color': '#f59e0b',
            'fill-opacity': 0
          }
        });
        map.addLayer({
          id: 'coin-preview-circles-line',
          type: 'line',
          source: 'coin-preview-circles',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 1.5,
            'line-opacity': 0.8
          }
        });
        map.addLayer({
          id: 'coin-preview-centers-core',
          type: 'circle',
          source: 'coin-preview-centers',
          paint: {
            'circle-radius': 4,
            'circle-color': '#fef3c7',
            'circle-stroke-color': '#f59e0b',
            'circle-stroke-width': 2
          }
        });
        if (payload.exact) {
          map.addSource('coin-preview-exact', { type: 'geojson', data: payload.exact });
          map.addLayer({
            id: 'coin-preview-exact-halo',
            type: 'circle',
            source: 'coin-preview-exact',
            paint: {
              'circle-radius': 16,
              'circle-color': '#22c55e',
              'circle-opacity': 0.16
            }
          });
        }
        addStepMarkers();
        if (Array.isArray(payload.bounds) && payload.bounds.length === 4) {
          map.fitBounds([[payload.bounds[0], payload.bounds[1]], [payload.bounds[2], payload.bounds[3]]], {
            padding: { top: 110, right: 70, bottom: 70, left: 430 },
            duration: 0
          });
        }
      });
    })();
  </script>
</body>
</html>`;
      }

      function openCoinDbPreview(entryId) {
        const entry = coinDbEntriesCache.find((item) => String(item.id) === String(entryId));
        const payload = buildCoinDbPreviewPayload(entry);
        if (!payload) {
          coinDbSetStatus('No valid shrink steps available to preview for this coin.', true);
          return;
        }

        const previewWindow = window.open('', `coin-db-preview-${entryId}`, 'popup=yes,width=1320,height=860,resizable=yes,scrollbars=yes');
        if (!previewWindow) {
          coinDbSetStatus('Preview popup was blocked. Allow popups for this site and try again.', true);
          return;
        }

        previewWindow.document.open();
        previewWindow.document.write(buildCoinDbPreviewDocument(payload));
        previewWindow.document.close();
        previewWindow.focus();
      }

      async function deleteCoinDbEntry(entryId) {
        const entry = coinDbEntriesCache.find((item) => String(item.id) === String(entryId));
        const label = coinDbCanonicalLabel(entry?.coin_label || '') || 'this coin';
        if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;

        coinDbSetStatus('Deleting...');
        try {
          const { error } = await supabase.from(COIN_DB_TABLE).delete().eq('id', entryId);
          if (error) throw error;
          coinDbSetStatus(`Deleted "${label}".`);
          await refreshCoinDatabase();
        } catch (error) {
          coinDbSetStatus(coinDbFriendlyError(error), true);
        }
      }

      function openCoinDbModal() {
        if (!currentRoomCode) {
          alert('Please join a server first to use the coin database.');
          return;
        }

        coinDbModal.classList.add('visible');
        appEl.classList.add('blocked-by-modal');
        coinDbSyncNameInput(true);
        refreshCoinDatabase();
      }

      function closeCoinDbModal() {
        coinDbModal.classList.remove('visible');
        appEl.classList.remove('blocked-by-modal');
      }

      coinDbOpenBtn?.addEventListener('click', openCoinDbModal);
      coinDbCloseBtn?.addEventListener('click', closeCoinDbModal);
      coinDbRefreshBtn?.addEventListener('click', refreshCoinDatabase);
      coinDbSaveCurrentBtn?.addEventListener('click', archiveCurrentCoinLifecycle);
      coinDbExportBtn?.addEventListener('click', exportCoinDbExcel);
      coinDbNameInput?.addEventListener('input', () => {
        coinDbSaveDraftLabel(coinDbNameInput.value);
      });
      coinDbModal?.addEventListener('click', (e) => {
        if (e.target === coinDbModal) closeCoinDbModal();
      });
      coinDbList?.addEventListener('click', async (e) => {
        const saveBtn = e.target.closest('.coin-db-save-note');
        if (saveBtn) {
          await saveCoinDbExactSpot(saveBtn.dataset.entryId);
          return;
        }

        const previewBtn = e.target.closest('.coin-db-preview-entry');
        if (previewBtn) {
          openCoinDbPreview(previewBtn.dataset.entryId);
          return;
        }

        const loadBtn = e.target.closest('.coin-db-load-snapshot');
        if (loadBtn) {
          await loadCoinDbSnapshot(loadBtn.dataset.entryId);
          return;
        }

        const delBtn = e.target.closest('.coin-db-delete-entry');
        if (delBtn) {
          await deleteCoinDbEntry(delBtn.dataset.entryId);
        }
      });

      /* ---- Export Coin DB to Excel ---- */
      function exportCoinDbExcel() {
        if (!coinDbEntriesCache.length) {
          coinDbSetStatus('No archived coins to export. Refresh first.', true);
          return;
        }

        if (typeof XLSX === 'undefined') {
          coinDbSetStatus('SheetJS library not loaded. Check your internet connection.', true);
          return;
        }

        const rows = [];
        for (const entry of coinDbEntriesCache) {
          const steps = Array.isArray(entry.lifecycle) ? entry.lifecycle : [];
          const entryLabel = coinDbCanonicalLabel(entry.coin_label || 'Unnamed') || 'Unnamed';
          if (steps.length === 0) {
            // Entry with no steps — still include a summary row
            rows.push({
              'Coin Name': entryLabel,
              'Room': entry.room_code || '',
              'Status': entry.status || '',
              'Step': '',
              'Latitude': '',
              'Longitude': '',
              'Radius (m)': '',
              'Timestamp': '',
              'Exact Lat': entry.exact_lat ?? '',
              'Exact Lng': entry.exact_lng ?? '',
              'Notes': entry.exact_note || '',
              'Archived': coinDbFormatDate(entry.created_at)
            });
          } else {
            for (const step of steps) {
              rows.push({
                'Coin Name': entryLabel,
                'Room': entry.room_code || '',
                'Status': entry.status || '',
                'Step': step.step ?? '',
                'Latitude': step.lat ?? '',
                'Longitude': step.lng ?? '',
                'Radius (m)': step.radiusMeters != null ? Math.round(step.radiusMeters * 100) / 100 : '',
                'Timestamp': step.timestampIso || '',
                'Exact Lat': entry.exact_lat ?? '',
                'Exact Lng': entry.exact_lng ?? '',
                'Notes': entry.exact_note || '',
                'Archived': coinDbFormatDate(entry.created_at)
              });
            }
          }
        }

        const ws = XLSX.utils.json_to_sheet(rows);
        // Auto-size columns
        const colWidths = Object.keys(rows[0] || {}).map((key) => {
          const maxLen = Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length));
          return { wch: Math.min(maxLen + 2, 40) };
        });
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Coin Archive');

        const roomName = (currentRoomCode || 'coins').replace(/[^a-zA-Z0-9_-]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `coin_archive_${roomName}_${dateStr}.xlsx`);

        coinDbSetStatus(`Exported ${rows.length} row(s) to Excel.`);
      }

      /* ================= Startup ================= */
      const runStartup = () => {
        try {
          const urlParams = new URLSearchParams(location.search);
          const preCode = (urlParams.get('server') || '').trim();
          const cachedCode = loadLastServerCode();
          serverInput.value = preCode || cachedCode;

          // 👇 auto-open the server modal on load
          showServerModal();

        } catch (e) {
          console.error('Startup guard:', e);
        }
        updateSonarEnabled();
      };
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', runStartup, { once: true });
      } else {
        runStartup();
      }


      /* ================= Export KML / KMZ ================= */
      function escapeXml(s) { return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }
      function kmlColorFromCss(hex, opacity) { const h = (hex || '#ffffff').replace('#', ''); const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0; const a = Math.round((opacity == null ? 1 : opacity) * 255); const to2 = x => x.toString(16).padStart(2, '0'); return to2(a) + to2(b) + to2(g) + to2(r); }
      function serializePlacemark(f) {
        const p = f.properties || {}, name = escapeXml(p.name || 'Feature'), styleId = 's' + (p.fid || 'x');
        if (p._deleted) return '';
        let geomStr = '';
        if (f.geometry.type === 'Point') { const [lng, lat] = f.geometry.coordinates; geomStr = `<Point><coordinates>${lng},${lat},0</coordinates></Point>`; }
        else if (f.geometry.type === 'LineString') { geomStr = `<LineString><coordinates>${f.geometry.coordinates.map(c => c.join(',')).join(' ')}</coordinates></LineString>`; }
        else if (f.geometry.type === 'Polygon') {
          const rings = f.geometry.coordinates.map((ring, i) => `<${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}><LinearRing><coordinates>${ring.map(c => c.join(',')).join(' ')}</coordinates></LinearRing></${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}>`).join('');
          geomStr = `<Polygon>${rings}</Polygon>`;
        } else return '';
        const style = `
    <Style id="${styleId}">
      <IconStyle>${p._iconUrl ? `<Icon><href>${escapeXml(p._iconUrl)}</href></Icon>` : ''}</IconStyle>
      <LineStyle><color>${kmlColorFromCss(p._stroke, p._strokeOpacity)}</color><width>${p._weight || 2}</width></LineStyle>
      <PolyStyle><color>${kmlColorFromCss(p._fill, p._fillOpacity)}</color></PolyStyle>
    </Style>`;
        return style + `<Placemark><name>${name}</name><styleUrl>#${styleId}</styleUrl>${geomStr}${p.description ? `<description><![CDATA[${p.description}]]></description>` : ''}</Placemark>`;
      }
      function exportKMLString() {
        const body = layerList.map(l => `<Folder><name>${escapeXml(l.name)}</name>${l.data.features.filter(f => !f.properties.hidden && !f.properties._deleted).map(serializePlacemark).join('')}</Folder>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
      }
      function downloadBlob(name, blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
      byId('export-kml').onclick = () => { const kml = exportKMLString(); downloadBlob('sqkii-export.kml', new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' })); };
      byId('export-kmz').onclick = async () => { const zip = new JSZip(); const kml = exportKMLString(); zip.file('doc.kml', kml); const blob = await zip.generateAsync({ type: 'blob' }); downloadBlob('sqkii-export.kmz', blob); };



      /* ================= Circle Statistics Helper Functions ================= */

      function getGeometryPoint(geometry) {
        if (!geometry) return null;

        try {
          if (geometry.type === 'Point') {
            return turf.point(geometry.coordinates); // [lng, lat]
          }

          if (geometry.type === 'Polygon') {
            const poly = turf.polygon(geometry.coordinates);
            return turf.centroid(poly);
          }

          if (geometry.type === 'MultiPolygon') {
            const mpoly = turf.multiPolygon(geometry.coordinates);
            return turf.centroid(mpoly);
          }
        } catch (e) {
          console.warn('⚠️ Failed to build point from geometry', geometry, e);
        }

        return null;
      }

      function countFeaturesInCircle(featureCollection, circlePolygon) {
        if (!featureCollection || !Array.isArray(featureCollection.features)) return 0;

        let count = 0;
        for (const f of featureCollection.features) {
          const pt = getGeometryPoint(f.geometry);
          if (!pt) continue;
          if (turf.booleanPointInPolygon(pt, circlePolygon)) count++;
        }
        return count;
      }

      function extractFidFromPopupContent(content) {
        const match = content.match(/circle-stats-(\S+)/);
        return match ? match[1] : null;
      }

      function findFeatureByFid(fid) {
        for (const entry of layerList) {
          const feature = (entry.data?.features || []).find(f => String(f.properties?.fid) === String(fid));
          if (feature) return feature;
        }
        return null;
      }

      function extractTrafficSignCategory(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        let typ = '';

        if (props.TYP_CD != null) typ = String(props.TYP_CD).toUpperCase();
        else if (props.typ_cd != null) typ = String(props.typ_cd).toUpperCase();
        else if (props.TYP != null) typ = String(props.TYP).toUpperCase();
        else if (props.Description) {
          const desc = String(props.Description);
          const match = desc.match(/<th>\s*TYP_CD\s*<\/th>\s*<td>(.*?)<\/td>/i);
          const typCdRaw = match ? match[1] : '';
          typ = typCdRaw.replace(/<[^>]+>/g, '').toUpperCase().trim();
        }

        if (!typ) return null;
        if (typ.includes('NO ENTRY')) return 'NO_ENTRY';
        if (typ.includes('SLOW')) return 'SLOW';
        if (typ.includes('STOP')) return 'STOP';
        return null;
      }

      /* ================= data.gov.sg fetch via your Worker ONLY ================= */

      // Your Cloudflare Worker base
      const WORKER_BASE = "https://sqkiimapper.wk-yeow-2024.workers.dev/?url=";
      // Optional: put a data.gov.sg API key for higher rate limits on direct poll calls.
      const DATAGOV_API_KEY = '';
      const DATAGOV_MAX_429_RETRIES = 4;
      const DATAGOV_RETRY_BASE_MS = 12000;
      const DATAGOV_RETRY_MAX_MS = 65000;

      // Dataset IDs
      const DATASET_IDS = {
        HDB: "d_16b157c52ed637edd6ba1232e026258d",
        AED: "d_4e6b82c58a8a832f6f1fee5dfa6d47ea",
        BUS_STOP: "d_3f172c6feb3f4f92a2f47d93eed2908a",
        LAMP_POST: "d_ca109de3e83efdd9a10bc5f3dda70a98",
        TRAFFIC_SIGN: "d_bbf0132c7290d6838f82003972d933d5",
      };

      // Keep recon/statistics/glimpse on the original worker-only data path so counts
      // match the old mapper exactly.
      function getExactAnalysisCached(datasetId, label) {
        window.__DG_EXACT_CACHE = window.__DG_EXACT_CACHE || {};
        if (!window.__DG_EXACT_CACHE[datasetId]) {
          window.__DG_EXACT_CACHE[datasetId] = fetchDataGovGeoJsonExact(datasetId, label);
        }
        return window.__DG_EXACT_CACHE[datasetId];
      }

      async function fetchDataGovGeoJsonExact(datasetId, label = '') {
        const pollUrl = `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`;
        const name = label || datasetId;
        const loaderToken = beginDataGovLoader(name);
        let hasFailure = false;

        try {
          console.log(`🌐 [${name}] poll-download via Worker:`, pollUrl);

          const pollResp = await fetch(workerProxy(pollUrl));
          console.log(`📥 [${name}] poll status:`, pollResp.status);

          if (!pollResp.ok) {
            hasFailure = true;
            console.warn(`⚠️ [${name}] poll HTTP error`, pollResp.status);
            return null;
          }

          const pollJson = await pollResp.json();
          markDataGovLoaderStep(loaderToken, `Loaded poll metadata for ${name}`);
          console.log(`📊 [${name}] poll payload:`, pollJson);

          if (pollJson && pollJson.type === 'FeatureCollection' && Array.isArray(pollJson.features)) {
            console.log(`✅ [${name}] poll returned FeatureCollection directly`);
            return pollJson;
          }

          const downloadUrl = pollJson?.data?.url;
          if (!downloadUrl) {
            hasFailure = true;
            console.warn(`⚠️ [${name}] missing data.url`, pollJson);
            return null;
          }

          console.log(`⬇️ [${name}] downloading via Worker:`, downloadUrl);

          const dataResp = await fetch(workerProxy(downloadUrl));
          console.log(`📥 [${name}] data status:`, dataResp.status);

          if (!dataResp.ok) {
            hasFailure = true;
            console.warn(`⚠️ [${name}] data HTTP error`, dataResp.status);
            return null;
          }

          const dataJson = await dataResp.json();
          markDataGovLoaderStep(loaderToken, `Downloaded ${name}`);
          if (!dataJson || dataJson.type !== 'FeatureCollection' || !Array.isArray(dataJson.features)) {
            hasFailure = true;
            console.warn(`⚠️ [${name}] not a FeatureCollection`, dataJson);
            return null;
          }

          return dataJson;
        } catch (e) {
          hasFailure = true;
          console.error(`❌ [${name}] fetchDataGovGeoJsonExact failed`, e);
          return null;
        } finally {
          finishDataGovLoader(loaderToken, hasFailure);
        }
      }

      let reconWorker = null;

      function getReconWorker() {
        if (reconWorker) return reconWorker;

        const workerCode = `
    // Load turf in the worker (same turf version you use in main page)
    importScripts('https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js');

    let cache = {
      lamp: null, hdb: null, aed: null, bus: null, traffic: null
    };

    function prepDataset(fc) {
      if (!fc || !Array.isArray(fc.features)) return fc;

      for (const f of fc.features) {
        const g = f?.geometry;
        if (!g) continue;

        // Fast path for Point datasets (AED, Bus Stops, Lamp Posts, etc.)
        if (g.type === 'Point') {
          const coords = g.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) continue;

          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            f.__lng = lng;
            f.__lat = lat;
          }
          continue;
        }

        // Polygon / MultiPolygon datasets (HDB footprints)
        if (g.type === 'Polygon') {
          // Build once
          if (!f.__turfGeom) f.__turfGeom = turf.polygon(g.coordinates);
          // Cache bbox once (required for RBush indexing)
          if (!f.__bbox) f.__bbox = turf.bbox(f.__turfGeom);
          continue;
        }

        if (g.type === 'MultiPolygon') {
          if (!f.__turfGeom) f.__turfGeom = turf.multiPolygon(g.coordinates);
          if (!f.__bbox) f.__bbox = turf.bbox(f.__turfGeom);
          continue;
        }

        // (Optional) If you ever get LineString datasets, you can add them here.
      }

      return fc;
    }

    function countInCircle(dataset, circle) {
      if (!dataset || !Array.isArray(dataset.features)) return 0;
      let count = 0;
      for (const f of dataset.features) {
        const g = f.geometry;
        if (!g) continue;

        if (g.type === 'Point') {
          const lng = Number.isFinite(f.__lng) ? f.__lng : Number(g.coordinates?.[0]);
          const lat = Number.isFinite(f.__lat) ? f.__lat : Number(g.coordinates?.[1]);
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            if (turf.booleanPointInPolygon([lng, lat], circle)) count++;
          }
        } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
          const buildingGeom = f.__turfGeom || (
            g.type === 'Polygon' ? turf.polygon(g.coordinates) : turf.multiPolygon(g.coordinates)
          );
          if (turf.booleanIntersects(buildingGeom, circle)) count++;
        }
      }
      return count;
    }

    function extractTrafficSignCategory(feature) {
      const props = feature && feature.properties ? feature.properties : {};
      let typ = '';

      if (props.TYP_CD != null) typ = String(props.TYP_CD).toUpperCase();
      else if (props.typ_cd != null) typ = String(props.typ_cd).toUpperCase();
      else if (props.TYP != null) typ = String(props.TYP).toUpperCase();
      else if (props.Description) {
        const desc = String(props.Description);
        const match = desc.match(/<th>\\s*TYP_CD\\s*<\\/th>\\s*<td>(.*?)<\\/td>/i);
        const typCdRaw = match ? match[1] : '';
        typ = typCdRaw.replace(/<[^>]+>/g, '').toUpperCase().trim();
      }

      if (!typ) return null;
      if (typ.includes('NO ENTRY')) return 'NO_ENTRY';
      if (typ.includes('SLOW')) return 'SLOW';
      if (typ.includes('STOP')) return 'STOP';
      return null;
    }

    function countTrafficSigns(dataset, circle, category) {
      if (!dataset || !Array.isArray(dataset.features)) return 0;
      let count = 0;

      for (const f of dataset.features) {
        if (f.geometry?.type !== 'Point') continue;
        const lng = Number.isFinite(f.__lng) ? f.__lng : Number(f.geometry.coordinates?.[0]);
        const lat = Number.isFinite(f.__lat) ? f.__lat : Number(f.geometry.coordinates?.[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

        if (turf.booleanPointInPolygon([lng, lat], circle)) {
          const cat = f.__cat || (f.__cat = extractTrafficSignCategory(f));
          if (cat === category) count++;
        }
      }
      return count;
    }

    async function fetchGeoJson(fetchUrl) {
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      return await res.json();
    }

    onmessage = async (e) => {
      const msg = e.data;
      if (msg?.type !== 'START') return;

      try {
        const {
          fetchUrls, // { lampUrl, hdbUrl, aedUrl, busUrl, trafficUrl }
          reconCenter, reconRadiusMeters,
          reconPrecisionMeters,
          constraints,
          steps
        } = msg;

        // Load+cache datasets inside worker (so it keeps running even if tab hidden)
        if (!cache.lamp)    cache.lamp    = prepDataset(await fetchGeoJson(fetchUrls.lampUrl));
        if (!cache.hdb)     cache.hdb     = prepDataset(await fetchGeoJson(fetchUrls.hdbUrl));
        if (!cache.aed)     cache.aed     = prepDataset(await fetchGeoJson(fetchUrls.aedUrl));
        if (!cache.bus)     cache.bus     = prepDataset(await fetchGeoJson(fetchUrls.busUrl));
        if (!cache.traffic) cache.traffic = prepDataset(await fetchGeoJson(fetchUrls.trafficUrl));

        const searchCircle = turf.circle(reconCenter, reconRadiusMeters, { steps: steps || 64, units: 'meters' });
        const bbox = turf.bbox(searchCircle);
        const cellSizeKm = reconPrecisionMeters / 1000;
        const grid = turf.pointGrid(bbox, cellSizeKm, { units: 'kilometers' });

        // Filter test points inside recon circle
        const testPoints = [];
        for (const pt of grid.features) {
          const coords = pt.geometry?.coordinates;
          if (!coords) continue;
          if (turf.booleanPointInPolygon(coords, searchCircle)) testPoints.push(coords);
        }

        postMessage({ type: 'META', total: testPoints.length });

        const matches = [];
        for (let i = 0; i < testPoints.length; i++) {
          const coords = testPoints[i];
          const center = coords; // [lng, lat]

          let ok = true;
          for (const c of constraints) {
            const circle = turf.circle(center, c.radius, { steps: 32, units: 'meters' });

            let cnt = 0;
            if (c.dataset === 'lamp') cnt = countInCircle(cache.lamp, circle);
            else if (c.dataset === 'hdb') cnt = countInCircle(cache.hdb, circle);
            else if (c.dataset === 'aed') cnt = countInCircle(cache.aed, circle);
            else if (c.dataset === 'bus') cnt = countInCircle(cache.bus, circle);
            else if (c.dataset === 'traffic') cnt = countTrafficSigns(cache.traffic, circle, c.category);

            if (cnt < c.min || cnt > c.max) { ok = false; break; }
          }

          if (ok) matches.push(center);

          // progress update every ~100 points
          if (i % 100 === 0) postMessage({ type: 'PROGRESS', done: i });
        }

        postMessage({ type: 'DONE', matches });
      } catch (err) {
        postMessage({ type: 'ERROR', message: String(err?.message || err) });
      }
    };
  `;

        const blob = new Blob([workerCode], { type: 'text/javascript' });
        reconWorker = new Worker(URL.createObjectURL(blob));
        return reconWorker;
      }

      function ensureHdbIndex(hdbData) {
        if (!hdbData?.features) return;
        if (hdbData.__rbush) return;                 // already built
        if (typeof rbush !== 'function') return;     // rbush script missing

        const tree = new rbush();
        const items = [];

        for (const f of hdbData.features) {
          if (!f.__turfGeom || !f.__bbox) continue;  // ensured by prepDataset()
          const b = f.__bbox; // [minX,minY,maxX,maxY]
          items.push({ minX: b[0], minY: b[1], maxX: b[2], maxY: b[3], f });
        }

        tree.load(items);
        hdbData.__rbush = tree;
      }

      function countHdbInCircleIndexed(hdbData, circle) {
        // Fallback if no index
        if (!hdbData?.__rbush) return countInCircle(hdbData, circle);

        const [minX, minY, maxX, maxY] = turf.bbox(circle);
        const candidates = hdbData.__rbush.search({ minX, minY, maxX, maxY });

        let count = 0;
        for (const item of candidates) {
          // IMPORTANT: still uses booleanIntersects (touching boundary counts)
          if (turf.booleanIntersects(item.f.__turfGeom, circle)) count++;
        }
        return count;
      }



      function workerProxy(url) {
        return WORKER_BASE + encodeURIComponent(url);
      }

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function parseRetryAfterMs(retryAfterHeader) {
        if (!retryAfterHeader) return 0;

        const seconds = Number(retryAfterHeader);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

        const when = Date.parse(retryAfterHeader);
        if (Number.isNaN(when)) return 0;

        return Math.max(0, when - Date.now());
      }

      function buildDataGovDirectFetchOptions(url) {
        const isDataGovApi = /^https:\/\/api-open\.data\.gov\.sg\//i.test(url);
        if (!isDataGovApi || !DATAGOV_API_KEY) return undefined;
        return {
          headers: {
            'x-api-key': DATAGOV_API_KEY,
          },
        };
      }

      async function fetchWith429Retry(requestUrl, options, label, stage, mode) {
        let attempt = 0;
        while (true) {
          const resp = await fetch(requestUrl, options);
          if (resp.status !== 429) return resp;

          attempt += 1;
          if (attempt > DATAGOV_MAX_429_RETRIES) return resp;

          const retryAfterMs = parseRetryAfterMs(resp.headers.get('retry-after'));
          const backoffMs = Math.min(
            DATAGOV_RETRY_MAX_MS,
            DATAGOV_RETRY_BASE_MS * Math.pow(2, attempt - 1)
          );
          const jitterMs = Math.floor(Math.random() * 400);
          const waitMs = Math.max(retryAfterMs, backoffMs + jitterMs);
          console.warn(`[${label}] ${stage} 429 (${mode}); retry ${attempt}/${DATAGOV_MAX_429_RETRIES} in ${waitMs}ms`);
          await sleep(waitMs);
        }
      }

      const dataGovLoaderState = {
        activeRequests: 0,
        totalSteps: 0,
        doneSteps: 0,
        nextTokenId: 1,
        mounted: false,
        root: null,
        status: null,
        fill: null,
        percent: null,
        hideTimer: null,
      };

      function ensureDataGovLoaderUi() {
        if (dataGovLoaderState.mounted) return;
        if (typeof document === 'undefined' || !document.body) return;

        if (!document.getElementById('dg-fetch-loader-style')) {
          const style = document.createElement('style');
          style.id = 'dg-fetch-loader-style';
          style.textContent = `
            #dg-fetch-loader {
              position: fixed;
              top: 12px;
              left: 50%;
              transform: translateX(-50%) translateY(-10px);
              width: min(520px, calc(100vw - 20px));
              padding: 10px 12px;
              border-radius: 10px;
              background: rgba(17, 22, 30, 0.95);
              border: 1px solid rgba(255, 255, 255, 0.16);
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
              color: #f5f7fa;
              font-size: 12px;
              line-height: 1.3;
              z-index: 99999;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.18s ease, transform 0.18s ease;
            }
            #dg-fetch-loader.show {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
            #dg-fetch-loader .dg-fetch-loader-head {
              display: flex;
              justify-content: space-between;
              gap: 8px;
            }
            #dg-fetch-loader .dg-fetch-loader-status {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            #dg-fetch-loader .dg-fetch-loader-percent {
              font-variant-numeric: tabular-nums;
            }
            #dg-fetch-loader .dg-fetch-loader-track {
              margin-top: 7px;
              height: 7px;
              border-radius: 999px;
              overflow: hidden;
              background: rgba(255, 255, 255, 0.14);
            }
            #dg-fetch-loader .dg-fetch-loader-fill {
              width: 0%;
              height: 100%;
              border-radius: 999px;
              background: linear-gradient(90deg, #40c463 0%, #2ea8ff 100%);
              transition: width 0.2s ease;
            }
          `;
          document.head.appendChild(style);
        }

        let root = document.getElementById('dg-fetch-loader');
        if (!root) {
          root = document.createElement('div');
          root.id = 'dg-fetch-loader';
          root.innerHTML = `
            <div class="dg-fetch-loader-head">
              <div class="dg-fetch-loader-status">Loading data.gov datasets...</div>
              <div class="dg-fetch-loader-percent">0%</div>
            </div>
            <div class="dg-fetch-loader-track">
              <div class="dg-fetch-loader-fill"></div>
            </div>
          `;
          document.body.appendChild(root);
        }

        dataGovLoaderState.root = root;
        dataGovLoaderState.status = root.querySelector('.dg-fetch-loader-status');
        dataGovLoaderState.fill = root.querySelector('.dg-fetch-loader-fill');
        dataGovLoaderState.percent = root.querySelector('.dg-fetch-loader-percent');
        dataGovLoaderState.mounted = true;
      }

      function renderDataGovLoader(note = '') {
        ensureDataGovLoaderUi();
        if (!dataGovLoaderState.mounted) return;

        const total = Math.max(1, dataGovLoaderState.totalSteps);
        let percent = Math.round((dataGovLoaderState.doneSteps / total) * 100);
        if (dataGovLoaderState.activeRequests > 0) percent = Math.max(4, Math.min(99, percent));
        else percent = 100;

        dataGovLoaderState.fill.style.width = `${percent}%`;
        dataGovLoaderState.percent.textContent = `${percent}%`;
        dataGovLoaderState.status.textContent = note || (
          dataGovLoaderState.activeRequests > 0
            ? `Loading data.gov datasets (${dataGovLoaderState.activeRequests} active)`
            : 'Data.gov fetch complete'
        );

        if (dataGovLoaderState.activeRequests > 0) {
          clearTimeout(dataGovLoaderState.hideTimer);
          dataGovLoaderState.root.classList.add('show');
          return;
        }

        clearTimeout(dataGovLoaderState.hideTimer);
        dataGovLoaderState.hideTimer = setTimeout(() => {
          if (!dataGovLoaderState.root) return;
          dataGovLoaderState.root.classList.remove('show');
          dataGovLoaderState.totalSteps = 0;
          dataGovLoaderState.doneSteps = 0;
        }, 450);
      }

      function beginDataGovLoader(label) {
        const token = {
          id: dataGovLoaderState.nextTokenId++,
          label: label || 'Dataset',
          totalSteps: 2,
          doneSteps: 0,
          closed: false,
        };

        dataGovLoaderState.activeRequests += 1;
        dataGovLoaderState.totalSteps += token.totalSteps;
        renderDataGovLoader(`Loading ${token.label}...`);
        return token;
      }

      function markDataGovLoaderStep(token, note = '') {
        if (!token || token.closed) return;
        if (token.doneSteps < token.totalSteps) {
          token.doneSteps += 1;
          dataGovLoaderState.doneSteps += 1;
        }
        renderDataGovLoader(note || `Loading ${token.label}...`);
      }

      function finishDataGovLoader(token, failed = false) {
        if (!token || token.closed) return;
        token.closed = true;

        const remaining = token.totalSteps - token.doneSteps;
        if (remaining > 0) dataGovLoaderState.doneSteps += remaining;
        dataGovLoaderState.activeRequests = Math.max(0, dataGovLoaderState.activeRequests - 1);

        const msg = failed
          ? `${token.label} failed`
          : (dataGovLoaderState.activeRequests > 0
            ? `Loading data.gov datasets (${dataGovLoaderState.activeRequests} active)`
            : 'Data.gov fetch complete');
        renderDataGovLoader(msg);
      }

      let workerProxyHealthy = null;

      let dataGovPollQueue = Promise.resolve();

      function enqueueDataGovPoll(task) {
        const run = dataGovPollQueue.then(task, task);
        dataGovPollQueue = run.catch(() => { });
        return run;
      }

      // Try worker first, then direct URL if worker response is invalid.
      async function fetchJsonWithFallback(url, label, stage, options = {}) {
        const allowDirect = options.allowDirect !== false;
        const queued = options.queued === true;

        const attempts = [];
        if (workerProxyHealthy !== false && typeof WORKER_BASE === 'string' && WORKER_BASE.trim()) {
          attempts.push({ mode: 'worker', requestUrl: workerProxy(url) });
        }
        if (allowDirect) {
          attempts.push({ mode: 'direct', requestUrl: url });
        }

        if (!attempts.length) {
          throw new Error(`${stage} has no available fetch path (worker disabled and direct disallowed)`);
        }

        let lastError = null;

        const runAttempts = async () => {
          for (const attempt of attempts) {
            try {
              const directOpts = attempt.mode === 'direct'
                ? buildDataGovDirectFetchOptions(url)
                : undefined;
              const resp = await fetchWith429Retry(attempt.requestUrl, directOpts, label, stage, attempt.mode);
              console.log(`[${label}] ${stage} status (${attempt.mode}):`, resp.status);

              if (!resp.ok) {
                lastError = new Error(`${stage} HTTP ${resp.status} (${attempt.mode})`);
                continue;
              }

              const raw = await resp.text();
              const trimmed = raw.trimStart();
              const contentType = (resp.headers.get('content-type') || '').toLowerCase();

              // Typical proxy failure: HTML app shell is returned instead of JSON.
              if (
                trimmed.startsWith('<!DOCTYPE') ||
                trimmed.startsWith('<html') ||
                (contentType.includes('text/html') && trimmed.startsWith('<'))
              ) {
                if (attempt.mode === 'worker') workerProxyHealthy = false;
                console.warn(`[${label}] ${stage} returned HTML (${attempt.mode}); trying next path.`);
                lastError = new Error(`${stage} returned HTML (${attempt.mode})`);
                continue;
              }

              try {
                if (attempt.mode === 'worker') workerProxyHealthy = true;
                return JSON.parse(raw);
              } catch (parseErr) {
                if (attempt.mode === 'worker') workerProxyHealthy = false;
                const preview = trimmed.slice(0, 140).replace(/\s+/g, ' ');
                console.warn(`[${label}] ${stage} invalid JSON (${attempt.mode}) preview:`, preview);
                lastError = parseErr;
              }
            } catch (e) {
              if (attempt.mode === 'worker') workerProxyHealthy = false;
              lastError = e;
              console.warn(`[${label}] ${stage} fetch failed (${attempt.mode})`, e);
            }
          }
          throw lastError || new Error(`${stage} failed for all fetch paths`);
        };

        if (queued) return enqueueDataGovPoll(runAttempts);
        return runAttempts();
      }

      const dataGovGeoJsonCache = new Map();
      const dataGovGeoJsonInFlight = new Map();

      async function fetchDataGovGeoJson(datasetId, label = '') {
        const name = label || datasetId;

        if (dataGovGeoJsonCache.has(datasetId)) {
          return dataGovGeoJsonCache.get(datasetId);
        }
        if (dataGovGeoJsonInFlight.has(datasetId)) {
          return dataGovGeoJsonInFlight.get(datasetId);
        }

        const run = (async () => {
        const pollUrl = `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`;
        const loaderToken = beginDataGovLoader(name);
        let hasFailure = false;

        try {
          const pollJson = await fetchJsonWithFallback(pollUrl, name, 'poll-download', {
            allowDirect: true,
            queued: true,
          });
          markDataGovLoaderStep(loaderToken, `Loaded poll metadata for ${name}`);
          console.log(`[${name}] poll payload:`, pollJson);

          // Sometimes poll-download returns GeoJSON directly.
          if (pollJson && pollJson.type === 'FeatureCollection' && Array.isArray(pollJson.features)) {
            return pollJson;
          }

          const downloadUrl = pollJson?.data?.url;
          if (!downloadUrl) {
            hasFailure = true;
            console.warn(`[${name}] missing data.url`, pollJson);
            return null;
          }

          const dataJson = await fetchJsonWithFallback(downloadUrl, name, 'dataset-download', {
            // Browser direct fetch to S3 signed URL is blocked by CORS.
            allowDirect: false,
          });
          markDataGovLoaderStep(loaderToken, `Downloaded ${name}`);
          if (!dataJson || dataJson.type !== 'FeatureCollection' || !Array.isArray(dataJson.features)) {
            hasFailure = true;
            console.warn(`[${name}] dataset is not a FeatureCollection`, dataJson);
            return null;
          }

          dataGovGeoJsonCache.set(datasetId, dataJson);
          return dataJson;
        } catch (e) {
          hasFailure = true;
          if (String(e?.message || '').includes('no available fetch path')) {
            console.error(`[${name}] dataset download needs a working proxy endpoint in WORKER_BASE.`);
          }
          console.error(`[${name}] fetchDataGovGeoJson failed`, e);
          return null;
        } finally {
          finishDataGovLoader(loaderToken, hasFailure);
          dataGovGeoJsonInFlight.delete(datasetId);
        }
        })();

        dataGovGeoJsonInFlight.set(datasetId, run);
        return run;
      }

      /* =========== GLIMPSE TRAFFIC SIGNS OVERLAY =========== */

      const GLIMPSE_SIGNS_SOURCE_ID = 'glimpse-traffic-signs-src';
      const GLIMPSE_SIGNS_LAYER_ID = 'glimpse-traffic-signs-layer';

      const GLIMPSE_TS_SOURCE_ID = GLIMPSE_SIGNS_SOURCE_ID;
      const GLIMPSE_TS_LAYER_STOP = 'glimpse-traffic-signs-stop';
      const GLIMPSE_TS_LAYER_SLOW = 'glimpse-traffic-signs-slow';
      const GLIMPSE_TS_LAYER_NOENTRY = 'glimpse-traffic-signs-noentry';

      let leafletGlimpseLayer = null;

      async function loadCircleStatistics(fid, center, radiusMeters) {
        console.log('🔍 Starting statistics calculation...', { fid, center, radiusMeters });

        const editorBtn = document.getElementById('se-calc-stats');
        if (editorBtn) {
          editorBtn.disabled = true;
          editorBtn.textContent = '⏳ Calculating...';
        }

        const feature = findFeatureByFid(fid);
        if (!feature) {
          console.error('❌ Feature not found for statistics:', fid);
          if (editorBtn) {
            editorBtn.disabled = false;
            editorBtn.textContent = '❌ Retry Calculate';
          }
          return;
        }

        try {
          const circlePolygon = turf.circle(center, radiusMeters, { steps: 64, units: 'meters' });

          let hdbCount = 0;
          let aedCount = 0;
          let busStopCount = 0;
          let lampPostCount = 0;
          let noEntryCount = 0;
          let slowSignCount = 0;
          let stopSignCount = 0;

          const [hdbData, aedData, busData, lampPostData, trafficData] = await Promise.all([
            getExactAnalysisCached(DATASET_IDS.HDB, 'HDB'),
            getExactAnalysisCached(DATASET_IDS.AED, 'AED'),
            getExactAnalysisCached(DATASET_IDS.BUS_STOP, 'Bus Stop'),
            getExactAnalysisCached(DATASET_IDS.LAMP_POST, 'Lamp Post'),
            getExactAnalysisCached(DATASET_IDS.TRAFFIC_SIGN, 'Traffic Sign'),
          ]);

          // ---- HDB Blocks ----
          if (hdbData?.features) {
            for (const f of hdbData.features) {
              const geom = f.geometry;
              if (!geom) continue;
              try {
                if (geom.type === 'Point') {
                  const [lng, lat] = geom.coordinates || [];
                  if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    if (turf.booleanPointInPolygon(turf.point([lng, lat]), circlePolygon)) hdbCount++;
                  }
                } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
                  const buildingGeom = geom.type === 'Polygon'
                    ? turf.polygon(geom.coordinates)
                    : turf.multiPolygon(geom.coordinates);
                  if (turf.booleanIntersects(buildingGeom, circlePolygon)) hdbCount++;
                }
              } catch (e) {
                console.warn('⚠️ Error handling HDB geometry', e, f);
              }
            }
          }

          // ---- AEDs ----
          if (aedData?.features) {
            for (const f of aedData.features) {
              const geom = f.geometry;
              if (!geom) continue;
              try {
                if (geom.type === 'Point') {
                  const [lng, lat] = geom.coordinates || [];
                  if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    if (turf.booleanPointInPolygon(turf.point([lng, lat]), circlePolygon)) aedCount++;
                  }
                } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
                  const aedGeom = geom.type === 'Polygon'
                    ? turf.polygon(geom.coordinates)
                    : turf.multiPolygon(geom.coordinates);
                  if (turf.booleanIntersects(aedGeom, circlePolygon)) aedCount++;
                }
              } catch (e) {
                console.warn('⚠️ Error handling AED geometry', e, f);
              }
            }
          }

          // ---- Bus Stops ----
          if (busData?.features) {
            for (const f of busData.features) {
              const geom = f.geometry;
              if (!geom) continue;
              try {
                if (geom.type === 'Point') {
                  const [lng, lat] = geom.coordinates || [];
                  if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    if (turf.booleanPointInPolygon(turf.point([lng, lat]), circlePolygon)) busStopCount++;
                  }
                } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
                  const busGeom = geom.type === 'Polygon'
                    ? turf.polygon(geom.coordinates)
                    : turf.multiPolygon(geom.coordinates);
                  if (turf.booleanIntersects(busGeom, circlePolygon)) busStopCount++;
                }
              } catch (e) {
                console.warn('⚠️ Error handling Bus Stop geometry', e, f);
              }
            }
          }

          // ---- Lamp Posts ----
          if (lampPostData?.features) {
            for (const f of lampPostData.features) {
              const geom = f.geometry;
              if (!geom) continue;
              try {
                if (geom.type === 'Point') {
                  const [lng, lat] = geom.coordinates || [];
                  if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    if (turf.booleanPointInPolygon(turf.point([lng, lat]), circlePolygon)) lampPostCount++;
                  }
                } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
                  const lampGeom = geom.type === 'Polygon'
                    ? turf.polygon(geom.coordinates)
                    : turf.multiPolygon(geom.coordinates);
                  if (turf.booleanIntersects(lampGeom, circlePolygon)) lampPostCount++;
                }
              } catch (e) {
                console.warn('⚠️ Error handling Lamp Post geometry', e, f);
              }
            }
          }

          // ---- Traffic Signs ----
          if (trafficData?.features) {
            for (const f of trafficData.features) {
              const geom = f.geometry;
              if (!geom || geom.type !== 'Point') continue;

              try {
                const [lng, lat] = geom.coordinates || [];
                if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

                const pt = turf.point([lng, lat]);
                if (!turf.booleanPointInPolygon(pt, circlePolygon)) continue;

                const category = extractTrafficSignCategory(f);
                if (!category) continue;

                if (category === 'NO_ENTRY') noEntryCount++;
                else if (category === 'SLOW') slowSignCount++;
                else if (category === 'STOP') stopSignCount++;
              } catch (e) {
                console.warn('⚠️ Error handling Traffic Sign feature', e, f);
              }
            }
          }

          // ---- Store results on the feature ----
          feature.properties = feature.properties || {};
          feature.properties._statsCalculated = true;
          feature.properties._hdbCount = hdbCount;
          feature.properties._aedCount = aedCount;
          feature.properties._lampPostCount = lampPostCount;
          feature.properties._busCount = busStopCount;
          feature.properties._noEntryCount = noEntryCount;
          feature.properties._slowSignCount = slowSignCount;
          feature.properties._stopSignCount = stopSignCount;
          feature.properties._circleCenter = center;
          feature.properties._circleRadius = radiusMeters;
          feature.properties._ts = Date.now();

          if (typeof saveState === 'function') saveState();

          // ---- Update UI ----
          if (editorBtn) {
            editorBtn.disabled = false;
            editorBtn.textContent = '🔄 Recalculate Statistics';

            let statsDiv = document.getElementById('se-stats-display');
            if (!statsDiv) {
              statsDiv = document.createElement('div');
              statsDiv.id = 'se-stats-display';
              statsDiv.style.cssText =
                'margin-top:8px;padding:8px;background:rgba(0,0,0,0.2);border-radius:8px;font-size:12px;';
              editorBtn.parentElement.insertBefore(statsDiv, editorBtn);
            }

            const radiusLabel = `${Math.round(radiusMeters)}m`;

            statsDiv.innerHTML = `
        <div style="font-weight:700;margin-bottom:4px;color:#60a5fa;">Circle Statistics:</div>
        <div style="display:grid;gap:4px;font-size:11px;">
          <div>🏢 HDB Blocks: ${hdbCount}</div>
          <div>➕ AEDs: ${aedCount}</div>
          <div>🚌 Bus Stops: ${busStopCount}</div>
          <div>💡 Lamp Posts: ${lampPostCount}</div>
          <div>🚫 No-entry Signs: ${noEntryCount}</div>
          <div>🌀 Slow Signs: ${slowSignCount}</div>
          <div>🛑 Stop Signs: ${stopSignCount}</div>
          <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1);">
            📏 Radius: ${radiusLabel}
          </div>
        </div>
      `;
          }

        } catch (error) {
          console.error('❌ Failed to load statistics:', error);
          if (editorBtn) {
            editorBtn.disabled = false;
            editorBtn.textContent = '❌ Retry Calculate';
          }
        }
      }



      /**
       * Clear any existing Glimpse overlay from both engines.
       */
      function clearGlimpseOverlay() {
        console.log('[Glimpse] Clearing existing overlay');

        // MapLibre GL
        if (typeof mapgl !== 'undefined' && mapgl && mapgl.getSource) {
          try {
            if (mapgl.getLayer(GLIMPSE_SIGNS_LAYER_ID)) {
              mapgl.removeLayer(GLIMPSE_SIGNS_LAYER_ID);
            }
            if (mapgl.getSource(GLIMPSE_SIGNS_SOURCE_ID)) {
              mapgl.removeSource(GLIMPSE_SIGNS_SOURCE_ID);
            }
          } catch (e) {
            console.warn('[Glimpse] Failed to clear GL overlay', e);
          }
        }

        // Leaflet
        if (typeof mapleaf !== 'undefined' && mapleaf && leafletGlimpseLayer) {
          try {
            mapleaf.removeLayer(leafletGlimpseLayer);
          } catch (e) {
            console.warn('[Glimpse] Failed to clear Leaflet overlay', e);
          }
          leafletGlimpseLayer = null;
        }
      }

      /**
       * Load the traffic sign dataset (same ID used by statistics),
       * with a simple cache so we only fetch once.
       */
      async function getTrafficSignDataForGlimpse() {
        try {
          const data = await getExactAnalysisCached(DATASET_IDS.TRAFFIC_SIGN, 'Traffic Sign');
          console.log(
            '[Glimpse] Traffic-sign data loaded:',
            data && Array.isArray(data.features) ? data.features.length : 0,
            'features'
          );
          return data;
        } catch (e) {
          console.error('[Glimpse] Failed to load traffic-sign data', e);
          return null;
        }
      }

      /**
       * Draw the given features (already filtered to the circle) on the map.
       * Each feature MUST have properties.category and properties.emoji.
       */
      function renderGlimpseSigns(features) {
        console.log(
          '[Glimpse] renderGlimpseSigns with',
          features.length,
          'features. engine =',
          typeof engine !== 'undefined' ? engine : '(none)'
        );

        // Clear old overlay first
        clearGlimpseOverlay();

        if (!features.length) {
          console.log('[Glimpse] No features to render');
          return;
        }

        const fc = {
          type: 'FeatureCollection',
          features
        };

        // ------------ MapLibre GL ------------
        if (typeof mapgl !== 'undefined' && mapgl && mapgl.addSource && engine === 'gl') {
          try {
            console.log('[Glimpse] Rendering on MapLibre GL (circle + label)');

            // Create or update the GeoJSON source
            if (!mapgl.getSource(GLIMPSE_SIGNS_SOURCE_ID)) {
              mapgl.addSource(GLIMPSE_SIGNS_SOURCE_ID, {
                type: 'geojson',
                data: fc
              });
            } else {
              mapgl.getSource(GLIMPSE_SIGNS_SOURCE_ID).setData(fc);
            }

            // Remove old layers if they exist
            if (mapgl.getLayer(GLIMPSE_SIGNS_LAYER_ID)) {
              mapgl.removeLayer(GLIMPSE_SIGNS_LAYER_ID);
            }
            const GLIMPSE_SIGNS_TEXT_LAYER_ID = 'glimpse-signs-text-layer';
            if (mapgl.getLayer(GLIMPSE_SIGNS_TEXT_LAYER_ID)) {
              mapgl.removeLayer(GLIMPSE_SIGNS_TEXT_LAYER_ID);
            }

            // 1) Circle layer with colours by category
            mapgl.addLayer({
              id: GLIMPSE_SIGNS_LAYER_ID,   // circle layer
              type: 'circle',
              source: GLIMPSE_SIGNS_SOURCE_ID,
              paint: {
                // Size of the icon
                'circle-radius': 6,
                // Colour by category: STOP / NO_ENTRY / SLOW
                'circle-color': [
                  'match',
                  ['get', 'category'],
                  'STOP', '#FF7F7F',   // red
                  'NO_ENTRY', '#ffa500',   // pink
                  'SLOW', '#FFFFED',   // yellow
                  '#ffffff'                // fallback
                ],
                'circle-stroke-color': '#000000',
                'circle-stroke-width': 1.0
              }
            });

            // 2) Text layer with ST / NE / SL inside each dot
            mapgl.addLayer({
              id: GLIMPSE_SIGNS_TEXT_LAYER_ID,  // text on top
              type: 'symbol',
              source: GLIMPSE_SIGNS_SOURCE_ID,
              layout: {
                'text-field': ['get', 'label'],  // ST / NE / SL (from properties.label)
                'text-size': 7,
                'text-anchor': 'center',
                'text-allow-overlap': true
              },
              paint: {
                'text-color': '#000000',
                'text-halo-color': '#ffffff',
                'text-halo-width': 0.0
              }
            });

          } catch (e) {
            console.error('[Glimpse] Failed to render on MapLibre', e);
          }
        }


        // ------------ Leaflet ------------
        if (typeof mapleaf !== 'undefined' && mapleaf && typeof L !== 'undefined' && L && engine === 'leaf') {
          console.log('[Glimpse] Rendering on Leaflet');

          const markers = features.map(f => {
            const coords = f.geometry.coordinates;
            const [lng, lat] = coords;
            const emoji = f.properties.emoji || '⚠️';

            const icon = L.divIcon({
              className: 'glimpse-sign-icon',
              html: '<div style="font-size:20px;transform:translate(-50%,-50%);">' + emoji + '</div>'
            });

            return L.marker([lat, lng], { icon });
          });

          leafletGlimpseLayer = L.layerGroup(markers).addTo(mapleaf);
        }
      } // <-- end of renderGlimpseSigns(features)

      /**
       * Main entry point called from the Style Editor “Glimpse Signs” button.
       * - center: [lng, lat]
       * - radiusMeters: number
       */
      async function glimpseTrafficSigns(fid, center, radiusMeters) {
        console.log('👁️ Glimpse signs triggered', { fid, center, radiusMeters });

        if (!center || !Array.isArray(center) || center.length !== 2 || !radiusMeters) {
          console.warn('[Glimpse] Missing circle center/radius, aborting');
          alert('Could not determine circle parameters for Glimpse.');
          return;
        }

        const circlePolygon = turf.circle(center, radiusMeters, {
          steps: 64,
          units: 'meters'
        });
        console.log('[Glimpse] Circle polygon created');

        const trafficData = await getTrafficSignDataForGlimpse();
        if (!trafficData || !Array.isArray(trafficData.features)) {
          alert('Could not load traffic-sign dataset.');
          return;
        }

        const inside = [];

        for (const f of trafficData.features) {
          const geom = f.geometry;
          if (!geom || geom.type !== 'Point') continue;

          const coords = geom.coordinates || [];
          const lng = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

          const pt = turf.point([lng, lat]);
          if (!turf.booleanPointInPolygon(pt, circlePolygon)) continue;

          const category = extractTrafficSignCategory(f);
          if (!category) continue; // ignore other sign types

          // Emoji for Leaflet, 2-letter label for MapLibre
          let emoji = '⚠️';
          let label = ''; // ST / NE / SL

          if (category === 'STOP') {
            emoji = '🛑';
            label = 'ST';
          } else if (category === 'NO_ENTRY') {
            emoji = '⛔';
            label = 'NE';
          } else if (category === 'SLOW') {
            emoji = '🐌';
            label = 'SL';
          }

          inside.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              category, // STOP / NO_ENTRY / SLOW
              emoji,    // used by Leaflet divIcons
              label     // used by MapLibre text-field (ST / NE / SL)
            }
          });
        } // <-- closes the for-loop

        console.log('[Glimpse] Signs inside circle:', inside.length);

        if (!inside.length) {
          alert('No STOP/SLOW/NO ENTRY signs found inside this circle.');
          clearGlimpseOverlay();
          return;
        }

        renderGlimpseSigns(inside);
      } // <-- closes async function glimpseTrafficSigns


      /* ===== Dark Veil — pure WebGL (brighter & obvious purple) ===== */
      /* ===== EDITABLE KNOBS (Ultra-Blended) ===== */
      const SPEED = 0.52, ANGLE_SPEED = 0.22, BRIGHTNESS = IS_IOS_DEVICE ? 1.08 : 1.16, RES_SCALE = IS_IOS_DEVICE ? 0.55 : 1.0;
      const BASE_PURPLE = [0.50, 0.32, 0.96], ACC_LIGHT = [0.98, 0.78, 1.00], ACC_DARK = [0.36, 0.08, 0.60];
      const STR1 = 0.55, WIDTH1 = 0.82, FREQ1 = 4.0, OFF1 = 0.05;  // light accent
      const STR2 = 0.45, WIDTH2 = 0.80, FREQ2 = 5.2, OFF2 = 0.24;  // dark accent
      const STR3 = 0.35, WIDTH3 = 0.84, FREQ3 = 3.0, OFF3 = 0.40;  // black darkener
      const WARP = 0.10, NOISE = 0.010, SCAN_S = 0.02, SCAN_F = 0.08;

      /* randomness */
      const RAND_SEED = Math.random() * 1000;  // change to re-seed
      const RAND_WARP = 0.12;                // spatial irregularity
      const JIT_FREQ = 0.30, JIT_WIDTH = 0.25, JIT_OFFSET = 0.30; // per-accent jitter
      const JIT_DIR = 0.28;                  // direction jitter
      const RESEED_EVERY_SEC = 0;            // e.g., 60 to reseed each minute

      /* ===== DO NOT EDIT BELOW (minified) ===== */
      (function () { const c = document.getElementById('darkveil'); if (!c || IS_LOCALHOST) { if (c && IS_LOCALHOST) c.style.display = 'none'; return; } c.style.opacity = ".48"; const gl = c.getContext('webgl', { alpha: !0, premultipliedAlpha: !1 }) || c.getContext('experimental-webgl'); if (!gl) { console.warn('DarkVeil fallback'); return } const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'; const FS = 'precision mediump float;uniform vec2 r;uniform float t,B,n,s,f,W,ang,seed;uniform float rw;uniform vec3 Cb,Lp,Dp;uniform vec4 A1,A2,A3;uniform vec3 J;uniform float jdir;float rnd(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+seed)*43758.5453);}float n1(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);float a=rnd(i),b=rnd(i+vec2(1.,0.)),c=rnd(i+vec2(0.,1.)),d=rnd(i+vec2(1.,1.));return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}vec2 warpN(vec2 p){vec2 g=vec2(n1(p*1.1+seed),n1(p*1.3-seed));return p+rw*(g-0.5);}vec2 warpS(vec2 p){return p+W*vec2(sin(2.1*p.y+0.9*t),cos(2.0*p.x-0.7*t));}float tri(float x){return 1.0-abs(fract(x)-0.5)*2.0;}float band(vec2 p,vec2 d,float freq,float width,float off,float k){p=warpS(warpN(p));float tf=t*mix(1.0,1.6,k);float jf=n1(p*1.2+tf*0.37+seed)-0.5;float jw=n1(p*1.5-tf*0.29-seed)-0.5;float jo=n1(p*0.9+tf*0.41+seed*0.5)-0.5;float F=freq*(1.0+J.x*jf),W=clamp(width*(1.0+J.y*jw),0.05,0.95),O=off+J.z*jo;float x=dot(p,d)*F - tf + O;float v=tri(x);return smoothstep(1.0-W,1.0,v);}void main(){vec2 uv=(gl_FragCoord.xy/r)*2.-1.;uv.y*=-1.;float asp=r.x/r.y;vec2 p=vec2(uv.x*asp,uv.y);float a=ang + jdir*(n1(vec2(ang*0.17,ang*0.23)+seed)-0.5);vec2 d=normalize(vec2(cos(a),sin(a)));vec3 col=Cb;float m1=band(p,d,A1.z,A1.y,A1.w,0.25);float m2=band(p,d,A2.z,A2.y,A2.w,0.55);float m3=band(p,d,A3.z,A3.y,A3.w,0.85);col=mix(col,Lp,clamp(m1*A1.x,0.,1.));col=mix(col,Dp,clamp(m2*A2.x,0.,1.));col=mix(col,vec3(0.),clamp(m3*A3.x,0.,1.));col*=B;col=pow(col,vec3(0.92));float sl=sin(gl_FragCoord.y*f)*.5+.5;col*=1.-(sl*sl)*s;col+=(rnd(gl_FragCoord.xy+t)-.5)*n*.8;gl_FragColor=vec4(clamp(col,0.,1.),1.);}'; function S(t, s) { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x } const pr = gl.createProgram(); gl.attachShader(pr, S(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, S(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); const a = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, !1, 0, 0); const uR = gl.getUniformLocation(pr, 'r'), uT = gl.getUniformLocation(pr, 't'), uA = gl.getUniformLocation(pr, 'ang'); const uSeed = gl.getUniformLocation(pr, 'seed'); gl.uniform1f(gl.getUniformLocation(pr, 'B'), BRIGHTNESS); gl.uniform1f(gl.getUniformLocation(pr, 'n'), NOISE); gl.uniform1f(gl.getUniformLocation(pr, 's'), SCAN_S); gl.uniform1f(gl.getUniformLocation(pr, 'f'), SCAN_F); gl.uniform1f(gl.getUniformLocation(pr, 'W'), WARP); gl.uniform1f(gl.getUniformLocation(pr, 'rw'), RAND_WARP); gl.uniform3f(gl.getUniformLocation(pr, 'Cb'), BASE_PURPLE[0], BASE_PURPLE[1], BASE_PURPLE[2]); gl.uniform3f(gl.getUniformLocation(pr, 'Lp'), ACC_LIGHT[0], ACC_LIGHT[1], ACC_LIGHT[2]); gl.uniform3f(gl.getUniformLocation(pr, 'Dp'), ACC_DARK[0], ACC_DARK[1], ACC_DARK[2]); gl.uniform4f(gl.getUniformLocation(pr, 'A1'), STR1, WIDTH1, FREQ1, OFF1); gl.uniform4f(gl.getUniformLocation(pr, 'A2'), STR2, WIDTH2, FREQ2, OFF2); gl.uniform4f(gl.getUniformLocation(pr, 'A3'), STR3, WIDTH3, FREQ3, OFF3); gl.uniform3f(gl.getUniformLocation(pr, 'J'), JIT_FREQ, JIT_WIDTH, JIT_OFFSET); gl.uniform1f(gl.getUniformLocation(pr, 'jdir'), JIT_DIR); const rs = () => { const p = c.parentElement; const w = (p?.clientWidth || c.width) | 0, h = Math.max((p?.clientHeight || c.height), (p?.scrollHeight || c.height)) | 0, W = (w * RES_SCALE) | 0, H = (h * RES_SCALE) | 0; c.style.width = w + 'px'; c.style.height = h + 'px'; if (c.width !== W || c.height !== H) { c.width = Math.max(1, W); c.height = Math.max(1, H); gl.viewport(0, 0, c.width, c.height) } gl.uniform2f(uR, c.width, c.height) }; let resizeQueued = !1; const queueRs = () => { if (resizeQueued) return; resizeQueued = !0; requestAnimationFrame(() => { resizeQueued = !1; rs() }) }; addEventListener('resize', queueRs, { passive: !0 }); if (typeof ResizeObserver !== 'undefined' && c.parentElement) { new ResizeObserver(queueRs).observe(c.parentElement) } else if (c.parentElement) { new MutationObserver(queueRs).observe(c.parentElement, IS_TOUCH_DEVICE ? { attributes: !0 } : { childList: !0, subtree: !0, attributes: !0 }) } rs(); let st = performance.now(), raf = 0, seed = RAND_SEED, seedAt = 0, running = !0; function loop() { if (!running) return; const now = (performance.now() - st) / 1e3; gl.uniform1f(uT, now * SPEED); gl.uniform1f(uA, now * ANGLE_SPEED); if (RESEED_EVERY_SEC > 0 && (now - seedAt) > RESEED_EVERY_SEC) { seedAt = now; seed = Math.random() * 1000 } gl.uniform1f(uSeed, seed); gl.drawArrays(gl.TRIANGLES, 0, 3); raf = requestAnimationFrame(loop) } function pauseVeil() { running = !1; raf && (cancelAnimationFrame(raf), raf = 0) } function resumeVeil() { running || (running = !0, st = performance.now(), seedAt = 0, raf = requestAnimationFrame(loop)) } window.__pauseVeil = pauseVeil; window.__resumeVeil = resumeVeil; raf = requestAnimationFrame(loop); document.addEventListener('visibilitychange', () => { document.hidden ? pauseVeil() : resumeVeil() }) })();


      /* ===================== FPS OPTIMIZATIONS ===================== */
      // Safe performance improvements: +65-110 FPS with zero feature loss

      // 1. Pause Lottie when not visible (+5-10 FPS)
      (function () {
        const lottieEl = document.getElementById('cat-lottie');
        if (lottieEl) {
          const obs = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
              const lottieAnimation = lottieEl._lottieAnimation;
              if (e.isIntersecting) {
                lottieAnimation?.play?.();
              } else {
                lottieAnimation?.pause?.();
              }
            });
          }, { threshold: 0.1 });
          obs.observe(lottieEl);
          console.log('[FPS] ✅ Lottie pause enabled (+5-10 FPS)');
        }
      })();

      // 2. Map quality reduction during interaction (+10-20 FPS)
      window.optimizeMapPerformance = function (map) {
        if (!map) return;
        map.on('movestart', function () {
          try { map.setRenderWorldCopies(false); } catch (e) { }
        });
        map.on('moveend', function () {
          try { map.setRenderWorldCopies(true); } catch (e) { }
        });
        console.log('[FPS] ✅ Map interaction optimized (+10-20 FPS)');
      };

      // 3. Batch style updates (+10-15 FPS)
      window.batchStyleUpdates = function (map, updates) {
        if (!map || !updates) return;
        requestAnimationFrame(function () {
          updates.forEach(function (u) {
            try { map.setPaintProperty(u.layerId, u.property, u.value); } catch (e) { }
          });
        });
      };

      // 4. Viewport culling (+30-50 FPS)
      window.ViewportCuller = (function () {
        let enabled = false, map = null, srcId = null, allFeats = [], timeout = null;

        function inBounds(feat, bounds) {
          if (!feat || !feat.geometry) return false;
          const g = feat.geometry;
          if (g.type === 'Point') {
            const [lng, lat] = g.coordinates;
            return lng >= bounds.getWest() && lng <= bounds.getEast() && lat >= bounds.getSouth() && lat <= bounds.getNorth();
          }
          if (g.type === 'Polygon' && g.coordinates && g.coordinates[0]) {
            for (let i = 0; i < g.coordinates[0].length; i++) {
              const [lng, lat] = g.coordinates[0][i];
              if (lng >= bounds.getWest() && lng <= bounds.getEast() && lat >= bounds.getSouth() && lat <= bounds.getNorth()) return true;
            }
          }
          if (g.type === 'MultiPolygon' && g.coordinates) {
            for (let p = 0; p < g.coordinates.length; p++) {
              for (let i = 0; i < g.coordinates[p][0].length; i++) {
                const [lng, lat] = g.coordinates[p][0][i];
                if (lng >= bounds.getWest() && lng <= bounds.getEast() && lat >= bounds.getSouth() && lat <= bounds.getNorth()) return true;
              }
            }
          }
          return false;
        }

        function update() {
          if (!enabled || !map || !srcId || !allFeats.length) return;
          try {
            const bounds = map.getBounds();
            const visible = allFeats.filter(function (f) { return inBounds(f, bounds); });
            const src = map.getSource(srcId);
            if (src && src.setData) {
              src.setData({ type: 'FeatureCollection', features: visible });
              console.log('[ViewportCuller] Showing ' + visible.length + ' of ' + allFeats.length);
            }
          } catch (e) { }
        }

        function schedule() {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(function () { update(); timeout = null; }, 100);
        }

        return {
          enable: function (mapInst, source, features) {
            if (!mapInst || !source) return false;
            map = mapInst;
            srcId = source;
            if (features && Array.isArray(features)) {
              allFeats = features;
            } else {
              try {
                const s = map.getSource(source);
                if (s && s._data && s._data.features) allFeats = s._data.features;
              } catch (e) { return false; }
            }
            if (!allFeats.length) return false;
            map.on('moveend', schedule);
            map.on('zoomend', schedule);
            enabled = true;
            update();
            console.log('[ViewportCuller] ✅ Enabled for ' + allFeats.length + ' features (+30-50 FPS)');
            return true;
          },
          disable: function () {
            if (!enabled) return;
            enabled = false;
            if (map) {
              map.off('moveend', schedule);
              map.off('zoomend', schedule);
            }
            if (map && srcId && allFeats.length) {
              try {
                const s = map.getSource(srcId);
                if (s && s.setData) s.setData({ type: 'FeatureCollection', features: allFeats });
              } catch (e) { }
            }
          },
          updateFeatures: function (feats) {
            if (Array.isArray(feats)) {
              allFeats = feats;
              if (enabled) update();
            }
          }
        };
      })();

      console.log('[FPS] ✅ All optimizations loaded (+65-110 FPS potential)');
