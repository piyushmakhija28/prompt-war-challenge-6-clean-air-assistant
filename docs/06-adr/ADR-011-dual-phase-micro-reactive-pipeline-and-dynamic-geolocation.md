# ADR-011: Dual-Phase Micro-Reactive Pipeline & Dynamic Geolocation Engine

## Context & Problem Statement
During continuous user interaction (e.g. dragging the continuous 24-hour diurnal time scrubber, adjusting the AQI slider from 50 to 500, or modifying CADR room dimensions), two critical user experience defects arose:
1. **Realtime UI/UX Out-of-Sync Defect:**
   Prior architecture employed a naive boolean lock (`isGeneratingPlan`). While an external Gemini AI inference was in-flight (taking 2.0 to 10.0 seconds), all user input changes were silently dropped. When the API response returned, it overwrote newer local interactions with stale data from several seconds earlier.
2. **Missing Input Debounce & API Hammering:**
   Connecting live network recalculation directly to slider `'input'` events would emit 60 to 120 calls per continuous scrub, instantly exceeding Gemini free-tier rate limits (5 RPM / 15 RPM) and tripping the circuit breaker.
3. **Rigid Basin Dropdown Constraint:**
   The user was clamped to 8 hardcoded metro basin presets, with no capability to detect micro-localities (e.g. "Indirapuram, Ghaziabad" or "Whitefield, Bengaluru") or auto-localize without user prompts.

## Decision Drivers
- **Zero-Latency Perceived UX:** User interactions must yield immediate visual feedback within the 16.6ms frame budget (60 FPS).
- **API Quota & Token Safety:** External LLM calls must be throttled to human typing and settled slider pauses.
- **In-Flight Cancellation:** Superseded network requests must be cleanly aborted via `AbortController` without penalizing the circuit breaker.
- **Privacy-Preserving Geolocation:** Dynamic GPS coordinates must be truncated to 3 decimal places (~110m) and reverse geocoded via non-gated open endpoints with fallback to mathematical spherical air basins.

## Considered Alternatives
1. **Pure Request-Response (Manual Button Only):** Require the user to click "Generate Plan" after every change. *Rejected:* Degrades modern fluid web UX and causes frustration.
2. **Direct Asynchronous Stream-On-Input:** Fire Gemini API on every input event with debounce. *Rejected:* During the 250ms debounce window, the UI would remain visually stale.
3. **Dual-Phase Micro-Reactive Pipeline (Selected):**
   - **Phase 1 (Instant Synchronous Math < 5ms):** Instantly compute and render the deterministic plan (`generateOfflineCleanAirPlan`) coalesced via `requestAnimationFrame`.
   - **Phase 2 (Debounced AI Refinement at $\tau = 250\text{ms}$):** When an active Gemini API key exists, dispatch an asynchronous LLM request with `AbortController` preemption, monotonic sequence counters, and a trailing execution queue.

## Decision Details
1. **Dual-Tier Location Architecture:**
   - **Micro-Location:** User-facing neighborhood/city (`state.city`), reverse-geocoded via OpenStreetMap Nominatim and BigDataCloud client APIs with 2,000ms timeout.
   - **Macro-Airshed Basin:** Meteorological reference (`state.nearestBasin`), resolved via spherical Haversine formula (`findNearestBasin`) against `METRO_BASIN_COORDINATES` for diurnal inversion physics and bitstream encoding.
2. **Zero-Prompt Boot Discovery:**
   - On page load, `checkGeolocationPermission()` inspects `navigator.permissions.query({ name: 'geolocation' })`.
   - If permission is already `'granted'`, `detectUserLocation({ isSilent: true })` transparently updates the detected location into `<optgroup id="optgroup-detected">` without showing permission prompts.
3. **Concurrency & Preemption State Machine:**
   - Active fetches hold an `AbortController`. If a new generation is triggered, `activeAbortController.abort('SUPERSEDED')` terminates the in-flight HTTP request.
   - The cascade loop in `gemini-service.js` catches `AbortError` and immediately rethrows without cycling through fallback models or recording failures in `CircuitBreaker`.
   - Monotonic `generationSequenceId` ensures out-of-order network responses are discarded.

## Consequences & Verification
- **Positive:** UI updates synchronously at 60 FPS on every keystroke and slider movement with 0ms perceived lag.
- **Positive:** Gemini rate limits are safeguarded by the 250ms debounce window; token consumption drops by over 90% during slider scrubbing.
- **Positive:** Custom and detected cities are losslessly serialized into Base64URL URL hash tokens (`#v1=...`), surviving page refreshes and social sharing.
- **Verification:** Unit tests `TC-DEB-001`, `TC-OPT-001`, `TC-RACE-001`, `TC-GEO-003`, `TC-GEO-004`, `TC-CODEC-003` and browser tests `BR-TEST-010`, `BR-TEST-011`, `BR-TEST-012` validate invariant compliance.
