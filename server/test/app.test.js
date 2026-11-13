import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createSheetSource, createCatalog } from '../src/sheet.js';
import { createStorage } from '../src/storage/index.js';
import { buildApp } from '../src/app.js';

const CHARACTERS = `id,display_name,thumb_blob,tier,selectable_first,enabled
tiger,Tiger,tiger.png,rare,TRUE,TRUE
rabbit,Rabbit,rabbit.png,common,TRUE,TRUE
frog,Frog,frog.png,common,FALSE,TRUE
owl,Owl,owl.png,legendary,TRUE,TRUE
dragon,Dragon,dragon.png,legendary,TRUE,FALSE
`;
const MERGES = `char_a,char_b,result_id,result_name,video_blob,enabled,notes
tiger,rabbit,tigbit,Tigbit,rabbit__tiger.mp4,TRUE,
frog,tiger,tigrog,Tigrog,frog__tiger.mp4,TRUE,
owl,tiger,tigowl,Tigowl,owl__tiger.mp4,TRUE,video not uploaded
rabbit,owl,owlbit,Owlbit,owl__rabbit.mp4,FALSE,not approved
`;

let tmp, app, catalog, storage, cfg;
const quiet = { info() {}, warn() {}, error() {} };

async function setup({ ttlMinutes = 60 } = {}) {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fusion-test-'));
  await fs.mkdir(path.join(tmp, 'fixtures'));
  await fs.mkdir(path.join(tmp, 'storage', 'merges'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'storage', 'thumbs'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'fixtures', 'characters.csv'), CHARACTERS);
  await fs.writeFile(path.join(tmp, 'fixtures', 'merges.csv'), MERGES);
  for (const t of ['tiger', 'rabbit', 'frog', 'owl']) {
    await fs.writeFile(path.join(tmp, 'storage', 'thumbs', `${t}.png`), `png:${t}`);
  }
  await fs.writeFile(path.join(tmp, 'storage', 'merges', 'rabbit__tiger.mp4'), 'mp4:rabbit__tiger');
  await fs.writeFile(path.join(tmp, 'storage', 'merges', 'frog__tiger.mp4'), 'mp4:frog__tiger');
  // owl__tiger.mp4 deliberately missing

  cfg = loadConfig({
    PORT: '8080',
    PUBLIC_BASE_URL: 'http://localhost:8080',
    ADMIN_SECRET: 'test-secret',
    SHEET_SOURCE: 'local',
    SHEET_LOCAL_DIR: path.join(tmp, 'fixtures'),
    STORAGE: 'local',
    LOCAL_STORAGE_DIR: path.join(tmp, 'storage'),
    LOCAL_SIGNING_SECRET: 'unit-test-secret',
    RATE_LIMIT_PER_MINUTE: '1000',
  });
  cfg.sasTtlMinutes = ttlMinutes;

  storage = await createStorage(cfg);
  catalog = createCatalog({ source: createSheetSource(cfg), logger: quiet });
  await catalog.load();
  app = await buildApp({ cfg, catalog, storage, logger: false });
  await app.ready();
}

async function teardown() {
  await app?.close();
  await fs.rm(tmp, { recursive: true, force: true });
}

before(() => setup());
after(() => teardown());

const get = url => app.inject({ method: 'GET', url });
const post = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const pathOf = url => url.replace(/^https?:\/\/[^/]+/, '');

test('health reports the loaded index', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.characters, 4);   // dragon disabled
  assert.equal(body.merges, 3);       // owl+rabbit disabled; owl+tiger is enabled (asset missing is caught at /merge)
  assert.equal(body.storage, 'local');
});

test('bootstrap lists only selectable_first characters with signed thumbs', async () => {
  const res = await get('/api/v1/bootstrap');
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.sasTtlMinutes, 60);
  assert.deepEqual(body.characters.map(c => c.id).sort(), ['owl', 'rabbit', 'tiger']); // frog: selectable_first=FALSE
  for (const c of body.characters) {
    assert.match(c.thumb, /^http:\/\/localhost:8080\/local\/thumbs\/[a-z]+\.png\?exp=\d+&sig=[0-9a-f]{64}$/);
  }
  // signed thumb actually downloads
  const dl = await get(pathOf(body.characters.find(c => c.id === 'tiger').thumb));
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.body, 'png:tiger');
  assert.equal(dl.headers['content-type'], 'image/png');
});

test('partners returns only characters with an enabled merge, in both directions', async () => {
  const tiger = (await get('/api/v1/partners/tiger')).json();
  assert.deepEqual(tiger.partners.map(p => p.id).sort(), ['frog', 'owl', 'rabbit']);
  const frog = (await get('/api/v1/partners/frog')).json();   // frog is not first-pickable but is a valid partner
  assert.deepEqual(frog.partners.map(p => p.id), ['tiger']);
  const owl = (await get('/api/v1/partners/owl')).json();
  assert.deepEqual(owl.partners.map(p => p.id), ['tiger']);    // owl+rabbit disabled
  const unknown = await get('/api/v1/partners/ghost');
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error, 'unknown_character');
  const disabled = await get('/api/v1/partners/dragon');
  assert.equal(disabled.statusCode, 404);
});

