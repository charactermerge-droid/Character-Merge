import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const fakeKey = { type: 'service_account', client_email: 'bot@project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' };

test('defaults to local sheet + local storage with no env at all', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.sheetSource, 'local');
  assert.equal(cfg.storage, 'local');
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.publicBaseUrl, 'http://localhost:8080');
  assert.equal(cfg.localSigningSecret.length, 64); // random per boot
});

test('google source requires SHEET_ID; without a key it falls back to ambient credentials', () => {
  assert.throws(() => loadConfig({ SHEET_SOURCE: 'google' }), /SHEET_ID/);
  const adc = loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'x', GOOGLE_SA_EMAIL: 'run@p.iam.gserviceaccount.com' });
  assert.equal(adc.googleSaJson, '');
  assert.equal(adc.googleSaEmail, 'run@p.iam.gserviceaccount.com');
  assert.throws(() => loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'x', GOOGLE_SA_JSON: '{not json' }), /not valid JSON/);
  assert.throws(() => loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'x', GOOGLE_SA_JSON: '{"type":"authorized_user"}' }), /service-account key/);
});

test('google key can be given inline or as a file, and exposes the account email', async () => {
  const inline = loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'x', GOOGLE_SA_JSON: JSON.stringify(fakeKey) });
  assert.equal(inline.googleSaEmail, fakeKey.client_email);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fusion-cfg-'));
  const file = path.join(dir, 'google-sa.json');
  await fs.writeFile(file, JSON.stringify(fakeKey));
  const fromFile = loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'x', GOOGLE_SA_JSON_FILE: 'google-sa.json' }, { cwd: dir });
  assert.equal(fromFile.googleSaEmail, fakeKey.client_email);
  assert.equal(fromFile.googleSaJson, JSON.stringify(fakeKey));

  assert.throws(() => loadConfig({ SHEET_SOURCE: 'google', SHEET_ID: 'x', GOOGLE_SA_JSON_FILE: 'missing.json' }, { cwd: dir }), /cannot read/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('rejects unknown modes and out-of-range SAS TTL', () => {
  assert.throws(() => loadConfig({ SHEET_SOURCE: 'excel' }), /SHEET_SOURCE/);
  assert.throws(() => loadConfig({ STORAGE: 's3' }), /STORAGE/);
  assert.throws(() => loadConfig({ STORAGE: 'azure' }), /AZURE_STORAGE_ACCOUNT/);
  assert.throws(() => loadConfig({ SAS_TTL_MINUTES: '90' }), /SAS_TTL_MINUTES/);
});

test('a missing key file is ignored in local mode', () => {
  const cfg = loadConfig({ SHEET_SOURCE: 'local', GOOGLE_SA_JSON_FILE: './does-not-exist.json' });
  assert.equal(cfg.sheetSource, 'local');
  assert.equal(cfg.googleSaJson, '');
});

test('public base URL: explicit setting wins, then the Render URL, then localhost', () => {
  assert.equal(loadConfig({ RENDER_EXTERNAL_URL: 'https://fusion.onrender.com/' }).publicBaseUrl, 'https://fusion.onrender.com');
  assert.equal(loadConfig({ PUBLIC_BASE_URL: 'https://x.test', RENDER_EXTERNAL_URL: 'https://fusion.onrender.com' }).publicBaseUrl, 'https://x.test');
  assert.equal(loadConfig({ PORT: '9000' }).publicBaseUrl, 'http://localhost:9000');
});
