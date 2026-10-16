# Signalpost — Norwegian Company Intelligence Agent & Batch Workbench

Signalpost is an autonomous research agent and batch verification workbench that takes any 9-digit Norwegian organization number (`organisasjonsnummer`), queries official Brønnøysundregistrene public registries alongside Gemini Search Grounding, and produces strictly verified, evidence-backed company profiles ready for the Builderr Signalpost challenge.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and product choices reflect your confirmed preferences and the strict qualification rules of the Signalpost challenge:

- **Confirmed Experience Scope**: Full Agent Workbench, Batch Runner (1,000+ company profiles), Daily 100-Company Benchmark Simulator, and Builderr Submission Packager.
- **Confirmed Data & Verification Pipeline**: Hybrid retrieval combining live **Brønnøysundregistrene Open APIs** (`Enhetsregisteret`, `Roller`, and `Regnskapsregisteret`) for deterministic registry/financial truth with server-side **Gemini Search Grounding** (`gemini-3.8-flash` with `googleSearch` and `urlContext`) for current web facts, leadership updates, products, and timestamped source links.
- **Confirmed Qualification Guardrails**: Strict entity-match guardrails (preventing subsidiary/parent or namesake confusion via 9-digit organization number and legal name cross-checking) and a zero-fabrication financial verifier that only publishes accounting figures backed by official `Regnskapsregisteret` filings or verbatim grounded citations.
- **Default Execution Budget Policy**: Enforces hard caps well inside the challenge's daily limits (45 minutes runtime, 2,000 outbound requests, $10.00 external API cost) by budgeting at most 3–5 outbound requests and ~$0.002–$0.008 in Gemini token/search costs per company.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. **Single-Company Deep Research Agent**: Accepts any 9-digit Norwegian `organisasjonsnummer` (or company name query to resolve an organization number), fetches official registry records, runs grounded web discovery, verifies entity alignment and financial accuracy, and outputs a structured profile where every single fact is paired with a source URL, publication/retrieval date, confidence level, and human-readable explanation.
  2. **1,000+ Company Batch Corpus Builder & Profile Manager**: Seeds and maintains a live corpus of 1,000+ real Norwegian companies retrieved directly from Brønnøysundregistrene (`data.brreg.no`), supports incremental delta updates (detecting changed registry fields or newer web facts), and exports the complete verified dataset in JSON/JSONL format.
  3. **Daily 100-Company Evaluation Simulator**: Runs or simulates the daily 100-company test under real challenge constraints, scoring Coverage (35 pts), Evidence Matching (30 pts), Update Freshness (20 pts), Explanation Quality (10 pts), and Usability (5 pts) while tracking live outbound HTTP requests (limit: 2,000), elapsed runtime (limit: 45 min), and declared API cost (limit: $10.00).
  4. **Submission & JBOX Packager**: Generates the complete submission bundle required for `submit@builderr.ai`, including the 1,000+ profile artifact export, one-command execution runner, model/API cost manifest, and repository commit metadata.
