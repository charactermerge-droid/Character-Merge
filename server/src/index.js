import { loadConfig } from './config.js';
import { createSheetSource, createCatalog } from './sheet.js';
import { createStorage } from './storage/index.js';
import { buildApp } from './app.js';

// .env is optional; real deployments inject environment variables directly.
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const cfg = loadConfig();
const storage = await createStorage(cfg);
const catalog = createCatalog({ source: createSheetSource(cfg) });
const app = await buildApp({ cfg, catalog, storage });

// Fail fast: without an index there is nothing to serve.
await catalog.load();

if (!cfg.adminSecret) app.log.warn('ADMIN_SECRET is not set; POST /admin/refresh is disabled');
app.log.info(`storage=${storage.kind} (${storage.describe()})  sheet=${cfg.sheetSource}  sas_ttl=${cfg.sasTtlMinutes}m`);

await app.listen({ port: cfg.port, host: cfg.host });
catalog.startAutoRefresh(cfg.sheetRefreshSeconds);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    catalog.stop();
    await app.close();
    process.exit(0);
  });
}
