# LOCUS

Image geolocation assistant for fact-checkers and OSINT researchers, by [Provereno](https://provereno.media/).

LOCUS sends an image to Google Gemini with Google Maps or Google Search grounding and returns a location hypothesis with the evidence, the queries Google actually executed and the sources it used. The result is a hypothesis for manual verification, not a confirmed location.

## How it works

- **Free tier (BYOK).** Runs entirely in the browser. Each user enters their own Gemini API key in Settings; the browser calls the Gemini API directly. Provereno servers never receive images or keys. See [ADR-001](docs/adr/ADR-001-access-tiers.md).

  **LOCUS requires a key from a project with billing enabled; up to 5,000 search queries per month are free.** LOCUS checks locations with Google Search and Maps grounding, which Gemini 3.x models do not offer on the free tier (Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing), checked 2026-10-09). Google may change these terms. The default model is `gemini-3.6-flash`.
- **Pro tier** (planned) will use a Provereno-managed key through a server proxy. Both tiers share the `GeoProvider` interface in `src/services/geo`.

Privacy note: on Google's free tier, submitted content may be used to improve Google products and may be reviewed by humans; with billing enabled, Google's paid-service terms apply.

Local history: by default the browser keeps the last 20 analyses, including the images, in IndexedDB on the user's device. Saving can be turned off in the History tab; Settings → Clear Local Data deletes the history together with the key and settings.

## Development

Requires Node.js 22.12+ (Vitest 5 does not run on Node 20).

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
  App.tsx                         UI (most of it; to be split into components)
  components/                     UI components (Google Search suggestions frame)
  lib/coords.ts                   coordinate formatting
  lib/historyStore.ts             local analysis history in IndexedDB
  services/config.ts              settings, model list, local storage
  services/geo/
    types.ts                      GeoProvider interface and result types
    directGeminiProvider.ts       Free tier: browser -> Gemini API
    prompt.ts                     analysis prompt and chat instruction
    schema.ts                     zod validation of model output
    grounding.ts                  sources and queries from grounding metadata
    errors.ts                     error mapping
scripts/eval/                     accuracy evaluation against a set of images
```

## Evaluation

`npm run eval` runs the same analysis code as the app over a set of images with known locations and reports accuracy. The image set lives in a separate private repository (`Provereno-Media/locus-eval`); images are never committed here.

```bash
export LOCUS_EVAL_API_KEY=...       # key from a project with billing enabled
npm run eval -- --data ../locus-eval --dry-run
npm run eval -- --data ../locus-eval --model gemini-3.6-flash --tool maps --label baseline
```

Options: `--repeat <n>`, `--only e001,e004`, `--manifest <file>`; `npm run eval -- --help` lists them. Every request is billed to the key's project and uses grounding quota; `--dry-run` shows the number of requests first. The run stops at errors that would repeat (invalid key, quota, unavailable model).

The report gives the share of answers within 1 / 25 / 200 / 750 / 2500 km and within each image's own radius, the share of correct refusals on images with no answer, calibration of the model's confidence and the number of grounding queries. Errors count as misses. Answers whose grounding sources include provereno.media or the image's published pages are flagged as possible leaks and left out of the accuracy figures. Results are saved to `<data>/runs/`, as they may contain text read from the images.

Node's `fetch` ignores `HTTPS_PROXY`; behind a proxy, set `NODE_USE_ENV_PROXY=1` (Node 22.21+ or 24.5+).

## Deployment

`npm run build` produces a static site in `dist/` with relative asset paths; any static host works, at the domain root or under a sub-path.

**GitHub Pages.** `.github/workflows/deploy-pages.yml` runs typecheck, tests and build on every push to `main` and publishes `dist/`. One-time setup: Settings → Pages → Source: *GitHub Actions*. GitHub Pages cannot send custom HTTP headers, so the CSP below applies only as `<meta>` and `frame-ancestors` is unavailable; the app refuses to render inside a frame instead.

The build injects a Content Security Policy as a `<meta>` tag (`CONTENT_SECURITY_POLICY` in `vite.config.ts`). The host should also send it as an HTTP header, adding `frame-ancestors 'none'`, which browsers ignore in `<meta>`:

```
Content-Security-Policy: <value of CONTENT_SECURITY_POLICY>; frame-ancestors 'none'
```

When adding a new external service (map tiles, API endpoints, fonts), update the policy, or the browser will block it.
