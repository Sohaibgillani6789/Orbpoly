# Orbpoly Mobile 60 FPS Performance Plan

## Purpose

This document defines the mobile rendering policy and optimization checklist for Orbpoly. The primary target is stable, playable performance on low-end Android phones such as the Infinix Smart 10 while preserving the game's visual identity and gameplay behavior.

The target is **60 FPS during normal gameplay**, which means keeping the frame time at or below:

```text
60 FPS = 16.67 ms per frame
30 FPS = 33.33 ms per frame
```

A stable 55–60 FPS experience is preferable to rapidly switching between 60 FPS and 30 FPS.

## Target device profile

Use the following as the low-end mobile baseline:

- Android browser, primarily Chrome Android.
- 720p-class display.
- Low-end mobile GPU and limited memory bandwidth.
- 60 Hz display target.
- 3–4 GB device RAM variants.
- Landscape gameplay.
- Thermal throttling after several minutes of play must be considered.

The game must not assume that a high device pixel ratio means the device can render at that resolution efficiently.

## Canvas pixel-ratio policy

The renderer must use one centralized effective pixel ratio. Do not let the main renderer, preview renderer, particles, or future post-processing systems independently choose their own pixel ratio.

### Recommended starting values

| Device profile | Effective pixel ratio |
|---|---:|
| Low-end mobile | `1.0` |
| Normal mobile | `1.0–1.25` |
| Tablet / mid-range mobile | `1.25–1.5` |
| Desktop | `1.5–2.0` |

A device pixel ratio of `2` can produce approximately four times the pixel workload of `1`. For the low-end mobile profile, start at `1.0` even when `window.devicePixelRatio` is `2` or higher.

### Centralized render-scale implementation

Use a single policy similar to the following in `src/script.js` and reuse it for every renderer:

```js
const MOBILE_RENDER_SCALE = {
    low: 1.0,
    normal: 1.25,
    high: 1.5,
};

let adaptiveRenderScale = 1.0;

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || ('ontouchstart' in window && window.innerWidth < 1024);
}

function getInitialRenderScale() {
    if (!isMobileDevice()) {
        return Math.min(window.devicePixelRatio || 1, 2.0);
    }

    const dpr = window.devicePixelRatio || 1;
    const memory = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;

    // Conservative default for low-end Android devices.
    if (memory <= 4 || cores <= 4 || dpr >= 2) {
        return MOBILE_RENDER_SCALE.low;
    }

    return MOBILE_RENDER_SCALE.normal;
}

function getEffectivePixelRatio() {
    const maxScale = isMobileDevice() ? 1.25 : 2.0;
    const initialScale = getInitialRenderScale();

    return Math.max(
        0.75,
        Math.min(initialScale * adaptiveRenderScale, maxScale)
    );
}

function applyRendererPixelRatio() {
    const pixelRatio = getEffectivePixelRatio();

    renderer.setPixelRatio(pixelRatio);

    if (previewRenderer) {
        previewRenderer.setPixelRatio(Math.min(pixelRatio, 1.0));
    }

    if (dustMotes?.setPixelRatio) {
        dustMotes.setPixelRatio(pixelRatio);
    }
}
```

The exact integration must use the repository's existing renderer and variable scope. Do not create a second mobile-detection function or separate DPR policy elsewhere.

### Adaptive frame-time governor

A fixed DPR cap is helpful, but real frame-time measurement is more reliable than user-agent detection alone. Add a conservative governor with hysteresis:

```js
const frameTimeSamples = [];
const FRAME_SAMPLE_LIMIT = 120;
let qualityCooldown = 0;

function updateMobilePerformanceGovernor(deltaTime) {
    if (!isMobileDevice()) return;

    const frameMs = deltaTime * 1000;
    frameTimeSamples.push(frameMs);
    if (frameTimeSamples.length > FRAME_SAMPLE_LIMIT) {
        frameTimeSamples.shift();
    }

    qualityCooldown -= deltaTime;
    if (qualityCooldown > 0 || frameTimeSamples.length < 60) return;

    let total = 0;
    for (const sample of frameTimeSamples) total += sample;
    const averageMs = total / frameTimeSamples.length;

    if (averageMs > 22 && adaptiveRenderScale > 0.8) {
        adaptiveRenderScale = Math.max(0.8, adaptiveRenderScale - 0.1);
        applyRendererPixelRatio();
        qualityCooldown = 3.0;
    } else if (averageMs < 14 && adaptiveRenderScale < 1.0) {
        adaptiveRenderScale = Math.min(1.0, adaptiveRenderScale + 0.1);
        applyRendererPixelRatio();
        qualityCooldown = 5.0;
    }
}
```

Rules:

- Do not change quality every frame.
- Keep a 3–5 second cooldown between changes.
- Do not alter physics speed, input sensitivity, combat timing, or network behavior.
- Only lower or restore rendering quality.
- Record every quality change in development builds for testing.

## Renderer configuration

The mobile renderer should avoid expensive multisampling where possible:

```js
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobileDevice(),
    powerPreference: 'high-performance',
});

renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setPixelRatio(getEffectivePixelRatio());
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
```

