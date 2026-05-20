import * as THREE from 'three';

/**
 * Redesigned CollectibleOrb
 * Implementation Focus: Immersive Visuals & High Performance
 * Techniques: Simplex Noise Displacement, fBM Plasma, Circular Shaders
 */

const orbVertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying float vNoise;
uniform float uTime;
uniform float uDistortion;

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
    vNormal = normalize(normalMatrix * normal);
    float noise = snoise(vec3(position * 2.0 + uTime * 0.4));
    vNoise = noise;
    vec3 displaced = position + normal * noise * uDistortion;
    vPosition = displaced;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const orbFragmentShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying float vNoise;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uRimPower;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(-vPosition);
    
    // Advanced Fresnel with variable sharpness
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), uRimPower);
    
    // Red-dominant palette based on noise and time
    // Shifted phases to keep colors in the Red-Orange-Magenta spectrum
    vec3 palette = 0.5 + 0.5 * cos(uTime * 1.5 + vNoise * 6.0 + vec3(0.0, 0.2, 0.5));
    
    // Mix the custom uniforms with the procedural palette
    vec3 baseColor = mix(uColorA, uColorB, palette.x);
    
    // Add some magenta/orange highlights from the palette's other channels
    baseColor += palette.y * vec3(0.2, 0.0, 0.1); 
    
    // Vibrant glow components (with rim lighting for 3D depth)
    // We multiply fresnel by baseColor to ensure the highlights are colored
    vec3 energyColor = baseColor + (baseColor * fresnel * 2.5);
    
    // Fully solid opacity
    gl_FragColor = vec4(energyColor, 1.0);
}
`;

const particleVertexShader = `
attribute float aSize;
attribute float aSpeed;
attribute float aRandom;
uniform float uTime;
uniform vec3 uColor;
uniform float uPixelRatio;
varying float vAlpha;
varying vec3 vColor;

void main() {
    // Procedural orbital path
    float angle = uTime * aSpeed + aRandom * 6.28;
    vec3 pos = position;
    pos.x = cos(angle) * (1.2 + aRandom * 0.6);
    pos.z = sin(angle) * (1.2 + aRandom * 0.6);
    pos.y += sin(uTime + aRandom * 10.0) * 0.3;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (500.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    
    vAlpha = smoothstep(0.0, 0.2, aRandom) * (0.5 + 0.5 * sin(uTime + aRandom));
    
    // Red-focused particle color variation
    vec3 variation = 0.5 + 0.5 * cos(uTime + aRandom * 5.0 + vec3(0.0, 0.1, 0.2));
    vColor = mix(uColor, variation, 0.3);
}
`;

const particleFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    // Circle rendering with anti-aliasing
    float dist = length(gl_PointCoord - 0.5);
    float mask = smoothstep(0.5, 0.45, dist);
    
    if (mask < 0.01) discard;
    
    gl_FragColor = vec4(vColor, mask * vAlpha);
}
`;

// Cache geometries to prevent massive frame drops (lag) when loading new orbs
let sharedCoreGeo = null;
let sharedParticleGeo = null;

export class CollectibleOrb {
    constructor(options = {}) {
        this.group = new THREE.Group();
        this.time = 0;
        
        // Configuration
        const colorA = options.colorA || new THREE.Color(0xff0000); // Inner plasma (Red)
        const colorB = options.colorB || new THREE.Color(0xff5500); // Edge glow (Orange-Red)
        
        // 1. Redesigned Core: Geometry optimized for displacement (Shared & lower polycount for performance)
        if (!sharedCoreGeo) {
            sharedCoreGeo = new THREE.IcosahedronGeometry(1.0, 32); 
        }
        
        this.coreMat = new THREE.ShaderMaterial({
            vertexShader: orbVertexShader,
            fragmentShader: orbFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uColorA: { value: colorA },
                uColorB: { value: colorB },
                uDistortion: { value: 0.15 },
                uRimPower: { value: 4.0 }
            }
            // Removed transparent and additive blending to make the main orb solid
        });
        
        this.core = new THREE.Mesh(sharedCoreGeo, this.coreMat);
        this.group.add(this.core);

        // 2. High-Performance Particle System (Circles)
        this.initParticles(colorB);

        // 3. Dynamic Light
        this.light = new THREE.PointLight(colorB, 12, 6);
        this.group.add(this.light);

        this.group.scale.set(0.8, 0.8, 0.8);
    }

    initParticles(color) {
        if (!sharedParticleGeo) {
            const count = 200;
            sharedParticleGeo = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const speeds = new Float32Array(count);
            const randoms = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                sizes[i] = Math.random() * 0.15 + 0.05;
                speeds[i] = (Math.random() - 0.5) * 1.2;
                randoms[i] = Math.random();
            }

            sharedParticleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            sharedParticleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            sharedParticleGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
            sharedParticleGeo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        }

        this.particleMat = new THREE.ShaderMaterial({
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: color },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particleSystem = new THREE.Points(sharedParticleGeo, this.particleMat);
        this.group.add(this.particleSystem);
    }

    update(deltaTime) {
        this.time += deltaTime;
        
        // Update Shaders
        this.coreMat.uniforms.uTime.value = this.time;
        this.particleMat.uniforms.uTime.value = this.time;
        
        // Floating motion
        this.group.position.y = (this.baseY || 0) + 0.6 + Math.sin(this.time * 1.5) * 0.2;
        
        // Light pulsation
        this.light.intensity = 10 + Math.sin(this.time * 3.0) * 4.0;
        
        // Rotation
        this.core.rotation.y += deltaTime * 0.2;
    }

    setPosition(x, y, z) {
        this.baseY = y;
        this.group.position.set(x, y, z);
    }

    destroy() {
        this.coreMat.dispose();
        this.particleMat.dispose();
        // Do NOT dispose shared geometries here, otherwise future orbs will disappear
        this.group.parent?.remove(this.group);
    }
}