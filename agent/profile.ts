// Researches one organisation number and returns exactly one terminal envelope.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateOrgnr } from './orgnr.ts';
import type { BrregClient, FetchResult } from './brreg.ts';
import {
  ClaimBuilder,
  extractAccounts,
  extractEntity,
  extractLocations,
  extractRoles,
  familyState,
  registryStatus,
  stableStringify,
} from './extract.ts';
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
}

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

  const web = one('website');
  if (web) st.push({ text: `Website (as registered): ${(web.value as any).url}.`, evidence_ids: ev(web) });

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
    return `${f.replace(/_/g, ' ')} (none registered)`;
  };
  if (unknowns.length)
    st.push({ text: `Unknown or not published: ${unknowns.map(reasonText).join(', ')}.`, evidence_ids: [] });

  return { generator: 'deterministic_v1', text: st.map((s) => s.text).join(' '), statements: st, unknowns };
}

export async function researchCompany(rawOrgnr: string, inputIndex: number, ctx: RunContext): Promise<Envelope> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const check = validateOrgnr(rawOrgnr);
  if (!check.valid) {
    return failedEnvelope(check.normalized || rawOrgnr, inputIndex, ctx.runId, startedAt, 'invalid_organisation_number', check.reason || 'invalid organisation number');
  }
  const orgnr = check.normalized;
  let requests = 0;
  const count = (n: number) => (requests += n);
  const snapId = (s: string) => `snap:${orgnr}:${s}`;
  const snapshots: SourceSnapshot[] = [];
  const errors: Envelope['errors'] = [];
  const b = new ClaimBuilder(orgnr);

  // 1. Enhetsregisteret is the identity anchor. If it fails, nothing else is published.
  const ent = await ctx.client.get('enhetsregisteret', `/enhetsregisteret/api/enheter/${orgnr}`, snapId('enhetsregisteret'), count);
  snapshots.push(ent.snapshot);
  if (ent.outcome === 'error') {
    errors.push({ source: 'enhetsregisteret', code: ent.snapshot.error || 'error', message: 'Enhetsregisteret lookup failed after retries' });
  }
  if (ent.outcome === 'ok' || ent.outcome === 'gone') extractEntity(b, ent.snapshot, ent.json || {});

  const identityOk = ent.outcome === 'ok' || (ent.outcome === 'gone' && b.count('status_flags') > 0);

  // 2. Roles, sub-units and annual accounts in parallel — all keyed by the same org number.
  let roles: FetchResult | null = null;
  let accounts: FetchResult | null = null;
  const locPages: FetchResult[] = [];
  if (ent.outcome === 'ok') {
    const locTask = (async () => {
      for (let page = 0; page < ctx.maxLocationPages; page++) {
        const r = await ctx.client.get(
          'underenheter',
          `/enhetsregisteret/api/underenheter?overordnetEnhet=${orgnr}&size=100&page=${page}`,
          snapId(`underenheter:${page}`),
          count
        );
        locPages.push(r);
        const total = r.json?.page?.totalPages;
        if (r.outcome !== 'ok' || !Number.isFinite(total) || page + 1 >= total) break;
      }
    })();
    [roles, accounts] = await Promise.all([
      ctx.client.get('roller', `/enhetsregisteret/api/enheter/${orgnr}/roller`, snapId('roller'), count),
      ctx.client.get('regnskapsregisteret', `/regnskapsregisteret/regnskap/${orgnr}`, snapId('regnskapsregisteret'), count),
      locTask,
    ]);
    snapshots.push(roles!.snapshot, accounts!.snapshot, ...locPages.map((p) => p.snapshot));
    if (roles!.outcome === 'ok') extractRoles(b, roles!.snapshot, roles!.json);
    if (accounts!.outcome === 'ok') extractAccounts(b, accounts!.snapshot, accounts!.json);
    locPages.forEach((p, i) => p.outcome === 'ok' && extractLocations(b, p.snapshot, p.json, i * 100));
    for (const [src, r] of [['roller', roles], ['regnskapsregisteret', accounts]] as const)
      if (r!.outcome === 'error') errors.push({ source: src, code: r!.snapshot.error || 'error', message: `${src} lookup failed after retries` });
    if (locPages.some((p) => p.outcome === 'error'))
      errors.push({ source: 'underenheter', code: 'error', message: 'sub-unit lookup failed after retries' });
  }

  // 3. Availability per field family.
  const ER = ['enhetsregisteret'];
  const entOutcome = ent.outcome === 'ok' ? 'ok' : ent.outcome === 'error' ? 'error' : 'skipped';
  const entErr = ent.snapshot.error;
  const locOutcome = !locPages.length
    ? 'skipped'
    : locPages.some((p) => p.outcome === 'error')
    ? 'error'
    : 'ok';
  const lastLoc = locPages[locPages.length - 1];
  const truncated = lastLoc?.json?.page && lastLoc.json.page.totalPages > locPages.length;
  let availability: Record<FieldFamily, FamilyAvailability> = {
    legal_identity: familyState(b, 'legal_identity', ER, entOutcome, 'not_found_in_enhetsregisteret', entErr),
    registered_address: familyState(b, 'registered_address', ER, entOutcome, 'no_address_registered', entErr),
    industry: familyState(b, 'industry', ER, entOutcome, 'no_industry_code_registered', entErr),
    employees: familyState(b, 'employees', ER, entOutcome, 'no_employee_count_registered', entErr),
    status_flags: familyState(b, 'status_flags', ER, ent.outcome === 'gone' ? 'ok' : entOutcome, 'no_status_registered', entErr),
    roles: familyState(b, 'roles', ['roller'], roles ? (roles.outcome === 'error' ? 'error' : 'ok') : 'skipped', roles ? 'no_active_roles_registered' : 'identity_not_resolved', roles?.snapshot.error),
    locations: familyState(b, 'locations', ['underenheter'], locOutcome, locPages.length ? 'checked_no_active_sub_units' : 'identity_not_resolved'),
    annual_accounts: familyState(b, 'annual_accounts', ['regnskapsregisteret'], accounts ? (accounts.outcome === 'error' ? 'error' : 'ok') : 'skipped', accounts ? 'no_annual_accounts_in_regnskapsregisteret' : 'identity_not_resolved', accounts?.snapshot.error),
    official_website: familyState(b, 'official_website', ER, entOutcome, 'no_website_registered_in_enhetsregisteret', entErr),
    group_structure: familyState(b, 'group_structure', [...ER, 'regnskapsregisteret'], entOutcome, 'no_group_relation_registered', entErr),
    job_postings: { state: 'not_available', reason: NOT_CHECKED, checked_sources: [] },
    public_activity: { state: 'not_available', reason: NOT_CHECKED, checked_sources: [] },
  };
  if (truncated && availability.locations.state === 'available')
    availability.locations = { ...availability.locations, reason: `found_in_source_first_${locPages.length * 100}_only` };

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
      // Only report a removal when that family was actually re-checked successfully.
      const s = families(old);
      if (s !== 'available' && s !== 'not_available') continue;
      if (availability[old.family].reason === NOT_CHECKED) continue;
      changes.push({ type: 'removed_value', key: old.key, family: old.family, field: old.field, previous_value: old.value, new_value: null, previous_evidence: old.evidence_ids.map((id) => prevEv.get(id)).filter(Boolean) as Evidence[], evidence_ids: [], previous_retrieved_at: old.retrieved_at, detected_at: now });
    }
  }

  // Persist: keep earlier claims for families that failed this run so evidence is not lost.
  // A run where the identity lookup failed never overwrites the stored snapshot.
  if (state !== 'failed') {
    const keepFromPrev = prev ? prev.claims.filter((c) => availability[c.family]?.state === 'failed') : [];
    const keepEvIds = new Set(keepFromPrev.flatMap((c) => c.evidence_ids));
    const nextState: StoredState = {
      organisation_number: orgnr,
      run_id: ctx.runId,
      retrieved_at: now,
      claims: [...claims, ...keepFromPrev],
      evidence: [...evidence, ...(prev ? prev.evidence.filter((e) => keepEvIds.has(e.id)) : [])],
      history: [
        ...changes.filter((c) => c.type !== 'new_value').map((change) => ({ change, recorded_in_run: ctx.runId })),
        ...(prev?.history || []),
      ].slice(0, 200),
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
    input_index: inputIndex,
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
    refresh: {
      baseline: prev ? 'previous_run' : 'cold_start',
      previous_run_id: prev?.run_id ?? null,
      previous_retrieved_at: prev?.retrieved_at ?? null,
      changes,
      unchanged_claims: unchanged,
    },
    run: { run_id: ctx.runId, started_at: startedAt, completed_at: completedAt, terminal_status: state === 'failed' ? 'failed' : 'completed' },
    operations: { requests, runtime_ms: Date.now() - t0, third_party_cost_usd: 0 },
    errors,
  };
}
