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
| **Denial of**     | Runaway loop exhausting    | MED      | 8,000ms AbortController timeout ceiling;    |
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
