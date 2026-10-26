// Run-level quality report, written to run-report.json under "quality".
//
// It states what the run published, what it left out and why, and checks every envelope for
// the properties an auditor looks for: every claim backed by evidence in the same envelope,
// evidence that names its source, nothing from a company website unless that website was
// verified as the company's own, news posts with a publish date, job ads from websites with
// their hiring organisation, and summary statements that cite existing evidence.

import type { Envelope } from './types.ts';

const inc = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] || 0) + n;
};

export function qualityReport(envelopes: Envelope[]) {
  const claimsByFamily: Record<string, number> = {};
  const claimsBySourceClass: Record<string, number> = {};
  const websitesPublished: Record<string, number> = {};
  const websitesNotPublished: Record<string, number> = {};
  const fromWebsites = {
    companies_with_verified_website: 0,
    social_profiles: 0,
    dated_news_posts: 0,
    dated_news_posts_from_feeds: 0,
    job_ads: 0,
    role_email_addresses: 0,
    main_phone_numbers: 0,
  };
  const checks = {
    claims_without_evidence: 0,
    evidence_without_source_url_time_or_hash: 0,
    duplicate_claim_ids: 0,
    website_facts_without_a_verified_website: 0,
    news_posts_without_publish_date: 0,
    website_job_ads_without_hiring_organisation: 0,
    summary_statements_citing_missing_evidence: 0,
    failed_envelopes_with_claims: 0,
  };

  for (const e of envelopes) {
    const evidence = new Map(e.evidence.map((x) => [x.id, x]));
    const site = e.availability?.official_website;
    const verified = site?.state === 'available' && /verified/.test(site.reason);
    if (site?.state === 'available') inc(websitesPublished, site.reason);
    else if (site && e.state === 'available') inc(websitesNotPublished, `${site.state}:${site.reason}`);
    if (verified) fromWebsites.companies_with_verified_website++;

    const ids = new Set<string>();
    let usesWebsite = false;
    for (const c of e.claims) {
      if (ids.has(c.id)) checks.duplicate_claim_ids++;
      ids.add(c.id);
      inc(claimsByFamily, c.family);
      const evs = c.evidence_ids.map((id) => evidence.get(id));
      if (!c.evidence_ids.length || evs.some((x) => !x)) checks.claims_without_evidence++;
      const classes = new Set(evs.flatMap((x) => (x ? [x.source_class] : [])));
      for (const cls of classes) inc(claimsBySourceClass, cls);
      const fromSite = classes.has('company_owned');
      if (fromSite) usesWebsite = true;
      const v = c.value as Record<string, unknown>;
      if (c.field === 'social_profile' && fromSite) fromWebsites.social_profiles++;
      if (c.field === 'site_news') {
        fromWebsites.dated_news_posts++;
        if (evs.some((x) => x?.claim_span.includes('news feed'))) fromWebsites.dated_news_posts_from_feeds++;
        if (!v?.date || !c.source_date) checks.news_posts_without_publish_date++;
      }
      if (c.field === 'site_job') {
        fromWebsites.job_ads++;
        if (!v?.hiring_organisation && !v?.hiring_organisation_number) checks.website_job_ads_without_hiring_organisation++;
      }
      if (c.family === 'contact_points' && fromSite) {
        if (c.field === 'email') fromWebsites.role_email_addresses++;
        if (c.field === 'phone') fromWebsites.main_phone_numbers++;
      }
    }
    if (usesWebsite && !verified) checks.website_facts_without_a_verified_website++;
    for (const x of e.evidence) if (!/^https?:\/\//.test(x.source_url) || !x.retrieved_at || !x.content_sha256) checks.evidence_without_source_url_time_or_hash++;
    for (const st of e.summary?.statements || []) if (st.evidence_ids.some((id) => !evidence.has(id))) checks.summary_statements_citing_missing_evidence++;
    if (e.state === 'failed' && e.claims.length) checks.failed_envelopes_with_claims++;
  }

  const issues = Object.values(checks).reduce((n, x) => n + x, 0);
  return {
    all_checks_passed: issues === 0,
    issues,
    checks,
    claims_by_family: claimsByFamily,
    claims_by_source_class: claimsBySourceClass,
    websites: {
      published_by_how_verified: websitesPublished,
      not_published_by_reason: websitesNotPublished,
    },
    from_company_websites: fromWebsites,
  };
}
