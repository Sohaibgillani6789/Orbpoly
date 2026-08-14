# Orbpoly — Pro-Level WebGL Performance Optimization Plan

> **Target:** Make Orbpoly run as smoothly as possible on low-end desktops and mobile-class hardware **without intentionally reducing graphics quality, visual fidelity, animation quality, combat quality, physics behavior, or gameplay features**.
>
> **Coding-agent instruction:** This document is for Claude 4.6 (or another coding agent) working directly in the repository. Treat the existing game as the source of truth. Optimize implementation, scheduling, memory behavior, rendering efficiency, shader execution, loading, networking, and error/syntax quality. Do **not** redesign the game.

---

## 1. Non-Negotiable Rules

These rules have priority over every optimization suggestion below.

### DO NOT change

- Character appearance.
- Character models, animations, rigs, textures, materials, shaders' intended visual output, or art assets.
- Grass density as a visual design decision.
- Lighting mood, fog appearance, sky appearance, moon appearance, shadows, particles, or effects as a quality downgrade.
- Combat timing, hit detection, damage, movement, stamina, cooldowns, attack ranges, AI behavior, physics rules, or game rules.
- Multiplayer behavior, authoritative state, reconciliation semantics, or packet meaning.
- Existing controls or input feel.
- Level layout or gameplay space.
- Game modes, UI features, audio features, or progression.
- Existing visual quality to create a fake "low graphics" mode.

### DO NOT use as the primary solution

- Removing visual effects.
- Reducing texture resolution.
- Replacing models with simpler models.
- Reducing grass from the intended visual density.
- Disabling shadows merely because they are expensive.
- Reducing shader quality merely because the shader is expensive.
- Reducing animation fidelity.
- Reducing physics accuracy in a way that changes gameplay.
- Lowering network simulation quality.

### ALLOWED

The agent **may modify source code** when the modification is strictly an implementation optimization, correctness fix, syntax cleanup, memory-allocation reduction, scheduling improvement, build optimization, GPU/CPU submission optimization, or error handling improvement.

The important constraint is:

> **Change HOW the existing game is implemented, not WHAT the game looks like or HOW it plays.**

If an optimization would visibly alter the game or materially alter gameplay, do not implement it automatically. Document it as a rejected/optional idea instead.

---

## 2. Repository-Specific Starting Point

Repository: `Sohaibgillani6789/Orbpoly`

The project is a Vite-based Three.js/WebGL application. The repository currently includes:

- Three.js `0.158.x`.
- Cannon-es physics.
- Socket.IO client plus MessagePack parser.
- Custom GLSL shaders.
- A large single `src/script.js` entry point (~78 KB in the current repository snapshot).
- Multiple game-system modules under `src/game/`.
- Custom grass, sky, rock, and moon shaders.
- A grass system using approximately **120,000 blades** in the current source.
- Custom shader-based grass/sky/rock rendering.
- `GameManager`, `PlayerController`, `BotController`, `PhysicsWorld`, `CombatSystem`, `NetworkManager`, `AnimationStateMachine`, `DustMotes`, and related systems.
- Vite build tooling and a Vercel deployment configuration.

The current `script.js` already contains some pooling work around grass generation, including reusable `THREE.Vector3` instances. **Do not undo existing pooling. Extend the same philosophy to other hot paths.**

The high-risk performance areas are therefore likely to be:

1. GPU fragment/vertex workload.
2. 120k-blade grass geometry and animation.
3. Per-frame JavaScript allocations.
4. Three.js scene traversal and draw-call count.
5. Physics stepping.
6. Animation updates.
7. Bot/AI update frequency.
8. DOM/HUD work during gameplay.
9. Network serialization and event frequency.
10. Asset loading and memory pressure.
11. Shader compilation/stalls.
12. Garbage collection spikes.
13. Resize/device-pixel-ratio behavior.
14. Unnecessary repeated calculations in the main loop.

---

# 3. Performance Philosophy

Do not guess.

Use a **measure → identify hotspot → make the smallest safe optimization → measure again** workflow.

For every meaningful optimization:

1. Identify the hot path.
2. Establish a baseline.
3. Make one focused change.
4. Verify behavior.
5. Verify visual output.
6. Verify gameplay behavior.
7. Verify memory behavior.
8. Build the production bundle.
9. Compare before/after measurements.

