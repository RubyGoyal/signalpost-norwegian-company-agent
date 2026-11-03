# Signalpost: Norwegian company profiles with evidence

Signalpost takes Norwegian organisation numbers and returns one result envelope per company. Each envelope holds the facts that the official Brønnøysund registers hold for that exact organisation number, the company's verified official website with the profiles it links to and its dated news posts, and its live job ads on NAV and on its own careers page. Every fact carries its source URL, where in the source it was found, the retrieval time, and the reporting period where one applies.

Built for the [Builderr Signalpost challenge](https://builderr.ai/challenges/signalpost).

## For reviewers

| | |
|---|---|
| Run it | `npm ci`, then `npx tsx agent/run.ts <input-file> out` (Node.js 22.12 or later). No AI model, no API keys, $0 per run. |
| Try it without installing | Live demo: [signalpost-g4p5.onrender.com](https://signalpost-g4p5.onrender.com). It runs on a free plan, so the first page after a pause can take up to a minute. |
| Full live run, 1,000 companies | The official command on GitHub's servers (3 November 2026, commit `0788c6e`): 1,000 of 1,000 envelopes `available`, 60,262 facts each with its evidence, all quality checks passed, 314 seconds. An immediate re-run flagged 1 change: a slow site found the second time. It can be repeated from the Actions tab ("Full live run"), in this repository or in a fork. |
| Accuracy | Claude's item-by-item cross-check of 52 published website items: 49 right, 2 wrong (both fixed), 1 can't tell. A hand check of the same items by a person is in progress. |
| Live QA | An outside QA agent (Momentic) tested the live demo and found 10 issues, all fixed. Its second run confirmed 9 of them; the tenth only shows when a source changes, and an offline test covers it. |
| Offline tests | 151 checks: `npm run check:signalpost` |

## What's new in version 5

Builderr's feedback on the latest run named three fixes and one way to go further. Each is now a rule in the agent and an offline test.

| Builderr's point | What the agent does now | Offline test |
|---|---|---|
| Jobs: only link a page that shows a live opening | Every job ad is opened before it is published, including ads listed in a careers page's structured data. The ad must name the job, must not say it is closed or that there are no openings, and must not send the reader back to a list. A careers page that says "No open positions" or "Ingen ledige stillinger" gives no openings at all, whatever old job data it carries, and the summary says so. "Finner du ingen ledige stillinger som passer?" next to real ads does not hide them. | A careers page saying "ingen ledige stillinger" with a stale posting; an ad page saying there is nothing open; an ad that redirects to the list; an open-application line next to real ads |
| Social: check the page is for this exact company | An account named after the bare brand is not used for a country arm, region or city unit ("Certego Norge AS", "Bondens Marked Vestfold SA"), on a site that says it is part of a group, or when the site names a holding or parent company with the brand. A link the site itself introduces as a group's or another company's ("Følg Kappa Gruppen på Facebook", also in icon labels) is never used. | A group's account for a country arm; a national body's account for a local unit; a group phrase on the site; a link labelled as the group's |
| News: only 1 item was found | More dated posts from the company's own verified site: posts shown on the homepage when there is no news page, and the site's feed at the standard address of the common site builders (WordPress `/feed/`, Wix `/blog-feed.xml`) when the site does not declare one. Every post still needs its publish date. A search of the press by company name was tested and left out on purpose (see "No press search" under the rules). | A dated "Siste nytt" card on the homepage (an undated card and a service page left out); an undeclared WordPress feed |
| Flag what is new | Every summary now has a "What's new" line right after "At a glance": every dated fact from the past 12 months, newest first, each with its evidence (registry changes, annual accounts filed with the revenue change on the year before, board and CEO changes, new locations, name changes, status flags, job ads, website news). When nothing is dated it says so. On a re-run, it also counts the changes since the last check, which keep the previous value and evidence. The web app highlights this line. | Order, evidence and wording of the line; the empty case; the count of changes on a re-run |

**On real sites** (1 November 2026, details in [`examples/live-test-v5-report.json`](examples/live-test-v5-report.json)): the new rules were run on 46 company websites that the agent verifies as the company's own.
- Jobs: two careers pages say "Vi har for tiden ingen ledige stillinger" (Indre Kåfjord school, FOD), and no jobs were taken from them. A staffing agency's list of its clients' vacancies and a group-wide list on Easycruit were not taken either.
- News: FOD's 10 posts came from its news page's feed at the standard WordPress address, which the site does not declare.
- Two news errors were found and fixed: a web shop's product feed read as news (lappeliten.no), and a homepage card dated by the day an office reopens instead of its publish date (treteam.no).
- Claude cross-checked a sample of 16 of these companies item by item: 49 of 52 items right. It found two more errors, both fixed: a sole proprietor's personal Instagram account published as the firm's (helleland.one), and Homely's live job ads missed because its Jobylon list is filled in by a script.
- The same sample is being checked by hand by a person (see "Hand check" under Tests).
- A full live run of the official command on 1,000 companies, on GitHub's servers, found three more problems on real sites, all fixed: a new site's "Hei, verden!" sample post read as news, a site that did not answer on a re-run reported as removed, and job ads reported as closed when the job list could not be read in time. On the third run, an immediate re-run flagged 1 change, down from 14 and 22 (see "Full live run on GitHub" under Tests).
- An outside QA agent tested the deployed web app end to end and found 10 issues (wording, a date shift on re-check, a citation, three older live ads, a broken link, phone layouts). All are fixed, and a second run on the fixed version confirmed 9 of them live; the tenth shows only when a source changes and is covered by an offline test (see "QA run on the live demo" under Tests).

## What's new in version 4

Builderr's audit of version 3 asked for four fixes. Each one is now a rule in the agent, an offline test, and a result on real company websites.

| Builderr's point | What the agent does now | Offline test | On real sites |
|---|---|---|---|
| The website must be the company's own, not a parent group or brand site | A website, registered or found, is published only when it shows this company's organisation number or exact name. Group, parent, manager, chain and brand sites are left out, with the reason given, and nothing on them is used. A registered page on a group's site is verified as that page only. | Group site naming several companies, chain site showing the chain's number, brand site, company page on a group site | 31 of the 108 websites registered for the 1,000-company sample are group, parent, manager, chain or brand sites (REMA 1000, OBOS, NorgesGruppen Eiendom and others) and are no longer published; 47 are verified as the company's own |
| Social links must match this company | An account is published only when its handle is the company's name, or the name of its own verified domain when no other company on the site has that name | Parent-group, sister-company, web-agency and theme accounts in a footer | National Red Cross accounts not used for Oslo Røde Kors; a parent's account on treteam.no left out |
| News must be real, dated posts | The publish date is read from the post's own block or the site's feed (`pubDate`, `published`); "updated" and "modified" dates are never used. Menu labels, archives, product pages and a shop's "Nyheter" are not news. | "Se flere nyheter", product card, updated-only dates, a neighbour's date, feed `<updated>` | Real dated posts kept (for example 5 on floya.no), product and menu links left out |
| Jobs must be single ads for this company | Only single ads count: NAV ads by organisation number, and ads whose hiring organisation (structured data or the ad's title) is this company. The careers landing page, NAV and FINN searches and the parent's vacancies are left out. | Careers landing page, FINN and NAV searches, a sister company's ad, the parent's posting, a closed ad | Homely's Jobylon ads found, with Homely as the employer |

Also new: staff members' own email addresses and phone numbers are no longer taken from websites (only role addresses such as post@ and the main number). Every `run-report.json` now has a `quality` section: what was published, what was left out and why, and checks that every claim has evidence and that nothing comes from an unverified website. Details of the real-site check are in [`examples/live-test-v4-report.json`](examples/live-test-v4-report.json).

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
  - `out/run-report.json`: counts by state, requests, runtime (p50/p95) and cost, plus a `quality` section (what was published and left out, and integrity checks; see below).
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
| | `SIGNALPOST_WEBSITE_BUDGET_MS` | 30000 | Time budget for one company's website step |
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
| `summary` | Starts with an "at a glance" line: organisation form, place, industry, employees, latest revenue and its change on the previous year, hiring, website. Next comes "What's new": every dated fact from the past 12 months, newest first. Then what the company does, size, people, locations, status, website and profiles, hiring, registry activity, website news, what changed, and what is unknown. Each statement links to its evidence. |
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
- **Public activity:** the registry's dated change log since 2025, for example "annual accounts filed: 2025", "employee count updated", "business address changed". Also dated posts from the verified website: its news page, the posts its homepage shows, and its own news feed.

## Rules the agent follows

- **Exact identity.** Every Brønnøysund register is queried by the exact organisation number, after a modulus-11 check, so facts cannot attach to a namesake, parent or subsidiary. NAV job ads and websites are attached only after their own evidence confirms the organisation number or the exact company (see below).
- **No invented values.** A value is published only if the register holds it. If a register cannot be reached after retries, that family is `failed` and has no claims. If the identity lookup fails, the company is `failed` with zero claims.
- **Missing is not zero.** An employee count is published only when the register says one is registered. Accounts figures are published only when present in the filing, and always with their reporting period.
- **Idempotent refresh.** Claim and evidence IDs come from content hashes, so re-running on the same data produces the same IDs and zero changes. Real changes record before and after values and keep the previous evidence. A source outage, an unreachable website or a skipped step never shows up as removed facts. A website published before that does not answer on a re-run is not published that day and is not reported as removed; it is reported only when a check shows the site is no longer the company's own or the register stops listing it. Its news posts are kept too, so they do not come back as "new" when the site answers again. Job ads from a careers page are reported as closed only when the careers page and every ad it leads to were read; if a job list or an ad could not be read, or the time budget ran out, the earlier openings are kept as they were.
- **Personal data minimisation.** Role holders' names are published (they are public register data). Birth dates are not. Job ad contact persons are never published, and contact details of sole proprietorships are left out.
- **Hiring by organisation number.** Every active NAV ad's detail record is read once per run and indexed by the employer's organisation number, so an ad posted under a brand name is still found and a namesake employer never matches. If that read cannot finish in its time budget, the remaining ads are picked by employer name and still confirmed by organisation number.
- **A website is a claim only after proof, even when the registry lists it.** Candidate sites (registered website, registered email domain, domains spelled from the legal name) are only guesses. A site is published as the company's own when it shows the company's organisation number, or when it carries the company's exact name and (for name-spelled domains) also the registered phone number or street address. Registries often list a parent group's, chain's or brand's site, so a registered website is not published when:
  - it shows another company's organisation number (a chain or parent site);
  - it presents several companies, by organisation number or by name (a group site naming this company among its members is `ambiguous`);
  - it shows neither this company's name nor its organisation number (a brand site);
  - it is parked, does not answer, or is a directory listing. A social page registered as the website is published as a profile instead.
  The reason is given in the availability and in the summary. A registered website that cannot be read this time (robots.txt, bot protection or an outage) is kept only when its domain carries the company's name. A registered address that is a page on a larger site (`group.no/companies/this-one`) is verified as that page, and nothing else on that domain (news, jobs, emails) is used.
- **Profiles only for this exact company.** Footer links often belong to the parent group, a sister company, the web agency or the website theme. A profile is published only when its handle is the company's legal name (give or take the legal form, a country word such as "norge", or digits), or the name of the company's own verified domain (its brand, as "agropumper" on agropumper.no). A long name may drop one word in its handle, but never its place or country word, so a national body's account is not a local unit's. The domain rule is not used for a sole proprietorship (its domain is usually the owner's name, so such an account is the owner's personal profile), on a page of someone else's site, for a domain with a group word, for a country arm, region or city unit ("Certego Norge AS" on certego.no), on a site that says it is part of a group, or when another company named on the site carries the brand ("Treteam AS", "Treteam Holding AS"). A handle that adds a group word or another name ("kappagruppen", "alpha-eiendom") is left out, and so is any link whose text or icon label names a group or another company. Share buttons and personal profiles are ignored.
- **Contacts without personal data.** Email links are taken only on the site's own domain and only for role addresses (post@, salg@, kundeservice@ and similar), never a staff member's own address. Only the site's main phone number is taken.
- **News means real, dated posts.** A post is published only with its publish date, read from the post's own block on the news page or the homepage (never a neighbour's), its structured data (`datePublished`), or the site's own feed (RSS `pubDate`, Atom `published`): the one it declares or, when it declares none, the standard address of the common site builders (WordPress `/feed/`, Wix `/blog-feed.xml`). Feed `lastBuildDate` and `<updated>` are never used, and comment feeds, product feeds and posts on other sites are left out. Dates marked as updated or modified (`dateModified`, "Oppdatert", "Sist endret", `class="updated"`) are never used as publish dates. Menu and paging links ("Se flere nyheter", "Alle artikler", "Nyhetsarkiv"), category, tag and archive pages, product pages, and a web shop's "Nyheter" page of new products are not news. Nor is the sample post a new site comes with (WordPress's "Hello world!", "Hei, verden!").
- **Jobs are single, live ads for this company.** A careers landing page is not a job. Openings come only from single ads: NAV ads matched by organisation number, ads on the company's career site at a recruiting platform, including the ads on a company's Jobylon list that its careers page links to (each ad is read and must name this company as the hiring organisation, in its structured data or, where there is none, in the ad's own title), and structured `JobPosting` data that links to its own ad and names this company. Every ad page is opened and must show a live opening: it names the job, does not say the position is closed or that there are no openings, and does not redirect back to a list. A careers page that says there are no open positions gives no openings at all. Search links (NAV, FINN), list pages, the parent's or a sister company's vacancies, open applications, and expired or undated postings are left out. A posting without an end date that is more than 120 days old is left out too, unless the employer's own live job list (Jobylon) still carries it: "apply as soon as possible" ads stay open for months.
- **No press search.** News comes only from the company's own verified website. A search of news media by company name was tested: the only free news search that runs without a key (GDELT) found nothing for Barnekreftforeningen, a well-known national charity, over six months, and the other test queries failed. Most companies in the register are small, so a name search would return little, and what it returned would include namesakes, which breaks the exact-identity rule. Paid news APIs need keys, and this agent needs none.
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
| Company-owned websites | The company's own homepage, up to three contact, about or terms pages, its news and careers pages, its news feed (declared, or at the standard address), and up to ten single job ads its careers page links to (on its own site or a recruiting platform such as Teamtailor, Jobylon, Webcruiter or Jobbnorge) | Public pages read once per run; [robots.txt](https://www.rfc-editor.org/rfc/rfc9309) honoured; only facts about the company itself are published |

**Registers and NAV.** Requests to these APIs go only to `data.brreg.no` and `pam-stilling-feed.nav.no`, over HTTPS. Any other host or a redirect off those hosts is refused in code (`ALLOWED_HOSTS` in `agent/brreg.ts`). Registry requests are rate-limited (default 8 concurrent) with retries and backoff on 429 and 5xx responses. Each company needs 5 or 6 registry requests: entity, roles, accounts, sub-units and change log.

**NAV job feed.** Read once per run, in the background while companies are researched: every entry modified in the last 60 days (about 120 pages), then the detail record of every active ad (about 9,000, by a separate client at 12 concurrent requests). Both steps are time-boxed. If the index is not ready, job postings are reported as `failed`, never guessed. `SIGNALPOST_JOBS=off` skips it, and job postings are then reported as not checked.

**Company websites: safe URL handling** (`agent/web.ts`). Because these hosts are not known in advance, every request passes a public-URL guard:
- Only `http` and `https`, default ports, and no credentials in the URL.
- The host must resolve, and every address must be public. Loopback, private, link-local (including cloud metadata addresses), carrier-grade NAT, multicast and reserved ranges are refused. This is checked again on every redirect hop (at most 4).
- `robots.txt` is honoured. A missing file allows access; one that cannot be fetched counts as a full disallow.
- Only HTML pages and the site's own news feed are read, at most 1.5 MB per page and 8 seconds per request. A company gets at most a few pages and 20 seconds in total.
- Social platforms, directory sites and FINN are never crawled.
- A start-of-run probe and a circuit breaker turn the step off if the public web is unreachable. It is then reported as not checked, never as "no website".
- Requests identify the agent with a `User-Agent` that links to this repository.

## Quality report in every run

`run-report.json` has a `quality` section, and stderr ends with `quality checks passed` (or the number of issues):
- **Checks** (all should be 0): claims without evidence in their envelope, evidence without a source URL, retrieval time or content hash, duplicate claim IDs, website facts in an envelope whose website is not verified, news posts without a publish date, website job ads without a hiring organisation, summary statements citing missing evidence, and failed envelopes with claims.
- **What was published:** claims by field family and by source class (official registry, official job board, company-owned), websites by how they were verified, and the profiles, dated news posts (and how many came from feeds), job ads, role email addresses and main phone numbers taken from company websites.
- **What was left out and why:** websites not published, counted by reason (for example `registered_website_belongs_to_another_entity`).

## Models, APIs, cost and secrets

- **Models:** none. No LLM or paid API is used; all sources are free public APIs.
- **Third-party cost per official run:** $0.
- **Caches:** no external cache. The only stored data is the local `.signalpost-state/` folder with each company's previous snapshot, used to detect changes on refresh. Delete it for a cold start.
- **Expected runtime:** about 5 minutes for 1,000 companies, website step included (314 seconds on a GitHub-hosted runner, 3 November 2026). Registry research and the website step run in parallel with the NAV read. `--deadline-seconds` guarantees a complete file within any budget.
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

**Live check of version 5 (1 November 2026):** the version 5 rules were re-run on the registered websites of the same 1,000 companies that version 4 publishes (63 sites; 46 verified as the company's own and read, 15 did not load).
- Jobs: 8 careers pages read. Two say there are no open positions (Indre Kåfjord school, FOD), and no jobs were taken from them; a staffing agency's clients' vacancies and a group-wide list were not taken either. Homely's page links only to its Jobylon list, which a script fills in, so no ads were taken; the cross-check below found live ads there, and the agent now reads such lists.
- Social: 44 accounts published. 11 were left out, for example a handle with a place word ("fodoslo") or a brand account on a site that names another company carrying the brand (Treteam AS). These rules leave out an account that may be right rather than publish a parent's.
- News: dated posts for 9 companies, including 10 from a feed found at the standard WordPress address.
- Found and fixed: a web shop's product feed read as news, and a homepage card dated by an office's reopening day instead of the post's publish date.

Details are in [`examples/live-test-v5-report.json`](examples/live-test-v5-report.json).

**Hand check:** a sample of the version 5 output is being checked by a person, not a model: 16 of the companies above (12 drawn at random, and 4 whose careers pages the agent read). For each website, social account, news post and job decision she opens the source and marks it right or wrong; accuracy by source type will be reported here. To draw such a sample from any run: `npx tsx scripts/handcheck-sample.ts out/envelopes.jsonl handcheck-sample.json 15`.

**Cross-check by Claude (2 November 2026):** the same 52 items were also checked by Claude, opening each source and reading it as a person would, without the agent's code. This is a model's check, kept separate from the hand check above.

| Source | Items | Right | Wrong | Can't tell |
|---|---|---|---|---|
| Site | 16 | 16 | 0 | 0 |
| Social | 11 | 10 | 1 | 0 |
| News | 18 | 18 | 0 | 0 |
| Jobs | 7 | 5 | 1 | 1 |

- Wrong, now fixed: a sole proprietor's private Instagram account, named after the owner like the firm's domain (only a handle with the whole business name counts for a sole proprietorship now); and Homely's live Jobylon ads, missed because a script fills in the list (the agent now reads the list's embed script, then each ad). On Homely's real ads, 3 of 6 were then published, and 3 older ads without an end date were left out by the 120-day freshness rule. The QA run below found those 3 still open, so an ad that the employer's own live list still carries is now published whatever its age.
- Can't tell: three of a staffing agency's vacancies name no employer, so they may be its own hires or its clients'. None are published.

Every verdict, with the evidence seen, is in [`examples/cross-check-v5.json`](examples/cross-check-v5.json).

**QA run on the live demo (2 November 2026):** Momentic's QA agent tested the deployed web app (Render, commit `a5508d7`) as a user would, with no access to the code: look-ups in every written form, three full profiles (Equinor, Flexiform, Homely) checked against their sources, one registry re-check each, batch filters, export and compare, the How it works page, direct links, Back and Forward, keyboard use and a 375 px phone screen. Look-up, batch results and direct navigation passed. It found 10 issues, all now fixed with offline tests where the agent was involved:

| Issue found | Fix |
|---|---|
| The Hiring tile showed an internal code ("checked nav no active ads last 60 days") | Every reason is shown in plain words ("Checked: no active NAV job ads (last 60 days)") |
| A re-check moved twelve Equinor registry events one day later and listed them as changes | The registry's nightly updates land just after midnight Norwegian time. Each event is now dated by its UTC day however the feed writes the time (Z, an offset or local time), and an event with the same update id and content is never reported as changed for a one-day difference |
| The summary's change list printed raw JSON | Every change is written in words ("new registry event: 2026-10-20: website changed: …") |
| The at-a-glance line cited only Enhetsregisteret for the revenue figure | The app now links every distinct source behind a sentence (here Enhetsregisteret, Regnskapsregisteret, the company website and NAV); the envelope already cited the accounts |
| Homely: 3 of the 6 ads on its live Jobylon list were left out | They were older than 120 days with no end date, yet still open. An ad the employer's own live list carries is now an opening whatever its age; its own page must still be live |
| The Regnskapsregisteret link on How it works returned 404 | Links the official dataset page on data.norge.no |
| Phone: the run command, the sources table and the compare table needed sideways scrolling | The command wraps, sources are listed one per block, and compare lists every company under each fact |

**Re-run on the fixed version (2 November 2026, commit `13bfedd`):** the same agent confirmed 9 of the 10 fixes on the live demo, with no new issues: plain hiring wording, Equinor's registry dates unchanged after a re-check (181 facts re-confirmed, no changes), the accounts cited for revenue, all 6 of Homely's live ads, a working accounts link, and the three phone layouts (compare also with three companies). The tenth, the change list in words, appears only when a source has changed, and nothing had changed between the two runs; the offline self-test covers it.

The first run also noted that a filter matching nothing showed an empty table (it now says so, with a button to clear the filters), and that the How it works page still described version 4 (now updated). The full list, with what was verified and what it could not check (NAV absence, social accounts behind a login), is in [`examples/qa-run-v5.json`](examples/qa-run-v5.json).

**Full live run on GitHub:** the repository's Actions tab has a "Full live run" workflow, started by hand. On GitHub's servers it installs with `npm ci`, runs the offline checks, runs the official command on real companies (by default the 1,000 in `examples/smoke-1000.txt`), runs it again to check that an immediate re-run reports no false changes, and saves the envelopes, run reports and logs for download. The run's page shows a summary: states, runtime, requests, quality checks, coverage by kind of fact, and what came from company websites. `npx tsx scripts/run-summary.ts out` prints the same summary for any local run.

Results of the three runs (2 and 3 November 2026; details in [`examples/full-run-v5-report.json`](examples/full-run-v5-report.json)):

| | Run 1 (`ffcba6e`) | Run 2 (`a44e21b`) | Run 3 (`0788c6e`) |
|---|---:|---:|---:|
| Envelopes `available` | 1,000 of 1,000 | 1,000 of 1,000 | 1,000 of 1,000 |
| Facts, all with evidence | 60,254 | 60,253 | 60,262 |
| Quality checks | all passed | all passed | all passed |
| Runtime | 312 s | 299 s | 314 s |
| Requests (registry / NAV / websites) | 5,003 / 8,383 / 2,790 | 5,003 / 8,400 / 2,862 | 5,003 / 8,249 / 2,921 |
| Website checks that could not finish | 36 | 32 | 14 |
| Changes flagged by an immediate re-run | 14 | 22 | 1 |

- Coverage in run 3, by companies: legal identity, status and group structure 100%; address, industry and roles 99.6%; annual accounts 99.9%; sub-units 75%; contact points 39.1%; employee count 14.8% (most small companies register none); verified or registered official website 12.6%; company-owned profiles 4.5% (81 accounts); dated news from the company's own site for 19 companies (114 posts); job ads for 4 companies.
- Found and fixed between runs: a new site's "Hei, verden!" sample post read as news (run 1); a verified site that did not answer on the re-run reported as removed (run 1); Homely's 6 careers-page openings reported as closed on the re-run, because its job list could not be read in time (run 2). The website step's time budget per company also went from 20 to 30 seconds, which cut checks that ran out of time from 24 to 6.
- The one change left in run 3 is a site that answered slowly the first time and was found on the re-run. That is a real addition, not a false change.
- Run 1's re-run also dropped a registered website (clemenskraft.no) that the first pass could not read in time and kept as registered. The re-run read it: it shows a different company's organisation number, so dropping it was right.

To smoke-test against the live registry on a random sample of real companies:

```bash
npx tsx scripts/sample-batch.ts 100 examples/smoke-100.txt
npx tsx agent/run.ts examples/smoke-100.txt out
```

The offline self-test (151 checks) runs against simulated registry, NAV and company-website responses. It covers:
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
- news: dated posts only, with the publish date from the post's own block or the site's feed (`pubDate`, Atom `published`, never `<updated>`); "Se flere nyheter", archive, product cards, a shop's new-products page, modified-only dates and a neighbour's date left out
- jobs: single ads only, with the hiring organisation checked (structured data or the ad's title); the careers landing page, FINN and NAV searches, a sister company's ad, the parent's posting, closed ads, postings without an employer or their own ad page, and expired postings left out
- live openings only (Builderr's feedback on the latest run): a careers page saying "ingen ledige stillinger" with old job data, an ad page saying there is nothing open, an ad redirecting to the list; an open-application line next to real ads does not hide them
- profiles for this exact company: a group's bare-brand account for a country arm, a national body's account for a local unit, brand accounts on a site that says it is part of a group, a link labelled as the group's
- more news from the company's own site: a dated post on the homepage, an undeclared WordPress feed; a shop's product feed and a card whose date disagrees with the date in its own address are not news
- summary: the at-a-glance line, including the revenue trend, and the "What's new" line (order, evidence, the empty case, changes on a re-run); the change list in words, never raw JSON
- the QA run's cases: a registry update written with a Norwegian time offset keeps its day and is not a change; an old ad on the employer's live Jobylon list is an opening, and one whose page says it is closed is not
- the full live run's cases: a new site's "Hei, verden!" sample post is not news; a verified site that stops answering on a re-run is not reported as removed, and when it answers again neither it nor its news shows up as new; a job list that cannot be read on a re-run does not close its openings
- run report: the quality section passes on every fixture and catches a claim with missing evidence or website facts without a verified website
- input formats, unfamiliar column or key names, and malformed numbers

## Web app

**Live demo:** [signalpost-g4p5.onrender.com](https://signalpost-g4p5.onrender.com) (free plan, so the first page after a pause can take up to a minute).

**Online, no install, your own copy:** [deploy it on Render's free plan](https://render.com/deploy?repo=https://github.com/RubyGoyal/signalpost-norwegian-company-agent) (`render.yaml`). The build runs the agent on the 10 sample companies, so the Batch results page has data. A free service sleeps when unused, and its first page after a pause can take up to a minute.

**On your own computer:**

```bash
npm run dev        # http://localhost:3000
```

- **Look up:** any organisation number, with every fact linked to its source and a "Re-check registry" button that shows changes.
- **Batch results:** browse `out/envelopes.jsonl` with filters, export, and side-by-side compare of up to three companies.
- **How it works:** sources, rules and the current commit.

## License

The code is released under the [MIT License](LICENSE). The data the agent collects keeps its own terms: the Brønnøysund registers under [NLOD 2.0](https://data.norge.no/nlod/en/2.0), NAV job ads under the [NAV API terms](https://arbeidsplassen.nav.no/vilkar-api), and company websites as their owners publish them (see "Sources, rights and outbound policy").

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