Do not call `setPixelRatio()` with a separate policy during resize. Always call `applyRendererPixelRatio()` after resizing.

## Immediate high-priority fixes

### 1. Reduce the sky geometry cost

The current sky geometry must be reviewed immediately:

```js
const skyGeometry = new THREE.IcosahedronGeometry(50, 15);
```

Test lower-cost replacements while comparing screenshots and frame time:

```js
const skyGeometry = new THREE.SphereGeometry(50, 32, 16);
```

or:

```js
const skyGeometry = new THREE.IcosahedronGeometry(50, 3);
```

The sky shader already performs most of the visual work. The environment dome should not contain excessive geometry.

### 2. Use one pixel ratio for the preview renderer

The character preview currently has its own renderer. It must not use an unrestricted DPR policy such as:

```js
Math.min(window.devicePixelRatio, 2)
```

Use the centralized policy and cap the preview at `1.0` on mobile.

### 3. Throttle the character preview

While character selection is open:

- Render the preview at 30 FPS instead of 60 FPS.
- Stop rendering when the preview is hidden.
- Stop preview animation when the tab is hidden.
- Dispose the preview renderer and cached preview resources when gameplay begins.

The main game canvas and preview canvas should not both consume a full 60 FPS budget unnecessarily.

## Grass optimization plan

The grass system uses approximately 120,000 blades. Preserve the intended grass appearance first and optimize implementation before reducing density.

### Required checks

- Confirm grass geometry is generated once.
- Keep attributes in typed arrays.
- Keep static attributes at `THREE.StaticDrawUsage`.
- Do not upload unchanged buffers every frame.
- Keep wind animation in the vertex shader.
- Test `THREE.FrontSide` instead of `THREE.DoubleSide` if the visual result remains correct.
- Profile fragment overdraw separately from vertex cost.
- Avoid expensive cloud and lighting calculations for distant grass when the visual difference is negligible.
- Avoid per-frame JavaScript work for individual blades.

### Grass test matrix

Measure each version on the target phone:

1. Current grass shader.
2. Front-facing grass only.
3. Reduced fragment shader math.
4. Reduced distant wind calculation.
5. Reduced texture sampling.
6. Mobile render scale of `1.0`.

Only keep changes that preserve the intended visual result and improve frame time.

## Sky and shader optimization

The sky covers most of the screen, so fragment cost is multiplied by the number of rendered pixels.

Audit `src/shaders/skyFragment.glsl` for:

- Repeated `sin`, `cos`, `pow`, `sqrt`, and `normalize` calls.
- Repeated noise evaluation.
- Values that depend only on global time.
- Duplicate color calculations.
- Unnecessary varyings.
- Precision that can safely use `mediump` on mobile.

Calculate time-only values once per frame in JavaScript and pass them as uniforms when the output remains visually equivalent.

Apply the same approach to:

- `grassVertex.glsl`
- `grassFragment.glsl`
- `rockVertex.glsl`
- `rockFragment.glsl`
- `moonVertex.glsl`
- `moonFragment.glsl`

Do not remove day/night transitions, fog mood, cloud appearance, or lighting behavior without a visual comparison.

## Asset loading and memory plan

The first playable state should not wait for every asset.

### Critical loading path

Load only:

- Core JavaScript.
- Core shaders.
- The first visible scene.
- The selected player character.
- Required gameplay and collision data.
- Essential HUD assets.

### Deferred loading path

Load after the first playable frame:

- Bot character model.
- Optional audio.
- Other character models.
- Preview neighbors.
- Secondary rock assets.
- Non-visible decorative resources.
- Menu-only assets.

Create a shared asset registry so the same model, texture, or audio URL is not requested and decoded multiple times:

```js
const assetPromises = new Map();

function loadOnce(url, loader) {
    if (!assetPromises.has(url)) {
        assetPromises.set(url, new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
        }));
    }

    return assetPromises.get(url);
}
```

Share immutable geometries, materials, and textures where safe. Dispose resources only when they are no longer used by another active object.

## CPU and garbage-collection plan

Audit these hot paths:

- `src/script.js` render loop.
- `src/game/GameManager.js`.
- `src/game/PlayerController.js`.
- `src/game/BotController.js`.
- `src/game/CombatSystem.js`.
- `src/game/AnimationStateMachine.js`.
- `src/game/CollectibleOrb.js`.
- `src/game/PhysicsWorld.js`.
- `src/game/NetworkManager.js`.
- `src/game/HUD.js`.

Avoid inside per-frame or per-entity update methods:

- `new THREE.Vector3()`.
- `new THREE.Quaternion()`.
- `new CANNON.Vec3()`.
- New arrays and objects.
- `.map()`, `.filter()`, `.reduce()`, and `.slice()`.
- DOM queries.
- Repeated string construction.
- Repeated scene traversal.
- Repeated name-based bone or mesh searches.

Use preallocated scratch objects, cached references, and pools for short-lived combat effects and particles.

## Physics and AI plan

The client uses Cannon-es. Verify that:

