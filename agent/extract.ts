// Turns registry responses into claims with evidence. Rule: a claim is only
// published when the source holds the value. Missing values are never filled in
// (no defaults, no zeros), and every claim is keyed to the exact organisation number.

import { createHash } from 'node:crypto';
import type {
  Claim,
  ClaimValue,
  Evidence,
  FamilyAvailability,
  FieldFamily,
  ReportingPeriod,
  SourceSnapshot,
} from './types.ts';

export function sha(text: string, len = 12): string {
  return createHash('sha256').update(text).digest('hex').slice(0, len);
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class ClaimBuilder {
  claims: Claim[] = [];
  evidence = new Map<string, Evidence>();
  private keys = new Set<string>();

  constructor(private orgnr: string) {}

  add(
    snap: SourceSnapshot,
    family: FieldFamily,
    field: string,
    keySuffix: string | null,
    value: ClaimValue,
    claimSpan: string,
    opts: {
      unit?: string;
      reportingPeriod?: ReportingPeriod | null;
      sourceDate?: string | null;
      confidence?: number;
    } = {}
  ) {
    const key = keySuffix ? `${family}#${field}#${keySuffix}` : `${family}#${field}`;
    if (this.keys.has(key)) return; // same fact listed twice in a source → publish once
    this.keys.add(key);
    const evId = `ev:${this.orgnr}:${snap.source}:${(snap.content_sha256 || 'none').slice(0, 12)}:${claimSpan}`;
    if (!this.evidence.has(evId)) {
      this.evidence.set(evId, {
        id: evId,
        snapshot_id: snap.id,
        source_url: snap.source_url,
        source_class: 'official_registry',
        retrieved_at: snap.retrieved_at,
        content_sha256: snap.content_sha256,
        claim_span: claimSpan,
        reporting_period: opts.reportingPeriod ?? null,
      });
    }
    this.claims.push({
      id: `cl:${this.orgnr}:${sha(key + '|' + stableStringify(value))}`,
      key,
      family,
      field,
      value,
      ...(opts.unit ? { unit: opts.unit } : {}),
      availability: 'available',
      confidence: opts.confidence ?? 1,
      evidence_ids: [evId],
      reporting_period: opts.reportingPeriod ?? null,
      source_date: opts.sourceDate ?? null,
      retrieved_at: snap.retrieved_at,
    });
  }

  count(family: FieldFamily) {
    return this.claims.filter((c) => c.family === family).length;
  }
}

function formatAddress(a: any): Record<string, unknown> | null {
  if (!a || typeof a !== 'object') return null;
  const street = Array.isArray(a.adresse) ? a.adresse.filter(isNonEmptyString).join(', ') : '';
  const out: Record<string, unknown> = {};
  if (street) out.street = street;
  if (isNonEmptyString(a.postnummer)) out.postal_code = a.postnummer;
  if (isNonEmptyString(a.poststed)) out.city = a.poststed;
  if (isNonEmptyString(a.kommune)) out.municipality = a.kommune;
  if (isNonEmptyString(a.kommunenummer)) out.municipality_number = a.kommunenummer;
  if (isNonEmptyString(a.land)) out.country = a.land;
  if (Object.keys(out).length === 0) return null;
  out.formatted = [out.street, [out.postal_code, out.city].filter(Boolean).join(' '), out.country]
    .filter(Boolean)
    .join(', ');
  return out;
}

const codeDesc = (v: any): Record<string, unknown> | null =>
  v && isNonEmptyString(v.kode)
    ? { code: v.kode, ...(isNonEmptyString(v.beskrivelse) ? { description: v.beskrivelse } : {}) }
    : null;

// ---------------------------------------------------------------------------
// Enhetsregisteret: /enhetsregisteret/api/enheter/{orgnr}
// ---------------------------------------------------------------------------
export function extractEntity(b: ClaimBuilder, snap: SourceSnapshot, e: any) {
  const add = b.add.bind(b, snap);

  if (isNonEmptyString(e.navn)) add('legal_identity', 'legal_name', null, e.navn, '$.navn');
  const form = codeDesc(e.organisasjonsform);
  if (form) add('legal_identity', 'organisation_form', null, form, '$.organisasjonsform');
  if (isNonEmptyString(e.stiftelsesdato))
    add('legal_identity', 'founded_date', null, e.stiftelsesdato, '$.stiftelsesdato');
  if (isNonEmptyString(e.registreringsdatoEnhetsregisteret))
    add(
      'legal_identity',
      'registration_date',
      null,
      e.registreringsdatoEnhetsregisteret,
      '$.registreringsdatoEnhetsregisteret'
    );
  if (typeof e.registrertIForetaksregisteret === 'boolean')
    add(
      'legal_identity',
      'registered_in_business_register',
      null,
      e.registrertIForetaksregisteret,
      '$.registrertIForetaksregisteret'
    );
  if (typeof e.registrertIMvaregisteret === 'boolean')
    add('legal_identity', 'registered_for_vat', null, e.registrertIMvaregisteret, '$.registrertIMvaregisteret');

  const business = formatAddress(e.forretningsadresse);
  if (business) add('registered_address', 'business_address', null, business, '$.forretningsadresse');
  const postal = formatAddress(e.postadresse);
  if (postal) add('registered_address', 'postal_address', null, postal, '$.postadresse');

  for (const [i, k] of (['naeringskode1', 'naeringskode2', 'naeringskode3'] as const).entries()) {
    const nace = codeDesc(e[k]);
    if (nace) add('industry', 'nace_code', String(i + 1), { ...nace, rank: i + 1 }, `$.${k}`);
  }
  const sector = codeDesc(e.institusjonellSektorkode);
  if (sector) add('industry', 'institutional_sector', null, sector, '$.institusjonellSektorkode');
  if (Array.isArray(e.vedtektsfestetFormaal) && e.vedtektsfestetFormaal.some(isNonEmptyString))
    add(
      'industry',
      'statutory_purpose',
      null,
      e.vedtektsfestetFormaal.filter(isNonEmptyString).join(' '),
      '$.vedtektsfestetFormaal'
    );
  if (Array.isArray(e.aktivitet) && e.aktivitet.some(isNonEmptyString))
    add('industry', 'registered_activity', null, e.aktivitet.filter(isNonEmptyString).join(' '), '$.aktivitet');

  // Employees: only when the registry says a count is registered. A bare 0 without
  // that flag is treated as unknown, never as "zero employees".
  if (isNumber(e.antallAnsatte) && (e.harRegistrertAntallAnsatte === true || e.antallAnsatte > 0)) {
    add('employees', 'registered_employees', null, e.antallAnsatte, '$.antallAnsatte', {
      unit: 'employees',
      sourceDate:
        e.registreringsdatoAntallAnsatteNAVAaregisteret ||
        e.registreringsdatoAntallAnsatteEnhetsregisteret ||
        null,
    });
  }

  if (typeof e.konkurs === 'boolean')
    add('status_flags', 'bankrupt', null, e.konkurs, '$.konkurs', {
      sourceDate: isNonEmptyString(e.konkursdato) ? e.konkursdato : null,
    });
  if (typeof e.underAvvikling === 'boolean')
    add('status_flags', 'under_liquidation', null, e.underAvvikling, '$.underAvvikling', {
      sourceDate: isNonEmptyString(e.underAvviklingDato) ? e.underAvviklingDato : null,
    });
  if (typeof e.underTvangsavviklingEllerTvangsopplosning === 'boolean')
    add(
      'status_flags',
      'under_forced_dissolution',
      null,
      e.underTvangsavviklingEllerTvangsopplosning,
      '$.underTvangsavviklingEllerTvangsopplosning'
    );
  if (isNonEmptyString(e.slettedato)) add('status_flags', 'deleted_date', null, e.slettedato, '$.slettedato');

  if (isNonEmptyString(e.hjemmeside)) {
    const raw = e.hjemmeside.trim();
    add(
      'official_website',
      'website',
      null,
      { as_registered: raw, url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` },
      '$.hjemmeside',
      { confidence: 0.95 }
    );
  }

  if (isNonEmptyString(e.overordnetEnhet))
    add('group_structure', 'parent_organisation_number', null, e.overordnetEnhet, '$.overordnetEnhet');
}

export function registryStatus(
  e: any | null,
  gone: boolean
): 'active' | 'bankrupt' | 'under_liquidation' | 'forced_dissolution' | 'deleted' | 'unknown' {
  if (gone || (e && isNonEmptyString(e.slettedato))) return 'deleted';
  if (!e) return 'unknown';
  if (e.konkurs === true) return 'bankrupt';
  if (e.underTvangsavviklingEllerTvangsopplosning === true) return 'forced_dissolution';
  if (e.underAvvikling === true) return 'under_liquidation';
  return 'active';
}

// ---------------------------------------------------------------------------
// Roles: /enhetsregisteret/api/enheter/{orgnr}/roller
// Birth dates are deliberately not published (personal data minimisation).
// ---------------------------------------------------------------------------
export function extractRoles(b: ClaimBuilder, snap: SourceSnapshot, r: any) {
  const groups = Array.isArray(r?.rollegrupper) ? r.rollegrupper : [];
  groups.forEach((g: any, gi: number) => {
    const roles = Array.isArray(g?.roller) ? g.roller : [];
    roles.forEach((role: any, ri: number) => {
      if (role?.fratraadt === true || role?.avregistrert === true) return;
      const code = role?.type?.kode;
      if (!isNonEmptyString(code)) return;
      const value: Record<string, unknown> = {
        role_code: code,
        ...(isNonEmptyString(role.type.beskrivelse) ? { role: role.type.beskrivelse } : {}),
        ...(isNonEmptyString(g?.type?.kode) ? { group_code: g.type.kode } : {}),
      };
      let holderKey: string | null = null;
      const p = role.person;
      if (p?.navn && p.erDoed !== true) {
        const name = [p.navn.fornavn, p.navn.mellomnavn, p.navn.etternavn].filter(isNonEmptyString).join(' ');
        if (!name) return;
        value.holder_type = 'person';
        value.name = name;
        holderKey = name.toLowerCase();
      } else if (role.enhet && isNonEmptyString(role.enhet.organisasjonsnummer)) {
        const ename = Array.isArray(role.enhet.navn)
          ? role.enhet.navn.filter(isNonEmptyString).join(' ')
          : isNonEmptyString(role.enhet.navn)
          ? role.enhet.navn
          : '';
        value.holder_type = 'organisation';
        value.organisation_number = role.enhet.organisasjonsnummer;
        if (ename) value.name = ename;
        holderKey = role.enhet.organisasjonsnummer;
      }
      if (!holderKey) return;
      b.add(snap, 'roles', 'role', `${code}#${holderKey}`, value, `$.rollegrupper[${gi}].roller[${ri}]`, {
        sourceDate: isNonEmptyString(g?.sistEndret) ? g.sistEndret : null,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Sub-units (locations): /enhetsregisteret/api/underenheter?overordnetEnhet={orgnr}
// ---------------------------------------------------------------------------
export function extractLocations(b: ClaimBuilder, snap: SourceSnapshot, u: any, pageOffset: number) {
  const units = Array.isArray(u?._embedded?.underenheter) ? u._embedded.underenheter : [];
  units.forEach((s: any, i: number) => {
    if (!isNonEmptyString(s?.organisasjonsnummer) || isNonEmptyString(s?.nedleggelsesdato)) return;
    const value: Record<string, unknown> = { sub_unit_organisation_number: s.organisasjonsnummer };
    if (isNonEmptyString(s.navn)) value.name = s.navn;
    const addr = formatAddress(s.beliggenhetsadresse);
    if (addr) value.address = addr;
    const nace = codeDesc(s.naeringskode1);
    if (nace) value.nace = nace;
    if (isNumber(s.antallAnsatte) && (s.harRegistrertAntallAnsatte === true || s.antallAnsatte > 0))
      value.registered_employees = s.antallAnsatte;
    if (isNonEmptyString(s.oppstartsdato)) value.start_date = s.oppstartsdato;
    b.add(snap, 'locations', 'sub_unit', s.organisasjonsnummer, value, `$._embedded.underenheter[${i}]`, {
      sourceDate: isNonEmptyString(s.registreringsdatoEnhetsregisteret) ? s.registreringsdatoEnhetsregisteret : null,
    });
  });
  void pageOffset;
}

// ---------------------------------------------------------------------------
// Annual accounts: /regnskapsregisteret/regnskap/{orgnr}
// Only numbers present in the filing are published, with the reporting period.
// ---------------------------------------------------------------------------
const ACCOUNT_FIELDS: [string, string[]][] = [
  ['operating_revenue', ['resultatregnskapResultat', 'driftsresultat', 'driftsinntekter', 'sumDriftsinntekter']],
  ['operating_expenses', ['resultatregnskapResultat', 'driftsresultat', 'driftskostnad', 'sumDriftskostnad']],
  ['operating_profit', ['resultatregnskapResultat', 'driftsresultat', 'driftsresultat']],
  ['net_financial_items', ['resultatregnskapResultat', 'finansresultat', 'nettoFinans']],
  ['profit_before_tax', ['resultatregnskapResultat', 'ordinaertResultatFoerSkattekostnad']],
  ['net_income', ['resultatregnskapResultat', 'aarsresultat']],
  ['total_assets', ['eiendeler', 'sumEiendeler']],
  ['fixed_assets', ['eiendeler', 'anleggsmidler', 'sumAnleggsmidler']],
  ['current_assets', ['eiendeler', 'omloepsmidler', 'sumOmloepsmidler']],
  ['equity', ['egenkapitalGjeld', 'egenkapital', 'sumEgenkapital']],
  ['total_liabilities', ['egenkapitalGjeld', 'gjeldOversikt', 'sumGjeld']],
];

const dig = (o: any, path: string[]) => path.reduce((acc, k) => (acc == null ? undefined : acc[k]), o);

export function extractAccounts(b: ClaimBuilder, snap: SourceSnapshot, a: any) {
  const filings = Array.isArray(a) ? a : a && typeof a === 'object' ? [a] : [];
  filings.forEach((f: any, fi: number) => {
    const from = f?.regnskapsperiode?.fraDato;
    const to = f?.regnskapsperiode?.tilDato;
    if (!isNonEmptyString(from) || !isNonEmptyString(to)) return; // no period → not publishable
    const period = { from, to };
    const type = isNonEmptyString(f.regnskapstype) ? f.regnskapstype : 'UNSPECIFIED';
    const currency = isNonEmptyString(f.valuta) ? f.valuta : null;
    const base = `$[${fi}]`;
    for (const [field, path] of ACCOUNT_FIELDS) {
      const v = dig(f, path);
      if (!isNumber(v)) continue;
      b.add(snap, 'annual_accounts', field, `${type}#${to}`, v, `${base}.${path.join('.')}`, {
        ...(currency ? { unit: currency } : {}),
        reportingPeriod: period,
      });
    }
    if (typeof f?.revisjon?.ikkeRevidertAarsregnskap === 'boolean')
      b.add(
        snap,
        'annual_accounts',
        'audited',
        `${type}#${to}`,
        !f.revisjon.ikkeRevidertAarsregnskap,
        `${base}.revisjon.ikkeRevidertAarsregnskap`,
        { reportingPeriod: period }
      );
    if (typeof f?.virksomhet?.morselskap === 'boolean')
      b.add(snap, 'group_structure', 'is_parent_company', null, f.virksomhet.morselskap, `${base}.virksomhet.morselskap`, {
        reportingPeriod: period,
      });
    if (type === 'KONSERN')
      b.add(snap, 'group_structure', 'files_group_accounts', null, true, `${base}.regnskapstype`, {
        reportingPeriod: period,
      });
  });
}

export function familyState(
  b: ClaimBuilder,
  family: FieldFamily,
  sources: string[],
  outcome: 'ok' | 'not_found' | 'gone' | 'error' | 'skipped',
  emptyReason: string,
  error?: string
): FamilyAvailability {
  if (outcome === 'error') return { state: 'failed', reason: error || 'source_request_failed', checked_sources: sources };
  if (outcome === 'skipped') return { state: 'not_available', reason: emptyReason, checked_sources: [] };
  if (b.count(family) > 0) return { state: 'available', reason: 'found_in_source', checked_sources: sources };
  return { state: 'not_available', reason: emptyReason, checked_sources: sources };
}
