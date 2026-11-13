# CharacterMerge

Merge characters to get a new character. Pick two characters, get the merged-creature video. Unity 6 (URP) client + Node server, per
`fusion-backend-spec.md`.

## Run the prototype

1. Server: in `server/` run `.\run-dev.ps1` (or `npm start`). Serves 4 placeholder characters and
   6 placeholder merge videos on http://localhost:8080.
2. Unity: open `Assets/Scenes/FusionPrototype.unity` and press Play.
   (Menu **Fusion > Create Prototype Scene** rebuilds it; **Fusion > Clear Device Video Cache** wipes downloads.)

All client settings and URLs live in one asset: `Assets/Settings/FusionConfig.asset`
(menu **Fusion > Select Config**). Testing on a phone: set `PUBLIC_BASE_URL=http://<pc-lan-ip>:8080`
in `server/.env` and the same origin in the config's *Server Origin*.

## Where things are

| | |
|---|---|
| `server/` | Fastify API, sheet loader, signed-URL storage (local + Azure), tests, placeholder generator — see `server/README.md` |
| `server/fixtures/*.csv` | the two "sheet tabs": characters and merges (`enabled` = publish switch) |
| `server/local-storage/` | placeholder thumbs + videos (stands in for the private Azure containers) |
| `Assets/Scripts/Fusion/` | client: `FusionConfig` (all settings/URLs), DTOs, `FusionApi`, `VideoCache` (download once, ETag-validated), `ThumbnailLoader`, `FusionFlow` (state machine) |
| `Assets/Scripts/Fusion/FusionPrototypeUI.cs` | throwaway runtime-built UI — replace with real art/VFX, `FusionFlow` stays |
| `Assets/Scripts/Fusion/Tests/` | PlayMode tests that drive the full flow against the local server |
