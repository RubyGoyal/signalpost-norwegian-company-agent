// Researches one organisation number and returns exactly one terminal envelope.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateOrgnr } from './orgnr.ts';
import type { BrregClient, FetchResult } from './brreg.ts';
import {
  ClaimBuilder,
  extractAccounts,
  extractActivity,
  extractEntity,
  extractLocations,
  extractRoles,
  familyState,
  registryStatus,
  stableStringify,
} from './extract.ts';
import type { NavJobIndex } from './jobs.ts';
import type { WebClient } from './web.ts';
import {
  findWebsite,
  nameTokens,
  normalizeSocial,
  phoneDigits,
  profilesFrom,
  siteContacts,
  type CompanyIdentity,
  type WebsiteOutcome,
} from './website.ts';
import {
  FIELD_FAMILIES,
  type Change,
  type Claim,
  type Envelope,
  type Evidence,
  type FamilyAvailability,
  type FieldFamily,
  type SourceSnapshot,
  type SummaryStatement,
} from './types.ts';

export interface RunContext {
  runId: string;
  client: BrregClient;
  stateDir: string;
  maxLocationPages: number;
  /** NAV job feed index for this run; undefined = job postings not checked. */
  jobs?: NavJobIndex;
  /** Max NAV ad detail look-ups per company (default 15). */
  maxJobDetails?: number;
  /** Earliest registry event to report as public activity (ISO date, fixed so refresh is stable). */
  activitySince?: string;
  /** Fetcher for company websites; undefined/null = website step not run. */
  web?: WebClient | null;
  /** Time budget for one company's website step (default 20 s). */
  websiteBudgetMs?: number;
}

export const DEFAULT_ACTIVITY_SINCE = '2025-01-01T00:00:00.000Z';

/** Families whose earlier claims are history: they are never reported as removed. */
const APPEND_ONLY: Set<FieldFamily> = new Set(['public_activity']);

interface StoredState {
  organisation_number: string;
  run_id: string;
  retrieved_at: string;
  claims: Claim[];
  evidence: Evidence[];
  /** Earlier values replaced or removed by later runs, with their evidence (most recent first). */
  history: { change: Change; recorded_in_run: string }[];
}

const NOT_CHECKED = 'not_checked_in_this_version';
/** Availability reasons that mean "this run did not look", so absence is not a removal. */
const UNCHECKED_REASONS = new Set([
  NOT_CHECKED,
  'jobs_source_disabled',
  'identity_not_resolved',
  'website_check_not_run',
  'no_verified_website',
]);

function emptyAvailability(state: FamilyAvailability['state'], reason: string) {
  return Object.fromEntries(
    FIELD_FAMILIES.map((f) => [f, { state, reason, checked_sources: [] as string[] }])
  ) as Record<FieldFamily, FamilyAvailability>;
}

export function failedEnvelope(
  orgnr: string,
  inputIndex: number,
  runId: string,
  startedAt: string,
  code: string,
  message: string,
  state: Envelope['state'] = 'failed'
): Envelope {
  const now = new Date().toISOString();
  return {
    schema_version: 'signalpost-envelope/1',
    organisation_number: orgnr,
    input_index: inputIndex,
    state,
    legal_identity: null,
    availability: emptyAvailability(state, code),
    claims: [],
    evidence: [],
    source_snapshots: [],
    summary: {
      generator: 'deterministic_v1',
      text: `No profile published for ${orgnr}: ${message}`,
      statements: [{ text: `No profile published for ${orgnr}: ${message}`, evidence_ids: [] }],
      unknowns: [...FIELD_FAMILIES],
    },
    changes: [],
    refresh: { baseline: 'cold_start', previous_run_id: null, previous_retrieved_at: null, changes: [], unchanged_claims: 0 },
    run: { run_id: runId, started_at: startedAt, completed_at: now, terminal_status: 'failed' },
    operations: { requests: 0, runtime_ms: Date.parse(now) - Date.parse(startedAt), third_party_cost_usd: 0 },
    errors: [{ source: 'agent', code, message }],
  };
}

async function loadState(dir: string, orgnr: string): Promise<StoredState | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${orgnr}.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function saveState(dir: string, s: StoredState) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${s.organisation_number}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(s));
  await fs.rename(`${file}.tmp`, file);
}

const fmtNum = (n: number) => n.toLocaleString('en-US');

