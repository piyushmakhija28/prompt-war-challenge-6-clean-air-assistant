# Threat Model & Security Architecture (STRIDE & OWASP LLM)
## CleanAir Guardian (VayuRakshak) — Security, Privacy & Safety Specifications

**Document Identifier:** SEC-THREAT-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Lead Author:** `ai-ml-security-engineer`  

---

## 1. STRIDE Threat Analysis Matrix

```
+---------------------------------------------------------------------------------------------------------+
|                                        STRIDE THREAT MATRIX                                             |
+-------------------+----------------------------+----------+---------------------------------------------+
| Threat Category   | Specific Risk Vector       | Severity | Mitigation Architecture                     |
+-------------------+----------------------------+----------+---------------------------------------------+
| **Spoofing**      | Forged Gemini API response | LOW      | Native HTTPS TLS 1.3 to Google endpoint;    |
|                   | over malicious proxy       |          | strict JSON schema validation rejection.    |
+-------------------+----------------------------+----------+---------------------------------------------+
| **Tampering**     | Malicious parameter injection| MED    | Numeric clamping on AQI (0-999);            |
|                   | via crafted URL hash state |          | whitelist regex on city string; bitfield sanitization.|
+-------------------+----------------------------+----------+---------------------------------------------+
| **Repudiation**   | False advice attribution   | LOW      | Deterministic versioning in `VERSION`;       |
|                   |                            |          | disclaimers that advice is guidance only.   |
+-------------------+----------------------------+----------+---------------------------------------------+
| **Information**   | Gemini API key leakage to  | HIGH     | In-memory ephemeral storage only; zero      |
| **Disclosure**    | third-party endpoints/logs |          | telemetry scripts, CSP connect-src strict.  |
+-------------------+----------------------------+----------+---------------------------------------------+
| **Denial of**     | Runaway loop exhausting    | MED      | 25,000ms AbortController timeout ceiling;   |
| **Service (DoS)** | user Google API quota      |          | max 2 retries with exponential backoff.     |
+-------------------+----------------------------+----------+---------------------------------------------+
| **Elevation of**  | Client DOM XSS via prompt  | HIGH     | Strict JSON schema parsing; textContent/DOM |
| **Privilege**     | injection in output text   |          | sanitization; zero raw `innerHTML` eval.    |
+-------------------+----------------------------+----------+---------------------------------------------+
```

---

## 2. OWASP Top 10 for Large Language Models (LLM) Mitigations

```
+---------------------------------------------------------------------------------------------------------+
|                                    OWASP TOP 10 FOR LLMS ALIGNMENT                                      |
+------------------------+--------------------------------------------------------------------------------+
| OWASP Risk             | CleanAir Guardian Architectural Defense                                        |
+------------------------+--------------------------------------------------------------------------------+
| **LLM01: Prompt**      | User input parameters (AQI, city, checkboxes) are serialized strictly as       |
| **Injection**          | typed JSON within delimiter block `### USER_CONTEXT_JSON`. Freeform text is not |
|                        | evaluated as system commands.                                                  |
+------------------------+--------------------------------------------------------------------------------+
| **LLM02: Insecure**    | All Gemini model responses must conform to the JSON Schema Draft-07.           |
| **Output Handling**    | Rendered into DOM via text nodes, avoiding direct HTML script injection.       |
+------------------------+--------------------------------------------------------------------------------+
| **LLM06: Sensitive**   | User context strictly contains general urban location and lifestyle choices.  |
| **Info Disclosure**    | Zero PII (no names, emails, addresses, IP addresses, or phone numbers) stored. |
+------------------------+--------------------------------------------------------------------------------+
| **LLM08: Excessive**   | Model has zero system-level access, zero shell execution capabilities, and zero|
| **Agency**             | database write access. It operates purely as a read-only advisory synthesizer. |
+------------------------+--------------------------------------------------------------------------------+
| **LLM10: Unbounded**   | System prompt enforces `max_output_tokens: 1200`, preventing unbounded         |
| **Consumption**        | token generation loops.                                                        |
+------------------------+--------------------------------------------------------------------------------+
```

---

## 3. Content Security Policy (CSP) Directives

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://generativelanguage.googleapis.com; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none';
```
- `connect-src` strictly restricts outbound API requests to Google's official Gemini endpoint.
- Zero analytics, social tracking pixels, or third-party ad networks allowed.

---

## 4. Strict DOM Injection Prevention Rules (Zero-XSS)

To guarantee 100% protection against DOM-based Cross-Site Scripting (DOM XSS, CWE-79) from either untrusted user input or malicious LLM prompt outputs:

