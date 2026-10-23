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
// Parked or for-sale pages, group sites listing several companies, brand or chain sites that
// do not name this company, and sites that show a different organisation number are never
// published as the company's website, even when the registry lists them.
// A registered address that is a page on a larger site (group.no/companies/this-one) is treated
// as that page only: the rest of the domain belongs to its owner.
// From a verified site only: social profiles whose handle names this company (footer links to
// the parent group, the web agency or the theme are left out), email/phone links on the site's
// own domain, dated posts from its news page, and single job ads whose hiring organisation is
// this company.

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
  /** The address is one page of a larger site (e.g. a group's page about this company). */
  scoped?: boolean;
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

/** Words that mark a parent group rather than the company itself. */
const GROUP_TOKENS = ['gruppen', 'gruppa', 'group', 'konsern', 'konsernet', 'holding', 'holdings'];
const groupWordIn = (s: string, tokens: string[]) => GROUP_TOKENS.some((g) => s.includes(g) && !tokens.some((t) => t.includes(g)));
/** Country words a company may add to its own name ("Certego Norge"). */
const NAME_AFFIXES = new Set(['norge', 'norway', 'no', 'nor']);

/** True when a name ("Brunvoll", "Testselskap Alpha AS") is this company's legal name, legal form aside. */
export function sameCompanyName(name: string, legalName: string): boolean {
  const a = nameTokens(name);
  const b = nameTokens(legalName);
  if (!a.length || !b.length) return false;
  if (b.every((t) => a.includes(t))) return a.every((t) => b.includes(t) || NAME_AFFIXES.has(t));
  return a.join('') === b.join('');
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
const DIRECTORY_HOSTS = /(^|\.)(proff\.no|gulesider\.no|1881\.no|finn\.no|purehelp\.no|google\.com|g\.page|maps\.app\.goo\.gl)$/i;
export function isPlatformUrl(url: string): boolean {
  try {
    return PLATFORM_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
/** A business directory or map listing: a page about the company, not its own website. */
export function isDirectoryUrl(url: string): boolean {
  try {
    return DIRECTORY_HOSTS.test(new URL(url).hostname) && !/^sites\.google\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * For a registered website that could not be read (robots.txt, outage, step not run): the domain
 * (or, on a hosting platform, the page name) carries a distinctive word of the legal name and no
 * group word. Brand, chain and group domains do not pass.
 */
export function registeredSitePlausible(url: string, legalName: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const tokens = nameTokens(legalName);
  const label = isPlatformUrl(url) ? `${u.hostname.split('.')[0]}${u.pathname}` : registrableDomain(u.hostname).split('.')[0];
  const hay = translit(label).replace(/[^a-z0-9]/g, '');
  if (!hay || groupWordIn(hay, tokens)) return false;
  const joined = tokens.join('');
  return (joined.length >= 4 && hay.includes(joined)) || tokens.some((t) => t.length >= 4 && hay.includes(t));
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

function priorityLinks(a: PageAnalysis, domain: string, limit: number, prefix = '/'): string[] {
  const scored = new Map<string, number>();
  for (const l of a.links) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || registrableDomain(u.hostname) !== domain) continue;
    if (!u.pathname.startsWith(prefix)) continue;
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
  // Each part of a title is read on its own: "Tau Bygg – Tau Gruppen" names Tau Bygg in its first
  // part and the parent group in its second.
  const parts = [...[home.title, ...home.siteNames].flatMap((x) => x.split(/\s+[-\u2013\u2014|:\u00b7\u2022]\s+|\s*\|\s*/)), host.replace(/^www\./, '')].filter(Boolean);
  for (const p of parts) {
    const t = new Set(translit(p).match(/[a-z0-9]+/g) || []);
    const compact = translit(p).replace(/[^a-z0-9]/g, '');
    // "Nordic Group" names the parent group, not "Nordic AS".
    if (groupWordIn(compact, tokens)) continue;
    if (tokens.every((x) => t.has(x)) || (tokens.length > 1 && compact.includes(tokens.join('')))) return p;
  }
  return null;
}

// Legal-entity names written on a page ("Kappa Bygg AS", "Gamma Eiendom AS").
const NO_LETTERS = '\\u00c6\\u00d8\\u00c5\\u00e6\\u00f8\\u00e5\\u00e9\\u00c9';
const FORM_WORD = `(?:AS|ASA|SA|ANS|DA|NUF|KS)(?![\\w${NO_LETTERS}])`;
const NAME_WORD = `(?!${FORM_WORD})[A-Z\\u00c6\\u00d8\\u00c5][\\w${NO_LETTERS}&.'\\u2019-]*`;
const SP = '[ \\t\\u00a0]+'; // names never run across lines or list items
const ENTITY_RE = new RegExp(`(${NAME_WORD}(?:${SP}(?:(?:og|i|and|of|for|av|&)${SP})?(?:${NAME_WORD}|\\d{1,5})){0,5})${SP}(AS|ASA|SA|ANS|DA|NUF|KS)(?![\\w${NO_LETTERS}])`, 'g');
const GROUP_PHRASES = /(selskap(er|ene) i (konsernet|gruppen)|v[aå]re selskaper|v[aå]re datterselskap|datterselskap|konsernet best[aå]r|en del av .{0,40}(gruppen|konsernet)|our companies|group companies|subsidiar(y|ies)|member companies|part of the .{0,40}group)/i;

/** Other legal entities named on the pages (the same entity written with a longer prefix counts once). */
export function otherEntities(pages: { title: string; text: string }[], legalName: string): string[] {
  const norm = (x: string) => translit(x).replace(/[^a-z0-9]+/g, ' ').trim();
  const ours = norm(legalName);
  const found = new Set<string>();
  for (const p of pages) {
    // Organisation numbers break a name run ("org.nr 910 000 802 Gamma Eiendom AS").
    const text = `${p.title}\n${p.text}`.replace(ORGNR_RE, ' | ');
    for (const m of text.matchAll(ENTITY_RE)) found.add(norm(`${m[1]} ${m[2]}`));
  }
  const reps: string[] = [];
  for (const n of [...found].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    if (n === ours || n.endsWith(` ${ours}`)) continue;
    if (reps.some((r) => n.endsWith(` ${r}`))) continue;
    reps.push(n);
  }
  return reps;
}

/** A page that presents several companies (a group or chain site), not one company's own site. */
function looksLikeGroupSite(pages: PageAnalysis[], legalName: string): boolean {
  const others = otherEntities(pages, legalName);
  return others.length >= 2 || (others.length >= 1 && pages.some((p) => GROUP_PHRASES.test(p.text)));
}

// A path that is still the site's front page ("/", "/no/", "/index.html").
const ROOTISH_PATH = /^\/((no|nb|nn|en|norsk|english|home|hjem|forside|start|index\.(html?|php|aspx?))\/?)?$/i;

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
  let refused: string | null = null;
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
    // The server answered but turned an automated reader away (bot protection, rate limit).
    if (r.outcome === 'error' && /^http_(401|403|429|451)$/.test(r.error)) refused = r.error;
  }
  if (!home || home.outcome !== 'ok') {
    if (lastFail) snapshots.push(lastFail.snapshot);
    // Guessed domains are speculative: anything but a readable homepage simply means "no site".
    if (transient && cand.via !== 'name_domain_check') return v('error', lastFail && 'error' in lastFail ? lastFail.error : 'site_unreachable');
    // A site that refuses automated readers exists but cannot be checked: not the same as no site.
    if (refused && cand.via !== 'name_domain_check') return v('blocked', `site_refuses_automated_access_${refused}`);
    return v('no_site', lastFail && 'error' in lastFail ? lastFail.error : 'no_homepage');
  }
  snapshots.push(home.page.snapshot);
  const homeA = analyzePage(home.page);
  const finalUrl = new URL(home.page.url);
  const finalHost = finalUrl.hostname.toLowerCase();
  const finalDomain = registrableDomain(finalHost);
  // A registered address deeper than the front page (group.no/selskaper/kappa-bygg) is one page
  // of someone else's site: only that page and the pages below it speak for this company.
  const scoped = !ROOTISH_PATH.test(finalUrl.pathname);
  const homeUrl = scoped ? `${finalUrl.protocol}//${finalHost}${finalUrl.pathname}` : `${finalUrl.protocol}//${finalHost}/`;
  // A placeholder page is not a company website, unless it shows this company's number.
  if (homeA.parked && !homeA.orgnrs.has(id.orgnr)) return v('parked', 'parked_or_placeholder_page', { pages: [homeA], homeUrl });

  const pages = [homeA];
  if (!homeA.orgnrs.has(id.orgnr)) {
    for (const link of priorityLinks(homeA, finalDomain, 3, scoped ? finalUrl.pathname.replace(/\/?$/, '/') : '/')) {
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
  const homeName = nameOnHomepage(homeA, scoped ? '' : finalHost, tokens);
  const inText = legalNameInText(pages, id.legalName);
  const nameHit = homeName || (inText ? `page text: ${inText.text}` : null);
  const base = { pages, homeUrl, scoped, candidate: { ...cand, host: finalHost, domain: finalDomain } };

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
    // The legal name only in the page text of a site that presents several companies (a group or
    // chain site listing its members) does not make the site this company's own.
    if (!homeName && looksLikeGroupSite(pages, id.legalName)) return v('ambiguous', 'site_shows_several_companies', base);
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

// What may surround the company name in its own handle: legal form, country, "official", digits.
const HANDLE_AFFIXES = ['official', 'offisiell', 'norway', 'norge', 'the', 'asa', 'ans', 'nor', 'as', 'sa', 'da', 'no'];

/**
 * The account handle must be this company's name: every distinctive legal-name token (all but
 * one for names of four or more tokens), with nothing else around it but the legal form, a
 * country word, "official", digits or initials from the name. A parent group ("kappagruppen"),
 * a sister company, the web agency or the website theme does not pass. The site's domain is not
 * used: a group's domain label would let the group's own accounts through.
 */
export function handleMatchesName(handleRaw: string, legalName: string): boolean {
  let rest = translit(handleRaw).replace(/[^a-z0-9]/g, '');
  const tokens = nameTokens(legalName);
  if (!rest || !tokens.length || tokens.join('').length < 4) return false;
  const need = tokens.length >= 4 ? tokens.length - 1 : tokens.length;
  let matched = 0;
  for (const t of [...tokens].sort((a, b) => b.length - a.length)) {
    const at = rest.indexOf(t);
    if (at < 0) continue;
    rest = rest.slice(0, at) + '\u0000' + rest.slice(at + t.length);
    matched++;
  }
  if (matched < need) return false;
  rest = rest.replace(/\u0000/g, '').replace(/\d+/g, '');
  const initials = (translit(legalName).match(/\b[a-z]\b/g) || []).join('');
  for (const a of HANDLE_AFFIXES) rest = rest.split(a).join('');
  for (const ch of initials) rest = rest.replace(ch, '');
  return rest === '';
}

export function socialMatchesIdentity(p: SocialProfile, legalName: string): boolean {
  const handle = decodeURIComponent(new URL(p.url).pathname.split('/').filter(Boolean).pop() || '').replace(/^@/, '');
  return handleMatchesName(handle, legalName);
}

export function profilesFrom(verdict: SiteVerdict, legalName: string): { profile: SocialProfile; page: PageAnalysis; via: string }[] {
  const out = new Map<string, { profile: SocialProfile; page: PageAnalysis; via: string }>();
  for (const page of verdict.pages) {
    const raw = [...page.links.map((l) => ({ u: l.url, via: 'link' })), ...page.sameAs.map((u) => ({ u, via: 'structured data sameAs' }))];
    for (const { u, via } of raw) {
      const p = normalizeSocial(u);
      if (!p || out.has(p.url) || !socialMatchesIdentity(p, legalName)) continue;
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
// ---------------------------------------------------------------------------
// Dated news and job openings on the verified site
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  januar: 1, jan: 1, january: 1, februar: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3, april: 4, apr: 4,
  mai: 5, may: 5, juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7, august: 8, aug: 8, september: 9, sep: 9,
  sept: 9, oktober: 10, okt: 10, october: 10, oct: 10, november: 11, nov: 11, desember: 12, des: 12, december: 12, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
/** Parses ISO, Norwegian (12.10.2026, 12. oktober 2026) and English (October 12, 2026) dates. */
export function parseDate(s: string): string | null {
  const t = s.toLowerCase();
  let m = t.match(/(20\d\d)-(\d\d)-(\d\d)/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(20\d\d)(?!\d)/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = t.match(/(?<!\d)(\d{1,2})\.?\s+([a-zæøå]{3,9})\.?\s+(20\d\d)(?!\d)/);
  if (m && MONTHS[m[2]]) return ymd(+m[3], MONTHS[m[2]], +m[1]);
  m = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d\d)(?!\d)/);
  if (m && MONTHS[m[1]]) return ymd(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}
const DATE_TEXT = /(20\d\d-\d\d-\d\d)|(?<!\d)\d{1,2}\.\d{1,2}\.20\d\d(?!\d)|(?<!\d)\d{1,2}\.?\s+[a-zA-ZæøåÆØÅ]{3,9}\.?\s+20\d\d(?!\d)|\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+20\d\d/g;

const NEWS_PATH = /\/(nyheter|nyhet|aktuelt|news|nytt|blogg|blog|presse|pressemeldinger|artikler|articles|insights|innsikt|siste-nytt)(\/|$)/i;
const NEWS_TEXT = /^(nyheter|aktuelt|news|nytt|blogg|blog|presse|artikler|siste nytt|insights|innsikt)$/i;
const CAREERS_PATH = /\/(karriere|karrierer|jobb|jobbe-hos-oss|jobb-hos-oss|ledige-stillinger|stillinger|careers?|jobs|work-with-us|join-us|bli-en-av-oss|rekruttering)(\/|$)/i;
const CAREERS_TEXT = /^(karriere|jobb hos oss|jobbe hos oss|ledige stillinger|stillinger|careers?|jobs|jobb|bli en av oss|work with us|join us|rekruttering)$/i;
const GENERIC_LINK = /^(les mer|les hele|se mer|mer|søk|søk her|søk nå|se stilling|se alle|vis alle|apply|apply now|read more|her|klikk her|ledige stillinger|karriere|jobb|nyheter|aktuelt|news|blogg|forrige|neste|next|previous)$/i;
// Menu and paging labels on news pages ("Se flere nyheter", "Alle artikler", "Nyhetsarkiv"): not posts.
const NEWS_NAV_LABEL = new RegExp(
  [
    '^(se|vis|les|g[aå] til|til|alle|flere|mer|eldre|nyere|tidligere|siste|more|see|view|show|all|older|newer|latest|back to|tilbake til)\\s+((alle|flere|mer|more|all|our|v[aå]re|de|the)\\s+)*(nyheter|nyhetene|nyhetssaker|saker|sakene|artikler|artiklene|innlegg|innleggene|news|posts|articles|stories|aktuelt|blogg|blogginnlegg|pressemeldinger|arkiv|archive|nytt)\\b(\\s+\\S+){0,3}\\s*$',
    '^(nyhetsarkiv|arkiv|archive|nyheter|news|aktuelt|blogg|blog|presse|pressemeldinger|siste nytt|alle nyheter|flere nyheter|mer nytt)$',
    '\\b(les|se|vis|read|see|view) (mer|flere|alle|more|all)$',
    '^(neste|forrige|next|previous|prev)( side| page)?$',
    '^(side|page) \\d+$',
  ].join('|'),
  'i'
);
// Listing, archive and shop paths: never a single post.
const NOT_A_POST_PATH = /\/(kategori|kategorier|category|categories|tag|tags|tema|emne|topics?|arkiv|archive|page|side|author|forfatter|feed|rss|sok|search|produkt|produkter|product|products|shop|butikk|nettbutikk|vare|varer|collections?|catalog|katalog|sortiment|tilbud|kampanjer?)(\/|$)/i;
// Shop prices ("1 299,-", "kr 1 299,00", "NOK 499,-") and buy buttons.
const PRICE_TAG = /(\d[\d .\u00a0]*,-|\d[\d .\u00a0]*,\d\d\s*(kr|nok)\b|\b(kr|nok)\.?\s?\d[\d .\u00a0]*,(\d\d|-))/i;
const SHOP_WORDS = /(legg i (handle)?kurv|handlekurv|add to (cart|basket)|kj[oø]p n[aå]|p[aå] lager|lagerstatus|in stock)/i;
// A date right after one of these words is when a post was changed, not when it was published.
const MODIFIED_LABEL = /(oppdatert|sist endret|endret|redigert|revidert|updated|last updated|modified|edited)\s*(den|on|at)?\s*:?\s*$/i;
const MODIFIED_ATTR = /(updated|modified|datemodified|endret|oppdatert)/i;
const PUBLISHED_LABEL = /(publisert|published|posted|postet|dato|date)\s*(den|on)?\s*:?\s*$/i;
const PUBLISHED_ATTR = /(published|datepublished|entry-date|post-date|publisert|pubdate)/i;

// Company career sites on recruiting platforms. FINN and NAV are not among them: NAV ads come from
// the NAV feed by organisation number, and FINN pages are not read.
const ATS_HOSTS = /(^|\.)(teamtailor\.com|webcruiter\.(com|no)|jobbnorge\.no|recman\.(no|page)|hrmanager\.no|hr-manager\.net|jobylon\.com|reachmee\.com|easycruit\.com|simplyrecruit\.no|varbi\.com|jobs\.lever\.co|boards\.greenhouse\.io|job-boards\.greenhouse\.io|smartrecruiters\.com|workable\.com|talentech\.com|homerun\.co)$/i;
// One ad, not a list or a search: a numeric id or a UUID in the address.
const SINGLE_AD = /(\/jobs?\/\d{3,}|\/jobs?\/[0-9a-f]{8}-[0-9a-f]{4}-|[?&](advertid|projectid|jobid|job_id|vacancyid|adid|id)=\d{3,}|\/(stilling|stillinger|vacancy|vacancies|annonse|position|positions|ad|job-ad)\/\d{3,}|jobid:\d+|\/j\/[0-9a-f]{6,}|\/\d{6,}-[\w-]+|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const SEARCH_LIKE = /((^|\/)(search|sok|s%c3%b8k|browse|results?|resultat|filter|liste?)(\/|$|\.|\?)|[?&](q|query|s|search|orgid|employer|page|side|category|kategori)=)/i;
const OPEN_APPLICATION = /([aå]pen s[oø]knad|apen-soknad|open application|generell s[oø]knad|spontaneous application|talent ?pool|talentbank)/i;
const MAX_AD_PAGES = 4;

export interface SiteNewsItem { date: string; title: string; url: string; snapshot: SourceSnapshot; via: string }
export interface SiteJob {
  title: string;
  url: string;
  posted: string | null;
  expires: string | null;
  listed_on: string;
  hiring_organisation: string | null;
  snapshot: SourceSnapshot;
  via: string;
}
export interface SiteActivity {
  news: SiteNewsItem[];
  newsPage: string | null;
  newsChecked: boolean;
  /** Why the page behind the news link was not read as news (a shop's "Nyheter" lists new products). */
  newsPageSkipped?: string;
  /** The careers page that was read (a landing page, never published as an opening). */
  careersPage: string | null;
  careersChecked: boolean;
  jobs: SiteJob[];
  snapshots: SourceSnapshot[];
}

const stripTags = (h: string) => decodeEntities(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

interface Anchor { url: string; text: string; start: number; end: number; inner: string }
function anchorsWithPos(html: string, base: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${m[1]}>`, 'href');
    if (!href || /^(mailto|tel|javascript):/i.test(href) || href.startsWith('#')) continue;
    try {
      const u = new URL(href, base);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      out.push({ url: u.href, text: stripTags(m[2]).slice(0, 300), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, inner: m[2] });
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Index just after the element's closing tag, or -1 when it closes before `mustReach` (a sibling) or is not found. */
function closeOf(html: string, tag: string, openEnd: number, mustReach: number): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > openEnd + 20_000) return -1;
    if (!m[1] && m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const close = m.index + m[0].length;
      return close >= mustReach ? close : -1;
    }
  }
  return -1;
}

/**
 * The HTML of the item a link belongs to: the largest element around the link (article, list
 * item, card) that holds no link to another post. Dates are only read inside it, so a neighbour's
 * date is never taken.
 */
function itemBlock(html: string, a: Anchor, items: Anchor[]): string {
  const from = Math.max(0, a.start - 4000);
  const opens: { tag: string; at: number; end: number }[] = [];
  const re = /<(article|li|tr|div|section)\b[^>]*>/gi;
  re.lastIndex = from;
  for (let m = re.exec(html); m && m.index < a.start; m = re.exec(html)) opens.push({ tag: m[1].toLowerCase(), at: m.index, end: m.index + m[0].length });
  let best: [number, number] | null = null;
  for (let i = opens.length - 1; i >= 0; i--) {
    const o = opens[i];
    const close = closeOf(html, o.tag, o.end, a.end);
    if (close < 0) continue;
    if (close - o.at > 8000) break;
    if (items.some((x) => x.url !== a.url && x.start >= o.at && x.end <= close)) break;
    best = [o.at, close];
  }
  return best ? html.slice(best[0], best[1]) : html.slice(a.start, a.end);
}

/** The publish date inside one item. Dates marked as updated or modified are ignored. */
export function publishedDate(block: string): string | null {
  const cands: { d: string; at: number; rank: number }[] = [];
  const labelBefore = (at: number) => stripTags(block.slice(Math.max(0, at - 300), at)).slice(-40);
  for (const m of block.matchAll(/<time\b([^>]*)>/gi)) {
    const at = m.index ?? 0;
    const dt = attr(`<time ${m[1]}>`, 'datetime');
    const d = dt ? parseDate(dt) : null;
    if (!d || MODIFIED_ATTR.test(m[1]) || MODIFIED_LABEL.test(labelBefore(at))) continue;
    cands.push({ d, at, rank: PUBLISHED_ATTR.test(m[1]) || PUBLISHED_LABEL.test(labelBefore(at)) ? 0 : 1 });
  }
  for (const m of block.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = (attr(m[0], 'itemprop') || attr(m[0], 'property') || '').toLowerCase();
    if (prop !== 'datepublished' && prop !== 'article:published_time') continue;
    const d = parseDate(attr(m[0], 'content') || '');
    if (d) cands.push({ d, at: m.index ?? 0, rank: 0 });
  }
  // Dates written in the text (tags blanked in place, so positions match the HTML).
  const textOnly = block.replace(/<[^>]+>/g, (t) => ' '.repeat(t.length));
  for (const m of textOnly.matchAll(DATE_TEXT)) {
    const at = m.index ?? 0;
    const d = parseDate(m[0]);
    if (!d) continue;
    const before = textOnly.slice(Math.max(0, at - 60), at).replace(/\s+/g, ' ');
    // The element the date sits in, e.g. <span class="updated">.
    const tagBefore = block.slice(Math.max(0, at - 200), at).match(/<([a-z0-9]+)\b([^>]*)>\s*$/i)?.[2] || '';
    if (MODIFIED_LABEL.test(before) || MODIFIED_ATTR.test(tagBefore)) continue;
    cands.push({ d, at, rank: PUBLISHED_LABEL.test(before) || PUBLISHED_ATTR.test(tagBefore) ? 0 : 2 });
  }
  cands.sort((x, y) => x.rank - y.rank || x.at - y.at);
  return cands[0]?.d ?? null;
}

function articleNodes(html: string): { date: string; title: string; url: string | null }[] {
  const out: { date: string; title: string; url: string | null }[] = [];
  for (const n of jsonLdNodes(html)) {
    const types = ([] as string[]).concat(n['@type'] || []).map(String);
    if (!types.some((t) => /^(NewsArticle|BlogPosting|Article|Report|PressRelease)$/.test(t))) continue;
    // Only the publish date: dateModified is when it was last changed.
    const date = typeof n.datePublished === 'string' ? parseDate(n.datePublished) : null;
    const title = typeof n.headline === 'string' ? n.headline : typeof n.name === 'string' ? n.name : '';
    const url = typeof n.url === 'string' ? n.url : typeof n.mainEntityOfPage === 'string' ? n.mainEntityOfPage : n.mainEntityOfPage?.['@id'] || null;
    if (date && title) out.push({ date, title: decodeEntities(title).trim(), url });
  }
  return out;
}

/** A shop listing (the "Nyheter" of a web shop is new products), not a news page. */
function isShopListing(html: string): boolean {
  if (jsonLdNodes(html).some((n) => ([] as unknown[]).concat(n['@type'] || []).some((t) => /^(Product|ProductGroup)$/.test(String(t))))) return true;
  const text = stripTags(html);
  return SHOP_WORDS.test(text) && [...text.matchAll(new RegExp(PRICE_TAG.source, 'gi'))].length >= 3;
}

interface JobNode { title: string; posted: string | null; expires: string | null; url: string | null; org: string | null; orgIds: string[] }
function jobNodes(html: string): JobNode[] {
  const out: JobNode[] = [];
  for (const n of jsonLdNodes(html)) {
    const types = ([] as string[]).concat(n['@type'] || []).map(String);
    if (!types.includes('JobPosting') || typeof n.title !== 'string') continue;
    const ho = Array.isArray(n.hiringOrganization) ? n.hiringOrganization[0] : n.hiringOrganization;
    const org = typeof ho === 'string' ? ho : typeof ho?.name === 'string' ? ho.name : typeof ho?.legalName === 'string' ? ho.legalName : null;
    const orgIds: string[] = [];
    if (ho && typeof ho === 'object')
      for (const k of ['vatID', 'taxID', 'identifier', 'leiCode']) {
        const raw = ho[k] && typeof ho[k] === 'object' ? ho[k].value : ho[k];
        if (typeof raw !== 'string' && typeof raw !== 'number') continue;
        for (const m of String(raw).matchAll(/(?<!\d)(\d{3})\s?(\d{3})\s?(\d{3})(?!\d)/g)) if (validateOrgnr(m[1] + m[2] + m[3]).valid) orgIds.push(m[1] + m[2] + m[3]);
      }
    out.push({
      title: decodeEntities(n.title).replace(/\s+/g, ' ').trim(),
      posted: typeof n.datePosted === 'string' ? parseDate(n.datePosted) : null,
      expires: typeof n.validThrough === 'string' ? parseDate(n.validThrough) : null,
      url: typeof n.url === 'string' ? n.url : null,
      org: org ? decodeEntities(org).trim() : null,
      orgIds,
    });
  }
  return out;
}

/**
 * A single, current ad whose hiring organisation is this company (by organisation number when the
 * ad gives one, otherwise by its legal name). Ads for the parent or a sister company, open
 * applications and expired or undated postings are not openings of this company.
 */
function openingFor(j: JobNode, id: CompanyIdentity): boolean {
  if (j.title.length < 3 || j.title.length > 150 || GENERIC_LINK.test(j.title) || OPEN_APPLICATION.test(j.title)) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (j.expires) {
    if (j.expires < today) return false;
  } else if (!j.posted || Date.parse(j.posted) < Date.now() - 120 * 864e5) return false;
  if (j.orgIds.length) return j.orgIds.includes(id.orgnr);
  return !!j.org && sameCompanyName(j.org, id.legalName);
}

function findSectionLink(pages: PageAnalysis[], domain: string, path: RegExp, text: RegExp): string | null {
  // Prefer the section's own page (/nyheter, /karriere) over a single article or posting inside it.
  let best: { url: string; score: number } | null = null;
  for (const p of pages)
    for (const l of p.links) {
      let u: URL;
      try {
        u = new URL(l.url);
      } catch {
        continue;
      }
      if (registrableDomain(u.hostname) !== domain) continue;
      const segs = u.pathname.split('/').filter(Boolean);
      const pathHit = path.test(u.pathname);
      const textHit = text.test(l.text.trim());
      if (!pathHit && !textHit) continue;
      const score = pathHit && segs.length <= 2 && path.test(`/${segs[segs.length - 1]}/`) ? 0 : textHit ? 1 : 2;
      if (!best || score < best.score) best = { url: `${u.origin}${u.pathname}`, score };
    }
  return best?.url ?? null;
}

/**
 * Reads the verified site's news page and careers page (robots.txt honoured), and the single job
 * ads its careers page links to on recruiting platforms (at most MAX_AD_PAGES).
 */
export async function readSiteActivity(
  web: WebClient,
  verdict: SiteVerdict,
  id: CompanyIdentity,
  since: string,
  snapPrefix: string,
  signal?: AbortSignal
): Promise<SiteActivity> {
  const act: SiteActivity = { news: [], newsPage: null, newsChecked: false, careersPage: null, careersChecked: false, jobs: [], snapshots: [] };
  const domain = verdict.candidate.domain;
  const today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const sinceDay = since.slice(0, 10);

  const newsUrl = findSectionLink(verdict.pages, domain, NEWS_PATH, NEWS_TEXT);
  if (!newsUrl) act.newsChecked = true;
  else if (!signal?.aborted) {
    const r = await web.getPage(newsUrl, `${snapPrefix}:news`, signal);
    act.snapshots.push(r.outcome === 'ok' ? r.page.snapshot : r.snapshot);
    if (r.outcome === 'ok') {
      act.newsChecked = true;
      const html = r.page.html;
      if (isShopListing(html)) act.newsPageSkipped = 'product_listing';
      else {
        act.newsPage = r.page.url;
        const listPath = new URL(r.page.url).pathname.replace(/\/$/, '');
        const postUrl = (raw: string): string | null => {
          let u: URL;
          try {
            u = new URL(raw, r.page.url);
          } catch {
            return null;
          }
          if (registrableDomain(u.hostname) !== domain) return null;
          const path = u.pathname.replace(/\/$/, '');
          const under = path.startsWith(`${listPath}/`);
          if (path === listPath || !(under || NEWS_PATH.test(u.pathname))) return null;
          if (path.split('/').filter(Boolean).length < 2) return null;
          if (NOT_A_POST_PATH.test(under ? path.slice(listPath.length) : path) || /\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4)$/i.test(path)) return null;
          return `${u.origin}${u.pathname}`;
        };
        const seen = new Set<string>();
        const add = (date: string | null, title: string, url: string, via: string) => {
          if (!date || date < sinceDay || date > today || seen.has(url)) return;
          const t = title.replace(/[\s\u00a0]+/g, ' ').replace(/^[\s\u203a\u00bb\u2192>\u00b7\u2022|-]+|[\s\u203a\u00bb\u2192>\u00b7\u2022|-]+$/g, '').trim();
          if (t.length < 8 || t.length > 200 || GENERIC_LINK.test(t) || NEWS_NAV_LABEL.test(t)) return;
          seen.add(url);
          act.news.push({ date, title: t, url, snapshot: r.page.snapshot, via });
        };
        for (const a of articleNodes(html)) {
          const url = a.url ? postUrl(a.url) : null;
          if (url) add(a.date, a.title, url, 'structured data');
        }
        const items = anchorsWithPos(html, r.page.url).flatMap((a) => {
          const url = postUrl(a.url);
          return url ? [{ ...a, url }] : [];
        });
        for (const a of items) {
          if (seen.has(a.url)) continue;
          const block = itemBlock(html, a, items);
          const blockText = stripTags(block);
          if (PRICE_TAG.test(blockText) || SHOP_WORDS.test(blockText)) continue; // a product card
          const own = a.inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
          let title = own ? stripTags(own) : a.text;
          if (title.length < 8 || GENERIC_LINK.test(title) || NEWS_NAV_LABEL.test(title)) {
            const h = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
            if (h) title = stripTags(h);
          }
          add(publishedDate(block), title, a.url, 'news page link');
        }
        act.news.sort((x, y) => y.date.localeCompare(x.date) || x.url.localeCompare(y.url));
        act.news = act.news.slice(0, 10);
      }
    }
  }

  const careersUrl = findSectionLink(verdict.pages, domain, CAREERS_PATH, CAREERS_TEXT);
  if (!careersUrl) act.careersChecked = true;
  else if (!signal?.aborted) {
    const r = await web.getPage(careersUrl, `${snapPrefix}:careers`, signal);
    act.snapshots.push(r.outcome === 'ok' ? r.page.snapshot : r.snapshot);
    if (r.outcome === 'ok') {
      act.careersChecked = true;
      act.careersPage = r.page.url;
      const seen = new Set<string>();
      const push = (j: JobNode, url: string, snapshot: SourceSnapshot, via: string) => {
        if (seen.has(url)) return;
        seen.add(url);
        act.jobs.push({ title: j.title, url, posted: j.posted, expires: j.expires, listed_on: new URL(url).hostname, hiring_organisation: j.org, snapshot, via });
      };
      // 1. Job postings described on the careers page itself, for this company only.
      // Each must link to its own ad: the careers page itself is a landing page, not a job.
      const landing = r.page.url.replace(/[?#].*$/, '').replace(/\/$/, '');
      for (const j of jobNodes(r.page.html)) {
        if (!j.url || !openingFor(j, id)) continue;
        let u: URL;
        try {
          u = new URL(j.url, r.page.url);
        } catch {
          continue;
        }
        const where = u.pathname + u.search;
        if (!/^https?:$/.test(u.protocol) || `${u.origin}${u.pathname}`.replace(/\/$/, '') === landing || SEARCH_LIKE.test(where)) continue;
        if (registrableDomain(u.hostname) !== domain && !SINGLE_AD.test(where)) continue;
        u.hash = '';
        push(j, u.href, r.page.snapshot, 'structured data JobPosting on the careers page');
      }
      // 2. Single ads on the company's career site at a recruiting platform. Each ad is read and
      //    counted only when it names this company as the hiring organisation: group career
      //    sites list the parent's and sister companies' vacancies too. Searches and list pages
      //    (and NAV or FINN links) are never openings.
      const adLinks: string[] = [];
      for (const a of anchorsWithPos(r.page.html, r.page.url)) {
        const u = new URL(a.url);
        const where = u.pathname + u.search;
        if (!ATS_HOSTS.test(u.hostname) || !SINGLE_AD.test(where) || SEARCH_LIKE.test(where)) continue;
        const url = `${u.origin}${u.pathname}${u.search}`;
        if (!adLinks.includes(url) && !seen.has(url)) adLinks.push(url);
      }
      for (const [i, url] of adLinks.slice(0, MAX_AD_PAGES).entries()) {
        if (signal?.aborted) break;
        const ad = await web.getPage(url, `${snapPrefix}:job:${i}`, signal);
        const snap = ad.outcome === 'ok' ? ad.page.snapshot : ad.snapshot;
        snap.publisher = `The company (its job ad on ${new URL(url).hostname}, linked from its careers page)`;
        act.snapshots.push(snap);
        if (ad.outcome !== 'ok') continue;
        const nodes = jobNodes(ad.page.html);
        if (nodes.length !== 1 || !openingFor(nodes[0], id)) continue;
        push(nodes[0], ad.page.url, ad.page.snapshot, 'job ad linked from the careers page');
      }
      act.jobs = act.jobs.slice(0, 15);
    }
  }
  return act;
}

export interface WebsiteOutcome {
  /** 'disabled' = the step did not run this time (switched off or public web unreachable). */
  state: 'verified' | 'none' | 'ambiguous' | 'blocked' | 'incomplete' | 'disabled';
  verdicts: SiteVerdict[];
  verified: SiteVerdict | null;
  registryVerdict: SiteVerdict | null;
  disabledReason?: string;
  /** News and careers pages of the verified site. */
  activity?: SiteActivity;
}

export async function findWebsite(web: WebClient | null | undefined, id: CompanyIdentity, budgetMs = 20_000, since = '2025-01-01'): Promise<WebsiteOutcome> {
  if (!web || web.disabled) return { state: 'disabled', verdicts: [], verified: null, registryVerdict: null, disabledReason: web?.disabledReason || 'website_step_disabled' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  const verdicts: SiteVerdict[] = [];
  let activity: SiteActivity | undefined;
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
    const v = verdicts.find((x) => x.status === 'exact');
    // A page on someone else's site (scoped) has no news or careers section of its own.
    if (v && !v.scoped && !ctrl.signal.aborted) activity = await readSiteActivity(web, v, id, since, `snap:${id.orgnr}:web:${v.candidate.domain}`, ctrl.signal);
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
  return { state, verdicts, verified, registryVerdict, activity, ...(state === 'disabled' ? { disabledReason: web.disabledReason || 'public_web_unreachable' } : {}) };
}