function buildSummary(
  claims: Claim[],
  availability: Record<FieldFamily, FamilyAvailability>,
  changes: Change[],
  baseline: 'cold_start' | 'previous_run',
  prevRetrieved: string | null,
  orgnr: string
): Envelope['summary'] {
  const st: SummaryStatement[] = [];
  const one = (field: string) => claims.find((c) => c.field === field);
  const all = (field: string) => claims.filter((c) => c.field === field);
  const ev = (...cs: (Claim | undefined)[]) => cs.flatMap((c) => (c ? c.evidence_ids : []));

  const name = one('legal_name');
  const form = one('organisation_form');
  const founded = one('founded_date');
  if (availability.legal_identity.state === 'failed') {
    st.push({
      text: `Brønnøysundregistrene could not be reached for ${orgnr} during this run, so no facts are published for it.`,
      evidence_ids: [],
    });
  } else if (name) {
    const f = form?.value as any;
    st.push({
      text: `${name.value} (org. no. ${orgnr})${f?.description ? `: ${f.description} (${f.code})` : ''}${
        founded ? `, founded ${founded.value}` : ''
      }.`,
      evidence_ids: ev(name, form, founded),
    });
  }

  const nace = all('nace_code').sort((a, b) => ((a.value as any).rank ?? 9) - ((b.value as any).rank ?? 9))[0];
  const purpose = one('statutory_purpose') || one('registered_activity');
  if (nace || purpose) {
    const n = nace?.value as any;
    const parts: string[] = [];
    if (n) parts.push(`Primary industry: ${n.code}${n.description ? ` ${n.description}` : ''}.`);
    if (purpose) {
      const p = String(purpose.value);
      parts.push(`Registered purpose: ${p.length > 280 ? `${p.slice(0, 277)}...` : p}`);
    }
    st.push({ text: `What it does: ${parts.join(' ')}`, evidence_ids: ev(nace, purpose) });
  }

  const addr = one('business_address');
  if (addr) {
    const a = addr.value as any;
    st.push({
      text: `Business address: ${a.formatted}${a.municipality ? ` (${a.municipality} municipality)` : ''}.`,
      evidence_ids: ev(addr),
    });
  }

  const emp = one('registered_employees');
  const accounts = claims.filter((c) => c.family === 'annual_accounts');
  if (emp || accounts.length) {
    const parts: string[] = [];
    if (emp) parts.push(`${fmtNum(emp.value as number)} registered employees`);
    const latestTo = accounts.map((c) => c.reporting_period?.to || '').sort().pop();
    const latest = accounts.filter((c) => c.reporting_period?.to === latestTo);
    const pick = (f: string) =>
      latest.find((c) => c.field === f && c.key.includes('#SELSKAP#')) || latest.find((c) => c.field === f);
    const rev = pick('operating_revenue');
    const net = pick('net_income');
    const audited = pick('audited');
    if (rev || net) {
      const p = (rev || net)!.reporting_period!;
      const kind = (rev || net)!.key.includes('#KONSERN#') ? 'group' : 'company';
      const bits = [
        rev ? `operating revenue ${rev.unit || ''} ${fmtNum(rev.value as number)}`.replace('  ', ' ') : '',
        net ? `annual result ${net.unit || ''} ${fmtNum(net.value as number)}`.replace('  ', ' ') : '',
      ].filter(Boolean);
      parts.push(
        `latest filed ${kind} accounts (${p.from} to ${p.to}): ${bits.join(', ')}${
          audited && audited.value === false ? ' (accounts not audited)' : ''
        }`
      );
    }
    st.push({ text: `Size: ${parts.join('; ')}.`, evidence_ids: ev(emp, pick('operating_revenue'), pick('net_income')) });
  }

  const roles = all('role');
  if (roles.length) {
    const byCode = (code: string) => roles.filter((r) => (r.value as any).role_code === code);
    const ceo = byCode('DAGL')[0];
    const chair = byCode('LEDE')[0];
    const members = byCode('MEDL').length + byCode('NEST').length;
    const parts: string[] = [];
    if (ceo) parts.push(`CEO (daglig leder): ${(ceo.value as any).name}`);
    if (chair) parts.push(`board chair: ${(chair.value as any).name}`);
    if (members) parts.push(`${members} other board member${members === 1 ? '' : 's'}`);
    const auditor = byCode('REVI')[0];
    if (auditor) parts.push(`auditor: ${(auditor.value as any).name}`);
    if (parts.length) st.push({ text: `People: ${parts.join('; ')}.`, evidence_ids: ev(ceo, chair, auditor) });
  }

  const locs = all('sub_unit');
  if (locs.length) {
    const places = [...new Set(locs.map((l) => (l.value as any).address?.city).filter(Boolean))].slice(0, 5);
    st.push({
      text: `Locations: ${locs.length} active sub-unit${locs.length === 1 ? '' : 's'} registered${
        places.length ? ` (incl. ${places.join(', ')})` : ''
      }.`,
      evidence_ids: ev(...locs.slice(0, 5)),
    });
  }

  const flags = claims.filter((c) => c.family === 'status_flags' && c.value === true);
  const deleted = one('deleted_date');
  const statusClaims = claims.filter((c) => c.family === 'status_flags');
  if (deleted) st.push({ text: `Status: deleted from Enhetsregisteret on ${deleted.value}.`, evidence_ids: ev(deleted) });
  else if (flags.length)
    st.push({ text: `Status flags: ${flags.map((f) => f.field.replace(/_/g, ' ')).join(', ')}.`, evidence_ids: ev(...flags) });
  else if (statusClaims.length)
    st.push({ text: 'Status: no bankruptcy, liquidation or forced-dissolution flags registered.', evidence_ids: ev(...statusClaims) });

  const notices = all('registry_notice');
  if (notices.length)
    st.push({
      text: `Registry notices: ${notices.map((n) => (n.value as any).text).join('; ')}.`,
      evidence_ids: ev(...notices),
    });

  const cap = one('share_capital');
  const former = all('former_name')
    .slice()
    .sort((a, b) => String((b.value as any).to || '').localeCompare(String((a.value as any).to || '')));
  if (cap || former.length) {
    const parts: string[] = [];
    if (cap) {
      const v = cap.value as any;
      parts.push(`share capital ${v.currency || ''} ${fmtNum(v.amount)}${v.registered_date ? ` (registered ${v.registered_date})` : ''}`.replace('  ', ' '));
    }
    if (former.length)
      parts.push(
        `formerly registered as ${former
          .slice(0, 3)
          .map((f) => `${(f.value as any).name}${(f.value as any).to ? ` (until ${(f.value as any).to})` : ''}`)
          .join(', ')}${former.length > 3 ? ` and ${former.length - 3} earlier name${former.length - 3 === 1 ? '' : 's'}` : ''}`
      );
    st.push({ text: `Identity: ${parts.join('; ')}.`, evidence_ids: ev(cap, ...former.slice(0, 3)) });
  }

  const web = one('website');
  if (web) {
    const w = web.value as any;
    const how =
      w.found_via === 'registered_email_domain'
        ? 'found through the registered email domain and verified on the site'
        : w.found_via === 'name_domain_check'
        ? 'found from the company name and verified on the site'
        : web.evidence_ids.length > 1
        ? 'as registered, and verified on the site'
        : 'as registered in Enhetsregisteret';
    st.push({ text: `Website: ${w.url} (${how}).`, evidence_ids: ev(web) });
  }
  const profiles = all('social_profile');
  if (profiles.length)
    st.push({
      text: `Company-owned profiles linked from its website: ${profiles.map((p) => (p.value as any).url).join(', ')}.`,
      evidence_ids: ev(...profiles),
    });

  const ads = all('job_ad');
  if (ads.length) {
    const top = ads[0].value as any;
    st.push({
      text: `Hiring: ${ads.length} active job ad${ads.length === 1 ? '' : 's'} on arbeidsplassen.no (NAV)${
        top ? `, most recent "${top.title}"${top.published ? ` published ${top.published}` : ''}` : ''
      }.`,
      evidence_ids: ev(...ads.slice(0, 5)),
    });
  } else if (availability.job_postings.reason.startsWith('checked_nav_no_active_ads')) {
    st.push({ text: 'Hiring: no active job ads found on arbeidsplassen.no (NAV) for this company or its sub-units.', evidence_ids: [] });
  }

  const events = all('registry_event')
    .slice()
    .sort((a, b) => String((b.value as any).date).localeCompare(String((a.value as any).date)));
  if (events.length)
    st.push({
      text: `Recent registry activity: ${events
        .slice(0, 3)
        .map((e) => `${(e.value as any).date} ${(e.value as any).event}`)
        .join('; ')}${events.length > 3 ? ` (${events.length} events since 2025)` : ''}.`,
      evidence_ids: ev(...events.slice(0, 3)),
    });

  if (baseline === 'cold_start') {
    st.push({ text: 'Changes: first run for this company, so there is no earlier snapshot to compare against.', evidence_ids: [] });
  } else if (!changes.length) {
    st.push({ text: `Changes: none since the previous check on ${prevRetrieved?.slice(0, 10)}.`, evidence_ids: [] });
  } else {
    const show = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return fmtNum(v);
      if (typeof v === 'object') {
        const o = v as any;
        if (o.name) return `${o.name}${o.role ? ` (${o.role})` : ''}`;
        return o.formatted || o.url || o.description || o.code || JSON.stringify(o);
      }
      return String(v);
    };
    const label = (c: Change) => c.field.replace(/_/g, ' ');
    const shown = changes.slice(0, 6).map((c) =>
      c.type === 'changed_value'
        ? `${label(c)} changed from ${show(c.previous_value)} to ${show(c.new_value)}`
        : c.type === 'new_value'
        ? `new ${label(c)}: ${show(c.new_value)}`
        : `${label(c)} no longer listed: ${show(c.previous_value)}`
    );
    st.push({
      text: `Changes since ${prevRetrieved?.slice(0, 10)}: ${shown.join('; ')}${changes.length > 6 ? `; +${changes.length - 6} more` : ''}.`,
      evidence_ids: changes.flatMap((c) => c.evidence_ids).slice(0, 12),
    });
  }

  const unknowns = FIELD_FAMILIES.filter((f) => availability[f].state !== 'available');
  const reasonText = (f: FieldFamily) => {
    const r = availability[f].reason;
    if (r === NOT_CHECKED) return `${f.replace(/_/g, ' ')} (not checked yet)`;
    if (availability[f].state === 'failed') return `${f.replace(/_/g, ' ')} (source unavailable this run)`;
    if (r === 'identity_not_resolved') return `${f.replace(/_/g, ' ')} (not checked: identity not confirmed)`;
    if (r === 'not_found_in_enhetsregisteret') return `${f.replace(/_/g, ' ')} (organisation number not found in the registry)`;
    if (r === 'deleted_from_enhetsregisteret') return `${f.replace(/_/g, ' ')} (entity deleted from the registry)`;
    if (r === 'jobs_source_disabled') return `${f.replace(/_/g, ' ')} (not checked in this run)`;
    if (r.startsWith('checked_nav_no_active_ads')) return `${f.replace(/_/g, ' ')} (none active on NAV)`;
    if (r === 'no_registry_events_since_2025') return `${f.replace(/_/g, ' ')} (no registry events since 2025)`;
    if (r === 'no_verified_website_found') return `${f.replace(/_/g, ' ')} (none registered, none verified)`;
    if (r === 'no_verified_website') return `${f.replace(/_/g, ' ')} (no verified website to read them from)`;
    if (r === 'no_profiles_linked_from_verified_website') return `${f.replace(/_/g, ' ')} (none linked from its website)`;
    if (r === 'website_check_not_run') return `${f.replace(/_/g, ' ')} (website not checked in this run)`;
    if (availability[f].state === 'ambiguous') return `${f.replace(/_/g, ' ')} (ambiguous: the site lists several companies)`;
    if (availability[f].state === 'blocked') return `${f.replace(/_/g, ' ')} (site does not allow automated access)`;
    if (r === 'registered_website_parked') return `${f.replace(/_/g, ' ')} (registered domain is parked)`;
    return `${f.replace(/_/g, ' ')} (none registered)`;
  };
  if (unknowns.length)
    st.push({ text: `Unknown or not published: ${unknowns.map(reasonText).join(', ')}.`, evidence_ids: [] });

  return { generator: 'deterministic_v1', text: st.map((s) => s.text).join(' '), statements: st, unknowns };
}


