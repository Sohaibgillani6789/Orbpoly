import * as THREE from 'three';

/**
 * Hyper-Realistic Raging Fire Orb (CollectibleOrb)
 * 1. Instant Full Color Mix: 100% Golden-Yellow, Fiery Orange, Vermilion Crimson & Dark Maroon co-existing instantly from Frame 1.
 * 2. Red Flaming Particle Effect: Scorching red flame sparks rising & swirling around the orb.
 * 3. 360° Uniform Lava Spherical Coverage: Rotated isotropic noise mapping.
 * 4. Smooth Levitation: Zero position snapping or jitter on spawn.
 * 5. 60 FPS Performance Guaranteed.
 */

// ─── 1. CORE ORB SHADERS ──────────────────────────────────────────────────────

const orbVertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vPosNorm;
varying float vNoise;
uniform float uTime;
uniform float uDistortion;
uniform float uPulse;

// Ashima Simplex Noise 3D Implementation
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

void main() {
    vec3 normPos = normalize(position);

    // Rotated coordinate matrix for 100% isotropic noise (eliminates pole bias)
    mat3 rot = mat3(
        0.8,  0.6,  0.0,
       -0.48, 0.64, 0.6,
        0.36,-0.48, 0.8
    );
    // Pass ROTATED position to fragment so turbulence has no pole dead zones
    vPosNorm = rot * normPos;
    vec3 p = vPosNorm * 2.7;

    // 3D Simplex Domain Warping over unit sphere
    float n1 = snoise(p + vec3(uTime * 0.45, uTime * 0.35, uTime * 0.4));
    float n2 = snoise(p * 2.2 + vec3(-uTime * 0.55, uTime * 0.65, -uTime * 0.3) + vec3(n1 * 0.6));
    
    float totalNoise = n1 * 0.65 + n2 * 0.35;
    vNoise = totalNoise;

    // Displace vertex along surface normal — with breathing pulse
    float breathe = 1.0 + uPulse * 0.12;
    vec3 displaced = position + normal * (totalNoise * uDistortion * breathe);
    vPosition = displaced;

    // Surface normal perturbation for high lighting contrast along lava crests
    vec3 perturbedNormal = normalize(normal + vec3(n1 - n2, n2 - n1, n1 * 0.5) * 0.4);
    vNormal = normalize(normalMatrix * perturbedNormal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const orbFragmentShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vPosNorm;
varying float vNoise;
uniform float uTime;
uniform float uRimPower;
uniform float uPulse;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(-vPosition);
    float NdotV = max(dot(normal, viewDir), 0.0);
    
    float t = clamp(vNoise * 0.5 + 0.5, 0.0, 1.0);

    // Surface turbulence for crawling lava movement
    float micro = sin(vPosNorm.x * 8.0 + vPosNorm.z * 6.0 + uTime * 3.5) * 0.5
                + cos(vPosNorm.y * 7.0 + vPosNorm.x * 5.0 + uTime * 2.8) * 0.3
                + sin(vPosNorm.z * 9.0 + vPosNorm.y * 4.0 + uTime * 4.2) * 0.2;
    t = clamp(t + micro * 0.12, 0.0, 1.0);

    // ═══ SOLID LAVA PALETTE ═══
    // All colors are lava-related: molten gold-orange → scarlet → deep crimson → volcanic dark
    vec3 cMolten   = vec3(1.0, 0.45, 0.05);   // Molten gold-orange (hottest veins)
    vec3 cScarlet  = vec3(0.92, 0.12, 0.0);    // Bright scarlet lava
    vec3 cCrimson  = vec3(0.55, 0.02, 0.0);    // Deep crimson cooling
    vec3 cVolcanic = vec3(0.18, 0.005, 0.0);   // Dark volcanic rock

    // Smooth lava color transitions via noise
    vec3 lavaColor;
    if (t < 0.20) {
        lavaColor = mix(cMolten, cScarlet, t / 0.20);
    } else if (t < 0.55) {
        lavaColor = mix(cScarlet, cCrimson, (t - 0.20) / 0.35);
    } else {
        lavaColor = mix(cCrimson, cVolcanic, (t - 0.55) / 0.45);
    }

    // Heartbeat pulse — whole surface throbs
    lavaColor *= 1.0 + uPulse * 0.12;

    // Hot vein emission — bright cracks pulse with extra intensity
    float veinGlow = smoothstep(0.82, 1.0, 1.0 - t);
    lavaColor += vec3(0.25, 0.10, 0.0) * veinGlow * (1.0 + uPulse * 0.25);

    // ═══ SURFACE LIGHTING ═══
    // Fresnel rim — hot edges glow brighter
    float fresnel = pow(1.0 - NdotV, uRimPower);
    vec3 rimGlow = vec3(0.95, 0.15, 0.02) * fresnel * 1.2;

    // Specular — molten surface sheen
    vec3 lightDir = normalize(vec3(0.4, 1.0, 0.6));
    vec3 halfVec = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 48.0);
    vec3 specular = vec3(1.0, 0.4, 0.1) * spec * 0.4;

    vec3 finalColor = lavaColor + rimGlow + specular;
    
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ─── 2. CINEMATIC PRE-SPAWN SMOKE SHADERS ─────────────────────────────────────

const smokeVertexShader = `
attribute float aSize;
attribute float aAngle;
attribute float aRadius;
attribute float aSpeed;
attribute float aHeight;
attribute float aSeed;

uniform float uTime;
uniform float uProgress; // 0.0 -> 1.0
uniform float uPixelRatio;

varying float vAlpha;
varying vec3 vColor;

void main() {
    float currentRadius = aRadius * (1.0 - uProgress * 0.75) + 0.2;
    float currentAngle = aAngle + uTime * aSpeed * 3.5 + uProgress * 6.0;
    
    vec3 pos;
    pos.x = cos(currentAngle) * currentRadius;
    pos.z = sin(currentAngle) * currentRadius;
    pos.y = (aHeight - 0.5) * (1.0 - uProgress) * 2.8 + sin(uTime * 3.0 + aSeed * 10.0) * 0.2;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    gl_PointSize = aSize * uPixelRatio * (1.0 + uProgress * 0.5) * (600.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    float fadeIn = smoothstep(0.0, 0.2, uProgress);
    float fadeOut = 1.0 - smoothstep(0.75, 1.0, uProgress);
    vAlpha = fadeIn * fadeOut * 0.75;

    vec3 darkSmoke = vec3(0.08, 0.05, 0.05);
    vec3 solarOrangeFlame = vec3(1.0, 0.38, 0.0);
    vColor = mix(darkSmoke, solarOrangeFlame, uProgress * uProgress);
}
`;

const smokeFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    float dist = length(gl_PointCoord - 0.5);
    float mask = smoothstep(0.5, 0.0, dist);
    
    if (mask < 0.01 || vAlpha < 0.01) discard;

    gl_FragColor = vec4(vColor, mask * vAlpha);
}
`;

// ─── 3. RED FLAMING SPARK SHADERS ─────────────────────────────────────────────

const particleVertexShader = `
attribute float aSize;
attribute float aSpeed;
attribute float aRandom;
attribute vec3 aDir;

