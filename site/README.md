# Signalpost site data

JSON files made from the Signalpost agent's output for a website where people find a Norwegian company, open it, compare two, and check where every fact came from. They are rebuilt every day by the "Site data" workflow (`.github/workflows/site-data.yml`) and published on the `site-data` branch:

- `https://raw.githubusercontent.com/RubyGoyal/signalpost-norwegian-company-agent/site-data/index.json`
- `https://raw.githubusercontent.com/RubyGoyal/signalpost-norwegian-company-agent/site-data/companies/<orgnr>.json`

The files can be read straight from a browser (`Access-Control-Allow-Origin: *`; cached for five minutes). The companies are listed in `site/companies.txt`. To build the same files from any run: `npx tsx scripts/site-data.ts out/envelopes.jsonl site-out`.

## index.json

One light row per company, for search, lists and the compare picker.

| Field | Meaning |
|---|---|
| `generated_at`, `commit`, `run_id`, `repository` | When and from which version of the agent the data was made |
| `count` | Number of companies |
| `company_url` | `companies/{orgnr}.json`, relative to `index.json` |
| `companies[]` | `orgnr`, `name`, `form` (e.g. `AS`), `status` (`active`, `bankrupt`, ...), `municipality`, `industry`, `employees` (number or `null` when none is registered: never show it as 0), `revenue` (`{ amount, currency, year, display }` or `null`), `website`, `profiles`, `news`, `jobs` (counts), `facts` (number of facts), `glance` (one sentence about the company) |

## companies/&lt;orgnr&gt;.json

| Field | Meaning |
|---|---|
| `orgnr`, `name`, `form` (`{ code, description }`), `status`, `checked_at` | Who the company is, and when the agent checked it |
| `summary[]` | Sentences about the company: `kind` (`glance`, `new`, `fact`, `changes`, `unknowns`), `text`, and `sources[]` (`label`, `url`) behind the sentence. `glance` is the one-line summary; `new` lists what is new in the past 12 months, newest first. |
| `key_facts[]` | The same 16 facts for every company, in the same order, for side-by-side comparison: `key`, `label`, `value` (display text, or `null` when there is none), optional `link`, and `sources[]`. Keys: `organisation_form`, `founded`, `address`, `industry`, `employees`, `revenue`, `result`, `equity`, `ceo`, `chair`, `auditor`, `website`, `profiles`, `jobs`, `news`, `sub_units`. `value` is `null` when the register holds nothing (show "Not registered"); the count facts (`profiles`, `jobs`, `news`, `sub_units`) say "None found" instead. |
| `sections[]` | Every fact, by kind: `key`, `title`, `state` (`found`, `none`, `unclear`, `failed`), `note` (why there is nothing, in plain words, when there are no facts), and `facts[]`. |
| `sections[].facts[]` | `label`, `value` (display text), optional `link` (the website, profile, post or ad itself), `as_of` (date the source gives, or `null`), `period` (reporting period for accounts, or `null`), and `sources[]`. |
| `sources[]` (on every fact) | `label` (for example "Enhetsregisteret (entity register)", "Regnskapsregisteret (annual accounts)", "Company website"), `url` (opens the source), `retrieved_at`, and `where`: where the value sits in the source (the field in the register's data, such as `$.antallAnsatte`, or the text or link on the web page). |
| `changes` | `since` (the previous check), `baseline` (`cold_start` or `previous_run`), `unchanged_facts`, and `items[]` (`label`, `type`: `new`, `changed` or `removed`, `before`, `after`, `detected_at`). |
| `sources_consulted[]` | Every source read for the company: `label`, `url`, `retrieved_at`, `ok`. |
| `fact_count` | Number of facts |

Data: Brønnøysundregistrene's open APIs (NLOD 2.0), NAV's job feed, and each company's own verified website.
