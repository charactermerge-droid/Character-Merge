#!/usr/bin/env node
/**
 * Prints exactly what the server reads from the configured sheet source (CSV files or Google Sheet)
 * and what the live index would look like. Use it to check a Google Sheet setup before starting the server.
 */
import { loadConfig } from '../src/config.js';
import { createSheetSource } from '../src/sheet.js';
import { buildIndex } from '../src/index-builder.js';

try { process.loadEnvFile?.(); } catch { /* optional */ }

const cfg = loadConfig();
const source = createSheetSource(cfg);
console.log(`source: ${source.kind} (${source.describe()})${cfg.googleSaEmail ? `  as ${cfg.googleSaEmail}` : ''}\n`);

const { charRows, mergeRows } = await source.fetchRows();

console.log(`characters tab: ${charRows.length} rows`);
console.table(charRows.map(([id, display_name, thumb_blob, tier, selectable_first, enabled]) =>
  ({ id, display_name, thumb_blob, tier, selectable_first, enabled })));

console.log(`\nmerges tab: ${mergeRows.length} rows`);
console.table(mergeRows.map(([char_a, char_b, result_id, result_name, video_blob, enabled, notes]) =>
  ({ char_a, char_b, result_id, result_name, video_blob, enabled, notes })));

const idx = buildIndex(charRows, mergeRows);
console.log(`\nlive index: ${idx.characters.size} enabled characters, ${idx.byPair.size} enabled merges`);
for (const [id, c] of idx.characters) {
  const partners = [...(idx.adjacency.get(id) || [])];
  console.log(`  ${id.padEnd(12)} ${c.selectableFirst ? 'first-pick' : 'partner-only'}  -> ${partners.join(', ') || '(no merges yet)'}`);
}
if (idx.warnings.length) console.log('\nwarnings:\n  ' + idx.warnings.join('\n  '));
