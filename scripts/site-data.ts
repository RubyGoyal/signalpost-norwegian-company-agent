// Turns the agent's output (out/envelopes.jsonl) into small JSON files for a website that lets
// people find a company, open it, compare two, and check where every fact came from.
//
//   npx tsx scripts/site-data.ts out/envelopes.jsonl site-out
//
// Writes:
//   site-out/index.json                 every company in one light list (search, list, compare picker)
//   site-out/companies/<orgnr>.json     one company: summary, key facts, all facts by section with
//                                       their sources, changes since the last check, sources consulted
// Every value is already formatted for display, and every fact carries its source links, so a
// site only has to show them. The format is described in site/README.md.

import { execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Claim, Envelope, Evidence, FieldFamily, SourceSnapshot } from '../agent/types.ts';

const [inFile, outDir] = process.argv.slice(2);
if (!inFile || !outDir) {
  console.error('usage: npx tsx scripts/site-data.ts <envelopes.jsonl> <out-dir>');
  process.exit(2);
}

const FAMILIES: [FieldFamily, string][] = [
  ['legal_identity', 'Legal identity'],
  ['registered_address', 'Addresses'],
  ['industry', 'Industry and purpose'],
  ['employees', 'Employees'],
  ['status_flags', 'Status'],
  ['roles', 'People and roles'],
  ['locations', 'Locations'],
  ['annual_accounts', 'Annual accounts'],
  ['official_website', 'Website'],
  ['company_profiles', 'Social profiles'],
  ['contact_points', 'Contact'],
  ['group_structure', 'Group structure'],
  ['job_postings', 'Hiring'],
  ['public_activity', 'News and registry activity'],
];

const FIELD_LABELS: Record<string, string> = {
  legal_name: 'Legal name',
  organisation_form: 'Organisation form',
  founded_date: 'Founded',
  registration_date: 'Registered in Enhetsregisteret',
  registered_in_business_register: 'In the Register of Business Enterprises',
  registered_for_vat: 'VAT registered',
  business_address: 'Business address',
  postal_address: 'Postal address',
  nace_code: 'Industry code (NACE)',
  institutional_sector: 'Institutional sector',
  statutory_purpose: 'Registered purpose',
  registered_activity: 'Registered activity',
  registered_employees: 'Registered employees',
  bankrupt: 'Bankrupt',
  under_liquidation: 'Under liquidation',
  under_forced_dissolution: 'Under forced dissolution',
  deleted_date: 'Deleted from the register',
  sub_unit: 'Sub-unit',
  operating_revenue: 'Operating revenue',
  operating_expenses: 'Operating expenses',
  operating_profit: 'Operating profit',
  net_financial_items: 'Net financial items',
  profit_before_tax: 'Profit before tax',
  net_income: 'Annual result',
  total_assets: 'Total assets',
  fixed_assets: 'Fixed assets',
  current_assets: 'Current assets',
  equity: 'Equity',
  total_liabilities: 'Total liabilities',
  audited: 'Audited',
  website: 'Website',
  parent_organisation_number: 'Parent organisation',
  is_parent_company: 'Parent company',
  files_group_accounts: 'Files group accounts',
  business_register_date: 'Registered in the Register of Business Enterprises',
  share_capital: 'Share capital',
  former_name: 'Former name',
  latest_filed_accounts_year: 'Latest filed accounts year',
  is_group_member: 'Part of a group',
  registry_notice: 'Registry notice',
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  social_profile: 'Social profile',
  site_news: 'News post',
  site_job: 'Job ad (company website)',
  job_ad: 'Job ad (NAV)',
  registry_event: 'Registry event',
};

const SOURCE_LABELS: Record<string, string> = {
  enhetsregisteret: 'Enhetsregisteret (entity register)',
  roller: 'Roles register',
  underenheter: 'Sub-unit register',
  regnskapsregisteret: 'Regnskapsregisteret (annual accounts)',
  oppdateringer: 'Registry update feed',
  nav_job_feed: 'NAV job feed',
  nav_job_ad: 'NAV job ad',
  company_website: 'Company website',
};

const PLATFORMS: Record<string, string> = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' };
const n = (x: number) => x.toLocaleString('en-US');

function label(c: Claim): string {
  const v = c.value as any;
  if (c.field === 'role') return v.role || v.role_code || 'Role';
  if (c.family === 'annual_accounts') return `${FIELD_LABELS[c.field] || c.field}${c.key.includes('#KONSERN#') ? ' (group)' : ''}`;
  if (c.field === 'social_profile') return PLATFORMS[v.platform] || 'Social profile';
  return FIELD_LABELS[c.field] || c.field.replace(/_/g, ' ');
}

