# Orbpoly — Poki Performance & Fast-Load Optimization Specification

> **Purpose:** This document is the implementation contract for an AI coding agent optimizing **Orbpoly** for Poki submission.
>
> **Primary objective:** Make the existing Three.js/WebGL game load in seconds and maintain stable performance on low-end desktop and mobile-class hardware **without redesigning the game, replacing the art, reducing the intended graphics quality, or changing gameplay.**
>
> **Repository:** `Sohaibgillani6789/Orbpoly`
>
> **Source-of-truth rule:** The current game is the source of truth. Optimize **how** it is implemented, loaded, scheduled, uploaded to the GPU, and bundled — not **what** the player sees or how the game behaves.

---

## 0. Read This Before Touching Code

This is a **performance-only** task.

### Absolutely do NOT change

- Game design or game loop.
- Floating-island/land layout.
- Six low-poly character designs.
- Character meshes, rigs, animation sets, proportions, colors, or materials.
- Grass visual density or intended appearance.
- WebGL sky appearance.
- Day/night transition appearance or timing.
- Moon/rock/sky/grass visual style.
- Combat mechanics, hitboxes, damage, cooldowns, movement, jumping, stamina, attacks, AI decisions, physics rules, or timing.
- Controls or control feel.
- Multiplayer/network semantics.
- Camera composition unless a change is strictly required for a correctness/performance bug and produces no design change.
- HUD design.
- Audio design.
- Level geometry as an art/design decision.
- Intended shader effects.
- Gameplay features.

### Do NOT solve performance by simply

- Removing characters.
- Removing grass.
- Removing sky effects.
- Removing particles.
- Disabling shadows/effects solely because they are expensive.
- Replacing models with visibly simpler models.
- Lowering texture resolution merely to improve performance.
- Removing day/night transitions.
- Slowing gameplay.
- Reducing animation quality.
- Reducing physics accuracy in a way players can notice.
- Adding a fake "low graphics" mode.

### Allowed

The agent may change:

- Loading order.
- Asset scheduling.
- Asset caching/reuse.
- Compression/build configuration.
- Code splitting where safe.
- Dead-code removal.
- Debug-code removal from production.
- JavaScript allocations.
- Object pooling.
- Three.js resource reuse.
- Draw-call reduction when visual output is preserved.
- Instancing when behavior and appearance are preserved.
- Buffer update strategy.
- GPU buffer usage hints.
- Shader algebra/compiler optimization when output is preserved.
- CPU/GPU scheduling.
- Physics/AI update scheduling only when simulation behavior remains equivalent.
- Network serialization frequency/packing only when protocol/game behavior remains equivalent.
- Device-pixel-ratio handling when it is used to prevent pathological GPU cost, provided the resulting game remains visually equivalent at supported targets.
- Production logging removal.
- DOM update batching.
- Browser lifecycle handling.
- Memory cleanup/disposal.
- Vite/Rollup production optimization.
- Local asset bundling.
- Poki integration required for release.

**Rule:** If an optimization visibly changes the game or changes gameplay semantics, reject it and document it instead of silently implementing it.

---

# 1. Poki Targets

Poki's current developer documentation emphasizes fast loading, small builds, stable frame rates, desktop/mobile/tablet support, and minimal onboarding. Poki says players tend to leave when loading takes more than 10 seconds and recommends progressive loading. Its web-engine guidance describes an initial download of about **5 MB or less** and about **8 MB total** as a strong target for web games.

Therefore use these engineering targets:

| Metric | Target |
|---|---:|
| Initial compressed download | **<= 5 MB preferred** |
| Total compressed game download | **<= 8 MB preferred** |
| First meaningful/playable experience | **as early as possible; target < 5 s on a realistic mobile connection** |
| Hard loading ceiling | **avoid > 10 s** |
| 60 FPS frame budget | **16.67 ms** |
| 30 FPS frame budget | **33.33 ms** |
| Main-thread spikes | Avoid sustained > 16.67 ms on target devices |
| Production console spam | **0** |
| Duplicate asset requests | **0** |
| External non-Poki asset requests | **0** |
| Runtime shader/material creation during combat | **0** |

These are engineering targets, not permission to reduce the visual design.

---

# 2. Repository Audit — Known Hotspots

The current repository was inspected before writing this specification.

### Confirmed observations

