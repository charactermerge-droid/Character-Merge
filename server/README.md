# Fusion backend

Sheet-driven catalog of characters and merge videos, served to the Unity client through
short-lived signed URLs. Implements `fusion-backend-spec.md`.

```
characters.csv / Google Sheet ──(loaded to memory, refreshed on a timer)──► Fastify ──► Unity
                                                                              │ signs URL
                                                                              ▼
                                                         local-storage/ or private Azure container
```

## Run locally (placeholder prototype)

```powershell
.\run-dev.ps1        # installs deps if needed, copies .env.example, generates placeholders, starts on :8080
```

or, with Node 20+ on PATH: `npm install && npm start`.

- `GET  /health`
- `GET  /api/v1/bootstrap` – first-pick roster with signed thumbnail URLs
- `GET  /api/v1/partners/:charId` – characters that have an **enabled** merge with `charId`
- `POST /api/v1/merge` `{ "a": "tiger", "b": "rabbit" }` – result + signed video URL (+ etag, bytes)
- `POST /admin/refresh` (header `x-admin-secret`) – reload the sheet now instead of waiting for the timer

Tests: `npm test` (node:test, no server needed). Content check: `npm run validate`.
See what the catalog reads: `npm run sheet`.

## Content

`fixtures/characters.csv` and `fixtures/merges.csv` are the two sheet tabs, byte-for-byte:
export the Google Sheet tabs as CSV and drop them here, or point `SHEET_SOURCE=google` at the
sheet itself. Column order matters, header row is skipped, `enabled` is the publish switch.

Placeholder media: `python scripts/gen-placeholders.py` renders a PNG card per character and a 3 s
MP4 per merge row (H.264 baseline, plays everywhere) into `local-storage/`.

Operating loop (spec §8): upload video → add row with `enabled=FALSE` → watch → flip to `TRUE` →
live within `SHEET_REFRESH_SECONDS` or immediately via `/admin/refresh`.

## Moving the catalog to a Google Sheet

1. Create a sheet with two tabs named exactly `characters` and `merges`. Import
   `fixtures/characters.csv` and `fixtures/merges.csv` into them (File > Import > Upload > "Replace current sheet").
   Row 1 is the header; the server reads row 2 down, columns in this order.
2. Google Cloud console: create (or pick) a project → APIs & Services > Library > enable **Google Sheets API**
   → IAM & Admin > Service Accounts > create one → Keys > Add key > JSON. Save the file as `server/google-sa.json`
   (gitignored).
3. Share the sheet with the service account's email (`...@...iam.gserviceaccount.com`) as **Viewer**.
   Do not use "publish to web".
4. In `.env`: `SHEET_SOURCE=google`, `SHEET_ID=<the long id in the sheet URL>`, `GOOGLE_SA_JSON_FILE=./google-sa.json`.
5. `npm run sheet` prints what the server reads and the resulting index; fix anything it flags, then `npm start`.

Edits go live within `SHEET_REFRESH_SECONDS` (default 300) or immediately with
`curl -X POST http://localhost:8080/admin/refresh -H "x-admin-secret: <ADMIN_SECRET>"`.

## Switching storage to Azure

`STORAGE=azure` + `AZURE_STORAGE_ACCOUNT`. Needs: StorageV2 account, private containers `merges`
and `thumbs`, blobs uploaded with `--content-type`, and the server's identity granted
**Storage Blob Data Reader** (`DefaultAzureCredential` picks up a managed identity, `az login`, or
`AZURE_CLIENT_*` env vars). The two switches are independent: a Google Sheet with local storage is a
fine intermediate step.

## Layout

```
src/index.js          boot: config → storage → catalog → app → listen → refresh timer
src/app.js            routes
src/sheet.js          sheet sources (local CSV, Google) + in-memory catalog (keeps last good index)
src/index-builder.js  pure: rows → characters / adjacency / byPair (+ warnings)
src/storage/          local.js (dev), azure.js (prod), index.js (memoizes signed URLs + blob props)
scripts/validate.js   pre-release content check
scripts/gen-placeholders.py
test/                 node:test suites (parser, index, endpoints)
```
