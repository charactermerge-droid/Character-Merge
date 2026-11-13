# Staging on Google Cloud Run, with the Google Sheet as the catalog

> **Parked (2026-11-13):** billing could not be set up on the new account, so staging runs on Render instead,
> see [render-and-google-sheet.md](render-and-google-sheet.md). The project `charactermerge-staging` and the
> `fusion-server` service account are shared with the Render setup. Everything here works once billing is linked.

```
Google Sheet ──(Sheets API, read-only, as fusion-server@<project>)──► Cloud Run: fusion-server ──HTTPS──► Unity (Staging)
                                                                         └─ placeholder thumbs/videos baked into the image
```

- **Catalog**: the Google Sheet (`SHEET_SOURCE=google`). Editing a row goes live within 5 minutes, or at once via `/admin/refresh`.
- **Identity**: the service runs *as* the service account `fusion-server@<project>.iam.gserviceaccount.com`.
  **No key file is created**: Google's client library picks the identity up from Cloud Run itself.
- **Assets**: `STORAGE=local`. The `server/local-storage/` placeholders ship inside the container image, and URLs are
  HMAC-signed with a secret shared by every instance. Moving to real storage (R2/Azure) later is a server change only.
- **Cost guard**: `--max-instances 2`, `--min-instances 0` (scales to zero when idle, so the first request after
  idle takes a few seconds).

## One-time setup (yours, about 10 minutes)

| Step | Where | Notes |
|---|---|---|
| 1. Google account | https://accounts.google.com/signup | Your password + phone verification. |
| 2. Accept Google Cloud terms | https://console.cloud.google.com | First visit with the new account. |
| 3. Sign gcloud in | a browser window opened by `gcloud auth login` | Choose the new account. |
| 4. Billing | https://console.cloud.google.com/billing | Add a card (new accounts are usually offered free-trial credit). Required even for free-tier use. |
| 5. Share the sheet | the sheet → Share → `fusion-server@<project>.iam.gserviceaccount.com` → **Viewer** | Done by whoever owns the sheet; it can stay on its current account. |

## Deploy (repeatable)

```powershell
cd server
.\deploy-cloudrun.ps1 -Project <project-id>              # default region asia-south1 (Mumbai)
.\deploy-cloudrun.ps1 -Project <project-id> -Region us-central1
```

The script enables the APIs, creates the service account if missing, builds from source with Cloud Build,
deploys, points `PUBLIC_BASE_URL` at the service's HTTPS URL, and runs a health check. Re-running it redeploys.

Secrets (`ADMIN_SECRET`, `LOCAL_SIGNING_SECRET`) are generated on the first run into `server/.cloudrun-secrets.json`
(gitignored). Keep that file: redeploys reuse it.

`server/.gcloudignore` keeps `node_modules`, `.env`, keys, the secrets file and tests out of the upload.

## Unity

`Assets/FusionConfig.asset` → **Staging → Server Origin** = the `https://...run.app` URL, **Environment** = Staging.
Local stays available: switch Environment back to Local and run `npm start` as before.

## Operating

| Task | Command |
|---|---|
| Logs | `gcloud run services logs read fusion-server --region asia-south1 --limit 50` |
| Publish a sheet edit now | `curl -X POST <url>/admin/refresh -H "x-admin-secret: <adminSecret>"` |
| What the server sees | `<url>/health` → characters / merges counts |
| Stop all cost | `gcloud run services delete fusion-server --region asia-south1` |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Deploy says billing not enabled | Step 4, for this project. |
| `/health` fails, log says `Share the sheet with ...` | Step 5. Then `/admin/refresh` or redeploy. |
| `Callers must accept Terms of Service` | Step 2. |
| Phone gets a timeout on the very first request | Cold start after idle. Retry, or raise `apiTimeout` in the config. |

## Running the server locally against the same sheet

`server/.env`: `SHEET_SOURCE=google`, remove the `GOOGLE_SA_JSON_FILE` line, then once:
`gcloud auth application-default login --scopes=https://www.googleapis.com/auth/spreadsheets.readonly,https://www.googleapis.com/auth/cloud-platform`
(your own Google account must be able to open the sheet). Or keep `SHEET_SOURCE=local` for offline work.
