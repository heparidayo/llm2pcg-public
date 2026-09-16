# LLM2PCG

[English](README.md) | [한국어](README.ko.md)

LLM2PCG is a procedural content generation (PCG) project that creates 3D virtual worlds from a single natural-language sentence or manually configured settings.

The same resolved request, seed and generator version always reproduce the same result.

Results can be viewed in a **browser (Three.js) or Unity 6**, with **Unreal Engine integration planned**.

![LLM2PCG Forest with detailed trees and a cloud skybox — Seed 234, Unity showcase](Media/Showcase/hero-seed234-forest.png)
Capture: `2026-09-13` · Unity `6000.5.10f1` · seed `234` · `128×128` · `DefaultForest` · water threshold `.20` · noise octaves `4` · clearing radius `14` · vegetation distance/max `4/600` · elevation scale/frequency `6/.035` · default visual settings · `Surface + props` · world hash `5979C289` · [Exact request JSON](Shared/Examples/showcase-seed234-forest-20260913.json)

Camera: `1920×1080`, perspective FOV `60°`, position `(64,9,42)`, rotation `(2,335,0)`, UI hidden. Appearance: `forest.default` profile, visual layout hash `773E2BD3`, panoramic cloud skybox (rotation `110°`, exposure `1.13`).

> The commercial assets, skybox and development scene shown above are not included in this repository. The public demo runs with primitive geometry and requires no external art assets. This capture uses the v3 `forest-biome@1` path; the v4 examples use a separate path. Reproducing the same appearance requires the matching generator implementation, assets and rendering settings. A matching world hash does not imply an identical image.

## Architecture

```text
Natural language --> LLM --> Node.js resolver
                                  |
Direct JSON / MCP --> Validated JSON + Seed
                                  |
               +------------------+------------------+
               v                                     v
        .NET CoreHost                       Unity loopback Bridge
        Shared C# PCG Core                  Shared C# PCG Core
               |                                     |
        Generated world data                Unity mesh / instancing
               |
        +------+--------------------+
        v                           : HTTP / world-data contract
 Three.js renderer                  v
                             Unreal C++ adapter [PLANNED]
                                    :
                                    v
                             Unreal mesh / instancing [PLANNED]
```

Solid lines indicate implemented paths; dotted lines and `[PLANNED]` indicate planned integration. Unreal is planned to consume world data from .NET CoreHost through a C++ adapter and display it using meshes and instancing, rather than run the C# core inside the engine or regenerate placements. This does not indicate a currently available Unreal feature or verified Unreal replay results. Replay requires the resolved request, seed and matching generator implementation.

Supported worlds: Dungeon, Cave, Forest, City, Swamp, Snowfield, and Desert.
Planned worlds: ...

## Generation examples

Actual Unity demonstrations without commercial assets. The visual assets, materials and demonstration scenes shown here are not included in this repository; the demo available after cloning uses simple primitive geometry. These images illustrate a variety of generated environments, not an evaluation showing that every natural-language constraint has been fully satisfied.

| Woodland | Cherry-blossom forest |
| --- | --- |
| ![Woodland](Media/Showcase/01-woodland-detail.png) | ![Cherry-blossom forest](Media/Showcase/02-cherry-detail.png) |
| City | Dungeon |
| ![City](Media/Showcase/07-city-detail.png) | ![Dungeon](Media/Showcase/08-dungeon-detail.png) |
| Swamp | Cave (ceiling removed) |
| ![Swamp](Media/Showcase/05-swamp-detail.png) | ![Cave (ceiling removed)](Media/Showcase/06-cave-detail.png) |
| Desert | Snowfield |
| ![Desert](Media/Showcase/03-desert-detail.png) | ![Snowfield](Media/Showcase/04-snowfield-detail.png) |

Seed / size for unchanged captures: woodland 234 / 96×96; city 715 / 96×96; dungeon 816 / 64×64; snowfield 412 / 96×96. Request metadata was not supplied for the replacement cherry-blossom, desert, swamp or cave images, so their previous seed and size values are omitted. A seed alone is insufficient for replay: retain the resolved request and matching generator implementation.

### Spatial and visual control (v4)

Actual primitive-profile Unity captures: 128×128, Seed 234. No external art assets are required. At `/spatial-v4`, select a README gallery example, load it and generate Web 3D. For file-based replay, save one entry's `request` object from [the gallery examples](Shared/Examples/spatial-v4-gallery.json) as JSON; do not upload the whole gallery array.

| Central mountain | Exclusive central lake |
| --- | --- |
| ![Central mountain](Media/Showcase/v4-forest-mountain-234-128.png) | ![Exclusive lake](Media/Showcase/v4-forest-exclusive-lake-234-128.png) |
| River and separate bridge deck | Desert lake |
| ![River and bridge](Media/Showcase/v4-forest-river-bridge-234-128.png) | ![Desert lake](Media/Showcase/v4-desert-exclusive-lake-234-128.png) |
| Snowfield mountain | Swamp river and bridge |
| ![Snowfield mountain](Media/Showcase/v4-snowfield-mountain-234-128.png) | ![Swamp river and bridge](Media/Showcase/v4-swamp-river-bridge-234-128.png) |
| Cherry trees across eligible ground | Cherry trees restricted to the riverbank |
| ![Whole-map cherry](Media/Showcase/v4-wholemap-cherry-234-128.png) | ![Riverbank cherry](Media/Showcase/v4-riverbank-cherry-234-128.png) |

