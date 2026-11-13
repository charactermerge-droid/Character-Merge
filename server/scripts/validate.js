#!/usr/bin/env node
/**
 * Pre-release content check (spec §5). Exit code 1 if anything that reaches players is broken.
 *
 *  1. every enabled merges.video_blob exists in the merges container
 *  2. every enabled merge's char_a / char_b exists and is enabled in characters
 *  3. every enabled character's thumb_blob exists in thumbs
 *  4. no duplicate pairKey rows with conflicting results
 *
 * Disabled rows are reported as notes only: "uploaded but not yet approved" is a normal state.
 */
import { loadConfig } from '../src/config.js';
import { createSheetSource } from '../src/sheet.js';
import { createStorage } from '../src/storage/index.js';
import { buildIndex } from '../src/index-builder.js';
import { pairKey } from '../src/pairKey.js';

try { process.loadEnvFile?.(); } catch { /* optional */ }

const cfg = loadConfig();
const source = createSheetSource(cfg);
const storage = await createStorage(cfg);

const yes = v => String(v ?? '').trim().toUpperCase() === 'TRUE';
const str = v => String(v ?? '').trim();

const errors = [];
const notes = [];

const { charRows, mergeRows } = await source.fetchRows();
const [mergeBlobs, thumbBlobs] = await Promise.all([storage.listBlobs('merges'), storage.listBlobs('thumbs')]);
const index = buildIndex(charRows, mergeRows);

// Anything the index builder had to skip or override is a problem for enabled rows.
for (const w of index.warnings) errors.push(`index: ${w}`);

// 3. thumbnails
for (const [id, , thumb, , , enabled] of charRows) {
  if (!str(id)) continue;
  const bucket = yes(enabled) ? errors : notes;
  if (!str(thumb)) bucket.push(`character ${str(id)}: no thumb_blob`);
  else if (!thumbBlobs.has(str(thumb))) bucket.push(`character ${str(id)}: thumb "${str(thumb)}" not found in thumbs`);
}

// 1, 2, 4. merges
const seenPairs = new Map(); // pairKey -> resultId (enabled rows only)
for (const [a, b, resultId, , blob, enabled] of mergeRows) {
  const A = str(a), B = str(b);
  if (!A || !B) continue;
  const label = `merge ${A}+${B}`;
  const on = yes(enabled);
  const bucket = on ? errors : notes;

  if (!index.characters.has(A) || !index.characters.has(B)) {
    bucket.push(`${label}: character not found or disabled`);
  }
  if (!str(blob)) bucket.push(`${label}: no video_blob`);
  else if (!mergeBlobs.has(str(blob))) bucket.push(`${label}: video "${str(blob)}" not found in merges`);

  if (on) {
    const key = pairKey(A, B);
    const prev = seenPairs.get(key);
    if (prev !== undefined && prev !== str(resultId)) {
      errors.push(`${label}: duplicate pair with conflicting result ("${prev}" vs "${str(resultId)}")`);
    }
    seenPairs.set(key, str(resultId));
  }
}

console.log(`checked ${charRows.length} character rows, ${mergeRows.length} merge rows against ${storage.kind} storage (${storage.describe()})`);
console.log(`live index: ${index.characters.size} characters, ${index.byPair.size} merges`);
if (notes.length) console.log('\nnotes (disabled rows):\n  ' + notes.join('\n  '));
if (errors.length) {
  console.error('\nERRORS:\n  ' + [...new Set(errors)].join('\n  '));
  process.exit(1);
}
console.log('\nOK');
