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
- **Official website:** the company's own website: the one registered in Enhetsregisteret, or one found through the registered email domain or a domain spelled from the legal name. It is published only after the site proves it is this company's own, not a parent group's, chain's or brand's site (see rules).
- **Company-owned profiles:** LinkedIn, Facebook, Instagram, X, YouTube and TikTok accounts that the verified website links to and whose handle is this company's name (or that the company registered as its website)
- Contact points: registered company email and phone, plus role email addresses (post@, salg@ ...) and the main phone number from the verified website's own domain (never staff members' own details, and nothing for sole proprietorships)
- Group structure
- **Hiring:** active job ads from NAV's job vacancy feed (arbeidsplassen.no), attached when the ad's employer organisation number is the company or one of its registered sub-units (including ads posted under a brand name). Also single job ads linked from the verified website's careers page, when the ad names this company as the hiring organisation.
- **Public activity:** the registry's dated change log since 2025, for example "annual accounts filed: 2025", "employee count updated", "business address changed". Also dated posts from the verified website's news page.

## Rules the agent follows

- **Exact identity.** Every Brønnøysund register is queried by the exact organisation number, after a modulus-11 check, so facts cannot attach to a namesake, parent or subsidiary. NAV job ads and websites are attached only after their own evidence confirms the organisation number or the exact company (see below).
- **No invented values.** A value is published only if the register holds it. If a register cannot be reached after retries, that family is `failed` and has no claims. If the identity lookup fails, the company is `failed` with zero claims.
- **Missing is not zero.** An employee count is published only when the register says one is registered. Accounts figures are published only when present in the filing, and always with their reporting period.
- **Idempotent refresh.** Claim and evidence IDs come from content hashes, so re-running on the same data produces the same IDs and zero changes. Real changes record before and after values and keep the previous evidence. A source outage, an unreachable website or a skipped step never shows up as removed facts.
- **Personal data minimisation.** Role holders' names are published (they are public register data). Birth dates are not. Job ad contact persons are never published, and contact details of sole proprietorships are left out.
- **Hiring by organisation number.** Every active NAV ad's detail record is read once per run and indexed by the employer's organisation number, so an ad posted under a brand name is still found and a namesake employer never matches. If that read cannot finish in its time budget, the remaining ads are picked by employer name and still confirmed by organisation number.
- **A website is a claim only after proof, even when the registry lists it.** Candidate sites (registered website, registered email domain, domains spelled from the legal name) are only guesses. A site is published as the company's own when it shows the company's organisation number, or when it carries the company's exact name and (for name-spelled domains) also the registered phone number or street address. Registries often list a parent group's, chain's or brand's site, so a registered website is not published when:
  - it shows another company's organisation number (a chain or parent site);
  - it presents several companies, by organisation number or by name (a group site naming this company among its members is `ambiguous`);
  - it shows neither this company's name nor its organisation number (a brand site);
  - it is parked, does not answer, or is a directory listing. A social page registered as the website is published as a profile instead.
  The reason is given in the availability and in the summary. A registered website that cannot be read this time (robots.txt, bot protection or an outage) is kept only when its domain carries the company's name. A registered address that is a page on a larger site (`group.no/companies/this-one`) is verified as that page, and nothing else on that domain (news, jobs, emails) is used.
- **Profiles only when the handle is this company's name.** Footer links often belong to the parent group, a sister company, the web agency or the website theme. A profile is published only when its handle is the company's legal name (give or take the legal form, a country word such as "norge", or digits), or the name of the company's own verified domain (its brand, as "agropumper" on agropumper.no). The domain rule is not used on a page of someone else's site, for a domain with a group word, or when another company named on the site has that name. A handle that adds a group word or another name ("kappagruppen", "alpha-eiendom") is left out. Share buttons and personal profiles are ignored.
- **Contacts without personal data.** Email links are taken only on the site's own domain and only for role addresses (post@, salg@, kundeservice@ and similar), never a staff member's own address. Only the site's main phone number is taken.
- **News means real, dated posts.** A post is published only with its publish date, read from the post's own block on the news page (never a neighbour's) or its structured data. Dates marked as updated or modified (`dateModified`, "Oppdatert", "Sist endret", `class="updated"`) are never used as publish dates. Menu and paging links ("Se flere nyheter", "Alle artikler", "Nyhetsarkiv"), category, tag and archive pages, product pages, and a web shop's "Nyheter" page of new products are not news.
- **Jobs are single ads for this company.** A careers landing page is not a job. Openings come only from single ads: NAV ads matched by organisation number, ads on the company's career site at a recruiting platform (each ad is read and must name this company as the hiring organisation, in its structured data or, where there is none, in the ad's own title; closed ads are left out), and structured `JobPosting` data that links to its own ad and names this company. Search links (NAV, FINN), list pages, the parent's or a sister company's vacancies, open applications and expired or undated postings are left out.
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
| Company-owned websites | The company's own homepage, up to three contact, about or terms pages, its news and careers pages, and up to four single job ads its careers page links to on a recruiting platform (Teamtailor, Webcruiter, Jobbnorge and similar) | Public pages read once per run; [robots.txt](https://www.rfc-editor.org/rfc/rfc9309) honoured; only facts about the company itself are published |

**Registers and NAV.** Requests to these APIs go only to `data.brreg.no` and `pam-stilling-feed.nav.no`, over HTTPS. Any other host or a redirect off those hosts is refused in code (`ALLOWED_HOSTS` in `agent/brreg.ts`). Registry requests are rate-limited (default 8 concurrent) with retries and backoff on 429 and 5xx responses. Each company needs 5 or 6 registry requests: entity, roles, accounts, sub-units and change log.