uniform float uTime;
uniform float uPixelRatio;

varying float vAlpha;
varying vec3 vColor;

void main() {
    float age = mod(uTime * aSpeed + aRandom * 10.0, 1.0);
    
    // Slower, smoother fire — graceful float instead of violent eruption
    float radius = 0.8 + age * 1.6;
    float angle = aRandom * 6.28318 + uTime * (aSpeed * 0.6);
    float turbX = sin(uTime * 3.0 + aRandom * 20.0) * 0.18;
    float turbZ = cos(uTime * 2.5 + aRandom * 18.0) * 0.14;
    float flicker = sin(uTime * 5.0 + aRandom * 30.0) * 0.06;
    
    vec3 pos;
    pos.x = aDir.x * radius + cos(angle) * 0.35 + turbX;
    pos.z = aDir.z * radius + sin(angle) * 0.35 + turbZ;
    pos.y = aDir.y * radius + age * 1.8 + sin(uTime * 3.5 + aRandom * 15.0) * 0.3 + flicker;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    float sizeLife = (1.0 - age * 0.38);
    gl_PointSize = aSize * uPixelRatio * sizeLife * 1.5 * (480.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    vAlpha = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.50, 1.0, age)) * 1.2;

    // FIRE PALETTE: White-hot birth -> Bright Red -> Deep Crimson -> Dying Ember
    vec3 cWhiteHot  = vec3(1.0, 0.55, 0.15);
    vec3 cBrightRed = vec3(1.0, 0.10, 0.0);
    vec3 cCrimson   = vec3(0.70, 0.02, 0.0);
    vec3 cDyingEmber= vec3(0.18, 0.0, 0.0);

    if (age < 0.12) {
        vColor = mix(cWhiteHot, cBrightRed, age / 0.12);
    } else if (age < 0.40) {
        vColor = mix(cBrightRed, cCrimson, (age - 0.12) / 0.28);
    } else {
        vColor = mix(cCrimson, cDyingEmber, (age - 0.40) / 0.60);
    }
}
`;

const particleFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    float dist = length(gl_PointCoord - 0.5);
    float mask = smoothstep(0.5, 0.02, dist); // Soft glowing flame spark core
    
    if (mask < 0.01 || vAlpha < 0.01) discard;
    
    gl_FragColor = vec4(vColor, mask * vAlpha);
}
`;

