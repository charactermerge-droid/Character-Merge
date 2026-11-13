import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createSheetSource } from '../src/sheet.js';

const key = JSON.stringify({ type: 'service_account', client_email: 'bot@p.iam.gserviceaccount.com', private_key: 'k' });
const cfg = () => loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'sheet123', GOOGLE_SA_JSON: key });

/** Minimal stand-in for googleapis' sheets client: records calls, serves canned data. */
function fakeSheets({ titles, values = {}, getError = null, batchError = null }) {
  const calls = { get: 0, batchGet: [] };
  return {
    calls,
    spreadsheets: {
      async get() {
        calls.get++;
        if (getError) throw getError;
        return { data: { sheets: titles.map(title => ({ properties: { title } })) } };
      },
      values: {
        async batchGet({ ranges }) {
          calls.batchGet.push(ranges);
          if (batchError) throw batchError;
          return { data: { valueRanges: ranges.map(r => ({ values: values[r] })) } };
        },
      },
    },
  };
}

test('finds tabs by alias and case, quotes them in A1 notation, and caches the lookup', async () => {
  const sheets = fakeSheets({
    titles: ['Notes', 'Characters', 'merge'],
    values: {
      "'Characters'!A2:F": [['tiger', 'Tiger', 'tiger.png', 'rare', 'TRUE', 'TRUE']],
      "'merge'!A2:G": [['tiger', 'rabbit', 'tigbit', 'Tigbit', 'rabbit__tiger.mp4', 'TRUE', '']],
    },
  });
  const source = createSheetSource(cfg(), { sheetsClient: sheets });

  const rows = await source.fetchRows();
  assert.equal(rows.charRows.length, 1);
  assert.equal(rows.mergeRows[0][2], 'tigbit');
  assert.deepEqual(sheets.calls.batchGet[0], ["'Characters'!A2:F", "'merge'!A2:G"]);
  assert.match(source.describe(), /tabs "Characters", "merge"/);

  await source.fetchRows();
  assert.equal(sheets.calls.get, 1, 'tab titles should be resolved once');
});

test('an empty tab yields empty rows rather than an error', async () => {
  const sheets = fakeSheets({ titles: ['characters', 'merges'] }); // no values at all
  const rows = await createSheetSource(cfg(), { sheetsClient: sheets }).fetchRows();
  assert.deepEqual(rows, { charRows: [], mergeRows: [] });
});

test('missing tabs produce an error that lists what the sheet actually has', async () => {
  const sheets = fakeSheets({ titles: ['Sheet1', 'characters'] });
  await assert.rejects(
    () => createSheetSource(cfg(), { sheetsClient: sheets }).fetchRows(),
    /need tabs named "characters" and "merges" \(found: "Sheet1", "characters"\)/,
  );
});

test('permission and API errors are translated into the fix', async () => {
  const forbidden = fakeSheets({ titles: [], getError: Object.assign(new Error('The caller does not have permission'), { code: 403 }) });
  await assert.rejects(
    () => createSheetSource(cfg(), { sheetsClient: forbidden }).fetchRows(),
    /Share the sheet with bot@p\.iam\.gserviceaccount\.com as Viewer/,
  );

  const disabled = fakeSheets({ titles: [], getError: new Error('Google Sheets API has not been used in project 123 before or it is disabled') });
  await assert.rejects(
    () => createSheetSource(cfg(), { sheetsClient: disabled }).fetchRows(),
    /enable the Google Sheets API/,
  );
});

test('a failure after tab resolution forgets the cached titles', async () => {
  const sheets = fakeSheets({ titles: ['characters', 'merges'], batchError: new Error('Unable to parse range: merges!A2:G') });
  const source = createSheetSource(cfg(), { sheetsClient: sheets });
  await assert.rejects(() => source.fetchRows(), /tab not found/);
  await assert.rejects(() => source.fetchRows());
  assert.equal(sheets.calls.get, 2, 'titles are re-resolved after a failure');
});
