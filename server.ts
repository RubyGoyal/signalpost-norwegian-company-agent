// Signalpost web app server. Serves the inspection UI and a small JSON API on top of
// the same agent used by the batch runner (agent/). No AI model, no API keys.
//
//   npm run dev          → http://localhost:3000
//   SIGNALPOST_CORPUS=out/envelopes.jsonl (default) — batch results shown in the app

import express from 'express';
import { execSync } from 'node:child_process';
import { existsSync, promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { BrregClient } from './agent/brreg.ts';
import { validateOrgnr } from './agent/orgnr.ts';
import { NavJobIndex } from './agent/jobs.ts';
import { researchCompany, type RunContext } from './agent/profile.ts';
import type { Envelope } from './agent/types.ts';

const ROOT = process.cwd();
const CORPUS_FILE = path.resolve(process.env.SIGNALPOST_CORPUS || 'out/envelopes.jsonl');
const REPORT_FILE = path.join(path.dirname(CORPUS_FILE), 'run-report.json');
const REPO_URL = 'https://github.com/RubyGoyal/signalpost-norwegian-company-agent';

const client = new BrregClient({ concurrency: 4, maxRequests: 100_000, timeoutMs: 20_000, maxRetries: 3 });
// NAV job feed index, built at startup and refreshed hourly (SIGNALPOST_JOBS=off disables it).
const JOBS_ON = (process.env.SIGNALPOST_JOBS || 'on') !== 'off';
let jobsIndex: Promise<NavJobIndex> | null = null;
let jobsBuiltAt = 0;
function getJobs(): Promise<NavJobIndex> | null {
  if (!JOBS_ON) return null;
  if (!jobsIndex || Date.now() - jobsBuiltAt > 60 * 60 * 1000) {
    jobsBuiltAt = Date.now();
    jobsIndex = NavJobIndex.build(client, { days: Number(process.env.SIGNALPOST_JOBS_DAYS || 60), maxPages: 600 }).catch(() =>
      NavJobIndex.failed('nav_job_index_error', 60)
    );
  }
  return jobsIndex;
}
const ctx = async (): Promise<RunContext> => ({
  runId: `web-${new Date().toISOString().slice(0, 10)}`,
  client,
  stateDir: path.resolve(process.env.SIGNALPOST_STATE_DIR || '.signalpost-state'),
  maxLocationPages: 2,
  jobs: (await getJobs()) ?? undefined,
});

// Batch results (from the last run) plus anything looked up live in the app.
let corpus = new Map<string, Envelope>();
let corpusMtime = 0;
const liveLookups = new Map<string, Envelope>();

async function loadCorpus() {
  if (!existsSync(CORPUS_FILE)) {
    corpus = new Map();
    corpusMtime = 0;
    return;
  }
  const mtime = statSync(CORPUS_FILE).mtimeMs;
  if (mtime === corpusMtime) return;
  const next = new Map<string, Envelope>();
  const text = await fs.readFile(CORPUS_FILE, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Envelope;
      next.set(e.organisation_number, e);
    } catch {
      /* skip malformed line */
    }
  }
  corpus = next;
  corpusMtime = mtime;
}

const allEnvelopes = () => {
  const merged = new Map(corpus);
  for (const [k, v] of liveLookups) merged.set(k, v);
  return [...merged.values()];
};

function row(e: Envelope) {
  const one = (field: string) => e.claims.find((c) => c.field === field);
  const addr = one('business_address')?.value as any;
  const nace = e.claims
    .filter((c) => c.field === 'nace_code')
    .sort((a, b) => ((a.value as any).rank ?? 9) - ((b.value as any).rank ?? 9))[0]?.value as any;
  const revenue =
    e.claims.find((c) => c.field === 'operating_revenue' && c.key.includes('#SELSKAP#')) ||
    e.claims.find((c) => c.field === 'operating_revenue');
  const ceo = e.claims.find((c) => c.field === 'role' && (c.value as any).role_code === 'DAGL');
  const retrieved = e.source_snapshots.map((s) => s.retrieved_at).sort().pop() || null;
  return {
    organisation_number: e.organisation_number,
    name: e.legal_identity?.legal_name ?? null,
    state: e.state,
    registry_status: e.legal_identity?.registry_status ?? null,
    municipality: addr?.municipality ?? null,
    nace: nace ? `${nace.code}${nace.description ? ` ${nace.description}` : ''}` : null,
    employees: (one('registered_employees')?.value as number) ?? null,
    revenue: revenue ? { value: revenue.value, unit: revenue.unit ?? null, period_to: revenue.reporting_period?.to ?? null } : null,
    ceo: ceo ? (ceo.value as any).name : null,
    families_available: Object.values(e.availability).filter((a) => a.state === 'available').length,
    changes: e.refresh.changes.length,
    retrieved_at: retrieved,
    source: liveLookups.has(e.organisation_number) ? 'live' : 'batch',
  };
}

