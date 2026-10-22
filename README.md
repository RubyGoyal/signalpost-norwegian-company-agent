# Signalpost — Norwegian company profiles with evidence

Signalpost takes Norwegian organisation numbers and returns one result envelope per company. Each envelope holds the facts that the official Brønnøysund registers hold for that exact organisation number, the company's verified official website and the profiles it links to, and its active job ads on NAV. Every fact carries its source URL, where in the source it was found, the retrieval time, and the reporting period where one applies.

Built for the [Builderr Signalpost challenge](https://builderr.ai/challenges/signalpost).

## Run it

Requires Node.js 22.12 or later.

```bash
npm ci
npx tsx agent/run.ts <input-file> out
```

- **Input:** a file of organisation numbers in `.txt`, `.csv`, `.tsv`, `.jsonl` or `.json` format, optionally `.gz`.
  - JSON records may use `organisation_number`, `organisasjonsnummer`, `orgnr`, `org_number`, `organizationNumber` or a similar name; failing that, the record's 9-digit value is used. A parent organisation number field is never used.
  - In a CSV with a header row, the organisation-number column is found by name.
  - `923 609 016`, `923.609.016` and `NO923609016MVA` are all read as `923609016`. Duplicates are merged.
  - No row is dropped silently: a value with digits that is not a valid organisation number gets its own `failed` envelope (`invalid_organisation_number`). Only rows with no digits (headers, blank cells) are skipped, and they are counted in the run report.
- **Output:**
  - `out/envelopes.jsonl`: exactly one terminal envelope per input organisation number, in input order.
  - `out/run-report.json`: counts by state, requests, runtime (p50/p95) and cost.
- **Stdout:** a single JSON line summarising the run. Progress goes to stderr.
- **Shortcut:** numbers can be passed directly, for example `npx tsx agent/run.ts 923609016,984851006 out`.

Optional flags and environment variables:

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `--concurrency` | `SIGNALPOST_CONCURRENCY` | 8 | Parallel registry requests |
| `--max-requests` | `SIGNALPOST_MAX_REQUESTS` | 20000 | Hard cap on registry requests per run (NAV and websites have their own caps) |
| `--deadline-seconds` | `SIGNALPOST_DEADLINE_SECONDS` | off | At this time, unfinished companies are written as `failed`, so no row is ever missing |
| `--state-dir` | `SIGNALPOST_STATE_DIR` | `.signalpost-state` | Previous snapshots used for refresh |
| `--run-id` | `SIGNALPOST_RUN_ID` | timestamp | Run identifier written into every envelope |
| `--jobs` | `SIGNALPOST_JOBS` | on | `off` skips the NAV job feed |
| `--jobs-days` | `SIGNALPOST_JOBS_DAYS` | 60 | How many days of NAV job feed to read |
| `--web` | `SIGNALPOST_WEB` | on | `off` skips the company-website step (reported as not checked) |
| | `SIGNALPOST_WEBSITE_BUDGET_MS` | 20000 | Time budget for one company's website step |
| | `SIGNALPOST_JOBS_DETAIL_BUDGET_MS` | 300000 | Time budget for reading every active NAV ad |

## What each envelope contains

| Part | Contents |
|---|---|
| `organisation_number`, `input_index`, `state` | Overall state: one of `available`, `not_available`, `blocked`, `not_applicable`, `ambiguous`, `failed` |
| `legal_identity` | Legal name, organisation form and registry status, matched on the exact organisation number |
| `availability` | State and reason per field family (see below). A source that was checked and returned nothing is distinguished from one that was not checked. |
| `claims` | One per fact: `field`, `value`, `unit`, `reporting_period`, `source_date`, `retrieved_at`, `evidence_ids` |
| `evidence` | Source URL, source class (`official_registry`, `official_job_board` or `company_owned`), `claim_span` (the JSON path in a register response, or the exact text or link on a company web page), retrieval time, SHA-256 of the source response, reporting period |
| `source_snapshots` | Every request: URL, HTTP status, retrieval time, content hash, licence |
| `summary` | Starts with an "at a glance" line: organisation form, place, industry, employees, latest revenue and its change on the previous year, hiring, website. Then what the company does, size, people, locations, status, website and profiles, hiring, registry activity, website news, what changed, and what is unknown. Each statement links to its evidence. |
| `changes` | Material changes since the previous run (`new_value`, `changed_value`, `removed_value`) with before and after values and the previous evidence |
| `refresh` | `cold_start` or `previous_run`, the previous run ID and date, the same change list, and the number of unchanged claims |
| `run`, `operations`, `errors` | Run ID and timing, requests used, third-party cost ($0), and any source errors |

**Field families covered:**
- Legal identity: legal name, form, founded and registration dates, share capital, former names
- Registered and postal address
- Industry: NACE codes, sector and registered purpose
- Employees
- Status flags: bankruptcy, liquidation, forced dissolution, deletion, registry notices
- Roles: CEO, board, auditor, accountant and others
- Locations: active sub-units with address and employees
- Annual accounts: revenue, operating profit, profit before tax, annual result, assets, equity, liabilities, audited flag, latest filed year
- **Official website:** the website registered in Enhetsregisteret, or one found through the registered email domain or a domain spelled from the legal name, published only after the site proves it is the same company (see rules)
- **Company-owned profiles:** LinkedIn, Facebook, Instagram, X, YouTube and TikTok pages that the verified website links to (or that the company registered as its website)
- Contact points: registered company email and phone, plus email and phone links on the verified website's own domain (never published for sole proprietorships)
- Group structure
- **Hiring:** active job ads from NAV's job vacancy feed (arbeidsplassen.no), attached when the ad's employer organisation number is the company or one of its registered sub-units (including ads posted under a brand name). Also the verified website's careers page and the openings it lists: job-board ad links, its own job pages and structured `JobPosting` data.
- **Public activity:** the registry's dated change log since 2025, for example "annual accounts filed: 2025", "employee count updated", "business address changed". Also dated news items from the verified website's news page.

## Rules the agent follows

- **Exact identity.** Every Brønnøysund register is queried by the exact organisation number, after a modulus-11 check, so facts cannot attach to a namesake, parent or subsidiary. NAV job ads and websites are attached only after their own evidence confirms the organisation number or the exact company (see below).
- **No invented values.** A value is published only if the register holds it. If a register cannot be reached after retries, that family is `failed` and has no claims. If the identity lookup fails, the company is `failed` with zero claims.
- **Missing is not zero.** An employee count is published only when the register says one is registered. Accounts figures are published only when present in the filing, and always with their reporting period.
- **Idempotent refresh.** Claim and evidence IDs come from content hashes, so re-running on the same data produces the same IDs and zero changes. Real changes record before and after values and keep the previous evidence. A source outage, an unreachable website or a skipped step never shows up as removed facts.
- **Personal data minimisation.** Role holders' names are published (they are public register data). Birth dates are not. Job ad contact persons are never published, and contact details of sole proprietorships are left out.
- **Hiring by organisation number.** Every active NAV ad's detail record is read once per run and indexed by the employer's organisation number, so an ad posted under a brand name is still found and a namesake employer never matches. If that read cannot finish in its time budget, the remaining ads are picked by employer name and still confirmed by organisation number.
- **A website is a claim only after proof.** Candidate sites (registered website, registered email domain, domains spelled from the legal name) are only guesses. A site is published as the official website when it shows the company's organisation number, or when its homepage carries the full legal name and (for name-spelled domains) the site also shows the registered phone number or street address. Parked or for-sale pages are rejected. A site that lists several organisation numbers (a group site) is reported as `ambiguous`, and one that shows a different organisation number is rejected.
- **News and openings only from a verified site.** A news item is published only with a date found in the item itself (or in its structured data). Openings come from links to job-board ads, the site's own job pages, or structured `JobPosting` data that has not expired. A careers-page link to a NAV ad that is already attached is not counted twice.
- **Profiles and contacts only from a verified site.** Social profiles are taken from the verified website's links and structured data, and only when the profile name matches the legal name or the site's own domain (a web agency's page is not the company's). Share buttons and personal profiles are ignored. Email and phone links are taken only on the site's own domain.
- **History is not removed.** Registry events are history, so they are never reported as removed. A job ad that goes inactive is removed from the profile and recorded as a change, as NAV's terms require.

## Sources, rights and outbound policy

| Source | Endpoint | Licence |
|---|---|---|
| Enhetsregisteret (entities) | `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}` | [NLOD 2.0](https://data.norge.no/nlod/en/2.0) |
| Enhetsregisteret (roles) | `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}/roller` | NLOD 2.0 |
| Enhetsregisteret (sub-units) | `https://data.brreg.no/enhetsregisteret/api/underenheter?overordnetEnhet={orgnr}` | NLOD 2.0 |
| Regnskapsregisteret (accounts) | `https://data.brreg.no/regnskapsregisteret/regnskap/{orgnr}` | NLOD 2.0 |
| Enhetsregisteret (change log) | `https://data.brreg.no/enhetsregisteret/api/oppdateringer/enheter?organisasjonsnummer={orgnr}` | NLOD 2.0 |
| NAV job vacancy feed | `https://pam-stilling-feed.nav.no/api/v1/feed` and `/api/v1/feedentry/{uuid}` | [NAV API terms](https://arbeidsplassen.nav.no/vilkar-api): ads may be republished; inactive ads must be removed |
| Company-owned websites | The company's own homepage, up to three contact, about or terms pages, and its news and careers pages | Public pages read once per run; [robots.txt](https://www.rfc-editor.org/rfc/rfc9309) honoured; only facts about the company itself are published |

**Registers and NAV.** Requests to these APIs go only to `data.brreg.no` and `pam-stilling-feed.nav.no`, over HTTPS. Any other host or a redirect off those hosts is refused in code (`ALLOWED_HOSTS` in `agent/brreg.ts`). Registry requests are rate-limited (default 8 concurrent) with retries and backoff on 429 and 5xx responses. Each company needs 5 or 6 registry requests: entity, roles, accounts, sub-units and change log.

**NAV job feed.** Read once per run, in the background while companies are researched: every entry modified in the last 60 days (about 120 pages), then the detail record of every active ad (about 9,000, by a separate client at 12 concurrent requests). Both steps are time-boxed. If the index is not ready, job postings are reported as `failed`, never guessed. `SIGNALPOST_JOBS=off` skips it, and job postings are then reported as not checked.

**Company websites: safe URL handling** (`agent/web.ts`). Because these hosts are not known in advance, every request passes a public-URL guard:
- Only `http` and `https`, default ports, and no credentials in the URL.
- The host must resolve, and every address must be public. Loopback, private, link-local (including cloud metadata addresses), carrier-grade NAT, multicast and reserved ranges are refused. This is checked again on every redirect hop (at most 4).
- `robots.txt` is honoured. A missing file allows access; one that cannot be fetched counts as a full disallow.
- Only HTML is read, at most 1.5 MB per page and 8 seconds per request. A company gets at most a few pages and 20 seconds in total.
- Social platforms and directory sites are never crawled.
- A start-of-run probe and a circuit breaker turn the step off if the public web is unreachable. It is then reported as not checked, never as "no website".
- Requests identify the agent with a `User-Agent` that links to this repository.

## Models, APIs, cost and secrets

- **Models:** none. No LLM or paid API is used; all sources are free public APIs.
- **Third-party cost per official run:** $0.
- **Caches:** no external cache. The only stored data is the local `.signalpost-state/` folder with each company's previous snapshot, used to detect changes on refresh. Delete it for a cold start.
- **Expected runtime:** about 5 to 7 minutes for 1,000 companies. Registry research and the website step run in parallel with the NAV read. `--deadline-seconds` guarantees a complete file within any budget.
- **Secrets:** none required. NAV's job feed uses its published public token, fetched at run time from `https://pam-stilling-feed.nav.no/api/publicToken`; a NAV-issued token can be supplied instead with `SIGNALPOST_NAV_TOKEN`. No keys are stored or logged. `.env*` files are git-ignored.
- **Dependencies:** pinned in `package-lock.json`, installed with `npm ci`. Runtime: `tsx` (MIT). Web app: `express`, `react`, `vite`, `tailwindcss`, `lucide-react` (MIT / ISC).

## Tests

```bash
npm run test:agent                    # offline self-test
npm run check:signalpost              # type check + offline self-test
npm run check:signalpost-showcase     # builds the web app
npm run check:signalpost-challenge    # live run on 10 well-known companies (examples/sample-orgnrs.txt)
```

**Live smoke test (17 October 2026):** 100 randomly sampled real companies, all 100 envelopes `available`, 0 source errors, 0 integrity issues, 5,292 claims, 400 requests, 19 s, $0. An immediate re-run on the same companies detected 0 changes. Details are in [`examples/smoke-100-report.json`](examples/smoke-100-report.json), with the sample in `examples/smoke-100.txt`.

**v2 live smoke test (same 100 companies):** hiring, public activity and the new registry fields. Public activity was found for 89 of 100 companies (243 dated events), group membership for 100, latest filed accounts year for 92, share capital for 86, contact points for 63 and former names for 50. One company had a confirmed active NAV job ad, matched through its sub-unit's organisation number. 0 integrity issues; an immediate re-run detected 0 changes. Details are in [`examples/smoke-100-v2-report.json`](examples/smoke-100-v2-report.json).

**1,000-company live test (21 October 2026, the version before this one):** 1,000 companies drawn at random from Builderr's official company list. All 1,000 envelopes were `available`, with 0 integrity issues, 60,012 claims and 5,012 requests, in 228 s. An immediate re-run detected 0 changes. Two gaps showed up. Only 11% of companies register a website. NAV ads posted under a brand name were missed: 1 of 3 companies with active ads was found. This version's website step and organisation-number ad index address both. Details are in [`examples/smoke-1000-report.json`](examples/smoke-1000-report.json), with the sample in `examples/smoke-1000.txt`.

**Live test of this version (22 October 2026, same 1,000 companies):**
- **Registry research:** 1,000 of 1,000 envelopes `available`, 0 integrity issues, 183 s. An immediate re-run detected 0 changes and produced identical claim IDs.
- **Hiring:** all 9,275 active NAV ads were read and indexed in about 4 minutes. The companies with active ads went from 1 to 3, and the attached ads from 1 to 5, including ads posted under brand names.
- **Websites:** the check was run on real company sites:
  - Five were verified: by organisation number, by the company name on the homepage, or by the full legal name in the footer.
  - A "Coming Soon" placeholder and a group brand site (coop.no for a Coop entity) were correctly not published.
  - The verified site that has profile links yielded its Facebook, Instagram and LinkedIn pages.
- **Candidates in the sample:** 108 companies register a website. Another 113 can be checked through their registered email domain, and 880 through domains spelled from their name.

Details are in [`examples/live-test-v3-report.json`](examples/live-test-v3-report.json).

To smoke-test against the live registry on a random sample of real companies:

```bash
npx tsx scripts/sample-batch.ts 100 examples/smoke-100.txt
npx tsx agent/run.ts examples/smoke-100.txt out
```

The offline self-test (99 checks) runs against simulated registry, NAV and company-website responses. It covers:
- one row per input, and a deadline close-out
- failure handling with no invented values
- unknown and deleted numbers, and an invalid checksum
- missing-not-zero rules
- evidence integrity
- idempotent re-runs, real change detection, and no false removals during an outage
- job ads: namesake employers rejected, brand-name ads found by organisation number, inactive ads removed, NAV outage handled
- websites: verified by organisation number or by name plus registered address; namesake, parked, group (ambiguous) and name-only sites not published; private addresses never contacted; robots.txt respected
- profiles and contacts: share buttons, web-agency links and other-domain emails excluded; no false removals when a site is down or the web is unreachable
- website news and careers pages: dated items only (from the item's own block), older items left out, expired and generic job links left out, NAV ads not counted twice
- summary: the at-a-glance line, including the revenue trend
- input formats, unfamiliar column or key names, and malformed numbers

## Web app

```bash
npm run dev        # http://localhost:3000
```

- **Look up:** any organisation number, with every fact linked to its source and a "Re-check registry" button that shows changes.
- **Batch results:** browse `out/envelopes.jsonl` with filters, export, and side-by-side compare of up to three companies.
- **How it works:** sources, rules and the current commit.

## Project layout

```
agent/run.ts       batch runner (the evaluator command)
agent/input.ts     input file parsing (txt, csv, jsonl, json, gz)
agent/profile.ts   per-company research (gather, then assemble), refresh diff, summary
agent/extract.ts   registry response → claims and evidence
agent/brreg.ts     HTTP client for the registers and NAV: concurrency, retries, budget, snapshots
agent/jobs.ts      NAV job feed index by employer organisation number
agent/website.ts   official website candidates, identity verification, profiles and contact links
agent/web.ts       safe fetcher for company websites: public-URL guard, robots.txt, limits
agent/types.ts     envelope schema
agent/test/        offline self-test and registry fixtures (fictitious companies)
scripts/           sample-batch.ts: random sample of real organisation numbers for smoke tests
server.ts, src/    web app
```
