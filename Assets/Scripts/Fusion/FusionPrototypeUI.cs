using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using UnityEngine.Video;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem.UI;
#endif

namespace Fusion
{
    /// <summary>
    /// Placeholder presenter. Builds a uGUI screen flow at runtime so the prototype is playable with
    /// zero scene wiring: Loading -> Pick A -> Pick B -> Merging (fake VFX) -> Reveal (video).
    /// Replace this with real art and VFX; <see cref="FusionFlow"/> does not change.
    /// </summary>
    [RequireComponent(typeof(FusionFlow))]
    public sealed class FusionPrototypeUI : MonoBehaviour
    {
        static readonly Color Bg = new Color(0.08f, 0.08f, 0.11f);
        static readonly Color Card = new Color(0.16f, 0.16f, 0.21f);
        static readonly Color Accent = new Color(0.98f, 0.55f, 0.15f);
        static readonly Color Muted = new Color(0.65f, 0.65f, 0.72f);

        FusionFlow flow;
        Font font;

        RectTransform loadingPanel, pickPanel, mergingPanel, revealPanel, errorPanel;
        RectTransform gridContent;
        Text title, subtitle, loadingText, mergingText, revealTitle, revealSub, errorText;
        Image cardA, cardB, progressFill;
        RawImage videoImage;
        GameObject backButton;

        VideoPlayer video;
        RenderTexture videoTexture;
        float mergingStartedAt;
        Coroutine revealRoutine;
        readonly List<GameObject> cards = new List<GameObject>();

        // ------------------------------------------------------------------ lifecycle

        void Awake()
        {
            flow = GetComponent<FusionFlow>();
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            EnsureEventSystem();
            EnsureCamera();
            BuildUi();
            SetupVideoPlayer();
            flow.StateChanged += OnState;
        }

        float MinMergingSeconds => flow.Config.minMergingSeconds;

        void Start()
        {
            video.isLooping = flow.Config.loopReveal;
            flow.Begin();
        }

        void OnDestroy()
        {
            flow.StateChanged -= OnState;
            if (videoTexture != null) videoTexture.Release();
        }

        void Update()
        {
            if (!mergingPanel.gameObject.activeSelf) return;
            float t = Mathf.Clamp01((Time.time - mergingStartedAt) / Mathf.Max(0.01f, MinMergingSeconds));
            float ease = 1f - Mathf.Pow(1f - t, 3f);
            float pulse = 1f + 0.06f * Mathf.Sin(Time.time * 9f);
            cardA.rectTransform.anchoredPosition = Vector2.Lerp(new Vector2(-340, 140), new Vector2(-70, 140), ease);
            cardB.rectTransform.anchoredPosition = Vector2.Lerp(new Vector2(340, 140), new Vector2(70, 140), ease);
            cardA.rectTransform.localScale = cardB.rectTransform.localScale = Vector3.one * pulse;
            mergingText.color = new Color(1, 1, 1, 0.6f + 0.4f * Mathf.Abs(Mathf.Sin(Time.time * 4f)));
            progressFill.rectTransform.anchorMax = new Vector2(Mathf.Max(0.02f, flow.DownloadProgress), 1f);
        }

        // ------------------------------------------------------------------ state -> screen

        void OnState(FusionState s)
        {
            if (revealRoutine != null) { StopCoroutine(revealRoutine); revealRoutine = null; }
            if (s != FusionState.Reveal && video.isPlaying) video.Stop();

            loadingPanel.gameObject.SetActive(s == FusionState.Loading);
            pickPanel.gameObject.SetActive(s == FusionState.PickFirst || s == FusionState.LoadingPartners || s == FusionState.PickSecond);
            mergingPanel.gameObject.SetActive(s == FusionState.Merging);
            revealPanel.gameObject.SetActive(false);
            errorPanel.gameObject.SetActive(s == FusionState.Error);
            backButton.SetActive(s == FusionState.LoadingPartners || s == FusionState.PickSecond || s == FusionState.Error);

            switch (s)
            {
                case FusionState.Loading:
                    SetHeader("Merge Characters", "Loading...");
                    loadingText.text = flow.Config.showEnvironmentOnScreen
                        ? $"Contacting {flow.Config.Describe()}"
                        : "Contacting server...";
                    break;

                case FusionState.PickFirst:
                    SetHeader("Pick a character", $"{flow.Bootstrap.characters.Length} available");
                    PopulateGrid(flow.Bootstrap.characters, flow.SelectFirst);
                    break;

                case FusionState.LoadingPartners:
                    SetHeader($"Pick a partner for {flow.First.name}", "Finding partners...");
                    PopulateGrid(Array.Empty<CharacterDto>(), null);
                    break;

                case FusionState.PickSecond:
                    SetHeader($"Pick a partner for {flow.First.name}",
                        flow.Partners.Count > 0 ? $"{flow.Partners.Count} possible merge{(flow.Partners.Count == 1 ? "" : "s")}" : "No merges available yet");
                    PopulateGrid(flow.Partners, flow.SelectSecond);
                    break;

                case FusionState.Merging:
                    mergingStartedAt = Time.time;
                    SetHeader("Merging...", $"{flow.First.name} + {flow.Second.name}");
                    mergingText.text = "Merging...";
                    SetCardSprite(cardA, flow.First);
                    SetCardSprite(cardB, flow.Second);
                    break;

                case FusionState.Reveal:
                    mergingPanel.gameObject.SetActive(true); // hold the VFX until the minimum time has passed
                    revealRoutine = StartCoroutine(RevealRoutine());
                    break;

                case FusionState.Error:
                    SetHeader("Something went wrong", "");
                    errorText.text = flow.Config.showEnvironmentOnScreen
                        ? flow.LastError + "\n\n" + flow.Config.Describe()
                        : flow.LastError;
                    break;
            }
        }

