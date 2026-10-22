// Test-only: replaces global fetch with canned Brønnøysund-shaped responses so the
// runner can be tested offline. All companies here are fictitious test fixtures.
//   MOCK_MUTATE=1      → company A's CEO and revenue change (refresh test)
//   MOCK_FAIL_ROLES=1  → roles endpoint returns 503 (partial-failure test)
//   MOCK_HANG=<orgnr>  → that company's registry call never answers (deadline test)
//   MOCK_NAV_DOWN=1    → NAV job feed returns 503 (hiring source outage)
//   MOCK_AD_INACTIVE=1 → company A's job ad has gone inactive (refresh removal test)
//   MOCK_SITE_DOWN=1   → company A's website does not answer (no false removals test)
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

const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};
const mutate = env.MOCK_MUTATE === '1';
const failRoles = env.MOCK_FAIL_ROLES === '1';
const hang = env.MOCK_HANG;
const navDown = env.MOCK_NAV_DOWN === '1';
const adInactive = env.MOCK_AD_INACTIVE === '1';
const siteDown = env.MOCK_SITE_DOWN === '1';
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
      ],
    },
    page: { size: 100, totalElements: 3, totalPages: 1, number: 0 },
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
};
(globalThis as any).__SIGNALPOST_DNS__ = async (host: string) => {
  if (noWeb || !DNS[host]) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return [DNS[host]];
};
const page = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="no"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
type Site = { robots?: string; pages: Record<string, string | { redirect: string }> };
const WEB: Record<string, Site> = {
  'www.brreg.no': { robots: 'User-agent: *\nAllow: /\n', pages: {} },
  'www.alpha-test.no': {
    robots: 'User-agent: *\nDisallow: /admin\n',
    pages: {
      '/': page(
        'Testselskap Alpha &ndash; programvare',
        `<nav><a href="/kontakt">Kontakt oss</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">Del</a></nav>
         <p>Vi lager programvare for norske bedrifter.</p>
         <footer>Testselskap Alpha AS &middot; Org.nr 910&nbsp;000&nbsp;063 MVA &middot;
         <a href="mailto:salg@alpha-test.no">salg@alpha-test.no</a> <a href="mailto:post@alpha-test.no">post</a>
         <a href="tel:+4722334455">22 33 44 55</a>
         <a href="https://www.facebook.com/testselskapalpha">Facebook</a>
         <a href="https://www.instagram.com/webbyraa/">Laget av Webbyr&aring;</a> <a href="mailto:hei@webbyraa.no">byr&aring;</a></footer>`,
        '<meta property="og:site_name" content="Alpha Test"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Testselskap Alpha AS","sameAs":["https://www.linkedin.com/company/alpha-test/"]}</script>'
      ),
    },
  },
  'alpha-test.no': { pages: { '/': { redirect: 'https://www.alpha-test.no/' } } },
  'testselskapbeta.no': {
    pages: { '/': page('Testselskap Beta Utleie', '<p>Utleie av lokaler.</p><footer>Org.nr: 910 000 756</footer>') },
  },
  'testselskap-beta.no': {
    pages: {
      '/': page('Testselskap Beta AS | Bergen', '<p>Vi leier ut næringslokaler i Bergen sentrum. Ta kontakt for visning.</p><footer>Prøvevegen 2, 5003 Bergen</footer>'),
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
    pages: { '/': page('Iota Butikk – alt til hjemmet', '<p>Nettbutikk for kjøkken og interiør.</p><footer>Copyright &copy; 2026 Iota Handel og Service AS &ndash; alle rettigheter reservert</footer>') },
  },
};
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
function webResponse(url: URL): Response {
  const host = url.hostname;
  if (siteDown && host.endsWith('alpha-test.no')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  // A mail-only domain: it resolves, but no web server answers.
  if (host.endsWith('eta-mail.no')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const site = WEB[host];
  if (!site) throw new TypeError('fetch failed');
  if (url.pathname === '/robots.txt') return site.robots ? new Response(site.robots, { status: 200, headers: { 'content-type': 'text/plain' } }) : new Response('not found', { status: 404 });
  const p = site.pages[url.pathname];
  if (!p) return new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } });
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
