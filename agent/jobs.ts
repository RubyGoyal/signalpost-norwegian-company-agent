// Hiring signal from NAV's public job vacancy feed (pam-stilling-feed.nav.no).
//
// The feed is read once per run: every entry modified in the last N days, keeping the
// latest state of each ad. An ad is attached to a company only after its detail record
// confirms that the employer organisation number is the company itself or one of its
// registered sub-units. Name matching only selects candidates; it is never evidence.
// Only ACTIVE, unexpired ads are published, and contact persons are never published.

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
    opts: { days: number; maxPages: number; count?: (n: number) => void }
  ): Promise<NavJobIndex> {
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
    return idx;
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
    const cands = this.candidates(names);
    const ads: ConfirmedAd[] = [];
    let errors = 0;
    const now = Date.now();
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
        if (String(d.status || 'ACTIVE') !== 'ACTIVE') return;
        if (j.expires && Date.parse(j.expires) < now) return;
        const loc = Array.isArray(j.workLocations) && j.workLocations[0];
        ads.push({
          uuid: c.uuid,
          title: String(j.title || c.title),
          employer_name: j?.employer?.name ? String(j.employer.name) : null,
          employer_orgnr: orgnr,
          matched_via: via,
          location: loc ? [loc.city, loc.municipal, loc.county].filter(Boolean)[0] || null : c.municipal,
          published: j.published ? String(j.published).slice(0, 10) : null,
          expires: j.expires ? String(j.expires).slice(0, 10) : null,
          application_due: j.applicationDue ? String(j.applicationDue) : null,
          positions: Number.isFinite(Number(j.positioncount)) && j.positioncount !== null ? Number(j.positioncount) : null,
          extent: j.extent ? String(j.extent) : null,
          engagement_type: j.engagementtype ? String(j.engagementtype) : null,
          nav_url: `https://arbeidsplassen.nav.no/stillinger/stilling/${c.uuid}`,
          snapshot: r.snapshot,
        });
      })
    );
    ads.sort((a, b) => ((a.published || '') < (b.published || '') ? 1 : -1));
    return { ads, checked: slice.length, capped: cands.length > maxDetails, errors };
  }
}
