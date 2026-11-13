# Thumbnails and videos: Supabase Storage

Media is **not** in the repo or the Unity project. It lives in the Supabase project **charactermerge**
(`https://qjqujgephwmqyfvvdcvz.supabase.co`, org CharacterMerge), in two **private** buckets:

| Bucket | Contents | Name | Type |
|---|---|---|---|
| `thumbs` | character card art | `thumb_blob` from the `characters` tab, e.g. `tiger.png` | png / jpg / webp, ≤ 5 MB |
| `merges` | merge result videos | `video_blob` from the `merges` tab: `<idA>__<idB>.mp4`, ids in alphabetical order | mp4, ≤ 50 MB |

Players never get a permanent link: the server signs a URL valid for `SAS_TTL_MINUTES` (60) per request, and the game
caches each video on the device after the first download. Unsigned or tampered links are refused by Supabase.

## Adding a merge (the operating loop)

1. Upload the video to the `merges` bucket, either:
   - **Dashboard:** Supabase → Storage → `merges` → Upload file (drag and drop), or
   - **Batch:** put files in a folder with `merges/` and/or `thumbs/` subfolders, then
     `cd server && npm run upload -- --dir D:/path/to/that/folder` (sets Content-Type; skips unchanged files).
2. Add the row in the sheet with `enabled = FALSE`. Watch the video. Flip `enabled` to `TRUE`.
3. Live within 5 minutes. `npm run validate` (with `STORAGE=supabase` and `SHEET_SOURCE=google` in `.env`)
   checks every enabled row has its file.

No commit, no redeploy, no app update.

## Keys

`SUPABASE_SERVICE_KEY` must be the **secret** key (`sb_secret_...`, or legacy `service_role`); it lives only in
`server/.env` (gitignored) and Render's environment. Never put it in Unity, and never use the publishable/anon key.
Rotate: Supabase → Project Settings → API Keys → create a new secret key → update `.env` + Render → delete the old one.

## Offline / local mode

`STORAGE=local` serves files from `server/local-storage/` (gitignored). `.\run-dev.ps1` regenerates placeholders there
if it is empty.

## Free-tier notes

Free projects are paused after a period of inactivity (check Supabase's current policy); un-pause from the dashboard.
Storage and bandwidth caps apply: watch Supabase → Usage. The spec's Azure path (`STORAGE=azure`) and an R2/S3
signer remain options when traffic grows.
