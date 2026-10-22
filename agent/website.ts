// Finds a company's official website and proves it belongs to the exact legal entity.
//
// Candidates (in order): the website registered in Enhetsregisteret, the domain of the
// registered email address, and a few domains spelled from the legal name. A candidate is
// only a guess; it is published only after the fetched site proves the identity:
//   1. the site shows the company's organisation number (and no other organisation number,
//      unless the homepage also carries the full legal name), or
//   2. the homepage names the company (all distinctive legal-name tokens in its title, site
//      name or structured data) and, for name-spelled domains, the site also shows the
//      registered phone number or street address.
// Parked or for-sale pages, group sites listing several companies, and sites that show a
// different organisation number are never published as the company's website.
// From a verified site only: social profiles the site links to (identity-checked against the
// legal name or the site's own domain) and email/phone links on the site's own domain.

import { validateOrgnr } from './orgnr.ts';
import type { WebClient, WebPage } from './web.ts';
import type { SourceSnapshot } from './types.ts';

export type CandidateVia = 'enhetsregisteret' | 'registered_email_domain' | 'name_domain_check';

export interface SiteCandidate {
  url: string;
  host: string;
  domain: string;
  via: CandidateVia;
}

export interface CompanyIdentity {
  orgnr: string;
  legalName: string;
  formCode: string | null;
  website: string | null;
  email: string | null;
  phones: string[]; // registered phone/mobile, digits only (8-digit Norwegian form)
  streets: string[]; // registered street lines, lower-case
  postalCodes: string[];
}

export interface PageAnalysis {
  url: string;
  snapshot: SourceSnapshot;
  title: string;
  siteNames: string[];
  text: string;
  orgnrs: Map<string, string>; // valid organisation number -> a short text excerpt around it
  links: { url: string; text: string }[];
  mailto: string[];
  tel: string[];
  sameAs: string[];
  parked: boolean;
}

export interface SiteVerdict {
  candidate: SiteCandidate;
  status: 'exact' | 'ambiguous' | 'rejected' | 'parked' | 'no_site' | 'blocked' | 'error';
  reason: string;
  method?: 'organisation_number_on_site' | 'organisation_number_and_name_on_site' | 'legal_name_on_site' | 'legal_name_and_contact_details_on_site';
  confidence?: number;
  homeUrl?: string;
  proof?: { page: PageAnalysis; span: string };
  pages: PageAnalysis[];
  snapshots: SourceSnapshot[];
}

export interface SocialProfile {
  platform: 'linkedin' | 'facebook' | 'instagram' | 'x' | 'youtube' | 'tiktok';
  url: string;
}

// ---------------------------------------------------------------------------
// Names and domains
// ---------------------------------------------------------------------------
const LEGAL_FORM_TOKENS = new Set([
  'as', 'asa', 'ans', 'da', 'enk', 'sa', 'nuf', 'sti', 'sam', 'iks', 'ks', 'kf', 'fli', 'brl', 'esek', 'bbl', 'pre',
  'ba', 'orgl', 'stiftelsen', 'stiftelse', 'ltd', 'limited', 'ab', 'gmbh', 'inc',
]);
const FILLER_TOKENS = new Set(['og', 'and', 'the', 'i', 'of', 'for', 'avd', 'avdeling']);

export function translit(s: string): string {
  return s
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'o')
    .replace(/[åÅ]/g, 'a')
    .normalize('NFKD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase();
}

/** Distinctive tokens of a legal name: legal-form words and fillers removed. */
export function nameTokens(name: string): string[] {
  return (translit(name).match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !LEGAL_FORM_TOKENS.has(t) && !FILLER_TOKENS.has(t));
}

const TWO_LEVEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'com.br', 'co.jp', 'com.cn', 'priv.no', 'co.za']);
/** Registrable domain (eTLD+1, approximated). */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(last2) ? parts.slice(-3).join('.') : last2;
}

export const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.no', 'outlook.com', 'live.com', 'live.no', 'msn.com', 'yahoo.com',
  'yahoo.no', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'online.no', 'start.no', 'frisurf.no', 'broadpark.no',
  'getmail.no', 'c2i.net', 'lyse.net', 'altibox.no', 'bluezone.no', 'chello.no', 'tele2.no', 'telenor.no', 'proton.me',
  'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'hotmail.co.uk', 'sol.no', 'ebnett.no', 'combitel.no',
  'nettbox.no', 'tdcadsl.no', 'enivest.net', 'haugnett.no', 'tussa.com', 'tele.no', 'vikenfiber.no', 'kvinnherad.net',
]);

