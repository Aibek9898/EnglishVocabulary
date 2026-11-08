// Builds the Reading section's English–Russian dictionary (public/dict/*.json)
// from the dictd files of V.K. Mueller's English-Russian Dictionary, 7th ed.
// (electronic version by E.S. Cymbalyuk, GNU GPL; e.g. mueller7.dict + mueller7.index
// from the dict-mueller7 package).
//
//   node scripts/build-dictionary.mjs path/to/mueller7.index path/to/mueller7.dict
//
// Output: one small file per two-letter prefix ("ru.json" holds "run", "rule"…),
// so a tap on a word only downloads a few kilobytes. Each file maps a lowercase
// headword to its entry text: the IPA line first, then one line per sense.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [indexPath, dictPath, outDir = 'public/dict'] = process.argv.slice(2);
if (!indexPath || !dictPath) {
  console.error('Usage: node scripts/build-dictionary.mjs <mueller7.index> <mueller7.dict> [outDir]');
  process.exit(1);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const dec = (s) => [...s].reduce((n, c) => n * 64 + B64.indexOf(c), 0);
const data = readFileSync(dictPath);

/** Mueller's old transcription → today's IPA. */
function ipa(t) {
  return t
    .replace(/↗/g, 'ˈ')
    .replace(/↘/g, 'ˌ')
    .replace(/ɘ:/g, 'ɔː')
    .replace(/ɘ/g, 'ɒ')
    .replace(/ɜ:/g, 'ɜː')
    .replace(/ɜ(?!ː)/g, 'ə')
    .replace(/:/g, 'ː')
    .replace(/ɛɪ/g, 'eɪ')
    .replace(/ɛ/g, 'e');
}

const START = /^(_[IVX]+\b|\d+\.\s|\d+\)|[а-я]\)\s)/;

function clean(body) {
  const lines = body.split('\n').slice(1); // the first line repeats the headword
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (out.length === 0 || START.test(line)) out.push(line);
    else out[out.length - 1] += ' ' + line;
  }
  return out.map((l) => l.replace(/\[([^\]]+)\]/g, (_, t) => `[${ipa(t)}]`).replace(/\s+/g, ' ')).join('\n');
}

const shards = new Map();
let count = 0;
for (const row of readFileSync(indexPath, 'utf8').split('\n')) {
  const [word, off, len] = row.split('\t');
  if (!word || !len || word.startsWith('00-database')) continue;
  const key = word.toLowerCase();
  const text = clean(data.subarray(dec(off), dec(off) + dec(len)).toString('utf8'));
  if (!text) continue;
  const prefix = /^[a-z]{2}/.test(key) ? key.slice(0, 2) : /^[a-z]/.test(key) ? key[0] + '_' : '__';
  if (!shards.has(prefix)) shards.set(prefix, {});
  const shard = shards.get(prefix);
  shard[key] = shard[key] ? `${shard[key]}\n${text}` : text;
  count++;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [prefix, shard] of shards) writeFileSync(join(outDir, `${prefix}.json`), JSON.stringify(shard));
writeFileSync(
  join(outDir, 'LICENSE.txt'),
  `English-Russian dictionary used by the Reading section.

(C) V.K. Mueller English-Russian Dictionary, 7th Edition, "State Publishing House of
Foreign and National Dictionaries", Moscow 1961. Free electronic version by S. Starostin
1996; electronic version by E.S. Cymbalyuk 1999 under the GNU GPL, version 1.2 or later.
Converted for this site by scripts/build-dictionary.mjs (line joins, modern IPA symbols).
`,
);
console.log(`${count} entries in ${shards.size} files → ${outDir}`);
