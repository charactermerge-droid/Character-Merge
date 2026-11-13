# Switching the catalog from local CSV to the Google Sheet

Current state: **local**. The server reads `server/fixtures/characters.csv` and `server/fixtures/merges.csv`.
Target: the same two tabs in the Google Sheet
`https://docs.google.com/spreadsheets/d/1BwxZy5q79v2PmZ76pL10RY-K5Tbzi5adH3U___6-kNw/edit`.

The switch is **server-side only**. The Unity client never talks to the sheet — it only calls the server —
so nothing in `FusionConfig.asset` or any C# file changes. Storage (thumbnails/videos) is a separate switch
and stays local for this.

---

## What to add

| What | Where | How |
|---|---|---|
| Google Cloud project with the **Google Sheets API** enabled | console.cloud.google.com → APIs & Services → Library → "Google Sheets API" → Enable | one-time |
| A **service account** | IAM & Admin → Service Accounts → Create service account (any name, no roles needed) | one-time |
| Its **JSON key** | that service account → Keys → Add key → Create new key → JSON | download |
| The key file in the repo | save the download as **`server/google-sa.json`** | already gitignored (`google-sa*.json`) |
| Sheet access for the service account | Sheet → Share → paste the service account email (`<name>@<project>.iam.gserviceaccount.com`) → **Viewer** | do **not** use "Publish to web" |

## What to change

One line in **`server/.env`**:

```diff
-SHEET_SOURCE=local
+SHEET_SOURCE=google
```

`SHEET_ID` and `GOOGLE_SA_JSON_FILE=./google-sa.json` are already filled in there.

## Verify, then run

```powershell
cd D:\JahangirUnityProjects\MergeCharacters\server
npm run sheet      # prints both tabs as the server reads them + the merge graph; errors name the fix
npm run validate   # confirms every row's thumb/video exists in storage
npm start
```

`/health` should still say `"characters":4,"merges":6`. Unity: no change, just Play.

## Rules the sheet must follow

- Tab names: `characters` and `merges` (`merge` and any capitalization are also accepted).
- Row 1 is the header; the server reads row 2 down. **Column order matters, header text does not.**
- `characters`: `id, display_name, thumb_blob, tier, selectable_first, enabled`
- `merges`: `char_a, char_b, result_id, result_name, video_blob, enabled, notes`
- `enabled` is the publish switch: anything not `TRUE` is invisible to players.
- `video_blob` must match the file name in storage: `<idA>__<idB>.mp4` with the two ids in alphabetical order.
- Ids are stable slugs (`tiger`), never reused or renamed once published.

## After the switch — the operating loop

1. Add a merge row with `enabled = FALSE`, upload its video (for now: drop it in `server/local-storage/merges/`).
2. Watch it. Flip `enabled` to `TRUE`.
3. Live within 5 minutes (`SHEET_REFRESH_SECONDS`), or immediately:
   `curl -X POST http://localhost:8080/admin/refresh -H "x-admin-secret: <ADMIN_SECRET from .env>"`

Adding a **new character** to the sheet also needs its thumbnail in `server/local-storage/thumbs/` and, for the
placeholder look, a regenerated set: `python scripts/gen-placeholders.py` reads the **CSV fixtures**, so either
keep the CSVs in sync (File → Download → CSV from each tab) or drop real art in directly.

## Switching back

`SHEET_SOURCE=local` in `server/.env`, restart. Nothing else.

## If it fails on start

The error message says what to do; the usual three:

| Message contains | Fix |
|---|---|
| `Share the sheet with ...@...iam.gserviceaccount.com as Viewer` | step 5 above, or wrong `SHEET_ID` |
| `enable the Google Sheets API` | step 1 above, for the *same* project as the service account |
| `need tabs named "characters" and "merges" (found: ...)` | rename a tab, or fix a typo |

A failed **refresh** (after a successful start) never takes the game down: the server keeps serving the last
good index and logs `[sheet] refresh failed, keeping previous index`.

## Where the code lives, if you need it

| | |
|---|---|
| `server/src/config.js` | reads `SHEET_SOURCE`, `SHEET_ID`, `GOOGLE_SA_JSON_FILE`; validates the key |
| `server/src/sheet.js` | `createGoogleSource` — tab lookup, `batchGet` of `A2:F` / `A2:G`, error translation |
| `server/src/index-builder.js` | rows → index; identical for CSV and Google, so behaviour cannot differ between modes |
| `server/scripts/sheet-dump.js` | `npm run sheet` |
| `server/test/google-source.test.js` | the Google path tested against a fake Sheets client |