/** Domains spelled from the legal name, e.g. "SANDNES ELEKTRISKE AS" -> sandneselektriske.no, sandnes-elektriske.no. */
export function domainGuesses(name: string): string[] {
  const t = nameTokens(name);
  if (!t.length || t.length > 4) return [];
  const joined = t.join('');
  if (joined.length < 4 || joined.length > 40) return [];
  const out = [`${joined}.no`];
  if (t.length > 1) out.push(`${t.join('-')}.no`);
  if (t.length <= 2 && joined.length >= 5) out.push(`${joined}.com`);
  return out;
}

export function normalizeWebsite(raw: string): string | null {
  const v = String(raw || '').trim();
  if (!v || /\s/.test(v)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!u.hostname.includes('.')) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname || '/'}`;
  } catch {
    return null;
  }
}

const PLATFORM_HOSTS = /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|fb\.me|google\.com|sites\.google\.com|business\.site|wixsite\.com|weebly\.com|blogspot\.com|proff\.no|gulesider\.no|1881\.no|finn\.no)$/i;
export function isPlatformUrl(url: string): boolean {
  try {
    return PLATFORM_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function candidatesFor(id: CompanyIdentity, maxGuesses = 3): SiteCandidate[] {
  const out: SiteCandidate[] = [];
  const seen = new Set<string>();
  const push = (url: string | null, via: CandidateVia) => {
    if (!url) return;
    const host = new URL(url).hostname;
    const domain = registrableDomain(host);
    if (seen.has(domain)) return;
    seen.add(domain);
    out.push({ url, host, domain, via });
  };
  // A registered "website" that is a social profile is published as a profile, not crawled.
  const reg = id.website ? normalizeWebsite(id.website) : null;
  if (reg && !isPlatformUrl(reg)) push(reg, 'enhetsregisteret');
  const emailDomain = id.email?.split('@')[1]?.trim().toLowerCase().replace(/[>\s].*$/, '');
  if (emailDomain && emailDomain.includes('.') && !FREE_MAIL.has(emailDomain) && !FREE_MAIL.has(registrableDomain(emailDomain)))
    push(normalizeWebsite(registrableDomain(emailDomain)), 'registered_email_domain');
  if (!id.website) for (const d of domainGuesses(id.legalName).slice(0, maxGuesses)) push(`https://${d}/`, 'name_domain_check');
  return out;
}

// ---------------------------------------------------------------------------
// HTML analysis (no DOM library: deterministic regex-level extraction)
// ---------------------------------------------------------------------------
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø',
  aelig: 'æ', AElig: 'Æ', eacute: 'é', Eacute: 'É', uuml: 'ü', ouml: 'ö', auml: 'ä', Ouml: 'Ö', Auml: 'Ä', Uuml: 'Ü',
  copy: '©', reg: '®', ndash: '–', mdash: '—', laquo: '«', raquo: '»', middot: '·', bull: '•', hellip: '…',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
};

const PARKED_MARKERS = [
  'domain is for sale', 'domain for sale', 'domenet er til salgs', 'dette domenet er til salgs', 'kjøp dette domenet',
  'this domain may be for sale', 'buy this domain', 'hugedomains', 'parked at', 'parkert hos', 'domain parking',
  'her flytter snart en ny gjest', 'nettstedet er under bygging', 'website coming soon', 'coming soon', 'kommer snart',
  'under construction', 'default web site page', 'welcome to nginx', 'it works!', 'apache2 ubuntu default page',
  'this site is hosted by one.com', 'future home of something quite cool',
];

const ORGNR_RE = /(?<!\d)(\d{3})[ .\u00a0\u202f]?(\d{3})[ .\u00a0\u202f]?(\d{3})(?!\d)/g;
// Words that present a number as an organisation number: "Org.nr", "Org. nr.", "orgnr", "Org.nummer",
// "Organisasjonsnummer", "Organization number", "Foretaksregisteret", "MVA", "VAT", "NO 923 609 016".
const ORGNR_CONTEXT =
  /(\borg\.?\s*-?\s*n(r|o|ummer)\b|\borgnr|\borganisasjons-?\s?(nr|nummer)|\borgani[sz]ation\s*(number|no\b|nr)|foretaksregisteret|\bmva\b|\bvat\b|\bno\s?\d{3}|business\s*reg)/i;