**NAV job feed.** Read once per run, in the background while companies are researched: every entry modified in the last 60 days (about 120 pages), then the detail record of every active ad (about 9,000, by a separate client at 12 concurrent requests). Both steps are time-boxed. If the index is not ready, job postings are reported as `failed`, never guessed. `SIGNALPOST_JOBS=off` skips it, and job postings are then reported as not checked.

**Company websites: safe URL handling** (`agent/web.ts`). Because these hosts are not known in advance, every request passes a public-URL guard:
- Only `http` and `https`, default ports, and no credentials in the URL.
- The host must resolve, and every address must be public. Loopback, private, link-local (including cloud metadata addresses), carrier-grade NAT, multicast and reserved ranges are refused. This is checked again on every redirect hop (at most 4).
- `robots.txt` is honoured. A missing file allows access; one that cannot be fetched counts as a full disallow.
- Only HTML is read, at most 1.5 MB per page and 8 seconds per request. A company gets at most a few pages and 20 seconds in total.
- Social platforms, directory sites and FINN are never crawled.
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

**Live check of this version's website rules (23 October 2026, after Builderr's audit of version 3):** every website registered in Enhetsregisteret for the same 1,000 companies (108) was checked with the agent's own code, loaded from GitHub at the tested commit and run on each company's site.
- Version 3 published all of them as the company's website. This version publishes 47 that it verifies as the company's own (by organisation number or exact name) and keeps one it cannot read whose domain carries the company name.
- 31 are group, parent, manager, chain or brand sites and are no longer published: REMA 1000's site for a REMA store, Baker Hansen's for its franchisee, OBOS, USBL, Vestbo and other housing managers' sites for housing co-ops, and parents' sites such as NorgesGruppen Eiendom, Ragde Eiendom and AVA Eiendom. Nothing from them (social links, news, jobs) is used. Nine more are empty, parked, closed or unrelated pages.
- Oslo Røde Kors is verified as its own page on rodekors.no, and the national Red Cross accounts are not used.
- Fixed from this check: two own sites that were missed, brand accounts named after the company's own domain, Jobylon ads without structured data, and staff members' personal email addresses and phones (only role addresses and the main number are published now).

Details are in [`examples/live-test-v4-report.json`](examples/live-test-v4-report.json).

**Live test of version 3 (22 October 2026, same 1,000 companies):**
- **Registry research:** 1,000 of 1,000 envelopes `available`, 0 integrity issues, 183 s. An immediate re-run detected 0 changes and produced identical claim IDs.
- **Hiring:** all 9,275 active NAV ads were read and indexed in about 4 minutes. The companies with active ads went from 1 to 3, and the attached ads from 1 to 5, including ads posted under brand names.
- **Websites:** the check was run on real company sites:
  - Five were verified: by organisation number, by the company name on the homepage, or by the full legal name in the footer.
  - A "Coming Soon" placeholder and a group brand site (coop.no for a Coop entity) were correctly not published.
  - The verified site that has profile links yielded its Facebook, Instagram and LinkedIn pages.
- **Website news and careers pages:** the check was run on five more real sites. CERTEGO's news page gave 10 dated items since 2025, and three sites gave their careers page and their LinkedIn, Facebook and YouTube pages. A holding company whose registered site shows its operating company's number was not verified. Two problems this check found were fixed: pages about working at the company were counted as openings, and an article was read as the news page.
- **Candidates in the sample:** 108 companies register a website. Another 113 can be checked through their registered email domain, and 880 through domains spelled from their name.

Details of that test are in [`examples/live-test-v3-report.json`](examples/live-test-v3-report.json).

To smoke-test against the live registry on a random sample of real companies:

```bash
npx tsx scripts/sample-batch.ts 100 examples/smoke-100.txt
npx tsx agent/run.ts examples/smoke-100.txt out
```

The offline self-test (119 checks) runs against simulated registry, NAV and company-website responses. It covers:
- one row per input, and a deadline close-out
- failure handling with no invented values
- unknown and deleted numbers, and an invalid checksum
- missing-not-zero rules
- evidence integrity
- idempotent re-runs, real change detection, and no false removals during an outage
- job ads: namesake employers rejected, brand-name ads found by organisation number, inactive ads removed, NAV outage handled
- websites: verified by organisation number or by name plus registered address; namesake, parked, group (ambiguous) and name-only sites not published; private addresses never contacted; robots.txt respected
- the website must be the company's own (Builderr's audit of version 3): a registered group site that names several companies, a chain site showing the chain's organisation number and a brand site showing neither name nor number are not published, and nothing is read from them; a company's page on its group's site is verified as that page only; a registered site behind bot protection is kept only when its domain carries the company's name
- profiles: only handles that are the company's name or its own domain's; the parent group's, a sister company's, the web agency's and the theme's accounts and share buttons left out; no false removals when a site is down or the web is unreachable
- contacts: role addresses and the main phone number only; a staff member's own email and phone left out
- the live check's cases: a title naming the company only as a whole, a thin homepage on the company's name domain, a front page redirecting deeper on the same site
- news: dated posts only, with the publish date from the post's own block; "Se flere nyheter", archive, product cards, a shop's new-products page, modified-only dates and a neighbour's date left out
- jobs: single ads only, with the hiring organisation checked (structured data or the ad's title); the careers landing page, FINN and NAV searches, a sister company's ad, the parent's posting, closed ads, postings without an employer or their own ad page, and expired postings left out
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
