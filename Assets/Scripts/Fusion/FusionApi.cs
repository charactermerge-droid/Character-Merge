using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace Fusion
{
    /// <summary>
    /// Coroutine client for the fusion server. Not a component: any MonoBehaviour can
    /// <c>yield return</c> these enumerators. Failures are reported as "HTTP 404 merge_not_found"-style
    /// strings; the server's error codes are in server/src/app.js.
    /// </summary>
    public sealed class FusionApi
    {
        public FusionConfig Config { get; }
        public int TimeoutSeconds => Config.apiTimeout;

        public FusionApi(FusionConfig config)
        {
            Config = config;
        }

        public IEnumerator Bootstrap(Action<BootstrapDto> ok, Action<string> fail) =>
            Get(Config.BootstrapUrl, ok, fail);

        public IEnumerator Partners(string charId, Action<PartnersDto> ok, Action<string> fail) =>
            Get(Config.PartnersUrl(charId), ok, fail);

        public IEnumerator Merge(string a, string b, Action<MergeDto> ok, Action<string> fail)
        {
            var body = JsonUtility.ToJson(new MergeRequest { a = a, b = b });
            using var req = new UnityWebRequest(Config.MergeUrl, UnityWebRequest.kHttpVerbPOST);
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body)) { contentType = "application/json" };
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Accept", "application/json");
            req.timeout = TimeoutSeconds;

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success) { fail(Describe(req)); yield break; }
            ok(JsonUtility.FromJson<MergeDto>(req.downloadHandler.text));
        }

        IEnumerator Get<T>(string url, Action<T> ok, Action<string> fail)
        {
            using var req = UnityWebRequest.Get(url);
            req.SetRequestHeader("Accept", "application/json");
            req.timeout = TimeoutSeconds;

            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success) { fail(Describe(req)); yield break; }
            ok(JsonUtility.FromJson<T>(req.downloadHandler.text));
        }

        /// <summary>"HTTP 503 asset_missing" when the server answered with a JSON error, otherwise the transport error.</summary>
        internal static string Describe(UnityWebRequest req)
        {
            var text = req.downloadHandler?.text;
            if (req.responseCode > 0 && !string.IsNullOrEmpty(text))
            {
                try
                {
                    var err = JsonUtility.FromJson<ApiError>(text);
                    if (!string.IsNullOrEmpty(err?.error)) return $"HTTP {req.responseCode} {err.error}";
                }
                catch (Exception) { /* not our JSON */ }
                return $"HTTP {req.responseCode}";
            }
            return req.error ?? "request failed";
        }
    }
}
