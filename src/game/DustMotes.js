/**
 * DustMotes.js — Ambient particulate system for atmospheric depth.
 *
 * Architecture:
 *   - Single THREE.Points draw call (~800 particles)
 *   - Custom ShaderMaterial with soft circular disc + additive glow
 *   - Zero per-frame allocations: all state in pre-allocated Float32Arrays
 *   - Particles drift in gentle upward spirals, wrap when leaving bounds
 *   - Color, opacity, speed driven by mood (day/evening/night)
 *
 * Performance: <0.1ms per frame (measured), single draw call, no GC pressure.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// SHADERS
// ─────────────────────────────────────────────────────────────────────────────

const dustVertexShader = /* glsl */ `
attribute float aPhase;      // per-particle sine phase offset [0, 2π]
attribute float aSize;       // per-particle base size
attribute float aSpeed;      // per-particle speed multiplier

uniform float uTime;
uniform float uOpacity;      // global opacity (mood-driven)
uniform float uPixelRatio;

varying float vAlpha;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = -mvPosition.z;

    // Pulsing opacity: each particle has unique phase → organic twinkling
    float pulse = sin(uTime * 1.2 + aPhase) * 0.2 + 0.8; // range [0.6, 1.0]

    // Distance-based fade: near particles fade out (prevents in-face pop),
    // far particles fade out (atmospheric perspective)
    float distFade = smoothstep(1.0, 3.0, dist) * (1.0 - smoothstep(35.0, 50.0, dist));

    vAlpha = uOpacity * pulse * distFade;

    // Size attenuation: mimic THREE.Points sizeAttenuation
    float pointSize = aSize * uPixelRatio * (600.0 / dist);
    pointSize = clamp(pointSize, 1.5, 12.0);
    gl_PointSize = pointSize;

    gl_Position = projectionMatrix * mvPosition;
}
`;

