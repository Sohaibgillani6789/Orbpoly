import * as THREE from 'three';

/**
 * ShieldEffect — Spherical rainbow energy barrier VFX that encloses the player.
 *
 * Renders as a translucent sphere with:
 *   - Rainbow-hued spiral bands wrapping around the sphere
 *   - Fresnel rim glow (edge highlighting)
 *   - Dual-layer spiral flow (counter-rotating helices)
 *   - HSV-based rainbow color mapped to spiral position + time
 *
 * Centered directly on the player — the character appears "trapped" inside.
 * No particles, no sparks — clean energy orb aesthetic.
 *
 * Performance-optimized:
 *   - Zero FBM / noise loops — pure analytical sin/cos math
 *   - Low-poly sphere (32×20 = ~1280 tris outer, 24×16 = ~768 tris inner)
 *   - Single pass per layer, no texture lookups
 */
export class ShieldEffect {
    /**
     * @param {THREE.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.visible = false;

        this._elapsed = 0;
        this._lifeTimer = 0;
        this._lifeDuration = 10;
        this._active = false;

        // --- Shield Sphere Mesh ---
        this._initShieldMesh();

        // --- Inner glow layer ---
        this._initInnerGlow();

        scene.add(this.group);
    }

    /** @private */
    _initShieldMesh() {
        // Larger sphere to fully enclose the character model
        const geometry = new THREE.SphereGeometry(2.0, 32, 20);

        this.shieldMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:      { value: 0.0 },
                uLifeRatio: { value: 0.0 },
            },
            vertexShader: /* glsl */ `
                uniform float uTime;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying vec3 vLocalPos;

                void main() {
                    vLocalPos = position;

                    // Subtle breathing displacement along normals
                    vec3 displaced = position;
                    float breath = sin(uTime * 3.0 + position.y * 4.0) * 0.02;
                    displaced += normal * breath;

                    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    vViewDir = normalize(cameraPosition - worldPos.xyz);

                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uLifeRatio;

                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying vec3 vLocalPos;

                // --- HSV to RGB (standard, branch-free) ---
                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }

                void main() {
                    // === Polar coordinates on sphere ===
                    float theta = atan(vLocalPos.x, vLocalPos.z);   // longitude (-PI..PI)
                    float y     = vLocalPos.y;                       // latitude  (-r..r)

                    // === Spiral bands: helical ribbons wrapping around ===
                    // spiral1: 3 wraps, flows upward
                    float spiral1 = sin(theta * 3.0 + y * 8.0 + uTime * 2.5) * 0.5 + 0.5;
                    // spiral2: 2 wraps counter-rotating, different pitch
                    float spiral2 = sin(theta * 2.0 - y * 6.0 - uTime * 1.8) * 0.5 + 0.5;
                    // spiral3: fine detail accent band
                    float spiral3 = sin(theta * 5.0 + y * 12.0 + uTime * 3.5) * 0.5 + 0.5;

                    // Sharpen into visible bands
                    spiral1 = smoothstep(0.35, 0.7, spiral1);
                    spiral2 = smoothstep(0.4, 0.75, spiral2);
                    spiral3 = smoothstep(0.6, 0.9, spiral3) * 0.35;

                    float pattern = spiral1 * 0.45 + spiral2 * 0.4 + spiral3 * 0.15;

                    // === Rainbow hue: shifts with position + time ===
                    float hue = fract(
                        theta / 6.2832          // base: maps longitude to hue
                        + y * 0.25              // vertical shift
                        + uTime * 0.12          // slow temporal rotation
                        + pattern * 0.15        // slight hue shift on bright bands
                    );
                    float saturation = 0.75 + pattern * 0.2;   // vivid where bands are strong
                    float brightness = 0.8 + pattern * 0.4;    // brighter on bands

                    vec3 col = hsv2rgb(vec3(hue, saturation, brightness));

                    // === Fresnel rim glow ===
                    float fresnel = pow(1.0 - max(dot(vViewDir, vWorldNormal), 0.0), 2.5);
                    // Brighten edges with white-ish tint
                    col = mix(col, vec3(1.0, 0.95, 1.0), fresnel * 0.4);

                    // === Spawn / fade envelope ===
                    float envelope = smoothstep(0.0, 0.05, uLifeRatio)
                                   * smoothstep(1.0, 0.95, uLifeRatio);

                    // === Alpha: transparent base + visible spiral bands + rim ===
                    float alpha = (pattern * 0.35 + fresnel * 0.25) * envelope;

                    // Boost color emission slightly
                    vec3 finalColor = col * (1.1 + fresnel * 1.2 + pattern * 0.5);

                    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.7));
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        this.shieldMesh = new THREE.Mesh(geometry, this.shieldMat);
        this.group.add(this.shieldMesh);
    }

    /** @private — slightly smaller inner sphere for layered depth */
    _initInnerGlow() {
        const geometry = new THREE.SphereGeometry(1.6, 24, 16);

        this.innerMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:      { value: 0.0 },
                uLifeRatio: { value: 0.0 },
            },
            vertexShader: /* glsl */ `
                uniform float uTime;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying vec3 vLocalPos;

