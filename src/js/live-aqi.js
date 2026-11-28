/**
 * @fileoverview Real-time air quality feed backed by the Open-Meteo Air Quality API.
 * Fetches the current modelled PM2.5 for a coordinate, converts it to the application's
 * AQI scale, and keeps it fresh on a timer with latest-request-wins semantics.
 * Data licence: CC BY 4.0, attribution is rendered next to the value in the UI.
 * @module live-aqi
 */

import { METRO_BASIN_COORDINATES } from './config.js';
import { massConcentrationToAqi } from './impact-calculator.js';

export const OPEN_METEO_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const LIVE_AQI_REFRESH_MS = 15 * 60 * 1000;
export const LIVE_AQI_TIMEOUT_MS = 8000;

/**
 * Resolves the coordinate to query for the selected city.
 * Device coordinates take priority only while the selected city is the detected one.
 *
 * @param {Object} location - Selected location.
 * @param {string} location.city - City label currently shown in the UI.
 * @param {{lat: number, lon: number, city: string}|null} [location.detected] - Last geolocation fix.
 * @returns {{lat: number, lon: number}|null} Coordinate, or null for an unknown city.
 */
export function resolveCoordinates({ city, detected = null }) {
  if (detected && detected.city === city && Number.isFinite(detected.lat) && Number.isFinite(detected.lon)) {
    return { lat: detected.lat, lon: detected.lon };
  }
  const wanted = String(city || '').trim().toLowerCase();
  const key = Object.keys(METRO_BASIN_COORDINATES).find((name) => name.toLowerCase() === wanted);
  return key ? { ...METRO_BASIN_COORDINATES[key] } : null;
}

/**
 * Builds the request URL. Coordinates are rounded to two decimals (about 1 km) so that
 * a precise home position is never sent to the third party.
 *
 * @param {{lat: number, lon: number}} coordinates - Query position.
 * @returns {string} Fully qualified request URL.
 */
export function buildAirQualityUrl({ lat, lon }) {
  const params = new URLSearchParams({
    latitude: Number(lat).toFixed(2),
    longitude: Number(lon).toFixed(2),
    current: 'pm2_5,pm10',
    timezone: 'auto'
  });
  return `${OPEN_METEO_ENDPOINT}?${params.toString()}`;
}

/**
 * Validates an API payload and converts it into a reading.
 *
 * @param {Object} payload - Decoded JSON response.
 * @returns {Readonly<{aqi: number, pm25: number, pm10: number|null, observedAt: string}>}
 * @throws {Error} When PM2.5 is missing, non-numeric or negative.
 */
export function parseAirQualityResponse(payload) {
  const current = payload && payload.current;
  const pm25 = current ? current.pm2_5 : undefined;
  if (typeof pm25 !== 'number' || !Number.isFinite(pm25) || pm25 < 0) {
    throw new Error('Live air quality response did not contain a usable PM2.5 value');
  }
  return Object.freeze({
    aqi: massConcentrationToAqi(pm25),
    pm25,
    pm10: Number.isFinite(current.pm10) ? current.pm10 : null,
    observedAt: typeof current.time === 'string' ? current.time : ''
  });
}

/**
 * Performs one bounded request for the current air quality.
 *
 * @param {{lat: number, lon: number}} coordinates - Query position.
 * @param {Object} [options] - Transport overrides.
 * @param {Function} [options.fetchImpl] - Fetch implementation.
 * @param {number} [options.timeoutMs] - Abort deadline in milliseconds.
 * @param {AbortSignal} [options.signal] - Caller cancellation signal.
 * @returns {Promise<Readonly<{aqi: number, pm25: number, pm10: number|null, observedAt: string}>>}
 * @throws {Error} On timeout, network failure, non-2xx status or unusable payload.
 */
export async function fetchLiveAqi(coordinates, options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = LIVE_AQI_TIMEOUT_MS, signal } = options;
  if (signal?.aborted) throw new DOMException('Live air quality request was cancelled', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (signal) signal.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchImpl(buildAirQualityUrl(coordinates), {
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`Live air quality request failed with status ${response.status}`);
    }
    return parseAirQualityResponse(await response.json());
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

/**
 * Owns the live/manual mode, the refresh timer and request supersession.
 */
export class LiveAqiController {
  /**
   * @param {Object} deps - Collaborators.
   * @param {Function} deps.getLocation - Returns {city, detected} for the current selection.
   * @param {Function} deps.onReading - Receives each fresh reading.
   * @param {Function} deps.onStatus - Receives {mode, status, reading, message} on every change.
   * @param {Function} [deps.fetchImpl] - Fetch implementation.
   * @param {number} [deps.intervalMs] - Refresh period.
   * @param {number} [deps.timeoutMs] - Per-request deadline.
   */
  constructor({ getLocation, onReading, onStatus, fetchImpl, intervalMs = LIVE_AQI_REFRESH_MS, timeoutMs = LIVE_AQI_TIMEOUT_MS }) {
    this.getLocation = getLocation;
    this.onReading = onReading;
    this.onStatus = onStatus;
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.mode = 'live';
    this.lastReading = null;
    this.sequence = 0;
    this.inFlight = null;
    this.timer = null;
  }

  /**
   * Publishes the current mode and request status.
   *
   * @param {'loading'|'ok'|'error'|'unavailable'|'manual'} status - State to report.
   * @param {string} [message] - Human readable detail.
   */
  report(status, message = '') {
    this.onStatus({ mode: this.mode, status, reading: this.lastReading, message });
  }

  /**
   * Fetches a reading for the selected location. A newer call supersedes an older one,
   * and a switch to manual mode discards any response still in flight.
   *
   * @returns {Promise<boolean>} True when a reading was applied.
   */
  async refresh() {
    if (this.mode !== 'live') return false;
    const ticket = ++this.sequence;
    if (this.inFlight) this.inFlight.abort();
    this.inFlight = null;

    const coordinates = resolveCoordinates(this.getLocation());
    if (!coordinates) {
      this.lastReading = null;
      this.report('unavailable', 'No live feed for this location. Choose a listed city or detect your location.');
      return false;
    }

    const request = new AbortController();
    this.inFlight = request;
    this.report('loading');

    try {
      const reading = await fetchLiveAqi(coordinates, {
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        signal: request.signal
      });
      if (ticket !== this.sequence || this.mode !== 'live') return false;
      this.lastReading = Object.freeze({ ...reading, city: this.getLocation().city });
      this.onReading(this.lastReading);
      this.report('ok');
      return true;
    } catch (error) {
      if (ticket !== this.sequence || this.mode !== 'live') return false;
      this.report('error', 'Live air quality is unreachable. Showing the last known value.');
      console.warn('[CleanAir] Live AQI refresh failed:', error.message);
      return false;
    } finally {
      if (this.inFlight === request) this.inFlight = null;
    }
  }

  /**
   * Freezes the displayed AQI at a user supplied value until live mode is re-enabled.
   */
  setManual() {
    this.mode = 'manual';
    this.sequence++;
    if (this.inFlight) this.inFlight.abort();
    this.inFlight = null;
    this.report('manual');
  }

  /**
   * Returns to the live feed and refreshes immediately.
   *
   * @returns {Promise<boolean>} True when a reading was applied.
   */
  enableLive() {
    this.mode = 'live';
    return this.refresh();
  }

  /**
   * Starts periodic refreshing.
   */
  start() {
    this.stop();
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
  }

  /**
   * Stops periodic refreshing.
   */
  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