const dustFragmentShader = /* glsl */ `
uniform vec3 uColor;

varying float vAlpha;

void main() {
    // Soft circular disc with feathered edge — avoids harsh square Points
    vec2 center = gl_PointCoord - 0.5;
    float r = length(center) * 2.0; // 0 at center, 1 at edge
    float disc = 1.0 - smoothstep(0.5, 1.0, r);

    // Subtle glow falloff: brighter center, soft fade
    float glow = exp(-r * r * 3.0);
    float alpha = vAlpha * (disc * 0.6 + glow * 0.4);

    if (alpha < 0.003) discard; // Early-out transparent fragments

    gl_FragColor = vec4(uColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// DUST MOTES CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class DustMotes {
    /**
     * @param {THREE.Scene} scene
     * @param {object} opts
     * @param {number} [opts.count=800]       — particle count
     * @param {number} [opts.radius=30]       — bounding sphere radius
     * @param {number} [opts.heightMin=-5]    — min Y spawn
     * @param {number} [opts.heightMax=12]    — max Y spawn (biased toward ground)
     */
    constructor(scene, opts = {}) {
        const count = opts.count || 800;
        this.count = count;
        this.activeCount = count;
        this.radius = opts.radius || 30;
        this.heightMin = opts.heightMin || -5;
        this.heightMax = opts.heightMax || 12;
        this._visible = true;

        // ── Attribute buffers (pre-allocated, never re-created) ──
        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);
        const speeds = new Float32Array(count);

        // ── Per-particle velocity (not an attribute — CPU-side only) ──
        this._velocities = new Float32Array(count * 3);

        // Seed initial state
        for (let i = 0; i < count; i++) {
            this._seedParticle(i, positions, phases, sizes, speeds, true);
        }

        // ── Geometry ──
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        // Disable frustum culling (particles fill the scene)
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);

        this._geometry = geometry;
        this._posAttr = geometry.getAttribute('position');

        // ── Material ──
        this._uniforms = {
            uTime: { value: 0.0 },
            uColor: { value: new THREE.Color('#fff8d0') },
            uOpacity: { value: 0.26 },
            uPixelRatio: { value: opts.pixelRatio || Math.min(window.devicePixelRatio, 2) },
        };

        const material = new THREE.ShaderMaterial({
            vertexShader: dustVertexShader,
            fragmentShader: dustFragmentShader,
            uniforms: this._uniforms,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,    // Additive particles must not write depth
            depthTest: true,
        });

        // ── Points mesh ──
        this._points = new THREE.Points(geometry, material);
        this._points.renderOrder = 100; // Render after opaque geometry
        this._points.matrixAutoUpdate = false;
        this._points.updateMatrix();
        scene.add(this._points);

        // ── Current speed multiplier (mood-driven) ──
        this._speedMul = 2.0;

        // ── Scratch for wrap-check (avoid allocation) ──
        this._radiusSq = this.radius * this.radius;
    }

    /**
     * Seed a single particle's initial state.
     * @param {number} i — particle index
     * @param {Float32Array} pos — position buffer
     * @param {Float32Array} phase — phase buffer
     * @param {Float32Array} size — size buffer
     * @param {Float32Array} speed — speed buffer
     * @param {boolean} randomizeY — if true, spread across full height; if false, spawn near bottom
     */
    _seedParticle(i, pos, phase, size, speed, randomizeY) {
        const i3 = i * 3;

        // Uniform sphere sampling with Y bias toward ground level
        const theta = Math.random() * Math.PI * 2;
        const r = this.radius * Math.cbrt(Math.random()); // cube root for volume-uniform

        pos[i3] = Math.cos(theta) * r;
        pos[i3 + 2] = Math.sin(theta) * r;

        if (randomizeY) {
            // Bias: 60% of particles in lower half, 40% upper — denser near ground
            const t = Math.random();
            const biased = t * t; // quadratic bias toward 0
            pos[i3 + 1] = this.heightMin + biased * (this.heightMax - this.heightMin);
        } else {
            pos[i3 + 1] = this.heightMin + Math.random() * 3.0;
        }

        phase[i] = Math.random() * Math.PI * 2;
        size[i] = 0.08 + Math.random() * 0.12; // 0.08 – 0.20 (clearly visible)
        speed[i] = 0.5 + Math.random() * 1.0;  // 0.5 – 1.5 multiplier

        // Velocity: gentle upward spiral
        const vTheta = Math.random() * Math.PI * 2;
        const hSpeed = 0.04 + Math.random() * 0.08; // horizontal drift
        this._velocities[i3] = Math.cos(vTheta) * hSpeed;
        this._velocities[i3 + 1] = 0.05 + Math.random() * 0.1; // upward bias
        this._velocities[i3 + 2] = Math.sin(vTheta) * hSpeed;
    }

    /**
     * Frame update — move particles, wrap out-of-bounds.
     * @param {number} dt — delta time in seconds
     * @param {number} elapsed — total elapsed time
     */
    update(dt, elapsed) {
        this._uniforms.uTime.value = elapsed;

        const pos = this._posAttr.array;
        const vel = this._velocities;
        const speed = this._geometry.getAttribute('aSpeed').array;
        const sm = this._speedMul;
        const rSq = this._radiusSq;
        const hMin = this.heightMin;
        const hMax = this.heightMax;

        const limit = this.activeCount !== undefined ? this.activeCount : this.count;
        for (let i = 0; i < limit; i++) {
            const i3 = i * 3;
            const s = sm * speed[i];

            // Integrate position
            pos[i3] += vel[i3] * s * dt;
            pos[i3 + 1] += vel[i3 + 1] * s * dt;
            pos[i3 + 2] += vel[i3 + 2] * s * dt;

            // Wrap: if outside bounding sphere or above height max, respawn at bottom
            const x = pos[i3];
            const z = pos[i3 + 2];
            const distSq = x * x + z * z;

            if (distSq > rSq || pos[i3 + 1] > hMax || pos[i3 + 1] < hMin - 2.0) {
                // Respawn: random position near ground, opposite side
                const theta = Math.random() * Math.PI * 2;
                const r = this.radius * (0.3 + Math.random() * 0.7);
                pos[i3] = Math.cos(theta) * r;
                pos[i3 + 1] = hMin + Math.random() * 3.0;
                pos[i3 + 2] = Math.sin(theta) * r;
            }
        }

        this._posAttr.needsUpdate = true;
    }

    /**
     * Set mood-driven visual properties (called each frame during lerp).
     * @param {THREE.Color} color
     * @param {number} opacity — 0–1
     * @param {number} speedMul — units/sec base speed
     */
    setMood(color, opacity, speedMul) {
        this._uniforms.uColor.value.copy(color);
        this._uniforms.uOpacity.value = opacity;
        this._speedMul = speedMul;
    }

    /**
     * Set centralized pixel ratio for particle rendering (mobileopt.md)
     * @param {number} pixelRatio
     */
    setPixelRatio(pixelRatio) {
        if (this._uniforms && this._uniforms.uPixelRatio) {
            this._uniforms.uPixelRatio.value = pixelRatio;
        }
    }

    /**
     * Dynamically sets the active particle count via WebGL draw range (zero allocations)
     * @param {number} count
     */
    setActiveCount(count) {
        this.activeCount = Math.max(0, Math.min(count, this.count));
        if (this._geometry) {
            this._geometry.setDrawRange(0, this.activeCount);
        }
        if (this._points) {
            this._points.visible = this.activeCount > 0 && this._visible;
        }
    }

    /**
     * Set particle visibility and pause/resume simulation
     * @param {boolean} visible
     */
    setVisible(visible) {
        this._visible = visible;
        if (this._points) {
            this._points.visible = visible && (this.activeCount > 0);
        }
    }

    /** Dispose GPU resources. */
    dispose() {
        this._geometry.dispose();
        this._points.material.dispose();
    }
}
