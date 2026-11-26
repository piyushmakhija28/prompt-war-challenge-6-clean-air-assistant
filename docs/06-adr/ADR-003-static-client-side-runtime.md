# ADR-003: Static Client-Side Single-Page Runtime on GitHub Pages

## Status
**ACCEPTED**

## Context
Deploying server-side architectures (Node.js/Express, Python/FastAPI, Docker containers) introduces deployment friction, cold starts, ongoing hosting costs, and complex setup steps for competition reviewers.

## Decision
We implement a **Pure Static Client-Side Single-Page Application (SPA)** using semantic HTML5, CSS custom properties, and standard ES6+ JavaScript, hosted on **GitHub Pages**.

## Consequences
### Positive
- **Instantaneous Judge Access:** Zero installation; runs directly from GitHub Pages or locally via `index.html`.
- **Zero Server Costs:** Completely serverless and free to host indefinitely for community benefit.
- **Zero Build Step:** Native browser ES6 module loading eliminates Webpack/Vite build steps and keeps repository size $< 1.5\text{ MB}$.

### Negative & Mitigated
- **Client-Side Secrets:** Mitigated by treating user API keys as volatile in-memory session tokens with zero backend transmission.
