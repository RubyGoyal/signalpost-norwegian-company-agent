# Signalpost — Norwegian company profiles with evidence

Signalpost takes Norwegian organisation numbers and returns one result envelope per company. Each envelope holds the facts that the official Brønnøysund registers hold for that exact organisation number. Every fact carries its source URL, the JSON field it came from, the retrieval time, and the reporting period where one applies.

Built for the [Builderr Signalpost challenge](https://builderr.ai/challenges/signalpost).

## Run it

Requires Node.js 22.12 or later.

```bash
npm ci
npx tsx agent/run.ts <input-file> out
```

- **Input:** a file of organisation numbers in `.txt`, `.csv`, `.jsonl` or `.json` format, optionally `.gz`. JSON records may use `organisation_number`, `organisasjonsnummer`, `orgnr`, `org_number` or `organizationNumber`. Header rows are skipped, spaces inside numbers are removed, and duplicates are merged.
- **Output:**
  - `out/envelopes.jsonl`: exactly one terminal envelope per input organisation number, in input order.
  - `out/run-report.json`: counts by state, requests, runtime (p50/p95) and cost.
- **Stdout:** a single JSON line summarising the run. Progress goes to stderr.
- **Shortcut:** numbers can be passed directly, for example `npx tsx agent/run.ts 923609016,984851006 out`.

Optional flags and environment variables:

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `--concurrency` | `SIGNALPOST_CONCURRENCY` | 8 | Parallel registry requests |
| `--max-requests` | `SIGNALPOST_MAX_REQUESTS` | 20000 | Hard cap on outbound requests per run |
| `--deadline-seconds` | `SIGNALPOST_DEADLINE_SECONDS` | off | At this time, unfinished companies are written as `failed`, so no row is ever missing |
| `--state-dir` | `SIGNALPOST_STATE_DIR` | `.signalpost-state` | Previous snapshots used for refresh |
| `--run-id` | `SIGNALPOST_RUN_ID` | timestamp | Run identifier written into every envelope |
| `--jobs` | `SIGNALPOST_JOBS` | on | `off` skips the NAV job feed |
| `--jobs-days` | `SIGNALPOST_JOBS_DAYS` | 60 | How many days of NAV job feed to read |

## What each envelope contains

| Part | Contents |
|---|---|
| `organisation_number`, `input_index`, `state` | Overall state: one of `available`, `not_available`, `blocked`, `not_applicable`, `ambiguous`, `failed` |
| `legal_identity` | Legal name, organisation form and registry status, matched on the exact organisation number |
| `availability` | State and reason per field family (see below). A source that was checked and returned nothing is distinguished from one that was not checked. |
| `claims` | One per fact: `field`, `value`, `unit`, `reporting_period`, `source_date`, `retrieved_at`, `evidence_ids` |
| `evidence` | Source URL, JSON path (`claim_span`), retrieval time, SHA-256 of the source response, reporting period |
| `source_snapshots` | Every registry request: URL, HTTP status, retrieval time, content hash, licence |
| `summary` | What the company does, its size, people, locations, status, what changed and what is unknown. Each statement links to its evidence. |
| `refresh` | `cold_start` or `previous_run`, plus changes (`new_value`, `changed_value`, `removed_value`) with before and after values and the previous evidence |
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
- Official website (as registered)
- Contact points: registered company email and phone (never published for sole proprietorships)
- Group structure
- **Hiring:** active job ads from NAV's job vacancy feed (arbeidsplassen.no), attached only when the ad's employer organisation number is the company or one of its registered sub-units
- **Public activity:** the registry's dated change log since 2025, for example "annual accounts filed: 2025", "employee count updated", "business address changed"

## Rules the agent follows

- **Exact identity.** Every source is queried by the exact organisation number, after a modulus-11 check, so facts cannot attach to a namesake, parent or subsidiary.
- **No invented values.** A value is published only if the register holds it. If a register cannot be reached after retries, that family is `failed` and has no claims. If the identity lookup fails, the company is `failed` with zero claims.
- **Missing is not zero.** An employee count is published only when the register says one is registered. Accounts figures are published only when present in the filing, and always with their reporting period.
- **Idempotent refresh.** Claim and evidence IDs come from content hashes, so re-running on the same data produces the same IDs and zero changes. Real changes record before and after values and keep the previous evidence. A source outage never shows up as removed facts.
- **Personal data minimisation.** Role holders' names are published (they are public register data). Birth dates are not. Job ad contact persons are never published, and contact details of sole proprietorships are left out.
- **Name matching is never evidence.** Job ads are found by employer name only to pick candidates; each one is attached only after its detail record confirms the employer organisation number. A namesake employer is rejected.
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

- The agent makes outbound requests only to `data.brreg.no` and `pam-stilling-feed.nav.no`. Any other host, non-HTTPS URL or redirect off those hosts is refused in code (`ALLOWED_HOSTS` in `agent/brreg.ts`). It identifies itself with a `User-Agent` that links to this repository.
- Requests are rate-limited (default 8 concurrent) with retries and backoff on 429 and 5xx responses.
- Each company needs 5–7 requests: entity, roles, accounts, sub-units, change log, plus one NAV detail request per candidate job ad (capped at 15).
- The NAV job feed is read once per run: every entry modified in the last 60 days (about 120 pages, about 2 minutes), time-boxed so a slow feed cannot stall the run. `SIGNALPOST_JOBS=off` skips it, and job postings are then reported as not checked.

## Models, APIs, cost and secrets

- **Models:** none. No LLM or paid API is used; all sources are free public APIs.
- **Third-party cost per official run:** $0.
- **Secrets:** none required. NAV's job feed uses its published public token, fetched at run time from `https://pam-stilling-feed.nav.no/api/publicToken`; a NAV-issued token can be supplied instead with `SIGNALPOST_NAV_TOKEN`. No keys are stored or logged. `.env*` files are git-ignored.
- **Dependencies:** pinned in `package-lock.json`, installed with `npm ci`. Runtime: `tsx` (MIT). Web app: `express`, `react`, `vite`, `tailwindcss`, `lucide-react` (MIT / ISC).

## Tests

```bash
npm run test:agent
```

**Live smoke test (17 October 2026):** 100 randomly sampled real companies, all 100 envelopes `available`, 0 source errors, 0 integrity issues, 5,292 claims, 400 requests, 19 s, $0. An immediate re-run on the same companies detected 0 changes. Details are in [`examples/smoke-100-report.json`](examples/smoke-100-report.json), with the sample in `examples/smoke-100.txt`.

**v2 live smoke test (same 100 companies):** hiring, public activity and the new registry fields. Public activity was found for 89 of 100 companies (243 dated events), group membership for 100, latest filed accounts year for 92, share capital for 86, contact points for 63 and former names for 50. One company had a confirmed active NAV job ad, matched through its sub-unit's organisation number. 0 integrity issues; an immediate re-run detected 0 changes. Details are in [`examples/smoke-100-v2-report.json`](examples/smoke-100-v2-report.json).

To smoke-test against the live registry on a random sample of real companies:

```bash
npx tsx scripts/sample-batch.ts 100 examples/smoke-100.txt
npx tsx agent/run.ts examples/smoke-100.txt out
```

This is an offline self-test (55 checks) against simulated registry responses. It covers:
- one row per input, and a deadline close-out
- failure handling with no invented values
- unknown and deleted numbers, and an invalid checksum
- missing-not-zero rules
- evidence integrity
- idempotent re-runs, real change detection, and no false removals during an outage

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
agent/profile.ts   per-company research, refresh diff, summary
agent/extract.ts   registry response → claims and evidence
agent/brreg.ts     HTTP client: concurrency, retries, budget, snapshots
agent/types.ts     envelope schema
agent/test/        offline self-test and registry fixtures (fictitious companies)
scripts/           sample-batch.ts: random sample of real organisation numbers for smoke tests
server.ts, src/    web app
```
