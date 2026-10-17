// Minimal client for the open Brønnøysundregistrene APIs (data.brreg.no, NLOD 2.0).
// Concurrency-limited, retries 429/5xx/network errors with backoff, counts every
// outbound request, and records a source snapshot for each response.

import { createHash } from 'node:crypto';
import type { SourceSnapshot } from './types.ts';

const BASE = 'https://data.brreg.no';
const USER_AGENT =
  'signalpost-agent/1.0 (+https://github.com/RubyGoyal/signalpost-norwegian-company-agent)';

export interface ClientOptions {
  concurrency: number;
  maxRequests: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface FetchResult {
  snapshot: SourceSnapshot;
  json: any | null;
  /** 'ok' = 2xx, 'not_found' = 404, 'gone' = 410 (deleted entity), 'error' = gave up. */
  outcome: 'ok' | 'not_found' | 'gone' | 'error';
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

  async get(
    source: SourceSnapshot['source'],
    path: string,
    snapshotId: string,
    countRequest: (n: number) => void
  ): Promise<FetchResult> {
    const url = `${BASE}${path}`;
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
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        lastStatus = res.status;
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
            snapshot: {
              id: snapshotId,
              source,
              source_url: url,
              source_class: 'official_registry',
              publisher: 'Brønnøysundregistrene',
              licence: 'NLOD 2.0',
              retrieved_at: retrievedAt,
              http_status: res.status,
              content_sha256: sha,
              ok: res.ok,
            },
            json,
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
      snapshot: {
        id: snapshotId,
        source,
        source_url: url,
        source_class: 'official_registry',
        publisher: 'Brønnøysundregistrene',
        licence: 'NLOD 2.0',
        retrieved_at: new Date().toISOString(),
        http_status: lastStatus,
        content_sha256: null,
        ok: false,
        error: lastError,
      },
      json: null,
      outcome: 'error',
    };
  }
}
