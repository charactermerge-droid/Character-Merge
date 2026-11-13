#!/usr/bin/env node
/**
 * Creates the private `thumbs` and `merges` buckets in Supabase (if missing) and uploads media into them.
 *
 *   npm run upload                         # uploads server/local-storage/{thumbs,merges}/*
 *   npm run upload -- --dir D:/renders     # a folder containing thumbs/ and/or merges/
 *   npm run upload -- --dry-run            # show what would happen
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (in server/.env). Existing objects are overwritten only when the
 * local file differs in size, so re-running is cheap. Content-Type is set explicitly (spec §2.3: playback breaks
 * in some clients without it).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

try { process.loadEnvFile?.(); } catch { /* optional */ }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = path.resolve(args.includes('--dir') ? args[args.indexOf('--dir') + 1] : path.join(HERE, '..', 'local-storage'));
const dryRun = args.includes('--dry-run');

const BUCKETS = {
  thumbs: { types: { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }, limit: '5MB' },
  merges: { types: { '.mp4': 'video/mp4' }, limit: '50MB' },
};

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in server/.env first.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let uploaded = 0, skipped = 0, failed = 0;

for (const [bucket, { types, limit }] of Object.entries(BUCKETS)) {
  const { data: existing } = await supabase.storage.getBucket(bucket);
  if (!existing) {
    console.log(`bucket ${bucket}: creating (private)`);
    if (!dryRun) {
      const { error } = await supabase.storage.createBucket(bucket, {
        public: false, fileSizeLimit: limit, allowedMimeTypes: [...new Set(Object.values(types))],
      });
      if (error) { console.error(`  ${error.message}`); process.exit(1); }
    }
  } else if (existing.public) {
    console.warn(`bucket ${bucket}: WARNING it is PUBLIC; anyone can download without a signed URL. Make it private in the dashboard.`);
  } else {
    console.log(`bucket ${bucket}: exists (private)`);
  }

  let files;
  try { files = (await fs.readdir(path.join(dir, bucket))).filter(f => !f.startsWith('.')); }
  catch { console.log(`  no ${path.join(dir, bucket)}; nothing to upload`); continue; }

  const remote = new Map();
  if (existing) {
    const { data } = await supabase.storage.from(bucket).list('', { limit: 1000 });
    for (const o of data || []) if (o.id) remote.set(o.name, o.metadata?.size);
  }

  for (const name of files.sort()) {
    const type = types[path.extname(name).toLowerCase()];
    if (!type) { console.log(`  skip ${name} (not a ${Object.keys(types).join('/')} file)`); continue; }
    const body = await fs.readFile(path.join(dir, bucket, name));
    if (remote.get(name) === body.length) { skipped++; console.log(`  same  ${name}`); continue; }
    console.log(`  ${remote.has(name) ? 'update' : 'upload'} ${name}  (${Math.round(body.length / 1024)} KB, ${type})`);
    if (dryRun) continue;
    const { error } = await supabase.storage.from(bucket).upload(name, body, { contentType: type, upsert: true });
    if (error) { failed++; console.error(`    FAILED: ${error.message}`); } else uploaded++;
  }
}

console.log(`\n${dryRun ? '[dry run] ' : ''}uploaded ${uploaded}, unchanged ${skipped}, failed ${failed}`);
process.exit(failed ? 1 : 0);