Never stack ten speculative changes together and assume they helped.

---

# 4. Establish a Performance Baseline First

Before changing implementation, collect a baseline on:

## Desktop

- Low-end integrated GPU.
- Mid-range laptop.
- Modern desktop GPU.

## Mobile-class hardware

At minimum test one low-end Android-class device/browser and one mid-range device/browser if available.

Record:

- Average FPS.
- 1% low FPS if tooling allows it.
- Frame time in milliseconds.
- Main-thread CPU time.
- GPU frame time if available.
- JavaScript heap usage.
- Garbage-collection frequency/spikes.
- Draw calls.
- Triangles.
- Geometries.
- Textures.
- Shader/program count.
- Physics step time.
- AI update time.
- Animation update time.
- Network update/serialization time.
- Number of active objects/effects.
- Initial load time.
- Time until first playable frame.

### Important frame-time targets

At 60 FPS:

- Total frame budget ≈ **16.67 ms**.

At 30 FPS:

- Total frame budget ≈ **33.33 ms**.

A low-end device should ideally have enough headroom that ordinary combat spikes do not immediately produce severe frame drops.

Do not optimize only average FPS. **Frame-time spikes are often more damaging to perceived quality than a stable lower frame rate.**

---

# 5. Instrumentation Before Optimization

Add temporary development-only instrumentation where needed, but avoid shipping noisy diagnostics.

Useful measurements:

```js
performance.now()
```

and browser profiling tools:

- Chrome DevTools Performance.
- Chrome DevTools Memory.
- Chrome DevTools Rendering.
- Chrome DevTools Network.
- WebGL Inspector/Spector.js where available.
- Three.js renderer statistics.

Useful Three.js counters include:

```js
renderer.info.render.calls
renderer.info.render.triangles
renderer.info.memory.geometries
renderer.info.memory.textures
```

Do not leave expensive per-frame `console.log()` calls in production.

---

# 6. CRITICAL: JavaScript Main-Thread Optimization

The first goal is to make the CPU frame loop boring.

A fighting game has a naturally spiky workload: attacks, particles, hit reactions, physics collisions, animation transitions, audio, networking, and AI can all fire simultaneously.

Avoid adding avoidable JavaScript work to that spike.

## 6.1 Eliminate allocations inside hot loops

Look for patterns such as:

```js
new THREE.Vector3()
new THREE.Vector2()
new THREE.Quaternion()
new THREE.Euler()
new THREE.Color()
[]
{}
string interpolation
Array.map()
Array.filter()
Array.reduce()
Array.find()
```

inside:

- `animate()`.
- `update()`.
- physics loops.
- AI loops.
- collision loops.
- particle loops.
- animation loops.
- network interpolation.
- render preparation.

Replace with reusable objects, indexed loops, caches, and preallocated arrays where behavior remains identical.

### Especially important

Do not create temporary Three.js math objects repeatedly in a 60 FPS loop.

Prefer module-level or class-level scratch objects when they are not shared across concurrent operations.

For nested/reentrant code, use dedicated scratch objects per system rather than one globally shared scratch object that can create subtle correctness bugs.

---

# 7. Avoid Garbage Collection Spikes

Low-end devices are particularly sensitive to GC pauses.

Audit:

- Temporary arrays.
- Temporary objects.
- Closures created every frame.
- Arrow functions created inside loops.
- Repeated `.map()`, `.filter()`, `.slice()`, `.concat()`.
- String construction every frame.
- Repeated object spreading.
- Repeated destructuring in very hot loops.
- Repeated JSON serialization.
- Temporary vectors/quaternions.
- Temporary physics objects.

Use object pools for genuinely high-churn objects such as:

- Hit effects.
- Dust particles.
- Combat effects.
- Temporary collision results.
- Reusable network state containers.
- Short-lived animation/event objects.

Do not create a pool merely for objects that are created once during initialization.

---

# 8. Three.js Scene Graph Optimization

## 8.1 Reduce unnecessary traversal

Inspect the scene graph for objects that are:

- Updated unnecessarily.
- Traversed every frame despite being static.
- Hidden but still updated by JavaScript.
- Repeatedly reconfigured.

Static objects should remain static from the CPU's perspective wherever possible.

## 8.2 Avoid redundant transform updates

Do not repeatedly set:

```js
position
rotation
quaternion
scale
matrix
matrixWorld
```