1. `src/script.js` is a large entry point and is approximately 90 KB in the current repository snapshot.
2. The project uses Three.js `0.158.x`, Cannon-es, Socket.IO, custom GLSL shaders, Vite, GLTF/OBJ loaders, and custom game modules.
3. The grass system currently uses:

```js
const BLADE_COUNT = 120000;
```

4. The grass generation code already contains pooled `THREE.Vector3` scratch objects. Preserve and extend this allocation-free approach.
5. The renderer currently uses:

```js
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

A DPR of 2 can create **4x the pixel workload of DPR 1**, so this must be profiled on low-end devices rather than treated as universally safe.
6. The loading manager currently waits for assets and then uses additional delayed loader fade/initialization logic. There is an avoidable post-load delay in the current startup path.
7. Audio is loaded through the same `LoadingManager` before the player starts gameplay. This makes an optional/non-critical audio asset part of the critical loading path.
8. `src/index.html` currently loads Google Fonts from `fonts.googleapis.com` / `fonts.gstatic.com`. This conflicts with Poki's no-external-requests requirement and must be removed or replaced with a bundled/local solution.
9. The current entry point imports `OrbitControls` and `lil-gui`. Determine whether they are required in the production path. If they are development-only, eliminate them from the production bundle through build-time separation/tree-shaking rather than carrying debug tooling to players.
10. The repository already contains `ORBPOLY_PERFORMANCE_OPTIMIZATION.md`. Use it as supporting material, but this document is the **Poki-focused release specification** and takes precedence where it is more specific.

---

# 3. Phase 0 — Establish a Baseline

Do not begin with speculative optimization.

Create a baseline report before major changes.

Measure at minimum:

### Loading

- Raw build size.
- Brotli size.
- Gzip size.
- Initial request count.
- Total request count.
- Largest files.
- Time to first byte where measurable.
- Time to first canvas.
- Time to first rendered frame.
- Time to loading-manager completion.
- Time to `initializeScene()`.
- Time to first player input.
- Time to first playable gameplay.

### Rendering

- FPS.
- Average frame time.
- Worst frame time.
- 1% lows where tooling permits.
- Draw calls.
- Triangles.
- Geometries.
- Textures.
- Shader/program count.
- GPU memory indicators where available.
- Renderer pixel ratio.

### CPU

- JavaScript main-thread time.
- Physics time.
- AI/bot time.
- Animation time.
- Network update time.
- DOM/HUD update time.
- Garbage-collection spikes.

### Test profiles

At minimum test:

1. Modern desktop.
2. Low-end/integrated desktop or laptop GPU.
3. Mid-range Android-class phone.
4. Low-end Android-class phone/browser if available.

Do not declare success from a high-end desktop alone.

---

# 4. Critical Loading Optimization

This is the highest-priority Poki work.

## 4.1 Split assets into critical and non-critical

Create an explicit loading plan.

### Critical before gameplay

Only load what is required to display the first playable game state:

- Core JavaScript.
- Core shaders.
- First playable island/scene resources.
- Player character assets required for immediate interaction.
- Required collision/physics data.
- Essential HUD assets.

### Deferred/background

Load after the game becomes playable when possible:

- Optional audio.
- Non-visible character assets.
- Character-selection assets not required for the first playable state.
- Secondary effects.
- Decorative assets not visible in the initial camera.
- Assets for later states/menus.

**Important:** Deferred loading must not create a visible pop-in of required gameplay content.

## 4.2 Do not make audio block startup

The current `AudioLoader` is attached to the same `LoadingManager` used for startup. The player does not need the music buffer to begin gameplay.

Change the architecture so:

```text
critical gameplay assets
        ↓
first playable frame
        ↓
Poki gameLoadingFinished()
        ↓
