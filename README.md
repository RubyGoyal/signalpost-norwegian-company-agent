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
| `--max-requests` | `SIGNALPOST_MAX_REQUESTS` | 8000 | Hard cap on outbound requests per run |
| `--deadline-seconds` | `SIGNALPOST_DEADLINE_SECONDS` | off | At this time, unfinished companies are written as `failed`, so no row is ever missing |
| `--state-dir` | `SIGNALPOST_STATE_DIR` | `.signalpost-state` | Previous snapshots used for refresh |
| `--run-id` | `SIGNALPOST_RUN_ID` | timestamp | Run identifier written into every envelope |

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
- Legal identity
- Registered and postal address
- Industry: NACE codes, sector and registered purpose
- Employees
- Status flags: bankruptcy, liquidation, forced dissolution, deletion
- Roles: CEO, board, auditor, accountant and others
- Locations: active sub-units with address and employees
- Annual accounts: revenue, operating profit, profit before tax, annual result, assets, equity, liabilities, audited flag
- Official website
- Group structure

Job postings and public activity are marked `not_checked_in_this_version`.

## Rules the agent follows

- **Exact identity.** Every source is queried by the exact organisation number, after a modulus-11 check, so facts cannot attach to a namesake, parent or subsidiary.
- **No invented values.** A value is published only if the register holds it. If a register cannot be reached after retries, that family is `failed` and has no claims. If the identity lookup fails, the company is `failed` with zero claims.
- **Missing is not zero.** An employee count is published only when the register says one is registered. Accounts figures are published only when present in the filing, and always with their reporting period.
- **Idempotent refresh.** Claim and evidence IDs come from content hashes, so re-running on the same data produces the same IDs and zero changes. Real changes record before and after values and keep the previous evidence. A source outage never shows up as removed facts.
- **Personal data minimisation.** Role holders' names are published (they are public register data). Birth dates are not.

## Sources, rights and outbound policy

| Source | Endpoint | Licence |
|---|---|---|
| Enhetsregisteret (entities) | `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}` | [NLOD 2.0](https://data.norge.no/nlod/en/2.0) |
| Enhetsregisteret (roles) | `https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}/roller` | NLOD 2.0 |
| Enhetsregisteret (sub-units) | `https://data.brreg.no/enhetsregisteret/api/underenheter?overordnetEnhet={orgnr}` | NLOD 2.0 |
| Regnskapsregisteret (accounts) | `https://data.brreg.no/regnskapsregisteret/regnskap/{orgnr}` | NLOD 2.0 |

- The agent makes outbound requests only to `data.brreg.no`. It identifies itself with a `User-Agent` that links to this repository.
- Requests are rate-limited (default 8 concurrent) with retries and backoff on 429 and 5xx responses.
- Each company needs 4–5 requests: one entity lookup, plus roles, accounts and one or more sub-unit pages.

## Models, APIs, cost and secrets

- **Models:** none. This version is registry-only and uses no LLM or paid API.
- **Third-party cost per official run:** $0.
- **Secrets:** none required. No keys are read, stored or logged. `.env*` files are git-ignored.
- **Dependencies:** pinned in `package-lock.json`, installed with `npm ci`. Runtime: `tsx` (MIT). Web app: `express`, `react`, `vite`, `tailwindcss`, `lucide-react` (MIT / ISC).

## Tests

```bash
npm run test:agent
```

This is an offline self-test (33 checks) against simulated registry responses. It covers:
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
server.ts, src/    web app
```
