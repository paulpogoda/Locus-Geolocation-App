import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_MODEL, hasValidKeyChars, normalizeApiKey } from '../../src/services/config';
import { DirectGeminiProvider } from '../../src/services/geo/directGeminiProvider';
import { LocusError } from '../../src/services/geo/errors';
import { buildGeolocationPrompt } from '../../src/services/geo/prompt';
import type { GroundingTool } from '../../src/services/geo/types';
import { loadManifest, mimeTypeOf, type EvalItem } from './manifest';
import { formatSummary, scoreAttempt, summarize, type Attempt } from './metrics';

/** Errors after which further requests would fail the same way or keep spending quota. */
const FATAL_ERRORS = new Set(['NO_KEY', 'BAD_KEY', 'AUTH', 'QUOTA', 'GROUNDING_QUOTA', 'REGION', 'MODEL_UNAVAILABLE']);

const USAGE = `Usage: npm run eval -- --data <locus-eval dir> [options]

  --data <dir>       locus-eval checkout (or LOCUS_EVAL_DIR)
  --model <id>       Gemini model (default ${DEFAULT_MODEL})
  --tool maps|search grounding tool (default maps, as in the app)
  --repeat <n>       runs per image (default 1)
  --only <ids>       comma-separated ids, e.g. e001,e004
  --label <name>     variant name in the results file (default <model>-<tool>)
  --manifest <file>  manifest file inside --data (default manifest.json)
  --dry-run          validate the manifest and show the plan, no API calls

The API key is read from LOCUS_EVAL_API_KEY. Results go to <data>/runs/.`;

function gitRevision(): string {
  try {
    const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
    return dirty ? `${rev}-dirty` : rev;
  } catch {
    return 'unknown';
  }
}

function promptHash(tool: GroundingTool): string {
  const prompts = (['visual', 'satellite', 'flora'] as const).map((mode) => buildGeolocationPrompt(mode, tool));
  return createHash('sha256').update(prompts.join('\n---\n')).digest('hex').slice(0, 12);
}

function resultsPath(dataDir: string, label: string): string {
  const dir = path.join(dataDir, 'runs');
  mkdirSync(dir, { recursive: true });
  const stem = `${new Date().toISOString().slice(0, 10)}-${label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;
  let file = path.join(dir, `${stem}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${stem}-${n}.json`);
  return file;
}

function countBy(items: EvalItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.difficulty, (counts.get(item.difficulty) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${k} ${v}`).join(', ');
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string' },
      model: { type: 'string', default: DEFAULT_MODEL },
      tool: { type: 'string', default: 'maps' },
      repeat: { type: 'string', default: '1' },
      only: { type: 'string' },
      label: { type: 'string' },
      manifest: { type: 'string', default: 'manifest.json' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const dataDir = values.data ?? process.env.LOCUS_EVAL_DIR;
  const tool = values.tool;
  const repeat = Number(values.repeat);
  if (!dataDir || (tool !== 'maps' && tool !== 'search') || !Number.isInteger(repeat) || repeat < 1) {
    console.error(USAGE);
    return 2;
  }

  let items = loadManifest(dataDir, values.manifest);
  if (values.only) {
    const wanted = new Set(values.only.split(',').map((id) => id.trim()));
    const unknown = [...wanted].filter((id) => !items.some((item) => item.id === id));
    if (unknown.length > 0) throw new Error(`Unknown ids: ${unknown.join(', ')}`);
    items = items.filter((item) => wanted.has(item.id));
  }
  if (items.length === 0) {
    console.error('No items to run.');
    return 1;
  }

  const model = values.model;
  const label = values.label ?? `${model}-${tool}`;
  console.log(`Items: ${items.length} (${countBy(items)}); ${items.length * repeat} requests to ${model} with ${tool} grounding`);
  if (values['dry-run']) return 0;

  const apiKey = normalizeApiKey(process.env.LOCUS_EVAL_API_KEY ?? '');
  if (!apiKey || !hasValidKeyChars(apiKey)) {
    console.error('Set LOCUS_EVAL_API_KEY to a Gemini API key from a project with billing enabled.');
    return 2;
  }

  const provider = new DirectGeminiProvider(() => ({ apiKey, modelName: model }));
  const outFile = resultsPath(dataDir, label);
  const meta = {
    label,
    model,
    tool,
    repeat,
    manifest: values.manifest,
    locusRevision: gitRevision(),
    promptHash: promptHash(tool),
    startedAt: new Date().toISOString(),
  };
  const attempts: Attempt[] = [];
  let stoppedBy: string | undefined;

  const save = (finishedAt?: string) =>
    writeFileSync(
      outFile,
      `${JSON.stringify({ ...meta, finishedAt, stoppedBy, summary: summarize(attempts), attempts }, null, 2)}\n`,
    );

  run: for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const item of items) {
      const image = readFileSync(path.join(dataDir, item.file));
      const startedAt = Date.now();
      let scored: Attempt;
      try {
        const result = await provider.analyzeImage({
          base64Data: image.toString('base64'),
          mimeType: mimeTypeOf(item.file),
          mode: item.mode,
          groundingTool: tool,
        });
        scored = scoreAttempt(item, attempt, Date.now() - startedAt, { result });
      } catch (error) {
        const code = error instanceof LocusError ? error.code : 'UNKNOWN';
        const detail = error instanceof LocusError ? error.detail : String(error);
        scored = scoreAttempt(item, attempt, Date.now() - startedAt, { error: code, errorDetail: detail });
      }
      attempts.push(scored);
      save();

      const verdict = scored.error
        ? `ERROR ${scored.error}${scored.errorDetail ? `: ${scored.errorDetail}` : ''}`
        : item.truth
          ? `${scored.distanceKm == null ? 'no coordinates' : `${scored.distanceKm.toFixed(1)} km`} ${scored.withinRadius ? 'OK' : 'MISS'}`
          : scored.abstained
            ? 'abstained OK'
            : 'gave coordinates MISS';
      const leak = scored.leaks.length > 0 ? ' [possible leak]' : '';
      console.log(`${item.id} #${attempt} ${item.difficulty}: ${verdict}${leak} (${Math.round(scored.durationMs / 1000)} s)`);

      if (scored.error === 'NETWORK' && !process.env.NODE_USE_ENV_PROXY && process.env.HTTPS_PROXY) {
        console.log('Hint: Node ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set.');
      }
      if (scored.error && FATAL_ERRORS.has(scored.error)) {
        stoppedBy = scored.error;
        break run;
      }
    }
  }

  save(new Date().toISOString());
  console.log(`\n${formatSummary(summarize(attempts))}`);
  if (stoppedBy) console.log(`\nStopped early: ${stoppedBy}`);
  console.log(`\nResults: ${outFile}`);
  return stoppedBy ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
