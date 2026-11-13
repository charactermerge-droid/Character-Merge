using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Fusion
{
    public enum FusionState
    {
        Idle,
        Loading,          // GET /bootstrap
        PickFirst,        // render Bootstrap.characters
        LoadingPartners,  // GET /partners/{a}
        PickSecond,       // render Partners
        Merging,          // POST /merge + VideoCache.Fetch (play the merge VFX over this)
        Reveal,           // LocalVideoPath is ready to Prepare() + Play()
        Error,
    }

    /// <summary>
    /// Drives the screen flow from spec §6.5 with no UI of its own. A presenter subscribes to
    /// <see cref="StateChanged"/> and calls <see cref="SelectFirst"/> / <see cref="SelectSecond"/>.
    /// </summary>
    public sealed class FusionFlow : MonoBehaviour
    {
        [Tooltip("All URLs, timeouts and reveal settings. Assets > Create > Fusion > Config. Defaults to localhost if empty.")]
        [SerializeField] FusionConfig config;

        public FusionConfig Config => config;
        public FusionApi Api { get; private set; }
        public ThumbnailLoader Thumbnails { get; private set; }

        public FusionState State { get; private set; } = FusionState.Idle;
        public BootstrapDto Bootstrap { get; private set; }
        public CharacterDto First { get; private set; }
        public CharacterDto Second { get; private set; }
        public IReadOnlyList<CharacterDto> Partners { get; private set; } = Array.Empty<CharacterDto>();
        public MergeDto Merge { get; private set; }
        public string LocalVideoPath { get; private set; }
        public float DownloadProgress { get; private set; }
        public bool WasCacheHit { get; private set; }
        public string LastError { get; private set; }

        public event Action<FusionState> StateChanged;

        Coroutine running;

        void Awake()
        {
            if (config == null)
            {
                config = FusionConfig.CreateDefault();
                Debug.LogWarning($"[Fusion] No FusionConfig assigned to {name}; using defaults ({config.ApiBaseUrl}).");
            }
            Debug.Log($"[Fusion] environment: {config.Describe()}");
            var caution = config.Caution();
            if (caution != null) Debug.LogWarning("[Fusion] " + caution);
            Api = new FusionApi(config);
            Thumbnails = new ThumbnailLoader { TimeoutSeconds = config.thumbnailTimeout };
            VideoCache.DownloadTimeoutSeconds = config.videoDownloadTimeout;
            VideoCache.FolderName = config.videoCacheFolder;
        }

        /// <summary>Loading screen: fetch the first-pick roster and prefetch its thumbnails.</summary>
        public void Begin() => Run(BootstrapRoutine());

        public void SelectFirst(CharacterDto c)
        {
            if (State != FusionState.PickFirst) return;
            First = c;
            Second = null;
            Run(PartnersRoutine(c));
        }

        public void SelectSecond(CharacterDto c)
        {
            if (State != FusionState.PickSecond) return;
            Second = c;
            Run(MergeRoutine(First, c));
        }

        /// <summary>Back to the first-pick screen (or reload if bootstrap never succeeded).</summary>
        public void Restart()
        {
            if (running != null) StopCoroutine(running);
            running = null;
            First = Second = null;
            Merge = null;
            LocalVideoPath = null;
            Partners = Array.Empty<CharacterDto>();
            if (Bootstrap == null) Begin();
            else SetState(FusionState.PickFirst);
        }

        IEnumerator BootstrapRoutine()
        {
            SetState(FusionState.Loading);

            var problem = config.Validate();
            if (problem != null) { Fail(problem); yield break; }

            BootstrapDto dto = null;
            string err = null;
            yield return Api.Bootstrap(d => dto = d, e => err = e);
            if (dto == null) { Fail($"bootstrap failed: {err}"); yield break; }

            dto.characters ??= Array.Empty<CharacterDto>();
            Bootstrap = dto;
            yield return Thumbnails.Prefetch(dto.characters);
            SetState(FusionState.PickFirst);
        }

        IEnumerator PartnersRoutine(CharacterDto a)
        {
            SetState(FusionState.LoadingPartners);
            PartnersDto dto = null;
            string err = null;
            yield return Api.Partners(a.id, d => dto = d, e => err = e);
            if (dto == null) { Fail($"partners failed: {err}"); yield break; }

            Partners = dto.partners ?? Array.Empty<CharacterDto>();
            yield return Thumbnails.Prefetch(Partners);
            SetState(FusionState.PickSecond);
        }

        IEnumerator MergeRoutine(CharacterDto a, CharacterDto b)
        {
            SetState(FusionState.Merging);
            DownloadProgress = 0f;

            MergeDto merge = null;
            string err = null;
            yield return Api.Merge(a.id, b.id, m => merge = m, e => err = e);
            if (merge == null) { Fail($"merge failed: {err}"); yield break; }

            WasCacheHit = VideoCache.IsCached(merge);
            string path = null;
            yield return VideoCache.Fetch(merge, p => path = p, e => err = e, p => DownloadProgress = p);

            if (path == null)
            {
                // The signed URL may have expired between request and download: ask for a fresh one once.
                Debug.LogWarning($"[Fusion] download failed ({err}), re-requesting merge");
                merge = null;
                yield return Api.Merge(a.id, b.id, m => merge = m, e => err = e);
                if (merge != null)
                    yield return VideoCache.Fetch(merge, p => path = p, e => err = e, p => DownloadProgress = p);
            }
            if (path == null) { Fail($"video download failed: {err}"); yield break; }

            Merge = merge;
            LocalVideoPath = path;
            SetState(FusionState.Reveal);
        }

        void Run(IEnumerator routine)
        {
            if (running != null) StopCoroutine(running);
            running = StartCoroutine(Wrap(routine));
        }

        IEnumerator Wrap(IEnumerator routine)
        {
            yield return routine;
            running = null;
        }

        void Fail(string message)
        {
            LastError = message;
            Debug.LogError("[Fusion] " + message);
            SetState(FusionState.Error);
        }

        void SetState(FusionState s)
        {
            State = s;
            StateChanged?.Invoke(s);
        }
    }
}