function commitInfo() {
  try {
    const hash = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
    return { hash, dirty };
  } catch {
    return { hash: null, dirty: null };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Company profile: batch result if present, otherwise (or with ?refresh=1) a live registry check.
  app.get('/api/company/:orgnr', async (req, res) => {
    const check = validateOrgnr(req.params.orgnr);
    if (!check.valid) {
      res.status(400).json({ error: check.reason });
      return;
    }
    await loadCorpus();
    const refresh = req.query.refresh === '1';
    const cached = liveLookups.get(check.normalized) || corpus.get(check.normalized);
    if (cached && !refresh) {
      res.json({ envelope: cached, origin: liveLookups.has(check.normalized) ? 'live' : 'batch' });
      return;
    }
    try {
      const envelope = await researchCompany(check.normalized, 0, await ctx());
      if (envelope.state !== 'failed') liveLookups.set(check.normalized, envelope);
      res.json({ envelope, origin: 'live' });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.get('/api/corpus', async (req, res) => {
    await loadCorpus();
    const q = String(req.query.q || '').trim().toLowerCase();
    const state = String(req.query.state || 'all');
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
    let rows = allEnvelopes().map(row);
    const total = rows.length;
    if (state !== 'all') rows = rows.filter((r) => r.state === state);
    if (q)
      rows = rows.filter((r) =>
        [r.organisation_number, r.name, r.municipality, r.nace, r.ceo].some((v) => v && String(v).toLowerCase().includes(q))
      );
    rows.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || (a.name || a.organisation_number).localeCompare(b.name || b.organisation_number));
    res.json({
      total,
      filtered: rows.length,
      page,
      pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      corpus_file: path.relative(ROOT, CORPUS_FILE),
      corpus_loaded: corpus.size > 0,
    });
  });

  app.get('/api/corpus/export', async (_req, res) => {
    await loadCorpus();
    const envs = allEnvelopes();
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="signalpost_envelopes_${envs.length}.jsonl"`);
    res.send(envs.map((e) => JSON.stringify(e)).join('\n') + (envs.length ? '\n' : ''));
  });

  app.get('/api/report', async (_req, res) => {
    try {
      res.json({ report: JSON.parse(await fs.readFile(REPORT_FILE, 'utf8')) });
    } catch {
      res.json({ report: null });
    }
  });

  app.get('/api/about', (_req, res) => {
    res.json({
      repository: REPO_URL,
      commit: commitInfo(),
      install_command: 'npm ci',
      run_command: 'npx tsx agent/run.ts <input-file> out',
      models: [],
      third_party_cost_usd: 0,
      sources: [
        { name: 'Enhetsregisteret (entity, roles, sub-units, update feed)', url: 'https://data.brreg.no/enhetsregisteret/api/docs/index.html', licence: 'NLOD 2.0' },
        { name: 'Regnskapsregisteret (annual accounts)', url: 'https://data.brreg.no/regnskapsregisteret/regnskap/', licence: 'NLOD 2.0' },
        { name: 'NAV job vacancy feed (arbeidsplassen.no)', url: 'https://navikt.github.io/pam-stilling-feed/', licence: 'NAV API terms' },
      ],
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  const port = Number(process.env.PORT || 3000);
  void getJobs();
  app.listen(port, '0.0.0.0', () => {
    process.stderr.write(`Signalpost app on http://localhost:${port} (batch results: ${path.relative(ROOT, CORPUS_FILE)})\n`);
  });
}

startServer();
