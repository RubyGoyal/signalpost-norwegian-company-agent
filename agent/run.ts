// Signalpost batch runner.
//
//   npx tsx agent/run.ts <input-file | orgnr[,orgnr...]> [out-dir] [--run-id ID] [--state-dir DIR]
//                         [--concurrency N] [--max-requests N] [--deadline-seconds N]
//
// Reads organisation numbers from <input-file> (.txt / .csv / .jsonl / .json, optionally .gz)
// and writes exactly one terminal envelope per input to <out-dir>/envelopes.jsonl,
// plus <out-dir>/run-report.json. Stdout carries only the final one-line JSON summary.

import { createWriteStream, promises as fs } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { BrregClient } from './brreg.ts';
import { NavJobIndex, type JobIndexInfo } from './jobs.ts';
import { failedEnvelope, researchCompany, type RunContext } from './profile.ts';
import { FIELD_FAMILIES, type Envelope } from './types.ts';

const ORG_KEYS = [
  'organisation_number',
  'organisationNumber',
  'organization_number',
  'organizationNumber',
  'organisasjonsnummer',
  'orgnr',
  'orgNr',
  'org_number',
  'orgnummer',
];

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

function pickOrgnr(v: unknown): string | null {
  if (typeof v === 'number') return String(v).padStart(9, '0');
  if (typeof v === 'string') {
    const m = v.match(/\b(\d{3})\s?(\d{3})\s?(\d{3})\b/);
    return m ? m[1] + m[2] + m[3] : v.trim() || null;
  }
  if (v && typeof v === 'object') {
    for (const k of ORG_KEYS) if (k in (v as any)) return pickOrgnr((v as any)[k]);
  }
  return null;
}

