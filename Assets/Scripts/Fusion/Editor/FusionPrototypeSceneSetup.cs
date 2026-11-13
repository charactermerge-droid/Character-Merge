using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Fusion.Editor
{
    /// <summary>
    /// Creates Assets/Scenes/FusionPrototype.unity: a default scene plus one GameObject carrying
    /// FusionFlow + FusionPrototypeUI (the UI builds itself at runtime). Also callable headless:
    ///   Unity.exe -batchmode -quit -projectPath . -executeMethod Fusion.Editor.FusionPrototypeSceneSetup.CreateScene
    /// </summary>
    public static class FusionPrototypeSceneSetup
    {
        public const string ScenePath = "Assets/Scenes/FusionPrototype.unity";
        public const string ConfigPath = "Assets/Settings/FusionConfig.asset";

        [MenuItem("Fusion/Create Prototype Scene")]
        public static void CreateScene()
        {
            var config = GetOrCreateConfig();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var cam = Camera.main;
            if (cam != null)
            {
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.08f, 0.08f, 0.11f);
            }

            var go = new GameObject("FusionPrototype");
            var flow = go.AddComponent<FusionFlow>();
            go.AddComponent<FusionPrototypeUI>();

            var so = new SerializedObject(flow);
            so.FindProperty("config").objectReferenceValue = config;
            so.ApplyModifiedPropertiesWithoutUndo();

            EditorSceneManager.SaveScene(scene, ScenePath);
            AddToBuildSettings(ScenePath);
            AllowLocalhostHttp();
            AssetDatabase.SaveAssets();
            Debug.Log($"[Fusion] Created {ScenePath}. Start the server (server/: npm start) and press Play.");
        }

        [MenuItem("Fusion/Select Config")]
        public static void SelectConfig()
        {
            var config = GetOrCreateConfig();
            Selection.activeObject = config;
            EditorGUIUtility.PingObject(config);
        }

        [MenuItem("Fusion/Clear Device Video Cache")]
        public static void ClearVideoCache()
        {
            VideoCache.Clear();
            Debug.Log($"[Fusion] Cleared {VideoCache.Dir}");
        }

        /// <summary>The single config asset the prototype scene uses; created with defaults if missing.</summary>
        public static FusionConfig GetOrCreateConfig()
        {
            // Wherever the user put it; only fall back to creating one if the project has none.
            var guids = AssetDatabase.FindAssets("t:" + nameof(FusionConfig));
            if (guids.Length > 0)
            {
                if (guids.Length > 1)
                    Debug.LogWarning($"[Fusion] {guids.Length} FusionConfig assets found; using {AssetDatabase.GUIDToAssetPath(guids[0])}.");
                return AssetDatabase.LoadAssetAtPath<FusionConfig>(AssetDatabase.GUIDToAssetPath(guids[0]));
            }

            var dir = System.IO.Path.GetDirectoryName(ConfigPath).Replace('\\', '/');
            if (!AssetDatabase.IsValidFolder(dir)) AssetDatabase.CreateFolder("Assets", System.IO.Path.GetFileName(dir));
            var config = ScriptableObject.CreateInstance<FusionConfig>();
            AssetDatabase.CreateAsset(config, ConfigPath);
            AssetDatabase.SaveAssets();
            Debug.Log($"[Fusion] Created {ConfigPath} ({config.Describe()}).");
            return config;
        }

        static void AddToBuildSettings(string path)
        {
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            if (scenes.Any(s => s.path == path)) return;
            scenes.Insert(0, new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }

        // The prototype talks to http://localhost. Unity refuses cleartext HTTP unless this is relaxed;
        // "DevelopmentOnly" keeps release builds HTTPS-only, which is what the real server will use.
        static void AllowLocalhostHttp()
        {
            if (PlayerSettings.insecureHttpOption == InsecureHttpOption.NotAllowed)
            {
                PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
                Debug.Log("[Fusion] PlayerSettings > Allow downloads over HTTP set to 'Development builds only' for the localhost prototype.");
            }
        }
    }
}