if the value did not actually change.

For static objects, consider whether `matrixAutoUpdate` can safely be disabled after transforms are finalized. Only do this when the object truly never changes.

Never disable automatic updates on an object whose transform is expected to change.

## 8.3 Reuse geometry and materials

Never create duplicate geometries/materials for visually identical objects unless required.

Look for repeated:

```js
new THREE.Mesh(...)
new THREE.MeshStandardMaterial(...)
new THREE.MeshBasicMaterial(...)
new THREE.BufferGeometry(...)
```

inside runtime spawn/update paths.

Prefer shared resources where material/geometry semantics are identical.

---

# 9. Draw-Call Optimization Without Visual Downgrade

Draw calls are expensive, especially on mobile GPUs.

Measure first.

Look for:

- Many small meshes.
- Repeated identical materials.
- Repeated decorative objects.
- Particle/effect objects that each create a separate render submission.
- Multiple meshes that can safely share a material/geometry.

Where visually identical objects can be represented through instancing, investigate `THREE.InstancedMesh`.

### Instancing rule

Instancing is acceptable when it preserves:

- exact appearance;
- transform behavior;
- animation behavior;
- interaction behavior;
- collision behavior.

Do not force instancing onto animated characters or gameplay objects if doing so changes their behavior.

---

# 10. Grass System — Highest Priority GPU Area

The current source uses approximately:

```js
const BLADE_COUNT = 120000;
```

This is potentially one of the largest GPU costs in the project.

**Do not reduce the visible grass density as the optimization strategy.**

Instead investigate how to render the same visual result more efficiently.

## 10.1 Geometry generation

The current implementation already pools several `THREE.Vector3` instances in `generateBlade()`.

Continue this pattern.

Audit the entire grass generation path for:

- Temporary vector creation.
- Temporary arrays.
- Repeated trigonometric calculations.
- Repeated random calls.
- Repeated conversions.
- Redundant writes to identical buffer data.

Generate static data once during initialization.

Do not regenerate static grass geometry every frame.

## 10.2 Buffer attributes

Check whether grass data is stored using the minimum attribute set required by the current shader.

Do not remove attributes blindly; inspect shader usage first.

Potential optimization areas:

- Correct typed-array choice.
- Avoid duplicated per-vertex data.
- Pack values where precision permits **without changing visible output**.
- Avoid repeatedly uploading unchanged attributes.
- Use `StaticDrawUsage` for truly static buffers.
- Use `DynamicDrawUsage` only where data genuinely changes.

Do not alter precision if it causes visible artifacts.

## 10.3 Grass animation

The ideal architecture is:

> Static grass geometry + GPU-side animation using uniforms/time rather than CPU rewriting all blades every frame.

The existing shader architecture appears designed around GPU-side animation, so preserve that design.

Avoid CPU-side per-blade position updates.

## 10.4 Shader optimization

Profile grass shaders.

Look for:

- Repeated calculations.
- Expensive operations inside fragment shaders.
- Duplicate calculations per fragment.
- Values that can be computed per vertex instead of per fragment without visible difference.
- Repeated `sin`, `cos`, `pow`, `sqrt`, noise/fBm calculations.
- Branches that can be simplified.
- Repeated normalization.
- Repeated texture sampling.

### Important

Do **not** remove visual shader features merely because they cost GPU time.

Instead seek algebraic simplification, reuse of intermediate values, moving invariant calculations, and compiler-friendly expressions.

---

# 11. Shader-Specific Optimization Strategy

The repository contains custom GLSL for:

- Grass.
- Sky.
- Rocks.
- Moon.

Treat fragment shaders as especially important because fragment cost scales with screen resolution.

## Prioritize

1. Expensive fragment shader operations.
2. Overdraw.
3. Repeated texture sampling.
4. Expensive noise/fBm.
5. Unnecessary dependent calculations.
6. Duplicate lighting math.
7. Work performed for fragments that are discarded/hidden.

## Preserve

- Existing color output.
- Existing fog behavior.
- Existing lighting appearance.
- Existing animation.
- Existing texture appearance.
- Existing transparency/alpha behavior.

If an optimization produces a visible difference in a side-by-side comparison, treat it as unsafe unless the difference is provably numerical noise below perceptual significance.

---

# 12. Shader Compilation and Startup Stalls

Shader compilation can cause startup hitches.

