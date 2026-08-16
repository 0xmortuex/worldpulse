/**
 * Write the app's own country codes to `data/country-codes.json`.
 *
 * The armed-forces generator needs the full country list to tell "no armed
 * forces" from "no row returned". Asking Wikidata for it was what made the
 * first version of that query 504 — and it is a list this app already has, so
 * asking at all was the mistake.
 *
 *   npx tsx scripts/export-country-codes.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCountries } from '../src/countries.ts';

const codes = loadCountries()
  .map((country) => country.code)
  .sort();

const out = resolve(import.meta.dirname, '..', 'data', 'country-codes.json');
writeFileSync(out, `${JSON.stringify(codes, null, 2)}\n`);
console.log(`wrote ${codes.length} codes to data/country-codes.json`);