export function findOrgnrs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(ORGNR_RE)) {
    const n = m[1] + m[2] + m[3];
    if (out.has(n) || !validateOrgnr(n).valid) continue;
    // Only numbers presented as organisation numbers count (org.nr, organisasjonsnummer, foretaksregisteret, MVA, VAT).
    const at = m.index ?? 0;
    const around = text.slice(Math.max(0, at - 60), at + m[0].length + 25);
    if (!ORGNR_CONTEXT.test(around)) continue;
    // Excerpt trimmed to whole words, kept as evidence of where the number appears.
    out.set(n, around.replace(/\s+/g, ' ').replace(/^\S*\s/, '').replace(/\s\S*$/, '').trim() || m[0]);
  }
  return out;
}

function jsonLdNodes(html: string): any[] {
  const nodes: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1].trim());
      const walk = (x: any) => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') {
          nodes.push(x);
          for (const k of Object.keys(x)) if (k === '@graph' || typeof x[k] === 'object') walk(x[k]);
        }
      };
      walk(v);
    } catch {
      /* invalid JSON-LD is ignored */
    }
  }
  return nodes;
}

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|Store|Restaurant|ProfessionalService|HomeAndConstructionBusiness|AutomotiveBusiness|LegalService|AccountingService|MedicalBusiness|FinancialService|RealEstateAgent|TravelAgency|NGO|EducationalOrganization|.*Business)$/;