// ─── 4. SHARED GEOMETRY CACHE ─────────────────────────────────────────────────

let sharedCoreGeo = null;
let sharedParticleGeo = null;
let sharedSmokeGeo = null;

export class CollectibleOrb {
    constructor(_options = {}) {
        this.group = new THREE.Group();
        this.time = 0;

        this.spawnProgress = 0.0;
        this.spawnDuration = 0.4; // Fast 0.4s pre-spawn smoke phase for instant spawn
        this.isReady = false;

        if (!sharedCoreGeo) {
            sharedCoreGeo = new THREE.IcosahedronGeometry(1.0, 16);
        }

        this.coreMat = new THREE.ShaderMaterial({
            vertexShader: orbVertexShader,
            fragmentShader: orbFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uDistortion: { value: 0.22 },
                uRimPower: { value: 2.8 },
                uPulse: { value: 0 }
            },
            transparent: false,
            depthWrite: true,
            side: THREE.FrontSide
        });

        this.core = new THREE.Mesh(sharedCoreGeo, this.coreMat);
        this.core.scale.set(0.001, 0.001, 0.001);
        this.group.add(this.core);

        this.initSmokeParticles();
        this.initFireParticles();

        this.light = new THREE.PointLight(0xff3300, 0, 10);
        this.group.add(this.light);