/** Everything read for one company before the hiring step (which needs the run-wide NAV index). */
export interface Gathered {
  orgnr: string;
  inputIndex: number;
  startedAt: string;
  gatherMs: number;
  /** Set when the input is not a valid organisation number: the envelope is already final. */
  final?: Envelope;
  ent: FetchResult;
  roles: FetchResult | null;
  accounts: FetchResult | null;
  locPages: FetchResult[];
  actPages: FetchResult[];
  website: WebsiteOutcome | null;
  b: ClaimBuilder;
  snapshots: SourceSnapshot[];
  errors: Envelope['errors'];
  requests: number;
}

function identityFrom(orgnr: string, e: any): CompanyIdentity {
  const addrs = [e?.forretningsadresse, e?.postadresse].filter(Boolean);
  return {
    orgnr,
    legalName: typeof e?.navn === 'string' ? e.navn : '',
    formCode: e?.organisasjonsform?.kode || null,
    website: typeof e?.hjemmeside === 'string' && e.hjemmeside.trim() ? e.hjemmeside.trim() : null,
    email: typeof e?.epostadresse === 'string' && e.epostadresse.includes('@') ? e.epostadresse.trim() : null,
    phones: [e?.telefon, e?.mobil].filter((x) => typeof x === 'string').map((x: string) => phoneDigits(x)).filter((d) => d.length === 8),
    streets: addrs.flatMap((a: any) => (Array.isArray(a.adresse) ? a.adresse : [])).filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.toLowerCase()),
    postalCodes: addrs.map((a: any) => a.postnummer).filter((x: unknown) => typeof x === 'string'),
  };
}