                void main() {
                    vLocalPos = position;

                    vec3 displaced = position;
                    float pulse = sin(uTime * 5.0 + position.y * 6.0) * 0.01;
                    displaced += normal * pulse;

                    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    vViewDir = normalize(cameraPosition - worldPos.xyz);

                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uLifeRatio;

                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying vec3 vLocalPos;

                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }

                void main() {
                    // Inner glow: strong Fresnel + subtle rainbow tint
                    float fresnel = pow(1.0 - max(dot(vViewDir, vWorldNormal), 0.0), 3.5);

                    // Slow-moving vertical color bands
                    float theta = atan(vLocalPos.x, vLocalPos.z);
                    float hue = fract(theta / 6.2832 + vLocalPos.y * 0.2 - uTime * 0.08);
                    vec3 col = hsv2rgb(vec3(hue, 0.5, 0.9));

                    float envelope = smoothstep(0.0, 0.05, uLifeRatio)
                                   * smoothstep(1.0, 0.95, uLifeRatio);

                    float alpha = fresnel * 0.25 * envelope;

                    gl_FragColor = vec4(col * (1.0 + fresnel), clamp(alpha, 0.0, 0.35));
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.FrontSide,
            blending: THREE.AdditiveBlending,
        });

        this.innerMesh = new THREE.Mesh(geometry, this.innerMat);
        this.group.add(this.innerMesh);
    }

    /**
     * Activates the shield effect.
     * @param {THREE.Vector3} position - Player world position
     * @param {number} facingAngle - Character model Y rotation (radians)
     * @param {number} [duration=10] - Duration in seconds
     */
    activate(position, facingAngle, duration = 10) {
        this._active = true;
        this._lifeTimer = duration;
        this._lifeDuration = duration;
        this._elapsed = 0;

        // Center directly on the player — no offset
        this.group.position.set(
            position.x,
            position.y + 1.0,   // raise to chest-height center
            position.z
        );

        this.shieldMat.uniforms.uTime.value = 0;
        this.shieldMat.uniforms.uLifeRatio.value = 0;
        this.innerMat.uniforms.uTime.value = 0;
        this.innerMat.uniforms.uLifeRatio.value = 0;

        this.group.visible = true;
    }

    /** Deactivates shield immediately. */
    deactivate() {
        this._active = false;
        this._lifeTimer = 0;
        this.group.visible = false;
    }

    /** @returns {boolean} */
    get isActive() {
        return this._active;
    }

    /**
     * Per-frame update. Call from GameManager.update().
     * @param {number} dt - Delta time in seconds
     * @param {THREE.Vector3} playerPos - Current player world position
     * @param {number} facingAngle - Current model Y rotation
     */
    update(dt, playerPos, _facingAngle) {
        if (!this._active) return;

        this._elapsed += dt;
        this._lifeTimer -= dt;

        if (this._lifeTimer <= 0) {
            this.deactivate();
            return;
        }

        // Follow the player — centered, no directional offset
        this.group.position.set(
            playerPos.x,
            playerPos.y + 1.0,
            playerPos.z
        );

        // Slow rotation for visual dynamism
        this.group.rotation.y += dt * 0.4;

        const lifeRatio = 1.0 - (this._lifeTimer / this._lifeDuration);

        // Update outer shield
        this.shieldMat.uniforms.uTime.value = this._elapsed;
        this.shieldMat.uniforms.uLifeRatio.value = lifeRatio;

        // Update inner glow
        this.innerMat.uniforms.uTime.value = this._elapsed;
        this.innerMat.uniforms.uLifeRatio.value = lifeRatio;
    }

    dispose() {
        this.shieldMesh.geometry.dispose();
        this.shieldMat.dispose();
        this.innerMesh.geometry.dispose();
        this.innerMat.dispose();
        this.scene.remove(this.group);
    }
}
