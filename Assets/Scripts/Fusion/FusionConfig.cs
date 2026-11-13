using System;
using UnityEngine;
using UnityEngine.Networking;

namespace Fusion
{
    /// <summary>Which server the game talks to. Switch this field; everything else follows.</summary>
    public enum FusionEnvironment
    {
        Local,       // the server on this PC (editor, or a phone on the same Wi-Fi)
        Staging,     // a hosted test server
        Production,  // the live server
    }

    /// <summary>One server's address. The client only ever needs an origin and the API prefix:
    /// thumbnail and video URLs arrive pre-signed from the server and are used verbatim.</summary>
    [Serializable]
    public sealed class FusionEndpoint
    {
        [Tooltip("Scheme + host + port, no trailing path. e.g. http://localhost:8080, http://192.168.1.42:8080, https://fusion-staging.onrender.com")]
        public string serverOrigin = "";

        [Tooltip("API prefix on the server. Matches the routes in server/src/app.js.")]
        public string apiPath = "/api/v1";

        public string Origin => (serverOrigin ?? "").Trim().TrimEnd('/');
        public string ApiBaseUrl => Origin + "/" + (apiPath ?? "").Trim().Trim('/');
        public bool IsCleartext => Origin.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
        public bool IsLoopback => Origin.Contains("localhost") || Origin.Contains("127.0.0.1");
    }

    /// <summary>
    /// Every client-side setting and URL in one asset (Assets > Create > Fusion > Config,
    /// or menu Fusion > Select Config). Pick an <see cref="environment"/> and press Play —
    /// <see cref="FusionFlow"/> reads the matching endpoint, so no code or scene changes are needed.
    ///
    /// This asset ships inside the build: it must never hold secrets. The admin secret, sheet id,
    /// service-account key and storage credentials live only on the server.
    /// </summary>
    [CreateAssetMenu(menuName = "Fusion/Config", fileName = "FusionConfig")]
    public sealed class FusionConfig : ScriptableObject, ISerializationCallbackReceiver
    {
        [Header("Which server to use")]
        [Tooltip("The active environment. Everything below is per-environment; only this one is used.")]
        public FusionEnvironment environment = FusionEnvironment.Local;

        [Tooltip("Your PC. Use the LAN IP (not localhost) when testing on a phone over Wi-Fi, and set PUBLIC_BASE_URL in server/.env to match.")]
        public FusionEndpoint local = new FusionEndpoint { serverOrigin = "http://localhost:8080" };

        [Tooltip("A hosted test server. HTTPS, so phones can reach it without relaxing cleartext rules.")]
        public FusionEndpoint staging = new FusionEndpoint();

        [Tooltip("The live server.")]
        public FusionEndpoint production = new FusionEndpoint();

        [Header("Timeouts (seconds)")]
        [Min(1)] public int apiTimeout = 15;
        [Min(1)] public int thumbnailTimeout = 15;
        [Tooltip("Whole-file download of a merge video. Generous: it only runs once per pair per device.")]
        [Min(1)] public int videoDownloadTimeout = 120;

        [Header("Reveal")]
        [Tooltip("Keep the merge animation on screen at least this long, even when the video is already cached.")]
        [Min(0)] public float minMergingSeconds = 1.5f;
        public bool loopReveal = true;

        [Header("Device cache")]
        [Tooltip("Folder under Application.persistentDataPath that holds downloaded merge videos.")]
        public string videoCacheFolder = "merges";

        [Header("Diagnostics")]
        [Tooltip("Show the active environment and server on the loading screen. Handy on a device; turn off for a release build.")]
        public bool showEnvironmentOnScreen = true;

        // ---- the active endpoint, and the URLs derived from it ----

        public FusionEndpoint Endpoint
        {
            get
            {
                switch (environment)
                {
                    case FusionEnvironment.Staging: return staging;
                    case FusionEnvironment.Production: return production;
                    default: return local;
                }
            }
        }

        public string Origin => Endpoint.Origin;
        public string ApiBaseUrl => Endpoint.ApiBaseUrl;
        public string BootstrapUrl => ApiBaseUrl + "/bootstrap";
        public string PartnersUrl(string charId) => ApiBaseUrl + "/partners/" + UnityWebRequest.EscapeURL(charId);
        public string MergeUrl => ApiBaseUrl + "/merge";
        public string HealthUrl => Origin + "/health";

        /// <summary>e.g. "Local - http://localhost:8080". For on-screen diagnostics and logs.</summary>
        public string Describe() => $"{environment} - {(string.IsNullOrEmpty(Origin) ? "(no server set)" : Origin)}";

        /// <summary>Null when the active endpoint is usable, otherwise what to fix.</summary>
        public string Validate()
        {
            if (string.IsNullOrEmpty(Origin))
                return $"{environment} has no Server Origin set in the Fusion config.";
            if (!Origin.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !Origin.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return $"{environment} Server Origin must start with http:// or https:// (got \"{Origin}\").";
            return null;
        }

        /// <summary>A non-fatal caution for the active endpoint, or null. Logged once at startup.</summary>
        public string Caution()
        {
            var e = Endpoint;
            if (environment != FusionEnvironment.Local && e.IsCleartext)
                return $"{environment} uses cleartext HTTP ({e.Origin}). Phones block that by default — use HTTPS for anything off this machine.";
            if (Application.platform != RuntimePlatform.WindowsEditor &&
                Application.platform != RuntimePlatform.OSXEditor &&
                Application.platform != RuntimePlatform.LinuxEditor &&
                e.IsLoopback)
                return $"Server Origin is {e.Origin}, which on a device means the device itself. Use your PC's LAN IP instead.";
            return null;
        }

        /// <summary>In-memory defaults, for scenes and tests that have no asset assigned.</summary>
        public static FusionConfig CreateDefault()
        {
            var c = CreateInstance<FusionConfig>();
            c.name = "FusionConfig (runtime defaults)";
            return c;
        }

        void OnValidate() => ApplyDefaults();

        // Runs in players too, where OnValidate never fires. Plain field writes only - no Unity API here.
        public void OnAfterDeserialize() => ApplyDefaults();
        public void OnBeforeSerialize() { }

        /// <summary>Heal an asset saved before environments existed, or one with blank fields.</summary>
        void ApplyDefaults()
        {
            if (local == null) local = new FusionEndpoint();
            if (staging == null) staging = new FusionEndpoint();
            if (production == null) production = new FusionEndpoint();
            if (string.IsNullOrWhiteSpace(local.serverOrigin)) local.serverOrigin = "http://localhost:8080";
            foreach (var e in new[] { local, staging, production })
                if (string.IsNullOrWhiteSpace(e.apiPath)) e.apiPath = "/api/v1";
            if (string.IsNullOrWhiteSpace(videoCacheFolder)) videoCacheFolder = "merges";
        }
    }
}