background audio / secondary assets
```

The first interaction must not depend on optional audio being downloaded and decoded.

## 4.3 Remove artificial startup delays

The current loading flow contains delayed loader fade/removal and delayed scene initialization after all promises resolve.

Do not keep arbitrary 500 ms/500 ms waits merely for animation aesthetics.

The loading animation can remain visually polished, but the game should become playable as soon as the critical path is ready.

If a fade animation is retained, it must not block initialization of the game.

## 4.4 Parallelize safe loads

If assets have no dependency relationship, request them concurrently.

Do not serialize:

```text
asset A → wait → asset B → wait → asset C
```

when the browser can safely download/decode them concurrently.

At the same time, do not start dozens of unnecessary downloads before the first playable state.

The goal is **parallel critical work + deferred non-critical work**, not simply "load everything at once."

## 4.5 Cache loaded resources

Every texture/model/audio resource should have one canonical loaded instance where possible.

Never accidentally request the same URL multiple times because multiple systems independently instantiate loaders.

Create a small asset registry/cache if required.

---

# 5. Poki External-Request Compliance

This is a release blocker.

Poki blocks external requests by default. All fonts, game assets, shaders, libraries, and other resources should be bundled/local unless they are an explicitly supported Poki service.

### Current known problem

`src/index.html` references Google Fonts.

Remove the external Google Fonts dependency.

Options:

1. Use a system font with equivalent visual intent.
2. Bundle the font locally if licensing permits.
3. Keep the UI's visual hierarchy while removing the external network request.

Do not replace Google Fonts with another third-party CDN.

### Search the complete project for

```text
https://
http://
fonts.googleapis
fonts.gstatic
cdn.
unpkg
jsdelivr
cloudflare
raw.githubusercontent
external image URLs
external audio URLs
external model URLs
```

Every external dependency must be reviewed.

The only external request expected for the Poki build should be the supported Poki SDK/service integration as required by Poki's documentation.

---

# 6. Poki SDK Integration

Performance optimization must not break Poki analytics and ad lifecycle events.

Implement the Poki SDK using the official integration pattern.

Required lifecycle concepts include:

```js
PokiSDK.init()
PokiSDK.gameLoadingFinished()
PokiSDK.gameplayStart()
PokiSDK.gameplayStop()
PokiSDK.commercialBreak()
```

### Rules

- `gameLoadingFinished()` fires exactly once when the loading phase has genuinely finished.
- `gameplayStart()` fires on the player's first actual gameplay input, not merely because assets finished loading.
- Do not fire duplicate start/stop events.
- Gameplay interruptions must correctly stop gameplay state.
- Do not run gameplay SDK events during an ad break.
- `commercialBreak()` must follow Poki's documented lifecycle.

Keep the game playable if SDK initialization fails.

Do not block the entire game indefinitely waiting for SDK initialization.

---

# 7. Bundle Size Optimization

The current project has a large dependency surface for a small browser game.

Audit production imports carefully.

### Investigate

- `lil-gui`.
- `OrbitControls`.
- Debug/performance panels.
- Development-only logging.
- Development-only helpers.
- Unused shader modules.
- Unused loaders.
- Unused utility functions.
- Duplicate code.
- Dead game modes or prototypes.
- Duplicate assets.
- Source maps in the submitted build.

### Rule

Do not remove a dependency merely because it exists in `package.json`.

Confirm whether it is reachable from the production entry graph.

Prefer:

```text
production build
    ↓
only production code
    ↓
only production dependencies
```

rather than shipping development tooling and then hiding it at runtime.

### Vite/Rollup

Use production build features appropriately:

- minification;
- tree-shaking;
- asset hashing;
- compressed static assets;
- code splitting where it genuinely improves initial loading;
- no unnecessary source maps in the submitted package;
- no development diagnostics.

Do not over-split tiny files into hundreds of network requests.

---

# 8. Renderer Optimization

The renderer is currently capped at DPR 2.

Do not blindly leave:

```js
Math.min(window.devicePixelRatio, 2)
```

without measuring.

A 2x linear DPR means roughly 4x as many pixels as DPR 1.

### Requirement

Implement a **measured, safe renderer-pixel strategy**.

Possible approach:

- High-end desktop: preserve current quality.
- Low-end/mobile: prevent pathological pixel workload.
- Use one centralized DPR policy instead of each system separately reading `window.devicePixelRatio`.

If reducing DPR is necessary on a low-end device, do it only as a rendering-resolution safeguard, not as a game-design quality downgrade.

Do not create separate inconsistent pixel-ratio values across grass, particles, collectibles, renderer, and post effects.

Centralize the effective render scale.

---

# 9. Grass — Highest GPU Priority

The game currently uses approximately 120,000 grass blades.

**Do not reduce the blade count as the default optimization.**

The visual density is part of the current design.

Instead optimize the implementation.

## 9.1 Generation

The existing code already pools temporary vectors in `generateBlade()`.

Continue this pattern.

Remove:

- per-blade object creation;
- temporary arrays;
- redundant conversions;
- repeated constants;
- repeated trigonometric calculations where values can be reused;
- repeated random generation when deterministic precomputation is possible.

Generate static grass buffers once.

## 9.2 Buffer usage

Inspect every grass `BufferAttribute`.

Determine which attributes are static.

For static data, use appropriate static GPU usage hints.

Do not upload unchanged buffers every frame.

For dynamic data, update only the required range.

## 9.3 GPU animation

Keep grass animation on the GPU.

Preferred architecture:

```text
static grass geometry
       ↓