The last pair changes the tree region while retaining the seed, river and other parameters. These are controlled structured-request examples, not a claim that every natural-language prompt is interpreted correctly.

## Current capabilities

- Natural-language translation and direct JSON input, seven world types, and visual-category type, density, and count-cap controls.
- Legacy v3 supports seven world types; its `layoutSettings` still accepts neutral compatibility values only. Existing v3 snapshots are not silently upgraded.
- Experimental v4 supports Forest, Desert, Snowfield and Swamp: one mountain/lake/river per kind, positioned landmarks, central crossing rivers, exclusive water, no paths, and straight paths with separate bridge decks.
- v4 includes shared semantic placements, type/region restrictions, Off, relative density and maximum counts. Unity and Web consume the same placement coordinates/transforms; their materials and appearance differ. Legacy v3 browser placement remains a subset of Unity controls.
- v4 does not support City/Cave/Dungeon spatial control, exact counts, arbitrary relations, clustering, cactus/palm models or guaranteed walkability. Snow water has an ice-colored visual surface, not a tested traversable ice system.
- The Core validates numeric and type constraints and reports selected incomplete-generation conditions through world.diagnostics.
- Replay uses the same resolved request and generator implementation. Translating the same prompt again may produce different parameters.

## Requirements

- Git
- .NET 8 SDK
- Node.js 20 or newer
- PowerShell 7 recommended
- Unity `6000.5.10f1` for the Unity demo (the standalone browser demo does not require Unity)

## Clone and verify

```powershell
git clone https://github.com/heparidayo/llm2pcg.git
cd llm2pcg
pwsh -File ./Scripts/Test-Clone.ps1
```

The verification script installs locked Web dependencies, runs Web/MCP tests, builds the .NET host, checks deterministic replays and performs seven-world legacy plus eight-example v4 API smoke tests. Development-only fixture tests are explicitly skipped in this curated checkout.

## Run the browser demo

```powershell
pwsh -File ./Scripts/Start-StandaloneWeb.ps1
```

Open `http://127.0.0.1:3000`. The default preset/direct generation flow is local and does not require an API key. Press `Ctrl+C` in the terminal to stop both owned processes.

Open `http://127.0.0.1:3000/spatial-v4` for spatial control. Resolve the example intent, then generate Web 3D. Save the final JSON to replay; “new Seed” changes only the seed without calling the LLM. Same request-ID retries are deduplicated during the current server process; retain the final JSON across restarts.

For optional natural-language request translation, copy `Web/.env.example` to `Web/.env`, add your own server-side key, and never commit that file.

## Use MCP

With the standalone server running, configure an MCP client to launch `node` with an absolute path to `MCP/src/server.mjs`. This stdio server has no additional dependencies or API-key requirement. The `generate_world_v4` tool accepts `{ "request": <resolved v4 JSON> }` and returns CoreHost world data; it does not render a Unity scene. `PCG_V4_CORE_ENDPOINT` overrides its default `http://127.0.0.1:8090/api/v4/world/generate` when using a custom Core port.

The legacy `generate_world` / `generate_dungeon` tools instead target Unity's opt-in bridge at `http://127.0.0.1:8088/pcg/generate` (`UNITY_PCG_ENDPOINT` override). Never expose either local bridge to an untrusted network.

## Run the Unity demo

1. Add the cloned `UnityDemo` folder in Unity Hub.
2. Open `Assets/PCGPublicDemo/Scenes/PrimitiveDemo.unity`.
3. Enter Play Mode.
4. Choose a world type and seed from the overlay. Press `F1` for the first-person test.

The sample creates its camera, light, generation pipeline, and visual fallback materials at runtime. It needs no external art assets. Its HTTP bridge is opt-in in package code, loopback-only, and explicitly enabled by this local demo scene on port `8088`.

For v4, stay outside Play Mode and choose **Tools → LLM2PCG → Experimental v4 → Start HTTP Preview**. This separate primitive-only preview listens on loopback port `8089`, accepts up to 256×256, and does not modify your working scene. Use the Unity generation button at `/spatial-v4`; close the preview window to stop it. Web/Core data generation supports up to 500×500.

An explicit v3 migration proposal can be printed with `node Scripts/Propose-V4Migration.mjs saved-v3-request.json`. Review its warnings and proposed `request`: it creates a different v4 world and never overwrites or automatically runs the source snapshot.

## Reuse as a Unity package

Unity Package Manager can install the package subfolder using a Git URL in the following format. Replace `<tag>` with an actual tag to select a specific version.

```text
https://github.com/heparidayo/llm2pcg.git?path=/Packages/com.heparidayo.llm2pcg#<tag>
```

Alternatively, add `Packages/com.heparidayo.llm2pcg` from the clone as a local package.

## Repository structure

- `Packages/com.heparidayo.llm2pcg`: reusable Unity runtime and EditMode tests
- `UnityDemo`: primitive-only Unity demonstration project
- `Standalone`: .NET 8 host for Unity-independent generation
- `Web`: Three.js browser renderer and optional prompt adapter
- `MCP`: stdio tools for validated, resolved requests
- `Shared`: versioned JSON Schema and JavaScript validation/defaults
- `Scripts`: clone verification and local launcher

## License

The project's original source code and accompanying software documentation are available under the [MIT License](LICENSE). You may use, modify and redistribute them, including commercially, provided you retain the copyright and license notices. The software is provided without warranty.

Showcase screenshots and other media are excluded from the MIT grant; see [Asset and media license](ASSET_LICENSE.md). Their inclusion does not grant rights to the depicted source assets. Third-party software and assets remain subject to their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).
