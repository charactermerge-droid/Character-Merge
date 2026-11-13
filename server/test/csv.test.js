import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('parses simple rows and skips blank lines', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n\n4,5,6\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
});

test('handles CRLF, quotes, embedded commas and doubled quotes', () => {
  const rows = parseCsv('x,y\r\n"hello, world","say ""hi"""\r\n');
  assert.deepEqual(rows, [['x', 'y'], ['hello, world', 'say "hi"']]);
});

test('strips a UTF-8 BOM and keeps trailing empty fields', () => {
  const rows = parseCsv('﻿id,notes\ntiger,\n');
  assert.deepEqual(rows, [['id', 'notes'], ['tiger', '']]);
});

test('quoted fields may contain newlines', () => {
  const rows = parseCsv('a,b\n"line1\nline2",z');
  assert.deepEqual(rows, [['a', 'b'], ['line1\nline2', 'z']]);
});
