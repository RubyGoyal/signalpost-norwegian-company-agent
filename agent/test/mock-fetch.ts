// Test-only: replaces global fetch with canned Brønnøysund-shaped responses so the
// runner can be tested offline. All companies here are fictitious test fixtures.
//   MOCK_MUTATE=1      → company A's CEO and revenue change (refresh test)
//   MOCK_FAIL_ROLES=1  → roles endpoint returns 503 (partial-failure test)
//   MOCK_HANG=<orgnr>  → that company's registry call never answers (deadline test)
//   MOCK_NAV_DOWN=1    → NAV job feed returns 503 (hiring source outage)
//   MOCK_AD_INACTIVE=1 → company A's job ad has gone inactive (refresh removal test)
//   MOCK_SITE_DOWN=1   → company A's website does not answer (no false removals test)
//   MOCK_SITE_GONE=1   → two verified sites refuse connections (a guessed one and a registered one)
//   MOCK_JOBLIST_DOWN=1 → the Jobylon job list times out
//   MOCK_NO_WEB=1      → no DNS at all: the public web is unreachable (website step not run)
// Company websites are served from the WEB table below, with a fake DNS (globalThis.__SIGNALPOST_DNS__).

const A = '910000063'; // full profile
const B = '910000098'; // sparse profile: no employees registered, no accounts, no website
const C = '910000217'; // registry keeps failing (503)
const D = '910000322'; // unknown number (404)
const E = '910000357'; // deleted (410)
const G = '910000721'; // sole proprietorship (ENK) with contact details that must not be published
const OTHER = '910000756'; // a namesake employer that is NOT company A
const H = '910000802'; // email domain is a group site listing several companies → ambiguous
const I = '910000810'; // registered website is a parked domain
const J = '910000829'; // email domain resolves to a private address → never contacted
const K = '910000837'; // registered website disallows robots → not read
const L = '910000845'; // name-spelled domain shows only the name → not enough
const M = '910000888'; // registered "website" is a Facebook page → a registered profile, not crawled
const N = '910000896'; // email-domain site: brand-only title, full legal name in the footer → verified
// Builderr audit (version 3): the website must be the company's own, not a group, chain or brand site.
const O = '910000918'; // registered website is the parent group's site: names several companies, no org numbers
const P = '910000926'; // registered website is the chain's site, showing the chain's own org number
const Q = '910000942'; // registered website is a brand site showing neither the name nor the org number
const R = '910000950'; // registered website is this company's page on the group's site (a path)
const S = '910000977'; // registered website refuses automated readers (HTTP 403); its domain carries the name → kept
const T = '910000985'; // registered website refuses automated readers; a chain-style domain without the name → not kept
// From the live check of version 4 on real sites:
const V = '910000993'; // the full title names the company only as a whole ("Bemanning | Sigma Personal | Telemark & Agder")
const W = '910001000'; // single-word name, thin homepage named after the company on its own domain
const X = '910001019'; // the front page redirects to a deep page on the same site: still the company's own site

