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

## 2. Google Gemini 3.8 Flash REST Contract & High-Availability Cascade

- **HTTP Method:** `POST`
- **URL Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:generateContent?key={API_KEY}`
- **High-Availability Cascade (`GEMINI_MODELS_CASCADE`):**
  1. `gemini-3.1-flash-lite` (thinkingLevel: MINIMAL)
  2. `gemini-2.5-flash-lite` (thinkingBudget: 0)
  3. `gemini-2.5-flash` (thinkingBudget: 0)
  4. `gemini-3.8-flash` (thinkingLevel: MINIMAL)
  5. `gemini-flash-latest`
- **Headers:** `Content-Type: application/json`
- **Timeout:** `12,000ms` per attempt (with `AbortSignal.timeout`)

### 2.1 Complete Request Payload with Native `responseSchema`:
```json
{
  "systemInstruction": {
    "parts": [{ "text": "You are CleanAir Guardian (VayuRakshak), an elite Environmental Health Scientist powered by Google Gemini 3.8 Flash. Output strict JSON matching the schema." }]
  },
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "### USER_CONTEXT_JSON\n{\"city\":\"Delhi-NCR\",\"aqi\":395,\"vulnBits\":3,\"cooking\":\"LPG\",\"heating\":\"space_heater\",\"commute\":\"two_wheeler\"}\n### END_USER_CONTEXT" }]
    }
  ],
  "generationConfig": {
    "temperature": 0.2,
    "topP": 0.85,
    "maxOutputTokens": 900,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "OBJECT",
      "properties": {
        "severityLevel": { "type": "STRING", "enum": ["GOOD", "MODERATE", "POOR", "VERY_POOR", "SEVERE", "HAZARDOUS"] },
        "diurnalWindowNotice": { "type": "STRING" },
        "hourlyRoutines": {
          "type": "ARRAY",
          "items": {
            "type": "OBJECT",
            "properties": {
              "timeSlot": { "type": "STRING" },
              "activity": { "type": "STRING" },
              "recommendation": { "type": "STRING" },
              "actionType": { "type": "STRING", "enum": ["SHIFT_INDOORS", "SAFE_VENTILATION", "SEAL_HOME", "COMMUTE_SHIELD"] }
            },
            "required": ["timeSlot", "activity", "recommendation", "actionType"]
          }
        },
        "iaqHack": {
          "type": "OBJECT",
          "properties": {
            "title": { "type": "STRING" },
            "materials": { "type": "ARRAY", "items": { "type": "STRING" } },
            "cadrEstimate": { "type": "STRING" },
            "costEstimate": { "type": "STRING" },
            "steps": { "type": "ARRAY", "items": { "type": "STRING" } }
          },
          "required": ["title", "materials", "cadrEstimate", "costEstimate", "steps"]
        },
        "sustainableAlternatives": {
          "type": "ARRAY",
          "items": {
            "type": "OBJECT",
            "properties": {
              "category": { "type": "STRING" },
              "currentChoice": { "type": "STRING" },
              "cleanAlternative": { "type": "STRING" },
              "benefit": { "type": "STRING" }
            },
            "required": ["category", "currentChoice", "cleanAlternative", "benefit"]
          }
        },
        "quantifiedImpact": {
          "type": "OBJECT",
          "properties": {
            "pm25InhalationAvoidedMicrograms": { "type": "NUMBER" },
            "cigaretteEquivalentsAvoided": { "type": "NUMBER" },
            "co2eSavedKg": { "type": "NUMBER" },
            "protectionScorePercent": { "type": "INTEGER" }
          },
          "required": ["pm25InhalationAvoidedMicrograms", "cigaretteEquivalentsAvoided", "co2eSavedKg", "protectionScorePercent"]
        },
        "communityAdvisory": { "type": "STRING" }
      },
      "required": ["severityLevel", "diurnalWindowNotice", "hourlyRoutines", "iaqHack", "sustainableAlternatives", "quantifiedImpact", "communityAdvisory"]
    }
  }
}
```

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
  quantifiedImpact: {
    pm25InhalationAvoidedMicrograms: number;
    cigaretteEquivalentsAvoided: number;
    co2eSavedKg: number;
    protectionScorePercent: number;
  };
  communityAdvisory: string;
}
```
