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
  CORSI_ROSENTHAL_BOX: 273,
  HEPA_PURIFIER_STANDARD: 120,
  PC_FAN_MINI_BOX: 85,
  COMMERCIAL_LARGE_HEPA: 450,
  WET_TOWEL_EMERGENCY: 30,
  KITCHEN_VENT_SCRUB: 180
});

/**
 * Dimensional unit conversion scalar factors.
 * @readonly
 */
export const UNIT_CONVERSIONS = Object.freeze({
  METERS_TO_FEET: 3.28084,
  FEET_TO_METERS: 0.3048,
  M_TO_FT: 3.28084,
  FT_TO_M: 0.3048,
  CU_METERS_TO_CU_FEET: 35.3147,
  CU_FEET_TO_CU_METERS: 0.0283168,
  M3_TO_FT3: 35.3147,
  FT3_TO_M3: 0.0283168,
  CFM_TO_CU_METERS_PER_HR: 1.69901
});

/**
 * Evaluates air changes per hour (ACH) against CDC and ASHRAE respiratory infection and air turnover standards.
 *
 * @param {number} achTotal - Total combined air changes per hour (mechanical CADR + ambient deposition).
 * @returns {{ rating: 'POOR'|'MODERATE'|'RECOMMENDED'|'EXCELLENT', label: string, color: string, benchmark: string }}
 */
export function getCadrAdequacyRating(achTotal) {
  const ach = Math.max(0, Number(achTotal) || 0);
  if (ach < 3.0) {
    return {
      rating: 'POOR',
      label: 'Inadequate (<3 ACH)',
      color: '#ef4444',
      benchmark: 'Below baseline: particulates remain suspended for hours'
    };
  }
  if (ach < 6.0) {
    return {
      rating: 'MODERATE',
      label: 'Basic Residential (3-5 ACH)',
      color: '#f59e0b',
      benchmark: 'Acceptable baseline for low-risk living spaces'
    };
  }
  if (ach < 12.0) {
    return {
      rating: 'RECOMMENDED',
      label: 'CDC Target (6-11 ACH)',
      color: '#10b981',
      benchmark: 'Meets CDC/ASHRAE guideline for high-efficiency infection control'
    };
  }
  return {
    rating: 'EXCELLENT',
    label: 'Clinic Grade (12+ ACH)',
    color: '#38bdf8',
    benchmark: 'Hospital isolation / surgical grade clearance turnover'
  };
}

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
