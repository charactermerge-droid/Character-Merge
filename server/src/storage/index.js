import { createLocalStorage } from './local.js';
import { createAzureStorage } from './azure.js';
import { createSupabaseStorage } from './supabase.js';

/**
 * Picks a backend and adds two memo layers on top of it:
 *  - signed URLs are reused while they have more than half their TTL left,
 *    so /bootstrap does not re-sign every thumbnail on every request and
 *    clients see stable URLs within a window;
 *  - successful blob-property lookups are remembered briefly.
 * Failures are never cached.
 */
export async function createStorage(cfg, deps = {}) {
  const impl =
    cfg.storage === 'azure' ? await createAzureStorage(cfg)
    : cfg.storage === 'supabase' ? await createSupabaseStorage(cfg, deps)
    : createLocalStorage(cfg);
  const ttlMs = cfg.sasTtlMinutes * 60 * 1000;
  const propsTtlMs = cfg.blobPropsCacheSeconds * 1000;
  const urls = new Map();   // key -> { url, expiresAt, expiresMs }
  const props = new Map();  // key -> { value, until }

  return {
    kind: impl.kind,
    describe: impl.describe,
    register: impl.register,
    listBlobs: impl.listBlobs,

    async signBlob(container, blob) {
      const key = `${container}/${blob}`;
      const hit = urls.get(key);
      if (hit && hit.expiresMs - Date.now() > ttlMs / 2) return { url: hit.url, expiresAt: hit.expiresAt };
      const signed = await impl.signBlob(container, blob);
      urls.set(key, { ...signed, expiresMs: Date.parse(signed.expiresAt) });
      return signed;
    },

    async getBlobProps(container, blob) {
      const key = `${container}/${blob}`;
      const hit = props.get(key);
      if (hit && hit.until > Date.now()) return hit.value;
      const value = await impl.getBlobProps(container, blob);
      if (propsTtlMs > 0) props.set(key, { value, until: Date.now() + propsTtlMs });
      return value;
    },

    /** Test/admin hook: forget memoized URLs and properties. */
    clearCaches() { urls.clear(); props.clear(); },
  };
}