GPU vertex shader
       ↓
time + existing interaction uniforms
       ↓
animated grass
```

Do not move per-blade animation to JavaScript.

## 9.4 Grass shader

Profile the grass vertex and fragment shaders.

Optimize:

- repeated calculations;
- repeated normalization;
- repeated trigonometry;
- repeated noise calls;
- duplicated uniforms/math;
- unnecessary precision where it produces no visible difference;
- calculations that are invariant per vertex/fragment;
- texture sampling;
- overdraw.

Do not remove the visual wind/interaction/lighting behavior.

---

# 10. Sky / Day-Night Shader Optimization

The sky is visually important and must remain unchanged.

The goal is to reduce shader cost without changing the day/night result.

Audit the sky shaders for:

- repeated `sin/cos/pow/sqrt` calls;
- repeated vector normalization;
- calculations that depend only on time and can be calculated once per frame on CPU and passed as uniforms;
- duplicate color calculations;
- unnecessary per-fragment work;
- repeated noise evaluation.

Example principle:

If a value depends only on global time and sun position:

```text
BAD:
calculate the same value for every fragment

BETTER:
calculate once per frame
→ upload uniform
→ reuse in shader
```

Only do this where numerical output remains visually equivalent.

Do not change:

- day/night timing;
- colors;
- sky gradients;
- cloud appearance;
- sun/moon behavior;
- fog mood.

---

# 11. Six Characters — Rendering Strategy

There are six low-poly characters.

Do not remove them or replace them.

Audit:

- duplicated geometries;
- duplicated textures;
- duplicated materials;
- repeated animation mixers;
- unnecessary skeleton updates;
- redundant world-matrix updates;
- repeated resource cloning.

### Safe optimization opportunities

- Share immutable geometries/material resources where visually identical.
- Cache loaded models.
- Avoid loading the same model multiple times.
- Reuse animation clips.
- Avoid repeated traversal of an unchanged model hierarchy.
- Update only the active animation state.
- Remove redundant per-frame calculations.

Do not merge animated characters into one system if it changes their animation behavior.

---

# 12. Animation Optimization

Inspect `AnimationStateMachine.js` and character controllers.

Do not update every animation system more often than necessary.

Avoid:

- allocating arrays every frame;
- creating temporary animation objects;
- repeatedly searching for the same bones/actions;
- restarting the same animation unnecessarily;
- setting identical mixer/action values every frame.

Cache references during initialization:

```text
bone lookup
animation action lookup
material lookup
mesh lookup
```

Do not perform repeated name-based searches in hot loops when a reference can be cached.

---

# 13. CPU Main Loop

The main loop should be structured so expensive systems execute exactly once per frame where required.

Preferred conceptual ordering:

```text
input
→ simulation timing
→ physics
→ AI
→ animation
→ network interpolation
→ gameplay effects
→ UI state changes
→ render
```

Do not allow multiple systems to independently calculate:

- current time;
- delta time;
- player position;
- camera position;
- distance calculations;
- day/night values;
- shared world transforms.

Calculate once and reuse.

Avoid `new THREE.Vector3()`, `new THREE.Quaternion()`, arrays, objects, closures, `.map()`, `.filter()`, `.reduce()`, `.slice()`, and string interpolation inside high-frequency loops unless profiling proves the path is irrelevant.

---

# 14. Garbage Collection

GC spikes are especially damaging on mobile.

Audit all hot paths for allocations.

Priority areas:

- `GameManager`.
- `PlayerController`.
- `BotController`.
- `CombatSystem`.
- `AnimationStateMachine`.
- `NetworkManager`.
- `DustMotes`.
- `CollectibleOrb`.
- `PhysicsWorld`.
- render loop.
- collision loops.

Use pooling for genuinely high-churn temporary objects:

- combat effects;
- dust particles;
- hit results;
- temporary vectors;
- temporary event objects;
- network interpolation buffers.

Do not create complicated pools for objects created once during startup.

---

# 15. Physics — Cannon-es

Inspect `PhysicsWorld.js` and all code that steps the Cannon world.

Goals:

- Avoid duplicate physics steps.
- Avoid accidental multiple `world.step()` calls per frame.
- Avoid allocations during collision processing.
- Cache body references.
- Avoid creating/destroying physics bodies repeatedly during ordinary gameplay.
- Reuse collision result structures.
- Keep collision filters efficient.
- Preserve exact gameplay collision semantics.

A fixed-step simulation may be used if the existing architecture supports it, but do not change combat/movement behavior merely for a theoretical optimization.

Do not reduce solver quality, timestep, or iterations unless profiling proves the change is behaviorally identical and visually/gameplay identical.

---

# 16. AI / Bot Optimization

Inspect `BotController.js`.

Do not change AI decisions.

Instead optimize implementation:

- Cache player/bot references.
- Avoid repeated scene searches.
- Avoid allocations in decision loops.
- Cache reusable vectors.
- Avoid recalculating distances unnecessarily.
- Reuse target information within the same frame.
- Avoid duplicate raycasts/queries when the result can safely be reused.

If AI can be safely evaluated less frequently while preserving identical decisions and timing, document and benchmark it before implementation. Do not make a gameplay-affecting change silently.

---

# 17. Network Optimization

Inspect `NetworkManager.js` and the server-side networking code.

Do not change multiplayer semantics.

Audit:

- packet frequency;
- duplicate events;
- JSON allocations;
- MessagePack allocations;
- serialization of unchanged state;
- repeated object creation;
- unnecessary DOM/network logging.

Prefer compact reusable state objects and interpolation buffers.

Never sacrifice authoritative state correctness for bandwidth.

---

# 18. DOM / HUD Optimization

The game contains a substantial HTML HUD.

Do not redesign it.

Optimize how it is updated.

### Avoid

```js
element.style.foo = ... // dozens of times every frame
```

when the same result can be applied only when the value actually changes.

Cache DOM references once.

Batch UI updates where practical.

Avoid querying:

```js
document.querySelector(...)
document.getElementById(...)
```

inside high-frequency loops when the reference can be cached.

Avoid rebuilding SVG/HTML strings every frame.

---

# 19. Logging and Debug Code

The current loader contains multiple `console.log()` / `console.error()` calls.

Development logs are useful while debugging but must not flood production.

Production build requirement:

- No loading-progress spam.
- No per-frame logs.
- No network debug logs.
- No physics debug logs.
- No shader debug logs.
- No GUI/debug panels.
- No temporary performance overlays.

Keep error handling, but make it concise and production-safe.

---

# 20. Memory Management

Audit lifecycle cleanup for:

- geometries;
- materials;
- textures;
- render targets;
- audio buffers;
- animation resources;
- event listeners;
- timers;
- DOM listeners;
- WebSocket/Socket.IO listeners.

When an object is permanently removed from the game, ensure its GPU resources are released when they are no longer shared.

Never dispose a resource that another active object still uses.

Prefer shared resource ownership with explicit lifetime management.

---

# 21. Texture Optimization Without Visual Downgrade

Do not simply resize textures.

Instead inspect:

- duplicate texture downloads;
- duplicate texture objects;
- unnecessary copies;
- incorrect color-space configuration;
- unnecessary runtime texture processing;
- missing compression opportunities that preserve visual quality;
- images that are far larger than their actual display size.

If converting an image format/compression method preserves the intended visual result and materially reduces download size, it is allowed.

Measure compressed output, not only source-file size.

---

# 22. Production Asset Compression

Audit all static assets:

- JPG.
- PNG.
- WebP.
- AVIF where browser compatibility and visual correctness are safe.
- GLTF/GLB.
- OBJ.
- MTL.
- audio.
- GLSL.

### Priority

1. Remove duplicate assets.
2. Compress without visible quality loss.
3. Prefer efficient binary formats where already compatible with the project.
4. Minify shaders in production if Vite/plugin tooling safely handles them.
5. Brotli/gzip the deployable files.
6. Measure final transfer size.

Do not convert an asset solely because the format is newer. Benchmark actual network size and decode cost.

---

# 23. Progressive Loading Architecture

The preferred startup architecture is:

```text
HTML shell
   ↓