        IEnumerator RevealRoutine()
        {
            float wait = MinMergingSeconds - (Time.time - mergingStartedAt);
            if (wait > 0) yield return new WaitForSeconds(wait);

            mergingPanel.gameObject.SetActive(false);
            revealPanel.gameObject.SetActive(true);
            backButton.SetActive(false);
            SetHeader(flow.Merge.result.name, $"{flow.First.name} + {flow.Second.name}");
            revealTitle.text = flow.Merge.result.name;
            revealSub.text = flow.WasCacheHit ? "played from device cache" : $"downloaded {flow.Merge.video.bytes / 1024} KB, now cached";

            yield return PlayVideo(flow.LocalVideoPath);
            revealRoutine = null;
        }

        IEnumerator PlayVideo(string localPath)
        {
            video.Stop();
            ClearVideoTexture();
            video.source = VideoSource.Url;
            video.url = new Uri(localPath).AbsoluteUri;   // file:///C:/... on Windows, file:///storage/... on Android

            bool ready = false, failed = false;
            string error = null;
            void OnPrepared(VideoPlayer _) => ready = true;
            void OnError(VideoPlayer _, string msg) { failed = true; error = msg; }

            video.prepareCompleted += OnPrepared;
            video.errorReceived += OnError;
            video.Prepare();
            while (!ready && !failed) yield return null;
            video.prepareCompleted -= OnPrepared;
            video.errorReceived -= OnError;

            if (failed)
            {
                Debug.LogError("[Fusion] video playback failed: " + error);
                revealSub.text = "Playback failed: " + error;
                yield break;
            }
            video.Play();   // Prepare() first, or the reveal opens on black frames
        }

        // ------------------------------------------------------------------ cards

        void PopulateGrid(IReadOnlyList<CharacterDto> characters, Action<CharacterDto> onPick)
        {
            foreach (var c in cards) Destroy(c);
            cards.Clear();
            foreach (var c in characters) cards.Add(MakeCard(c, onPick));
        }

        GameObject MakeCard(CharacterDto c, Action<CharacterDto> onPick)
        {
            var bg = NewImage("Card_" + c.id, gridContent, Card);
            var button = bg.gameObject.AddComponent<Button>();
            button.targetGraphic = bg;
            var colors = button.colors;
            colors.highlightedColor = new Color(0.22f, 0.22f, 0.3f);
            colors.pressedColor = Accent;
            button.colors = colors;
            if (onPick != null) button.onClick.AddListener(() => onPick(c));

            var thumb = NewImage("Thumb", bg.transform, Color.white);
            Stretch(thumb.rectTransform, 16, 16, 16, 110);
            thumb.preserveAspect = true;
            thumb.raycastTarget = false;
            thumb.color = new Color(1, 1, 1, 0);          // invisible until the sprite arrives

            var name = NewText("Name", bg.transform, c.name, 40, TextAnchor.MiddleCenter, FontStyle.Bold);
            Anchor(name.rectTransform, new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 60), new Vector2(0, 50));
            var tier = NewText("Tier", bg.transform, (c.tier ?? "").ToUpperInvariant(), 22, TextAnchor.MiddleCenter);
            tier.color = TierColor(c.tier);
            Anchor(tier.rectTransform, new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 30), new Vector2(0, 18));

            if (flow.Thumbnails.TryGet(c.id, out var sprite)) { thumb.sprite = sprite; thumb.color = Color.white; }
            else StartCoroutine(flow.Thumbnails.Load(c, s => { if (thumb != null) { thumb.sprite = s; thumb.color = Color.white; } }));