Investigate:

- Program count.
- Material variants.
- Unnecessary shader recompilation.
- Changing material properties that force program variants.
- Creating new materials during gameplay.

Pre-warm important materials/programs where practical without delaying first interaction excessively.

Avoid creating shader materials repeatedly during combat.

---

# 13. Texture and GPU Memory Management

Do not lower texture quality simply to improve performance.

Instead optimize texture handling:

- Avoid loading the same texture more than once.
- Reuse texture instances.
- Dispose unused temporary textures.
- Avoid duplicate materials that reference equivalent textures.
- Ensure texture color spaces are correctly configured.
- Ensure wrapping/filtering is configured once rather than repeatedly.
- Avoid runtime texture manipulation unless necessary.

Audit texture dimensions and GPU memory consumption.

If a texture is intentionally high resolution and contributes to visual quality, leave it alone unless a non-visual memory duplication or upload problem exists.

---

# 14. Asset Loading Optimization

The current project uses `THREE.LoadingManager`, texture loading, GLTF/OBJ loaders, audio loading, and a Promise-based initialization flow.

Improve loading without changing final quality.

## Check for

- Duplicate requests.
- Duplicate asset decoding.
- Assets loaded serially when they can safely load concurrently.
- Unnecessary blocking initialization.
- Assets loaded before they are needed.
- Repeated parsing of identical model data.
- Repeated texture creation.

## Important

Do not delay a gameplay-critical asset until after it is needed.

Use safe parallel loading where dependencies permit.

Keep the loading manager accurate and avoid logging every asset progress event in production.

---

# 15. Main Render Loop Optimization

The render loop should have a predictable structure.

Conceptually:

```text
input
→ simulation
→ physics
→ AI
→ animation
→ network interpolation
→ effects
→ render
```

Do not allow unrelated work to repeatedly execute multiple times per frame.

Audit whether the same calculation is performed by multiple systems.

Cache values that are stable for the duration of a frame.

Example categories:

- Camera position.
- Player position.
- Delta time.
- Time-of-day values.
- Shared lighting vectors.
- Shared target references.
- Common world transforms.

---

# 16. Delta-Time and Timing Correctness

Use one authoritative frame delta where possible.

Avoid repeatedly calling time APIs throughout the frame.

Prefer:

```js
const now = performance.now();
const delta = now - previous;
```

then distribute the result.

Do not create multiple slightly different delta times for systems that should be synchronized.

Clamp pathological frame deltas after tab suspension or mobile browser backgrounding so a huge delay does not cause a simulation explosion.

**Important:** clamping must preserve normal gameplay behavior. It is protection against abnormal browser timing, not a gameplay change.

---

# 17. Physics Optimization — Cannon-es

Physics is another potential CPU hotspot.

Audit `PhysicsWorld.js`, player controllers, combat collision logic, and any code that adds/removes bodies.

## 17.1 Fixed timestep

Prefer a stable fixed-step physics model if the existing gameplay semantics support it.

Do not alter the effective gameplay behavior merely to reduce CPU usage.

## 17.2 Avoid unnecessary physics work

Look for:

- Recreating bodies.
- Recreating shapes.
- Recreating materials/contact materials.
- Repeated body configuration.
- Unnecessary world queries.
- Excessive collision checks.
- Repeated allocation of vectors.

## 17.3 Sleep inactive bodies

Where already compatible with gameplay, allow physically inactive objects to sleep.

Do not force sleeping on combatants or interactive bodies when that changes responsiveness.

## 17.4 Collision filtering

Use collision groups/masks to prevent impossible collision pairs from entering the narrow phase.

This is one of the best CPU optimizations because it removes work before expensive collision processing.

Do not change actual collision semantics.

---

# 18. Combat System Optimization

Combat must remain exactly as responsive and deterministic as before.

Optimize implementation only.

Audit:

- Repeated distance calculations.
- Repeated vector normalization.
- Repeated target searches.
- Repeated collision queries.
- Temporary allocation during attacks.
- Event listener creation.
- Hit-effect creation.
- Repeated lookup of the same attacker/target data.

Use squared distance where mathematically equivalent:

```js
const distanceSquared = dx * dx + dy * dy + dz * dz;
```

instead of:

```js
Math.sqrt(...)
```

when only comparing against a squared threshold.

This must not be used when the actual distance value is required later.