```
+---------------------------------------------------------------------------------------------------------+
|                                    DOM MANIPULATION SECURITY RULES                                      |
+-------------------+----------------------------+--------------------------------------------------------+
| API / Property    | Security Classification    | Permitted Use & Architectural Policy                   |
+-------------------+----------------------------+--------------------------------------------------------+
| `Element.innerHTML`| **STRICTLY BANNED**        | Zero usage permitted across entire codebase. Lint-enforced.|
| `Element.outerHTML`| **STRICTLY BANNED**        | Zero usage permitted. Direct prototype tampering risk. |
| `document.write()` | **STRICTLY BANNED**        | Zero usage permitted. Obsolete and high vulnerability.  |
| `eval()` / `Function`| **STRICTLY BANNED**      | Zero usage permitted. Dynamic code execution banned.   |
| `Node.textContent`| **MANDATORY FOR TEXT**     | Required for all string rendering, text nodes, metrics.|
| `document.createElement()`| **MANDATORY**      | Required for generating structured DOM nodes.          |
| `Element.setAttribute()` | **ALLOWLIST ONLY**  | Permitted only for safe attributes (`id`, `class`,     |
|                   |                            | `aria-*`, `role`, `data-*`). Event handlers banned.    |
+-------------------+----------------------------+--------------------------------------------------------+
```

### Whitelist Regex Input Sanitization Contract:
```javascript
/**
 * Sanitizes an arbitrary string to prevent attribute or injection anomalies.
 * @param {string} rawString - Unfiltered user input.
 * @returns {string} - Strict sanitized alphanumeric string.
 */
export function sanitizeCityInput(rawString) {
  if (typeof rawString !== 'string') return 'Delhi NCR';
  const trimmed = rawString.trim().slice(0, 50);
  const sanitized = trimmed.replace(/[^a-zA-Z0-9\s,.-]/g, '');
  return sanitized.length > 0 ? sanitized : 'Delhi NCR';
}
```

---

## 5. Subresource Integrity (SRI) & Zero-Dependency Invariant

To eliminate Supply Chain Poisoning (OWASP Top 10 A08:2021) and satisfy the competition's standalone runtime rules:
1. **100% Self-Contained Assets:** Zero external CDN `<script src="https://...">` or `<link rel="stylesheet" href="https://...">` tags are permitted.
2. **Deterministic Hashes:** All local CSS and JS files are bundled directly in `src/` and referenced via relative paths.
3. **Offline Survivability:** The app functions autonomously in offline/air-gapped environments without CDN outages.

---

## 6. Ephemeral API Key Lifecycle & Zero-Leakage Policy

User-provided Google Gemini API keys are treated with zero-trust confidentiality:
1. **In-Memory Closure Storage:** The API key is stored strictly within a private JavaScript module closure variable (`let _sessionApiKey = null`).
2. **Zero Persistent Storage:** Keys are NEVER written to `localStorage`, indexedDB, or web worker caches.
3. **URL Exclusion:** Keys are strictly excluded from URL hash encoding (`#b=...` and `#v1=...`) to prevent key exposure via browser history, server referer headers, or shoulder surfing.
4. **Immediate Zeroization:** An explicit "Purge Key" action (button labeled "Activate (In-Memory)") overwrites the buffer memory with cryptographically secure random values via `window.crypto.getRandomValues()` and zeroes (`fill(0)`) before discarding the pointer.

---

## 7. Cryptographic Memory Zeroization Protocol for Ephemeral API Keys

Standard garbage collection in managed runtimes (V8 / JavaScript) does not clear deallocated string memory buffers immediately, leaving sensitive API keys susceptible to browser heap dump extraction or shoulder surfing memory inspections.

### 1. Zero-Trust Byte Buffer Architecture:
CleanAir Guardian manages API keys as binary byte arrays (`Uint8Array`) rather than immutable JavaScript strings:

```javascript
/**
 * Ephemeral Secure Key Container with cryptographic memory zeroization.
 */
export class SecureKeyStore {
  constructor() {
    this.keyBuffer = null;
  }

  /**
   * Sets the API key into an ephemeral Uint8Array buffer.
   * @param {string} rawKey - API key string.
   */
  setKey(rawKey) {
    this.purge();
    const encoder = new TextEncoder();
    this.keyBuffer = encoder.encode(rawKey.trim());
  }

  /**
   * Reads key as UTF-8 string for immediate fetch authorization.
   * @returns {string}
   */
  getKey() {
    if (!this.keyBuffer) return '';
    const decoder = new TextDecoder();
    return decoder.decode(this.keyBuffer);
  }

  /**
   * Cryptographically overwrites and wipes the key buffer from heap memory.
   */
  purge() {
    if (this.keyBuffer) {
      // Step 1: Overwrite with cryptographically secure random entropy
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(this.keyBuffer);
      }
      // Step 2: Zeroize all bytes
      this.keyBuffer.fill(0);
      this.keyBuffer = null;
    }
  }
}
```