export async function readInput(file: string): Promise<{ orgnrs: string[]; skipped: number; duplicates: number }> {
  let buf = await fs.readFile(file);
  if (file.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = gunzipSync(buf);
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const raw: string[] = [];
  let skipped = 0;
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    for (const item of JSON.parse(trimmed)) {
      const o = pickOrgnr(item);
      o ? raw.push(o) : skipped++;
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      let o: string | null = null;
      if (l.startsWith('{')) {
        try {
          o = pickOrgnr(JSON.parse(l));
        } catch {
          o = null;
        }
      } else {
        const m = l.match(/\b(\d{3})\s?(\d{3})\s?(\d{3})\b/);
        o = m ? m[1] + m[2] + m[3] : null;
      }
      o ? raw.push(o) : skipped++; // header rows and blank cells land here
    }
  }
  const seen = new Set<string>();
  const orgnrs: string[] = [];
  for (const o of raw) {
    if (seen.has(o)) continue;
    seen.add(o);
    orgnrs.push(o);
  }
  return { orgnrs, skipped, duplicates: raw.length - orgnrs.length };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const inputFile = pos[0] || process.env.SIGNALPOST_INPUT;
  if (!inputFile) {
    process.stderr.write('Usage: npm run signalpost -- <input-file> [out-dir]\n');
    process.exit(2);
  }
  const outDir = path.resolve(pos[1] || process.env.SIGNALPOST_OUT_DIR || 'out');
  const startedAt = new Date().toISOString();
  const runId = flags['run-id'] || process.env.SIGNALPOST_RUN_ID || `run-${startedAt.replace(/[:.]/g, '-')}`;
  const stateDir = path.resolve(flags['state-dir'] || process.env.SIGNALPOST_STATE_DIR || '.signalpost-state');
  const concurrency = Number(flags.concurrency || process.env.SIGNALPOST_CONCURRENCY || 8);
  const maxRequests = Number(flags['max-requests'] || process.env.SIGNALPOST_MAX_REQUESTS || 20000);
  const deadlineSec = Number(flags['deadline-seconds'] || process.env.SIGNALPOST_DEADLINE_SECONDS || 0);

  await fs.mkdir(outDir, { recursive: true });
  // Convenience: org numbers can be passed directly instead of a file, e.g. `923609016,984851006`.
  const inlineNumbers = /^\d{9}(,\d{9})*$/.test(inputFile) && !(await fs.stat(inputFile).catch(() => null));
  const { orgnrs, skipped, duplicates } = inlineNumbers
    ? { orgnrs: [...new Set(inputFile.split(','))], skipped: 0, duplicates: 0 }
    : await readInput(inputFile);
  process.stderr.write(`signalpost: ${orgnrs.length} organisation numbers from ${inputFile} (run ${runId})\n`);

  const client = new BrregClient({ concurrency, maxRequests, timeoutMs: 20_000, maxRetries: 3 });
  const ctx: RunContext = { runId, client, stateDir, maxLocationPages: Number(process.env.SIGNALPOST_MAX_LOCATION_PAGES || 2) };
  let jobsInfo: JobIndexInfo | null = null;

  // Stream each envelope as soon as it is done, so a crash still leaves completed rows.
  const streamPath = path.join(outDir, 'envelopes.partial.jsonl');
  const stream = createWriteStream(streamPath);
  const results = new Map<number, Envelope>();
  const t0 = Date.now();
  let finished = false;

  const record = (env: Envelope) => {
    if (results.has(env.input_index)) return;
    results.set(env.input_index, env);
    stream.write(JSON.stringify(env) + '\n');
    if (results.size % 50 === 0) process.stderr.write(`signalpost: ${results.size}/${orgnrs.length} done\n`);
  };

  // Guarantee one row per input: anything still pending at the deadline or on a
  // termination signal is closed out as `failed` instead of being dropped.
  const closeOutPending = (code: string, message: string) => {
    orgnrs.forEach((o, i) => {
      if (!results.has(i)) record(failedEnvelope(o, i, runId, startedAt, code, message));
    });
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    await new Promise<void>((r) => stream.end(r));
    const ordered = orgnrs.map((o, i) => results.get(i)!);
    const finalPath = path.join(outDir, 'envelopes.jsonl');
    await fs.writeFile(`${finalPath}.tmp`, ordered.map((e) => JSON.stringify(e)).join('\n') + (ordered.length ? '\n' : ''));
    await fs.rename(`${finalPath}.tmp`, finalPath);
    await fs.rm(streamPath, { force: true });

    const states: Record<string, number> = {};
    const familyAvailable: Record<string, number> = {};
    let changes = 0;
    for (const e of ordered) {
      states[e.state] = (states[e.state] || 0) + 1;
      for (const f of FIELD_FAMILIES) if (e.availability[f].state === 'available') familyAvailable[f] = (familyAvailable[f] || 0) + 1;
      changes += e.refresh.changes.length;
    }
    const runtimes = ordered.map((e) => e.operations.runtime_ms);
    const report = {
      run_id: runId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      input_file: inputFile,
      input_count: orgnrs.length,
      envelope_count: ordered.length,
      one_envelope_per_input: ordered.length === orgnrs.length && ordered.every(Boolean),
      skipped_input_lines: skipped,
      duplicate_inputs_merged: duplicates,
      states,
      companies_with_family_available: familyAvailable,
      total_claims: ordered.reduce((n, e) => n + e.claims.length, 0),
      refresh_changes_detected: changes,
      requests_total: client.requestsUsed,
      runtime_seconds: Math.round((Date.now() - t0) / 1000),
      per_company_runtime_ms: { p50: pct(runtimes, 50), p95: pct(runtimes, 95) },
      third_party_cost_usd: 0,
      models_used: [],
      sources: [
        'data.brreg.no Enhetsregisteret (entities, roles, sub-units, update feed)',
        'data.brreg.no Regnskapsregisteret',
        ...(jobsInfo ? ['pam-stilling-feed.nav.no (NAV job vacancy feed)'] : []),
      ],
      nav_job_feed: jobsInfo,
    };
    await fs.writeFile(path.join(outDir, 'run-report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(
      JSON.stringify({
        run_id: runId,
        envelopes: path.join(outDir, 'envelopes.jsonl'),
        report: path.join(outDir, 'run-report.json'),
        input_count: orgnrs.length,
        envelope_count: ordered.length,
        states,
        requests: client.requestsUsed,
        runtime_seconds: report.runtime_seconds,
      }) + '\n'
    );
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      closeOutPending('interrupted', `run interrupted by ${sig} before this company finished`);
      await finish();
      process.exit(130);
    });
  }

  let deadlineTimer: NodeJS.Timeout | null = null;
  const deadline = deadlineSec > 0
    ? new Promise<void>((resolve) => {
        deadlineTimer = setTimeout(() => {
          closeOutPending('deadline_reached', `run deadline of ${deadlineSec}s reached before this company finished`);
          resolve();
        }, deadlineSec * 1000);
      })
    : null;

  // Hiring source: read NAV's job feed once for the whole run (SIGNALPOST_JOBS=off skips it).
  // The read is time-boxed; if it fails, job postings are reported as failed, never guessed.
  if ((flags.jobs || process.env.SIGNALPOST_JOBS || 'on') !== 'off') {
    const days = Number(flags['jobs-days'] || process.env.SIGNALPOST_JOBS_DAYS || 60);
    const limitMs = (deadlineSec > 0 ? Math.min(180, deadlineSec * 0.3) : 240) * 1000;
    const tj = Date.now();
    process.stderr.write(`signalpost: reading NAV job feed (last ${days} days)...\n`);
    const built = await Promise.race([
      NavJobIndex.build(client, { days, maxPages: Number(process.env.SIGNALPOST_JOBS_MAX_PAGES || 600) }),
      new Promise<null>((r) => setTimeout(() => r(null), limitMs)),
    ]);
    ctx.jobs = built || NavJobIndex.failed('nav_job_index_timeout', days);
    jobsInfo = ctx.jobs.info;
    process.stderr.write(
      `signalpost: NAV job feed ${jobsInfo.ok ? 'ready' : `unavailable (${jobsInfo.error})`}: ${jobsInfo.feed_pages} pages, ${jobsInfo.active_ads} active ads, ${Math.round((Date.now() - tj) / 1000)}s\n`
    );
  }

  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency * 2) }, async () => {
    while (next < orgnrs.length && !finished) {
      const i = next++;
      if (results.has(i)) continue;
      const started = new Date().toISOString();
      try {
        record(await researchCompany(orgnrs[i], i, ctx));
      } catch (err: any) {
        record(failedEnvelope(orgnrs[i], i, runId, started, 'agent_error', String(err?.message || err)));
      }
    }
  });

  await (deadline ? Promise.race([Promise.all(workers), deadline]) : Promise.all(workers));
  if (deadlineTimer) clearTimeout(deadlineTimer);
  closeOutPending('not_processed', 'company was not processed in this run');
  await finish();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`signalpost: fatal error: ${err?.stack || err}\n`);
  process.exit(1);
});