/** Turns the website step's result into claims: verified website, linked profiles, site contact links. */
function websiteClaims(b: ClaimBuilder, id: CompanyIdentity, w: WebsiteOutcome) {
  const regKey = 'official_website#website';
  // A social profile registered as the "website" in Enhetsregisteret is a company-owned profile
  // declared in the official register.
  const regClaim = b.claims.find((c) => c.key === regKey);
  const regSocial = regClaim ? normalizeSocial(String((regClaim.value as any).url || '')) : null;
  if (regClaim && regSocial)
    b.addFromEvidence(regClaim.evidence_ids[0], 'company_profiles', 'social_profile', regSocial.url, { platform: regSocial.platform, url: regSocial.url }, 0.95);
  const reg = w.registryVerdict;
  if (reg && b.claims.some((c) => c.key === regKey)) {
    if (reg.status === 'exact' && reg.proof) b.addEvidence(regKey, reg.proof.page.snapshot, reg.proof.span, 0.99);
    else if (reg.status === 'parked') b.remove(regKey);
    else if (reg.status === 'rejected' || reg.status === 'ambiguous') b.setConfidence(regKey, 0.85);
  }
  const v = w.verified;
  if (!v) return;
  if (!b.claims.some((c) => c.key === regKey) && v.candidate.via !== 'enhetsregisteret' && v.proof && v.homeUrl) {
    b.add(
      v.proof.page.snapshot,
      'official_website',
      'website',
      null,
      { url: v.homeUrl, domain: v.candidate.domain, found_via: v.candidate.via },
      v.proof.span,
      { confidence: v.confidence ?? 0.9 }
    );
  }
  const tokens = nameTokens(id.legalName);
  for (const p of profilesFrom(v, tokens)) {
    b.add(p.page.snapshot, 'company_profiles', 'social_profile', p.profile.url, { platform: p.profile.platform, url: p.profile.url }, `${p.via}: ${p.profile.url}`, {
      confidence: 0.9,
    });
  }
  // Contact links on the company's own domain. Never for sole proprietorships (a person's details).
  if (id.formCode === 'ENK') return;
  const regEmail = (id.email || '').toLowerCase();
  const c = siteContacts(v);
  for (const e of c.emails)
    if (e.value !== regEmail) b.add(e.page.snapshot, 'contact_points', 'email', `website#${e.value}`, e.value, `mailto:${e.value}`, { confidence: 0.9 });
  for (const ph of c.phones)
    if (!id.phones.includes(ph.value))
      b.add(ph.page.snapshot, 'contact_points', 'phone', `website#${ph.value}`, `+47 ${ph.value}`, `tel link: ${ph.value}`, { confidence: 0.9 });
}