export function analyzePage(page: WebPage): PageAnalysis {
  const html = page.html;
  const base = page.url;
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const siteNames: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = (attr(m[0], 'property') || attr(m[0], 'name') || '').toLowerCase();
    const content = attr(m[0], 'content');
    if (content && ['og:site_name', 'application-name', 'og:title'].includes(prop)) siteNames.push(content.trim());
  }
  const ld = jsonLdNodes(html);
  const sameAs: string[] = [];
  const ldText: string[] = [];
  for (const n of ld) {
    const types = ([] as string[]).concat(n['@type'] || []);
    if (!types.some((t) => ORG_TYPES.test(String(t)))) continue;
    for (const k of ['name', 'legalName', 'alternateName']) if (typeof n[k] === 'string') siteNames.push(n[k]);
    for (const s of ([] as unknown[]).concat(n.sameAs || [])) if (typeof s === 'string') sameAs.push(s);
    for (const k of ['vatID', 'taxID', 'identifier', 'leiCode', 'duns', 'telephone', 'email']) {
      const v = n[k];
      if (typeof v === 'string' || typeof v === 'number') ldText.push(`${k === 'vatID' || k === 'taxID' || k === 'identifier' ? 'Org.nr ' : ''}${v}`);
      else if (v && typeof v === 'object' && typeof v.value === 'string') ldText.push(`Org.nr ${v.value}`);
    }
  }
  const links: { url: string; text: string }[] = [];
  const mailto: string[] = [];
  const tel: string[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${m[1]}>`, 'href');
    if (!href) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/^mailto:/i.test(href)) mailto.push(decodeURIComponent(href.slice(7).split('?')[0]).trim().toLowerCase());
    else if (/^tel:/i.test(href)) tel.push(href.slice(4));
    else {
      try {
        links.push({ url: new URL(href, base).href, text });
      } catch {
        /* ignore */
      }
    }
  }
  for (const m of html.matchAll(/<(?:iframe|div|span|a)\b[^>]*(?:data-href|src)\s*=\s*["']([^"']*(?:facebook|linkedin|instagram|youtube|tiktok|twitter|x)\.com[^"']*)["']/gi)) {
    try {
      links.push({ url: new URL(decodeEntities(m[1]), base).href, text: '' });
    } catch {
      /* ignore */
    }
  }
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' \n ')
    .replace(/<\/(p|div|li|h\d|tr|td|footer|section|address)>/gi, ' \n ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const orgnrs = findOrgnrs(`${text}\n${ldText.join('\n')}`);
  const lower = `${title} ${text.slice(0, 3000)}`.toLowerCase();
  const parked = PARKED_MARKERS.some((p) => lower.includes(p)) && text.length < 4000;
  return { url: page.url, snapshot: page.snapshot, title, siteNames, text, orgnrs, links, mailto, tel, sameAs, parked };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
const PRIORITY = [
  /kontakt/i,
  /contact/i,
  /om-?oss|om oss/i,
  /about/i,
  /betingelser|kj[oø]psvilk[aå]r|salgsvilk[aå]r|vilk[aå]r|terms|impressum/i,
  /firma|selskap|company/i,
  /personvern|privacy/i,
];

function priorityLinks(a: PageAnalysis, domain: string, limit: number): string[] {
  const scored = new Map<string, number>();
  for (const l of a.links) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || registrableDomain(u.hostname) !== domain) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
    const hay = `${u.pathname} ${l.text}`;
    const rank = PRIORITY.findIndex((r) => r.test(hay));
    if (rank < 0) continue;
    const clean = `${u.origin}${u.pathname}`;
    if (clean.replace(/\/$/, '') === a.url.replace(/[?#].*$/, '').replace(/\/$/, '')) continue;
    scored.set(clean, Math.min(rank, scored.get(clean) ?? 99));
  }
  return [...scored.entries()].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).slice(0, limit).map(([u]) => u);
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Errors worth reporting as "could not check" (may work next time); others mean there is no site. */
export function isTransient(error: string): boolean {
  return /timeout|http_5\d\d|ECONNRESET|EPIPE|EAI_AGAIN|dns_error|site_unreachable|UND_ERR_SOCKET|web_request_budget_exhausted/i.test(error);
}
export function phoneDigits(s: string): string {
  const d = digits(s);
  if (d.length === 10 && d.startsWith('47')) return d.slice(2);
  if (d.length === 12 && d.startsWith('0047')) return d.slice(4);
  return d;
}

function nameOnHomepage(home: PageAnalysis, host: string, tokens: string[]): string | null {
  if (!tokens.length) return null;
  const parts = [home.title, ...home.siteNames, host.replace(/^www\./, '')];
  for (const p of parts) {
    const t = new Set(translit(p).match(/[a-z0-9]+/g) || []);
    const compact = translit(p).replace(/[^a-z0-9]/g, '');
    if (tokens.every((x) => t.has(x)) || (tokens.length > 1 && compact.includes(tokens.join('')))) return p;
  }
  return null;
}

/** The full legal name, legal form included (e.g. "Ballong & Partygrossisten AS"), in a page's text. */
function legalNameInText(pages: PageAnalysis[], legalName: string): { page: PageAnalysis; text: string } | null {
  const norm = (x: string) => ` ${translit(x).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const name = norm(legalName);
  if (name.trim().length < 6 || name.trim().split(' ').length < 2) return null;
  for (const p of pages) if (norm(`${p.title} ${p.text}`).includes(name)) return { page: p, text: legalName };
  return null;
}

function contactMatch(pages: PageAnalysis[], id: CompanyIdentity): { what: string; page: PageAnalysis } | null {
  for (const p of pages) {
    const pd = digits(p.text);
    for (const ph of id.phones) if (ph.length === 8 && pd.includes(ph)) return { what: `registered phone ${ph}`, page: p };
    const pt = translit(p.text);
    for (const street of id.streets) {
      const st = translit(street).replace(/\s+/g, ' ').trim();
      if (st.length >= 6 && pt.includes(st) && id.postalCodes.some((pc) => p.text.includes(pc))) return { what: `registered address ${street}`, page: p };
    }
  }
  return null;
}

export async function verifyCandidate(
  web: WebClient,
  cand: SiteCandidate,
  id: CompanyIdentity,
  snapPrefix: string,
  signal?: AbortSignal
): Promise<SiteVerdict> {
  const snapshots: SourceSnapshot[] = [];
  const v = (status: SiteVerdict['status'], reason: string, extra: Partial<SiteVerdict> = {}): SiteVerdict => ({
    candidate: cand,
    status,
    reason,
    pages: [],
    snapshots,
    ...extra,
  });
  // Homepage: https, then the www host, then plain http (small sites without a certificate).
  const attempts = [cand.url];
  if (!cand.host.startsWith('www.')) attempts.push(cand.url.replace('://', '://www.'));
  attempts.push(cand.url.replace(/^https:/, 'http:'));
  let home: Awaited<ReturnType<WebClient['getPage']>> | null = null;
  let transient = false;
  let lastFail: Awaited<ReturnType<WebClient['getPage']>> | null = null;
  for (const [i, u] of attempts.entries()) {
    if (signal?.aborted) break;
    const r = await web.getPage(u, `${snapPrefix}:${cand.domain}:home${i ? `-${i}` : ''}`, signal);
    if (r.outcome === 'ok') {
      home = r;
      break;
    }
    lastFail = r;
    if (r.outcome === 'blocked') {
      snapshots.push(r.snapshot);
      return v('blocked', r.error);
    }
    if (r.outcome === 'not_found' || r.outcome === 'not_html') break; // a server answered: there is no homepage to read
    if (r.outcome === 'error' && isTransient(r.error)) transient = true;
  }
  if (!home || home.outcome !== 'ok') {
    if (lastFail) snapshots.push(lastFail.snapshot);
    // Guessed domains are speculative: anything but a readable homepage simply means "no site".
    if (transient && cand.via !== 'name_domain_check') return v('error', lastFail && 'error' in lastFail ? lastFail.error : 'site_unreachable');
    return v('no_site', lastFail && 'error' in lastFail ? lastFail.error : 'no_homepage');
  }
  snapshots.push(home.page.snapshot);
  const homeA = analyzePage(home.page);
  const finalHost = new URL(home.page.url).hostname.toLowerCase();
  const finalDomain = registrableDomain(finalHost);
  const homeUrl = `${new URL(home.page.url).protocol}//${finalHost}/`;
  // A placeholder page is not a company website, unless it shows this company's number.
  if (homeA.parked && !homeA.orgnrs.has(id.orgnr)) return v('parked', 'parked_or_placeholder_page', { pages: [homeA], homeUrl });

  const pages = [homeA];
  if (!homeA.orgnrs.has(id.orgnr)) {
    for (const link of priorityLinks(homeA, finalDomain, 3)) {
      if (signal?.aborted) break;
      const r = await web.getPage(link, `${snapPrefix}:${finalDomain}:${new URL(link).pathname}`, signal);
      snapshots.push(r.outcome === 'ok' ? r.page.snapshot : r.snapshot);
      if (r.outcome === 'ok') {
        const a = analyzePage(r.page);
        pages.push(a);
        if (a.orgnrs.has(id.orgnr)) break;
      }
    }
  }

  const tokens = nameTokens(id.legalName);
  const withOurs = pages.find((p) => p.orgnrs.has(id.orgnr));
  const others = new Set<string>();
  for (const p of pages) for (const n of p.orgnrs.keys()) if (n !== id.orgnr) others.add(n);
  // Homepage identity (title, site name, structured data, host) is required when the site lists
  // several organisation numbers; the legal name anywhere in the text is enough otherwise.
  const homeName = nameOnHomepage(homeA, finalHost, tokens);
  const inText = legalNameInText(pages, id.legalName);
  const nameHit = homeName || (inText ? `page text: ${inText.text}` : null);
  const base = { pages, homeUrl, candidate: { ...cand, host: finalHost, domain: finalDomain } };

  if (withOurs) {
    const span = withOurs.orgnrs.get(id.orgnr)!;
    if (others.size === 0)
      return v('exact', 'organisation_number_on_site', { ...base, method: 'organisation_number_on_site', confidence: 0.99, proof: { page: withOurs, span } });
    if (homeName)
      return v('exact', 'organisation_number_and_name_on_site', { ...base, method: 'organisation_number_and_name_on_site', confidence: 0.95, proof: { page: withOurs, span } });
    return v('ambiguous', 'site_shows_several_organisation_numbers', base);
  }
  if (others.size > 0) return v('rejected', 'site_shows_a_different_organisation_number', base);
  if (nameHit) {
    const substantive = homeA.text.length >= 200;
    if (cand.via !== 'name_domain_check' && (tokens.length >= 2 || substantive))
      return v('exact', 'legal_name_on_site', {
        ...base,
        method: 'legal_name_on_site',
        confidence: 0.9,
        proof: homeName ? { page: homeA, span: `homepage name: ${homeName}`.slice(0, 200) } : { page: inText!.page, span: `legal name on the page: ${inText!.text}`.slice(0, 200) },
      });
    const contact = contactMatch(pages, id);
    if (contact)
      return v('exact', 'legal_name_and_contact_details_on_site', {
        ...base,
        method: 'legal_name_and_contact_details_on_site',
        confidence: 0.9,
        proof: { page: contact.page, span: `${homeName ? `homepage name: ${homeName}` : `legal name on the page: ${inText?.text}`}; ${contact.what}`.slice(0, 200) },
      });
    return v('rejected', 'name_only_without_contact_match', base);
  }
  return v('rejected', 'no_identity_evidence_on_site', base);
}

// ---------------------------------------------------------------------------
// Company-owned profiles and contact links (only from a verified site)
// ---------------------------------------------------------------------------
const SOCIAL_HOSTS: [string, SocialProfile['platform']][] = [
  ['linkedin.com', 'linkedin'], ['facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['x.com', 'x'],
  ['twitter.com', 'x'], ['youtube.com', 'youtube'], ['tiktok.com', 'tiktok'],
];
const VENDOR_HANDLES = new Set(['wix', 'squarespace', 'wordpress', 'wordpressdotcom', 'shopify', 'godaddy', 'onecom', 'one.com', 'hostinger', 'webflow', 'mailchimp', 'facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'twitter', 'google', 'meta', 'domeneshop', 'proisp', 'cookiebot']);

export function normalizeSocial(raw: string): SocialProfile | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|no|nb-no|mobile)\./, '');
  const platform = SOCIAL_HOSTS.find(([d]) => host === d || host.endsWith(`.${d}`))?.[1];
  if (!platform) return null;
  if (platform === 'facebook' && u.pathname.startsWith('/plugins/')) {
    const inner = u.searchParams.get('href');
    return inner ? normalizeSocial(inner) : null;
  }
  const parts = u.pathname.split('/').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].toLowerCase();
  const rejectFirst: Record<string, string[]> = {
    facebook: ['sharer', 'sharer.php', 'share.php', 'share', 'dialog', 'policy.php', 'privacy', 'events', 'groups', 'plugins', 'profile.php', 'login', 'hashtag', 'watch', 'help', 'pages', 'tr'],
    instagram: ['p', 'reel', 'reels', 'stories', 'explore', 'accounts'],
    x: ['intent', 'share', 'home', 'search', 'i', 'hashtag'],
  };
  if (rejectFirst[platform]?.includes(first)) return null;
  let path: string[];
  if (platform === 'linkedin') {
    if (!['company', 'school', 'showcase'].includes(first) || parts.length < 2) return null;
    path = [first, parts[1]];
  } else if (platform === 'youtube') {
    if (parts[0].startsWith('@')) path = [parts[0]];
    else if (['channel', 'user', 'c'].includes(first) && parts[1]) path = [first, parts[1]];
    else return null;
  } else if (platform === 'tiktok') {
    if (!parts[0].startsWith('@')) return null;
    path = [parts[0]];
  } else {
    path = [parts[0]];
  }
  const handle = path[path.length - 1].replace(/^@/, '').toLowerCase();
  if (!handle || VENDOR_HANDLES.has(handle)) return null;
  const canonical = { linkedin: 'linkedin.com', facebook: 'facebook.com', instagram: 'instagram.com', x: 'x.com', youtube: 'youtube.com', tiktok: 'tiktok.com' }[platform];
  return { platform, url: `https://${canonical}/${path.join('/')}` };
}

