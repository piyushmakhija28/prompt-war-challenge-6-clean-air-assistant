# API & Component Contract Specification
## CleanAir Guardian (VayuRakshak) — Interface & Schema Architecture

**Document Identifier:** API-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 1  
**Lead Authors:** `solution-architect` & `prompt-generation-expert`  

---

## 1. Google Gemini 3.8 Flash REST Contract

### 1.1 Endpoint & Authentication
- **HTTP Method:** `POST`
- **URL Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={API_KEY}`
- **Headers:**
  ```http
  Content-Type: application/json
  ```

### 1.2 Request Payload Schema (Draft-07 Compliant)
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "### USER_CONTEXT_JSON\n{\n  \"city\": \"Delhi-NCR\",\n  \"aqi\": 395,\n  \"vulnerabilities\": [\"infant\", \"asthma\"],\n  \"cookingMethod\": \"LPG\",\n  \"heatingMethod\": \"space_heater\",\n  \"commuteMode\": \"two_wheeler\"\n}"
        }
      ]
    }
  ],
  "systemInstruction": {
    "parts": [
      {
        "text": "You are CleanAir Guardian (VayuRakshak)... [Full agent.md instruction]"
      }
    ]
  },
  "generationConfig": {
    "temperature": 0.3,
    "topP": 0.85,
    "responseMimeType": "application/json"
  }
}
```

---

## 2. Structured JSON Output Schema

Enforced via Gemini's `responseMimeType: "application/json"`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CleanAirActionPlan",
  "type": "object",
  "required": [
    "severityLevel",
    "diurnalWindowNotice",
    "hourlyRoutines",
    "iaqHack",
    "sustainableAlternatives",
    "quantifiedImpact",
    "communityAdvisory"
  ],
  "properties": {
    "severityLevel": {
      "type": "string",
      "enum": ["GOOD", "MODERATE", "POOR", "VERY_POOR", "SEVERE", "HAZARDOUS"]
    },
    "diurnalWindowNotice": {
      "type": "string",
      "description": "Specific guidance on morning/evening smog trap and afternoon dispersal window."
    },
    "hourlyRoutines": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["timeSlot", "activity", "recommendation", "actionType"],
        "properties": {
          "timeSlot": { "type": "string" },
          "activity": { "type": "string" },
          "recommendation": { "type": "string" },
          "actionType": { "type": "string", "enum": ["SHIFT_INDOORS", "SAFE_VENTILATION", "SEAL_HOME", "COMMUTE_SHIELD"] }
        }
      }
    },
    "iaqHack": {
      "type": "object",
      "required": ["title", "materials", "cadrEstimate", "costEstimate", "steps"],
      "properties": {
        "title": { "type": "string" },
        "materials": { "type": "array", "items": { "type": "string" } },
        "cadrEstimate": { "type": "string" },
        "costEstimate": { "type": "string" },
        "steps": { "type": "array", "items": { "type": "string" } }
      }
    },
    "sustainableAlternatives": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["category", "currentChoice", "cleanAlternative", "benefit"],
        "properties": {
          "category": { "type": "string" },
          "currentChoice": { "type": "string" },
          "cleanAlternative": { "type": "string" },
          "benefit": { "type": "string" }
        }
      }
    },
    "quantifiedImpact": {
      "type": "object",
      "required": [
        "pm25InhalationAvoidedMicrograms",
        "cigaretteEquivalentsAvoided",
        "co2eSavedKg",
        "protectionScorePercent"
      ],
      "properties": {
        "pm25InhalationAvoidedMicrograms": { "type": "number" },
        "cigaretteEquivalentsAvoided": { "type": "number" },
        "co2eSavedKg": { "type": "number" },
        "protectionScorePercent": { "type": "number", "minimum": 0, "maximum": 100 }
      }
    },
    "communityAdvisory": {
      "type": "string",
      "description": "Ready-to-copy WhatsApp/RWA advisory announcement."
    }
  }
}
```

---

## 3. TypeScript Interface Contracts

```typescript
export interface UserContext {
  city: string;
  aqi: number;
  vulnerabilities: Array<'infant' | 'asthma' | 'senior' | 'pregnant' | 'outdoor'>;
  cookingMethod: 'induction' | 'png' | 'lpg' | 'biomass';
  heatingMethod: 'electric_radiator' | 'space_heater' | 'heat_pump' | 'open_fire';
  commuteMode: 'private_car' | 'two_wheeler' | 'public_transit' | 'walk_cycle';
}

export interface HourlyRoutine {
  timeSlot: string;
  activity: string;
  recommendation: string;
  actionType: 'SHIFT_INDOORS' | 'SAFE_VENTILATION' | 'SEAL_HOME' | 'COMMUTE_SHIELD';
}

export interface IAQHack {
  title: string;
  materials: string[];
  cadrEstimate: string;
  costEstimate: string;
  steps: string[];
}

export interface SustainableAlternative {
  category: string;
  currentChoice: string;
  cleanAlternative: string;
  benefit: string;
}

export interface ImpactMetrics {
  pm25InhalationAvoidedMicrograms: number;
  cigaretteEquivalentsAvoided: number;
  co2eSavedKg: number;
  protectionScorePercent: number;
}

export interface CleanAirActionPlan {
  severityLevel: 'GOOD' | 'MODERATE' | 'POOR' | 'VERY_POOR' | 'SEVERE' | 'HAZARDOUS';
  diurnalWindowNotice: string;
  hourlyRoutines: HourlyRoutine[];
  iaqHack: IAQHack;
  sustainableAlternatives: SustainableAlternative[];
  quantifiedImpact: ImpactMetrics;
  communityAdvisory: string;
}
```

---

## 4. URL Hash State Codec Specification (`#v1=...`)

### 4.1 Schema Encoding
To ensure stateless zero-database sharing across users, families, and evaluators:
1. `UserContext` JSON object is serialized to a compact string:
   `city|aqi|vuln_bits|cook|heat|commute`
   - `vuln_bits`: 5-bit integer bitfield representing selected vulnerabilities.
2. String is compressed and Base64URL-encoded (using characters `[A-Za-z0-9-_]`).
3. Appended to URL hash: `https://.../index.html#v1=RGVsaGl8Mzk1fDN8M3wyfDE`
4. Total URL byte footprint: $< 120\text{ bytes}$.
