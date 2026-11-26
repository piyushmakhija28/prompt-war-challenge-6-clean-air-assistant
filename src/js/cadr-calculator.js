/**
 * @fileoverview Room CADR Clearance Calculator, Exponential Decay Calculus, and Haversine Geolocation.
 * Models indoor particulate decay C(t) = C0 * exp(-lambda * t), computes air changes per hour (ACH),
 * and calculates exact milestone minutes for 50%, 90%, and 99% air turnover.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module cadr-calculator
 */

/**
 * Standard Clean Air Delivery Rate (CADR) presets in Cubic Feet per Minute (CFM).
 * @readonly
 * @enum {number}
 */
export const CADR_PRESETS = Object.freeze({
  CORSI_ROSENTHAL_BOX: 273, // 4-filter MERV 13 box fan cube (ASHRAE standard)
  HEPA_PURIFIER_STANDARD: 120, // Standard residential bedroom HEPA cleaner
  PC_FAN_MINI_BOX: 85, // Ultra-quiet 12V 120mm computer fan DIY array
  COMMERCIAL_LARGE_HEPA: 450 // Heavy-duty dual-turbine commercial unit
});

/**
 * Dimensional unit conversion scalar factors.
 * @readonly
 */
export const UNIT_CONVERSIONS = Object.freeze({
  METERS_TO_FEET: 3.28084,
  FEET_TO_METERS: 0.3048,
  CU_METERS_TO_CU_FEET: 35.3147,
  CU_FEET_TO_CU_METERS: 0.0283168,
  CFM_TO_CU_METERS_PER_HR: 1.69901
});

/**
 * Calculates room volume, Air Changes per Hour (ACH), and particulate clearance milestone times.
 *
 * @param {Object} params
 * @param {number} params.length - Room length.
 * @param {number} params.width - Room width.
 * @param {number} params.height - Room ceiling height.
 * @param {'ft'|'m'} [params.unit='ft'] - Dimensional measurement unit.
 * @param {number} [params.cadrCfm=273] - Clean air delivery rate in CFM.
 * @returns {{ volumeCuFt: number, volumeCuM: number, achClean: number, achTotal: number, t50Min: number, t90Min: number, t99Min: number }}
 */
export function calculateRoomClearance({ length, width, height, unit = 'ft', cadrCfm = 273 }) {
  const safeLength = Math.max(1, Number(length) || 10);
  const safeWidth = Math.max(1, Number(width) || 10);
  const safeHeight = Math.max(1, Number(height) || 8);
  const safeCadr = Math.max(10, Number(cadrCfm) || 273);

  let volumeCuFt = 0;
  let volumeCuM = 0;

  if (unit === 'm') {
    volumeCuM = safeLength * safeWidth * safeHeight;
    volumeCuFt = volumeCuM * UNIT_CONVERSIONS.CU_METERS_TO_CU_FEET;
  } else {
    volumeCuFt = safeLength * safeWidth * safeHeight;
    volumeCuM = volumeCuFt * UNIT_CONVERSIONS.CU_FEET_TO_CU_METERS;
  }

  const achClean = (safeCadr * 60) / volumeCuFt;
  const naturalLossAch = 0.50;
  const achTotal = achClean + naturalLossAch;

  const t50Min = (0.693147 / achTotal) * 60;
  const t90Min = (2.302585 / achTotal) * 60;
  const t99Min = (4.605170 / achTotal) * 60;

  return {
    volumeCuFt: Math.round(volumeCuFt * 10) / 10,
    volumeCuM: Math.round(volumeCuM * 10) / 10,
    achClean: Math.round(achClean * 10) / 10,
    achTotal: Math.round(achTotal * 10) / 10,
    t50Min: Math.max(0.1, Math.round(t50Min * 10) / 10),
    t90Min: Math.max(0.2, Math.round(t90Min * 10) / 10),
    t99Min: Math.max(0.5, Math.round(t99Min * 10) / 10)
  };
}

/**
 * Computes great-circle geographical distance between two coordinates using the Haversine formula.
 *
 * @param {number} lat1 - Latitude 1 in degrees.
 * @param {number} lon1 - Longitude 1 in degrees.
 * @param {number} lat2 - Latitude 2 in degrees.
 * @param {number} lon2 - Longitude 2 in degrees.
 * @returns {number} Great-circle distance in kilometers.
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_KM = 6371.0;
  const toRadians = (deg) => (deg * Math.PI) / 180;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Discovers the closest predefined metro air basin to given latitude and longitude coordinates.
 *
 * @param {number} userLat - User latitude.
 * @param {number} userLon - User longitude.
 * @param {Object<string, {lat: number, lon: number}>} basinCoordinates - Map of basin names to coordinates.
 * @returns {{ name: string, distanceKm: number }} Closest basin record.
 */
export function findNearestBasin(userLat, userLon, basinCoordinates) {
  let closestName = 'Delhi NCR';
  let minDistance = Infinity;

  const entries = Object.entries(basinCoordinates);
  for (let i = 0; i < entries.length; i++) {
    const [name, coords] = entries[i];
    const dist = haversineDistanceKm(userLat, userLon, coords.lat, coords.lon);
    if (dist < minDistance) {
      minDistance = dist;
      closestName = name;
    }
  }

  return {
    name: closestName,
    distanceKm: Math.round(minDistance * 10) / 10
  };
}
