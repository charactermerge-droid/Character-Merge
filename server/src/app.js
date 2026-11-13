import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { pairKey } from './pairKey.js';

const MERGES = 'merges';
const THUMBS = 'thumbs';

/**
 * Builds the HTTP app. Nothing here touches the sheet: every request reads the
 * catalog's in-memory index and asks storage for short-lived signed URLs.
 */
export async function buildApp({ cfg, catalog, storage, logger = true }) {
  const app = Fastify({ logger, trustProxy: true });

  await app.register(rateLimit, {
    max: cfg.rateLimitPerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({ error: 'rate_limited', retryAfterMs: ctx.ttl }),
  });
  if (storage.register) await storage.register(app);

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ error: 'bad_request', message: err.message });
    if (err.statusCode === 429) return reply.code(429).send(err);
    if (err.statusCode >= 400 && err.statusCode < 500) {   // e.g. malformed JSON body
      return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  const presentCharacter = async c => ({
    id: c.id,
    name: c.name,
    tier: c.tier,
    thumb: c.thumb ? (await storage.signBlob(THUMBS, c.thumb)).url : '',
  });

  app.get('/health', { config: { rateLimit: false } }, async () => {
    const { version, loadedAt, characters, byPair } = catalog.cache;
    return {
      ok: true,
      version,
      loadedAt: loadedAt ? new Date(loadedAt).toISOString() : null,
      characters: characters.size,
      merges: byPair.size,
      storage: storage.kind,
    };
  });

  // Loading screen: everything selectable as a first pick.
  app.get('/api/v1/bootstrap', async () => {
    const { version, characters } = catalog.cache;
    const list = [...characters.values()].filter(c => c.selectableFirst);
    return {
      version,
      sasTtlMinutes: cfg.sasTtlMinutes,
      characters: await Promise.all(list.map(presentCharacter)),
    };
  });

  // After the first pick: only characters that have an enabled merge with :charId.
  app.get('/api/v1/partners/:charId', async (req, reply) => {
    const id = String(req.params.charId).trim();
    const { characters, adjacency } = catalog.cache;
    if (!characters.has(id)) return reply.code(404).send({ error: 'unknown_character' });

    const ids = [...(adjacency.get(id) || [])];
    const partners = await Promise.all(ids.map(pid => presentCharacter(characters.get(pid))));
    return { id, partners };
  });

  app.post('/api/v1/merge', {
    schema: {
      body: {
        type: 'object', required: ['a', 'b'],
        properties: { a: { type: 'string', minLength: 1 }, b: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req, reply) => {
    const a = req.body.a.trim(), b = req.body.b.trim();
    if (!a || !b || a === b) return reply.code(400).send({ error: 'bad_request' });

    const { characters, byPair } = catalog.cache;
    if (!characters.has(a) || !characters.has(b)) return reply.code(404).send({ error: 'unknown_character' });

    const merge = byPair.get(pairKey(a, b));
    if (!merge) return reply.code(404).send({ error: 'merge_not_found' });

    // Row is enabled but the video was never uploaded: fail cleanly instead of at playback.
    let props;
    try {
      props = await storage.getBlobProps(MERGES, merge.blob);
    } catch (err) {
      req.log.warn({ pairKey: merge.pairKey, blob: merge.blob, err: err.message }, 'merge asset missing');
      return reply.code(503).send({ error: 'asset_missing' });
    }

    const { url, expiresAt } = await storage.signBlob(MERGES, merge.blob);
    return {
      pairKey: merge.pairKey,
      result: { id: merge.resultId, name: merge.resultName },
      video: { url, expiresAt, etag: props.etag, bytes: props.contentLength },
    };
  });

  app.post('/admin/refresh', async (req, reply) => {
    const given = String(req.headers['x-admin-secret'] || '');
    if (!cfg.adminSecret || !safeEqual(given, cfg.adminSecret)) return reply.code(401).send({ error: 'unauthorized' });
    await catalog.load();
    const { version, characters, byPair, warnings } = catalog.cache;
    return { ok: true, version, characters: characters.size, merges: byPair.size, warnings };
  });

  return app;
}

function safeEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
