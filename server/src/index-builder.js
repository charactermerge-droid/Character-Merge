import { pairKey } from './pairKey.js';

const yes = v => String(v ?? '').trim().toUpperCase() === 'TRUE';
const str = v => String(v ?? '').trim();

/**
 * Turn raw sheet rows into the in-memory index the API serves from.
 * Pure: no I/O, so it is unit-testable and identical for every sheet source.
 *
 * charRows:  [id, display_name, thumb_blob, tier, selectable_first, enabled]
 * mergeRows: [char_a, char_b, result_id, result_name, video_blob, enabled, notes]
 */
export function buildIndex(charRows, mergeRows) {
  const warnings = [];
  const characters = new Map();

  for (const [rawId, name, thumb, tier, first, enabled] of charRows) {
    const id = str(rawId);
    if (!id) continue;
    if (/\s|\//.test(id)) { warnings.push(`character "${id}": id must not contain whitespace or "/"`); continue; }
    if (!yes(enabled)) continue;
    if (characters.has(id)) { warnings.push(`character "${id}": duplicate row, later row wins`); }
    if (!str(thumb)) warnings.push(`character "${id}": missing thumb_blob`);
    characters.set(id, {
      id,
      name: str(name) || id,
      thumb: str(thumb),
      tier: str(tier) || 'common',
      selectableFirst: yes(first),
    });
  }

  const adjacency = new Map();
  const byPair = new Map();

  for (const [a, b, resultId, resultName, blob, enabled, notes] of mergeRows) {
    const A = str(a), B = str(b);
    if (!A || !B) continue;
    if (!yes(enabled)) continue;
    if (A === B) { warnings.push(`merge ${A}+${B}: a character cannot merge with itself`); continue; }
    if (!characters.has(A) || !characters.has(B)) {
      warnings.push(`merge ${A}+${B}: unknown or disabled character id`);
      continue;
    }
    if (!str(blob)) { warnings.push(`merge ${A}+${B}: missing video_blob`); continue; }

    const key = pairKey(A, B);
    if (byPair.has(key)) {
      const prev = byPair.get(key);
      warnings.push(`merge ${A}+${B}: duplicate pair (previous result "${prev.resultId}", this row "${str(resultId)}") — later row wins`);
    }
    byPair.set(key, {
      pairKey: key, a: A, b: B,
      resultId: str(resultId) || key,
      resultName: str(resultName) || str(resultId) || key,
      blob: str(blob),
      notes: str(notes),
    });

    if (!adjacency.has(A)) adjacency.set(A, new Set());
    if (!adjacency.has(B)) adjacency.set(B, new Set());
    adjacency.get(A).add(B);
    adjacency.get(B).add(A);
  }

  return { characters, adjacency, byPair, warnings };
}
