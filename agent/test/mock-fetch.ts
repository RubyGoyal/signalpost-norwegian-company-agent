// Test-only: replaces global fetch with canned Brønnøysund-shaped responses so the
// runner can be tested offline. All companies here are fictitious test fixtures.
//   MOCK_MUTATE=1      → company A's CEO and revenue change (refresh test)
//   MOCK_FAIL_ROLES=1  → roles endpoint returns 503 (partial-failure test)
//   MOCK_HANG=<orgnr>  → that company's registry call never answers (deadline test)

const A = '910000063'; // full profile
const B = '910000098'; // sparse profile: no employees registered, no accounts, no website
const C = '910000217'; // registry keeps failing (503)
const D = '910000322'; // unknown number (404)
const E = '910000357'; // deleted (410)

const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};
const mutate = env.MOCK_MUTATE === '1';
const failRoles = env.MOCK_FAIL_ROLES === '1';
const hang = env.MOCK_HANG;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const entities: Record<string, unknown> = {
  [A]: {
    organisasjonsnummer: A,
    navn: 'TESTSELSKAP ALPHA AS',
    organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
    hjemmeside: 'www.alpha-test.example',
    postadresse: { land: 'Norge', landkode: 'NO', postnummer: '0101', poststed: 'OSLO', adresse: ['Postboks 1'], kommune: 'OSLO', kommunenummer: '0301' },
    registreringsdatoEnhetsregisteret: '2012-03-01',
    registrertIMvaregisteret: true,
    naeringskode1: { kode: '62.010', beskrivelse: 'Programmeringstjenester' },
    naeringskode2: { kode: '62.020', beskrivelse: 'Konsulentvirksomhet tilknyttet informasjonsteknologi' },
    antallAnsatte: 42,
    harRegistrertAntallAnsatte: true,
    forretningsadresse: { land: 'Norge', landkode: 'NO', postnummer: '0150', poststed: 'OSLO', adresse: ['Testgata 1'], kommune: 'OSLO', kommunenummer: '0301' },
    stiftelsesdato: '2012-02-15',
    institusjonellSektorkode: { kode: '2100', beskrivelse: 'Private aksjeselskaper mv.' },
    registrertIForetaksregisteret: true,
    konkurs: false,
    underAvvikling: false,
    underTvangsavviklingEllerTvangsopplosning: false,
    vedtektsfestetFormaal: ['Utvikling og salg av programvare og tilknyttede tjenester.'],
  },
  [B]: {
    organisasjonsnummer: B,
    navn: 'TESTSELSKAP BETA AS',
    organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
    naeringskode1: { kode: '68.209', beskrivelse: 'Utleie av egen eller leid fast eiendom ellers' },
    antallAnsatte: 0,
    harRegistrertAntallAnsatte: false,
    forretningsadresse: { land: 'Norge', postnummer: '5003', poststed: 'BERGEN', adresse: ['Prøvevegen 2'], kommune: 'BERGEN' },
    konkurs: false,
    underAvvikling: false,
    underTvangsavviklingEllerTvangsopplosning: false,
  },
};

const roles: Record<string, unknown> = {
  [A]: {
    rollegrupper: [
      { type: { kode: 'DAGL', beskrivelse: 'Daglig leder/ adm.direktør' }, sistEndret: '2024-05-02',
        roller: [{ type: { kode: 'DAGL', beskrivelse: 'Daglig leder/ adm.direktør' }, person: { fodselsdato: '1980-01-01', navn: mutate ? { fornavn: 'Kari', etternavn: 'Testesen' } : { fornavn: 'Ola', etternavn: 'Testmann' }, erDoed: false }, fratraadt: false, rekkefolge: 0 }] },
      { type: { kode: 'STYR', beskrivelse: 'Styre' }, sistEndret: '2025-06-10',
        roller: [
          { type: { kode: 'LEDE', beskrivelse: 'Styrets leder' }, person: { navn: { fornavn: 'Per', mellomnavn: 'Prøve', etternavn: 'Hansen' }, erDoed: false }, fratraadt: false },
          { type: { kode: 'MEDL', beskrivelse: 'Styremedlem' }, person: { navn: { fornavn: 'Lise', etternavn: 'Eksempel' }, erDoed: false }, fratraadt: false },
          { type: { kode: 'MEDL', beskrivelse: 'Styremedlem' }, person: { navn: { fornavn: 'Gammel', etternavn: 'Fratrådt' }, erDoed: false }, fratraadt: true },
        ] },
      { type: { kode: 'REVI', beskrivelse: 'Revisor' }, sistEndret: '2020-01-01',
        roller: [{ type: { kode: 'REVI', beskrivelse: 'Revisor' }, enhet: { organisasjonsnummer: '910000616', navn: ['TESTREVISJON AS'], organisasjonsform: { kode: 'AS' } }, fratraadt: false }] },
    ],
  },
  [B]: { rollegrupper: [] },
};

