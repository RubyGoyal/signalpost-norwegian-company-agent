// Signalpost batch runner.
//
//   npx tsx agent/run.ts <input-file | orgnr[,orgnr...]> [out-dir] [--run-id ID] [--state-dir DIR]
//                         [--concurrency N] [--max-requests N] [--deadline-seconds N]
//                         [--jobs on|off] [--jobs-days N] [--web on|off]
//
// Reads organisation numbers from <input-file> (.txt / .csv / .jsonl / .json, optionally .gz)
// and writes exactly one terminal envelope per input to <out-dir>/envelopes.jsonl,
// plus <out-dir>/run-report.json. Stdout carries only the final one-line JSON summary.

import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { BrregClient } from './brreg.ts';
import { readInput } from './input.ts';
import { NavJobIndex, type JobIndexInfo } from './jobs.ts';
import { assembleCompany, failedEnvelope, gatherCompany, type Gathered, type RunContext } from './profile.ts';
import { WebClient } from './web.ts';
import { FIELD_FAMILIES, type Envelope } from './types.ts';

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
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const deadlineMs = deadlineSec > 0 ? deadlineSec * 1000 : 0;

  // Company websites: a separate fetcher with its own public-URL guard (agent/web.ts).
  const webOn = (flags.web || process.env.SIGNALPOST_WEB || 'on') !== 'off';
  const web = webOn
    ? new WebClient({ concurrency: Number(process.env.SIGNALPOST_WEB_CONCURRENCY || 24), timeoutMs: 8_000, maxBytes: 1_500_000, maxRedirects: 4, maxRequests: Number(process.env.SIGNALPOST_WEB_MAX_REQUESTS || 25000) })
    : null;
  ctx.web = web;
  ctx.websiteBudgetMs = Number(process.env.SIGNALPOST_WEBSITE_BUDGET_MS || 20_000);
  if (web) {
    const ok = await web.probe();
    process.stderr.write(`signalpost: company websites ${ok ? 'reachable' : `not reachable (${web.disabledReason}); website step reported as not run`}\n`);
  }

  // Hiring source: NAV's job feed and every active ad's detail record, read once per run by a
  // separate client, in parallel with the company research. If it is not ready in time, job
  // postings are reported as failed, never guessed.
  const jobsOn = (flags.jobs || process.env.SIGNALPOST_JOBS || 'on') !== 'off';
  const jobsDays = Number(flags['jobs-days'] || process.env.SIGNALPOST_JOBS_DAYS || 60);
  const navClient = new BrregClient({ concurrency: Number(process.env.SIGNALPOST_NAV_CONCURRENCY || 12), maxRequests: Number(process.env.SIGNALPOST_NAV_MAX_REQUESTS || 40000), timeoutMs: 30_000, maxRetries: 3 });
  let navReady: Promise<NavJobIndex | null> = Promise.resolve(null);
  if (jobsOn) {
    process.stderr.write(`signalpost: reading NAV job feed (last ${jobsDays} days) in the background...\n`);
    const tj = Date.now();
    navReady = NavJobIndex.build(navClient, {
      days: jobsDays,
      maxPages: Number(process.env.SIGNALPOST_JOBS_MAX_PAGES || 600),
      feedBudgetMs: deadlineMs ? Math.min(240_000, deadlineMs * 0.3) : 240_000,
      detailBudgetMs: deadlineMs ? Math.min(300_000, deadlineMs * 0.45) : Number(process.env.SIGNALPOST_JOBS_DETAIL_BUDGET_MS || 300_000),
      detailScan: (process.env.SIGNALPOST_JOBS_DETAIL_SCAN || 'on') !== 'off',
    })
      .then((idx) => {
        const i = idx.info;
        process.stderr.write(
          `signalpost: NAV job feed ${i.ok ? 'ready' : `unavailable (${i.error})`}: ${i.feed_pages} pages, ${i.active_ads} active ads, ${i.details_scanned ?? 0}/${i.details_total ?? 0} ads read, ${Math.round((Date.now() - tj) / 1000)}s\n`
        );
        return idx;
      })
      .catch((e) => {
        process.stderr.write(`signalpost: NAV job feed error: ${e?.message || e}\n`);
        return NavJobIndex.failed('nav_job_index_error', jobsDays);
      });
  }

  // Stream each envelope as soon as it is done, so a crash still leaves completed rows.
  const streamPath = path.join(outDir, 'envelopes.partial.jsonl');
  const stream = createWriteStream(streamPath);
  const results = new Map<number, Envelope>();
  const gathered = new Map<number, Gathered>();
  let finished = false;

  const record = (env: Envelope) => {
    if (results.has(env.input_index)) return;
    results.set(env.input_index, env);
    stream.write(JSON.stringify(env) + '\n');
    if (results.size % 100 === 0) process.stderr.write(`signalpost: ${results.size}/${orgnrs.length} written\n`);
  };

  // Guarantee one row per input: anything still pending at the deadline or on a termination
  // signal is closed out. A company already researched is written with what was found (job
  // postings then marked failed); one not yet researched is written as `failed`.
  const notReadyCtx = (): RunContext => ({ ...ctx, jobs: ctx.jobs?.info.ok ? ctx.jobs : jobsOn ? NavJobIndex.failed('nav_job_index_not_ready', jobsDays) : undefined });
  const inflight = new Map<number, Promise<unknown>>();
  const closeOutPending = async (code: string, message: string) => {
    const late = notReadyCtx();
    for (let i = 0; i < orgnrs.length; i++) {
      if (results.has(i)) continue;
      // Being assembled right now: give it a few seconds rather than assembling it twice.
      const running = inflight.get(i);
      if (running) await Promise.race([running.catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
      if (results.has(i) || inflight.has(i)) {
        if (!results.has(i)) record(failedEnvelope(orgnrs[i], i, runId, startedAt, code, message));
        continue;
      }
      const g = gathered.get(i);
      if (g) {
        try {
          record(await assembleCompany(g, late));
          continue;
        } catch {
          /* fall through to a failed row */
        }
      }
      record(failedEnvelope(orgnrs[i], i, runId, startedAt, code, message));
    }
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
    const websiteHow: Record<string, number> = {};
    let changes = 0;
    for (const e of ordered) {
      states[e.state] = (states[e.state] || 0) + 1;
      for (const f of FIELD_FAMILIES) if (e.availability[f].state === 'available') familyAvailable[f] = (familyAvailable[f] || 0) + 1;
      const w = e.availability.official_website;
      if (w) websiteHow[`${w.state}:${w.reason}`] = (websiteHow[`${w.state}:${w.reason}`] || 0) + 1;
      changes += e.refresh.changes.length;
    }
    const runtimes = ordered.map((e) => e.operations.runtime_ms);
    const requestsTotal = client.requestsUsed + navClient.requestsUsed + (web?.requestsUsed || 0);
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
      official_website_outcomes: websiteHow,
      total_claims: ordered.reduce((n, e) => n + e.claims.length, 0),
      refresh_changes_detected: changes,
      requests_total: requestsTotal,
      requests_by_source: { brreg: client.requestsUsed, nav: navClient.requestsUsed, company_websites: web?.requestsUsed || 0 },
      runtime_seconds: Math.round(elapsed() / 1000),
      per_company_runtime_ms: { p50: pct(runtimes, 50), p95: pct(runtimes, 95) },
      third_party_cost_usd: 0,
      models_used: [],
      sources: [
        'data.brreg.no Enhetsregisteret (entities, roles, sub-units, update feed)',
        'data.brreg.no Regnskapsregisteret',
        ...(jobsInfo ? ['pam-stilling-feed.nav.no (NAV job vacancy feed)'] : []),
        ...(web ? ['company-owned websites (robots.txt honoured)'] : []),
      ],
      company_websites: web ? { checked: !web.disabledReason, disabled_reason: web.disabledReason } : { checked: false, disabled_reason: 'switched_off' },
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
        requests: requestsTotal,
        runtime_seconds: report.runtime_seconds,
      }) + '\n'
    );
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      await closeOutPending('interrupted', `run interrupted by ${sig} before this company finished`);
      await finish();
      process.exit(130);
    });
  }

  let deadlineHit = false;
  let deadlineTimer: NodeJS.Timeout | null = null;
  const deadline = deadlineMs
    ? new Promise<void>((resolve) => {
        deadlineTimer = setTimeout(async () => {
          deadlineHit = true;
          await closeOutPending('deadline_reached', `run deadline of ${deadlineSec}s reached before this company finished`);
          resolve();
        }, deadlineMs);
      })
    : null;

  const work = (async () => {
    // Phase 1: registry sources and company websites for every company.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency * 4) }, async () => {
        while (next < orgnrs.length && !finished && !deadlineHit) {
          const i = next++;
          const started = new Date().toISOString();
          try {
            const g = await gatherCompany(orgnrs[i], i, ctx);
            gathered.set(i, g);
            if (g.final) record(g.final);
          } catch (err: any) {
            record(failedEnvelope(orgnrs[i], i, runId, started, 'agent_error', String(err?.message || err)));
          }
        }
      })
    );
    if (deadlineHit) return;
    process.stderr.write(`signalpost: ${gathered.size}/${orgnrs.length} companies researched in ${Math.round(elapsed() / 1000)}s; waiting for the NAV index...\n`);

    // Phase 2: hiring from the NAV index, then refresh diff and summary for each company.
    if (jobsOn) {
      const waitMs = deadlineMs ? Math.max(0, deadlineMs * 0.9 - elapsed()) : 15 * 60_000;
      const idx = await Promise.race([navReady, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
      ctx.jobs = idx || NavJobIndex.failed('nav_job_index_timeout', jobsDays);
      jobsInfo = ctx.jobs.info;
    }
    let n2 = 0;
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency * 2) }, async () => {
        while (n2 < orgnrs.length && !finished && !deadlineHit) {
          const i = n2++;
          if (results.has(i)) continue;
          const g = gathered.get(i);
          if (!g) continue;
          const p = assembleCompany(g, ctx)
            .then(record)
            .catch((err: any) => record(failedEnvelope(orgnrs[i], i, runId, g.startedAt, 'agent_error', String(err?.message || err))))
            .finally(() => inflight.delete(i));
          inflight.set(i, p);
          await p;
        }
      })
    );
  })();

  await (deadline ? Promise.race([work, deadline]) : work);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (!jobsInfo && ctx.jobs) jobsInfo = ctx.jobs.info;
  await closeOutPending('not_processed', 'company was not processed in this run');
  await finish();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`signalpost: fatal error: ${err?.stack || err}\n`);
  process.exit(1);
});