/** The value as display text, and the link it points to when it is a page (website, profile, post, ad). */
function display(c: Claim): { value: string; link?: string } {
  const v = c.value as any;
  if (typeof v === 'boolean') return { value: v ? 'Yes' : 'No' };
  if (typeof v === 'number') return { value: c.unit && c.unit !== 'employees' ? `${c.unit} ${n(v)}` : n(v) };
  if (typeof v === 'string') return c.field === 'email' ? { value: v, link: `mailto:${v}` } : { value: v };
  switch (c.field) {
    case 'website':
      return { value: String(v.as_registered || v.url).replace(/^https?:\/\//, '').replace(/\/$/, ''), link: v.url };
    case 'social_profile':
      return { value: String(v.url).replace(/^https:\/\//, ''), link: v.url };
    case 'role':
      return { value: `${v.name}${v.holder_type === 'organisation' && v.organisation_number ? ` (org. no. ${v.organisation_number})` : ''}` };
    case 'share_capital':
      return { value: `${v.currency || ''} ${n(Number(v.amount))}${v.shares ? `, ${n(Number(v.shares))} shares` : ''}`.trim() };
    case 'former_name':
      return { value: `${v.name}${v.from || v.to ? ` (${v.from || '?'} to ${v.to || '?'})` : ''}` };
    case 'registry_notice':
      return { value: `${v.text}${v.date ? ` (${v.date})` : ''}` };
    case 'registry_event':
      return { value: `${v.date}: ${v.event}` };
    case 'site_news':
      return { value: `${v.date}: ${v.title}`, link: v.url };
    case 'site_job':
      return { value: `${v.title}${v.expires ? ` (apply by ${v.expires})` : v.posted ? ` (posted ${v.posted})` : ''}`, link: v.url };
    case 'job_ad':
      return { value: `${v.title}${v.location ? `, ${v.location}` : ''}${v.expires ? ` (apply by ${v.expires})` : ''}`, link: v.nav_url };
    case 'sub_unit':
      return { value: `${v.name || v.sub_unit_organisation_number}${v.address?.formatted ? `, ${v.address.formatted}` : ''}${typeof v.registered_employees === 'number' ? ` (${n(v.registered_employees)} employees)` : ''}` };
  }
  if (v.formatted) return { value: v.formatted };
  if (v.code) return { value: `${v.code}${v.description ? `: ${v.description}` : ''}` };
  return {
    value: Object.entries(v)
      .filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object')
      .map(([k, x]) => `${k.replace(/_/g, ' ')} ${x}`)
      .join(', '),
  };
}

interface SiteSource {
  label: string;
  url: string;
  retrieved_at: string;
  /** Where the value sits in the source: the field in the register's data, or the text on the page. */
  where: string | null;
}

function sourcesFor(ids: string[], ev: Map<string, Evidence>, snaps: Map<string, SourceSnapshot>): SiteSource[] {
  const seen = new Set<string>();
  const out: SiteSource[] = [];
  for (const id of ids) {
    const e = ev.get(id);
    if (!e || seen.has(e.source_url)) continue;
    seen.add(e.source_url);
    const s = snaps.get(e.snapshot_id);
    out.push({ label: SOURCE_LABELS[s?.source || ''] || 'Source', url: e.source_url, retrieved_at: e.retrieved_at, where: e.claim_span || null });
  }
  return out;
}

const AVAILABILITY_STATE: Record<string, string> = {
  available: 'found',
  not_available: 'none',
  not_applicable: 'none',
  ambiguous: 'unclear',
  blocked: 'unclear',
  failed: 'failed',
};

function reasonText(reason: string): string {
  const nav = reason.match(/^checked_nav_no_active_ads_last_(\d+)_days(_and_careers_page_says_no_open_positions)?$/);
  if (nav) return nav[2] ? 'Checked: none on NAV, and its careers page says none are open' : `Checked: no active job ads on NAV in the last ${nav[1]} days`;
  const map: Record<string, string> = {
    not_checked_in_this_version: 'Not checked',
    no_active_roles_registered: 'Checked: no active roles registered',
    no_annual_accounts_in_regnskapsregisteret: 'Checked: no annual accounts filed',
    no_employee_count_registered: 'Checked: no employee count registered (not shown as zero)',
    no_website_registered_in_enhetsregisteret: 'Checked: no website registered',
    no_verified_website_found: 'Checked: no website registered or verified as its own',
    no_verified_website: 'No verified website to read from',
    no_profiles_linked_from_verified_website: 'Checked: no profiles of its own linked from its website',
    no_group_relation_registered: 'Checked: no group relation registered',
    no_contact_details_registered: 'Checked: no contact details registered',
    checked_no_active_sub_units: 'Checked: no active sub-units',
    no_registry_events_since_2025: 'Checked: no registry events since 2025',
    registered_website_belongs_to_another_entity: "Checked: the registered website is another company's",
    registered_website_not_verified: 'Checked: the registered website does not name this company',
    registered_website_not_reachable: 'Checked: the registered website does not answer',
    registered_website_parked: 'Checked: the registered domain is parked',
    website_check_incomplete: 'The website could not be checked this time',
    jobs_source_disabled: 'Not checked',
  };
  if (map[reason]) return map[reason];
  const w = reason.replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function latest(claims: Claim[], field: string): Claim | undefined {
  const all = claims.filter((c) => c.field === field).sort((a, b) => String(b.reporting_period?.to).localeCompare(String(a.reporting_period?.to)));
  return all.find((c) => c.key.includes('#SELSKAP#')) || all[0];
}

function companyFile(e: Envelope) {
  const ev = new Map(e.evidence.map((x) => [x.id, x]));
  const snaps = new Map(e.source_snapshots.map((s) => [s.id, s]));
  const src = (c?: Claim) => (c ? sourcesFor(c.evidence_ids, ev, snaps) : []);
  const one = (f: string) => e.claims.find((c) => c.field === f);
  const role = (code: string) => e.claims.find((c) => c.field === 'role' && (c.value as any).role_code === code);
  const fact = (c: Claim) => {
    const d = display(c);
    return {
      label: label(c),
      value: d.value,
      ...(d.link ? { link: d.link } : {}),
      as_of: c.source_date || null,
      period: c.reporting_period ? `${c.reporting_period.from} to ${c.reporting_period.to}` : null,
      sources: src(c),
    };
  };
  const key = (k: string, lbl: string, c: Claim | undefined, value?: string) => {
    const d = c ? display(c) : null;
    return {
      key: k,
      label: lbl,
      value: value ?? (d ? d.value + (c?.reporting_period ? ` (${c.reporting_period.to.slice(0, 4)})` : '') : null),
      ...(d?.link && value === undefined ? { link: d.link } : {}),
      sources: src(c),
    };
  };
  const news = e.claims.filter((c) => c.field === 'site_news').sort((a, b) => String((b.value as any).date).localeCompare(String((a.value as any).date)));
  const jobs = e.claims.filter((c) => c.field === 'job_ad' || c.field === 'site_job');
  const profiles = e.claims.filter((c) => c.field === 'social_profile');
  const subUnits = e.claims.filter((c) => c.field === 'sub_unit');
  const nace = e.claims.filter((c) => c.field === 'nace_code').sort((a, b) => ((a.value as any).rank ?? 9) - ((b.value as any).rank ?? 9))[0];
  const keyFacts = [
    key('organisation_form', 'Organisation form', one('organisation_form')),
    key('founded', 'Founded', one('founded_date')),
    key('address', 'Business address', one('business_address')),
    key('industry', 'Industry', nace),
    key('employees', 'Registered employees', one('registered_employees')),
    key('revenue', 'Operating revenue', latest(e.claims, 'operating_revenue')),
    key('result', 'Annual result', latest(e.claims, 'net_income')),
    key('equity', 'Equity', latest(e.claims, 'equity')),
    key('ceo', 'CEO', role('DAGL')),
    key('chair', 'Board chair', role('LEDE')),
    key('auditor', 'Auditor', role('REVI')),
    key('website', 'Website', one('website')),
    key('profiles', 'Social profiles', profiles[0], profiles.length ? `${profiles.length}: ${profiles.map((p) => PLATFORMS[(p.value as any).platform] || (p.value as any).platform).join(', ')}` : undefined),
    key('jobs', 'Open job ads', jobs[0], jobs.length ? `${jobs.length}: ${display(jobs[0]).value}${jobs.length > 1 ? ' and more' : ''}` : undefined),
    key('news', 'Latest news', news[0]),
    key('sub_units', 'Sub-units', subUnits[0], subUnits.length ? String(subUnits.length) : undefined),
  ];
  const sections = FAMILIES.map(([fam, title]) => {
    const a = e.availability[fam];
    const facts = e.claims
      .filter((c) => c.family === fam)
      .sort((x, y) => {
        // Newest first for dated items; accounts by year, newest first.
        const dx = (x.value as any)?.date || x.reporting_period?.to || '';
        const dy = (y.value as any)?.date || y.reporting_period?.to || '';
        return String(dy).localeCompare(String(dx));
      })
      .map(fact);
    return { key: fam, title, state: AVAILABILITY_STATE[a?.state] || 'none', note: facts.length ? null : reasonText(a?.reason || ''), facts };
  });
  const statements = e.summary.statements.map((s) => ({
    kind: s.text.startsWith('At a glance') ? 'glance' : s.text.startsWith("What's new") ? 'new' : s.text.startsWith('Changes') ? 'changes' : s.text.startsWith('Unknown') ? 'unknowns' : 'fact',
    text: s.text,
    sources: sourcesFor(s.evidence_ids, ev, snaps).map(({ label, url }) => ({ label, url })),
  }));
  const changes = e.refresh.changes.map((c) => {
    const as = (v: unknown) => (v === null || v === undefined ? null : display({ ...(c as any), value: v, unit: undefined }).value);
    return { label: FIELD_LABELS[c.field] || c.field.replace(/_/g, ' '), type: c.type.replace('_value', ''), before: as(c.previous_value), after: as(c.new_value), detected_at: c.detected_at };
  });
  const addr = one('business_address')?.value as any;
  const rev = latest(e.claims, 'operating_revenue');
  return {
    file: {
      schema: 'signalpost-site/1',
      orgnr: e.organisation_number,
      name: e.legal_identity?.legal_name || e.organisation_number,
      form: e.legal_identity?.organisation_form || null,
      status: e.legal_identity?.registry_status || 'unknown',
      state: e.state,
      checked_at: e.run.completed_at,
      run_id: e.run.run_id,
      summary: statements,
      key_facts: keyFacts,
      sections,
      changes: { since: e.refresh.previous_retrieved_at, baseline: e.refresh.baseline, unchanged_facts: e.refresh.unchanged_claims, items: changes },
      sources_consulted: e.source_snapshots.map((s) => ({ label: SOURCE_LABELS[s.source] || s.source, url: s.source_url, retrieved_at: s.retrieved_at, ok: s.ok })),
      fact_count: e.claims.length,
    },
    row: {
      orgnr: e.organisation_number,
      name: e.legal_identity?.legal_name || e.organisation_number,
      form: e.legal_identity?.organisation_form?.code || null,
      status: e.legal_identity?.registry_status || 'unknown',
      municipality: addr?.municipality || addr?.city || null,
      industry: nace ? display(nace).value : null,
      employees: typeof one('registered_employees')?.value === 'number' ? (one('registered_employees')!.value as number) : null,
      revenue: rev && typeof rev.value === 'number' ? { amount: rev.value, currency: rev.unit || 'NOK', year: String(rev.reporting_period?.to || '').slice(0, 4), display: `${rev.unit || 'NOK'} ${n(rev.value)}` } : null,
      website: (one('website')?.value as any)?.url || null,
      profiles: profiles.length,
      news: news.length,
      jobs: jobs.length,
      facts: e.claims.length,
      glance: statements.find((s) => s.kind === 'glance')?.text.replace(/^At a glance:\s*/, '') || null,
    },
  };
}

let commit = process.env.GITHUB_SHA || '';
try {
  if (!commit) commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {}

mkdirSync(path.join(outDir, 'companies'), { recursive: true });
const byOrg = new Map<string, any>();
let runId = '';
const rl = readline.createInterface({ input: createReadStream(inFile, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const e = JSON.parse(line) as Envelope;
  // Companies found in the register; a number that failed or is not registered has nothing to show.
  if (e.state !== 'available' || !e.legal_identity?.legal_name) continue;
  const { file, row } = companyFile(e);
  runId ||= e.run.run_id;
  writeFileSync(path.join(outDir, 'companies', `${e.organisation_number}.json`), JSON.stringify(file));
  byOrg.set(e.organisation_number, row);
}
const rows = [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
writeFileSync(
  path.join(outDir, 'index.json'),
  JSON.stringify({
    schema: 'signalpost-site/1',
    generated_at: new Date().toISOString(),
    repository: 'https://github.com/RubyGoyal/signalpost-norwegian-company-agent',
    commit: commit || null,
    run_id: runId || null,
    count: rows.length,
    company_url: 'companies/{orgnr}.json',
    companies: rows,
  })
);
if (!existsSync(path.join(outDir, 'index.json'))) process.exit(1);
console.log(`site data: ${rows.length} companies -> ${outDir}`);