Poki SDK initialization (non-blocking failure-safe)
   ↓
minimal game JS
   ↓
critical scene + player assets
   ↓
first rendered playable state
   ↓
PokiSDK.gameLoadingFinished()
   ↓
player input / gameplayStart()
   ↓
background loading of secondary assets
```

Do not make the player wait for every asset in the repository if the player can already begin playing.

Do not show a completed loading bar while the game is still unable to play.

---

# 24. Browser Lifecycle

Handle:

- tab hidden;
- tab visible;
- mobile browser suspension;
- orientation changes;
- resize;
- lost WebGL context where practical;
- returning from an ad.

Prevent huge delta-time values after browser suspension from causing simulation explosions.

Pause expensive work when gameplay is genuinely paused.

Do not continue unnecessary animation/AI/physics work behind menus or ads.

---

# 25. Responsive / Poki Web-Fit Requirements

Poki requires desktop, mobile, and tablet support and a canvas that scales correctly.

The game should preserve its design while handling:

- 640×360.
- 836×470.
- 1031×580.
- common mobile landscape sizes.
- tablet sizes.

Do not introduce a second visual design.

Do not allow the page itself to scroll because of the game viewport.

Keep the WebGL canvas proportional and correctly sized.

Do not use browser CSS scaling that accidentally renders a huge backing canvas.

---

# 26. Production Build Verification

After optimization:

```bash
npm run build
```

Then inspect the actual `dist/` directory.

Measure:

- total file count;
- total uncompressed size;
- total Brotli size;
- total gzip size;
- largest assets;
- largest JS chunk;
- largest texture/model/audio.

Do not judge performance from development mode.

Use the exact production build for final testing.

---

# 27. Poki Inspector Gate

Before declaring the work complete, run the final build through Poki Inspector.

Check:

- SDK integration.
- Game loading event.
- Gameplay start/stop events.
- Mobile mode.
- Scaling tests.
- External resource warnings.
- Image optimization warnings.
- Unexpected behavior warnings.
- File size.
- Loading time.

Every warning must be investigated.

Do not mark an issue as solved merely because the game still starts.

---

# 28. Performance Acceptance Tests

The optimization is successful only if all of the following are true.

## Visual acceptance

Side-by-side comparison shows no intentional downgrade in:

- grass density;
- character appearance;
- island appearance;
- sky;
- day/night transition;
- lighting mood;
- particles;
- combat effects;
- HUD;
- animation.

## Gameplay acceptance

Regression test:

- movement;
- jump;
- attacks;
- hit reactions;
- damage;
- stamina/cooldowns;
- character selection;
- bots;
- collectibles;
- physics;
- multiplayer/network behavior;
- win/lose state;
- audio;
- pause/resume.

## Loading acceptance

- No unnecessary blocking audio.
- No artificial post-load delay.
- No duplicate asset requests.
- No external non-Poki asset requests.
- First playable state arrives as early as possible.
- Production build is materially smaller than the unoptimized baseline.

## Runtime acceptance

- No new console errors.
- No per-frame console spam.
- No obvious GC spikes introduced by the optimization.
- No memory leak after repeated matches/restarts.
- Stable frame pacing on target low-end hardware.

---

# 29. Optimization Order — Do Not Randomly Edit Everything

Implement in this order:

### P0 — Release blockers

1. Remove external Google Fonts/CDN dependencies.
2. Ensure all game assets are local/bundled.
3. Remove production debug tooling/logging.
4. Establish production build size measurements.
5. Fix loading-manager architecture.
6. Stop optional audio from blocking startup.
7. Remove artificial startup delays.
8. Add/verify Poki SDK loading/gameplay lifecycle.

### P1 — Biggest likely performance wins

9. Analyze 120k grass GPU cost.
10. Analyze renderer DPR/pixel workload.
11. Profile custom sky/grass fragment shaders.
12. Remove duplicate texture/model loads.
13. Reduce draw calls without visual changes.
14. Remove JS allocations from frame/physics/AI loops.
15. Cache repeated scene/object/bone/material lookups.

### P2 — Runtime stability

16. Physics allocation audit.
17. AI allocation audit.
18. Animation mixer/action audit.
19. Network allocation/serialization audit.
20. HUD/DOM update audit.
21. GPU resource lifecycle/disposal audit.

### P3 — Final build optimization

22. Vite/Rollup tree-shaking audit.
23. Asset compression.
24. Brotli/gzip verification.
25. Remove source maps/debug artifacts from release.
26. Poki Inspector.
27. Low-end mobile testing.
28. Regression testing.

---

# 30. Agent Workflow

The coding agent must work like a performance engineer, not a code generator.

For every optimization:

```text
INSPECT
  ↓