- **Target Audience / Persona**: Challenge participants, corporate intelligence engineers, and evaluators testing high-precision Norwegian entity profiling under strict anti-fabrication and cost budgets.
- **Key Value**: Eliminates the two disqualifying failure modes—wrong-company fact attribution and hallucinated financials—while maximizing coverage across official registries and live public web sources.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Inspect & Run Agent (Agent Workbench)**: The user enters a 9-digit Norwegian organization number (e.g., `923609016` for Equinor ASA, `984851006` for DNB Bank ASA, `914778271` for Kahoot! ASA, or any custom number) or selects from a curated quick-pick bar. The agent streams its 4-stage pipeline: (1) Official Registry Fetch (`Enhetsregisteret` + `Roller` + `Regnskapsregisteret`), (2) Grounded Web Search via Gemini, (3) Entity-Match & Zero-Fabrication Guardrail Audit, and (4) Profile Delta & Explanation Synthesis.
  2. **Fact-by-Fact Evidence & Guardrail Inspection**: Each extracted fact (Legal Identity, NACE Industry Code, Registered Address, CEO & Board Roles, Employee Count, Verified Financials, Official Website, Recent Material Developments) displays its exact value, source link, source date, verification rationale, and entity-match check. Any candidate web fact that lacks an explicit link to the target organization number or legal entity is quarantined in a transparent "Rejected / Unverified Candidates" drawer so users can see the guardrail in action.
  3. **Profile Freshness & Diff Updater**: Clicking **"Check for Updates / Run Delta"** re-polls the registry and grounded web sources, highlighting modified facts with before/after diffs, timestamps, and an explanation of why the profile was updated.
  4. **1,000+ Profile Corpus Explorer & Batch Enricher**: Users can browse, search, filter by NACE industry or municipality, and batch-sync over 1,000 real Norwegian company profiles pulled from the live Brønnøysundregistrene API, with one-click JSON/JSONL dataset download.
  5. **Daily 100-Company Test Simulator & Cost Ledger**: Users trigger a 100-company evaluation run to inspect projected rubric scores (out of 100 points, tracking the 65/100 overall and 21/35 coverage qualification thresholds) alongside live counters for Outbound Requests (`N / 2,000`), Elapsed Time (`MM:SS / 45:00`), and Declared API Cost (`$X.XX / $10.00`).
  6. **Submission Packager**: Provides the ready-to-use one-command CLI runner, model & API cost breakdown table, commit hash / repo manifest, and exportable submission files.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Nordic Institutional Precision — a crisp, high-density enterprise intelligence workspace inspired by Norwegian public registries and financial research terminals.
  - *Color Palette & Mood*:
    - **60% Dominant Neutral Canvas**: Crisp Alabaster light canvas (`#F8FAFC` / `slate-50`) with pure white data surfaces (`#FFFFFF`).
    - **30% Structural Surfaces**: Hairline slate borders (`#E2E8F0` / `slate-200`), deep slate ink (`#0F172A` / `slate-900`), and muted secondary text (`#475569` / `slate-600`).
    - **10% Accent Budget**: Nordic Cobalt (`#1D4ED8` / `blue-700`) for primary interactive actions and active workspace states, paired with semantic status indicators always accompanied by explicit text labels: Emerald (`#15803D`) for `Verified Match`, Amber (`#B45309`) for `Stale / Needs Update`, and Crimson (`#B91C1C`) for `Quarantined — Entity Mismatch`.
  - *Typography & Hierarchy*:
    - **Display & Navigation**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700) for crisp structural hierarchy and workspace headers.
    - **Body Prose & Explanations**: `Public Sans` (Regular 400 / Medium 500) for dense, legible evidence explanations.
    - **Data, Organization Numbers & Financials**: `JetBrains Mono` with `tabular-nums` strictly enforced on all 9-digit organization numbers, NACE codes, NOK financial figures, timestamps, and request/cost counters.
  - *Component Styling & Layout*:
    - Full-viewport 1440px desktop architecture with a clean 3-zone Top Bar Contract (Brand wordmark on the left, 4 single-line workspace navigation links in the center, and 1 primary `"Export 1,000+ Profiles"` action button on the right).
    - Single-elevation flat cards with 1px hairline borders (`border-slate-200`), compact 40px data table rows, and zero static pill clutter (metadata rendered as clean inline text separated by `·`).
