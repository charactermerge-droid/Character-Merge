import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './csv.js';
import { buildIndex } from './index-builder.js';

/**
 * A sheet source returns the raw rows of both tabs, header row removed.
 * The "local" source reads characters.csv + merges.csv (export the Google
 * Sheet tabs as CSV and the files are byte-for-byte what the server expects).
 */
export function createSheetSource(cfg, deps = {}) {
  if (cfg.sheetSource === 'google') return createGoogleSource(cfg, deps);
  return createLocalSource(cfg);
}

function createLocalSource(cfg) {
  const readTab = async name => {
    const file = path.join(cfg.sheetLocalDir, `${name}.csv`);
    const rows = parseCsv(await fs.readFile(file, 'utf8'));
    return rows.slice(1); // drop header
  };
  return {
    kind: 'local',
    describe: () => cfg.sheetLocalDir,
    async fetchRows() {
      const [charRows, mergeRows] = await Promise.all([readTab('characters'), readTab('merges')]);
      return { charRows, mergeRows };
    },
  };
}

// Accepted tab titles, compared trimmed and case-insensitively.
const TAB_ALIASES = {
  characters: ['characters', 'character'],
  merges: ['merges', 'merge'],
};

function createGoogleSource(cfg, { sheetsClient = null } = {}) {
  let tabs = null; // resolved once: { characters: 'characters', merges: 'merge' }

  const getClient = async () => {
    if (sheetsClient) return sheetsClient;
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(cfg.googleSaJson),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  };

  // Look the tab titles up so "merge" vs "merges" or a capital letter is not a config error.
  const resolveTabs = async sheets => {
    if (tabs) return tabs;
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: cfg.sheetId, fields: 'sheets.properties.title' });
    const titles = (data.sheets || []).map(s => s.properties.title);
    const pick = aliases => titles.find(t => aliases.includes(t.trim().toLowerCase()));
    const found = { characters: pick(TAB_ALIASES.characters), merges: pick(TAB_ALIASES.merges) };
    if (!found.characters || !found.merges) {
      throw new Error(`Google Sheets: need tabs named "characters" and "merges" (found: ${titles.map(t => `"${t}"`).join(', ') || 'none'})`);
    }
    tabs = found;
    return tabs;
  };

  const a1 = (tab, range) => `'${tab.replace(/'/g, "''")}'!${range}`;

  return {
    kind: 'google',
    describe: () => `sheet ${cfg.sheetId}` + (tabs ? ` (tabs "${tabs.characters}", "${tabs.merges}")` : ''),
    async fetchRows() {
      const sheets = await getClient();
      let data;
      try {
        const t = await resolveTabs(sheets);
        ({ data } = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: cfg.sheetId,
          ranges: [a1(t.characters, 'A2:F'), a1(t.merges, 'A2:G')],
        }));
      } catch (err) {
        tabs = null; // a renamed tab would surface here; re-resolve next time
        throw new Error(describeGoogleError(err, cfg));
      }
      const [charRows = [], mergeRows = []] = (data.valueRanges || []).map(r => r.values || []);
      return { charRows, mergeRows };
    },
  };
}

// Translate the Sheets API's terse errors into the fix.
function describeGoogleError(err, cfg) {
  const status = err.code || err.status;
  const msg = err.message || String(err);
  if (msg.startsWith('Google Sheets:')) return msg;
  if (status === 403 || status === 404) {
    return `Google Sheets: ${status} for sheet ${cfg.sheetId}. Share the sheet with ${cfg.googleSaEmail} as Viewer, and check SHEET_ID. (${msg})`;
  }
  if (/Unable to parse range/i.test(msg)) {
    return `Google Sheets: tab not found. The sheet needs tabs named exactly "characters" and "merges". (${msg})`;
  }
  if (/API has not been used|is disabled/i.test(msg)) {
    return `Google Sheets: enable the Google Sheets API for the service account's project. (${msg})`;
  }
  return `Google Sheets: ${msg}`;
}

/**
 * The catalog is the in-memory index the request path reads from.
 * A failed refresh keeps the previous good index; the sheet is never in the request path.
 */
export function createCatalog({ source, logger = console }) {
  let cache = {
    version: 0,
    loadedAt: 0,
    characters: new Map(),
    adjacency: new Map(),
    byPair: new Map(),
    warnings: [],
  };
  let timer = null;
  let inflight = null;

  async function load() {
    if (inflight) return inflight; // coalesce concurrent refreshes
    inflight = (async () => {
      const { charRows, mergeRows } = await source.fetchRows();
      const idx = buildIndex(charRows, mergeRows);
      const now = Date.now();
      cache = { ...idx, version: now, loadedAt: now };
      if (idx.warnings.length) logger.warn('[sheet] issues:\n  ' + idx.warnings.join('\n  '));
      logger.info(`[sheet] loaded ${idx.characters.size} characters, ${idx.byPair.size} merges from ${source.describe()}`);
      return cache;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  return {
    get cache() { return cache; },
    load,
    startAutoRefresh(seconds) {
      if (timer || !(seconds > 0)) return;
      timer = setInterval(() => load().catch(err => logger.error('[sheet] refresh failed, keeping previous index:', err.message)), seconds * 1000);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