MEASURE
  ↓
IDENTIFY HOTSPOT
  ↓
FORM HYPOTHESIS
  ↓
MAKE SMALLEST SAFE CHANGE
  ↓
BUILD
  ↓
RUN / PROFILE
  ↓
VISUAL REGRESSION TEST
  ↓
GAMEPLAY REGRESSION TEST
  ↓
COMPARE METRICS
```

Never make 20 unrelated edits and call the result optimized.

### Before editing

Read the relevant complete file and its callers/callees.

Understand ownership of:

- scene objects;
- resources;
- materials;
- textures;
- animation mixers;
- physics bodies;
- event listeners;
- network state.

### After editing

Run:

```bash
npm run build
```

Then verify:

- build succeeds;
- no import errors;
- no runtime errors;
- no missing assets;
- no shader compile errors;
- no broken gameplay;
- no visual regression.

---

# 31. Do Not Optimize Based on Assumptions

Examples of bad reasoning:

> "120k grass is too much, reduce it to 30k."

Rejected.

Better:

> "120k grass creates X ms GPU time. Preserve 120k visual density and optimize buffer/shader/overdraw/draw submission until the same scene is cheaper."

Another bad approach:

> "Six characters are expensive, hide three."

Rejected.

Better:

> "Six characters cause duplicate geometry/material/animation work. Share resources and eliminate redundant CPU work while retaining all six characters."

Another bad approach:

> "The sky shader is expensive, remove the day/night effect."

Rejected.

Better:

> "Profile the sky shader, move frame-invariant work to uniforms, remove duplicate calculations, and preserve the same day/night output."

---

# 32. Required Optimization Report

At the end of the work, create/update a report containing:

```text
BASELINE
- initial compressed size:
- total compressed size:
- first playable time:
- draw calls:
- triangles:
- FPS:
- worst frame time:
- JS heap:

