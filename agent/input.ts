// Input parsing for the batch runner.
//
// Accepts .txt / .csv / .tsv / .jsonl / .json (optionally gzipped). The goal is that no
// organisation-number row is ever dropped silently:
//   - a value with a 9-digit number (spaces, dots or an "NO ... MVA" wrapper allowed) is used;
//   - a value with digits but no valid 9-digit number is kept as-is, so the agent writes a
//     `failed` envelope with `invalid_organisation_number` for it;
//   - only rows with no digits at all (headers, blank cells) are skipped, and they are counted.

import { promises as fs } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const ORG_KEYS = [
  'organisation_number',
  'organisationNumber',
  'organization_number',
  'organizationNumber',
  'organisasjonsnummer',
  'orgnr',
  'orgNr',
  'org_nr',
  'org_number',
  'orgnummer',
  'org_no',
  'orgNo',
];

const ORG_KEY_SET = new Set(ORG_KEYS.map((k) => k.toLowerCase().replace(/[^a-z]/g, '')));
// Column or key names such as "Org. nr.", "Organisasjonsnummer", "company_org_number" (not "org_name").
const isOrgKey = (k: string) => {
  const n = k.toLowerCase().replace(/[^a-z]/g, '');
  if (ORG_KEY_SET.has(n)) return true;
  if (/parent|overordnet|hoved|mother|group|konsern/.test(n)) return false; // never a parent's number
  return n.includes('org') && /(nr|nummer|number|no|num|id)s?$/.test(n);
};

// A 9-digit number not glued to other digits. Allows "923 609 016", "923.609.016", "NO923609016MVA".
const NINE = /(?<!\d)(\d{3})[ . ]?(\d{3})[ . ]?(\d{3})(?!\d)/;

/** Organisation number from a free-text value; null when the value holds no digits at all. */
export function orgnrFromText(v: string): string | null {
  const s = v.trim().replace(/^"|"$/g, '').trim();
  const m = s.match(NINE);
  if (m) return m[1] + m[2] + m[3];
  if (!/\d/.test(s)) return null;
  // Digits but not a 9-digit number: keep it, so it is reported as invalid instead of dropped.
  return s.replace(/\s+/g, '').slice(0, 64);
}

/** Organisation number from a JSON value (string, number or record). */
export function orgnrFromJson(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v)).padStart(9, '0');
  if (typeof v === 'string') return orgnrFromText(v);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>;
    // 1. a known key, 2. any key that looks like an org-number key, 3. any value holding a 9-digit number.
    for (const k of ORG_KEYS) if (k in rec && rec[k] != null) return orgnrFromJson(rec[k]);
    for (const k of Object.keys(rec)) if (isOrgKey(k) && rec[k] != null && typeof rec[k] !== 'object') return orgnrFromJson(rec[k]);
    for (const val of Object.values(rec)) {
      if (typeof val === 'number' && /^\d{9}$/.test(String(val))) return String(val);
      if (typeof val === 'string' && NINE.test(val)) return orgnrFromText(val);
    }
  }
  return null;
}

function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === delim && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse input text into organisation numbers, in input order, duplicates merged. */
export function parseInputText(text: string): { orgnrs: string[]; skipped: number; duplicates: number } {
  text = text.replace(/^﻿/, '');
  const raw: string[] = [];
  let skipped = 0;
  const push = (o: string | null) => (o ? raw.push(o) : skipped++);
  const trimmed = text.trim();

  // Whole-file JSON: an array of values/records, or an object holding such an array.
  let whole: unknown = undefined;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      whole = JSON.parse(trimmed);
    } catch {
      whole = undefined; // not a single JSON document: treat as JSON Lines below
    }
  }
  if (whole !== undefined) {
    let items: unknown[] | null = Array.isArray(whole) ? whole : null;
    if (!items && whole && typeof whole === 'object') {
      // A single record (it has an org-number field) or a wrapper such as {"companies": [...]}.
      const rec = whole as Record<string, unknown>;
      const isRecord = Object.entries(rec).some(([k, x]) => isOrgKey(k) && x != null && typeof x !== 'object');
      const arr = isRecord ? undefined : Object.values(rec).find((x) => Array.isArray(x));
      items = (arr as unknown[]) || [whole];
    }
    for (const item of items || []) push(orgnrFromJson(item));
  } else {
    const lines = text.split(/\r?\n/);
    // Delimited file with a header row: read the org-number column by name.
    const first = lines.find((l) => l.trim());
    let delim = '';
    let col = -1;
    if (first && !/\d{3}/.test(first)) {
      delim = [',', ';', '\t', '|'].find((d) => first.includes(d)) || '';
      if (delim) col = splitRow(first, delim).findIndex((h) => isOrgKey(h));
    }
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith('{')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(l);
        } catch {
          parsed = undefined;
        }
        push(parsed === undefined ? orgnrFromText(l) : orgnrFromJson(parsed));
        continue;
      }
      if (col >= 0) {
        const cells = splitRow(l, delim);
        // The header row and blank cells have no digits and are skipped.
        push(orgnrFromText(cells[col] ?? ''));
        continue;
      }
      push(orgnrFromText(l));
    }
  }

  const seen = new Set<string>();
  const orgnrs: string[] = [];
  for (const o of raw) {
    if (seen.has(o)) continue;
    seen.add(o);
    orgnrs.push(o);
  }
  return { orgnrs, skipped, duplicates: raw.length - orgnrs.length };
}

export async function readInput(file: string): Promise<{ orgnrs: string[]; skipped: number; duplicates: number }> {
  let buf = await fs.readFile(file);
  if (file.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = gunzipSync(buf);
  return parseInputText(buf.toString('utf8'));
}
