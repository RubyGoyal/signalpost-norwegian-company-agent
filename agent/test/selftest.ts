// Offline self-test for the batch runner (no network). Run: npm run test:agent

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Envelope } from '../types.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const work = mkdtempSync(path.join(tmpdir(), 'signalpost-test-'));
const stateDir = path.join(work, 'state');
const input = path.join(work, 'batch.csv');
// header, 5 fixtures, a bad checksum, and a duplicate
writeFileSync(input, ['orgnr', '910000063', '910 000 098', '910000217', '910000322', '910000357', '123456789', '910000063'].join('\n'));

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

function run(outName: string, env: Record<string, string> = {}, extra: string[] = []): Envelope[] {
  const out = path.join(work, outName);
  execFileSync(
    process.execPath,
    ['--import', 'tsx', '--import', path.join(root, 'agent/test/mock-fetch.ts'), path.join(root, 'agent/run.ts'), input, out, '--state-dir', stateDir, '--run-id', outName, ...extra],
    { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return readFileSync(path.join(out, 'envelopes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

const by = (envs: Envelope[], o: string) => envs.find((e) => e.organisation_number === o)!;

// --- Run 1: cold start --------------------------------------------------------
const r1 = run('run1');
check(r1.length === 6, `one envelope per unique input (got ${r1.length}, expected 6)`);
check(r1.map((e) => e.input_index).join() === '0,1,2,3,4,5', 'envelopes written in input order');
const A1 = by(r1, '910000063');
const B1 = by(r1, '910000098');
const C1 = by(r1, '910000217');
check(A1.state === 'available' && A1.legal_identity?.legal_name === 'TESTSELSKAP ALPHA AS', 'A: available with exact legal identity');
check(B1.state === 'available', 'B: available (spaced org number normalised)');
check(C1.state === 'failed' && C1.claims.length === 0 && C1.legal_identity === null, 'C: registry failure → failed, zero claims, no invented identity');
check(by(r1, '910000322').state === 'not_available' && by(r1, '910000322').claims.length === 0, 'D: unknown number → not_available, no claims');
check(by(r1, '910000357').state === 'not_available' && by(r1, '910000357').legal_identity?.registry_status === 'deleted', 'E: deleted number → not_available, status deleted');
check(by(r1, '123456789').state === 'failed' && by(r1, '123456789').errors[0]?.code === 'invalid_organisation_number', 'bad checksum → failed with invalid_organisation_number');

check(B1.availability.employees.state === 'not_available' && !B1.claims.some((c) => c.family === 'employees'), 'B: unregistered employee count is NOT published as 0');
check(B1.availability.annual_accounts.state === 'not_available', 'B: no filed accounts → not_available');
check(B1.availability.locations.reason === 'checked_no_active_sub_units', 'B: checked-but-empty locations distinguished from not-checked');
check(A1.availability.job_postings.reason === 'not_checked_in_this_version', 'unchecked families are labelled as not checked');

const evIds = new Set(A1.evidence.map((e) => e.id));
check(A1.claims.every((c) => c.evidence_ids.length > 0 && c.evidence_ids.every((id) => evIds.has(id))), 'A: every claim points to existing evidence');
check(A1.evidence.every((e) => e.source_url.startsWith('https://data.brreg.no/') && e.retrieved_at && e.content_sha256), 'A: evidence has source URL, retrieval time and content hash');
check(A1.claims.filter((c) => c.family === 'annual_accounts').every((c) => c.reporting_period?.from === '2025-01-01'), 'A: every accounts claim carries its reporting period');
const roleNames = A1.claims.filter((c) => c.field === 'role').map((c) => (c.value as any).name);
check(roleNames.includes('Ola Testmann') && roleNames.includes('Per Prøve Hansen') && roleNames.includes('TESTREVISJON AS'), 'A: CEO, chair and auditor published');
check(!roleNames.includes('Gammel Fratrådt'), 'A: resigned board member not published');
check(!JSON.stringify(A1.claims).includes('1980-01-01'), 'A: birth dates not published');
check(A1.claims.filter((c) => c.field === 'sub_unit').length === 1, 'A: closed sub-unit excluded, active one published');
check(A1.summary.text.includes('Programmeringstjenester') && A1.summary.text.includes('Ola Testmann'), 'A: summary says what it does and who runs it');
check(A1.refresh.baseline === 'cold_start' && A1.refresh.changes.length === 0, 'A: cold start reports no changes');
const report = JSON.parse(readFileSync(path.join(work, 'run1', 'run-report.json'), 'utf8'));
check(report.one_envelope_per_input === true && report.third_party_cost_usd === 0, 'run report confirms one envelope per input and $0 third-party cost');

// --- Run 2: same snapshot → idempotent ---------------------------------------
const r2 = run('run2');
const A2 = by(r2, '910000063');
check(A2.refresh.baseline === 'previous_run' && A2.refresh.changes.length === 0, 'A: re-run on same data → zero changes (no false changes)');
check(JSON.stringify(A2.claims.map((c) => c.id)) === JSON.stringify(A1.claims.map((c) => c.id)), 'A: claim IDs identical across re-runs');
check(JSON.stringify(A2.evidence.map((e) => e.id)) === JSON.stringify(A1.evidence.map((e) => e.id)), 'A: evidence IDs identical across re-runs (no duplicates)');

// --- Run 3: real change -------------------------------------------------------
const A3 = by(run('run3', { MOCK_MUTATE: '1' }), '910000063');
const rev = A3.refresh.changes.find((c) => c.field === 'operating_revenue');
check(rev?.type === 'changed_value' && rev.previous_value === 58_000_000 && rev.new_value === 61_500_000, 'A: revenue change detected with before/after');
check((rev?.previous_evidence.length || 0) > 0, 'A: change keeps the previous evidence');
check(A3.refresh.changes.some((c) => c.type === 'removed_value' && (c.previous_value as any)?.name === 'Ola Testmann') && A3.refresh.changes.some((c) => c.type === 'new_value' && (c.new_value as any)?.name === 'Kari Testesen'), 'A: CEO replacement shows old removed and new added');
check(A3.summary.text.includes('Changes since'), 'A: summary reports what changed');

// --- Run 4: roles source down → no false removals -----------------------------
const A4 = by(run('run4', { MOCK_MUTATE: '1', MOCK_FAIL_ROLES: '1' }), '910000063');
check(A4.availability.roles.state === 'failed', 'A: roles outage reported as failed');
check(!A4.refresh.changes.some((c) => c.family === 'roles'), 'A: roles outage does not create false removals');

// --- Run 5: deadline → still one row per input --------------------------------
const r5 = run('run5', { MOCK_HANG: '910000098' }, ['--deadline-seconds', '3']);
check(r5.length === 6, `deadline: still one envelope per input (got ${r5.length})`);
check(by(r5, '910000098').state === 'failed' && by(r5, '910000098').errors[0]?.code === 'deadline_reached', 'deadline: unfinished company closed out as failed');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}  (work dir: ${work})`);
process.exit(failures ? 1 : 0);