- `world.step()` runs exactly once per frame.
- Physics is paused while menus, ads, and inactive tabs are displayed.
- Delta time is clamped after tab suspension.
- Inactive bodies do not perform unnecessary work.
- Collision callbacks do not allocate objects every frame.
- Bodies are not repeatedly created and destroyed during ordinary gameplay.

The bot already throttles decision-making to approximately 5 Hz. Preserve that strategy:

- Run decisions at a fixed interval.
- Keep only cheap movement integration per frame.
- Cache player and target references.
- Reuse vectors.
- Reuse distance calculations within the same frame.

## HUD and DOM plan

Cache all HUD elements during initialization. Update each value only when it changes:

- Health text only when health changes.
- Lives only when lives change.
- Color only when the damage range changes.
- Visibility only when visibility changes.
- Screen position only when the projected position changes enough to matter.

Use CSS transforms for moving labels. Do not rebuild HTML strings every frame.

## Particle and transparent-effect plan

Transparent and additive objects can be fill-rate heavy even with a low vertex count.

Profile:

- Dust motes.
- Shield effects.
- Hit effects.
- Vignette effects.
- Any additive combat particles.

Recommended behavior on low-end mobile:

- Keep inactive effects removed or hidden.
- Avoid large transparent quads covering most of the screen.
- Do not update particle buffers when the effect is not visible.
- Use the centralized pixel ratio for particle uniforms.
- Pause all particle updates when the tab is hidden or gameplay is paused.

## Multiplayer performance plan

Multiplayer does not directly determine local WebGL FPS, but it can cause main-thread spikes.

Client:

- Avoid production network logging.
- Reuse interpolation buffers.
- Limit DOM updates for lobby and player lists.
- Clean up Socket.IO listeners when leaving a lobby or match.
- Do not create duplicate heartbeat timers.

Server:

- Keep the authoritative tick loop at its intended fixed rate.
- Replace history-array shifting with a ring buffer if profiling shows pressure.
- Avoid repeated `.find()` calls in hot history lookups.
- Reuse snapshot structures where practical.
- Keep per-room tick time below a few milliseconds.

Do not change authoritative gameplay semantics merely to reduce network traffic.

## Browser lifecycle behavior

Handle these events:

- `visibilitychange`.
- `resize`.
- `orientationchange`.
- Returning from an advertisement.
- WebGL context loss where practical.

When hidden or paused:

- Stop rendering expensive scenes.
- Pause physics and AI.
- Pause audio.
- Reset the clock on resume.
- Prevent a large delta time from causing physics or animation explosions.

## Production build targets

Use the production build for all final measurements:

```bash
npm run build
npm run preview
```

Recommended targets:

| Metric | Target |
|---|---:|
| Initial critical compressed download | Preferably <= 5 MB |
| Total compressed download | Preferably <= 8 MB |
| Source maps shipped | 0 |
| Duplicate asset requests | 0 |
| Production console spam | 0 |
| Main-thread frame budget | <= 16.67 ms |
| Repeated severe frame spikes | 0 during normal gameplay |

Inspect the actual `dist/` directory. Measure raw, gzip, and Brotli sizes, not only source-file sizes.

## Test procedure on low-end Android

Test the deployed production build, not Vite development mode.

1. Open the game in Chrome Android in landscape orientation.
2. Start with the low-end mobile pixel ratio of `1.0`.
3. Record menu frame time for 60 seconds.
4. Start a bot match.
5. Test normal movement, jumping, combat, ring-out, and day/night transition.
6. Test the heaviest combat effects.
7. Continue for at least 15 minutes to detect thermal throttling.
8. Background the browser and return to the game.
9. Rotate the device and return to landscape.
10. Repeat with multiplayer if enabled.

### Acceptance criteria

- Normal gameplay maintains approximately 60 FPS.
- No repeated frame times above 33 ms during ordinary gameplay.
- No visible stutter during day/night transitions.
- No long pause when the bot or audio loads.
- No continuous memory growth across repeated matches.
- Returning from the background does not cause a physics explosion.
- The character preview does not consume a second full-resolution 60 FPS loop.

## Recommended implementation order

1. Replace or reduce `IcosahedronGeometry(50, 15)`.
2. Centralize pixel ratio for the main renderer, preview renderer, and particles.
3. Start low-end mobile at pixel ratio `1.0`.
4. Add frame-time measurement and adaptive render scaling.
5. Throttle and dispose the character preview renderer.
6. Profile grass vertex cost, fragment cost, and overdraw.
7. Optimize sky and grass shader math.
8. Verify Cannon-es runs once per frame and pauses correctly.
9. Add shared model and texture loading caches.
10. Reduce DOM/HUD updates and per-frame allocations.
11. Audit transparent effects and particle overdraw.
12. Measure the production build on the target device for 15 minutes.
13. Re-test after every performance change to prevent visual or gameplay regressions.

## Important constraints

Do not solve performance by silently changing:

- Game rules.
- Combat timing.
- Hitboxes.
- Movement feel.
- Physics semantics.
- Character designs.
- Intended grass density.
- Day/night timing.
- Camera composition.
- Multiplayer authority.

Any quality reduction must be measurable, reversible, documented, and limited to rendering cost.
