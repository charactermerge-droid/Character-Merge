/**
 * Supabase Storage: private buckets, short-lived signed URLs (the same contract as an Azure SAS).
 * Buckets are named like the spec's containers: `thumbs` and `merges`.
 *
 * The key must be a server-side key (service_role / sb_secret_...): it bypasses row-level security so the
 * server can sign URLs for private objects. It must never reach the Unity build.
 * The SDK is imported lazily so other storage modes never load it.
 */
export async function createSupabaseStorage(cfg, { client = null } = {}) {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const ttlSeconds = cfg.sasTtlMinutes * 60;

  const fail = (op, container, blob, error) => {
    const e = new Error(`supabase ${op} ${container}/${blob ?? ''}: ${error?.message || error}`);
    e.code = error?.statusCode === '404' || error?.status === 404 ? 'ENOENT' : 'ESUPABASE';
    return e;
  };

  return {
    kind: 'supabase',
    describe: () => cfg.supabaseUrl,

    async signBlob(container, blob) {
      const expiresOn = new Date(Date.now() + ttlSeconds * 1000);
      const { data, error } = await client.storage.from(container).createSignedUrl(blob, ttlSeconds);
      if (error) throw fail('sign', container, blob, error);
      return { url: data.signedUrl, expiresAt: expiresOn.toISOString() };
    },

    /** Throws if the object does not exist, like BlobClient.getProperties. */
    async getBlobProps(container, blob) {
      const { data, error } = await client.storage.from(container).info(blob);
      if (error || !data) throw fail('info', container, blob, error || 'not found');
      if (!(data.size > 0)) throw fail('info', container, blob, 'empty object');
      // Quote like an HTTP ETag; fall back to something that still changes when the file is replaced.
      const raw = data.etag || data.version || `${data.size}-${data.updatedAt || data.lastModified || ''}`;
      const etag = raw.startsWith('"') ? raw : `"${raw}"`;
      return { etag, contentLength: data.size };
    },

    async listBlobs(container) {
      const names = new Set();
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from(container).list('', { limit: 1000, offset });
        if (error) throw fail('list', container, '', error);
        for (const o of data) if (o.id) names.add(o.name); // folders come back without an id
        if (data.length < 1000) break;
      }
      return names;
    },
  };
}
