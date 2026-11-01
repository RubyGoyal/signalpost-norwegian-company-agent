// Picks a random set of companies from a run's envelopes and lists every website, social, news
// and job item the agent published for them, with the link a person opens to check it by hand.
//
//   npx tsx scripts/handcheck-sample.ts out/envelopes.jsonl handcheck-sample.json [companies=15] [seed=1]
//
// Only companies with at least one such item are drawn (registry facts come from the
// official registers by organisation number and are not part of the hand check). The output is
// read by the hand-check page, where a person marks each item right or wrong.

import { readFileSync, writeFileSync } from 'node:fs';
import type { Envelope } from '../agent/types.ts';

const [inFile, outFile = 'handcheck-sample.json', nArg = '15', seedArg = '1'] = process.argv.slice(2);
if (!inFile) {
  console.error('usage: npx tsx scripts/handcheck-sample.ts <envelopes.jsonl> [out.json] [companies] [seed]');
  process.exit(2);
}

// Small seeded generator, so the same seed always draws the same companies.
let state = Number(seedArg) >>> 0 || 1;
const rand = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 2 ** 32;
};

type Item = { id: string; type: 'site' | 'social' | 'news' | 'jobs'; label: string; url: string; question: string };
const envelopes = readFileSync(inFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Envelope);
const companies = envelopes
  .filter((e) => e.state === 'available' && e.legal_identity)
  .map((e) => {
    const name = e.legal_identity!.legal_name || e.organisation_number;
    const items: Item[] = [];
    const fromSite = (c: Envelope['claims'][number]) => e.evidence.some((x) => c.evidence_ids.includes(x.id) && x.source_class === 'company_owned');
    for (const c of e.claims) {
      const v = c.value as any;
      const id = `${e.organisation_number}:${c.id}`;
      if (c.field === 'website' && fromSite(c))
        items.push({ id, type: 'site', label: v.url, url: v.url, question: `Is this the own website of ${name} (org. no. ${e.organisation_number}), not a parent's, group's, chain's or brand's site?` });
      else if (c.field === 'social_profile' && fromSite(c))
        items.push({ id, type: 'social', label: v.url, url: v.url, question: `Is this account run by ${name} itself, not a parent, group, sister company or person?` });
      else if (c.field === 'site_news')
        items.push({ id, type: 'news', label: `${v.date} "${v.title}"`, url: v.url, question: `Is this a news post by ${name}, published on ${v.date}?` });
      else if (c.field === 'site_job' || c.field === 'job_ad')
        items.push({ id, type: 'jobs', label: `"${v.title}"${v.hiring_organisation ? ` (${v.hiring_organisation})` : ''}`, url: v.url || `https://arbeidsplassen.nav.no/stillinger/stilling/${c.key.split('#').pop()}`, question: `Is this a live job opening at ${name}?` });
    }
    return { orgnr: e.organisation_number, name, items };
  })
  .filter((c) => c.items.length > 0);
for (let i = companies.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [companies[i], companies[j]] = [companies[j], companies[i]];
}
const picked = companies.slice(0, Number(nArg));
writeFileSync(outFile, JSON.stringify({ source: inFile, drawn_from: companies.length, seed: Number(seedArg), companies: picked }, null, 2));
console.error(`handcheck: ${picked.length} of ${companies.length} companies, ${picked.reduce((n, c) => n + c.items.length, 0)} items -> ${outFile}`);
