// Offline self-test for the batch runner (no network). Run: npm run test:agent

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseInputText } from '../input.ts';
import { checkUrlShape, isPublicAddress, parseRobots, robotsAllows } from '../web.ts';
import { findOrgnrs, normalizeSocial } from '../website.ts';
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
check(A1.availability.public_activity.state === 'available' && ev1.length === 2, `A: 2 dated registry events published (got ${ev1.length})`);
check(ev1.some((t) => t.includes('annual accounts filed: 2025')) && ev1.some((t) => t.includes('employee count updated: 42')), 'A: events describe what changed');
check(!ev1.some((t) => /registreringsdato/.test(t)), 'A: bookkeeping-only changes and empty "Ukjent" events skipped');
check(B1.availability.public_activity.state === 'not_available', 'B: no registry events → not_available');
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
check(A1.evidence.every((e) => e.source_url.startsWith('https://data.brreg.no/') || e.source_url.startsWith('https://pam-stilling-feed.nav.no/') || e.source_url.startsWith('https://www.alpha-test.no/')), 'all evidence comes from the registers, NAV or the company\'s own verified site');

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
check(report.nav_job_feed?.ok === true && report.nav_job_feed.feed_pages === 2 && report.nav_job_feed.active_ads === 3 && report.nav_job_feed.detail_scan_complete === true, 'run report records the NAV feed read (2 pages, 3 active ads after dedupe, all read)');

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
writeFileSync(webIn, ['orgnr', '910000063', '910000098', '910000802', '910000810', '910000829', '910000837', '910000845', '910000721', '910000888', '910000896'].join('\n'));
const wsState = path.join(work, 'web-state');
const wrun = (name: string, env: Record<string, string> = {}) => {
  const out = path.join(work, name);
  execFileSync(process.execPath, ['--import', 'tsx', '--import', path.join(root, 'agent/test/mock-fetch.ts'), path.join(root, 'agent/run.ts'), webIn, out, '--state-dir', wsState, '--run-id', name], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return readFileSync(path.join(out, 'envelopes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) as Envelope[];
};
const w1 = wrun('web1');
const wa = (o: string) => by(w1, o).availability;
const wc = (o: string, f: string) => by(w1, o).claims.filter((c) => c.field === f);
const aSite = wc('910000063', 'website')[0];
check(wa('910000063').official_website.reason === 'registered_and_verified_on_site' && aSite?.evidence_ids.length === 2 && aSite.confidence === 0.99, 'website: registered website verified by the organisation number on the site (2 sources)');
const aSiteEv = by(w1, '910000063').evidence.find((e) => e.source_url === 'https://www.alpha-test.no/' && e.claim_span.includes('910 000 063'));
check(!!aSiteEv && aSiteEv.source_class === 'company_owned' && !!aSiteEv.content_sha256, 'website: evidence quotes the site text with the organisation number, hashed');
const prof = wc('910000063', 'social_profile').map((c) => (c.value as any).url).sort();
check(prof.join() === 'https://facebook.com/testselskapalpha,https://linkedin.com/company/alpha-test', `profiles: company page and structured-data LinkedIn published; share link and web agency excluded (got ${prof})`);
check(wc('910000063', 'email').map((c) => c.value).sort().join() === 'post@alpha-test.no,salg@alpha-test.no' && !JSON.stringify(by(w1, '910000063').claims).includes('webbyraa.no'), 'contacts: site email on its own domain added; other-domain email excluded; registered email not duplicated');
check(wc('910000063', 'phone').some((c) => c.value === '+47 22334455'), 'contacts: phone link on the verified site added');
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

// --- Site news, careers page and the at-a-glance summary ---------------------------------
const aW = by(w1, '910000063');
const newsA = aW.claims.filter((c) => c.field === 'site_news').map((c) => `${(c.value as any).date} ${(c.value as any).title}`).sort();
check(newsA.join('|') === '2025-03-03 Vi flytter til nye lokaler|2026-06-01 Alpha lanserer ny plattform|2026-09-15 Ny avtale med Bergen kommune', `site news: dated items from the news page and structured data, older items left out (got ${newsA.join('|')})`);
check(aW.claims.filter((c) => c.field === 'site_news').every((c) => c.source_date && c.family === 'public_activity'), 'site news: each item is dated public activity');
const jobsA = aW.claims.filter((c) => c.field === 'site_job').map((c) => (c.value as any).title).sort();
check(jobsA.join('|') === 'Backend-utvikler|Prosjektleder|Sommerjobb 2027', `careers page: openings from job-board links, own pages and JobPosting data; expired and generic links left out (got ${jobsA.join('|')})`);
check(!aW.claims.some((c) => c.field === 'site_job' && String((c.value as any).url).includes('11111111-1111')), 'careers page: a link to a NAV ad already attached is not counted twice');
check(aW.claims.some((c) => c.field === 'careers_page') && aW.availability.job_postings.checked_sources.includes('company_website'), 'careers page published as a hiring signal; job postings record the website as checked');
check(aW.summary.statements[0]?.text.startsWith('At a glance: TESTSELSKAP ALPHA AS is a private limited company (AS) in Oslo') && aW.summary.text.includes('up 16% on 2024') && aW.summary.text.includes('it is hiring'), 'summary: at-a-glance line with form, place, revenue trend and hiring');
check(aW.summary.text.includes('Latest news on its website: 2026-09-15 "Ny avtale med Bergen kommune"') && aW.summary.text.includes('openings listed on its careers page'), 'summary: latest site news and careers-page openings');
check(by(w1, '910000098').summary.statements[0]?.text.startsWith('At a glance: TESTSELSKAP BETA AS is a private limited company (AS) in Bergen'), 'summary: at-a-glance line for a sparse profile');
const aW3 = by(w3, '910000063');
check(!aW3.refresh.changes.some((c) => c.field === 'site_job' || c.field === 'site_news' || c.field === 'careers_page'), 'website down: no false removals of site news, careers page or openings');

// --- Website helpers --------------------------------------------------------------------
check([...findOrgnrs('Org.nr. 810 034 882 MVA').keys()].join() === '810034882' && findOrgnrs('Ring 810034882').size === 0 && findOrgnrs('Oslo, Norge 810034882').size === 0, 'helpers: organisation numbers only counted where presented as such');
check(normalizeSocial('https://no.linkedin.com/in/ola-nordmann') === null && normalizeSocial('https://www.facebook.com/sharer/sharer.php?u=x') === null && normalizeSocial('https://www.facebook.com/wix') === null, 'helpers: personal, share and vendor links rejected');
check(!robotsAllows(parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public'), '/admin/x') && robotsAllows(parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public'), '/admin/public/a'), 'helpers: robots.txt longest-match rules');
check(!isPublicAddress('169.254.169.254') && !isPublicAddress('10.0.0.5') && !isPublicAddress('::1') && !isPublicAddress('::ffff:192.168.1.1') && isPublicAddress('185.70.10.1'), 'helpers: private, link-local and loopback addresses blocked');
check(['http://localhost/', 'https://user:pw@firma.no/', 'https://firma.no:8080/', 'file:///etc/passwd', 'http://169.254.169.254/'].every((u) => 'error' in checkUrlShape(u)), 'helpers: unsafe URL shapes refused');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}  (work dir: ${work})`);
process.exit(failures ? 1 : 0);
