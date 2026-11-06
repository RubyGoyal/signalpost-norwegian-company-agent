PRODUCT
Signalpost Explorer: a public, read-only website for looking up Norwegian companies and checking where every fact comes from. The data comes from Signalpost, an agent that reads the official Brønnøysund registers, NAV's job feed and each company's own verified website. No sign-in, no user accounts, no database, nothing is written.

USERS AND GOALS
A business researcher, or a judge testing the site, on a laptop or a phone. In under a minute they must be able to:
1. Find a company by name or organisation number.
2. Open it and understand it at a glance.
3. Check where any fact came from, in one tap, and open the original source.
4. Compare two companies side by side.

DATA (read-only JSON, public, CORS-enabled; fetch it at runtime and cache it for 5 minutes; do not copy it into a database)
- Company list: https://raw.githubusercontent.com/RubyGoyal/signalpost-norwegian-company-agent/site-data/index.json
- One company: https://raw.githubusercontent.com/RubyGoyal/signalpost-norwegian-company-agent/site-data/companies/{orgnr}.json
- Format description: https://github.com/RubyGoyal/signalpost-norwegian-company-agent/blob/main/site/README.md
- index.json: { generated_at, commit, count, companies: [{ orgnr, name, form, status, municipality, industry, employees, revenue: { amount, currency, year, display } | null, website, profiles, news, jobs, facts, glance }] }
- companies/{orgnr}.json: { orgnr, name, form: { code, description }, status, checked_at, summary: [{ kind: "glance" | "new" | "fact" | "changes" | "unknowns", text, sources: [{ label, url }] }], key_facts: [{ key, label, value, link?, sources: [...] }], sections: [{ key, title, state: "found" | "none" | "unclear" | "failed", note, facts: [{ label, value, link?, as_of, period, sources: [{ label, url, retrieved_at, where }] }] }], changes: { since, baseline, items: [{ label, type, before, after }] }, sources_consulted: [{ label, url, retrieved_at, ok }], fact_count }
- Values are already formatted for display: show them exactly as given. A null value means the source holds nothing: show "Not registered", never 0 or a guess. Some facts say "None found" themselves; show that text as it is.
- key_facts has the same 16 facts in the same order for every company, made for the compare view.

SCREENS
1. Home and search (/)
 - A large search box at the top, focused on load: "Search by company name or organisation number".
 - Results update as you type. Match the name, the organisation number (ignore spaces, dots and a "NO ... MVA" wrapper, so "923 609 016" and "NO923609016MVA" both find 923609016), the municipality and the industry. Pressing Enter opens the first result.
 - Show every company as a card: name, organisation number, municipality, industry, employees, revenue (with year), and small badges for Website, News (count) and Hiring (count). The whole card opens the company.
 - Filter chips: Has website, Hiring, Has news. Sort: Name, Revenue, Employees.
 - Each card has a "Compare" toggle. When one or two are picked, a sticky bar appears at the bottom: "Compare 2 companies" (disabled until two are picked; at most two).
 - A short line under the title: "{count} Norwegian companies. Every fact links to its source." and the data date (generated_at).
2. Company (/company/[orgnr])
 - Header: name, organisation number with a copy button, status badge (Active in green; anything else in amber or red), organisation form, "Checked {checked_at as a readable date}", and a "Compare with..." button.
 - "At a glance": the summary item with kind "glance", shown large, with its source chips.
 - "What's new": the summary item with kind "new", in a highlighted box, with its source chips.
 - Key facts: a grid of cards (two columns on phones, four on laptops) from key_facts: label, value (a link when link is set), and a source chip.
 - Tabs (on phones a horizontally scrollable tab bar that does not move the page): Overview (the remaining summary sentences), People, Finances, Online (Website, Social profiles, Contact, News), Hiring, Registry (Legal identity, Addresses, Industry, Status, Locations, Group structure, News and registry activity), Sources. Each tab lists its sections; each section lists its facts as rows: label, value (a link when link is set), period or "as of" date when present, and a source chip. A section with no facts shows its note in grey (for example "Checked: no employee count registered (not shown as zero)").
 - "Changes since the last check": the change items (label, before, after); if there are none, say "No changes since {since}" or "First check of this company".
 - Sources tab: every source in sources_consulted, with its label, a link, the time it was read, and OK or failed.
3. Source panel (the core of the site)
 - Every source chip shows the source's short name and a small link icon ("Enhetsregisteret ↗"). Tapping it opens a panel: a right-side drawer on laptops, a bottom sheet on phones.
 - The panel shows: the fact (label and value), each source with its full name, an "Open source" button (new tab), the URL in small wrapped text, "Read on {retrieved_at as a local date and time}", and "Where in the source: {where}" (for registry data explain it as "field in the register's data"; for web pages show the quoted text).
 - One line at the bottom: "Signalpost only shows what the source says. Nothing is guessed."
 - Close with the X button, the Escape key, or by tapping outside.
4. Compare (/compare?a={orgnr}&b={orgnr})
 - Two company pickers at the top (searchable, same matching as the home search), prefilled from the URL. Changing either updates the URL so the comparison can be shared.
 - Laptop: a table with the fact label in the first column and one column per company; the company names stay visible at the top while scrolling.
 - Phone: no table. Each fact is a card: the label, then "A · {short name}" with its value and source chip, then "B · {short name}" with its value and source chip. A sticky header shows A and B. Nothing may scroll sideways.
 - Rows come from key_facts (same order for both). Values that differ are subtly highlighted. Missing values show "Not registered".
 - A "Swap" button and links to open each company.
5. About (/about)
 - What Signalpost is (an agent that researches Norwegian companies from public sources; no AI model writes the facts), the sources and their licenses (Brønnøysundregistrene open data under NLOD 2.0, NAV's job feed, each company's own website), the data date and agent version (generated_at and commit from index.json), and a link to https://github.com/RubyGoyal/signalpost-norwegian-company-agent.

UX REQUIREMENTS
- Works perfectly on a 375 px wide phone and on a laptop: no sideways scrolling anywhere, tap targets at least 44 px, readable text (16 px body on phones).
- Fast: load index.json once and reuse it; load a company file only when it is opened; show skeletons while loading; show a friendly error with a "Try again" button if a file cannot be loaded.
- Every page has a shareable URL; Back and Forward work.
- Keyboard and screen reader friendly: visible focus, labels on icon buttons, Escape closes panels, WCAG AA contrast.
- Norwegian letters (æ, ø, å) display correctly everywhere.
- A sticky top bar with the Signalpost name (links home), a compact search on inner pages, and links to Compare and About.

VISUAL DESIGN
- A calm, trustworthy research tool: near-white background, dark slate text, one accent color (deep teal), green only for "Active" and found states.
- Clean sans-serif type (Inter or similar), generous spacing, rounded cards with soft borders, no stock photos.
- Source chips are small pills with a link icon, the same everywhere, so people learn that every fact can be checked.
- A footer on every page: "Data: Brønnøysundregistrene (NLOD 2.0), NAV and each company's own website. Built with Signalpost."

ACCEPTANCE CHECKS
- Typing "equinor", "923609016" or "923 609 016" shows EQUINOR ASA first; Enter opens it.
- On a company page every fact has a source chip, and the chip opens the panel with a working "Open source" link.
- Comparing EQUINOR ASA (923609016) and DNB BANK ASA (984851006) works on a 375 px phone without sideways scrolling, and every value has a source chip.
- A company without a registered employee count shows "Not registered", never 0.
