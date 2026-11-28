# API & Component Contract Specification
## CleanAir Guardian (VayuRakshak) — Interface, Token Budget LP & RFC 4648 Base64URL

**Document Identifier:** API-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Lead Authors:** `solution-architect`, `prompt-generation-expert` & `context-engineering-agent`  

---

## 1. Request Budget

| Limit | Value |
|-------|-------|
| `maxOutputTokens` | 4096 |
| Overall time budget per generation | 45,000 ms |
| Smallest remaining budget that starts another model | 5,000 ms |
| Client rate limit | burst of 3, refilled at 5 per minute |
| Circuit breaker | opens after 2 failed generations, one probe after 30 s |
| Input debounce | 800 ms |
| Automatic retries | at most 3, delay of at most 120 s |

---

## 2. Google Gemini REST Contract and Model Cascade

- **Method and URL:** `POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:generateContent`
- **Headers:** `Content-Type: application/json`, `x-goog-api-key: <key held in memory>`. The key never appears in a URL or body. Redirects are refused.
- **Cascade and per-attempt deadline** (`GEMINI_MODELS_CASCADE`, `GEMINI_MODEL_TIMEOUTS`):

| Order | Model | Deadline | `thinkingLevel` |
|-------|-------|----------|-----------------|
| 1 | `gemini-3.5-flash-lite` | 15 s | LOW |
| 2 | `gemini-flash-lite-latest` | 15 s | not sent |
| 3 | `gemini-3.1-flash-lite` | 15 s | LOW |
| 4 | `gemini-3.8-flash` | 25 s | LOW |
| 5 | `gemini-flash-latest` | 18 s | not sent |

### 2.1 Request Payload

`systemInstruction` is `GEMINI_SYSTEM_INSTRUCTION`. The user part wraps a data-only block:

```json
{
  "city": "Delhi NCR",
  "aqi": 364,
  "aqiSource": "live",
  "housingType": "standard_flat",
  "cookingMethod": "lpg",
  "heatingMethod": "space_heater",
  "commuteMode": "two_wheeler",
  "commuteKm": 14,
  "vulnerabilities": ["infant", "asthma or COPD"],
  "computed": {
    "pm25UgM3": 0, "unshieldedDoseUg": 0, "protectedDoseUg": 0, "pm25AvoidedUg": 0,
    "cigarettesAvoided": 0, "carbonSavedKg": 0, "protectionScore": 0
  }
}
```

The `computed` values above are placeholders; the application fills them from `computeImpact`. No coordinates, previous plan or key is included.

`generationConfig`: `temperature` 0.2, `topP` 0.85, `maxOutputTokens` 4096, `responseMimeType` `application/json`, and this schema:

| Field | Type | Required |
|-------|------|----------|
| `hourlyRoutines[]` with `timeSlot`, `activity`, `recommendation`, `actionType` | array | yes |
| `actionType` | `SHIFT_INDOORS`, `SAFE_VENTILATION`, `SEAL_HOME`, `COMMUTE_SHIELD` | yes |
| `communityAdvisory` (English) | string | yes |
| `communityAdvisoryHi` (Devanagari) | string | no |

### 2.2 Response Handling

Text containing markup, links or application-owned figures (mass, percentage, cigarette count, AQI value) is rejected. A reply with no usable routine counts as a failed attempt. A missing advisory falls back to the on-device advisory in that language. All other plan fields come from the on-device engine.

| Condition | Behaviour | Strategy |
|-----------|-----------|----------|
| 401, 403, or 400 naming the API key | stop at once; no further calls until a key is saved | `OFFLINE_KEY_REJECTED` |
| 429 | try next model; then wait for the server delay (12 s floor, 30 s default) | `OFFLINE_RATE_LIMITED` |
| 408, 5xx, timeout, unusable reply | try next model; then count one breaker failure | `OFFLINE_FALLBACK` |
| Other 400, 404 | try next model | `OFFLINE_FALLBACK` |
| Prompt blocked | stop | `OFFLINE_BLOCKED` |
| Device offline | stop; retry on the `online` event | `OFFLINE_NETWORK` |
| Breaker open | no request | `OFFLINE_CIRCUIT_OPEN` |
| Success | advice shown | `GEMINI_<MODEL>` |

### 2.3 Open-Meteo Air Quality Contract

- `GET https://air-quality-api.open-meteo.com/v1/air-quality?latitude=..&longitude=..&current=pm2_5,pm10&timezone=auto`
- Coordinates are rounded to two decimals. Deadline 8 s, refresh every 15 minutes.
- Used fields: `current.pm2_5` (required, non-negative number), `current.pm10`, `current.time`.
- Licence CC BY 4.0 with attribution in the UI; the free tier is for non-commercial use. Values are modelled hourly estimates.

---

