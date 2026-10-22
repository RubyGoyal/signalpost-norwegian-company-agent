// Safe fetcher for company-owned web pages (official websites found and verified by
// website.ts). Unlike the registry client, the host is not known in advance, so every
// request goes through a public-URL guard:
//   - http(s) only, default ports only, no credentials in the URL;
//   - the host must resolve, and every address must be public (no loopback, private,
//     link-local, carrier-grade NAT, multicast or reserved ranges), checked again on
//     every redirect hop;
//   - robots.txt is honoured (RFC 9309: a missing file allows, an unreachable one disallows);
//   - only HTML is read, capped in size and time; at most a few pages per site.
// A circuit breaker turns the website step off for the rest of the run when the network
// clearly cannot reach the public web, so a blocked network costs seconds, not minutes.

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { SourceSnapshot } from './types.ts';

export const WEB_USER_AGENT =
  'signalpost-agent/1.2 (+https://github.com/RubyGoyal/signalpost-norwegian-company-agent)';
const ROBOTS_TOKEN = 'signalpost-agent';

export const WEB_SOURCE = {
  source: 'company_website' as const,
  source_class: 'company_owned' as const,
  publisher: 'The company (its own website)',
  licence: 'Company-owned public web page, read once per run; robots.txt honoured',
};

export interface WebOptions {
  concurrency: number;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  maxRequests: number;
  /** Test seam: replaces DNS resolution. */
  resolver?: (host: string) => Promise<string[]>;
}

export interface WebPage {
  requested_url: string;
  url: string; // final URL after redirects
  status: number;
  html: string;
  retrieved_at: string;
  content_sha256: string;
  snapshot: SourceSnapshot;
}

export type WebResult =
  | { outcome: 'ok'; page: WebPage }
  | { outcome: 'not_found' | 'blocked' | 'error' | 'not_html' | 'no_such_host'; error: string; snapshot: SourceSnapshot };

// ---------------------------------------------------------------------------
// Public address checks
// ---------------------------------------------------------------------------
function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}
function isPublicV6(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a === '::' || a === '::1') return false;
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicV4(mapped[1]);
  const first = parseInt(a.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a.startsWith('2001:db8:') || a.startsWith('2001:0db8:')) return false; // documentation
  if (a.startsWith('64:ff9b:')) return false; // NAT64: could reach an internal v4 address
  return true;
}
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPublicV4(ip);
  if (v === 6) return isPublicV6(ip);
  return false;
}

const BAD_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|test|invalid|example)$/i;

/** Static URL checks (no network). Returns the parsed URL or a reason. */
export function checkUrlShape(raw: string): { url: URL } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'invalid_url' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'scheme_not_allowed' };
  if (u.username || u.password) return { error: 'credentials_in_url' };
  if (u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')))
    return { error: 'port_not_allowed' };
  const host = u.hostname.replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, ''))) {
    if (!isPublicAddress(host.replace(/^\[|\]$/g, ''))) return { error: 'private_address' };
    return { error: 'ip_literal_not_allowed' };
  }
  if (!host.includes('.') || BAD_SUFFIX.test(host)) return { error: 'host_not_public' };
  return { url: u };
}

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309, the parts that matter for a few GETs)
// ---------------------------------------------------------------------------
interface RobotsRules {
  allowAll?: boolean;
  disallowAll?: boolean;
  /** robots.txt could not be fetched (network error or 5xx): treated as a full disallow. Holds the error. */
  unreachable?: string;
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(text: string, token = ROBOTS_TOKEN): RobotsRules {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      if (val || key === 'allow') cur.rules.push({ allow: key === 'allow', path: val });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const t = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && t.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules) };
}

function robotsPatternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

export function robotsAllows(r: RobotsRules, pathAndQuery: string): boolean {
  if (r.disallowAll) return false;
  if (r.allowAll) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of r.rules) {
    if (!rule.path) continue;
    if (robotsPatternMatches(rule.path, pathAndQuery)) {
      const len = rule.path.length;
      if (!best || len > best.len || (len === best.len && rule.allow)) best = { allow: rule.allow, len };
    }
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
async function defaultResolver(host: string): Promise<string[]> {
  const res = await lookup(host, { all: true, verbatim: true });
  return res.map((r) => r.address);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(label), { code: 'ETIMEOUT' })), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