/** The profile handle must name the company (legal-name tokens) or the verified site's brand (its domain label). */
export function socialMatchesIdentity(p: SocialProfile, tokens: string[], domain: string): boolean {
  const handle = translit(decodeURIComponent(new URL(p.url).pathname.split('/').filter(Boolean).pop() || '')).replace(/[^a-z0-9]/g, '');
  if (!handle) return false;
  const label = translit(domain.split('.')[0]).replace(/[^a-z0-9]/g, '');
  if (label.length >= 4 && handle.includes(label)) return true;
  const joined = tokens.join('');
  if (joined.length >= 4 && handle.includes(joined)) return true;
  const matched = tokens.filter((t) => t.length >= 3 && handle.includes(t));
  if (tokens.length === 1) return matched.length === 1 && tokens[0].length >= 4;
  return matched.length >= 2 && matched.length / tokens.length >= 0.75;
}

export function profilesFrom(verdict: SiteVerdict, tokens: string[]): { profile: SocialProfile; page: PageAnalysis; via: string }[] {
  const out = new Map<string, { profile: SocialProfile; page: PageAnalysis; via: string }>();
  const domain = verdict.candidate.domain;
  for (const page of verdict.pages) {
    const raw = [...page.links.map((l) => ({ u: l.url, via: 'link' })), ...page.sameAs.map((u) => ({ u, via: 'structured data sameAs' }))];
    for (const { u, via } of raw) {
      const p = normalizeSocial(u);
      if (!p || out.has(p.url) || !socialMatchesIdentity(p, tokens, domain)) continue;
      out.set(p.url, { profile: p, page, via });
    }
  }
  return [...out.values()].sort((a, b) => a.profile.url.localeCompare(b.profile.url)).slice(0, 8);
}

