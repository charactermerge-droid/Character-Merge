using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Fusion
{
    /// <summary>
    /// Session-scoped thumbnail cache keyed by character id. Thumbnails are small and their
    /// signed URLs change per session, so memory (not disk) is the right lifetime here.
    /// </summary>
    public sealed class ThumbnailLoader
    {
        readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();

        public int TimeoutSeconds { get; set; } = 15;

        public bool TryGet(string charId, out Sprite sprite) => sprites.TryGetValue(charId, out sprite);

        public IEnumerator Load(CharacterDto c, Action<Sprite> ok, Action<string> fail = null)
        {
            if (sprites.TryGetValue(c.id, out var cached)) { ok(cached); yield break; }
            if (string.IsNullOrEmpty(c.thumb)) { fail?.Invoke("no thumbnail"); yield break; }

            using var req = UnityWebRequestTexture.GetTexture(c.thumb, nonReadable: true);
            req.timeout = TimeoutSeconds;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                fail?.Invoke(FusionApi.Describe(req));
                yield break;
            }

            var tex = DownloadHandlerTexture.GetContent(req);
            var sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f), 100f);
            sprite.name = c.id;
            sprites[c.id] = sprite;
            ok(sprite);
        }

        /// <summary>Warm the cache for a whole list (loading screen prefetch).</summary>
        public IEnumerator Prefetch(IEnumerable<CharacterDto> characters)
        {
            foreach (var c in characters)
                yield return Load(c, _ => { }, _ => { });
        }
    }
}