const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};
const mutate = env.MOCK_MUTATE === '1';
const failRoles = env.MOCK_FAIL_ROLES === '1';
const hang = env.MOCK_HANG;
const navDown = env.MOCK_NAV_DOWN === '1';
const adInactive = env.MOCK_AD_INACTIVE === '1';
const siteDown = env.MOCK_SITE_DOWN === '1';
const siteGone = env.MOCK_SITE_GONE === '1';
const jobListDown = env.MOCK_JOBLIST_DOWN === '1';
const noWeb = env.MOCK_NO_WEB === '1';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const entities: Record<string, unknown> = {
  [A]: {
    organisasjonsnummer: A,
    navn: 'TESTSELSKAP ALPHA AS',
    organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
    hjemmeside: 'www.alpha-test.no',
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
    registreringsdatoForetaksregisteret: '2012-03-02',
    kapital: { antallAksjer: 300, belop: 30000, innfortDato: '2012-03-02', type: 'Aksjekapital', valuta: 'NOK' },
    historiskeNavn: [{ fraDato: '2012-03-01 10:00:00', navn: 'ALPHA TEST HOLDING AS', tilDato: '2019-06-30 09:00:00' }],
    erIKonsern: false,
    sisteInnsendteAarsregnskap: '2025',
    epostadresse: 'post@alpha-test.no',
    paategninger: [],
  },
  [G]: {
    organisasjonsnummer: G,
    navn: 'Test Testesen Enkeltpersonforetak',
    organisasjonsform: { kode: 'ENK', beskrivelse: 'Enkeltpersonforetak' },
    epostadresse: 'test.testesen@example.com',
    mobil: '+47 99 99 99 99',
    forretningsadresse: { land: 'Norge', postnummer: '7010', poststed: 'TRONDHEIM', adresse: ['Prøvegata 7'], kommune: 'TRONDHEIM' },
    konkurs: false,
    underAvvikling: false,
    underTvangsavviklingEllerTvangsopplosning: false,
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
  ...Object.fromEntries(
    ([
      [H, 'TESTSELSKAP GAMMA AS', { epostadresse: 'post@gamma-group.no' }],
      [I, 'TESTSELSKAP DELTA AS', { hjemmeside: 'www.delta-test.no' }],
      [J, 'TESTSELSKAP EPSILON AS', { epostadresse: 'post@epsilon-test.no' }],
      [K, 'TESTSELSKAP ZETA AS', { hjemmeside: 'www.zeta-test.no' }],
      [L, 'TESTSELSKAP ETA AS', { epostadresse: 'post@eta-mail.no' }],
      [M, 'TESTSELSKAP THETA AS', { hjemmeside: 'https://www.facebook.com/testselskaptheta' }],
      [N, 'IOTA HANDEL OG SERVICE AS', { epostadresse: 'post@iota-butikk.no' }],
      [O, 'KAPPA BYGG AS', { hjemmeside: 'www.kappa-gruppen.no' }],
      [P, 'LAMBDA MAJORSTUEN AS', { hjemmeside: 'www.lambda-kjeden.no' }],
      [Q, 'SIGMA RØR AS', { hjemmeside: 'www.vvs-partner.no' }],
      [R, 'TAU BYGG AS', { hjemmeside: 'www.tau-gruppen.no/selskaper/tau-bygg' }],
      [S, 'TESTSELSKAP OMEGA AS', { hjemmeside: 'www.omega-test.no' }],
      [T, 'TESTSELSKAP PSI AS', { hjemmeside: 'www.butikkjeden.no' }],
      [V, 'SIGMA PERSONAL TELEMARK AS', { hjemmeside: 'www.sigmapersonal.no' }],
      [W, 'IDEHUSET AS', { hjemmeside: 'www.idehuset.no' }],
      [X, 'TESTSELSKAP XI AS', { hjemmeside: 'www.xi-test.no' }],
    ] as [string, string, Record<string, string>][]).map(([o, navn, extra]) => [
      o,
      {
        organisasjonsnummer: o,
        navn,
        organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
        forretningsadresse: { land: 'Norge', postnummer: '0150', poststed: 'OSLO', adresse: ['Annengata 9'], kommune: 'OSLO' },
        konkurs: false,
        underAvvikling: false,
        underTvangsavviklingEllerTvangsopplosning: false,
        ...extra,
      },
    ])
  ),
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
    {
      id: 2,
      regnskapstype: 'SELSKAP',
      virksomhet: { organisasjonsnummer: A, organisasjonsform: 'AS', morselskap: false },
      regnskapsperiode: { fraDato: '2024-01-01', tilDato: '2024-12-31' },
      valuta: 'NOK',
      resultatregnskapResultat: { aarsresultat: 2_000_000, driftsresultat: { driftsinntekter: { sumDriftsinntekter: 50_000_000 } } },
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

const updates: Record<string, unknown> = {
  [A]: {
    _embedded: {
      oppdaterteEnheter: [
        { dato: '2025-03-01T22:00:00.000Z', endringstype: 'Ukjent', oppdateringsid: 501, organisasjonsnummer: A },
        {
          dato: '2026-06-20T10:00:00.000Z',
          endringstype: 'Endring',
          oppdateringsid: 502,
          organisasjonsnummer: A,
          endringer: [
            { op: 'replace', path: '/registreringsdatoAntallAnsatteEnhetsregisteret', value: '2026-06-20' },
            { op: 'replace', path: '/antallAnsatte', value: 42 },
          ],
        },
        {
          dato: '2026-08-18T18:00:17.195Z',
          endringstype: 'Endring',
          oppdateringsid: 503,
          organisasjonsnummer: A,
          endringer: [{ op: 'replace', path: '/sisteInnsendteAarsregnskap', value: '2025' }],
        },
        // A nightly update just after midnight in Norway. QA run (Equinor): on a re-check the same
        // update came back a day later; the mutated run writes the same instant in Norwegian time.
        {
          dato: mutate ? '2026-07-03T00:04:38.138+02:00' : '2026-07-02T22:04:38.138Z',
          endringstype: 'Endring',
          oppdateringsid: 504,
          organisasjonsnummer: A,
          endringer: [{ op: 'replace', path: '/kapital/belop', value: 30000 }],
        },
        // A new event that appears only in the mutated run.
        ...(mutate
          ? [
              {
                dato: '2026-10-20T08:00:00.000Z',
                endringstype: 'Endring',
                oppdateringsid: 505,
                organisasjonsnummer: A,
                endringer: [{ op: 'replace', path: '/hjemmeside', value: 'www.alpha-test.no' }],
              },
            ]
          : []),
      ],
    },
    page: { size: 100, totalElements: mutate ? 5 : 4, totalPages: 1, number: 0 },
  },
};

// NAV job feed: two pages. Ad 1 is posted under A's Bergen sub-unit (must be attached),
// ad 2 is a namesake employer with a different org number (must not be attached), ad 3
// was active but its latest entry is INACTIVE (must not be attached).
const FEED = 'https://pam-stilling-feed.nav.no';
const ad = (uuid: string, status: string, businessName: string, modified: string) => ({
  id: uuid,
  url: `/api/v1/feedentry/${uuid}`,
  title: 'Utvikler',
  date_modified: modified,
  _feed_entry: { uuid, status, title: 'Utvikler', businessName, municipal: 'BERGEN', sistEndret: modified },
});
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444'; // posted under a brand name, employer = A's sub-unit
const feedPages: Record<string, unknown> = {
  '/api/v1/feed': {
    items: [
      ad(U1, adInactive ? 'INACTIVE' : 'ACTIVE', 'TESTSELSKAP ALPHA AS AVD BERGEN', '2026-10-10T10:00:00+02:00'),
      ad(U3, 'ACTIVE', 'TESTSELSKAP ALPHA AS', '2026-10-11T10:00:00+02:00'),
    ],
    next_url: '/api/v1/feed/page-2',
    next_id: 'page-2',
  },
  '/api/v1/feed/page-2': {
    items: [
      ad(U2, 'ACTIVE', 'Testselskap Alpha', '2026-10-12T10:00:00+02:00'),
      ad(U3, 'INACTIVE', 'TESTSELSKAP ALPHA AS', '2026-10-13T10:00:00+02:00'),
      ad(U4, 'ACTIVE', 'Alpha Kantine Bergen', '2026-10-09T10:00:00+02:00'),
    ],
    next_url: null,
    next_id: null,
  },
};
const adDetails: Record<string, unknown> = {
  [U1]: {
    uuid: U1,
    status: adInactive ? 'INACTIVE' : 'ACTIVE',
    ad_content: {
      title: 'Senior utvikler',
      published: '2026-10-10T09:00:00+02:00',
      expires: '2099-12-31T00:00:00+01:00',
      positioncount: 2,
      extent: 'Heltid',
      engagementtype: 'Fast',
      workLocations: [{ city: 'BERGEN', municipal: 'BERGEN', county: 'VESTLAND' }],
      contactList: [{ name: 'Private Person', email: 'private@example.com' }],
      employer: { name: 'TESTSELSKAP ALPHA AS AVD BERGEN', orgnr: '910000462' },
    },
  },
  [U2]: {
    uuid: U2,
    status: 'ACTIVE',
    ad_content: { title: 'Selger', published: '2026-10-12T09:00:00+02:00', expires: '2099-12-31T00:00:00+01:00', employer: { name: 'TESTSELSKAP ALPHA', orgnr: OTHER } },
  },
  [U4]: {
    uuid: U4,
    status: 'ACTIVE',
    ad_content: {
      title: 'Kokk',
      published: '2026-10-01T09:00:00+02:00',
      expires: '2099-12-31T00:00:00+01:00',
      employer: { name: 'Alpha Kantine Bergen', orgnr: '910000462' },
    },
  },
  [U3]: {
    uuid: U3,
    status: 'INACTIVE',
    ad_content: { title: 'Gammel stilling', employer: { name: 'TESTSELSKAP ALPHA AS', orgnr: A } },
  },
};


// ---------------------------------------------------------------------------
// Company websites (fictitious) and a fake DNS
// ---------------------------------------------------------------------------
const PUBLIC_IP = '185.70.10.1';
const DNS: Record<string, string> = {
  'www.brreg.no': PUBLIC_IP,
  'alpha-test.no': PUBLIC_IP,
  'www.alpha-test.no': PUBLIC_IP,
  'testselskapbeta.no': PUBLIC_IP,
  'testselskap-beta.no': PUBLIC_IP,
  'gamma-group.no': PUBLIC_IP,
  'delta-test.no': PUBLIC_IP,
  'www.delta-test.no': PUBLIC_IP,
  'epsilon-test.no': '10.0.0.5',
  'www.epsilon-test.no': '10.0.0.5',
  'zeta-test.no': PUBLIC_IP,
  'www.zeta-test.no': PUBLIC_IP,
  'testselskapeta.no': PUBLIC_IP,
  'eta-mail.no': PUBLIC_IP,
  'iota-butikk.no': PUBLIC_IP,
  'www.eta-mail.no': PUBLIC_IP,
  'www.kappa-gruppen.no': PUBLIC_IP,
  'www.lambda-kjeden.no': PUBLIC_IP,
  'www.vvs-partner.no': PUBLIC_IP,
  'www.tau-gruppen.no': PUBLIC_IP,
  'alphatest.teamtailor.com': PUBLIC_IP,
  'www.omega-test.no': PUBLIC_IP,
  'www.butikkjeden.no': PUBLIC_IP,
  'www.sigmapersonal.no': PUBLIC_IP,
  'cdn.jobylon.com': PUBLIC_IP,
  'emp.jobylon.com': PUBLIC_IP,
  'www.idehuset.no': PUBLIC_IP,
  'www.xi-test.no': PUBLIC_IP,
};
(globalThis as any).__SIGNALPOST_DNS__ = async (host: string) => {
  if (noWeb || !DNS[host]) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return [DNS[host]];
};
const page = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="no"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
type Site = { robots?: string; pages: Record<string, string | { redirect: string } | { feed: string; type: string }> };
const WEB: Record<string, Site> = {
  'www.brreg.no': { robots: 'User-agent: *\nAllow: /\n', pages: {} },
  'www.alpha-test.no': {
    robots: 'User-agent: *\nDisallow: /admin\n',
    pages: {
      '/': page(
        'Testselskap Alpha &ndash; programvare',
        `<a href="/nyheter/vi-flytter">Vi flytter til nye lokaler</a>
         <nav><a href="/kontakt">Kontakt oss</a> <a href="/nyheter">Nyheter</a> <a href="/karriere">Karriere</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">Del</a></nav>
         <a href="https://www.facebook.com/alphatest">Følg Alpha Gruppen på Facebook</a>
         <p>Vi lager programvare for norske bedrifter.</p>
         <footer>Testselskap Alpha AS &middot; Org.nr 910&nbsp;000&nbsp;063 MVA &middot;
         <a href="mailto:salg@alpha-test.no">salg@alpha-test.no</a> <a href="mailto:post@alpha-test.no">post</a>
         <a href="tel:+4722334455">22 33 44 55</a> <a href="mailto:ola.nordmann@alpha-test.no">Ola Nordmann</a> <a href="tel:+4791234567">Ola: 912 34 567</a>
         <a href="https://www.facebook.com/testselskapalpha">Facebook</a>
         <a href="https://www.instagram.com/testselskap_alpha_as/">Instagram</a>
         <a href="https://www.facebook.com/alphagruppen">Alpha-gruppen</a>
         <a href="https://www.linkedin.com/company/testselskap-alpha-eiendom/">Alpha Eiendom</a>
         <a href="https://www.youtube.com/@flatsometheme">Tema: Flatsome</a>
         <a href="https://www.instagram.com/webbyraa/">Laget av Webbyr&aring;</a> <a href="mailto:hei@webbyraa.no">byr&aring;</a></footer>`,
        '<link rel="alternate" type="application/rss+xml" title="Testselskap Alpha &raquo; Kommentarer" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" title="Testselskap Alpha &raquo; Feed" href="https://www.alpha-test.no/feed/"><meta property="og:site_name" content="Alpha Test"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Testselskap Alpha AS","sameAs":["https://www.linkedin.com/company/alpha-test/"]}</script>'
      ),
      '/nyheter': page(
        'Nyheter – Testselskap Alpha',
        `<nav><a href="/nyheter">Nyheter</a> <a href="/">Hjem</a></nav>
         <article><h2><a href="/nyheter/ny-avtale-med-kommunen">Ny avtale med Bergen kommune</a></h2><time datetime="2026-09-15">15. september 2026</time></article>
         <article><a href="/nyheter/vi-flytter"><h3>Vi flytter til nye lokaler</h3></a><p>Publisert 3. mars 2025</p></article>
         <article><a href="/nyheter/gammel-sak">Gammel sak fra arkivet vårt</a><span>12.06.2023</span></article>
         <article><a href="/nyheter/nytt-kontor-i-tromso"><h3>Vi åpner kontor i Tromsø</h3></a><p>Publisert 05.09.2026 · Oppdatert 01.10.2026</p></article>
         <article><a href="/nyheter/endrede-apningstider"><h3>Endringer i åpningstidene</h3></a><p>Sist oppdatert: 12.10.2026</p></article>
         <article><a href="/nyheter/prisliste-2027"><h3>Ny prisliste for 2027 er klar</h3></a><time class="updated" datetime="2026-10-15">15.10.2026</time></article>
         <article class="card"><a href="/nyheter/ny-kontorstol-ergo"><h3>Ny kontorstol Ergo Pro</h3></a><time datetime="2026-09-01">1. september 2026</time><span class="price">2 499,-</span></article>
         <div class="grid">
           <div class="card"><a href="/nyheter/sommerfest"><h3>Sommerfest for alle ansatte</h3></a></div>
           <div class="card"><span class="date">10.08.2026</span><a href="/nyheter/ny-styreleder"><h3>Ny styreleder valgt</h3></a></div>
         </div>
         <div class="more"><a href="/nyheter/alle-saker">Se alle nyheter &rarr;</a> <time datetime="2026-10-01">1. oktober 2026</time></div>
         <div class="more"><a href="/nyheter/arkiv">Nyhetsarkiv</a> <span>Oppdatert 20.10.2026</span></div>
         <a href="/nyheter/produkter/kontorstoler">Se våre nye produkter</a> <span>02.10.2026</span>
         <a href="/nyheter?side=2">Neste</a>`,
        '<script type="application/ld+json">[{"@context":"https://schema.org","@type":"NewsArticle","headline":"Alpha lanserer ny plattform","datePublished":"2026-06-01T08:00:00+02:00","url":"https://www.alpha-test.no/nyheter/ny-plattform"},{"@context":"https://schema.org","@type":"Article","headline":"Nyheter","datePublished":"2026-01-01","url":"https://www.alpha-test.no/nyheter"},{"@context":"https://schema.org","@type":"BlogPosting","headline":"Oppdatert artikkel om sikkerhet","dateModified":"2026-10-10","url":"https://www.alpha-test.no/nyheter/sikkerhet"}]</script>'
      ),
      '/feed/': {
        type: 'application/rss+xml; charset=UTF-8',
        feed: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Testselskap Alpha</title><lastBuildDate>Thu, 22 Oct 2026 09:00:00 +0000</lastBuildDate>
          <item><title><![CDATA[Alpha åpner avdeling i Trondheim]]></title><link>https://www.alpha-test.no/2026/10/alpha-apner-trondheim/</link><pubDate>Wed, 14 Oct 2026 08:00:00 +0000</pubDate></item>
          <item><title>Ny avtale med Bergen kommune</title><link>https://www.alpha-test.no/nyheter/ny-avtale-med-kommunen</link><pubDate>Tue, 15 Sep 2026 08:00:00 +0000</pubDate></item>
          <item><title>Oppdatert prisliste for 2027</title><link>https://www.alpha-test.no/2026/10/prisliste/</link><atom:updated>2026-10-20T08:00:00Z</atom:updated></item>
          <item><title>Gjesteinnlegg hos en partner</title><link>https://partner.example.com/alpha-gjest</link><pubDate>Mon, 12 Oct 2026 08:00:00 +0000</pubDate></item>
          <item><title>Ny stol i nettbutikken</title><link>https://www.alpha-test.no/produkt/ny-stol/</link><pubDate>Mon, 12 Oct 2026 08:00:00 +0000</pubDate></item>
          <item><title>Julebord for alle ansatte i 2024</title><link>https://www.alpha-test.no/2024/12/julebord/</link><pubDate>Fri, 13 Dec 2024 08:00:00 +0000</pubDate></item>
        </channel></rss>`,
      },
      '/karriere/driftstekniker-2026': page('Driftstekniker – Testselskap Alpha', '<h1>Driftstekniker</h1><p>Vi søker en driftstekniker til vårt kontor i Oslo. Søknadsfrist 1. desember.</p>'),
      // A stale posting: the ad page now says there is nothing open.
      '/karriere/servicetekniker-2026': page('Servicetekniker – Testselskap Alpha', '<h1>Servicetekniker</h1><p>Vi har ingen ledige stillinger for øyeblikket.</p>'),
      // A stale posting whose ad now sends the reader back to the careers page.
      '/karriere/elektriker-2026': { redirect: 'https://www.alpha-test.no/karriere' },
      '/comments/feed/': { type: 'application/rss+xml', feed: '<rss><channel><item><title>Kommentar til: Ny avtale med Bergen kommune</title><link>https://www.alpha-test.no/nyheter/ny-avtale-med-kommunen#comment-1</link><pubDate>Wed, 21 Oct 2026 08:00:00 +0000</pubDate></item></channel></rss>' },
      '/karriere': page(
        'Karriere – Testselskap Alpha',
        `<h1>Jobb hos oss</h1>
         <ul><li><a href="https://alphatest.teamtailor.com/jobs/123456-backend-utvikler">Backend-utvikler</a></li>
         <li><a href="https://alphatest.teamtailor.com/jobs/223344-regnskapsforer">Regnskapsfører (Alpha Eiendom)</a></li>
         <li><a href="https://alphatest.teamtailor.com/jobs/345678-designer">Designer</a></li>
         <li><a href="https://alphatest.teamtailor.com/jobs/456789-selger">Selger</a></li>
         <li><a href="https://alphatest.teamtailor.com/jobs/567890-lagerarbeider">Lagerarbeider</a></li>
         <li><a href="https://www.finn.no/job/fulltime/search.html?orgId=12345">Se våre stillinger på FINN</a></li>
         <li><a href="https://arbeidsplassen.nav.no/stillinger?q=testselskap%20alpha">Ledige stillinger hos NAV</a></li>
         <li><a href="https://arbeidsplassen.nav.no/stillinger/stilling/11111111-1111-4111-8111-111111111111">Senior utvikler (NAV)</a></li>
         <li><a href="/karriere/sommerjobb-2027">Sommerjobb 2027</a></li>
         <li><a href="/karriere/vare-verdier">Våre verdier og kultur</a></li>
         <li><a href="/karriere/we-are-alpha">We are Alpha</a></li>
         <li><a href="/karriere/apen-soknad">Send en åpen søknad</a></li>
         <li><a href="https://alphatest.teamtailor.com/jobs/678901-kokk">Kokk</a></li></ul>
         <p>Finner du ingen ledige stillinger som passer deg? Send oss en åpen søknad.</p>
         <a href="/karriere">Karriere</a> <a href="https://alphatest.teamtailor.com/jobs">Se alle</a>`,
        '<script type="application/ld+json">[{"@context":"https://schema.org","@type":"JobPosting","title":"Prosjektleder","datePosted":"2026-10-01","validThrough":"2099-01-01","url":"https://alphatest.teamtailor.com/jobs/654321-prosjektleder","hiringOrganization":{"@type":"Organization","name":"Testselskap Alpha AS"}},{"@context":"https://schema.org","@type":"JobPosting","title":"Driftstekniker","datePosted":"2026-10-05","validThrough":"2099-01-01","url":"/karriere/driftstekniker-2026","hiringOrganization":{"@type":"Organization","name":"Alpha Test","identifier":"910 000 063"}},{"@context":"https://schema.org","@type":"JobPosting","title":"Konsernsjef","datePosted":"2026-10-02","validThrough":"2099-01-01","hiringOrganization":{"@type":"Organization","name":"Alpha Gruppen AS"}},{"@context":"https://schema.org","@type":"JobPosting","title":"Uten arbeidsgiver","datePosted":"2026-10-02","validThrough":"2099-01-01"},{"@context":"https://schema.org","@type":"JobPosting","title":"Lagermedarbeider","datePosted":"2026-10-02","validThrough":"2099-01-01","hiringOrganization":{"name":"Testselskap Alpha AS"}},{"@context":"https://schema.org","@type":"JobPosting","title":"Utgått stilling","datePosted":"2019-01-01","validThrough":"2020-01-01"},{"@context":"https://schema.org","@type":"JobPosting","title":"Servicetekniker","datePosted":"2026-09-01","validThrough":"2099-01-01","url":"/karriere/servicetekniker-2026","hiringOrganization":{"name":"Testselskap Alpha AS"}},{"@context":"https://schema.org","@type":"JobPosting","title":"Elektriker","datePosted":"2026-09-01","validThrough":"2099-01-01","url":"/karriere/elektriker-2026","hiringOrganization":{"name":"Testselskap Alpha AS"}}]</script>'
      ),
    },
  },
  'alpha-test.no': { pages: { '/': { redirect: 'https://www.alpha-test.no/' } } },
  // (Alpha's single ad pages on its own site are added below.)
  'testselskapbeta.no': {
    pages: { '/': page('Testselskap Beta Utleie', '<p>Utleie av lokaler.</p><footer>Org.nr: 910 000 756</footer>') },
  },
  'testselskap-beta.no': {
    pages: {
      '/': page('Testselskap Beta AS | Bergen', '<p>Vi leier ut næringslokaler i Bergen sentrum. Ta kontakt for visning.</p><footer>Prøvevegen 2, 5003 Bergen</footer>', '<link rel="alternate" type="application/atom+xml" href="/atom.xml">'),
      '/atom.xml': {
        type: 'application/atom+xml',
        feed: `<feed xmlns="http://www.w3.org/2005/Atom"><title>Testselskap Beta</title><updated>2026-10-20T10:00:00Z</updated>
          <entry><title>Nye kontorlokaler ledige i sentrum</title><link rel="alternate" href="https://testselskap-beta.no/nytt/nye-lokaler"/><published>2026-08-01T10:00:00Z</published><updated>2026-10-01T10:00:00Z</updated></entry>
          <entry><title>Endret visningstid i oktober</title><link href="https://testselskap-beta.no/nytt/visning"/><updated>2026-10-10T10:00:00Z</updated></entry>
        </feed>`,
      },
    },
  },
  'gamma-group.no': {
    pages: {
      '/': page(
        'Gamma Group',
        '<p>Selskaper i gruppen:</p><ul><li>Testselskap Gamma AS, org.nr 910 000 802</li><li>Gamma Eiendom AS, org.nr 910 000 853</li><li>Gamma Drift AS, org.nr 910 000 861</li></ul>'
      ),
    },
  },
  'www.delta-test.no': { pages: { '/': page('delta-test.no', '<h1>Dette domenet er til salgs</h1><p>Kontakt megler.</p>') } },
  'epsilon-test.no': { pages: { '/': page('Testselskap Epsilon AS', '<footer>Org.nr 910 000 829</footer>') } },
  'www.zeta-test.no': {
    robots: 'User-agent: *\nDisallow: /\n',
    pages: { '/': page('Testselskap Zeta AS', '<footer>Org.nr 910 000 837 <a href="https://facebook.com/testselskapzeta">fb</a></footer>') },
  },
  'testselskapeta.no': { pages: { '/': page('Testselskap Eta', '<p>Velkommen til Testselskap Eta. Vi tilbyr gode tjenester til våre kunder over hele landet.</p>') } },
  'iota-butikk.no': {
    pages: {
      '/': page('Iota Butikk – alt til hjemmet', '<nav><a href="/nyheter">Nyheter</a></nav><p>Nettbutikk for kjøkken og interiør.</p><footer>Copyright &copy; 2026 Iota Handel og Service AS &ndash; alle rettigheter reservert</footer>'),
      '/nyheter': page(
        'Nyheter – Iota Butikk',
        `<ul><li><a href="/nyheter/kaffekopp-blaa"><h3>Kaffekopp blå</h3></a><span>Lagt ut 02.10.2026</span><span>149,-</span><button>Legg i handlekurv</button></li>
         <li><a href="/nyheter/skjaerebrett-eik"><h3>Skjærebrett i eik</h3></a><span>Lagt ut 28.09.2026</span><span>kr 399,00</span><button>Legg i handlekurv</button></li>
         <li><a href="/nyheter/brodkurv"><h3>Brødkurv i rotting</h3></a><span>Lagt ut 20.09.2026</span><span>249,-</span><button>Legg i handlekurv</button></li></ul>`
      ),
    },
  },
};
Object.assign(WEB, {
  'www.kappa-gruppen.no': {
    pages: {
      '/': page(
        'Kappa Gruppen – bygg og anlegg',
        `<nav><a href="/nyheter">Nyheter</a> <a href="/karriere">Karriere</a></nav>
         <p>Kappa Gruppen består av Kappa Bygg AS, Kappa Elektro AS og Kappa Eiendom AS.</p>
         <footer>&copy; Kappa Gruppen AS <a href="https://www.facebook.com/kappagruppen">Facebook</a> <a href="https://www.linkedin.com/company/kappa-bygg">LinkedIn</a></footer>`
      ),
      '/nyheter': page('Nyheter', '<article><a href="/nyheter/kappa-kjoper-selskap"><h3>Kappa Gruppen kjøper nytt selskap</h3></a><time datetime="2026-09-01">1. september 2026</time></article>'),
      '/karriere': page('Karriere', '<a href="https://kappa.teamtailor.com/jobs/777777-anleggsleder">Anleggsleder</a>'),
    },
  },
  'www.lambda-kjeden.no': {
    pages: {
      '/': page(
        'Lambda – din lokale butikk',
        `<nav><a href="/nyheter">Nyheter</a></nav><p>Finn din nærmeste Lambda-butikk.</p>
         <footer>Lambda Kjeden AS &middot; Org.nr 910 000 934 <a href="https://www.facebook.com/lambdamajorstuen">Facebook</a></footer>`
      ),
    },
  },
  'www.vvs-partner.no': {
    pages: {
      '/': page('VVS Partner – rørlegger i Oslo', '<p>Din rørlegger i Oslo og omegn. Ring oss for et uforpliktende tilbud.</p><footer><a href="https://www.facebook.com/sigmaror">Facebook</a></footer>'),
    },
  },
  'www.tau-gruppen.no': {
    pages: {
      '/selskaper/tau-bygg': page(
        'Tau Bygg – Tau Gruppen',
        `<nav><a href="/nyheter">Nyheter</a> <a href="/karriere">Karriere</a> <a href="/kontakt">Kontakt</a></nav>
         <h1>Tau Bygg</h1><p>Tau Bygg AS bygger boliger på Østlandet. Org.nr 910 000 950.</p>
         <p><a href="mailto:post@tau-gruppen.no">post@tau-gruppen.no</a> <a href="https://www.facebook.com/taubygg">Tau Bygg på Facebook</a></p>
         <footer>Tau Gruppen AS &middot; Org.nr 910 000 969 <a href="https://www.facebook.com/taugruppen">Tau Gruppen</a></footer>`
      ),
      '/nyheter': page('Nyheter', '<article><a href="/nyheter/tau-gruppen-vokser"><h3>Tau Gruppen vokser videre</h3></a><time datetime="2026-09-10">10. september 2026</time></article>'),
      '/karriere': page('Karriere', '<script type="application/ld+json">{"@type":"JobPosting","title":"Prosjektleder","datePosted":"2026-10-01","validThrough":"2099-01-01","hiringOrganization":{"name":"Tau Gruppen AS"}}</script>'),
    },
  },
  'www.sigmapersonal.no': {
    pages: {
      '/jobb-hos-oss': page('Jobb hos oss – Sigma Personal', '<h1>Jobb hos oss</h1><p>Vi søker nå flere medarbeidere. <a href="https://emp.jobylon.com/companies/4242-sigma-personal/">Se våre stillingsannonser her</a>.</p>'),
      '/': page(
        'Bemanning & Rekruttering | Sigma Personal | Telemark & Agder',
        `<p>Vi leverer bemanning og rekruttering til bedrifter i Telemark og Agder. Ta kontakt med oss for en uforpliktende prat om hvordan vi kan hjelpe din bedrift med riktig kompetanse, raskt og trygt.</p>
         <nav><a href="/jobb-hos-oss">Jobb hos oss</a></nav>
         <section><h2>Siste nytt</h2>
           <article><a href="/aktuelt/nytt-kontor-i-arendal"><h3>Nytt kontor i Arendal</h3></a><p>Publisert 12.09.2026</p></article>
           <article><a href="/aktuelt/sommerjobber-2026"><h3>Sommerjobber for studenter</h3></a></article>
           <article><a href="/tjenester/bemanning"><h3>Bemanning for industrien</h3></a><p>12.09.2026</p></article>
           <article><a href="/2026/03/27/paskeferie-2026/"><h3>Påskeferie 2026 for kontoret</h3></a><p>06.04.2026</p></article>
         </section>`
      ),
    },
  },
  // Hand check (homely.no): the careers page links only to the company's Jobylon list, which a
  // script fills in. The list's embed script names the single ads.
  'cdn.jobylon.com': {
    pages: {
      '/jobs/companies/4242/embed/v1/': {
        type: 'application/javascript; charset=utf-8',
        feed: String.raw`(function(){var html = '<ul class=\"jobylon-job-list\"><li><a href=\"https:\/\/emp.jobylon.com\/jobs\/50001-sigma-personal-rekrutteringskonsulent\/\">Rekrutteringskonsulent<\/a><\/li><li><a href=\"https:\/\/emp.jobylon.com\/jobs\/50002-kunde-as-sveiser\/\">Sveiser<\/a><\/li><li><a href=\"https:\/\/emp.jobylon.com\/jobs\/50003-sigma-personal-selger\/\">Selger<\/a><\/li><li><a href=\"https:\/\/emp.jobylon.com\/jobs\/50004-sigma-personal-lagermedarbeider\/\">Lagermedarbeider<\/a><\/li><\/ul>';})();`,
      },
    },
  },
  'emp.jobylon.com': {
    pages: {
      '/companies/4242-sigma-personal/': page('Sigma Personal | Jobylon', '<h1>Available jobs</h1><div id="jobylon-jobs-widget"></div><script src="https://cdn.jobylon.com/jobs/companies/4242/embed/v1/?target=jobylon-jobs-widget"></script>'),
      '/jobs/50001-sigma-personal-rekrutteringskonsulent/': page(
        'Rekrutteringskonsulent - Sigma Personal Telemark | Jobylon',
        '<h1>Rekrutteringskonsulent</h1><p>Bli med i teamet vårt i Skien.</p>',
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Rekrutteringskonsulent","datePosted":"2026-10-20","validThrough":"2099-01-01","hiringOrganization":{"@type":"Organization","name":"Sigma Personal Telemark AS"}}</script>'
      ),
      // An "apply as soon as possible" ad posted long ago, with no closing date, that the live
      // list still carries (QA run, homely.no): an opening.
      '/jobs/50003-sigma-personal-selger/': page(
        'Selger - Sigma Personal Telemark | Jobylon',
        '<h1>Selger</h1><p>Søknadsfrist: Snarest</p><a href="#apply">Søk her</a>',
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Selger","datePosted":"2024-02-28","hiringOrganization":{"@type":"Organization","name":"Sigma Personal Telemark AS"}}</script>'
      ),
      // Still on the list, but the ad page says it is closed: not an opening.
      '/jobs/50004-sigma-personal-lagermedarbeider/': page(
        'Lagermedarbeider - Sigma Personal Telemark | Jobylon',
        '<h1>Lagermedarbeider</h1><p>Stillingen er ikke lenger ledig.</p>',
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Lagermedarbeider","datePosted":"2025-01-10","hiringOrganization":{"@type":"Organization","name":"Sigma Personal Telemark AS"}}</script>'
      ),
      // A client's job listed by the agency: not this company's own opening.
      '/jobs/50002-kunde-as-sveiser/': page(
        'Sveiser - Kunde AS | Jobylon',
        '<h1>Sveiser</h1>',
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Sveiser","datePosted":"2026-10-20","validThrough":"2099-01-01","hiringOrganization":{"@type":"Organization","name":"Kunde AS"}}</script>'
      ),
    },
  },
  // A WordPress site that does not declare its feed: read at the standard address.
  'www.idehuset.no': {
    pages: {
      '/': page('Idehuset - Home', '<p>Velkommen.</p>'),
      '/feed/': {
        type: 'application/rss+xml; charset=UTF-8',
        feed: '<rss><channel><title>Idehuset</title><item><title>Ny utstilling i Skien</title><link>https://www.idehuset.no/2026/09/ny-utstilling/</link><pubDate>Thu, 03 Sep 2026 08:00:00 +0000</pubDate></item><item><title>Hei, verden!</title><link>https://www.idehuset.no/2026/08/hei-verden/</link><pubDate>Mon, 10 Aug 2026 08:00:00 +0000</pubDate></item></channel></rss>',
      },
    },
  },
  'www.xi-test.no': {
    pages: {
      '/': { redirect: 'https://www.xi-test.no/no/forside/velkommen' },
      '/no/forside/velkommen': page('Velkommen', '<nav><a href="/no/ledige-stillinger">Ledige stillinger</a></nav><footer>Testselskap Xi AS &middot; Org.nr 910 001 019 <a href="mailto:post@xi-test.no">post@xi-test.no</a></footer>'),
      // "No open positions", while the page data still describes an old posting (and its page still answers).
      '/no/ledige-stillinger': page(
        'Ledige stillinger – Testselskap Xi',
        '<h1>Ledige stillinger</h1><p>Vi har dessverre ingen ledige stillinger akkurat nå. Følg oss gjerne for nye muligheter.</p>',
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Kokk","datePosted":"2026-09-01","validThrough":"2099-01-01","url":"/no/ledige-stillinger/kokk","hiringOrganization":{"name":"Testselskap Xi AS"}}</script>'
      ),
      '/no/ledige-stillinger/kokk': page('Kokk – Testselskap Xi', '<h1>Kokk</h1><p>Vi søker kokk.</p>'),
    },
  },
  'alphatest.teamtailor.com': {
    robots: 'User-agent: *\nAllow: /\n',
    pages: {
      '/jobs/123456-backend-utvikler': page(
        'Backend-utvikler – Testselskap Alpha',
        '<h1>Backend-utvikler</h1>',
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Backend-utvikler","datePosted":"2026-10-03","validThrough":"2099-01-01","hiringOrganization":{"@type":"Organization","name":"Testselskap Alpha AS"}}</script>'
      ),
      '/jobs/654321-prosjektleder': page(
        'Prosjektleder – Testselskap Alpha',
        '<h1>Prosjektleder</h1><p>Bli med på laget.</p>',
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Prosjektleder","datePosted":"2026-10-01","validThrough":"2099-01-01","hiringOrganization":{"@type":"Organization","name":"Testselskap Alpha AS"}}</script>'
      ),
      '/jobs/678901-kokk': { redirect: 'https://alphatest.teamtailor.com/jobs' },
      '/jobs': page('Ledige stillinger – Testselskap Alpha | Teamtailor', '<h1>Ledige stillinger</h1><a href="/jobs/123456-backend-utvikler">Backend-utvikler</a>'),
      '/jobs/345678-designer': page('Designer - Testselskap Alpha | Teamtailor', '<h1>Designer</h1><p>Vi søker en designer.</p>'),
      '/jobs/456789-selger': page('Selger - Alpha Eiendom | Teamtailor', '<h1>Selger</h1>'),
      '/jobs/567890-lagerarbeider': page('Lagerarbeider - Testselskap Alpha | Teamtailor', '<h1>Lagerarbeider</h1><p>Stillingen er ikke lenger aktiv.</p>'),
      '/jobs/223344-regnskapsforer': page(
        'Regnskapsfører – Alpha Eiendom',
        '<h1>Regnskapsfører</h1>',
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Regnskapsfører","datePosted":"2026-10-03","validThrough":"2099-01-01","hiringOrganization":{"@type":"Organization","name":"Alpha Eiendom AS"}}</script>'
      ),
    },
  },
} as Record<string, Site>);
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
function webResponse(url: URL): Response {
  const host = url.hostname;
  if (siteDown && host.endsWith('alpha-test.no')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  // Live run on 1,000 companies: a job list that answered on the first run times out on the re-run.
  if (jobListDown && host === 'cdn.jobylon.com') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  // Live run on 1,000 companies: a site that answered yesterday refuses connections today.
  if (siteGone && (host.endsWith('testselskap-beta.no') || host === 'www.idehuset.no')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  // A mail-only domain: it resolves, but no web server answers.
  if (host.endsWith('eta-mail.no')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  // Bot protection: every request is refused, robots.txt included.
  if (host === 'www.omega-test.no' || host === 'www.butikkjeden.no') return new Response('<h1>Access denied</h1>', { status: 403, headers: { 'content-type': 'text/html' } });
  const site = WEB[host];
  if (!site) throw new TypeError('fetch failed');
  if (url.pathname === '/robots.txt') return site.robots ? new Response(site.robots, { status: 200, headers: { 'content-type': 'text/plain' } }) : new Response('not found', { status: 404 });
  const p = site.pages[url.pathname];
  if (!p) return new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } });
  if (typeof p !== 'string' && 'feed' in p) return new Response(p.feed, { status: 200, headers: { 'content-type': p.type } });
  if (typeof p !== 'string') return new Response(null, { status: 301, headers: { location: p.redirect } });
  return html(p);
}

globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const p = url.pathname;
  if (url.hostname !== 'data.brreg.no' && url.hostname !== 'pam-stilling-feed.nav.no') return webResponse(url);
  if (url.hostname === 'pam-stilling-feed.nav.no') {
    if (navDown) return json(503, { error: 'unavailable' });
    if (p === '/api/publicToken') return new Response('Current public token for Nav Job Vacancy Feed: eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.c2lnbmF0dXJl', { status: 200 });
    const auth = init?.headers?.Authorization || '';
    if (!auth.startsWith('Bearer eyJ')) return json(401, { error: 'unauthorized' });
    if (feedPages[p]) return json(200, feedPages[p]);
    const m = p.match(/^\/api\/v1\/feedentry\/(.+)$/);
    if (m && adDetails[m[1]]) return json(200, adDetails[m[1]]);
    return json(404, {});
  }
  const org = p.match(/(\d{9})/)?.[1] || url.searchParams.get('overordnetEnhet') || url.searchParams.get('organisasjonsnummer') || '';
  if (p.startsWith('/enhetsregisteret/api/oppdateringer/enheter')) {
    if (org === C) return json(503, { error: 'Service Unavailable' });
    return json(200, updates[org] ?? { page: { size: 100, totalElements: 0, totalPages: 0, number: 0 } });
  }
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
