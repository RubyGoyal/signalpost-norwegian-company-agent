// Hiring signal from NAV's public job vacancy feed (pam-stilling-feed.nav.no).
//
// The feed is read once per run: every entry modified in the last N days, keeping the
// latest state of each ad. Then the detail record of every active ad is read once, and the
// ads are indexed by the employer's organisation number. A company gets an ad only when that
// number is the company itself or one of its registered sub-units, so ads posted under a
// brand name are found too, and a namesake employer never matches. If the detail read could
// not finish in its time budget, the remaining ads fall back to name-selected candidates,
// still confirmed by organisation number. Only ACTIVE, unexpired ads are published, and
// contact persons are never published.

import type { BrregClient, FetchResult } from './brreg.ts';
import type { SourceSnapshot } from './types.ts';

const FEED_BASE = 'https://pam-stilling-feed.nav.no';

export interface FeedAd {
  uuid: string;
  status: string;
  title: string;
  businessName: string;
  municipal: string | null;
  modified: string;
  detailUrl: string;
}

export interface ConfirmedAd {
  uuid: string;
  title: string;
  employer_name: string | null;
  employer_orgnr: string;
  matched_via: 'company' | 'sub_unit';
  location: string | null;
  published: string | null;
  expires: string | null;
  application_due: string | null;
  positions: number | null;
  extent: string | null;
  engagement_type: string | null;
  nav_url: string;
  snapshot: SourceSnapshot;
}

export interface JobIndexInfo {
  ok: boolean;
  error?: string;
  token: 'env' | 'public' | null;
  window_days: number;
  feed_pages: number;
  entries_read: number;
  active_ads: number;
  window_from: string;
  window_to: string | null;
  retrieved_at: string;
  first_page_url: string;
  /** Detail records of active ads read and indexed by employer organisation number. */
  details_scanned?: number;
  details_total?: number;
  detail_scan_complete?: boolean;
  detail_errors?: number;
  detail_seconds?: number;
}

interface AdDetail {
  uuid: string;
  orgnr: string;
  status: string;
  json: any;
  snapshot: SourceSnapshot;
}

// Written with string escapes so the source stays plain ASCII.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const NOT_NAME_CHARS = new RegExp('[^A-Z0-9\\u00C6\\u00D8\\u00C5 ]+', 'g');