/** Phase 1: registry sources and the company website (no dependence on the NAV index). */
export async function gatherCompany(rawOrgnr: string, inputIndex: number, ctx: RunContext): Promise<Gathered> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const check = validateOrgnr(rawOrgnr);
  const b = new ClaimBuilder(check.normalized || rawOrgnr);
  const g: Gathered = {
    orgnr: check.normalized || rawOrgnr,
    inputIndex,
    startedAt,
    gatherMs: 0,
    ent: null as unknown as FetchResult,
    roles: null,
    accounts: null,
    locPages: [],
    actPages: [],
    website: null,
    b,
    snapshots: [],
    errors: [],
    requests: 0,
  };
  if (!check.valid) {
    g.final = failedEnvelope(check.normalized || rawOrgnr, inputIndex, ctx.runId, startedAt, 'invalid_organisation_number', check.reason || 'invalid organisation number');
    return g;
  }
  const orgnr = check.normalized;
  const count = (n: number) => (g.requests += n);
  const snapId = (s: string) => `snap:${orgnr}:${s}`;

  // 1. Enhetsregisteret is the identity anchor. If it fails, nothing else is published.
  const ent = await ctx.client.get('enhetsregisteret', `/enhetsregisteret/api/enheter/${orgnr}`, snapId('enhetsregisteret'), count);
  g.ent = ent;
  g.snapshots.push(ent.snapshot);
  if (ent.outcome === 'error') {
    g.errors.push({ source: 'enhetsregisteret', code: ent.snapshot.error || 'error', message: 'Enhetsregisteret lookup failed after retries' });
  }
  if (ent.outcome === 'ok' || ent.outcome === 'gone') extractEntity(b, ent.snapshot, ent.json || {});

  if (ent.outcome === 'ok') {
    // 2. Roles, sub-units, annual accounts, the registry change log and the company website,
    //    in parallel. Registry sources are keyed by the same organisation number.
    const since = ctx.activitySince || DEFAULT_ACTIVITY_SINCE;
    const actTask = (async () => {
      const base = `/enhetsregisteret/api/oppdateringer/enheter?organisasjonsnummer=${orgnr}&dato=${encodeURIComponent(since)}&includeChanges=true&size=100`;
      const first = await ctx.client.get('oppdateringer', `${base}&page=0`, snapId('oppdateringer:0'), count);
      g.actPages.push(first);
      const totalPages = first.json?.page?.totalPages;
      if (first.outcome === 'ok' && Number.isFinite(totalPages) && totalPages > 1) {
        const last = totalPages - 1;
        g.actPages.push(await ctx.client.get('oppdateringer', `${base}&page=${last}`, snapId(`oppdateringer:${last}`), count));
      }
    })();
    const locTask = (async () => {
      for (let page = 0; page < ctx.maxLocationPages; page++) {
        const r = await ctx.client.get('underenheter', `/enhetsregisteret/api/underenheter?overordnetEnhet=${orgnr}&size=100&page=${page}`, snapId(`underenheter:${page}`), count);
        g.locPages.push(r);
        const total = r.json?.page?.totalPages;
        if (r.outcome !== 'ok' || !Number.isFinite(total) || page + 1 >= total) break;
      }
    })();
    const id = identityFrom(orgnr, ent.json);
    const webTask = (async () => {
      try {
        g.website = await findWebsite(ctx.web, id, ctx.websiteBudgetMs ?? 20_000);
      } catch (e: any) {
        g.website = { state: 'incomplete', verdicts: [], verified: null, registryVerdict: null };
        g.errors.push({ source: 'company_website', code: 'website_step_error', message: String(e?.message || e) });
      }
      // Pages fetched for this company (robots.txt reads are counted in the run total).
      g.requests += g.website?.verdicts.reduce((n, v) => n + v.snapshots.length, 0) ?? 0;
    })();
    const [roles, accounts] = await Promise.all([
      ctx.client.get('roller', `/enhetsregisteret/api/enheter/${orgnr}/roller`, snapId('roller'), count),
      ctx.client.get('regnskapsregisteret', `/regnskapsregisteret/regnskap/${orgnr}`, snapId('regnskapsregisteret'), count),
      locTask,
      actTask,
      webTask,
    ]);
    g.roles = roles;
    g.accounts = accounts;
    g.snapshots.push(roles.snapshot, accounts.snapshot, ...g.locPages.map((p) => p.snapshot), ...g.actPages.map((p) => p.snapshot));
    if (roles.outcome === 'ok') extractRoles(b, roles.snapshot, roles.json);
    if (accounts.outcome === 'ok') extractAccounts(b, accounts.snapshot, accounts.json);
    g.locPages.forEach((p, i) => p.outcome === 'ok' && extractLocations(b, p.snapshot, p.json, i * 100));
    g.actPages.forEach((p, i) => p.outcome === 'ok' && extractActivity(b, p.snapshot, p.json, i));
    for (const [src, r] of [['roller', roles], ['regnskapsregisteret', accounts]] as const)
      if (r.outcome === 'error') g.errors.push({ source: src, code: r.snapshot.error || 'error', message: `${src} lookup failed after retries` });
    roles.json = null;
    accounts.json = null;
    for (const p of g.actPages) p.json = p.json?.page ? { page: p.json.page } : null;
    if (g.locPages.some((p) => p.outcome === 'error')) g.errors.push({ source: 'underenheter', code: 'error', message: 'sub-unit lookup failed after retries' });
    if (g.actPages.some((p) => p.outcome === 'error')) g.errors.push({ source: 'oppdateringer', code: 'error', message: 'registry update feed lookup failed after retries' });
    if (g.website) {
      for (const v of g.website.verdicts) g.snapshots.push(...v.snapshots);
      websiteClaims(b, id, g.website);
      // Page texts are no longer needed; drop them so a large batch stays light in memory.
      for (const v of g.website.verdicts) {
        v.pages = [];
        v.proof = undefined;
      }
      if (g.website.state === 'incomplete')
        g.errors.push({ source: 'company_website', code: 'website_check_incomplete', message: g.website.verdicts.filter((v) => v.status === 'error').map((v) => `${v.candidate.domain}: ${v.reason}`).join('; ') || 'website check incomplete' });
    }
  }
  g.gatherMs = Date.now() - t0;
  return g;
}

