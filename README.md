# CharacterMerge

Merge characters to get a new character. Pick two characters, get the merged-creature video. Unity 6 (URP) client + Node server, per
`fusion-backend-spec.md`.

## Run the prototype

1. Server: in `server/` run `.\run-dev.ps1` (or `npm start`). Serves 4 placeholder characters and
   6 placeholder merge videos on http://localhost:8080.
2. Unity: open `Assets/Scenes/FusionPrototype.unity` and press Play.
   (Menu **Fusion > Create Prototype Scene** rebuilds it; **Fusion > Clear Device Video Cache** wipes downloads.)

## Switching servers (Local / Staging / Production)

Every client URL and setting lives in one asset, `Assets/FusionConfig.asset` (menu **Fusion > Select Config**).
Set **Environment** to Local, Staging or Production and press Play: the game uses that endpoint's
*Server Origin*. Nothing else changes; thumbnail and video URLs come pre-signed from whichever server you pick.
The loading screen shows the active environment (turn off *Show Environment On Screen* for release).

- **Local**: `http://localhost:8080` in the editor. On a phone over Wi-Fi use `http://<pc-lan-ip>:8080`, and set
  `PUBLIC_BASE_URL` in `server/.env` to the same thing (it is baked into the signed URLs).
- **Staging / Production**: an `https://` origin. Phones block plain HTTP by default.

The config asset ships inside the build, so it holds no secrets. Whether the *server* reads its catalog from CSV
or a Google Sheet is a server setting: see [docs/switching-to-google-sheet.md](docs/switching-to-google-sheet.md).
Staging runs on Render's free tier, reading the Google Sheet: [docs/render-and-google-sheet.md](docs/render-and-google-sheet.md).

## Where things are

| | |
|---|---|
| `server/` | Fastify API, sheet loader, signed-URL storage (local + Azure), tests, placeholder generator — see `server/README.md` |
| `server/fixtures/*.csv` | the two "sheet tabs": characters and merges (`enabled` = publish switch) |
| Supabase Storage | thumbnails + videos, private buckets `thumbs` / `merges`; upload with `npm run upload` (see docs/media-in-supabase.md) |
| `Assets/Scripts/Fusion/` | client: `FusionConfig` (all settings/URLs), DTOs, `FusionApi`, `VideoCache` (download once, ETag-validated), `ThumbnailLoader`, `FusionFlow` (state machine) |
| `Assets/Scripts/Fusion/FusionPrototypeUI.cs` | throwaway runtime-built UI — replace with real art/VFX, `FusionFlow` stays |
| `Assets/Scripts/Fusion/Tests/` | PlayMode tests that drive the full flow against the local server |