- **Interactive Feedback & Motion**:
  - Instant (<150ms) tab and filter transitions, step-by-step pipeline progress indicators during live company research, skeleton row placeholders during Brønnøysundregistrene batch fetches, and non-intrusive toast notifications on dataset export or clipboard copy.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Two-Tier Source Authority (Brønnøysundregistrene Primary + Gemini Grounding Secondary)**
  - *Chosen Approach*: Always query the official Norwegian government registry (`data.brreg.no`) first to anchor the company's canonical legal name, 9-digit organization number, organizational form (`AS`, `ASA`, `ENK`, `NUF`), NACE industry codes, statutory roles (CEO / `Daglig leder`, Chair / `Styrets leder`), and latest filed annual accounts (`Regnskapsregisteret`). Then invoke server-side Gemini (`gemini-3.8-flash`) with `googleSearch` grounding using the exact legal name + organization number to discover verified web facts, press releases, and product lines.
  - *Why*: In the Signalpost rubric, a material wrong-company publication or fabricated financial value disqualifies the entry. Anchoring on the official registry guarantees 100% precision on core identity and financials while consuming $0.00 in external API costs, reserving the Gemini Search budget for high-value web coverage and natural-language evidence explanations.
  - *Alternatives Considered*: Relying solely on LLM web search (rejected due to higher API cost and risk of confusing similarly named regional subsidiaries like `Equinor ASA` vs. `Equinor Energy AS`).

- **Decision 2: Deterministic Modulo-11 & Cross-Entity Guardrail Engine**
  - *Chosen Approach*: Validate every Norwegian organization number using the official Norwegian Modulo-11 checksum algorithm before making network requests, and run an automated post-extraction verification pass that checks every grounded web claim against the target company's canonical name, municipality, and organization number.
  - *Why*: Directly protects the 30-point Evidence Matching score and prevents accidental cross-contamination between parent companies, subsidiaries, and dissolved entities.