---

# 19. Player and Bot Controllers

The repository contains both player and bot controller logic.

## Player

Keep input latency extremely low.

Avoid:

- DOM queries every frame.
- Repeated event registration.
- Temporary math-object creation.
- Repeated animation-state searches.

## Bots

AI does not necessarily need to perform expensive decision-making every render frame if the existing behavior can remain identical.

Potential approach:

- Separate high-frequency movement/target tracking from lower-frequency decision evaluation.
- Cache stable decisions.
- Avoid recomputing identical target searches.
- Reuse math objects.

**Do not make bots visibly slower, less responsive, or behaviorally different.**

---

# 20. Animation System

Audit `AnimationStateMachine.js` and character animation updates.

Look for:

- Repeated mixer lookups.
- Repeated action creation.
- Repeated clip searches.
- Repeated weight changes.
- Repeated object allocations.
- State transitions that are evaluated unnecessarily every frame.

Cache animation actions by name.

Do not recreate an animation action when an existing action can be reused.

Avoid restarting the same animation unnecessarily.

This can improve both CPU cost and animation stability without changing the animation itself.

---

# 21. Remote Player / Networking Optimization

The project uses Socket.IO and MessagePack.

Do not change network semantics.

Investigate:

- Excessive serialization.
- Excessive deserialization.
- Repeated JSON conversion where MessagePack is already available.
- High-frequency events carrying unchanged state.
- Repeated object allocation on network packets.
- Unbounded event queues.
- Repeated interpolation allocations.

## Safe optimizations

- Reuse buffers/temporary objects where possible.
- Avoid processing redundant state updates.
- Cache unchanged state.
- Avoid duplicate event listeners.
- Batch non-critical bookkeeping where gameplay semantics remain unchanged.

Do not silently reduce authoritative update frequency if it changes multiplayer responsiveness or synchronization.

---

# 22. DOM/HUD Optimization

The HUD can become surprisingly expensive if DOM writes occur every frame.

Audit `HUD.js` and any UI logic.

Avoid:

```js
textContent = ...
innerHTML = ...
style.foo = ...
classList....
```

on every frame unless the value actually changed.

Use dirty-state checks:

```text
new value === previous value → do nothing
new value !== previous value → update DOM
```

Do not rebuild large DOM sections for small changes.

Avoid `innerHTML` for frequent updates where a direct node update is sufficient.

---

# 23. Input Optimization

Audit `InputManager.js`.

Input events should update compact state.

The render/update loop should read state rather than repeatedly querying the DOM.

Avoid allocating objects for every input event.

Avoid repeatedly registering event listeners.

Use passive listeners where appropriate for non-preventDefault touch/scroll behavior, but do not break game controls.

---

# 24. Particle / Dust / Shield Effects

The project contains effect systems such as `DustMotes` and `ShieldEffect`.

These are classic object-pooling candidates.

For high-churn effects:

1. Allocate a bounded pool once.
2. Activate existing objects.
3. Update active objects.
4. Deactivate/recycle them.
5. Avoid repeated geometry/material creation.

Do not make the effects visually smaller, fewer, shorter-lived, or lower quality solely for performance.

Optimize their implementation and lifecycle.

---

# 25. Visibility and Frustum Culling

Use Three.js frustum culling correctly.

Do not disable frustum culling globally.

Check custom geometry bounding spheres/boxes.

Incorrect or missing bounds can cause either:

- unnecessary rendering;
- incorrect disappearance.

For large custom BufferGeometry, ensure bounding volumes are computed correctly when required.

Do not recompute bounds every frame unless geometry actually changes.

---

# 26. Overdraw Optimization

Overdraw is particularly expensive on mobile GPUs.

Audit:

- Transparent materials.
- Large particle systems.
- Grass fragments.
- Cloud layers.
- Effects covering large portions of the screen.
- Multiple overlapping transparent meshes.

Optimize draw ordering, depth behavior, and shader work where possible without changing appearance.

Do not simply remove transparent effects.

---

# 27. Resolution / Device Pixel Ratio

This is a major performance lever, but it is also the most likely to visibly change image quality.

Therefore:

### Default policy

**Do not lower resolution or DPR automatically as the first optimization.**

First optimize:

- CPU.
- draw calls.
- shaders.
- overdraw.
- allocations.
- physics.
- AI.
- animation.
- network processing.

