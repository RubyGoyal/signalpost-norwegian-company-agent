// Prints a Markdown summary of one run (and, optionally, an immediate re-run of the same input).
// Used by the "Full live run" GitHub workflow; works on any output folder.
//
//   npx tsx scripts/run-summary.ts out [out-rerun]

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [dir, rerunDir] = process.argv.slice(2);
if (!dir) {
  console.error('usage: npx tsx scripts/run-summary.ts <out-dir> [rerun-out-dir]');
  process.exit(2);
}

const n = (x: unknown) => (typeof x === 'number' ? x.toLocaleString('en-US') : String(x ?? '-'));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '-');

async function envelopeStats(file: string) {
  const s = {
    companies: 0,
    withNews: 0,
    newsPosts: 0,
    withSocial: 0,
    withSiteJobs: 0,
    withNavJobs: 0,
    withWebsite: 0,
    errorsBySource: {} as Record<string, number>,
    failed: 0,
  };
  if (!existsSync(file)) return s;
  const rl = readline.createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    s.companies++;
    if (e.state === 'failed') s.failed++;
    const fields = new Set<string>((e.claims || []).map((c: any) => c.field));
    const news = (e.claims || []).filter((c: any) => c.field === 'site_news').length;
    if (news) s.withNews++;
    s.newsPosts += news;
    if (fields.has('social_profile')) s.withSocial++;
    if (fields.has('site_job')) s.withSiteJobs++;
    if (fields.has('job_ad')) s.withNavJobs++;
    if (fields.has('website')) s.withWebsite++;
    for (const er of e.errors || []) s.errorsBySource[er.source] = (s.errorsBySource[er.source] || 0) + 1;
  }
  return s;
}

const report = JSON.parse(readFileSync(path.join(dir, 'run-report.json'), 'utf8'));
const st = await envelopeStats(path.join(dir, 'envelopes.jsonl'));
const total = report.envelope_count || st.companies;
const fam = report.companies_with_family_available || {};
const web = report.quality?.from_company_websites || {};
const nav = report.nav_job_feed || {};
const out: string[] = [];

out.push(`## Signalpost full run`);
out.push('');
out.push(`- Commit: \`${process.env.GITHUB_SHA || 'local'}\``);
out.push(`- Input: \`${path.relative(process.cwd(), report.input_file || '') || report.input_file}\`, ${n(report.input_count)} organisation numbers`);
out.push(`- Envelopes: ${n(report.envelope_count)} (one per input: ${report.one_envelope_per_input ? 'yes' : 'NO'}); states: ${Object.entries(report.states || {}).map(([k, v]) => `${k} ${n(v)}`).join(', ')}`);
out.push(`- Runtime: ${n(report.runtime_seconds)} s; per company p50 ${n(report.per_company_runtime_ms?.p50)} ms, p95 ${n(report.per_company_runtime_ms?.p95)} ms`);
out.push(`- Requests: ${n(report.requests_total)} (${Object.entries(report.requests_by_source || {}).map(([k, v]) => `${k} ${n(v)}`).join(', ')}); cost $${report.third_party_cost_usd ?? 0}; models: ${(report.models_used || []).length ? report.models_used.join(', ') : 'none'}`);
out.push(`- Quality checks: ${report.quality?.all_checks_passed ? 'all passed' : `${n(report.quality?.issues)} issue(s)`}; total claims ${n(report.total_claims)}`);
out.push(`- Source errors: ${Object.keys(st.errorsBySource).length ? Object.entries(st.errorsBySource).map(([k, v]) => `${k} ${n(v)}`).join(', ') : 'none'}`);
out.push('');
out.push('### Coverage (companies with at least one fact)');
out.push('');
out.push('| Kind of fact | Companies | Share |');
out.push('|---|---:|---:|');
for (const [k, v] of Object.entries(fam)) out.push(`| ${k.replace(/_/g, ' ')} | ${n(v)} | ${pct(Number(v), total)} |`);
out.push('');
out.push('### From company websites');
out.push('');
out.push(`- Verified official website: ${n(web.companies_with_verified_website ?? st.withWebsite)} companies`);
out.push(`- Social profiles: ${n(web.social_profiles)} (companies with one: ${n(st.withSocial)})`);
out.push(`- Dated news posts: ${n(web.dated_news_posts ?? st.newsPosts)} (companies with news: ${n(st.withNews)}; from feeds: ${n(web.dated_news_posts_from_feeds)})`);
out.push(`- Job ads from careers pages: ${n(web.job_ads)} (companies: ${n(st.withSiteJobs)})`);
out.push(`- Companies with NAV job ads: ${n(st.withNavJobs)}`);
out.push(`- NAV feed: ${nav.ok ? 'read' : 'NOT read'}; ${n(nav.active_ads)} active ads indexed from ${n(nav.entries_read)} feed entries; detail scan complete: ${nav.detail_scan_complete ? 'yes' : 'no'}`);
const left = report.quality?.websites?.not_published_by_reason || {};
if (Object.keys(left).length) {
  out.push('');
  out.push('Websites not published, by reason:');
  out.push('');
  for (const [k, v] of Object.entries(left).sort((a, b) => Number(b[1]) - Number(a[1]))) out.push(`- ${k}: ${n(v)}`);
}

if (rerunDir && existsSync(path.join(rerunDir, 'run-report.json'))) {
  const r2 = JSON.parse(readFileSync(path.join(rerunDir, 'run-report.json'), 'utf8'));
  out.push('');
  out.push('### Immediate re-run of the same input (refresh check)');
  out.push('');
  out.push(`- Envelopes: ${n(r2.envelope_count)}; runtime ${n(r2.runtime_seconds)} s; quality checks: ${r2.quality?.all_checks_passed ? 'all passed' : `${n(r2.quality?.issues)} issue(s)`}`);
  out.push(`- Changes detected against the first run: ${n(r2.refresh_changes_detected)} (a few are expected when a source really changed in between, for example a job ad expiring)`);
  const byKind: Record<string, number> = {};
  const examples: string[] = [];
  const f2 = path.join(rerunDir, 'envelopes.jsonl');
  if (existsSync(f2)) {
    const rl = readline.createInterface({ input: createReadStream(f2, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      for (const c of e.refresh?.changes || []) {
        const k = `${c.type.replace('_value', '')} ${c.field}`;
        byKind[k] = (byKind[k] || 0) + 1;
        if (examples.length < 15)
          examples.push(`${e.organisation_number} ${k}: ${JSON.stringify(c.previous_value)?.slice(0, 120)} -> ${JSON.stringify(c.new_value)?.slice(0, 120)}`);
      }
    }
  }
  if (Object.keys(byKind).length) {
    out.push('');
    out.push('| Change | Count |');
    out.push('|---|---:|');
    for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) out.push(`| ${k} | ${n(v)} |`);
    out.push('');
    out.push('First examples:');
    out.push('');
    out.push('```');
    out.push(...examples);
    out.push('```');
  }
}

console.log(out.join('\n'));