test('merge returns result + signed video URL with etag and size; order does not matter', async () => {
  const r1 = await post('/api/v1/merge', { a: 'tiger', b: 'rabbit' });
  assert.equal(r1.statusCode, 200);
  const m = r1.json();
  assert.equal(m.pairKey, 'rabbit__tiger');
  assert.deepEqual(m.result, { id: 'tigbit', name: 'Tigbit' });
  assert.equal(m.video.bytes, 'mp4:rabbit__tiger'.length);
  assert.match(m.video.etag, /^"[0-9a-f]{32}"$/);
  assert.ok(Date.parse(m.video.expiresAt) > Date.now());

  const r2 = await post('/api/v1/merge', { a: 'rabbit', b: 'tiger' });
  assert.equal(r2.json().pairKey, 'rabbit__tiger');
  assert.equal(r2.json().video.url, m.video.url); // memoized within the TTL window

  const dl = await get(pathOf(m.video.url));
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.body, 'mp4:rabbit__tiger');
  assert.equal(dl.headers['content-type'], 'video/mp4');
});

test('merge rejects bad input, unknown ids, and pairs without an enabled row', async () => {
  assert.equal((await post('/api/v1/merge', { a: 'tiger', b: 'tiger' })).statusCode, 400);
  assert.equal((await post('/api/v1/merge', { a: 'tiger' })).statusCode, 400);
  assert.equal((await post('/api/v1/merge', { a: {}, b: 'tiger' })).statusCode, 400);
  assert.equal((await post('/api/v1/merge', { a: '', b: 'tiger' })).statusCode, 400);
  assert.equal((await post('/api/v1/merge', { a: 1, b: 2 })).statusCode, 404); // AJV coerces numbers to strings; ids are then simply unknown
  assert.equal((await post('/api/v1/merge', 'not json', { 'content-type': 'application/json' })).statusCode, 400);

  const unknown = await post('/api/v1/merge', { a: 'tiger', b: 'ghost' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error, 'unknown_character');

  const disabledRow = await post('/api/v1/merge', { a: 'rabbit', b: 'owl' });
  assert.equal(disabledRow.statusCode, 404);
  assert.equal(disabledRow.json().error, 'merge_not_found');
});

test('merge with an enabled row but missing asset fails with 503 asset_missing', async () => {
  const res = await post('/api/v1/merge', { a: 'owl', b: 'tiger' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'asset_missing');
});

test('signed URLs reject tampering and traversal', async () => {
  const m = (await post('/api/v1/merge', { a: 'tiger', b: 'frog' })).json();
  const url = new URL(m.video.url);
  const badSig = `${url.pathname}?exp=${url.searchParams.get('exp')}&sig=${'0'.repeat(64)}`;
  assert.equal((await get(badSig)).statusCode, 403);
  const otherBlob = `${url.pathname.replace('frog__tiger', 'rabbit__tiger')}?${url.searchParams}`;
  assert.equal((await get(otherBlob)).statusCode, 403);
  assert.equal((await get('/local/merges/..%2F..%2Fpackage.json?exp=9999999999&sig=' + '0'.repeat(64))).statusCode, 400);
  assert.equal((await get('/local/merges/frog__tiger.mp4')).statusCode, 400); // no token at all
});

test('admin refresh requires the secret and picks up sheet changes', async () => {
  assert.equal((await post('/admin/refresh', {})).statusCode, 401);
  assert.equal((await post('/admin/refresh', {}, { 'x-admin-secret': 'wrong' })).statusCode, 401);

  // approve the owl+rabbit row
  await fs.writeFile(path.join(tmp, 'fixtures', 'merges.csv'), MERGES.replace('owl__rabbit.mp4,FALSE', 'owl__rabbit.mp4,TRUE'));
  const res = await post('/admin/refresh', {}, { 'x-admin-secret': 'test-secret' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().merges, 4);
  const owl = (await get('/api/v1/partners/owl')).json();
  assert.deepEqual(owl.partners.map(p => p.id).sort(), ['rabbit', 'tiger']);
});

test('a failed refresh keeps the previous index', async () => {
  const before = catalog.cache.version;
  await fs.rm(path.join(tmp, 'fixtures', 'merges.csv'));
  await assert.rejects(() => catalog.load());
  assert.equal(catalog.cache.version, before);
  assert.equal(catalog.cache.byPair.size, 4);
  await fs.writeFile(path.join(tmp, 'fixtures', 'merges.csv'), MERGES);
});

test('expired signed URLs are refused', async () => {
  await teardown();
  await setup({ ttlMinutes: 0.0005 }); // 30 ms
  const m = (await post('/api/v1/merge', { a: 'tiger', b: 'rabbit' })).json();
  await new Promise(r => setTimeout(r, 1100)); // exp has 1 s resolution
  const dl = await get(pathOf(m.video.url));
  assert.equal(dl.statusCode, 403);
  assert.equal(dl.json().error, 'url_expired');
});