/** Uppercase, strip punctuation, legal-form suffixes and spacing, for candidate matching only. */
export function normName(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(NOT_NAME_CHARS, ' ')
    .replace(/\b(ASA|AS|SA|ANS|DA|NUF|ENK|BA|STI|KF|IKS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class NavJobIndex {
  private byName = new Map<string, FeedAd[]>();
  private byOrgnr = new Map<string, AdDetail[]>();
  private scanned = new Set<string>();
  info: JobIndexInfo;
  private token: string | null = null;

  private constructor(info: JobIndexInfo) {
    this.info = info;
  }

  /** An index that could not be built; every company's job postings are then `failed`. */
  static failed(error: string, days: number): NavJobIndex {
    return new NavJobIndex({
      ok: false,
      error,
      token: null,
      window_days: days,
      feed_pages: 0,
      entries_read: 0,
      active_ads: 0,
      window_from: new Date(Date.now() - days * 864e5).toISOString(),
      window_to: null,
      retrieved_at: new Date().toISOString(),
      first_page_url: `${FEED_BASE}/api/v1/feed`,
    });
  }

  private static async fetchToken(client: BrregClient, count: (n: number) => void): Promise<string | null> {
    const r = await client.fetchUrl('nav_job_feed', `${FEED_BASE}/api/publicToken`, 'snap:nav:token', count, {
      keepText: true,
      accept: 'text/plain',
    });
    if (r.outcome !== 'ok' || !r.text) return null;
    return (r.text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/) || [])[0] || null;
  }

  static async build(
    client: BrregClient,
    opts: {
      days: number;
      maxPages: number;
      count?: (n: number) => void;
      /** Read every active ad's detail record and index it by employer organisation number. */
      detailScan?: boolean;
      /** Time budget for the detail read; what is left falls back to name-selected candidates. */
      detailBudgetMs?: number;
      /** Hard time budget for the feed read itself. */
      feedBudgetMs?: number;
    }
  ): Promise<NavJobIndex> {
    const tFeed = Date.now();
    const count = opts.count || (() => {});
    const from = new Date(Date.now() - opts.days * 864e5);
    const idx = new NavJobIndex({
      ok: false,
      token: null,
      window_days: opts.days,
      feed_pages: 0,
      entries_read: 0,
      active_ads: 0,
      window_from: from.toISOString(),
      window_to: null,
      retrieved_at: new Date().toISOString(),
      first_page_url: `${FEED_BASE}/api/v1/feed`,
    });

    const envToken = (globalThis as any).process?.env?.SIGNALPOST_NAV_TOKEN;
    idx.token = envToken || (await NavJobIndex.fetchToken(client, count));
    idx.info.token = envToken ? 'env' : idx.token ? 'public' : null;
    if (!idx.token) {
      idx.info.error = 'nav_token_unavailable';
      return idx;
    }

    const latest = new Map<string, FeedAd>();
    let url = `${FEED_BASE}/api/v1/feed`;
    let first = true;
    let tokenRefreshed = false;
    while (url && idx.info.feed_pages < opts.maxPages) {
      if (opts.feedBudgetMs && Date.now() - tFeed > opts.feedBudgetMs) {
        idx.info.error = 'nav_feed_time_budget_reached';
        break;
      }
      const headers: Record<string, string> = { Authorization: `Bearer ${idx.token}` };
      if (first) headers['If-Modified-Since'] = from.toUTCString();
      let r: FetchResult = await client.fetchUrl('nav_job_feed', url, `snap:nav:feed:${idx.info.feed_pages}`, count, { headers });
      if (r.outcome === 'error' && r.snapshot.http_status === 401 && !tokenRefreshed && !envToken) {
        tokenRefreshed = true;
        idx.token = await NavJobIndex.fetchToken(client, count);
        if (!idx.token) break;
        continue;
      }
      if (r.outcome !== 'ok' || !Array.isArray(r.json?.items)) {
        idx.info.error = r.snapshot.error || 'nav_feed_unreadable';
        break;
      }
      first = false;
      idx.info.feed_pages++;
      for (const it of r.json.items) {
        const fe = it?._feed_entry;
        if (!fe?.uuid) continue;
        idx.info.entries_read++;
        const ad: FeedAd = {
          uuid: fe.uuid,
          status: String(fe.status || ''),
          title: String(fe.title || it.title || ''),
          businessName: String(fe.businessName || ''),
          municipal: fe.municipal ? String(fe.municipal) : null,
          modified: String(fe.sistEndret || it.date_modified || ''),
          detailUrl: it.url ? new URL(it.url, FEED_BASE).href : `${FEED_BASE}/api/v1/feedentry/${fe.uuid}`,
        };
        const prev = latest.get(ad.uuid);
        if (!prev || ad.modified >= prev.modified) latest.set(ad.uuid, ad);
        idx.info.window_to = ad.modified || idx.info.window_to;
      }
      const next = r.json.next_url;
      url = next ? new URL(next, FEED_BASE).href : '';
    }

    for (const ad of latest.values()) {
      if (ad.status !== 'ACTIVE' || !ad.businessName) continue;
      const key = normName(ad.businessName);
      if (!key) continue;
      const list = idx.byName.get(key) || [];
      list.push(ad);
      idx.byName.set(key, list);
      idx.info.active_ads++;
    }
    // A capped read would miss the newest ads, so it counts as a failed index, not a partial one.
    if (url && !idx.info.error) idx.info.error = 'nav_feed_page_cap_reached';
    idx.info.ok = idx.info.feed_pages > 0 && !idx.info.error;
    if (idx.info.ok && opts.detailScan !== false) await idx.scanDetails(client, count, opts.detailBudgetMs ?? 300_000);
    return idx;
  }

  /** Reads the detail record of every active ad once and indexes it by employer organisation number. */
  private async scanDetails(client: BrregClient, count: (n: number) => void, budgetMs: number) {
    const t0 = Date.now();
    const todo = [...this.byName.values()].flat();
    this.info.details_total = todo.length;
    this.info.details_scanned = 0;
    this.info.detail_errors = 0;
    let next = 0;
    const workers = Array.from({ length: 24 }, async () => {
      while (next < todo.length && Date.now() - t0 < budgetMs) {
        const ad = todo[next++];
        const r = await client.fetchUrl('nav_job_ad', ad.detailUrl, `snap:nav:ad:${ad.uuid}`, count, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (r.outcome !== 'ok') {
          this.info.detail_errors!++;
          continue;
        }
        const d = r.json || {};
        const j = d.ad_content || d.json || {};
        const orgnr = String(j?.employer?.orgnr || '').replace(/\s/g, '');
        this.scanned.add(ad.uuid);
        this.info.details_scanned!++;
        if (!/^\d{9}$/.test(orgnr)) continue;
        const list = this.byOrgnr.get(orgnr) || [];
        list.push({ uuid: ad.uuid, orgnr, status: String(d.status || 'ACTIVE'), json: j, snapshot: r.snapshot });
        this.byOrgnr.set(orgnr, list);
      }
    });
    await Promise.all(workers);
    this.info.detail_scan_complete = this.scanned.size === todo.length;
    this.info.detail_seconds = Math.round((Date.now() - t0) / 1000);
  }

  candidates(names: string[]): FeedAd[] {
    const seen = new Map<string, FeedAd>();
    for (const n of names) {
      const key = normName(n);
      if (!key) continue;
      for (const ad of this.byName.get(key) || []) seen.set(ad.uuid, ad);
    }
    return [...seen.values()].sort((a, b) => (a.modified < b.modified ? 1 : -1));
  }

  /**
   * Confirms candidate ads against their detail records. Returns confirmed ads, how many
   * candidates were checked, and whether the cap was hit.
   */
  async confirm(
    client: BrregClient,
    names: string[],
    orgnrs: Map<string, 'company' | 'sub_unit'>,
    maxDetails: number,
    count: (n: number) => void
  ): Promise<{ ads: ConfirmedAd[]; checked: number; capped: boolean; errors: number }> {
    const ads: ConfirmedAd[] = [];
    let errors = 0;
    const now = Date.now();
    const toAd = (uuid: string, d: any, j: any, orgnr: string, via: 'company' | 'sub_unit', municipal: string | null, title: string, snapshot: SourceSnapshot): ConfirmedAd | null => {
      if (String(d.status || 'ACTIVE') !== 'ACTIVE') return null;
      if (j.expires && Date.parse(j.expires) < now) return null;
      const loc = Array.isArray(j.workLocations) && j.workLocations[0];
      return {
        uuid,
        title: String(j.title || title),
        employer_name: j?.employer?.name ? String(j.employer.name) : null,
        employer_orgnr: orgnr,
        matched_via: via,
        location: loc ? [loc.city, loc.municipal, loc.county].filter(Boolean)[0] || null : municipal,
        published: j.published ? String(j.published).slice(0, 10) : null,
        expires: j.expires ? String(j.expires).slice(0, 10) : null,
        application_due: j.applicationDue ? String(j.applicationDue) : null,
        positions: Number.isFinite(Number(j.positioncount)) && j.positioncount !== null && j.positioncount !== undefined ? Number(j.positioncount) : null,
        extent: j.extent ? String(j.extent) : null,
        engagement_type: j.engagementtype ? String(j.engagementtype) : null,
        nav_url: `https://arbeidsplassen.nav.no/stillinger/stilling/${uuid}`,
        snapshot,
      };
    };
    // 1. Ads already read and indexed by employer organisation number (no extra requests).
    for (const [orgnr, via] of orgnrs) {
      for (const d of this.byOrgnr.get(orgnr) || []) {
        const ad = toAd(d.uuid, { status: d.status }, d.json, orgnr, via, null, '', d.snapshot);
        if (ad) ads.push(ad);
      }
    }
    // 2. Ads the detail read did not reach: name-selected candidates, confirmed by number.
    const cands = this.candidates(names).filter((c) => !this.scanned.has(c.uuid));
    const slice = cands.slice(0, maxDetails);
    await Promise.all(
      slice.map(async (c) => {
        const r = await client.fetchUrl('nav_job_ad', c.detailUrl, `snap:nav:ad:${c.uuid}`, count, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (r.outcome !== 'ok') {
          errors++;
          return;
        }
        const d = r.json || {};
        const j = d.ad_content || d.json || {};
        const orgnr = String(j?.employer?.orgnr || '').replace(/\s/g, '');
        const via = orgnrs.get(orgnr);
        if (!via) return; // name matched, organisation number did not: not this company
        const ad = toAd(c.uuid, d, j, orgnr, via, c.municipal, c.title, r.snapshot);
        if (ad) ads.push(ad);
      })
    );
    ads.sort((a, b) => ((a.published || '') < (b.published || '') ? 1 : -1));
    return { ads, checked: slice.length, capped: cands.length > maxDetails, errors };
  }
}