export function siteContacts(verdict: SiteVerdict): { emails: { value: string; page: PageAnalysis }[]; phones: { value: string; page: PageAnalysis }[] } {
  const emails = new Map<string, PageAnalysis>();
  const phones = new Map<string, PageAnalysis>();
  for (const page of verdict.pages) {
    for (const e of page.mailto) {
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) continue;
      if (registrableDomain(e.split('@')[1]) !== verdict.candidate.domain) continue;
      if (!emails.has(e)) emails.set(e, page);
    }
    for (const t of page.tel) {
      const d = phoneDigits(t);
      if (!/^[2-9]\d{7}$/.test(d)) continue; // Norwegian 8-digit numbers only
      if (!phones.has(d)) phones.set(d, page);
    }
  }
  return {
    emails: [...emails.entries()].slice(0, 3).map(([value, page]) => ({ value, page })),
    phones: [...phones.entries()].slice(0, 3).map(([value, page]) => ({ value, page })),
  };
}

// ---------------------------------------------------------------------------
// The whole website step for one company
// ---------------------------------------------------------------------------
export interface WebsiteOutcome {
  /** 'disabled' = the step did not run this time (switched off or public web unreachable). */
  state: 'verified' | 'none' | 'ambiguous' | 'blocked' | 'incomplete' | 'disabled';
  verdicts: SiteVerdict[];
  verified: SiteVerdict | null;
  registryVerdict: SiteVerdict | null;
  disabledReason?: string;
}