function charsetOf(contentType: string, head: Uint8Array): string {
  const m = contentType.match(/charset=["']?([\w-]+)/i);
  if (m) return m[1].toLowerCase();
  const sniff = new TextDecoder('latin1').decode(head.slice(0, 2048));
  const meta = sniff.match(/<meta[^>]+charset=["']?([\w-]+)/i);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export class WebClient {
  private active = 0;
  private queue: (() => void)[] = [];
  private robots = new Map<string, Promise<RobotsRules>>();
  private dns = new Map<string, Promise<string[]>>();
  requestsUsed = 0;
  /** Network-level outcomes, for the circuit breaker. */
  private reached = 0;
  private unreachable = 0;
  disabledReason: string | null = null;
  private resolver: (host: string) => Promise<string[]>;

  constructor(private opts: WebOptions) {
    this.resolver = opts.resolver || (globalThis as any).__SIGNALPOST_DNS__ || defaultResolver;
  }

  get disabled() {
    return this.disabledReason !== null;
  }

  private async acquire() {
    if (this.active < this.opts.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  private noteNetwork(ok: boolean) {
    if (ok) this.reached++;
    else this.unreachable++;
    // 40 attempts in a row without a single HTTP answer: the public web is not reachable.
    if (!this.disabledReason && this.reached === 0 && this.unreachable >= 40) this.disabledReason = 'public_web_unreachable';
  }

  private snapshot(url: string, fields: Partial<SourceSnapshot> & { retrieved_at: string }, id: string): SourceSnapshot {
    return {
      id,
      source: WEB_SOURCE.source,
      source_url: url,
      source_class: WEB_SOURCE.source_class,
      publisher: WEB_SOURCE.publisher,
      licence: WEB_SOURCE.licence,
      http_status: null,
      content_sha256: null,
      ok: false,
      ...fields,
    };
  }

  /**
   * Start-of-run check that the public web is reachable at all (DNS and HTTPS). If not, the
   * website step is switched off for the run and reported as not checked, never as "none".
   */
  async probe(url = 'https://www.brreg.no/robots.txt'): Promise<boolean> {
    try {
      const u = new URL(url);
      if ((await this.hostCheck(u.hostname)) !== 'ok') {
        this.disabledReason = 'public_web_unreachable';
        return false;
      }
      const r = await this.guardedGet(url, 'text/plain,*/*;q=0.5', 256_000);
      if (!r.ok) {
        this.disabledReason = 'public_web_unreachable';
        return false;
      }
      return true;
    } catch {
      this.disabledReason = 'public_web_unreachable';
      return false;
    }
  }

  /** Resolves the host and checks that every address is public. */
  async hostCheck(host: string): Promise<'ok' | 'no_such_host' | 'private_address' | 'dns_error'> {
    let p = this.dns.get(host);
    if (!p) {
      p = withTimeout(this.resolver(host), 4000, 'dns_timeout');
      this.dns.set(host, p);
    }
    try {
      const addrs = await p;
      if (!addrs.length) return 'no_such_host';
      return addrs.every(isPublicAddress) ? 'ok' : 'private_address';
    } catch (e: any) {
      const code = String(e?.code || '');
      if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') return 'no_such_host';
      return 'dns_error';
    }
  }

  private async rawGet(
    u: URL,
    accept: string,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<{ status: number; location: string | null; contentType: string; bytes: Uint8Array | null; tooBig: boolean }> {
    if (this.requestsUsed >= this.opts.maxRequests) throw Object.assign(new Error('web_request_budget_exhausted'), { code: 'EBUDGET' });
    await this.acquire();
    try {
      this.requestsUsed++;
      const timeout = AbortSignal.timeout(this.opts.timeoutMs);
      const res = await fetch(u.href, {
        redirect: 'manual',
        headers: { 'User-Agent': WEB_USER_AGENT, Accept: accept, 'Accept-Language': 'nb,no,en;q=0.8' },
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
      const contentType = res.headers.get('content-type') || '';
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        return { status: res.status, location, contentType, bytes: null, tooBig: false };
      }
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        return { status: res.status, location, contentType, bytes: null, tooBig: true };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      let tooBig = false;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            tooBig = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(tooBig ? 0 : total);
      if (!tooBig) {
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.byteLength;
        }
      }
      return { status: res.status, location, contentType, bytes: tooBig ? null : bytes, tooBig };
    } finally {
      this.release();
    }
  }

  /** GET with manual redirects, each hop re-checked. */
  private async guardedGet(
    start: string,
    accept: string,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<
    | { ok: true; finalUrl: URL; status: number; contentType: string; bytes: Uint8Array | null; tooBig: boolean }
    | { ok: false; error: string; status?: number; finalUrl?: URL; network?: boolean }
  > {
    let current = start;
    for (let hop = 0; hop <= this.opts.maxRedirects; hop++) {
      const shape = checkUrlShape(current);
      if ('error' in shape) return { ok: false, error: shape.error };
      const u = shape.url;
      const hc = await this.hostCheck(u.hostname.replace(/\.$/, ''));
      if (hc !== 'ok') return { ok: false, error: hc, network: hc === 'dns_error' };
      let r;
      try {
        r = await this.rawGet(u, accept, maxBytes, signal);
      } catch (e: any) {
        if (e?.code === 'EBUDGET') return { ok: false, error: 'web_request_budget_exhausted' };
        const name = e?.name || '';
        const msg = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : `network_error: ${e?.cause?.code || e?.message || e}`;
        this.noteNetwork(false);
        return { ok: false, error: msg, finalUrl: u, network: true };
      }
      this.noteNetwork(true);
      if (r.status >= 300 && r.status < 400) {
        if (!r.location) return { ok: false, error: `http_${r.status}_without_location`, status: r.status, finalUrl: u };
        current = new URL(r.location, u).href;
        continue;
      }
      return { ok: true, finalUrl: u, status: r.status, contentType: r.contentType, bytes: r.bytes, tooBig: r.tooBig };
    }
    return { ok: false, error: 'too_many_redirects' };
  }

  private async robotsFor(origin: string, signal?: AbortSignal): Promise<RobotsRules> {
    let p = this.robots.get(origin);
    if (!p) {
      p = (async () => {
        const r = await this.guardedGet(`${origin}/robots.txt`, 'text/plain,*/*;q=0.5', 256_000, signal);
        // Unreachable robots.txt (network error or 5xx): full disallow, per RFC 9309 2.3.1.4.
        if (!r.ok) return { disallowAll: true, unreachable: r.error, rules: [] };
        if (r.status >= 400 && r.status < 500) return { allowAll: true, rules: [] };
        if (r.status >= 500) return { disallowAll: true, unreachable: `http_${r.status}`, rules: [] };
        if (r.tooBig || !r.bytes) return { allowAll: true, rules: [] }; // an absurd robots.txt is ignored, not obeyed
        return parseRobots(decode(r.bytes, 'utf-8'));
      })();
      this.robots.set(origin, p);
    }
    return p;
  }

  /** Fetches one HTML page, honouring robots.txt. Never throws. */
  async getPage(url: string, snapshotId: string, signal?: AbortSignal): Promise<WebResult> {
    const now = () => new Date().toISOString();
    if (this.disabledReason) return { outcome: 'error', error: this.disabledReason, snapshot: this.snapshot(url, { retrieved_at: now(), error: this.disabledReason }, snapshotId) };
    try {
      const shape = checkUrlShape(url);
      if ('error' in shape) return { outcome: 'blocked', error: shape.error, snapshot: this.snapshot(url, { retrieved_at: now(), error: shape.error }, snapshotId) };
      const hc = await this.hostCheck(shape.url.hostname.replace(/\.$/, ''));
      if (hc === 'no_such_host') return { outcome: 'no_such_host', error: hc, snapshot: this.snapshot(url, { retrieved_at: now(), error: hc }, snapshotId) };
      if (hc !== 'ok') return { outcome: hc === 'private_address' ? 'blocked' : 'error', error: hc, snapshot: this.snapshot(url, { retrieved_at: now(), error: hc }, snapshotId) };
      const rules = await this.robotsFor(shape.url.origin, signal);
      if (rules.unreachable) {
        const err = rules.unreachable === 'no_such_host' ? 'no_such_host' : rules.unreachable;
        return { outcome: err === 'no_such_host' ? 'no_such_host' : 'error', error: err, snapshot: this.snapshot(url, { retrieved_at: now(), error: err }, snapshotId) };
      }
      if (!robotsAllows(rules, shape.url.pathname + shape.url.search))
        return { outcome: 'blocked', error: 'robots_txt_disallows', snapshot: this.snapshot(url, { retrieved_at: now(), error: 'robots_txt_disallows' }, snapshotId) };
      const r = await this.guardedGet(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', this.opts.maxBytes, signal);
      const retrieved = now();
      if (!r.ok) {
        const blocked = ['private_address', 'scheme_not_allowed', 'credentials_in_url', 'port_not_allowed', 'host_not_public', 'ip_literal_not_allowed'].includes(r.error);
        return {
          outcome: r.error === 'no_such_host' ? 'no_such_host' : blocked ? 'blocked' : 'error',
          error: r.error,
          snapshot: this.snapshot(r.finalUrl?.href || url, { retrieved_at: retrieved, http_status: r.status ?? null, error: r.error }, snapshotId),
        };
      }
      // A redirect may land on another site: check that site's robots.txt too.
      if (r.finalUrl.origin !== shape.url.origin) {
        const rules2 = await this.robotsFor(r.finalUrl.origin, signal);
        if (!robotsAllows(rules2, r.finalUrl.pathname + r.finalUrl.search))
          return { outcome: 'blocked', error: 'robots_txt_disallows', snapshot: this.snapshot(r.finalUrl.href, { retrieved_at: retrieved, error: 'robots_txt_disallows' }, snapshotId) };
      }
      if (r.status === 404 || r.status === 410)
        return { outcome: 'not_found', error: `http_${r.status}`, snapshot: this.snapshot(r.finalUrl.href, { retrieved_at: retrieved, http_status: r.status, error: `http_${r.status}` }, snapshotId) };
      if (r.status >= 400)
        return { outcome: 'error', error: `http_${r.status}`, snapshot: this.snapshot(r.finalUrl.href, { retrieved_at: retrieved, http_status: r.status, error: `http_${r.status}` }, snapshotId) };
      if (r.tooBig || !r.bytes)
        return { outcome: 'error', error: 'page_too_large', snapshot: this.snapshot(r.finalUrl.href, { retrieved_at: retrieved, http_status: r.status, error: 'page_too_large' }, snapshotId) };
      if (!/html/i.test(r.contentType))
        return { outcome: 'not_html', error: 'not_html', snapshot: this.snapshot(r.finalUrl.href, { retrieved_at: retrieved, http_status: r.status, error: 'not_html' }, snapshotId) };
      const sha = createHash('sha256').update(r.bytes).digest('hex');
      const html = decode(r.bytes, charsetOf(r.contentType, r.bytes));
      const snapshot = this.snapshot(r.finalUrl.href, { retrieved_at: retrieved, http_status: r.status, content_sha256: sha, ok: true }, snapshotId);
      return { outcome: 'ok', page: { requested_url: url, url: r.finalUrl.href, status: r.status, html, retrieved_at: retrieved, content_sha256: sha, snapshot } };
    } catch (e: any) {
      const err = `web_error: ${e?.message || e}`;
      return { outcome: 'error', error: err, snapshot: this.snapshot(url, { retrieved_at: now(), error: err }, snapshotId) };
    }
  }
}