Only if profiling proves GPU fill-rate is the unavoidable bottleneck should an adaptive render-resolution strategy be considered.

If considered, it must be:

- carefully measured;
- gradual;
- reversible;
- free of gameplay impact;
- visually conservative;
- documented as an optional last-resort mechanism.

Do not silently introduce aggressive resolution scaling.

---

# 28. Renderer Configuration Audit

Inspect the renderer initialization for settings that cause unnecessary cost.

Audit:

- antialiasing.
- alpha.
- depth.
- stencil.
- powerPreference.
- tone mapping.
- output color space.
- shadow map settings.
- physically correct lighting.
- logarithmic depth buffer.
- preserveDrawingBuffer.

Do not change a renderer option simply because it is expensive.

First determine whether the setting is visually/gameplay required.

For example, changing antialiasing or shadow behavior may visibly alter quality and therefore violates the primary objective unless explicitly approved.

---

# 29. Resize Handling

Resize events can cause unnecessary work.

Do not rebuild the entire renderer/scene when the window changes size.

Use a single resize handler that updates:

- camera aspect.
- camera projection matrix.
- renderer size.
- relevant resolution-dependent uniforms.

Avoid repeated renderer configuration during continuous resize events.

Where appropriate, throttle resize processing with `requestAnimationFrame` while preserving final dimensions.

---

# 30. Browser Scheduling

Use browser scheduling intelligently.

Gameplay/rendering belongs in the animation frame loop.

Non-critical tasks can be scheduled outside the critical frame when safe.

Potential candidates:

- telemetry.
- debug statistics.
- non-critical cleanup.
- preloading.
- cache preparation.

Do not move gameplay-critical work off the main frame unless correctness is proven.

---

# 31. Avoid Console Spam

The current loading code contains many `console.log()` and `console.error()` calls.

Development logging is useful, but production logging can become expensive and noisy.

Audit logging across the project.

Use a development-only logger or build-time removal where appropriate.

Never remove error reporting that is necessary to diagnose real failures in production.

Do not log per-frame/per-particle/per-blade information.

---

# 32. Error and Syntax Cleanup

The agent is explicitly allowed to fix:

- Syntax errors.
- Runtime errors.
- Invalid API usage.
- Dead imports.
- Duplicate imports.
- Incorrect variable declarations.
- Impossible branches.
- Unsafe null/undefined access.
- Unhandled Promise failures.
- Event listener leaks.
- Resource lifecycle errors.
- Incorrect disposal.
- Obvious logic bugs that are clearly unintended and do not change intended gameplay.

### But be careful

A behavior that looks unusual is not automatically a bug.

If changing it could alter gameplay, visual output, network synchronization, or timing, document it rather than changing it without evidence.

---

# 33. Promise / Async Hygiene

Audit asynchronous loading and initialization.

Look for:

- Promises that can reject without handling.
- Duplicate initialization.
- Race conditions.
- Multiple calls to `initializeScene()`.
- Assets used before loading completes.
- Loading callbacks firing more than once.
- Timers that survive scene transitions.

Avoid unnecessary Promise wrappers.

Do not change loading behavior unless the final game remains functionally identical.

---

# 34. Event Listener Leak Audit

This is critical for long sessions.

Check every:

```js
addEventListener(...)
```

for corresponding lifecycle management where necessary.

Watch for listeners added every time a player, match, round, or scene starts.

A common failure pattern is:

```text
start game → add listeners
restart game → add listeners again
restart again → add listeners again
```

Result: one input triggers multiple handlers and CPU usage grows over time.

Fix this without changing input semantics.

---

# 35. Resource Disposal

Audit lifecycle of:

- `THREE.Geometry` / `BufferGeometry`.
- `THREE.Material`.
- `THREE.Texture`.
- Render targets.
- Audio resources.
- Physics bodies.
- Event listeners.
- Timers.
- Animation mixers/actions.
- Network subscriptions.

Dispose resources only when they are truly no longer needed.

Do not dispose shared resources while another active object still uses them.

---

# 36. Build Optimization — Vite

The project uses Vite.

Inspect production output.

Run:

```bash
npm run build
```

Audit:

- Bundle size.
- Duplicate dependencies.
- Unused imports.
- Large libraries pulled into the main chunk unnecessarily.
- Asset loading behavior.
- Source-map behavior for production.
- Compression at deployment layer.