AFTER
- initial compressed size:
- total compressed size:
- first playable time:
- draw calls:
- triangles:
- FPS:
- worst frame time:
- JS heap:

BIGGEST WINS
1.
2.
3.
4.
5.

REMAINING BOTTLENECKS
1.
2.
3.

POKI CHECK
- SDK:
- external requests:
- mobile:
- tablet:
- scaling:
- loading:
- inspector warnings:
```

Do not fabricate measurements. If a metric cannot be measured, write `NOT MEASURED`.

---

# 33. Final Definition of Done

Orbpoly is ready for the next Poki testing stage only when:

- The production build loads materially faster than the baseline.
- The critical path does not wait on optional audio or secondary content.
- No arbitrary startup delay remains.
- External non-Poki resources are removed.
- The initial download is aggressively minimized, with **<=5 MB compressed preferred**.
- Total compressed game size is aggressively minimized, with **<=8 MB preferred**.
- The six-character visual composition remains intact.
- The floating island/land design remains intact.
- The 120k grass visual density remains intact unless a later measured decision explicitly proves an equivalent rendering representation.
- The WebGL sky remains intact.
- Day/night transitions remain intact.
- Combat and controls remain intact.
- No new gameplay regressions exist.
- No production debug tooling remains.
- No new console errors exist.
- No duplicate resource downloads exist.
- Low-end/mobile performance is measured rather than assumed.
- Poki Inspector has been run against the actual production build.

**The optimization is complete when the same Orbpoly game reaches the player faster and spends less CPU/GPU/network work to produce the same experience.**

---

## Official references used for this specification

- Poki Requirements: https://developers.poki.com/guide/requirements-quality
- Poki Web Engine / file-size guidance: https://developers.poki.com/guide/web-engine
- Poki Inspector: https://developers.poki.com/guide/inspector
- Poki SDK HTML5: https://developers.poki.com/guide/sdk-html5
- Poki Easy Access & Onboarding: https://developers.poki.com/guide/easy-access
- Three.js InstancedMesh documentation: https://threejs.org/docs/pages/InstancedMesh.html
