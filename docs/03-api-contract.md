# API & Component Contract Specification
## CleanAir Guardian (VayuRakshak) — Interface, Token Budget LP & RFC 4648 Base64URL

**Document Identifier:** API-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Lead Authors:** `solution-architect`, `prompt-generation-expert` & `context-engineering-agent`  

---

## 1. Token Budget Linear Program (LP) & Memory Footprint

To ensure sub-second Time to First Token (TTFT) and prevent memory-bound GPU degradation, the prompt lifecycle is governed by an explicit **Token Budget Linear Program**:

$$\text{Minimize } \text{Latency} \quad \text{subject to: } \text{Tokens}_{\text{system}} + \text{Tokens}_{\text{context}} + \text{Tokens}_{\text{output}} \le 2,000\text{ tokens}$$

```
+---------------------------------------------------------------------------------------------------------+
|                                    TOKEN BUDGET ALLOCATION TABLE                                        |
+--------------------------+-----------------------+---------------------+--------------------------------+
| Component                | Budget Ceiling        | Actual Tokens       | Allocation Breakdown           |
+--------------------------+-----------------------+---------------------+--------------------------------+
| **System Instructions**  | 500 tokens            | ~420 tokens         | Persona rules, diurnal times   |
| **User Context Payload** | 400 tokens            | ~280 tokens         | Sanitized typed JSON block     |
| **Few-Shot Anchor**      | 550 tokens            | ~480 tokens         | 1 worked input-output pair     |
| **Model Output Window**  | 1,200 tokens          | ~780 tokens         | Full CleanAirActionPlan JSON   |
+--------------------------+-----------------------+---------------------+--------------------------------+
| **Total Call Footprint** | **2,650 tokens**      | **~1,960 tokens**   | **0.19% of Gemini 1M Context** |
+--------------------------+-----------------------+---------------------+--------------------------------+
```

---

## 2. Google Gemini 3.8 Flash REST Contract

- **HTTP Method:** `POST`
- **URL Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={API_KEY}`
- **Headers:** `Content-Type: application/json`

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
  quantifiedImpact: {
    pm25InhalationAvoidedMicrograms: number;
    cigaretteEquivalentsAvoided: number;
    co2eSavedKg: number;
    protectionScorePercent: number;
  };
  communityAdvisory: string;
}
```