Do not introduce architectural complexity solely to shave tiny bundle amounts.

Prioritize runtime performance over theoretical bundle micro-optimizations.

---

# 37. Tree-Shaking and Imports

Use direct imports where they improve tree-shaking and do not affect behavior.

Remove genuinely unused imports.

Do not import a large module solely for a function that has a lightweight alternative already available in the dependency.

But do not rewrite stable code into obscure micro-optimized syntax that reduces maintainability.

Readable code is preferred over clever code.

---

# 38. Code Quality Rules for Optimization Changes

The agent must avoid:

- giant clever one-liners;
- premature abstractions;
- hidden mutable global state;
- unnecessary micro-optimizations;
- replacing readable code with unreadable code;
- changing public APIs without need;
- changing semantics just to make a benchmark look better.

Prefer:

- clear caches;
- object pools;
- shared resources;
- stable data structures;
- precomputed constants;
- dirty flags;
- batching;
- fewer allocations;
- fewer draw calls;
- fewer repeated calculations;
- predictable scheduling.

---

# 39. Priority Order

Work in this order.

## P0 — Critical

- Main-loop profiling.
- Per-frame allocations.
- GC spikes.
- Grass rendering/animation path.
- Expensive fragment shaders.
- Draw calls.
- Physics spikes.
- Animation update cost.
- Network processing spikes.

## P1 — High impact

- Effect pooling.
- Bot update optimization.
- DOM/HUD dirty updates.
- Renderer state changes.
- Material/geometry reuse.
- Texture/resource duplication.
- Event listener leaks.
- Shader recompilation.

## P2 — Medium impact

- Build optimization.
- Logging cleanup.
- Async loading improvements.
- Resize scheduling.
- Minor algorithmic improvements.
- Dead code/import cleanup.

## P3 — Low impact

- Cosmetic source cleanup.
- Tiny syntax improvements.
- Micro-optimizations that cannot be measured.

Never spend hours on P3 while a P0 problem remains.

---

# 40. Performance Acceptance Criteria

The optimization is successful only if it satisfies all of these:

### Visual

- Same characters.
- Same environment.
- Same grass appearance.
- Same shaders' intended appearance.
- Same lighting.
- Same particles/effects.
- Same animation quality.
- Same texture quality.
- Same camera behavior.

### Gameplay

- Same controls.
- Same combat timing.
- Same hit detection.
- Same damage.
- Same movement.
- Same physics behavior.
- Same AI behavior.
- Same multiplayer semantics.

### Technical

- Fewer frame-time spikes.
- Lower CPU time in hot paths.
- Lower GPU cost where measurable.
- Fewer allocations.
- Less GC pressure.
- Fewer redundant draw calls/state changes.
- No new console errors.
- No new unhandled Promise rejections.
- Production build succeeds.

---

# 41. Before/After Benchmark Table

The agent should maintain a simple benchmark record similar to:

| Metric | Before | After | Target/Observation |
|---|---:|---:|---|
| Average FPS | TBD | TBD | Higher is better |
| 1% low FPS | TBD | TBD | Higher is better |
| Main-thread frame time | TBD | TBD | Lower is better |
| GPU frame time | TBD | TBD | Lower is better |
| Draw calls | TBD | TBD | Lower where visual output is unchanged |
| Triangles | TBD | TBD | Avoid unnecessary geometry |
| JS heap | TBD | TBD | Lower/stabler is better |
| GC spikes | TBD | TBD | Fewer/shorter is better |
| Physics time | TBD | TBD | Lower is better |
| AI time | TBD | TBD | Lower is better |
| Animation time | TBD | TBD | Lower is better |
| Network processing | TBD | TBD | Lower is better |
| Initial load time | TBD | TBD | Lower is better |
| Production bundle | TBD | TBD | Avoid unnecessary growth |

Do not fabricate benchmark numbers.

---

# 42. Claude 4.6 Agent Operating Procedure

Use the following workflow exactly.

## Phase A — Inspect

1. Read the repository structure.
2. Read `package.json`.
3. Inspect `src/script.js`.
4. Inspect `src/game/` systems.
5. Inspect every custom shader.
6. Identify the render loop.
7. Identify physics stepping.
8. Identify AI update loops.
9. Identify animation update loops.
10. Identify network event loops.
11. Identify effect spawning/destruction.
12. Identify per-frame allocations.
13. Identify current renderer configuration.
14. Identify current grass generation/rendering architecture.