function websiteAvailability(g: Gathered, entOk: boolean): Pick<Record<FieldFamily, FamilyAvailability>, 'official_website' | 'company_profiles'> {
  const b = g.b;
  const w = g.website;
  const ran = !!w && w.state !== 'disabled';
  const sources = ['enhetsregisteret', ...(ran ? ['company_website'] : [])];
  if (!entOk) {
    const reason = g.ent?.outcome === 'error' ? g.ent.snapshot.error || 'source_request_failed' : 'identity_not_resolved';
    const state = g.ent?.outcome === 'error' ? 'failed' : 'not_available';
    return {
      official_website: { state, reason, checked_sources: state === 'failed' ? ['enhetsregisteret'] : [] },
      company_profiles: { state, reason, checked_sources: [] },
    };
  }
  let official_website: FamilyAvailability;
  const site = b.claims.find((c) => c.key === 'official_website#website');
  if (site) {
    const via = (site.value as any).found_via;
    official_website = {
      state: 'available',
      reason: via ? `verified_on_site_via_${via}` : site.evidence_ids.length > 1 ? 'registered_and_verified_on_site' : 'registered_in_enhetsregisteret',
      checked_sources: sources,
    };
  } else if (w?.registryVerdict?.status === 'parked') official_website = { state: 'not_available', reason: 'registered_website_parked', checked_sources: sources };
  else if (!w || w.state === 'disabled') official_website = { state: 'not_available', reason: 'website_check_not_run', checked_sources: ['enhetsregisteret'] };
  else if (w.state === 'ambiguous') official_website = { state: 'ambiguous', reason: 'site_shows_several_organisation_numbers', checked_sources: sources };
  else if (w.state === 'incomplete') official_website = { state: 'failed', reason: 'website_check_incomplete', checked_sources: sources };
  else if (w.state === 'blocked') official_website = { state: 'blocked', reason: w.verdicts[0]?.reason || 'site_not_allowed', checked_sources: sources };
  else official_website = { state: 'not_available', reason: 'no_verified_website_found', checked_sources: sources };

  let company_profiles: FamilyAvailability;
  const profileClaims = b.claims.filter((c) => c.family === 'company_profiles');
  const fromSite = profileClaims.some((c) => c.evidence_ids.some((id) => b.evidence.get(id)?.source_class === 'company_owned'));
  if (profileClaims.length)
    company_profiles = {
      state: 'available',
      reason: fromSite ? 'linked_from_verified_website' : 'registered_in_enhetsregisteret',
      checked_sources: fromSite ? ['company_website'] : ['enhetsregisteret'],
    };
  else if (!w || w.state === 'disabled') company_profiles = { state: 'not_available', reason: 'website_check_not_run', checked_sources: [] };
  else if (w.verified) company_profiles = { state: 'not_available', reason: 'no_profiles_linked_from_verified_website', checked_sources: ['company_website'] };
  else if (w.state === 'incomplete') company_profiles = { state: 'failed', reason: 'website_check_incomplete', checked_sources: ['company_website'] };
  else company_profiles = { state: 'not_available', reason: 'no_verified_website', checked_sources: ['company_website'] };
  return { official_website, company_profiles };
}

