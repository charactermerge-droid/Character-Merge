using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace Fusion
{
    /// <summary>
    /// On-device cache of merge videos, keyed by pairKey and validated by ETag.
    /// Each video is downloaded once per device; repeat plays cost no bandwidth and work offline.
    /// Downloads go to a ".part" file and are renamed only after a complete, size-checked transfer,
    /// so a dropped connection never leaves a truncated MP4 that looks cached.
    /// </summary>
    public static class VideoCache
    {
        public static int DownloadTimeoutSeconds = 120;
        public static string FolderName = "merges";

        public static string Dir => Path.Combine(Application.persistentDataPath, FolderName);
        public static string PathFor(string pairKey) => Path.Combine(Dir, SafeName(pairKey) + ".mp4");
        static string EtagFor(string pairKey) => Path.Combine(Dir, SafeName(pairKey) + ".etag");

        public static bool IsCached(MergeDto m)
        {
            var file = PathFor(m.pairKey);
            var etagFile = EtagFor(m.pairKey);
            return File.Exists(file) && File.Exists(etagFile) && File.ReadAllText(etagFile) == m.video.etag;
        }

        /// <summary>Yields the local file path via <paramref name="ok"/>; zero network on a cache hit.</summary>
        public static IEnumerator Fetch(MergeDto m, Action<string> ok, Action<string> fail, Action<float> progress = null)
        {
            Directory.CreateDirectory(Dir);
            var file = PathFor(m.pairKey);
            var etagFile = EtagFor(m.pairKey);

            if (IsCached(m))
            {
                progress?.Invoke(1f);
                ok(file);
                yield break;
            }

            var tmp = file + ".part";
            if (File.Exists(tmp)) File.Delete(tmp);

            using var req = UnityWebRequest.Get(m.video.url);
            req.downloadHandler = new DownloadHandlerFile(tmp) { removeFileOnAbort = true };
            req.timeout = DownloadTimeoutSeconds;

            var op = req.SendWebRequest();
            while (!op.isDone)
            {
                progress?.Invoke(req.downloadProgress);
                yield return null;
            }

            if (req.result != UnityWebRequest.Result.Success)
            {
                if (File.Exists(tmp)) File.Delete(tmp);
                fail(FusionApi.Describe(req));
                yield break;
            }

            var received = new FileInfo(tmp).Length;
            if (m.video.bytes > 0 && received != m.video.bytes)
            {
                File.Delete(tmp);
                fail($"truncated download ({received} of {m.video.bytes} bytes)");
                yield break;
            }

            if (File.Exists(file)) File.Delete(file);
            File.Move(tmp, file);
            File.WriteAllText(etagFile, m.video.etag);
            progress?.Invoke(1f);
            ok(file);
        }

        public static long CachedBytes()
        {
            if (!Directory.Exists(Dir)) return 0;
            long total = 0;
            foreach (var f in Directory.GetFiles(Dir, "*.mp4")) total += new FileInfo(f).Length;
            return total;
        }

        public static void Clear()
        {
            if (Directory.Exists(Dir)) Directory.Delete(Dir, recursive: true);
        }

        // pairKey comes from the server, but never trust it as a raw path segment.
        static string SafeName(string pairKey)
        {
            var chars = pairKey.ToCharArray();
            var invalid = Path.GetInvalidFileNameChars();
            for (int i = 0; i < chars.Length; i++)
                if (Array.IndexOf(invalid, chars[i]) >= 0) chars[i] = '_';
            return new string(chars);
        }
    }
}