            return bg.gameObject;
        }

        void SetCardSprite(Image card, CharacterDto c)
        {
            card.sprite = flow.Thumbnails.TryGet(c.id, out var s) ? s : null;
            card.color = card.sprite != null ? Color.white : Card;
        }

        static Color TierColor(string tier)
        {
            switch ((tier ?? "").ToLowerInvariant())
            {
                case "legendary": return new Color(0.95f, 0.72f, 0.1f);
                case "rare": return new Color(0.35f, 0.6f, 1f);
                default: return Muted;
            }
        }

        // ------------------------------------------------------------------ construction

        void BuildUi()
        {
            var canvasGo = new GameObject("FusionCanvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080, 1920);
            scaler.matchWidthOrHeight = 0.5f;
            var root = (RectTransform)canvasGo.transform;

            Stretch(NewImage("Background", root, Bg).rectTransform);

            // Header
            title = NewText("Title", root, "", 64, TextAnchor.MiddleCenter, FontStyle.Bold);
            Anchor(title.rectTransform, new Vector2(0, 1), new Vector2(1, 1), new Vector2(0, -80), new Vector2(0, 90));
            subtitle = NewText("Subtitle", root, "", 34, TextAnchor.MiddleCenter);
            subtitle.color = Muted;
            Anchor(subtitle.rectTransform, new Vector2(0, 1), new Vector2(1, 1), new Vector2(0, -160), new Vector2(0, 50));

            // Loading
            loadingPanel = Stretch(NewRect("Loading", root));
            loadingText = NewText("Text", loadingPanel, "Contacting server...", 40, TextAnchor.MiddleCenter);
            Stretch(loadingText.rectTransform);

            // Pick (scrollable grid)
            pickPanel = Stretch(NewRect("Pick", root), 0, 220, 0, 150);
            var scroll = pickPanel.gameObject.AddComponent<ScrollRect>();
            var viewport = Stretch(NewRect("Viewport", pickPanel));
            viewport.gameObject.AddComponent<RectMask2D>();
            gridContent = NewRect("Content", viewport);
            gridContent.anchorMin = new Vector2(0, 1);
            gridContent.anchorMax = new Vector2(1, 1);
            gridContent.pivot = new Vector2(0.5f, 1);
            gridContent.offsetMin = gridContent.offsetMax = Vector2.zero;
            var grid = gridContent.gameObject.AddComponent<GridLayoutGroup>();
            grid.cellSize = new Vector2(400, 470);
            grid.spacing = new Vector2(36, 36);
            grid.padding = new RectOffset(40, 40, 20, 20);
            grid.childAlignment = TextAnchor.UpperCenter;
            var fitter = gridContent.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = gridContent;
            scroll.viewport = viewport;
            scroll.horizontal = false;
            scroll.vertical = true;
            scroll.movementType = ScrollRect.MovementType.Elastic;
            scroll.scrollSensitivity = 40;

            // Merging (placeholder for the in-engine VFX)
            mergingPanel = Stretch(NewRect("Merging", root));
            cardA = NewImage("CardA", mergingPanel, Card);
            cardB = NewImage("CardB", mergingPanel, Card);
            foreach (var img in new[] { cardA, cardB })
            {
                img.rectTransform.anchorMin = img.rectTransform.anchorMax = new Vector2(0.5f, 0.5f);
                img.rectTransform.sizeDelta = new Vector2(320, 320);
                img.preserveAspect = true;
            }
            mergingText = NewText("Text", mergingPanel, "Merging...", 56, TextAnchor.MiddleCenter, FontStyle.Bold);
            Anchor(mergingText.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, -140), new Vector2(800, 80));
            var bar = NewImage("Progress", mergingPanel, new Color(1, 1, 1, 0.12f));
            Anchor(bar.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, -230), new Vector2(600, 18));
            progressFill = NewImage("Fill", bar.transform, Accent);
            progressFill.rectTransform.anchorMin = Vector2.zero;
            progressFill.rectTransform.anchorMax = new Vector2(0.02f, 1);
            progressFill.rectTransform.offsetMin = progressFill.rectTransform.offsetMax = Vector2.zero;

            // Reveal
            revealPanel = Stretch(NewRect("Reveal", root));
            videoImage = NewRect("Video", revealPanel).gameObject.AddComponent<RawImage>();
            videoImage.color = Color.white;
            Anchor(videoImage.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, 40), new Vector2(900, 900));
            revealTitle = NewText("ResultName", revealPanel, "", 72, TextAnchor.MiddleCenter, FontStyle.Bold);
            revealTitle.color = Accent;
            Anchor(revealTitle.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, -470), new Vector2(1000, 90));
            revealSub = NewText("Note", revealPanel, "", 28, TextAnchor.MiddleCenter);
            revealSub.color = Muted;
            Anchor(revealSub.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, -540), new Vector2(1000, 50));
            var again = NewButton("MergeAnother", revealPanel, "Merge another", Accent, flow.Restart);
            Anchor(again.rectTransform, new Vector2(0.5f, 0), new Vector2(0.5f, 0), new Vector2(0, 110), new Vector2(480, 110));

            // Error
            errorPanel = Stretch(NewRect("Error", root));
            errorText = NewText("Text", errorPanel, "", 34, TextAnchor.MiddleCenter);
            Anchor(errorText.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, 60), new Vector2(900, 400));
            var retry = NewButton("Retry", errorPanel, "Retry", Accent, flow.Restart);
            Anchor(retry.rectTransform, new Vector2(0.5f, 0), new Vector2(0.5f, 0), new Vector2(0, 110), new Vector2(480, 110));

            // Footer
            var back = NewButton("Back", root, "< Back", new Color(0.25f, 0.25f, 0.32f), flow.Restart);
            Anchor(back.rectTransform, new Vector2(0, 0), new Vector2(0, 0), new Vector2(190, 80), new Vector2(300, 100));
            backButton = back.gameObject;

            foreach (var p in new[] { loadingPanel, pickPanel, mergingPanel, revealPanel, errorPanel }) p.gameObject.SetActive(false);
            backButton.SetActive(false);
        }

        void SetupVideoPlayer()
        {
            video = gameObject.AddComponent<VideoPlayer>();
            video.playOnAwake = false;
            video.waitForFirstFrame = true;
            video.skipOnDrop = true;
            video.renderMode = VideoRenderMode.RenderTexture;
            video.aspectRatio = VideoAspectRatio.FitInside;
            video.audioOutputMode = VideoAudioOutputMode.Direct;
            videoTexture = new RenderTexture(1024, 1024, 0, RenderTextureFormat.ARGB32) { name = "FusionVideoRT" };
            videoTexture.Create();
            video.targetTexture = videoTexture;
            videoImage.texture = videoTexture;
            ClearVideoTexture();
        }

        void ClearVideoTexture()
        {
            var prev = RenderTexture.active;
            RenderTexture.active = videoTexture;
            GL.Clear(true, true, Color.black);
            RenderTexture.active = prev;
        }

        void SetHeader(string t, string s)
        {
            title.text = t;
            subtitle.text = s;
        }

        static void EnsureEventSystem()
        {
            if (FindAnyObjectByType<EventSystem>() != null) return;
            var es = new GameObject("EventSystem", typeof(EventSystem));
#if ENABLE_INPUT_SYSTEM
            es.AddComponent<InputSystemUIInputModule>();
#else
            es.AddComponent<StandaloneInputModule>();
#endif
        }

        static void EnsureCamera()
        {
            if (Camera.main != null) return;
            var cam = new GameObject("Main Camera", typeof(Camera)).GetComponent<Camera>();
            cam.tag = "MainCamera";
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Bg;
        }

        // ------------------------------------------------------------------ uGUI helpers

        static RectTransform NewRect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        static RectTransform Stretch(RectTransform rt, float left = 0, float top = 0, float right = 0, float bottom = 0)
        {
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(left, bottom);
            rt.offsetMax = new Vector2(-right, -top);
            return rt;
        }

        static void Anchor(RectTransform rt, Vector2 anchorMin, Vector2 anchorMax, Vector2 position, Vector2 size)
        {
            rt.anchorMin = anchorMin;
            rt.anchorMax = anchorMax;
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = position;
            rt.sizeDelta = size;
        }

        static Image NewImage(string name, Transform parent, Color color)
        {
            var img = NewRect(name, parent).gameObject.AddComponent<Image>();
            img.color = color;
            return img;
        }

        Text NewText(string name, Transform parent, string text, int size, TextAnchor anchor, FontStyle style = FontStyle.Normal)
        {
            var t = NewRect(name, parent).gameObject.AddComponent<Text>();
            t.font = font;
            t.text = text;
            t.fontSize = size;
            t.fontStyle = style;
            t.alignment = anchor;
            t.color = Color.white;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false;
            return t;
        }

        Image NewButton(string name, Transform parent, string label, Color color, Action onClick)
        {
            var bg = NewImage(name, parent, color);
            var button = bg.gameObject.AddComponent<Button>();
            button.targetGraphic = bg;
            button.onClick.AddListener(() => onClick());
            var text = NewText("Label", bg.transform, label, 36, TextAnchor.MiddleCenter, FontStyle.Bold);
            Stretch(text.rectTransform);
            return bg;
        }
    }
}
