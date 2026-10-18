// HTTP client for the agent's permitted sources: the open Brønnøysundregistrene APIs
// (data.brreg.no, NLOD 2.0) and NAV's job vacancy feed (pam-stilling-feed.nav.no).
// Concurrency-limited, retries 429/5xx/network errors with backoff, counts every
// outbound request, refuses any other host, and records a source snapshot per response.

import { createHash } from 'node:crypto';
import type { SourceClass, SourceName, SourceSnapshot } from './types.ts';

const BASE = 'https://data.brreg.no';
const USER_AGENT =
  'signalpost-agent/1.0 (+https://github.com/RubyGoyal/signalpost-norwegian-company-agent)';

/** Outbound URL policy: only these hosts, only https. */
export const ALLOWED_HOSTS = new Set(['data.brreg.no', 'pam-stilling-feed.nav.no']);

const SOURCE_META: Record<SourceName, { source_class: SourceClass; publisher: string; licence: string }> = {
  enhetsregisteret: { source_class: 'official_registry', publisher: 'Brønnøysundregistrene', licence: 'NLOD 2.0' },
  roller: { source_class: 'official_registry', publisher: 'Brønnøysundregistrene', licence: 'NLOD 2.0' },
  underenheter: { source_class: 'official_registry', publisher: 'Brønnøysundregistrene', licence: 'NLOD 2.0' },
  regnskapsregisteret: { source_class: 'official_registry', publisher: 'Brønnøysundregistrene', licence: 'NLOD 2.0' },
  oppdateringer: { source_class: 'official_registry', publisher: 'Brønnøysundregistrene', licence: 'NLOD 2.0' },
  nav_job_feed: {
    source_class: 'official_job_board',
    publisher: 'NAV (Arbeids- og velferdsetaten), arbeidsplassen.no',
    licence: 'NAV job feed API terms (https://arbeidsplassen.nav.no/vilkar-api)',
  },
  nav_job_ad: {
    source_class: 'official_job_board',
    publisher: 'NAV (Arbeids- og velferdsetaten), arbeidsplassen.no',
    licence: 'NAV job feed API terms (https://arbeidsplassen.nav.no/vilkar-api)',
  },
};

export interface ClientOptions {
  concurrency: number;
  maxRequests: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface FetchResult {
  snapshot: SourceSnapshot;
  json: any | null;
  text?: string;
  headers?: { lastModified: string | null };
  /** 'ok' = 2xx, 'not_found' = 404, 'gone' = 410 (deleted entity), 'error' = gave up. */
  outcome: 'ok' | 'not_found' | 'gone' | 'error';
}

export interface FetchOptions {
  headers?: Record<string, string>;
  /** Also return the raw body text (for non-JSON responses). */
  keepText?: boolean;
  /** Accept header (default application/json). */
  accept?: string;
}

export class BrregClient {
  private active = 0;
  private queue: (() => void)[] = [];
  requestsUsed = 0;

  constructor(private opts: ClientOptions) {}

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

  /** GET a path on data.brreg.no. */
  get(source: SourceName, path: string, snapshotId: string, countRequest: (n: number) => void): Promise<FetchResult> {
    return this.fetchUrl(source, `${BASE}${path}`, snapshotId, countRequest);
  }

  private snapshot(
    source: SourceName,
    url: string,
    snapshotId: string,
    fields: Pick<SourceSnapshot, 'retrieved_at' | 'http_status' | 'content_sha256' | 'ok'> & { error?: string }
  ): SourceSnapshot {
    return { id: snapshotId, source, source_url: url, ...SOURCE_META[source], ...fields };
  }

  async fetchUrl(
    source: SourceName,
    url: string,
    snapshotId: string,
    countRequest: (n: number) => void,
    options: FetchOptions = {}
  ): Promise<FetchResult> {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      return {
        snapshot: this.snapshot(source, url, snapshotId, {
          retrieved_at: new Date().toISOString(),
          http_status: null,
          content_sha256: null,
          ok: false,
          error: 'url_not_allowed',
        }),
        json: null,
        outcome: 'error',
      };
    }

    let lastError = 'unknown_error';
    let lastStatus: number | null = null;

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (this.requestsUsed >= this.opts.maxRequests) {
        lastError = 'request_budget_exhausted';
        break;
      }
      await this.acquire();
      let retryAfterMs = 0;
      try {
        this.requestsUsed++;
        countRequest(1);
        const res = await fetch(parsed.href, {
          headers: { Accept: options.accept || 'application/json', 'User-Agent': USER_AGENT, ...options.headers },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        lastStatus = res.status;
        // Redirects are followed only within the allowed hosts.
        if (res.url && !ALLOWED_HOSTS.has(new URL(res.url).hostname)) {
          lastError = 'redirect_not_allowed';
          break;
        }
        const retrievedAt = new Date().toISOString();
        const body = await res.text();

        if (res.ok || res.status === 404 || res.status === 410) {
          const sha = createHash('sha256').update(body).digest('hex');
          let json: any = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }
          return {
            snapshot: this.snapshot(source, parsed.href, snapshotId, {
              retrieved_at: retrievedAt,
              http_status: res.status,
              content_sha256: sha,
              ok: res.ok,
            }),
            json,
            ...(options.keepText ? { text: body } : {}),
            headers: { lastModified: res.headers.get('last-modified') },
            outcome: res.ok ? 'ok' : res.status === 404 ? 'not_found' : 'gone',
          };
        }

        lastError = `http_${res.status}`;
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 30_000);
        // 4xx other than 429 will not get better on retry.
        if (res.status < 500 && res.status !== 429) break;
      } catch (err: any) {
        lastError = err?.name === 'TimeoutError' ? 'timeout' : `network_error: ${err?.message || err}`;
      } finally {
        this.release();
      }
      if (attempt < this.opts.maxRetries) {
        const backoff = retryAfterMs || 600 * 2 ** attempt + Math.floor(Math.random() * 300);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    return {
      snapshot: this.snapshot(source, parsed.href, snapshotId, {
        retrieved_at: new Date().toISOString(),
        http_status: lastStatus,
        content_sha256: null,
        ok: false,
        error: lastError,
      }),
      json: null,
      outcome: 'error',
    };
  }
}