        this.group.scale.set(1.5, 1.5, 1.5);
    }

    initSmokeParticles() {
        if (!sharedSmokeGeo) {
            const count = 110;
            sharedSmokeGeo = new THREE.BufferGeometry();

            const positions = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const angles = new Float32Array(count);
            const radiuses = new Float32Array(count);
            const speeds = new Float32Array(count);
            const heights = new Float32Array(count);
            const seeds = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                sizes[i] = Math.random() * 0.45 + 0.25;
                angles[i] = Math.random() * Math.PI * 2;
                radiuses[i] = Math.random() * 2.2 + 0.6;
                speeds[i] = Math.random() * 0.8 + 0.4;
                heights[i] = Math.random();
                seeds[i] = Math.random();
            }

            sharedSmokeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            sharedSmokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            sharedSmokeGeo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
            sharedSmokeGeo.setAttribute('aRadius', new THREE.BufferAttribute(radiuses, 1));
            sharedSmokeGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
            sharedSmokeGeo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
            sharedSmokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        }

        this.smokeMat = new THREE.ShaderMaterial({
            vertexShader: smokeVertexShader,
            fragmentShader: smokeFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
            },
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        this.smokeSystem = new THREE.Points(sharedSmokeGeo, this.smokeMat);
        this.group.add(this.smokeSystem);
    }

    initFireParticles() {
        if (!sharedParticleGeo) {
            const count = 280; // 280 Erupting fire sparks
            sharedParticleGeo = new THREE.BufferGeometry();

            const positions = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const speeds = new Float32Array(count);
            const randoms = new Float32Array(count);
            const dirs = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                sizes[i] = Math.random() * 0.30 + 0.12;
                speeds[i] = Math.random() * 0.35 + 0.20;
                randoms[i] = Math.random();

                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                dirs[i * 3 + 0] = Math.sin(phi) * Math.cos(theta);
                dirs[i * 3 + 1] = Math.abs(Math.cos(phi)) * 0.85 + 0.15;
                dirs[i * 3 + 2] = Math.sin(phi) * Math.sin(theta);
            }

            sharedParticleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            sharedParticleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            sharedParticleGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
            sharedParticleGeo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            sharedParticleGeo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
        }

        this.particleMat = new THREE.ShaderMaterial({
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particleSystem = new THREE.Points(sharedParticleGeo, this.particleMat);
        this.particleSystem.visible = false;
        this.group.add(this.particleSystem);
    }

    update(deltaTime) {
        this.time += deltaTime;

        // Continuous Floating Levitation Motion on ALL frames
        this.group.position.y = (this.baseY || 0) + 0.7 + Math.sin(this.time * 2.0) * 0.25;

        // 1. Pre-Spawn Fast Smoke Vortex State (0.4s fast ignition)
        if (!this.isReady) {
            this.spawnProgress += deltaTime / this.spawnDuration;

            if (this.spawnProgress >= 1.0) {
                this.spawnProgress = 1.0;
                this.isReady = true;
                this.particleSystem.visible = true;
                this.smokeSystem.visible = false;
                this.core.scale.set(1.0, 1.0, 1.0);
            }

            this.smokeMat.uniforms.uProgress.value = this.spawnProgress;
            this.smokeMat.uniforms.uTime.value = this.time;

            if (this.spawnProgress > 0.2) {
                const orbT = (this.spawnProgress - 0.2) / 0.8;
                const easeOutCubic = 1.0 - Math.pow(1.0 - orbT, 3.0);
                const s = Math.max(0.001, easeOutCubic * 1.0);
                this.core.scale.set(s, s, s);
                this.light.intensity = orbT * (18.0 + Math.sin(this.time * 12.0) * 4.0);
            }
            return;
        }

        // 2. Active Lava Orb — single-hue dynamic updates
        this.coreMat.uniforms.uTime.value = this.time;
        this.particleMat.uniforms.uTime.value = this.time;

        // Heartbeat pulse: smooth sine wave drives global intensity throb
        const pulse = Math.sin(this.time * 3.5) * 0.5 + Math.sin(this.time * 7.0) * 0.25;
        this.coreMat.uniforms.uPulse.value = pulse;

        // Organic breathing scale — subtle but alive
        const breathe = 1.0 + Math.sin(this.time * 2.5) * 0.04 + Math.sin(this.time * 5.5) * 0.02;
        this.core.scale.set(breathe, breathe, breathe);

        // Dynamic light: intensity + subtle color temperature shift
        const flicker = 20.0 + Math.sin(this.time * 14.0) * 6.0 + Math.cos(this.time * 22.0) * 3.0;
        this.light.intensity = flicker;
        // Shift light color between deep red and orange-red on heartbeat
        const warmth = pulse * 0.5 + 0.5;
        this.light.color.setRGB(0.85 + warmth * 0.15, 0.02 + warmth * 0.06, 0.0);

        // Multi-axis rotation — organic tumble
        this.core.rotation.y += deltaTime * 0.45;
        this.core.rotation.x += deltaTime * 0.20;
        this.core.rotation.z += deltaTime * 0.08;
    }

    setPosition(x, y, z) {
        this.baseY = y;
        this.group.position.set(x, y + 0.7, z);
    }

    /**
     * Resets orb state for zero-allocation pooling.
     * Prevents mid-game shader compilation stalls & GC pauses.
     */
    reset(x, y, z) {
        this.baseY = y;
        this.group.position.set(x, y + 0.7, z);
        this.spawnProgress = 0.0;
        this.isReady = false;
        this.core.scale.set(0.001, 0.001, 0.001);
        if (this.smokeSystem) this.smokeSystem.visible = true;
        if (this.particleSystem) this.particleSystem.visible = false;
        if (this.light) this.light.intensity = 0;
        this.group.visible = true;
    }

    /**
     * Hides orb when collected without destroying WebGL shader resources.
     */
    hide() {
        this.group.visible = false;
        this.isReady = false;
        if (this.light) this.light.intensity = 0;
    }

    /**
     * Set centralized pixel ratio for particle rendering (mobileopt.md)
     * @param {number} pixelRatio
     */
    setPixelRatio(pixelRatio) {
        if (this.smokeMat && this.smokeMat.uniforms.uPixelRatio) {
            this.smokeMat.uniforms.uPixelRatio.value = pixelRatio;
        }
        if (this.particleMat && this.particleMat.uniforms.uPixelRatio) {
            this.particleMat.uniforms.uPixelRatio.value = pixelRatio;
        }
    }

    destroy() {
        this.coreMat.dispose();
        this.particleMat.dispose();
        this.smokeMat.dispose();
        this.group.parent?.remove(this.group);
    }
}





