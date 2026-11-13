import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/index-builder.js';
import { pairKey } from '../src/pairKey.js';

const chars = [
  ['tiger', 'Tiger', 'tiger.png', 'rare', 'TRUE', 'TRUE'],
  ['rabbit', 'Rabbit', 'rabbit.png', 'common', 'TRUE', 'TRUE'],
  ['frog', 'Frog', 'frog.png', 'common', 'FALSE', 'TRUE'],
  ['dragon', 'Dragon', 'dragon.png', 'legendary', 'TRUE', 'FALSE'],
];

test('pairKey is order-independent', () => {
  assert.equal(pairKey('tiger', 'rabbit'), 'rabbit__tiger');
  assert.equal(pairKey('rabbit', 'tiger'), 'rabbit__tiger');
});

test('disabled characters are dropped; selectable_first is preserved', () => {
  const idx = buildIndex(chars, []);
  assert.deepEqual([...idx.characters.keys()].sort(), ['frog', 'rabbit', 'tiger']);
  assert.equal(idx.characters.get('frog').selectableFirst, false);
  assert.equal(idx.characters.get('tiger').selectableFirst, true);
});

test('enabled merge rows are bidirectional and keyed by sorted pair', () => {
  const idx = buildIndex(chars, [
    ['tiger', 'rabbit', 'tigbit', 'Tigbit', 'rabbit__tiger.mp4', 'TRUE', ''],
  ]);
  assert.equal(idx.byPair.size, 1);
  assert.ok(idx.byPair.has('rabbit__tiger'));
  assert.deepEqual([...idx.adjacency.get('tiger')], ['rabbit']);
  assert.deepEqual([...idx.adjacency.get('rabbit')], ['tiger']);
  assert.equal(idx.warnings.length, 0);
});

test('disabled merge rows never reach the index (the publish switch)', () => {
  const idx = buildIndex(chars, [
    ['tiger', 'rabbit', 'tigbit', 'Tigbit', 'rabbit__tiger.mp4', 'FALSE', ''],
  ]);
  assert.equal(idx.byPair.size, 0);
  assert.equal(idx.adjacency.size, 0);
});

test('merges referencing unknown or disabled characters are skipped with a warning', () => {
  const idx = buildIndex(chars, [
    ['tiger', 'dragon', 'tigron', 'Tigron', 'dragon__tiger.mp4', 'TRUE', ''],
    ['tiger', 'ghost', 'x', 'X', 'ghost__tiger.mp4', 'TRUE', ''],
  ]);
  assert.equal(idx.byPair.size, 0);
  assert.equal(idx.warnings.length, 2);
});

test('missing video_blob and self-merge are skipped with warnings', () => {
  const idx = buildIndex(chars, [
    ['tiger', 'rabbit', 'tigbit', 'Tigbit', '', 'TRUE', ''],
    ['tiger', 'tiger', 'tt', 'TT', 'tiger__tiger.mp4', 'TRUE', ''],
  ]);
  assert.equal(idx.byPair.size, 0);
  assert.match(idx.warnings[0], /missing video_blob/);
  assert.match(idx.warnings[1], /cannot merge with itself/);
});

test('duplicate pair rows warn and the later row wins', () => {
  const idx = buildIndex(chars, [
    ['tiger', 'rabbit', 'first', 'First', 'a.mp4', 'TRUE', ''],
    ['rabbit', 'tiger', 'second', 'Second', 'b.mp4', 'TRUE', ''],
  ]);
  assert.equal(idx.byPair.get('rabbit__tiger').resultId, 'second');
  assert.match(idx.warnings[0], /duplicate pair/);
});

test('values are trimmed and TRUE is case-insensitive', () => {
  const idx = buildIndex(
    [[' tiger ', ' Tiger ', ' tiger.png ', ' rare ', ' true ', 'True']],
    [[' tiger', 'rabbit ', 'x', 'X', 'v.mp4', 'TRUE', '']],
  );
  assert.ok(idx.characters.has('tiger'));
  assert.equal(idx.characters.get('tiger').name, 'Tiger');
  assert.equal(idx.characters.get('tiger').thumb, 'tiger.png');
});