## Phase B — Measure

Create a performance hypothesis for each hotspot.

Do not change code just because something looks complex.

## Phase C — Optimize

Apply the smallest safe optimization.

After every meaningful optimization:

```text
build
→ run
→ test
→ profile
→ compare
```

## Phase D — Validate

Confirm:

- no visual regressions;
- no gameplay regressions;
- no multiplayer regressions;
- no new runtime errors;
- no memory leaks;
- no production build failures.

## Phase E — Report

For each optimization, report:

```text
File:
Hotspot:
Problem:
Optimization:
Why it is safe:
Measured impact:
Visual impact:
Gameplay impact:
Regression checks:
```

---

# 43. Explicit Prohibitions for the Coding Agent

Do **not**:

- rewrite the entire game;
- replace Three.js;
- replace Cannon-es;
- replace Socket.IO;
- rewrite the renderer architecture without evidence;
- redesign shaders for a different look;
- reduce quality settings globally;
- remove effects;
- reduce grass density;
- remove characters;
- remove gameplay systems;
- change combat mechanics;
- change network protocol semantics;
- introduce a low-quality mode as a shortcut;
- lower resolution as the first solution;
- change animation timing to hide CPU cost;
- change physics timestep merely to gain FPS;
- change AI behavior merely to gain FPS;
- remove logging that is needed for critical production errors;
- make broad refactors without profiling evidence.

---

# 44. Last-Resort Optimizations

If, after all CPU/GPU implementation optimizations, the game still cannot maintain acceptable performance on a very low-end device, document the remaining bottleneck.

Only then consider adaptive techniques such as:

- conservative dynamic render resolution;
- carefully bounded effect workload;
- workload scheduling that does not alter visible results;
- device-specific initialization behavior.

These are **last resort** options and should not be silently introduced.

The primary requirement remains:

> **Preserve maximum visual quality and gameplay quality. Optimize the implementation first.**

---

# 45. Definition of Done

The optimization task is complete when:

- [ ] The entire render/update pipeline has been profiled.
- [ ] The largest CPU hotspot has been identified and optimized.
- [ ] The largest GPU hotspot has been identified and optimized.
- [ ] Grass rendering has been profiled without reducing intended density.
- [ ] Custom shaders have been inspected for redundant work.
- [ ] Per-frame allocations have been audited.
- [ ] GC pressure has been reduced where measurable.
- [ ] Physics has been profiled and optimized safely.
- [ ] AI has been profiled and optimized safely.
- [ ] Animation updates have been profiled and optimized safely.
- [ ] Network processing has been profiled and optimized safely.
- [ ] Effects use efficient lifecycle management/pooling where justified.
- [ ] DOM/HUD updates are not unnecessarily performed every frame.
- [ ] Event listener leaks have been audited.
- [ ] GPU resources are reused correctly.
- [ ] Unused resources are disposed safely.
- [ ] Production logging has been audited.
- [ ] Syntax/runtime errors found during the audit have been fixed.
- [ ] `npm run build` succeeds.
- [ ] No visual quality downgrade was intentionally introduced.
- [ ] No gameplay behavior was intentionally changed.
- [ ] No multiplayer semantics were intentionally changed.
- [ ] Before/after measurements are recorded.
- [ ] Every optimization has a clear technical justification.

---

# Final Instruction to Claude 4.6

**Act as a senior WebGL/Three.js performance engineer, not a game designer.**

Your job is to make the existing Orbpoly implementation execute more efficiently on low-end hardware while preserving the exact intended game.

Think in terms of:

- CPU frame budget;
- GPU frame budget;
- draw-call overhead;
- shader ALU cost;
- fragment overdraw;
- buffer bandwidth;
- GPU memory;
- JavaScript allocation rate;
- garbage collection;
- cache locality;
- object pooling;
- scene traversal;
- physics broadphase/narrowphase cost;
- animation mixer overhead;
- network serialization;
- browser scheduling;
- asset decoding;
- resource lifetime.

**Do not optimize by making the game look worse. Do not optimize by making the game play differently. Optimize the engineering.**

When uncertain whether a change affects quality or gameplay, **do not make the change silently**. Explain the risk, measure it, and leave it untouched unless it can be proven safe.