const accounts: Record<string, unknown> = {
  [A]: [
    {
      id: 1,
      regnskapstype: 'SELSKAP',
      virksomhet: { organisasjonsnummer: A, organisasjonsform: 'AS', morselskap: false },
      regnskapsperiode: { fraDato: '2025-01-01', tilDato: '2025-12-31' },
      valuta: 'NOK',
      revisjon: { ikkeRevidertAarsregnskap: false, fravalgRevisjon: false },
      eiendeler: { sumEiendeler: 25_000_000, omloepsmidler: { sumOmloepsmidler: 20_000_000 }, anleggsmidler: { sumAnleggsmidler: 5_000_000 } },
      egenkapitalGjeld: { egenkapital: { sumEgenkapital: 10_000_000 }, gjeldOversikt: { sumGjeld: 15_000_000 } },
      resultatregnskapResultat: {
        ordinaertResultatFoerSkattekostnad: 4_100_000,
        aarsresultat: 3_200_000,
        finansresultat: { nettoFinans: 100_000 },
        driftsresultat: { driftsresultat: 4_000_000, driftsinntekter: { sumDriftsinntekter: mutate ? 61_500_000 : 58_000_000 }, driftskostnad: { sumDriftskostnad: 54_000_000 } },
      },
    },
  ],
  [B]: [],
};

const subUnits: Record<string, unknown> = {
  [A]: {
    _embedded: {
      underenheter: [
        { organisasjonsnummer: '910000462', navn: 'TESTSELSKAP ALPHA AS AVD BERGEN', beliggenhetsadresse: { adresse: ['Kaien 3'], postnummer: '5003', poststed: 'BERGEN', kommune: 'BERGEN', land: 'Norge' }, antallAnsatte: 12, harRegistrertAntallAnsatte: true, naeringskode1: { kode: '62.010', beskrivelse: 'Programmeringstjenester' } },
        { organisasjonsnummer: '910000497', navn: 'TESTSELSKAP ALPHA AS AVD STENGT', nedleggelsesdato: '2023-01-01' },
      ],
    },
    page: { size: 100, totalElements: 2, totalPages: 1, number: 0 },
  },
  [B]: { page: { size: 100, totalElements: 0, totalPages: 0, number: 0 } },
};

globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const p = url.pathname;
  const org = p.match(/(\d{9})/)?.[1] || url.searchParams.get('overordnetEnhet') || '';
  if (hang && org === hang) {
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
  }
  if (org === C) return json(503, { error: 'Service Unavailable' });
  if (p.startsWith('/enhetsregisteret/api/underenheter')) return json(200, subUnits[org] ?? { page: { totalElements: 0, totalPages: 0 } });
  if (p.endsWith('/roller')) {
    if (failRoles) return json(503, { error: 'unavailable' });
    return roles[org] ? json(200, roles[org]) : json(404, { status: 404 });
  }
  if (p.startsWith('/regnskapsregisteret/regnskap/')) return json(200, accounts[org] ?? []);
  if (p.startsWith('/enhetsregisteret/api/enheter/')) {
    if (org === E) return json(410, { organisasjonsnummer: E, slettedato: '2024-11-30' });
    return entities[org] ? json(200, entities[org]) : json(404, { status: 404, error: 'Not Found' });
  }
  return json(404, {});
}) as typeof fetch;
