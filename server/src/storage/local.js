import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SAFE_CONTAINER = /^[a-z0-9-]+$/;
const SAFE_BLOB = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Local-disk storage for development and the placeholder prototype.
 * Files live in <localStorageDir>/<container>/<blob>. URLs are HMAC-signed and
 * expire like a SAS, so the client exercises the same code path as with Azure.
 */
export function createLocalStorage(cfg) {
  const root = cfg.localStorageDir;
  const ttlMs = cfg.sasTtlMinutes * 60 * 1000;
  const etagCache = new Map(); // filePath -> { size, mtimeMs, etag }

  const sign = (container, blob, exp) =>
    createHmac('sha256', cfg.localSigningSecret).update(`${container}/${blob}|${exp}`).digest('hex');

  const filePath = (container, blob) => {
    if (!SAFE_CONTAINER.test(container) || !SAFE_BLOB.test(blob) || blob.includes('..')) {
      throw Object.assign(new Error('invalid blob path'), { code: 'EINVAL' });
    }
    return path.join(root, container, blob);
  };

  // Content hash so a re-uploaded file changes its etag and the client re-downloads.
  async function contentEtag(file, stat) {
    const hit = etagCache.get(file);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.etag;
    const hash = createHash('md5');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const etag = `"${hash.digest('hex')}"`;
    etagCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, etag });
    return etag;
  }

  return {
    kind: 'local',
    describe: () => root,

    async signBlob(container, blob) {
      filePath(container, blob); // validates
      const expiresOn = new Date(Date.now() + ttlMs);
      const exp = Math.floor(expiresOn.getTime() / 1000);
      const url = `${cfg.publicBaseUrl}/local/${container}/${encodeURIComponent(blob)}?exp=${exp}&sig=${sign(container, blob, exp)}`;
      return { url, expiresAt: expiresOn.toISOString() };
    },

    /** Throws if the blob does not exist (mirrors BlobClient.getProperties). */
    async getBlobProps(container, blob) {
      const file = filePath(container, blob);
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      return { etag: await contentEtag(file, stat), contentLength: stat.size };
    },

    async listBlobs(container) {
      try {
        const names = await fs.readdir(path.join(root, container));
        return new Set(names.filter(n => !n.startsWith('.')));
      } catch (err) {
        if (err.code === 'ENOENT') return new Set();
        throw err;
      }
    },

    /** Serves the signed URLs. Registered by the app; routes never call this. */
    async register(app) {
      const fastifyStatic = (await import('@fastify/static')).default;
      await app.register(fastifyStatic, { root, serve: false, cacheControl: false });

      app.get('/local/:container/:blob', {
        config: { rateLimit: false },
        schema: {
          params: {
            type: 'object', required: ['container', 'blob'],
            properties: { container: { type: 'string' }, blob: { type: 'string' } },
          },
          querystring: {
            type: 'object', required: ['exp', 'sig'],
            properties: { exp: { type: 'integer' }, sig: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
          },
        },
      }, async (req, reply) => {
        const { container, blob } = req.params;
        const { exp, sig } = req.query;
        let rel;
        try { rel = path.relative(root, filePath(container, blob)); }
        catch { return reply.code(400).send({ error: 'bad_request' }); }

        if (exp * 1000 < Date.now()) return reply.code(403).send({ error: 'url_expired' });
        const expected = Buffer.from(sign(container, blob, exp));
        const given = Buffer.from(sig);
        if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
          return reply.code(403).send({ error: 'bad_signature' });
        }
        return reply.sendFile(rel.split(path.sep).join('/'));
      });
    },
  };
}