/** Phase 2: hiring (from the run-wide NAV index), availability, refresh diff, summary. */
export async function assembleCompany(g: Gathered, ctx: RunContext): Promise<Envelope> {
  if (g.final) return g.final;
  const t1 = Date.now();
  const { orgnr, b, ent, roles, accounts, locPages, actPages, snapshots, errors } = g;
  const count = (n: number) => (g.requests += n);
  const identityOk = ent.outcome === 'ok' || (ent.outcome === 'gone' && b.count('status_flags') > 0);

  let jobsOutcome: 'ok' | 'error' | 'skipped' = 'skipped';
  let jobsReason = 'jobs_source_disabled';
  let jobsError: string | undefined;
  if (ent.outcome === 'ok' && ctx.jobs) {
    // Hiring: NAV ads whose employer is this organisation number or one of its sub-units.
    if (!ctx.jobs.info.ok) {
      jobsOutcome = 'error';
      jobsError = ctx.jobs.info.error || 'nav_job_index_unavailable';
    } else if (locPages.some((p) => p.outcome === 'error')) {
      // Without the sub-unit list, ads posted under a workplace number cannot be confirmed.
      jobsOutcome = 'error';
      jobsError = 'sub_units_unavailable';
    } else {
      const orgnrs = new Map<string, 'company' | 'sub_unit'>([[orgnr, 'company']]);
      const names: string[] = [];
      if (typeof ent.json?.navn === 'string') names.push(ent.json.navn);
      for (const c of b.claims)
        if (c.field === 'sub_unit') {
          const v = c.value as any;
          orgnrs.set(String(v.sub_unit_organisation_number), 'sub_unit');
          if (v.name) names.push(String(v.name));
        }
      const res = await ctx.jobs.confirm(ctx.client, names, orgnrs, ctx.maxJobDetails ?? 15, count);
      const feedSnap: SourceSnapshot = {
        id: 'snap:nav:feed',
        source: 'nav_job_feed',
        source_url: ctx.jobs.info.first_page_url,
        source_class: 'official_job_board',
        publisher: 'NAV (Arbeids- og velferdsetaten), arbeidsplassen.no',
        licence: 'NAV job feed API terms (https://arbeidsplassen.nav.no/vilkar-api)',
        retrieved_at: ctx.jobs.info.retrieved_at,
        http_status: 200,
        content_sha256: null,
        ok: true,
      };
      snapshots.push(feedSnap);
      for (const ad of res.ads) {
        snapshots.push(ad.snapshot);
        const { snapshot, uuid, ...value } = ad;
        b.add(snapshot, 'job_postings', 'job_ad', uuid, value as any, '$.ad_content', { sourceDate: ad.published });
      }
      if (res.ads.length) {
        jobsOutcome = 'ok';
        jobsReason = res.capped ? `found_in_source_first_${res.checked}_candidates_checked` : 'found_in_source';
      } else if (res.errors > 0) {
        jobsOutcome = 'error';
        jobsError = 'nav_ad_detail_unavailable';
      } else {
        jobsOutcome = 'ok';
        jobsReason = `checked_nav_no_active_ads_last_${ctx.jobs.info.window_days}_days`;
      }
    }
  }

  // 3. Availability per field family.
  const ER = ['enhetsregisteret'];
  const entOutcome = ent.outcome === 'ok' ? 'ok' : ent.outcome === 'error' ? 'error' : 'skipped';
  const entErr = ent.snapshot.error;
  const locOutcome = !locPages.length ? 'skipped' : locPages.some((p) => p.outcome === 'error') ? 'error' : 'ok';
  const lastLoc = locPages[locPages.length - 1];
  const truncated = lastLoc?.json?.page && lastLoc.json.page.totalPages > locPages.length;
  const site = websiteAvailability(g, ent.outcome === 'ok');
  const siteContactsUsed = b.claims.some((c) => c.family === 'contact_points' && c.key.includes('#website#'));
  let availability: Record<FieldFamily, FamilyAvailability> = {
    legal_identity: familyState(b, 'legal_identity', ER, entOutcome, 'not_found_in_enhetsregisteret', entErr),
    registered_address: familyState(b, 'registered_address', ER, entOutcome, 'no_address_registered', entErr),
    industry: familyState(b, 'industry', ER, entOutcome, 'no_industry_code_registered', entErr),
    employees: familyState(b, 'employees', ER, entOutcome, 'no_employee_count_registered', entErr),
    status_flags: familyState(b, 'status_flags', ER, ent.outcome === 'gone' ? 'ok' : entOutcome, 'no_status_registered', entErr),
    roles: familyState(b, 'roles', ['roller'], roles ? (roles.outcome === 'error' ? 'error' : 'ok') : 'skipped', roles ? 'no_active_roles_registered' : 'identity_not_resolved', roles?.snapshot.error),
    locations: familyState(b, 'locations', ['underenheter'], locOutcome, locPages.length ? 'checked_no_active_sub_units' : 'identity_not_resolved'),
    annual_accounts: familyState(b, 'annual_accounts', ['regnskapsregisteret'], accounts ? (accounts.outcome === 'error' ? 'error' : 'ok') : 'skipped', accounts ? 'no_annual_accounts_in_regnskapsregisteret' : 'identity_not_resolved', accounts?.snapshot.error),
    official_website: site.official_website,
    company_profiles: site.company_profiles,
    contact_points: familyState(b, 'contact_points', siteContactsUsed ? [...ER, 'company_website'] : ER, entOutcome, 'no_contact_details_registered', entErr),
    group_structure: familyState(b, 'group_structure', [...ER, 'regnskapsregisteret'], entOutcome, 'no_group_relation_registered', entErr),
    job_postings: familyState(b, 'job_postings', ['nav_job_feed'], ent.outcome !== 'ok' ? 'skipped' : jobsOutcome, ent.outcome !== 'ok' ? 'identity_not_resolved' : jobsReason, jobsError),
    public_activity: familyState(
      b,
      'public_activity',
      ['oppdateringer'],
      !actPages.length ? 'skipped' : actPages.some((p) => p.outcome === 'error') ? 'error' : 'ok',
      actPages.length ? 'no_registry_events_since_2025' : 'identity_not_resolved'
    ),
  };
  if (truncated && availability.locations.state === 'available')
    availability.locations = { ...availability.locations, reason: `found_in_source_first_${locPages.length * 100}_only` };
  if (availability.job_postings.state === 'available' && jobsReason !== 'found_in_source')
    availability.job_postings = { ...availability.job_postings, reason: jobsReason };
  // "jobs_source_disabled" is a skip with checked_sources cleared.
  if (ent.outcome === 'ok' && !ctx.jobs) availability.job_postings = { state: 'not_available', reason: 'jobs_source_disabled', checked_sources: [] };
  if (jobsError && availability.job_postings.state === 'failed') errors.push({ source: 'nav_job_feed', code: jobsError, message: 'job postings could not be checked in this run' });

  // Overall state follows the identity anchor. Deleted (410) and unknown (404) numbers
  // are reported as not_available rather than guessed at.
  let state: Envelope['state'];
  if (ent.outcome === 'ok') state = 'available';
  else if (ent.outcome === 'error') state = 'failed';
  else state = 'not_available';
  if (ent.outcome === 'not_found') {
    availability = emptyAvailability('not_available', 'not_found_in_enhetsregisteret');
  } else if (ent.outcome === 'gone') {
    availability = {
      ...emptyAvailability('not_available', 'deleted_from_enhetsregisteret'),
      ...(identityOk ? { status_flags: availability.status_flags } : {}),
    };
  }

  // 4. Refresh: diff against the previous stored snapshot for this company.
  const claims = b.claims;
  const evidence = [...b.evidence.values()];
  const prev = await loadState(ctx.stateDir, orgnr);
  const now = new Date().toISOString();
  const changes: Change[] = [];
  let unchanged = 0;
  const families = (c: Claim) => availability[c.family]?.state;
  // Contact links read from the company website are only re-checked when the site was verified again.
  const siteVerified = !!g.website?.verified;
  const notRechecked = (c: Claim) =>
    UNCHECKED_REASONS.has(availability[c.family]?.reason) || (c.family === 'contact_points' && c.key.includes('#website#') && !siteVerified);
  if (prev) {
    const prevByKey = new Map(prev.claims.map((c) => [c.key, c]));
    const prevEv = new Map(prev.evidence.map((e) => [e.id, e]));
    const curByKey = new Map(claims.map((c) => [c.key, c]));
    for (const c of claims) {
      const old = prevByKey.get(c.key);
      if (!old) {
        changes.push({ type: 'new_value', key: c.key, family: c.family, field: c.field, previous_value: null, new_value: c.value, previous_evidence: [], evidence_ids: c.evidence_ids, previous_retrieved_at: null, detected_at: now });
      } else if (stableStringify(old.value) !== stableStringify(c.value)) {
        changes.push({ type: 'changed_value', key: c.key, family: c.family, field: c.field, previous_value: old.value, new_value: c.value, previous_evidence: old.evidence_ids.map((id) => prevEv.get(id)).filter(Boolean) as Evidence[], evidence_ids: c.evidence_ids, previous_retrieved_at: old.retrieved_at, detected_at: now });
      } else unchanged++;
    }
    for (const old of prev.claims) {
      if (curByKey.has(old.key)) continue;
      // Only report a removal when that family was actually re-checked successfully,
      // and never for history-type families (a past registry event stays true).
      if (APPEND_ONLY.has(old.family)) continue;
      const s = families(old);
      if (s !== 'available' && s !== 'not_available') continue;
      if (notRechecked(old)) continue;
      changes.push({ type: 'removed_value', key: old.key, family: old.family, field: old.field, previous_value: old.value, new_value: null, previous_evidence: old.evidence_ids.map((id) => prevEv.get(id)).filter(Boolean) as Evidence[], evidence_ids: [], previous_retrieved_at: old.retrieved_at, detected_at: now });
    }
  }

  // Persist: keep earlier claims for families that failed or were not re-checked this run, so
  // evidence is not lost. A run where the identity lookup failed never overwrites the snapshot.
  if (state !== 'failed') {
    const keepFromPrev = prev
      ? prev.claims.filter((c) => {
          if (claims.some((x) => x.key === c.key)) return false;
          const fs = availability[c.family]?.state;
          return fs === 'failed' || fs === 'ambiguous' || fs === 'blocked' || notRechecked(c);
        })
      : [];
    const keepEvIds = new Set(keepFromPrev.flatMap((c) => c.evidence_ids));
    const nextState: StoredState = {
      organisation_number: orgnr,
      run_id: ctx.runId,
      retrieved_at: now,
      claims: [...claims, ...keepFromPrev],
      evidence: [...evidence, ...(prev ? prev.evidence.filter((e) => keepEvIds.has(e.id)) : [])],
      history: [...changes.filter((c) => c.type !== 'new_value').map((change) => ({ change, recorded_in_run: ctx.runId })), ...(prev?.history || [])].slice(0, 200),
    };
    await saveState(ctx.stateDir, nextState);
  }

  const summary = buildSummary(claims, availability, changes, prev ? 'previous_run' : 'cold_start', prev?.retrieved_at || null, orgnr);
  const nameClaim = claims.find((c) => c.field === 'legal_name');
  const formClaim = claims.find((c) => c.field === 'organisation_form');
  const completedAt = new Date().toISOString();

  return {
    schema_version: 'signalpost-envelope/1',
    organisation_number: orgnr,
    input_index: g.inputIndex,
    state,
    legal_identity:
      ent.outcome === 'ok' || ent.outcome === 'gone'
        ? {
            organisation_number: orgnr,
            legal_name: (nameClaim?.value as string) ?? null,
            organisation_form: (formClaim?.value as any) ?? null,
            registry_status: registryStatus(ent.json, ent.outcome === 'gone'),
            match: { method: 'exact_organisation_number', confidence: 1 },
          }
        : null,
    availability,
    claims,
    evidence,
    source_snapshots: snapshots,
    summary,
    changes,
    refresh: {
      baseline: prev ? 'previous_run' : 'cold_start',
      previous_run_id: prev?.run_id ?? null,
      previous_retrieved_at: prev?.retrieved_at ?? null,
      changes,
      unchanged_claims: unchanged,
    },
    run: { run_id: ctx.runId, started_at: g.startedAt, completed_at: completedAt, terminal_status: state === 'failed' ? 'failed' : 'completed' },
    operations: { requests: g.requests, runtime_ms: g.gatherMs + (Date.now() - t1), third_party_cost_usd: 0 },
    errors,
  };
}

/** One company end to end (used by the web app and single lookups). */
export async function researchCompany(rawOrgnr: string, inputIndex: number, ctx: RunContext): Promise<Envelope> {
  return assembleCompany(await gatherCompany(rawOrgnr, inputIndex, ctx), ctx);
}
