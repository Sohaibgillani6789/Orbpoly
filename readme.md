## 1. Fixing the Day/Night Transition Stutter
**The Problem:** Stuttering during environment changes usually occurs because Three.js is recompiling shaders or uploading heavy textures to the GPU mid-gameplay.
**The Rule:** Never add/remove lights or change `visible` states on lights during gameplay if it can be avoided. Do not swap environment maps abruptly without preloading.

### ✅ Best Practice Syntax: Interpolation over Instantiation
Instead of creating a "Night Light" and destroying the "Day Light" (which forces a heavy shader recompile), keep one set of lights and animate their values.

```javascript
// BAD: Triggers shader recompilation (Causes Stutter)
scene.remove(dayLight);
scene.add(nightLight);
material.needsUpdate = true;

// GOOD: Animate existing properties (Smooth)
// Use GSAP, TWEEN.js, or lerp in your render loop to transition colors and intensity
const targetNightColor = new THREE.Color(0x001133); // Your exact night color
const targetNightIntensity = 0.2; // Your exact night intensity

function updateDayNightCycle(delta) {
    // Lerp color and intensity over time smoothly
    sunLight.color.lerp(targetNightColor, delta * speed);
    sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, targetNightIntensity, delta * speed);
    
    // If using an HDRI environment, use a custom shader to blend two preloaded cubemaps 
    // rather than swapping scene.environment abruptly.
}
2. Render Loop Hygiene (Fast Execution)
The Problem: Garbage collection pauses. If you create objects inside your requestAnimationFrame loop, the browser has to constantly clean up memory, causing micro-stutters.
The Rule: Instantiate vectors, quaternions, and eulers outside the loop and reuse them.

✅ Best Practice Syntax: Pre-allocation
JavaScript
// BAD: Allocating memory every frame (Creates garbage collection spikes)
function animate() {
    const direction = new THREE.Vector3(0, 1, 0); 
    character.position.add(direction);
    requestAnimationFrame(animate);
}

// GOOD: Reusing a global/scoped object
const _direction = new THREE.Vector3(0, 1, 0); // Allocate once

function animate() {
    character.position.add(_direction); // Reuse memory
    requestAnimationFrame(animate);
}
3. Proper Memory Handling
The Problem: Three.js does not automatically clear meshes from GPU memory when you remove them from the scene.
The Rule: Always call .dispose() on geometries, materials, and textures when destroying an object (e.g., when an enemy dies or a projectile hits).

✅ Best Practice Syntax: Disposal
JavaScript
function removeGameObject(mesh) {
    scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
        // Handle array of materials or single material
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => mat.dispose());
        } else {
            mesh.material.dispose();
        }
    }
}
4. Draw Call Reduction
The Problem: The CPU gets overwhelmed telling the GPU to draw thousands of individual objects (trees, grass, buildings).
The Rule: If you have multiple objects sharing the same geometry and material, do not use THREE.Mesh for each. Use THREE.InstancedMesh.

Action Item: Audit your scene for static, repeating objects. Convert them to THREE.InstancedMesh. This can drop draw calls from 2,000+ down to 1, maintaining the exact same visual layout.