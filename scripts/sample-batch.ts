// Picks a random sample of registered Norwegian entities from Enhetsregisteret
// for smoke-testing the agent. Not part of the evaluator command.
//
//   npx tsx scripts/sample-batch.ts 100 examples/smoke-100.txt

import { promises as fs } from 'node:fs';
import path from 'node:path';

const count = Number(process.argv[2] || 100);
const outFile = process.argv[3] || 'examples/smoke-100.txt';
const BASE = 'https://data.brreg.no/enhetsregisteret/api/enheter';
const UA = 'signalpost-agent/1.0 (+https://github.com/RubyGoyal/signalpost-norwegian-company-agent)';

// Weighted towards forms that file annual accounts (the challenge universe).
const FORMS: [string, number][] = [['AS', 80], ['ASA', 3], ['SA', 4], ['STI', 4], ['NUF', 4], ['ANS', 3], ['DA', 2]];
const pickForm = () => {
  let r = Math.random() * FORMS.reduce((n, [, w]) => n + w, 0);
  for (const [f, w] of FORMS) if ((r -= w) < 0) return f;
  return 'AS';
};
const randomMonth = () => {
  const y = 1985 + Math.floor(Math.random() * 40);
  const m = 1 + Math.floor(Math.random() * 12);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
};

async function get(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const picked = new Set<string>();
let attempts = 0;
async function worker() {
 while (picked.size < count && attempts < count * 6) {
  attempts++;
  const form = pickForm();
  const { from, to } = randomMonth();
  const q = `organisasjonsform=${form}&fraStiftelsesdato=${from}&tilStiftelsesdato=${to}`;
  try {
    const head = await get(`${BASE}?${q}&size=1&page=0`);
    const total = Math.min(head?.page?.totalElements ?? 0, 9_999);
    if (!total) continue;
    const page = Math.floor(Math.random() * total);
    const hit = await get(`${BASE}?${q}&size=1&page=${page}`);
    const orgnr = hit?._embedded?.enheter?.[0]?.organisasjonsnummer;
    if (orgnr && !picked.has(orgnr) && picked.size < count) {
      picked.add(orgnr);
      process.stderr.write(`\r${picked.size}/${count}`);
    }
  } catch (err: any) {
    process.stderr.write(`\nskip: ${err?.message || err}\n`);
  }
 }
}

await Promise.all(Array.from({ length: 6 }, worker));
await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await fs.writeFile(outFile, [...picked].join('\n') + '\n');
process.stderr.write(`\nwrote ${picked.size} organisation numbers to ${outFile}\n`);