## 3. RFC 4648 §5 Base64URL State Codec Specification

To ensure state strings shared across messaging platforms (WhatsApp, SMS, Telegram) are never broken by character encoding or trailing padding truncation:

### 3.1 Delimited Serialization Format
$$\text{Payload} = \text{city}|\text{aqi}|\text{vulnBits}|\text{cookIdx}|\text{heatIdx}|\text{commuteIdx}|\text{timeSimHour}$$
- `vulnBits`: Single integer ($0 - 31$) encoding the 5-bit bitfield.
- `cookIdx`: Integer ($0 - 3$).
- `heatIdx`: Integer ($0 - 3$).
- `commuteIdx`: Integer ($0 - 3$).
- `timeSimHour`: Float rounded to 1 decimal place ($0.0 - 23.9$).

### 3.2 Encoding & Decoding Mathematical Functions
```javascript
/**
 * Encodes string to URL-safe Base64URL (RFC 4648 §5) without padding.
 * @param {string} str - Raw string.
 * @returns {string} URL-safe Base64 string.
 */
export function encodeBase64URL(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes URL-safe Base64URL string back to raw string.
 * @param {string} b64url - Base64URL string.
 * @returns {string} Decoded original string.
 */
export function decodeBase64URL(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Re-pad to multiple of 4
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  return decodeURIComponent(escape(atob(b64)));
}
```

### 3.3 5-Byte Packed Binary Bitstream Codec (Ultra-Compact 7-Char URL Hash)

For systems-level efficiency, the application also implements a high-density binary serializer that packs all 7 household parameters into exactly **40 bits (5 bytes)**:

```
 Byte 0        Byte 1        Byte 2        Byte 3        Byte 4
[8 bits]      [8 bits]      [8 bits]      [8 bits]      [8 bits]
+-------------------------------------------------------------+
| Bits 0-9   (10 bits): AQI (0 - 1023)                         |
| Bits 10-14 (5 bits) : Vulnerability Bitfield (0 - 31)       |
| Bits 15-16 (2 bits) : Cooking Method Index (0 - 3)          |
| Bits 17-18 (2 bits) : Heating Method Index (0 - 3)          |
| Bits 19-20 (2 bits) : Commute Mode Index (0 - 3)            |
| Bits 21-27 (7 bits) : Commute Distance in km (0 - 127)      |
| Bits 28-32 (5 bits) : City Basin Preset ID (0 - 31)         |
| Bits 33-37 (5 bits) : Simulated Hour (0 - 23)               |
| Bits 38-39 (2 bits) : Parity Check Bits                     |
+-------------------------------------------------------------+
```
- **Total Payload Size:** Exactly $5\text{ bytes}$ (`Uint8Array(5)`).
- **Base64URL Hash Size:** Exactly **7 characters** (e.g. `#b=A3fZ9qA`).
- **Lossless fallback:** when a profile cannot be represented in 40 bits (for example a non-preset city or housing type), the `v1=` form is used and also carries `commuteKm` and the housing type index.
- **Live suffix:** `&live=1` marks that the AQI follows the live feed. Links without it open in manual mode with the shared AQI.
- **Network Overhead:** $0.00\text{ KB}$ network payload; instant zero-allocation decoding via `DataView`.


---

## 4. TypeScript Interface Contracts

```typescript
export interface UserContext {
  city: string;
  aqi: number;
  vulnBits: number; // 5-bit integer
  cookingMethod: 'induction' | 'png' | 'lpg' | 'biomass';
  heatingMethod: 'electric_radiator' | 'space_heater' | 'heat_pump' | 'open_fire';
  commuteMode: 'private_car' | 'two_wheeler' | 'public_transit' | 'walk_cycle';
  simulatedHour: number;
}

export interface CleanAirActionPlan {
  severityLevel: 'GOOD' | 'MODERATE' | 'POOR' | 'VERY_POOR' | 'SEVERE' | 'HAZARDOUS';
  diurnalWindowNotice: string;
  hourlyRoutines: Array<{
    timeSlot: string;
    activity: string;
    recommendation: string;
    actionType: 'SHIFT_INDOORS' | 'SAFE_VENTILATION' | 'SEAL_HOME' | 'COMMUTE_SHIELD';
  }>;
  iaqHack: {
    title: string;
    materials: string[];
    cadrEstimate: string;
    costEstimate: string;
    steps: string[];
  };
  sustainableAlternatives: Array<{
    category: string;
    currentChoice: string;
    cleanAlternative: string;
    benefit: string;
  }>;
  bilingualAdvisory?: { en: string; hi: string };
  quantifiedImpact: {
    pm25InhalationAvoidedMicrograms: number;
    cigaretteEquivalentsAvoided: number;
    co2eSavedKg: number;
    protectionScorePercent: number;
  };
  communityAdvisory: string;
}
```
