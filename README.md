# LOCUS

Image geolocation assistant for fact-checkers and OSINT researchers, by [Provereno](https://provereno.media/).

LOCUS sends an image to Google Gemini with Google Maps or Google Search grounding and returns a location hypothesis with the evidence, the queries Google actually executed and the sources it used. The result is a hypothesis for manual verification, not a confirmed location.

## How it works

- **Free tier (BYOK).** Runs entirely in the browser. Each user enters their own Gemini API key in Settings; the browser calls the Gemini API directly. Provereno servers never receive images or keys. See [ADR-001](docs/adr/ADR-001-access-tiers.md).
- **Pro tier** (planned) will use a Provereno-managed key through a server proxy. Both tiers share the `GeoProvider` interface in `src/services/geo`.

Privacy note: on Google's free tier, submitted content may be used to improve Google products and may be reviewed by humans. Use a billing-enabled key for sensitive material.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm test
npm run build      # static files in dist/
```

## Structure

```
src/
  App.tsx                         UI (to be split into components, task U5)
  components/                     UI components
  lib/coords.ts                   coordinate formatting
  services/config.ts              settings, model list, local storage
  services/geo/
    types.ts                      GeoProvider interface and result types
    directGeminiProvider.ts       Free tier: browser -> Gemini API
    prompt.ts                     analysis prompt and chat instruction
    schema.ts                     zod validation of model output
    grounding.ts                  sources and queries from grounding metadata
    errors.ts                     error mapping
```

## Deployment

`npm run build` produces a static site in `dist/` with relative asset paths; any static host works, at the domain root or under a sub-path.

**GitHub Pages.** `.github/workflows/deploy-pages.yml` runs typecheck, tests and build on every push to `main` and publishes `dist/`. One-time setup: Settings → Pages → Source: *GitHub Actions*. GitHub Pages cannot send custom HTTP headers, so the CSP below applies only as `<meta>` and `frame-ancestors` is unavailable; the app refuses to render inside a frame instead.

The build injects a Content Security Policy as a `<meta>` tag (`CONTENT_SECURITY_POLICY` in `vite.config.ts`). The host should also send it as an HTTP header, adding `frame-ancestors 'none'`, which browsers ignore in `<meta>`:

```
Content-Security-Policy: <value of CONTENT_SECURITY_POLICY>; frame-ancestors 'none'
```

When adding a new external service (map tiles, API endpoints, fonts), update the policy, or the browser will block it.
