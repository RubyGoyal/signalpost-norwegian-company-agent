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

  if (isNonEmptyString(e.registreringsdatoForetaksregisteret))
    add(
      'legal_identity',
      'business_register_date',
      null,
      e.registreringsdatoForetaksregisteret,
      '$.registreringsdatoForetaksregisteret'
    );

  // Share capital, with the date it was registered.
  const kap = e.kapital;
  if (kap && isNumber(kap.belop)) {
    const k = kap;
    const cap: Record<string, unknown> = { amount: k.belop };
    if (isNonEmptyString(k.valuta)) cap.currency = k.valuta;
    if (isNumber(k.antallAksjer)) cap.shares = k.antallAksjer;
    if (isNonEmptyString(k.type)) cap.type = k.type;
    if (isNonEmptyString(k.innfortDato)) cap.registered_date = k.innfortDato;
    add('legal_identity', 'share_capital', null, cap, '$.kapital', {
      ...(isNonEmptyString(k.valuta) ? { unit: k.valuta } : {}),
      sourceDate: isNonEmptyString(k.innfortDato) ? k.innfortDato : null,
    });
  }

  // Former legal names with the period each was used (helps match the public brand).
  if (Array.isArray(e.historiskeNavn)) {
    e.historiskeNavn.forEach((h: any, i: number) => {
      if (!isNonEmptyString(h?.navn)) return;
      const v: Record<string, unknown> = { name: h.navn };
      if (isNonEmptyString(h.fraDato)) v.from = h.fraDato.slice(0, 10);
      if (isNonEmptyString(h.tilDato)) v.to = h.tilDato.slice(0, 10);
      add('legal_identity', 'former_name', `${h.navn}#${v.from || ''}`, v, `$.historiskeNavn[${i}]`, {
        sourceDate: (v.to as string) || null,
      });
    });
  }

  if (isNonEmptyString(e.sisteInnsendteAarsregnskap))
    add(
      'annual_accounts',
      'latest_filed_accounts_year',
      null,
      e.sisteInnsendteAarsregnskap,
      '$.sisteInnsendteAarsregnskap'
    );

  if (typeof e.erIKonsern === 'boolean')
    add('group_structure', 'is_group_member', null, e.erIKonsern, '$.erIKonsern');

  // Registry notices (påtegninger), e.g. a missing auditor or board.
  if (Array.isArray(e.paategninger)) {
    e.paategninger.forEach((p: any, i: number) => {
      const text = isNonEmptyString(p?.tekst) ? p.tekst : isNonEmptyString(p) ? p : '';
      if (!text) return;
      const v: Record<string, unknown> = { text };
      if (isNonEmptyString(p?.infotype)) v.type = p.infotype;
      const date = isNonEmptyString(p?.innfoertDato) ? p.innfoertDato : null;
      if (date) v.date = date;
      add('status_flags', 'registry_notice', `${v.type || ''}#${text.slice(0, 40)}`, v, `$.paategninger[${i}]`, {
        sourceDate: date,
      });
    });
  }

  // Registered contact points. Not published for sole proprietorships (ENK), where the
  // contact details are a private person's.
  if (e?.organisasjonsform?.kode !== 'ENK') {
    if (isNonEmptyString(e.epostadresse))
      add('contact_points', 'email', null, e.epostadresse.trim(), '$.epostadresse', { confidence: 0.95 });
    if (isNonEmptyString(e.telefon))
      add('contact_points', 'phone', null, e.telefon.trim(), '$.telefon', { confidence: 0.95 });
    if (isNonEmptyString(e.mobil))
      add('contact_points', 'mobile', null, e.mobil.trim(), '$.mobil', { confidence: 0.95 });
  }

  if (isNonEmptyString(e.overordnetEnhet))
    add('group_structure', 'parent_organisation_number', null, e.overordnetEnhet, '$.overordnetEnhet');
}

// ---------------------------------------------------------------------------
// Public activity: Enhetsregisteret update feed for this organisation number
// (/enhetsregisteret/api/oppdateringer/enheter?organisasjonsnummer=…&includeChanges=true).
// Each dated registry event becomes one claim. Events are history, so they are never
// reported as "removed" when they fall outside the fetched window.
// ---------------------------------------------------------------------------
const ACTIVITY_LABELS: [RegExp, string][] = [
  [/^\/navn$/, 'legal name changed'],
  [/^\/organisasjonsform/, 'organisation form changed'],
  [/^\/forretningsadresse/, 'business address changed'],
  [/^\/postadresse/, 'postal address changed'],
  [/^\/naeringskode/, 'industry code changed'],
  [/^\/vedtektsfestetFormaal|^\/aktivitet/, 'registered purpose changed'],
  [/^\/antallAnsatte$/, 'employee count updated'],
  [/^\/sisteInnsendteAarsregnskap$/, 'annual accounts filed'],
  [/^\/hjemmeside$/, 'website changed'],
  [/^\/kapital/, 'share capital changed'],
  [/^\/konkurs/, 'bankruptcy status changed'],
  [/^\/underAvvikling/, 'liquidation status changed'],
  [/^\/underTvangsavvikling/, 'forced dissolution status changed'],
  [/^\/registrertIMvaregisteret$/, 'VAT registration changed'],
  [/^\/registrertIForetaksregisteret$/, 'business register status changed'],
  [/^\/epostadresse|^\/telefon|^\/mobil/, 'contact details changed'],
  [/^\/paategninger/, 'registry notice changed'],
];
// Values safe to quote in the activity text (no personal data).
const QUOTABLE = /^\/(navn|antallAnsatte|sisteInnsendteAarsregnskap|hjemmeside|konkurs|underAvvikling|registrertIMvaregisteret)$/;

export function extractActivity(b: ClaimBuilder, snap: SourceSnapshot, page: any, offset: number) {
  const items = Array.isArray(page?._embedded?.oppdaterteEnheter) ? page._embedded.oppdaterteEnheter : [];
  items.forEach((u: any, i: number) => {
    const type = isNonEmptyString(u?.endringstype) ? u.endringstype : 'Ukjent';
    const date = isNonEmptyString(u?.dato) ? u.dato : null;
    if (!date || u?.oppdateringsid === undefined) return;
    const changes = Array.isArray(u.endringer) ? u.endringer : [];
    const labels = new Set<string>();
    const details: string[] = [];
    for (const c of changes) {
      const p = String(c?.path || '');
      if (/^\/registreringsdato|^\/_links/.test(p)) continue; // bookkeeping dates, not events
      const hit = ACTIVITY_LABELS.find(([re]) => re.test(p));
      if (!hit) continue;
      labels.add(hit[1]);
      if (QUOTABLE.test(p) && c.value !== undefined && c.value !== null && typeof c.value !== 'object')
        details.push(`${hit[1]}: ${c.value}`);
    }
    // Skip events that say nothing (old "Ukjent" entries without change details).
    if (type === 'Ukjent' && labels.size === 0) return;
    if (type === 'Endring' && labels.size === 0) return;
    const summary =
      type === 'Ny'
        ? 'registered in Enhetsregisteret'
        : type === 'Sletting'
        ? 'deleted from Enhetsregisteret'
        : details.length
        ? details.join('; ')
        : [...labels].join('; ');
    b.add(
      snap,
      'public_activity',
      'registry_event',
      String(u.oppdateringsid),
      { date: date.slice(0, 10), event: summary, change_type: type, fields: [...labels] },
      `$._embedded.oppdaterteEnheter[${i}]`,
      { sourceDate: date.slice(0, 10) }
    );
  });
  void offset;
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
