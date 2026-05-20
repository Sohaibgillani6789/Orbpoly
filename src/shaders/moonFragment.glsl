// moonFragment.glsl — Cinematic Pixar/Disney-quality Moon Surface Shader
// Features: procedural craters, maria (dark basalt patches), rim glow,
// subsurface-scattered edge luminance, and subtle color variation
precision highp float;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

uniform float uOpacity;
uniform float uTime;

// ============================================================
// NOISE FUNCTIONS (self-contained, no imports needed)
// ============================================================
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x4 = x_ * ns.x + ns.yyyy;
    vec4 y4 = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x4) - abs(y4);
    vec4 b0 = vec4(x4.xy, y4.xy);
    vec4 b1 = vec4(x4.zw, y4.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ============================================================
// CRATER FUNCTION — circular depressions with raised rims
// ============================================================
float crater(vec2 uv, vec2 center, float radius, float depth) {
    float d = length(uv - center) / radius;
    // Bowl shape: smooth depression in center, raised rim at edge
    float bowl = smoothstep(0.0, 0.8, d) - smoothstep(0.8, 1.0, d) * 0.5;
    float rim = (1.0 - smoothstep(0.85, 1.15, d)) * smoothstep(0.75, 0.85, d);
    return (-depth * (1.0 - bowl) + rim * depth * 0.3) * (1.0 - smoothstep(1.0, 1.3, d));
}

// ============================================================
// MAIN
// ============================================================
void main() {
    // Sphere-space coordinates for surface detail
    vec3 N = normalize(vNormal);
    vec2 uv = vUv;
    
    // --- BASE COLOR: warm ivory with slight variation ---
    vec3 baseColor = vec3(0.92, 0.90, 0.82); // Warm cream-white
    
    // --- MARIA (dark basalt plains) ---
    // Large-scale dark patches like Mare Tranquillitatis, Mare Serenitatis
    float maria1 = snoise(vPosition * 0.7 + vec3(5.0, 0.0, 3.0));
    float maria2 = snoise(vPosition * 1.2 + vec3(10.0, 5.0, 7.0));
    float maria3 = snoise(vPosition * 0.4 + vec3(2.0, 8.0, 1.0));
    
    // Combine maria — creates distinct dark regions
    float mariaFactor = smoothstep(0.1, 0.55, maria1 * 0.6 + maria2 * 0.3 + maria3 * 0.1);
    vec3 mariaColor = vec3(0.65, 0.63, 0.58); // Slightly darker, cooler grey
    baseColor = mix(baseColor, mariaColor, mariaFactor * 0.45);
    
    // --- FINE SURFACE TEXTURE (regolith) ---
    float regolith1 = snoise(vPosition * 4.0 + vec3(20.0));
    float regolith2 = snoise(vPosition * 8.0 + vec3(40.0));
    float regolith = regolith1 * 0.5 + regolith2 * 0.25;
    baseColor += regolith * 0.04; // Very subtle surface roughness
    
    // --- PROCEDURAL CRATERS ---
    // Convert sphere coordinates to stable UV for crater placement
    vec3 sp = normalize(vPosition);
    
    // Large craters (Tycho, Copernicus scale)
    float craterEffect = 0.0;
    craterEffect += crater(sp.xy, vec2(0.3, 0.5), 0.18, 0.12);
    craterEffect += crater(sp.xy, vec2(-0.4, 0.2), 0.14, 0.10);
    craterEffect += crater(sp.xz, vec2(0.1, -0.3), 0.22, 0.08);
    craterEffect += crater(sp.yz, vec2(-0.2, 0.4), 0.16, 0.11);
    
    // Medium craters
    craterEffect += crater(sp.xy, vec2(0.6, -0.1), 0.08, 0.07);
    craterEffect += crater(sp.xz, vec2(-0.5, 0.5), 0.10, 0.06);
    craterEffect += crater(sp.yz, vec2(0.4, -0.5), 0.07, 0.08);
    craterEffect += crater(sp.xy, vec2(-0.1, -0.6), 0.09, 0.05);
    craterEffect += crater(sp.xz, vec2(0.7, 0.3), 0.06, 0.06);
    
    // Small craters (noise-driven, many tiny ones)
    float smallCraters = snoise(vPosition * 6.0) * 0.5 + snoise(vPosition * 12.0) * 0.25;
    smallCraters = max(0.0, smallCraters - 0.3) * 0.15;
    craterEffect += smallCraters;
    
    // Apply crater darkening/brightening to surface
    baseColor += craterEffect * vec3(0.8, 0.78, 0.72);
    
    // --- LIMB DARKENING (real astronomical effect) ---
    // The edge of the moon is slightly darker due to viewing angle
    float facing = dot(N, vec3(0.0, 0.0, 1.0));
    float limbDark = pow(max(facing, 0.0), 0.35);
    baseColor *= mix(0.6, 1.0, limbDark);
    
    // --- SUBTLE SELF-ILLUMINATION GRADIENT ---
    // Slightly brighter on one side (simulating sunlight direction on moon surface)
    float sunGrad = dot(N, normalize(vec3(0.5, 0.3, 0.8)));
    baseColor *= 0.9 + 0.1 * sunGrad;
    
    // --- RIM GLOW (atmospheric scattering at edge) ---
    float rim = 1.0 - max(facing, 0.0);
    float rimGlow = pow(rim, 3.0) * 0.25;
    vec3 rimColor = vec3(0.7, 0.75, 0.9); // Cool blue-white edge glow
    baseColor += rimColor * rimGlow;
    
    // --- FINAL OUTPUT ---
    // Ensure brightness stays in visible range — moon should be BRIGHT
    baseColor = clamp(baseColor, 0.0, 1.0);
    
    // Boost overall brightness — moon is the brightest thing in night sky
    baseColor *= 1.15;
    
    gl_FragColor = vec4(clamp(baseColor, 0.0, 1.0), uOpacity);
}
