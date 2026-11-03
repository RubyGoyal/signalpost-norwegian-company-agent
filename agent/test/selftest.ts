// Offline self-test for the batch runner (no network). Run: npm run test:agent

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sameRegistryEvent, utcDay } from '../extract.ts';
import { parseInputText } from '../input.ts';
import { qualityReport } from '../quality.ts';
import { checkUrlShape, isPublicAddress, parseRobots, robotsAllows } from '../web.ts';
import { PLACEHOLDER_POST, adDeadline, careersPageAd, feedItems, findOrgnrs, handleIsSiteBrand, handleMatchesName, normalizeSocial, otherEntities, profilesFrom, publishedDate, sameCompanyName, saysNoOpenings } from '../website.ts';
import type { Envelope } from '../types.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const work = mkdtempSync(path.join(tmpdir(), 'signalpost-test-'));
const stateDir = path.join(work, 'state');
const input = path.join(work, 'batch.csv');
// header, 5 fixtures, a bad checksum, and a duplicate
writeFileSync(input, ['orgnr', '910000063', '910 000 098', '910000217', '910000322', '910000357', '123456789', '910000063', '910000721'].join('\n'));

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

function run(outName: string, env: Record<string, string> = {}, extra: string[] = [], inFile = input): Envelope[] {
  const out = path.join(work, outName);
  execFileSync(
    process.execPath,
    ['--import', 'tsx', '--import', path.join(root, 'agent/test/mock-fetch.ts'), path.join(root, 'agent/run.ts'), inFile, out, '--state-dir', stateDir, '--run-id', outName, ...extra],
    { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return readFileSync(path.join(out, 'envelopes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

const by = (envs: Envelope[], o: string) => envs.find((e) => e.organisation_number === o)!;

// --- Registry timestamps ------------------------------------------------------
check(
  utcDay('2026-10-13T22:04:38.138Z') === '2026-10-13' &&
    utcDay('2026-10-14T00:04:38.138+02:00') === '2026-10-13' &&
    utcDay('2026-01-14T00:30:00+0100') === '2026-01-13' &&
    utcDay('2026-10-14T00:04:38.138') === '2026-10-13' &&
    utcDay('2026-01-14T00:30:00') === '2026-01-13' &&
    utcDay('2026-08-18T18:00:17.195Z') === '2026-08-18' &&
    utcDay('2026-08-18') === '2026-08-18',
  'registry timestamps: the same instant gets the same UTC day however the feed writes it (Z, an offset, or Norwegian local time)'
);
check(
  sameRegistryEvent({ date: '2026-10-13', event: 'employee count updated: 21231', change_type: 'Endring', fields: ['employee count updated'] }, { date: '2026-10-14', event: 'employee count updated: 21231', change_type: 'Endring', fields: ['employee count updated'] }) &&
    !sameRegistryEvent({ date: '2026-10-13', event: 'employee count updated: 21231', change_type: 'Endring', fields: [] }, { date: '2026-10-13', event: 'employee count updated: 21300', change_type: 'Endring', fields: [] }) &&
    !sameRegistryEvent({ date: '2026-10-10', event: 'x', change_type: 'Endring', fields: [] }, { date: '2026-10-13', event: 'x', change_type: 'Endring', fields: [] }),
  'registry events: a one-day date difference with the same content is the same event; a different value or a bigger gap is not'
);

// --- Run 1: cold start --------------------------------------------------------
const r1 = run('run1');
check(r1.length === 7, `one envelope per unique input (got ${r1.length}, expected 7)`);
check(r1.map((e) => e.input_index).join() === '0,1,2,3,4,5,6', 'envelopes written in input order');
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
// v2: registry extras, public activity, hiring
const fieldsA = (f: string) => A1.claims.filter((c) => c.field === f);
check((fieldsA('share_capital')[0]?.value as any)?.amount === 30000 && (fieldsA('former_name')[0]?.value as any)?.name === 'ALPHA TEST HOLDING AS', 'A: share capital and former name published');
check(fieldsA('latest_filed_accounts_year')[0]?.value === '2025' && fieldsA('is_group_member')[0]?.value === false, 'A: latest filed accounts year and group membership published');
check(fieldsA('email')[0]?.value === 'post@alpha-test.no' && A1.availability.contact_points.state === 'available', 'A: registered company email published as a contact point');
const G1 = by(r1, '910000721');
check(G1.state === 'available' && !G1.claims.some((c) => c.family === 'contact_points'), 'G (ENK): personal contact details NOT published');
const ev1 = fieldsA('registry_event').map((c) => (c.value as any).event);
check(A1.availability.public_activity.state === 'available' && ev1.length === 3, `A: 3 dated registry events published (got ${ev1.length})`);
check((fieldsA('registry_event').find((c) => c.key.endsWith('#504'))?.value as any)?.date === '2026-07-02', 'A: a registry event dated by its UTC day (an update at 00:04 Norwegian time is filed the day before)');
check(ev1.some((t) => t.includes('annual accounts filed: 2025')) && ev1.some((t) => t.includes('employee count updated: 42')), 'A: events describe what changed');
check(!ev1.some((t) => /registreringsdato/.test(t)), 'A: bookkeeping-only changes and empty "Ukjent" events skipped');
check(!B1.claims.some((c) => c.field === 'registry_event') && B1.availability.public_activity.state === 'available' && B1.claims.every((c) => c.field !== 'site_news' || c.evidence_ids.length === 1), 'B: no registry events; its public activity is the dated post from its own feed');
const ads1 = fieldsA('job_ad');
check(A1.availability.job_postings.state === 'available' && ads1.length === 2, `A: exactly 2 job ads attached (got ${ads1.length})`);
check(ads1.some((c) => (c.value as any).title === 'Kokk' && (c.value as any).employer_name === 'Alpha Kantine Bergen'), 'A: ad posted under a brand name found by employer organisation number');
check((ads1[0]?.value as any)?.employer_orgnr === '910000462' && (ads1[0]?.value as any)?.matched_via === 'sub_unit', 'A: ad confirmed via sub-unit org number, not by name');
check(!JSON.stringify(A1.claims).includes('private@example.com') && !JSON.stringify(A1.claims).includes('Private Person'), 'A: ad contact persons NOT published');
check(!JSON.stringify(A1.claims).includes('Selger') && !JSON.stringify(A1.claims).includes('910000756'), 'A: namesake employer ad (different org number) NOT attached');
check(!JSON.stringify(A1.claims).includes('Gammel stilling'), 'A: ad whose latest feed status is INACTIVE NOT attached');
check(A1.evidence.some((e) => e.source_url.startsWith('https://pam-stilling-feed.nav.no/api/v1/feedentry/')), 'A: job ad evidence points to the NAV feed entry');
check(B1.availability.job_postings.state === 'not_available' && B1.availability.job_postings.reason.startsWith('checked_nav_no_active_ads'), 'B: checked NAV, no ads → not_available with reason');
check(A1.summary.text.includes('Hiring: 2 active job ads') && A1.summary.text.includes('Recent registry activity'), 'A: summary covers hiring and recent activity');
check(A1.evidence.every((e) => e.source_url.startsWith('https://data.brreg.no/') || e.source_url.startsWith('https://pam-stilling-feed.nav.no/') || e.source_url.startsWith('https://www.alpha-test.no/') || e.source_url.startsWith('https://alphatest.teamtailor.com/jobs/')), 'all evidence comes from the registers, NAV, the company\'s own verified site or a job ad its careers page links to');

const evIds = new Set(A1.evidence.map((e) => e.id));
check(A1.claims.every((c) => c.evidence_ids.length > 0 && c.evidence_ids.every((id) => evIds.has(id))), 'A: every claim points to existing evidence');
check(A1.evidence.every((e) => /^https:\/\//.test(e.source_url) && e.retrieved_at && e.content_sha256), 'A: evidence has source URL, retrieval time and content hash');
// latest_filed_accounts_year is a filing status from Enhetsregisteret, not a figure, so it has no period.
check(A1.claims.filter((c) => c.family === 'annual_accounts' && c.field !== 'latest_filed_accounts_year').every((c) => /^202[45]-01-01$/.test(c.reporting_period?.from || '')), 'A: every accounts figure carries its reporting period (two filed years)');
const roleNames = A1.claims.filter((c) => c.field === 'role').map((c) => (c.value as any).name);
check(roleNames.includes('Ola Testmann') && roleNames.includes('Per Prøve Hansen') && roleNames.includes('TESTREVISJON AS'), 'A: CEO, chair and auditor published');
check(!roleNames.includes('Gammel Fratrådt'), 'A: resigned board member not published');
check(!JSON.stringify(A1.claims).includes('1980-01-01'), 'A: birth dates not published');
check(A1.claims.filter((c) => c.field === 'sub_unit').length === 1, 'A: closed sub-unit excluded, active one published');
check(A1.summary.text.includes('Programmeringstjenester') && A1.summary.text.includes('Ola Testmann'), 'A: summary says what it does and who runs it');
check(A1.refresh.baseline === 'cold_start' && A1.refresh.changes.length === 0, 'A: cold start reports no changes');
const report = JSON.parse(readFileSync(path.join(work, 'run1', 'run-report.json'), 'utf8'));
check(report.one_envelope_per_input === true && report.third_party_cost_usd === 0, 'run report confirms one envelope per input and $0 third-party cost');
check(report.quality?.all_checks_passed === true && report.quality.issues === 0 && report.quality.claims_by_source_class.official_registry > 0, `run report: quality checks pass (evidence for every claim, sourced evidence, no website facts without a verified website) (issues: ${JSON.stringify(report.quality?.checks)})`);
check(report.nav_job_feed?.ok === true && report.nav_job_feed.feed_pages === 2 && report.nav_job_feed.active_ads === 3 && report.nav_job_feed.detail_scan_complete === true, 'run report records the NAV feed read (2 pages, 3 active ads after dedupe, all read)');

// --- Run 2: same snapshot → idempotent ---------------------------------------
const r2 = run('run2');
const A2 = by(r2, '910000063');
check(A2.refresh.baseline === 'previous_run' && A2.refresh.changes.length === 0, 'A: re-run on same data → zero changes (no false changes)');
check(JSON.stringify(A2.claims.map((c) => c.id)) === JSON.stringify(A1.claims.map((c) => c.id)), 'A: claim IDs identical across re-runs');
check(JSON.stringify(A2.evidence.map((e) => e.id)) === JSON.stringify(A1.evidence.map((e) => e.id)), 'A: evidence IDs identical across re-runs (no duplicates)');

// --- Run 3: real change -------------------------------------------------------
const A3 = by(run('run3', { MOCK_MUTATE: '1' }), '910000063');
check(A3.summary.statements[1]?.text.startsWith("What's new") && A3.summary.statements[1].text.includes(`Since the last check on ${A3.refresh.previous_retrieved_at?.slice(0, 10)}: ${A3.changes.length} change`), '"What\'s new" on a re-run also counts the changes since the last check (listed with their previous evidence under Changes)');
const rev = A3.refresh.changes.find((c) => c.field === 'operating_revenue');
check(rev?.type === 'changed_value' && rev.previous_value === 58_000_000 && rev.new_value === 61_500_000, 'A: revenue change detected with before/after');
check((rev?.previous_evidence.length || 0) > 0, 'A: change keeps the previous evidence');
check(A3.refresh.changes.some((c) => c.type === 'removed_value' && (c.previous_value as any)?.name === 'Ola Testmann') && A3.refresh.changes.some((c) => c.type === 'new_value' && (c.new_value as any)?.name === 'Kari Testesen'), 'A: CEO replacement shows old removed and new added');
check(A3.summary.text.includes('Changes since'), 'A: summary reports what changed');
const ev504 = A3.claims.find((c) => c.key.endsWith('registry_event#504'));
check((ev504?.value as any)?.date === '2026-07-02' && !A3.refresh.changes.some((c) => c.key.endsWith('registry_event#504')), `QA run (Equinor): the same registry update written with a Norwegian time offset keeps its day and is not reported as a change (got ${(ev504?.value as any)?.date})`);
const changesLine = A3.summary.statements.find((s) => s.text.startsWith('Changes since'))?.text || '';
check(changesLine.includes('new registry event: 2026-10-20: website changed: www.alpha-test.no') && !/[{}]|"date"|change_type/.test(changesLine), `QA run (Equinor): the summary's change list is written in words, never raw JSON (got ${changesLine.slice(0, 300)})`);

// --- Run 4: roles source down → no false removals -----------------------------
const A4 = by(run('run4', { MOCK_MUTATE: '1', MOCK_FAIL_ROLES: '1' }), '910000063');
check(A4.availability.roles.state === 'failed', 'A: roles outage reported as failed');
check(!A4.refresh.changes.some((c) => c.family === 'roles'), 'A: roles outage does not create false removals');

// --- Run 4b: NAV down → hiring failed, nothing removed, nothing invented ---------
const A4b = by(run('run4b', { MOCK_MUTATE: '1', MOCK_NAV_DOWN: '1' }), '910000063');
check(!A4b.claims.some((c) => c.field === 'job_ad') && A4b.errors.some((e) => e.source === 'nav_job_feed') && A4b.availability.job_postings.reason === 'found_on_company_website_nav_unavailable', 'NAV outage: no NAV ads published, error recorded; careers-page openings still shown');
check(!A4b.refresh.changes.some((c) => c.field === 'job_ad'), 'NAV outage: no false job removals');
check(A4b.availability.legal_identity.state === 'available', 'NAV outage: registry facts unaffected');

// --- Run 4c: jobs switched off → not checked, no removals ------------------------
const A4c = by(run('run4c', { MOCK_MUTATE: '1', SIGNALPOST_JOBS: 'off' }), '910000063');
check(!A4c.claims.some((c) => c.field === 'job_ad') && !A4c.refresh.changes.some((c) => c.field === 'job_ad'), 'jobs off: NAV not checked, no false removals');

// --- Run 4d: the ad goes inactive → reported as removed, previous evidence kept ---
const A4d = by(run('run4d', { MOCK_MUTATE: '1', MOCK_AD_INACTIVE: '1' }), '910000063');
const gone = A4d.refresh.changes.find((c) => c.field === 'job_ad' && c.type === 'removed_value');
check(!A4d.claims.some((c) => (c.value as any)?.title === 'Senior utvikler') && gone?.type === 'removed_value' && (gone.previous_value as any)?.title === 'Senior utvikler' && (gone.previous_evidence?.length || 0) > 0, 'inactive ad: removed from profile, change recorded with previous evidence');

// --- Run 5: deadline → still one row per input --------------------------------
const r5 = run('run5', { MOCK_HANG: '910000098' }, ['--deadline-seconds', '3']);
check(r5.length === 7, `deadline: still one envelope per input (got ${r5.length})`);
check(by(r5, '910000098').state === 'failed' && by(r5, '910000098').errors[0]?.code === 'deadline_reached', 'deadline: unfinished company closed out as failed');

// --- Input parsing: no organisation-number row is dropped -------------------------
const p = (t: string) => parseInputText(t).orgnrs.join();
check(p('Org. nr.;Navn\n910 000 063;A AS\n"910000098";B AS\n') === '910000063,910000098', 'input: CSV with a named org-number column and quoted cells');
check(p('id,name,organisasjonsnummer\n1,A AS,910000063\n2,B AS,\n') === '910000063', 'input: CSV column picked by header name; blank cell skipped');
check(p('NO910000063MVA\n910.000.098\n') === '910000063,910000098', 'input: "NO ... MVA" and dotted formats');
check(p('{"company_org_number":"910000063"}\n{"id":7,"orgNumber":910000098}\n{"name":"X","value":"910000217"}\n') === '910000063,910000098,910000217', 'input: JSON Lines with unfamiliar key names');
check(p('{"parent_orgnr":"910000098","company_orgnr":"910000063"}') === '910000063', 'input: a parent org-number field is never taken as the company');
check(p('{"companies":[{"orgnr":"910000063"},{"orgnr":910000098}]}') === '910000063,910000098', 'input: JSON object wrapping an array');
check(p('[910000063, "910000098", {"organisation_number": "910000217", "tags": []}]') === '910000063,910000098,910000217', 'input: JSON array of numbers, strings and records');
const bad = parseInputText('orgnr\n91000006\n910000063\n');
check(bad.orgnrs.join() === '91000006,910000063' && bad.skipped === 1, 'input: malformed number kept (reported as invalid), header skipped');
const odd = path.join(work, 'odd.jsonl');
writeFileSync(odd, ['{"OrgNo":"910 000 063"}', '{"orgnr":"91000006"}', '{"orgnr":"910000098"}'].join('\n'));
const r6 = run('run6', {}, ['--jobs', 'off'], odd);
check(r6.length === 3 && by(r6, '91000006')?.errors[0]?.code === 'invalid_organisation_number' && by(r6, '910000063')?.state === 'available', 'input: malformed number gets its own failed envelope, others processed');

// --- Company websites: verification, profiles, contact links ------------------------------
const webIn = path.join(work, 'web.csv');
writeFileSync(webIn, ['orgnr', '910000063', '910000098', '910000802', '910000810', '910000829', '910000837', '910000845', '910000721', '910000888', '910000896', '910000918', '910000926', '910000942', '910000950', '910000977', '910000985', '910000993', '910001000', '910001019'].join('\n'));
const wsState = path.join(work, 'web-state');
const wrun = (name: string, env: Record<string, string> = {}) => {
  const out = path.join(work, name);
  execFileSync(process.execPath, ['--import', 'tsx', '--import', path.join(root, 'agent/test/mock-fetch.ts'), path.join(root, 'agent/run.ts'), webIn, out, '--state-dir', wsState, '--run-id', name], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return readFileSync(path.join(out, 'envelopes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) as Envelope[];
};
const w1 = wrun('web1');
const wq = JSON.parse(readFileSync(path.join(work, 'web1', 'run-report.json'), 'utf8')).quality;
check(wq.all_checks_passed === true && wq.from_company_websites.dated_news_posts_from_feeds >= 2 && wq.from_company_websites.job_ads === 7 && wq.websites.not_published_by_reason['not_available:registered_website_belongs_to_another_entity'] === 1 && wq.websites.published_by_how_verified.registered_and_verified_on_site >= 1, `run report: quality section counts website results and passes on the website fixtures (got ${JSON.stringify(wq).slice(0, 400)})`);
const wa = (o: string) => by(w1, o).availability;
const wc = (o: string, f: string) => by(w1, o).claims.filter((c) => c.field === f);
const aSite = wc('910000063', 'website')[0];
check(wa('910000063').official_website.reason === 'registered_and_verified_on_site' && aSite?.evidence_ids.length === 2 && aSite.confidence === 0.99, 'website: registered website verified by the organisation number on the site (2 sources)');
const aSiteEv = by(w1, '910000063').evidence.find((e) => e.source_url === 'https://www.alpha-test.no/' && e.claim_span.includes('910 000 063'));
check(!!aSiteEv && aSiteEv.source_class === 'company_owned' && !!aSiteEv.content_sha256, 'website: evidence quotes the site text with the organisation number, hashed');
const prof = wc('910000063', 'social_profile').map((c) => (c.value as any).url).sort();
check(prof.join() === 'https://facebook.com/testselskapalpha,https://instagram.com/testselskap_alpha_as,https://linkedin.com/company/alpha-test', `profiles: accounts named after the company or its own verified domain; parent group, sister company, web agency, theme and share link left out (got ${prof})`);
check(wc('910000063', 'email').map((c) => c.value).sort().join() === 'post@alpha-test.no,salg@alpha-test.no' && !JSON.stringify(by(w1, '910000063').claims).includes('webbyraa.no'), 'contacts: site email on its own domain added; other-domain email excluded; registered email not duplicated');
check(!JSON.stringify(by(w1, '910000063').claims).includes('ola.nordmann') && !JSON.stringify(by(w1, '910000063').claims).includes('91234567'), "contacts: a staff member's own email and phone are not published (role addresses and the main number only)");
check(wc('910000063', 'phone').map((c) => c.value).join() === '+47 22334455', 'contacts: the main phone number on the verified site added');
const bSite = wc('910000098', 'website')[0];
check((bSite?.value as any)?.url === 'https://testselskap-beta.no/' && (bSite?.value as any)?.found_via === 'name_domain_check', 'website: name-spelled domain verified by name plus registered address');
check(!JSON.stringify(by(w1, '910000098').claims).includes('testselskapbeta.no'), 'website: namesake site showing another organisation number rejected');
check(wa('910000802').official_website.state === 'ambiguous' && !wc('910000802', 'website').length, 'website: group site listing several companies → ambiguous, not published');
check(wa('910000810').official_website.reason === 'registered_website_parked' && !wc('910000810', 'website').length, 'website: parked registered domain not published as a website');
check(!wc('910000829', 'website').length && !by(w1, '910000829').source_snapshots.some((s) => s.source_url.includes('epsilon-test.no') && s.ok), 'website: domain resolving to a private address is never contacted');
check(wc('910000837', 'website')[0]?.evidence_ids.length === 1 && !wc('910000837', 'social_profile').length && !by(w1, '910000837').source_snapshots.some((s) => s.source_url.includes('zeta-test.no') && s.ok), 'website: robots.txt disallow respected (page not read, registered website kept as registered)');
check((wc('910000896', 'website')[0]?.value as any)?.found_via === 'registered_email_domain' && wa('910000896').official_website.state === 'available', 'website: email-domain site verified by the full legal name in its text');
check(!wc('910000845', 'website').length && wa('910000845').official_website.reason === 'no_verified_website_found', 'website: name alone on a guessed domain is not enough; a mail-only email domain is "no site", not a failure');
check(!by(w1, '910000721').claims.some((c) => c.family === 'contact_points'), 'website: no contact details for a sole proprietorship');
check((wc('910000888', 'social_profile')[0]?.value as any)?.url === 'https://facebook.com/testselskaptheta' && wa('910000888').company_profiles.reason === 'registered_in_enhetsregisteret' && !by(w1, '910000888').source_snapshots.some((s) => s.source === 'company_website'), 'profiles: a Facebook page registered as the website becomes a registered profile; the platform is not crawled');
const w2 = wrun('web2');
check(w2.every((e) => e.refresh.changes.length === 0) && JSON.stringify(by(w2, '910000063').evidence.map((e) => e.id)) === JSON.stringify(by(w1, '910000063').evidence.map((e) => e.id)), 'website: re-run → zero changes, identical evidence IDs');
const w3 = wrun('web3', { MOCK_SITE_DOWN: '1' });
const a3 = by(w3, '910000063');
check(a3.availability.company_profiles.state === 'failed' && !a3.refresh.changes.some((c) => c.family === 'company_profiles' || c.key.includes('#website#')), 'website down: profiles failed, no false removals of profiles or site contacts');
check(a3.claims.some((c) => c.field === 'website') && a3.refresh.changes.length === 0, 'website down: registered website still published, nothing reported as changed');
const w4 = wrun('web4', { MOCK_NO_WEB: '1' });
check(by(w4, '910000098').availability.official_website.reason === 'website_check_not_run' && !by(w4, '910000098').refresh.changes.some((c) => c.type === 'removed_value'), 'no public web: website step reported as not run, no false removals');
const w5 = wrun('web5', { SIGNALPOST_JOBS_DETAIL_SCAN: 'off' });
check(wc('910000063', 'job_ad').length === 2 && by(w5, '910000063').claims.filter((c) => c.field === 'job_ad').length === 1, 'hiring: without the full ad read only the name-matched ad is found (fallback still confirms by number)');
const w6 = wrun('web6', { MOCK_SITE_GONE: '1' });
const goneChanges = ['910000098', '910001000'].flatMap((o) => by(w6, o).refresh.changes.filter((c) => c.type === 'removed_value'));
check(
  !by(w6, '910000098').claims.some((c) => c.field === 'website') && !by(w6, '910001000').claims.some((c) => c.field === 'website') && goneChanges.length === 0,
  `live run on 1,000 companies: a verified site that does not answer on a re-run is not published, and is not reported as removed (got ${goneChanges.map((c) => c.field).join(',')})`
);
const w7 = wrun('web7');
const w8 = wrun('web8', { MOCK_JOBLIST_DOWN: '1' });
check(!by(w8, '910000993').refresh.changes.some((c) => c.field === 'site_job'), `live run on 1,000 companies: when the job list cannot be read on a re-run, its openings are not reported as closed (got ${by(w8, '910000993').refresh.changes.map((c) => c.type + ' ' + c.field).join(', ')})`);
const w9 = wrun('web9');
check(by(w9, '910000993').refresh.changes.length === 0 && wc('910000993', 'site_job').length === by(w9, '910000993').claims.filter((c) => c.field === 'site_job').length, 'live run on 1,000 companies: when the job list answers again, the same openings are back with no change reported');
const w10 = wrun('web10', { MOCK_FLAKY_ONCE: '1' });
check(by(w10, '910001000').availability.official_website.reason === 'registered_and_verified_on_site' && by(w10, '910001000').claims.some((c) => c.field === 'site_news') && by(w10, '910001000').refresh.changes.length === 0, `full live run: a site whose first requests time out gets a second look in the same run and is verified (got ${by(w10, '910001000').availability.official_website.state} ${by(w10, '910001000').availability.official_website.reason})`);
check(['910000098', '910001000'].every((o) => by(w7, o).refresh.changes.length === 0 && by(w7, o).claims.some((c) => c.field === 'website') && by(w7, o).claims.some((c) => c.field === 'site_news')), `live run on 1,000 companies: when that site answers again, it and its news are back with no change reported in either direction (got ${['910000098', '910001000'].flatMap((o) => by(w7, o).refresh.changes.map((c) => c.type + ' ' + c.field)).join(', ')})`);

// --- Site news, careers page and the at-a-glance summary ---------------------------------
const aW = by(w1, '910000063');
const newsA = aW.claims.filter((c) => c.field === 'site_news').map((c) => `${(c.value as any).date} ${(c.value as any).title}`).sort();
check(newsA.join('|') === '2025-03-03 Vi flytter til nye lokaler|2026-06-01 Alpha lanserer ny plattform|2026-08-10 Ny styreleder valgt|2026-09-05 Vi åpner kontor i Tromsø|2026-09-15 Ny avtale med Bergen kommune|2026-10-14 Alpha åpner avdeling i Trondheim', `site news: dated posts only, publish date not "updated" date; menu labels, archive, product pages, the listing's own data, modified-only dates and a neighbour's date left out (got ${newsA.join('|')})`);
check(aW.claims.filter((c) => c.field === 'site_news').every((c) => c.source_date && c.family === 'public_activity'), 'site news: each item is dated public activity');
check(aW.evidence.some((e) => e.source_url === 'https://www.alpha-test.no/feed/') && !JSON.stringify(aW.claims).includes('prisliste') && !JSON.stringify(aW.claims).includes('partner.example.com') && !JSON.stringify(aW.claims).includes('Kommentar') && !JSON.stringify(aW.claims).includes('/produkt/'), "site feed: posts read with their RSS publish date; an item with only an updated date, another site's post, a shop page, an old post and the comment feed left out; a post already on the news page counted once");
const newsB = by(w1, '910000098').claims.filter((c) => c.field === 'site_news').map((c) => `${(c.value as any).date} ${(c.value as any).title}`);
check(newsB.join('|') === '2026-08-01 Nye kontorlokaler ledige i sentrum', `site feed: an Atom entry dated by <published>, never <updated>; an entry with only <updated> left out (got ${newsB.join('|')})`);
const jobsA = aW.claims.filter((c) => c.field === 'site_job').map((c) => (c.value as any).title).sort();
check(jobsA.join('|') === 'Backend-utvikler|Designer|Driftstekniker|Prosjektleder', `jobs: single ads whose hiring organisation is this company (by name or organisation number); sister company's ad, parent's posting, posting without employer, posting without its own ad page, FINN and NAV searches, expired data and the site's own pages left out (got ${jobsA.join('|')})`);
check(aW.claims.filter((c) => c.field === 'site_job').every((c) => (c.value as any).hiring_organisation && /^https:\/\/(alphatest\.teamtailor\.com\/jobs\/\d+-|www\.alpha-test\.no\/karriere\/.+)/.test((c.value as any).url)), 'jobs: each ad names its hiring organisation and points to the single ad, never to the careers landing page');
check(!jobsA.some((t) => ['Servicetekniker', 'Elektriker', 'Kokk', 'Lagerarbeider'].includes(t)) && jobsA.includes('Driftstekniker'), 'jobs (Builderr feedback): every linked ad is opened and must show a live opening; an ad page saying "ingen ledige stillinger", an ad that sends the reader back to the list and a closed ad are left out; "Finner du ingen ledige stillinger som passer?" next to real ads does not hide them');
check(!wc('910001019', 'site_job').length && wa('910001019').job_postings.reason.endsWith('_and_careers_page_says_no_open_positions') && by(w1, '910001019').summary.text.includes('its careers page says there are no open positions'), 'jobs (Builderr feedback): a careers page saying "ingen ledige stillinger" gives no openings, even with old job data on it; the reader is told why');
check(!aW.claims.some((c) => c.field === 'site_job' && String((c.value as any).url).includes('11111111-1111')), 'careers page: a link to a NAV ad already attached is not counted twice');
check(!aW.claims.some((c) => c.field === 'careers_page') && !aW.summary.text.includes('careers page') && aW.availability.job_postings.checked_sources.includes('company_website'), 'jobs: a careers landing page is not published as a job; the website is recorded as checked');
check(aW.summary.statements[0]?.text.startsWith('At a glance: TESTSELSKAP ALPHA AS is a private limited company (AS) in Oslo') && aW.summary.text.includes('up 16% on 2024') && aW.summary.text.includes('it is hiring'), 'summary: at-a-glance line with form, place, revenue trend and hiring');
check(aW.summary.text.includes('Latest news on its website: 2026-10-14 "Alpha åpner avdeling i Trondheim"') && aW.summary.text.includes('job ads for this company linked from its website'), 'summary: latest site news and job ads from the website');
check(by(w1, '910000098').summary.statements[0]?.text.startsWith('At a glance: TESTSELSKAP BETA AS is a private limited company (AS) in Bergen'), 'summary: at-a-glance line for a sparse profile');
const newA = aW.summary.statements[1];
check(newA?.text.startsWith("What's new (past 12 months, newest first): 2026-10-14 latest of") && newA.text.includes('2026-08-18 annual accounts filed: 2025 (operating revenue up 16% on 2024)') && newA.evidence_ids.length >= 3 && newA.evidence_ids.every((id) => aW.evidence.some((e) => e.id === id)), `summary (Builderr feedback): "What's new" comes right after the at-a-glance line, newest first, each item with its evidence (got ${newA?.text.slice(0, 200)})`);
check(by(w1, '910001019').summary.statements[1]?.text === "What's new: nothing dated in the past 12 months in the sources checked.", "summary: \"What's new\" says plainly when nothing dated was found");
// Builderr audit: the website must be the company's own (not a group, chain or brand site), and
// nothing is read from a site that is not.
const noSiteData = (o: string) => !by(w1, o).claims.some((c) => ['website', 'social_profile', 'site_news', 'site_job'].includes(c.field) || c.key.includes('#website#'));
check(wa('910000918').official_website.state === 'ambiguous' && wa('910000918').official_website.reason === 'registered_website_shows_several_companies' && noSiteData('910000918'), 'audit: registered group site naming several companies (no org numbers) → not published; no profiles, news or jobs from it');
check(wa('910000926').official_website.reason === 'registered_website_belongs_to_another_entity' && noSiteData('910000926'), "audit: registered chain site showing the chain's org number → not published; its social links not used");
check(wa('910000942').official_website.reason === 'registered_website_not_verified' && noSiteData('910000942'), 'audit: registered brand site showing neither name nor org number → not published');
check(by(w1, '910000942').summary.text.includes("the registered site shows neither this company's name nor its organisation number"), 'audit: summary says why the registered site is not published');
const tauSite = wc('910000950', 'website')[0];
check((tauSite?.value as any)?.url === 'https://www.tau-gruppen.no/selskaper/tau-bygg' && tauSite.evidence_ids.length === 2 && wa('910000950').official_website.state === 'available', "audit: this company's page on the group's site verified by its org number and name; published as that page");
check(wc('910000950', 'social_profile').map((c) => (c.value as any).url).join() === 'https://facebook.com/taubygg' && !wc('910000950', 'site_news').length && !wc('910000950', 'site_job').length && !by(w1, '910000950').claims.some((c) => c.key.includes('#website#')), "audit: on a page of the group's site only the company's own account is used; the group's news, jobs and email are not");
check((wc('910000993', 'website')[0]?.value as any)?.url && wa('910000993').official_website.state === 'available', 'live check: a title that names the company only as a whole ("Bemanning | Sigma Personal | Telemark & Agder") verifies the site');
check(wa('910001000').official_website.state === 'available' && wc('910001000', 'website')[0]?.evidence_ids.length === 2, 'live check: a thin homepage named after a one-word company on its own name domain is verified');
check(wa('910001019').official_website.state === 'available' && wc('910001019', 'email').some((c) => c.value === 'post@xi-test.no'), 'live check: a front page that redirects deeper on the same site is still the whole site (its contacts are used)');
check(wc('910000977', 'website')[0]?.confidence === 0.8 && wa('910000977').official_website.state === 'available' && wa('910000985').official_website.state === 'blocked' && !wc('910000985', 'website').length, 'audit: a registered site behind bot protection is kept only when its domain carries the company name');
check(!wc('910000896', 'site_news').length && wa('910000896').official_website.state === 'available', 'audit: a web shop\'s "Nyheter" (new products) is not read as news');
check(wc('910000993', 'site_news').map((c) => `${(c.value as any).date} ${(c.value as any).title}`).sort().join('|') === '2026-03-27 Påskeferie 2026 for kontoret|2026-09-12 Nytt kontor i Arendal', `news (Builderr feedback, hand check): a dated post shown on the homepage is read when the site has no news page; an undated card and a service page are not; a card whose date disagrees with the WordPress date in its own address (treteam.no) is dated by the address (got ${wc('910000993', 'site_news').map((c) => (c.value as any).date + ' ' + (c.value as any).title).join('|')})`);
check(wc('910000993', 'site_job').map((c) => `${(c.value as any).title} | ${(c.value as any).url}`).sort().join() === 'Rekrutteringskonsulent | https://emp.jobylon.com/jobs/50001-sigma-personal-rekrutteringskonsulent/,Selger | https://emp.jobylon.com/jobs/50003-sigma-personal-selger/' && by(w1, '910000993').evidence.some((e) => e.source_url.startsWith('https://emp.jobylon.com/jobs/50001')), `jobs (hand check: homely.no): single ads behind a careers page's link to the company's Jobylon list are read through the list's embed script; a client's ad on the list is left out (got ${wc('910000993', 'site_job').map((c) => (c.value as any).title).join('|')})`);
check(wc('910000993', 'site_job').some((c) => (c.value as any).title === 'Selger' && (c.value as any).posted === '2024-02-28') && !wc('910000993', 'site_job').some((c) => (c.value as any).title === 'Lagermedarbeider'), "jobs (QA run, homely.no): an old \"apply as soon as possible\" ad that the employer's live Jobylon list still carries is an opening; one whose page says it is closed is not");
check(['Hello world!', 'Hei, verden!', 'Hallo verden', 'Hej världen!', 'Velkommen til bloggen min'].every((t) => PLACEHOLDER_POST.test(t)) && !['Hei, verden! Vi har åpnet nytt kontor', 'Our first post-pandemic fair', 'Nytt kontor i Arendal'].some((t) => PLACEHOLDER_POST.test(t)), 'news (live run on 1,000 companies): a new site\'s sample post ("Hei, verden!", "Hello world!") is not news');
check(wc('910001000', 'site_job').map((c) => `${(c.value as any).title} | ${(c.value as any).url} | ${(c.value as any).expires}`).join() === 'Idehuset søker deltidsmedarbeider til galleriet | https://www.idehuset.no/ledig-stilling/ | 2099-11-13' && wc('910001000', 'site_job')[0]?.evidence_ids.length === 1, `jobs (hand check: fod.no): a careers page written as one job ad is published as that opening, with its deadline (got ${wc('910001000', 'site_job').map((c) => JSON.stringify(c.value)).join()})`);
check(wc('910001000', 'site_news').map((c) => (c.value as any).title).join() === 'Ny utstilling i Skien' && by(w1, '910001000').evidence.some((e) => e.source_url === 'https://www.idehuset.no/feed/'), 'news (Builderr feedback): a feed the site does not declare is read at the standard WordPress address');
const aW3 = by(w3, '910000063');
check(!aW3.refresh.changes.some((c) => c.field === 'site_job' || c.field === 'site_news'), 'website down: no false removals of site news or job ads');

// --- Quality checks catch a bad envelope ----------------------------------------------------
const badEnv = JSON.parse(JSON.stringify(by(w1, '910000063'))) as Envelope;
badEnv.claims[0].evidence_ids = ['ev:missing'];
badEnv.availability.official_website = { state: 'not_available', reason: 'registered_website_not_verified', checked_sources: [] };
const badQ = qualityReport([badEnv]);
check(!badQ.all_checks_passed && badQ.checks.claims_without_evidence === 1 && badQ.checks.website_facts_without_a_verified_website === 1, 'quality checks: a claim with missing evidence and website facts without a verified website are caught');

// --- Website helpers --------------------------------------------------------------------
check([...findOrgnrs('Org.nr. 810 034 882 MVA').keys()].join() === '810034882' && findOrgnrs('Ring 810034882').size === 0 && findOrgnrs('Oslo, Norge 810034882').size === 0, 'helpers: organisation numbers only counted where presented as such');
check(normalizeSocial('https://no.linkedin.com/in/ola-nordmann') === null && normalizeSocial('https://www.facebook.com/sharer/sharer.php?u=x') === null && normalizeSocial('https://www.facebook.com/wix') === null, 'helpers: personal, share and vendor links rejected');
check(['brunvoll6021|BRUNVOLL AS', 'certego-norge|CERTEGO AS', 'FlexiformAS|FLEXIFORM AS', 'flexiform.no|FLEXIFORM AS', 'christie-nordang-as|CHRISTIE NORDANG AS', 'bertelosteen|BERTEL O. STEEN AS'].every((x) => handleMatchesName(x.split('|')[0], x.split('|')[1])), 'helpers: company handles matched (legal form, country, digits and initials allowed)');
check(!['kappagruppen|KAPPA BYGG AS', 'kappa|KAPPA BYGG AS', 'nordicgroup|NORDIC AS', 'nordicwebagency|NORDIC AS', 'webbyraa|TESTSELSKAP ALPHA AS', 'alpha-test|TESTSELSKAP ALPHA AS', 'testselskap-alpha-eiendom|TESTSELSKAP ALPHA AS'].some((x) => handleMatchesName(x.split('|')[0], x.split('|')[1])), 'helpers: parent group, sister company, agency and brand handles rejected');
check(JSON.stringify(feedItems('<rss><channel><lastBuildDate>Thu, 22 Oct 2026 09:00:00 +0000</lastBuildDate><item><title><![CDATA[A &amp; B]]></title><link>https://x.no/a</link><pubDate>Wed, 14 Oct 2026 08:00:00 +0000</pubDate></item><item><title>C</title><link>https://x.no/c</link><atom:updated>2026-10-20</atom:updated></item></channel></rss>')) === JSON.stringify([{ title: 'A & B', url: 'https://x.no/a', date: '2026-10-14' }, { title: 'C', url: 'https://x.no/c', date: null }]), 'helpers: feed items dated by pubDate; lastBuildDate and updated dates never used');
check(feedItems('<rss><channel><title>Produkter &#8211; Lappeliten.no</title><item><title>Barneflaske, Fantus</title><link>https://lappeliten.no/barneflaske-fantus/</link><pubDate>Thu, 25 Jun 2026 08:00:00 +0000</pubDate></item></channel></rss>').length === 0 && feedItems('<rss><channel><title>Nyheter</title><item><title>Matboks</title><link>https://x.no/matboks/</link><guid isPermaLink="false">https://x.no/?post_type=product&#038;p=1</guid><pubDate>Thu, 25 Jun 2026 08:00:00 +0000</pubDate></item></channel></rss>').length === 0, 'live check: a shop\'s product feed (and product items in a feed) is not news');
check(publishedDate('<p>Publisert 05.09.2026 · Oppdatert 01.10.2026</p>') === '2026-09-05' && publishedDate('<time class="updated" datetime="2026-10-15">15.10.2026</time>') === null && publishedDate('<p>Sist endret 3. mars 2026</p>') === null && publishedDate('<time datetime="2026-02-01">1. feb</time>') === '2026-02-01', 'helpers: publish date read; updated or modified dates ignored');
check(otherEntities([{ title: 'Kappa Gruppen', text: 'Kappa Gruppen består av Kappa Bygg AS, Kappa Elektro AS og Kappa Eiendom AS.\n© Kappa Gruppen AS' }], 'KAPPA BYGG AS').length === 3 && otherEntities([{ title: 'Iota', text: 'Copyright © 2026 Iota Handel og Service AS – alle rettigheter reservert' }], 'IOTA HANDEL OG SERVICE AS').length === 0, 'helpers: other companies named on a page counted (the company itself not)');
const brandVerdict = (title: string, text: string, scoped = false) => ({ status: 'exact', scoped, candidate: { domain: 'treteam.no' }, pages: [{ title, text, links: [], sameAs: [] }] }) as any;
check(handleIsSiteBrand('treteam', brandVerdict('Tre Team', 'Tre Team Entreprenør AS bygger hus.'), 'TRE TEAM ENTREPRENØR AS') && !handleIsSiteBrand('treteam', brandVerdict('Tre Team', 'Tre Team Entreprenør AS er eid av Treteam AS.'), 'TRE TEAM ENTREPRENØR AS') && !handleIsSiteBrand('treteam', brandVerdict('Tre Team', 'Tre Team Entreprenør AS', true), 'TRE TEAM ENTREPRENØR AS'), "helpers: a handle equal to the company's own domain is its brand, unless another company on the site has that name or the site is someone else's");
check(handleMatchesName('fod-foreningen-for-omplassering-av-dyr', 'FORENINGEN FOR OMPLASSERING AV DYR FOD'), 'helpers: small words of the legal name ("for", "av") allowed in a handle');
const shortDomain = (domain: string) => ({ status: 'exact', scoped: false, candidate: { domain }, pages: [{ title: 'Indre Kåfjord barne- og ungdomsskole', text: 'Indre Kåfjord barne- og ungdomsskole', links: [], sameAs: [] }] }) as any;
check(handleIsSiteBrand('ikskole', shortDomain('ikskole.no'), 'INDRE KÅFJORD BARNE- OG UNGDOMSSKOLE') && !handleIsSiteBrand('ikskolen', shortDomain('ikskole.no'), 'INDRE KÅFJORD BARNE- OG UNGDOMSSKOLE') && !handleIsSiteBrand('ikskoleoslo', shortDomain('ikskole.no'), 'INDRE KÅFJORD BARNE- OG UNGDOMSSKOLE') && !handleIsSiteBrand('wixsite', shortDomain('wixsite.com'), 'INDRE KÅFJORD BARNE- OG UNGDOMSSKOLE'), "profiles (hand check: ikskole.no): an account named exactly after the site's own short domain is the company's, even when that name is not a word of its legal name; a longer handle or a site builder's name is not");
check(
  adDeadline('Søknadsfrist: 13/11. Intervjuer holdes fortløpende.', '2026-11-03') === '2026-11-13' &&
    adDeadline('Søknadsfrist: 13.11.2026', '2026-11-03') === '2026-11-13' &&
    adDeadline('Søknadsfrist 1. desember', '2026-11-03') === '2026-12-01' &&
    adDeadline('Søknadsfrist: 05.01', '2026-12-20') === '2027-01-05' &&
    adDeadline('Søknadsfrist: snarest', '2026-11-03') === null,
  'jobs (hand check): an application deadline read with or without its year ("13/11", "1. desember"); "snarest" gives none'
);
const fodHtml = (h2: string, extra = '') => `<h1>Ledig stilling</h1><h2>${h2}</h2>${extra}`;
const fodText = (h2: string, rest = 'Stillingsprosent: 30-50%. Ansettelsesform: fast stilling. Søknadsfrist: 13/11. Send søknad og CV til leder@fod.no.') => `Ledig stilling ${h2} Vi søker en engasjert medarbeider. ${rest}`;
const FOD = 'FORENINGEN FOR OMPLASSERING AV DYR FOD';
const t1 = 'FOD søker deltidsmedarbeider til kattehuset og kennelen';
check(
  careersPageAd(fodHtml(t1), fodText(t1), FOD, 'fod.no', '2026-11-03')?.title === t1 &&
    careersPageAd(fodHtml(t1), fodText(t1), FOD, 'fod.no', '2026-11-03')?.deadline === '2026-11-13' &&
    careersPageAd(fodHtml(t1), fodText(t1), FOD, 'fod.no', '2026-11-20') === null &&
    careersPageAd(fodHtml('Kunde AS søker sveiser til verkstedet'), fodText('Kunde AS søker sveiser til verkstedet'), FOD, 'fod.no', '2026-11-03') === null &&
    careersPageAd(fodHtml('Vi søker sveiser til vår kunde i Skien'), fodText('Vi søker sveiser til vår kunde i Skien'), FOD, 'fod.no', '2026-11-03') === null &&
    careersPageAd(fodHtml(t1, '<h2>FOD søker hundetrener</h2>'), fodText(t1), FOD, 'fod.no', '2026-11-03') === null &&
    careersPageAd(fodHtml('Vi søker deg!'), fodText('Vi søker deg!'), FOD, 'fod.no', '2026-11-03') === null &&
    careersPageAd(fodHtml(t1), fodText(t1, 'Stillingen er ikke lenger ledig. Søknadsfrist: 13/11. Stillingsprosent: 50%.'), FOD, 'fod.no', '2026-11-03') === null &&
    careersPageAd(fodHtml(t1), `Ledig stilling ${t1} Vi har mye å gjøre.`, FOD, 'fod.no', '2026-11-03') === null,
  "jobs (hand check: fod.no): a careers page that is itself one job ad by this company, with a deadline that has not passed, is an opening; a passed deadline, another company's or a client's ad, several ads, a generic heading, a closed ad or a page without ad details is not"
);
// Builderr feedback: a parent group's account is not the company's own.
const certego = (links: { url: string; text: string }[], text = 'Certego Norge AS leverer sikkerhet. Org.nr 910 000 063') => ({ status: 'exact', scoped: false, candidate: { domain: 'certego.no' }, pages: [{ title: 'Certego', text, links, sameAs: [], mailto: [], tel: [] }] }) as any;
check(profilesFrom(certego([{ url: 'https://www.facebook.com/certego', text: '' }, { url: 'https://www.facebook.com/certegonorge', text: '' }]), 'CERTEGO NORGE AS').map((x) => x.profile.url).join() === 'https://facebook.com/certegonorge', "profiles (Builderr feedback): for a country arm (Certego Norge AS on certego.no) the bare brand's account (the group's) is left out; its own Norwegian account is kept");
check(!handleIsSiteBrand('treteam', brandVerdict('Tre Team', 'Tre Team Entreprenør AS er en del av Treteam-gruppen.'), 'TRE TEAM ENTREPRENØR AS') && !handleIsSiteBrand('treteam', brandVerdict('Tre Team', 'Tre Team Entreprenør AS eies av Treteam Holding AS.'), 'TRE TEAM ENTREPRENØR AS'), 'profiles (Builderr feedback): no brand accounts on a site that says it is part of a group or names a holding company with the brand');
check(!handleMatchesName('rodekorshjelpekorps', 'RØDE KORS HJELPEKORPS OSLO') && handleMatchesName('rodekorsoslo', 'RØDE KORS HJELPEKORPS OSLO') && !handleMatchesName('bondensmarked', 'BONDENS MARKED VESTFOLD SA'), "profiles (Builderr feedback): a local unit's handle must keep its place word; the national body's account is not the unit's");
const helleland = { status: 'exact', scoped: false, candidate: { domain: 'helleland.one' }, pages: [{ title: 'Advokat Helleland', text: 'Copyright © 2026 Advokat Helleland', links: [{ url: 'https://www.instagram.com/helleland/', text: '' }, { url: 'https://www.facebook.com/advokathelleland', text: '' }], sameAs: [], mailto: [], tel: [] }] } as any;
check(profilesFrom(helleland, 'ADVOKAT HELLELAND', { soleProprietorship: true }).map((x) => x.profile.url).join() === 'https://facebook.com/advokathelleland' && profilesFrom(helleland, 'ADVOKAT HELLELAND').some((x) => x.profile.url === 'https://instagram.com/helleland'), "profiles (hand check): for a sole proprietorship an account named after its domain (the owner's surname) is the owner's personal profile and is left out; a handle with the whole business name is kept");
check(!profilesFrom(certego([{ url: 'https://www.facebook.com/certegonorge', text: 'Følg Certego Group på Facebook' }]), 'CERTEGO NORGE AS').length, 'profiles (Builderr feedback): an account the site introduces as the group\'s is left out even when its handle fits');
check(saysNoOpenings('No Open Positions') && saysNoOpenings('Vi har dessverre ingen ledige stillinger akkurat nå.') && saysNoOpenings('There are currently no open positions.') && !saysNoOpenings('Finner du ingen ledige stillinger som passer deg? Send en åpen søknad.') && !saysNoOpenings("Don't see any open positions that fit? Write to us.") && !saysNoOpenings('Vi har 3 ledige stillinger'), 'helpers: "no open positions" recognised; an invitation to apply openly next to real ads is not');
check(sameCompanyName('Testselskap Alpha', 'TESTSELSKAP ALPHA AS') && sameCompanyName('Certego Norge AS', 'CERTEGO AS') && !sameCompanyName('Alpha Gruppen AS', 'TESTSELSKAP ALPHA AS') && !sameCompanyName('Kappa Gruppen AS', 'KAPPA AS'), 'helpers: hiring organisation matched to the legal name; parent group not');
check(!robotsAllows(parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public'), '/admin/x') && robotsAllows(parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public'), '/admin/public/a'), 'helpers: robots.txt longest-match rules');
check(!isPublicAddress('169.254.169.254') && !isPublicAddress('10.0.0.5') && !isPublicAddress('::1') && !isPublicAddress('::ffff:192.168.1.1') && isPublicAddress('185.70.10.1'), 'helpers: private, link-local and loopback addresses blocked');
check(['http://localhost/', 'https://user:pw@firma.no/', 'https://firma.no:8080/', 'file:///etc/passwd', 'http://169.254.169.254/'].every((u) => 'error' in checkUrlShape(u)), 'helpers: unsafe URL shapes refused');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}  (work dir: ${work})`);
process.exit(failures ? 1 : 0);