export async function findWebsite(web: WebClient | null | undefined, id: CompanyIdentity, budgetMs = 20_000): Promise<WebsiteOutcome> {
  if (!web || web.disabled) return { state: 'disabled', verdicts: [], verified: null, registryVerdict: null, disabledReason: web?.disabledReason || 'website_step_disabled' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  const verdicts: SiteVerdict[] = [];
  try {
    for (const cand of candidatesFor(id)) {
      if (ctrl.signal.aborted) {
        verdicts.push({ candidate: cand, status: 'error', reason: 'website_time_budget_reached', pages: [], snapshots: [] });
        break;
      }
      const verdict = await verifyCandidate(web, cand, id, `snap:${id.orgnr}:web`, ctrl.signal);
      verdicts.push(verdict);
      if (verdict.status === 'exact') break;
      if (web.disabled) break;
    }
  } finally {
    clearTimeout(timer);
  }
  const verified = verdicts.find((x) => x.status === 'exact') || null;
  const registryVerdict = verdicts.find((x) => x.candidate.via === 'enhetsregisteret') || null;
  let state: WebsiteOutcome['state'];
  if (verified) state = 'verified';
  else if (web.disabled && !verdicts.some((x) => x.status !== 'error')) state = 'disabled';
  else if (verdicts.some((x) => x.status === 'ambiguous')) state = 'ambiguous';
  else if (verdicts.some((x) => x.status === 'error')) state = 'incomplete';
  else if (verdicts.length && verdicts.every((x) => x.status === 'blocked')) state = 'blocked';
  else state = 'none';
  return { state, verdicts, verified, registryVerdict, ...(state === 'disabled' ? { disabledReason: web.disabledReason || 'public_web_unreachable' } : {}) };
}
