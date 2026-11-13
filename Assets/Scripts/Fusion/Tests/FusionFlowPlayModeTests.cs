using System;
using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.TestTools;
using UnityEngine.Video;

namespace Fusion.Tests
{
    /// <summary>
    /// End-to-end against a running local server (server/: npm start). Skipped when it is not reachable,
    /// so the suite stays green on machines without the server.
    /// </summary>
    public class FusionFlowPlayModeTests
    {
        static readonly FusionConfig Config = FusionConfig.CreateDefault();
        static string ServerHealth => Config.HealthUrl;

        [UnityTest]
        public IEnumerator FullFlow_PickMergeDownload_ThenCacheHit()
        {
            yield return RequireServer();
            VideoCache.Clear();

            var flow = new GameObject("FusionFlowUnderTest").AddComponent<FusionFlow>();
            try
            {
                flow.Begin();
                yield return WaitForState(flow, FusionState.PickFirst, 20f);
                Assert.GreaterOrEqual(flow.Bootstrap.characters.Length, 3, "need at least 3 selectable characters");
                foreach (var c in flow.Bootstrap.characters)
                {
                    Assert.IsTrue(flow.Thumbnails.TryGet(c.id, out var sprite), $"thumbnail for {c.id} was not prefetched");
                    Assert.Greater(sprite.texture.width, 0);
                }

                var first = flow.Bootstrap.characters[0];
                flow.SelectFirst(first);
                yield return WaitForState(flow, FusionState.PickSecond, 20f);
                Assert.Greater(flow.Partners.Count, 0, $"{first.id} has no partners");
                Assert.IsFalse(flow.Partners.Any(p => p.id == first.id), "a character must not be its own partner");

                var second = flow.Partners[0];
                flow.SelectSecond(second);
                yield return WaitForState(flow, FusionState.Reveal, 60f);
                Assert.IsFalse(flow.WasCacheHit, "first merge must download");
                Assert.IsTrue(File.Exists(flow.LocalVideoPath), "video not on disk");
                Assert.AreEqual(flow.Merge.video.bytes, new FileInfo(flow.LocalVideoPath).Length, "downloaded size mismatch");
                Assert.IsFalse(File.Exists(flow.LocalVideoPath + ".part"), ".part file left behind");
                Assert.IsTrue(flow.Merge.video.url.Contains("sig=") || flow.Merge.video.url.Contains("sv="), "video url is not signed");
                var resultName = flow.Merge.result.name;

                // Same pair, other order: served from the device cache, no network.
                flow.Restart();
                Assert.AreEqual(FusionState.PickFirst, flow.State);
                flow.SelectFirst(second);
                yield return WaitForState(flow, FusionState.PickSecond, 20f);
                flow.SelectSecond(flow.Partners.First(p => p.id == first.id));
                yield return WaitForState(flow, FusionState.Reveal, 20f);
                Assert.IsTrue(flow.WasCacheHit, "second merge should be a cache hit");
                Assert.AreEqual(resultName, flow.Merge.result.name, "pair order changed the result");
            }
            finally
            {
                UnityEngine.Object.Destroy(flow.gameObject);
            }
        }

        [UnityTest]
        public IEnumerator SelfMergeAndUnknownPair_AreRejectedByServer()
        {
            yield return RequireServer();
            var api = new FusionApi(Config);

            string err = null;
            yield return api.Merge("tiger", "tiger", _ => { }, e => err = e);
            StringAssert.Contains("400", err);

            err = null;
            yield return api.Merge("tiger", "does-not-exist", _ => { }, e => err = e);
            StringAssert.Contains("404", err);
        }

        [UnityTest]
        public IEnumerator DownloadedVideo_PreparesInVideoPlayer()
        {
            yield return RequireServer();
            var api = new FusionApi(Config);

            BootstrapDto boot = null;
            yield return api.Bootstrap(b => boot = b, e => Assert.Fail(e));
            PartnersDto partners = null;
            yield return api.Partners(boot.characters[0].id, p => partners = p, e => Assert.Fail(e));
            MergeDto merge = null;
            yield return api.Merge(boot.characters[0].id, partners.partners[0].id, m => merge = m, e => Assert.Fail(e));
            string path = null;
            yield return VideoCache.Fetch(merge, p => path = p, e => Assert.Fail(e));

            var player = new GameObject("VideoUnderTest").AddComponent<VideoPlayer>();
            try
            {
                player.playOnAwake = false;
                player.renderMode = VideoRenderMode.APIOnly;
                player.source = VideoSource.Url;
                player.url = new Uri(path).AbsoluteUri;

                bool ready = false, failed = false;
                string error = null;
                player.prepareCompleted += _ => ready = true;
                player.errorReceived += (_, msg) => { failed = true; error = msg; };
                player.Prepare();

                float deadline = Time.realtimeSinceStartup + 30f;
                while (!ready && !failed && Time.realtimeSinceStartup < deadline) yield return null;

                Assert.IsFalse(failed, "VideoPlayer error: " + error);
                Assert.IsTrue(ready, "VideoPlayer did not prepare within 30 s");
                Assert.Greater(player.frameCount, 0UL);
                Assert.Greater(player.width, 0u);
            }
            finally
            {
                UnityEngine.Object.Destroy(player.gameObject);
            }
        }

        static IEnumerator RequireServer()
        {
            using var req = UnityWebRequest.Get(ServerHealth);
            req.timeout = 3;
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
                Assert.Ignore($"fusion server not reachable at {ServerHealth} ({req.error}); start it with `npm start` in server/");
        }

        static IEnumerator WaitForState(FusionFlow flow, FusionState wanted, float timeoutSeconds)
        {
            float deadline = Time.realtimeSinceStartup + timeoutSeconds;
            while (flow.State != wanted && flow.State != FusionState.Error && Time.realtimeSinceStartup < deadline)
                yield return null;
            Assert.AreEqual(wanted, flow.State, flow.State == FusionState.Error ? flow.LastError : $"timed out in {flow.State}");
        }
    }
}
