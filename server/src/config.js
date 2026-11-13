import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
const oneOf = (name, v, allowed) => {
  if (!allowed.includes(v)) throw new Error(`${name} must be one of ${allowed.join('|')}, got "${v}"`);
  return v;
};

/** Read + validate configuration from an env object (process.env by default). */
export function loadConfig(env = process.env, { cwd = process.cwd() } = {}) {
  const port = int(env.PORT, 8080);
  const cfg = {
    port,
    host: env.HOST || '0.0.0.0',
    // Baked into every signed URL. Render provides its own public URL; elsewhere set PUBLIC_BASE_URL.
    publicBaseUrl: (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    adminSecret: env.ADMIN_SECRET || '',
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 120),

    sheetSource: oneOf('SHEET_SOURCE', env.SHEET_SOURCE || 'local', ['local', 'google']),
    sheetLocalDir: path.resolve(cwd, env.SHEET_LOCAL_DIR || './fixtures'),
    sheetRefreshSeconds: int(env.SHEET_REFRESH_SECONDS, 300),
    sheetId: env.SHEET_ID || '',
    // Either the key JSON inline, or (friendlier) a path to the downloaded key file.
    googleSaJson: env.GOOGLE_SA_JSON || '',
    googleSaJsonFile: env.GOOGLE_SA_JSON_FILE ? path.resolve(cwd, env.GOOGLE_SA_JSON_FILE) : '',

    storage: oneOf('STORAGE', env.STORAGE || 'local', ['local', 'azure', 'supabase']),
    localStorageDir: path.resolve(cwd, env.LOCAL_STORAGE_DIR || './local-storage'),
    localSigningSecret: env.LOCAL_SIGNING_SECRET || randomBytes(32).toString('hex'),
    azureStorageAccount: env.AZURE_STORAGE_ACCOUNT || '',
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY || '',
    sasTtlMinutes: int(env.SAS_TTL_MINUTES, 60),
    blobPropsCacheSeconds: int(env.BLOB_PROPS_CACHE_SECONDS, 60),
  };

  if (cfg.sheetSource === 'google') {
    if (!cfg.sheetId) throw new Error('SHEET_ID is required when SHEET_SOURCE=google (the long id in the sheet URL)');
    if (!cfg.googleSaJson && cfg.googleSaJsonFile) cfg.googleSaJson = readKeyFile(cfg.googleSaJsonFile); // only read in google mode
    if (cfg.googleSaJson) {
      let key;
      try { key = JSON.parse(cfg.googleSaJson); } catch { throw new Error('GOOGLE_SA_JSON is not valid JSON'); }
      if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
        throw new Error('GOOGLE_SA_JSON is not a service-account key (expected type=service_account with client_email and private_key)');
      }
      cfg.googleSaEmail = key.client_email;
    } else {
      // No key: Application Default Credentials. On Cloud Run that is the service's own identity
      // (no key file exists anywhere); locally it is `gcloud auth application-default login`.
      cfg.googleSaEmail = env.GOOGLE_SA_EMAIL || 'the identity the server runs as';
    }
  }
  if (cfg.storage === 'supabase') {
    if (!/^https:\/\/.+/.test(cfg.supabaseUrl)) throw new Error('SUPABASE_URL is required when STORAGE=supabase (https://<project>.supabase.co)');
    if (!cfg.supabaseServiceKey) throw new Error('SUPABASE_SERVICE_KEY is required when STORAGE=supabase (the secret / service_role key)');
  }
  if (cfg.storage === 'azure' && !cfg.azureStorageAccount) {
    throw new Error('AZURE_STORAGE_ACCOUNT is required when STORAGE=azure');
  }
  if (!(cfg.sasTtlMinutes > 0 && cfg.sasTtlMinutes <= 60)) {
    throw new Error('SAS_TTL_MINUTES must be between 1 and 60');
  }
  return cfg;
}

function readKeyFile(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (err) { throw new Error(`GOOGLE_SA_JSON_FILE: cannot read ${file} (${err.message})`); }
}