- **Decision 3: Live 1,000+ Profile Seeding via Bulk Brønnøysundregistrene Pagination + On-Demand Deep Grounding**
  - *Chosen Approach*: Provide a server-side batch engine that fetches 1,000+ real Norwegian companies from `data.brreg.no/enhetsregisteret/api/enheter` (supports pages of 100 companies per request, requiring only 10–12 outbound requests to build a 1,000+ verified profile baseline) and enriches selected or sampled batches with Gemini Search Grounding.
  - *Why*: Satisfies the "At least 1,000 company profiles" submission requirement within seconds while keeping outbound requests (~12 requests for 1,000 base profiles + ~3 requests per deep-grounded company) well inside the 2,000 request / 45-minute / $10.00 daily budget.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Signalpost Client Workbench (React 19)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  Top Bar: [Signalpost] ── [Agent Workbench | 1,000+ Profiles |               │
│            Daily 100 Benchmark | Submission Pack] ── [Export 1,000+ JSON]    │
├───────────────────────┬──────────────────────────┬───────────────────────────┤
│ 1. Agent Workbench    │ 2. 1,000+ Corpus Manager │ 3. Daily 100 Benchmark &  │
│  • OrgNr Input &      │  • Live Brreg Bulk Sync  │    Submission Packager    │
│    Mod-11 Validator   │    (1,000+ Real Entities)│  • 100-Company Daily Run  │
│  • 4-Stage Pipeline   │  • Search, NACE & Status │  • Rubric Breakdown       │
│    Progress Tracker   │    Filters               │    (35/30/20/10/5 pts)    │
│  • Verified Fact Grid │  • Incremental Update &  │  • Telemetry Budget Meter │
│    with Source Links  │    Diff Inspector        │    (45m / 2,000 req / $10)│
│  • Quarantine Drawer  │  • JSON / JSONL Exporter │  • CLI Command & Manifest │
└───────────┬───────────┴─────────────┬────────────┴─────────────┬─────────────┘
            │                         │                          │
            ▼                         ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Express Server & Agent Engine (/api/*)                   │
├───────────────────────┬──────────────────────────┬───────────────────────────┤
│POST /api/agent/profile│POST /api/corpus/sync-1000│POST /api/benchmark/run    │
│POST /api/agent/update │GET  /api/corpus/list     │GET  /api/telemetry/state  │
│GET  /api/agent/search │GET  /api/corpus/export   │GET  /api/submission/pack  │
└───────────┬───────────┴─────────────┬────────────┴─────────────┬─────────────┘
            │                         │                          │
            ▼                         ▼                          ▼
┌──────────────────────────────┐  ┌─────────────────────────────┐  ┌───────────┐
│ Brønnøysundregistrene APIs   │  │ Server-Side @google/genai   │  │ In-Memory │
│ • /enhetsregisteret/enheter  │  │ • Model: gemini-3.8-flash   │  │ & Disk    │
│ • /enheter/{orgnr}/roller    │  │ • Tools: googleSearch       │  │ Profile   │
│ • /regnskapsregisteret/...   │  │ • Entity & Financial Verifier│  │ Store     │
└──────────────────────────────┘  └─────────────────────────────┘  └───────────┘
```

- **Data Model & State**:
  - **`CompanyProfile`**:
    - `orgnr`: 9-digit string validated by Norwegian Modulo-11 checksum.
    - `name`: Canonical legal name from `Enhetsregisteret`.
    - `orgForm`: Legal code & description (e.g., `ASA — Allmennaksjeselskap`).
    - `status`: Active, Under Liquidation, or Bankruptcy (`konkurs` / `underAvvikling` flags).
    - `lastUpdated`: ISO-8601 timestamp of the latest profile verification.
    - `version`: Integer revision counter incremented on profile updates.
    - `facts`: Array of `VerifiedFact` items across categories (`identity`, `governance`, `financials`, `operations`, `web_presence`, `recent_signals`).
    - `quarantinedClaims`: Array of rejected claims with mismatch reason (e.g., subsidiary orgnr mismatch or unverified financial number).
    - `summaryExplanation`: Cohesive, human-readable synthesis explaining the company's current standing, evidence quality, and what changed in the latest update.
  - **`VerifiedFact`**:
    - `id`, `category`, `label`, `value`, `unit` (optional, e.g., `NOK`), `sourceUrl`, `sourceTitle`, `sourceDate` (publication or registry filing date), `retrievedAt` (ISO date), `verificationMethod` (`brreg_official_registry` | `brreg_accounting_registry` | `gemini_grounded_web`), `entityMatchConfidence` (`exact_orgnr_match` | `legal_name_and_hq_match`), and `explanation` (why this fact is useful and how it was matched to the company).
  - **`TelemetryBudget`**:
    - Tracks `outboundRequestsUsed` (cap: `2000`), `externalApiCostUsd` (cap: `$10.00`), `elapsedRuntimeMs` (cap: `45 * 60 * 1000`), and `profilesGeneratedCount` (target: `>= 1000`).

- **Interactive Component & State Mapping**:
  - **Agent Workbench View**:
    - Typing an organization number runs real-time Modulo-11 checksum validation; typing a company name queries `/api/agent/search` against `data.brreg.no` to let the user pick the exact 9-digit entity.
    - Clicking **"Run Signalpost Agent"** calls `POST /api/agent/profile`, executing the registry fetch, `gemini-3.8-flash` grounded search, and verification pass, then renders the structured fact table, evidence links, and guardrail quarantine log.
    - Clicking **"Verify & Update Profile"** calls `POST /api/agent/update`, comparing newly retrieved registry and web facts against the stored profile, incrementing the version, and displaying a field-level changelog.
  - **1,000+ Profile Corpus View**:
    - Clicking **"Build / Sync 1,000+ Norwegian Profiles"** triggers `POST /api/corpus/sync-1000`, paginating live requests to `data.brreg.no` to populate 1,000+ verified Norwegian company profiles with progress feedback, live filtering by industry/municipality/status, row click to inspect any profile in the Workbench, and **"Download 1,000+ Profiles (.jsonl / .json)"**.
  - **Daily 100-Company Benchmark View**:
    - Clicking **"Run Daily 100-Company Evaluation"** samples 100 random companies from the Norwegian registry, runs batch verification, updates the 5-part Signalpost scoring breakdown (Coverage /35, Evidence Match /30, Update Accuracy /20, Explanations /10, Usability /5), and verifies compliance with the 65/100 overall and 21/35 coverage qualification bars.
  - **Submission Packager View**:
    - Interactive form to configure repository URL, commit hash, and runner flags, with one-click copy/download for the `README_SUBMISSION.md`, `run_agent.sh` one-command script, and cost declaration manifest.
