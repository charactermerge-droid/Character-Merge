import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createStorage } from '../src/storage/index.js';

const env = { STORAGE: 'supabase', SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_SERVICE_KEY: 'sb_secret_test' };

/** Stand-in for supabase-js: `objects` is { 'bucket/name': { size, etag } }. Records calls. */
function fakeClient(objects) {
  const calls = { sign: [], info: [] };
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(name, expiresIn) {
            calls.sign.push([bucket, name, expiresIn]);
            return { data: { signedUrl: `https://abc.supabase.co/storage/v1/object/sign/${bucket}/${name}?token=t${calls.sign.length}` }, error: null };
          },
          async info(name) {
            calls.info.push([bucket, name]);
            const o = objects[`${bucket}/${name}`];
            return o ? { data: o, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } };
          },
          async list() {
            const names = Object.keys(objects).filter(k => k.startsWith(bucket + '/')).map(k => ({ id: k, name: k.slice(bucket.length + 1) }));
            return { data: [...names, { id: null, name: 'some-folder' }], error: null };
          },
        };
      },
    },
  };
}

test('config requires an https Supabase URL and a server key, and trims the URL', () => {
  assert.throws(() => loadConfig({ STORAGE: 'supabase' }), /SUPABASE_URL/);
  assert.throws(() => loadConfig({ STORAGE: 'supabase', SUPABASE_URL: 'https://abc.supabase.co' }), /SUPABASE_SERVICE_KEY/);
  assert.equal(loadConfig(env).supabaseUrl, 'https://abc.supabase.co');
});

test('signs with the configured TTL and memoizes within the window', async () => {
  const client = fakeClient({ 'merges/rabbit__tiger.mp4': { size: 100, etag: 'abc' } });
  const storage = await createStorage(loadConfig({ ...env, SAS_TTL_MINUTES: '30' }), { client });
  const a = await storage.signBlob('merges', 'rabbit__tiger.mp4');
  const b = await storage.signBlob('merges', 'rabbit__tiger.mp4');
  assert.match(a.url, /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/sign\/merges\/rabbit__tiger\.mp4\?token=/);
  assert.equal(a.url, b.url);
  assert.deepEqual(client.calls.sign, [['merges', 'rabbit__tiger.mp4', 1800]]);
  assert.ok(Math.abs(Date.parse(a.expiresAt) - Date.now() - 30 * 60_000) < 5_000);
});

test('blob props expose a quoted etag and size; missing or empty objects throw', async () => {
  const client = fakeClient({
    'merges/a.mp4': { size: 94778, etag: 'e1' },
    'merges/quoted.mp4': { size: 5, etag: '"q"' },
    'merges/noetag.mp4': { size: 7, updatedAt: '2026-11-13T00:00:00Z' },
    'merges/empty.mp4': { size: 0, etag: 'z' },
  });
  const storage = await createStorage(loadConfig(env), { client });
  assert.deepEqual(await storage.getBlobProps('merges', 'a.mp4'), { etag: '"e1"', contentLength: 94778 });
  assert.equal((await storage.getBlobProps('merges', 'quoted.mp4')).etag, '"q"');
  assert.equal((await storage.getBlobProps('merges', 'noetag.mp4')).etag, '"7-2026-11-13T00:00:00Z"');
  await assert.rejects(() => storage.getBlobProps('merges', 'missing.mp4'), e => e.code === 'ENOENT');
  await assert.rejects(() => storage.getBlobProps('merges', 'empty.mp4'), /empty object/);
});

test('listBlobs returns object names and skips folders', async () => {
  const client = fakeClient({ 'thumbs/tiger.png': { size: 1 }, 'thumbs/owl.png': { size: 1 }, 'merges/x.mp4': { size: 1 } });
  const storage = await createStorage(loadConfig(env), { client });
  assert.deepEqual([...await storage.listBlobs('thumbs')].sort(), ['owl.png', 'tiger.png']);
});
