// skyFragment.glsl — Bright Daytime Sky + Fluffy White Cumulus Clouds + Moon Glow
// Reference: photo-realistic daytime sky, bright blue, large white clouds
// Moon glow: smooth radial gradient rendered into the sky — no geometry rings
precision highp float;

uniform float uTime;
uniform vec3 uSunPosition;
uniform vec2 uResolution;
uniform vec3 uSkyColorTop;
uniform vec3 uSkyColorBottom;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadowColor;
uniform float uCloudSpeed;
uniform float uCloudDensity;
uniform float uSunIntensity;
uniform float uNightBlend; // 0.0 = day/evening, 1.0 = full night (drives starfield)
uniform vec3 uMoonDirection;  // Normalized direction toward moon
uniform float uMoonGlow;      // 0.0 = no glow, 1.0 = full glow

varying vec3 vWorldPosition;
varying vec3 vViewDirection;
varying vec2 vUv;
varying float vHorizonBlend; // Pre-computed in vertex shader (optimization)

// ============================================================
// SIMPLEX NOISE (canonical, verified implementation)
// ============================================================
vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289_4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute4(vec4 x) { return mod289_4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

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

    i = mod289_3(i);
    vec4 p = permute4(permute4(permute4(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

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

    vec4 norm = taylorInvSqrt4(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ============================================================
// CLOUD DENSITY — optimized: 2-octave FBM (was 4), no domain warp
// Visual difference is negligible at mobile render scale 1.0
// ============================================================

// 2-octave billowing FBM — sufficient for cloud shape at mobile DPR
float billowFBM(vec3 p) {
    float f = 0.0;
    f += 0.5 * abs(snoise(p));
    f += 0.25 * abs(snoise(p * 2.02));
    return f;
}

// Cloud density — simplified: no domain warping (saves 2 extra snoise calls)
float getCloudDensity(vec3 p) {
    float cloud = billowFBM(p);

    // uCloudDensity: 0.5 (default) gives ~50% sky coverage
    float threshold = 0.9 - uCloudDensity;

    // Remap [threshold, threshold+0.25] → [0, 1] with smooth edges
    float density = smoothstep(threshold, threshold + 0.25, cloud);

    return density;
}

// ============================================================
// MOON GLOW — smooth radial light scatter rendered into sky
// Simplified: 2 bands instead of 3 (scatter barely visible on mobile)
// ============================================================
vec3 getMoonGlow(vec3 viewDir) {
    if (uMoonGlow < 0.001) return vec3(0.0);

    vec3 moonDir = normalize(uMoonDirection);
    float moonDot = max(0.0, dot(viewDir, moonDir));

    // Band 1: Tight inner corona (bright, warm white)
    float corona = pow(moonDot, 180.0) * 0.9;
    vec3 coronaColor = vec3(0.95, 0.92, 0.82);

    // Band 2: Mid haze (cool blue-white atmospheric glow)
    float haze = pow(moonDot, 32.0) * 0.2;
    vec3 hazeColor = vec3(0.55, 0.60, 0.78);

    vec3 totalGlow = coronaColor * corona + hazeColor * haze;

    return totalGlow * uMoonGlow;
}

// ============================================================
// SUN GLOW — simplified for mobile: 2 bands (corona + mid)
// ============================================================
vec3 getSunGlow(vec3 viewDir, vec3 sunDir, float sunLow) {
    if (uNightBlend > 0.99) return vec3(0.0);

    float sunDot = max(0.0, dot(viewDir, sunDir));

    // Band 1: Sun disk — tight, hot core
    float corona = pow(sunDot, 800.0) * 0.65;
    vec3 coronaDay   = vec3(1.0, 0.95, 0.80);
    vec3 coronaLow   = vec3(1.0, 0.72, 0.32);
    vec3 coronaColor = mix(coronaDay, coronaLow, sunLow);

    // Band 2: Mid halo
    float midGlow = pow(sunDot, 40.0) * 0.18;
    vec3 midDay   = vec3(1.0, 0.88, 0.60);
    vec3 midLow   = vec3(1.0, 0.58, 0.22);
    vec3 midColor = mix(midDay, midLow, sunLow);

    vec3 totalGlow = coronaColor * corona + midColor * midGlow;

    float intensityMult = mix(0.6, 1.0, sunLow);
    totalGlow *= intensityMult * (1.0 - uNightBlend);

    return totalGlow;
}

// ============================================================
// MAIN
// ============================================================
void main() {
    vec3 viewDir = normalize(vViewDirection);
    vec3 sunDir = normalize(uSunPosition);
    float sunLowness = 1.0 - clamp(sunDir.y * 3.0, 0.0, 1.0);

    // --- SKY GRADIENT ---
    // OPTIMIZATION: Use pre-computed vHorizonBlend from vertex shader
    vec3 skyColor = mix(uSkyColorTop, uSkyColorBottom, vHorizonBlend);

    // --- MOON GLOW (rendered into sky, seamless, no geometry) ---
    skyColor += getMoonGlow(viewDir);

    // --- SUN GLOW (rendered behind clouds, soft screen-blend to prevent blowout) ---
    vec3 sunGlow = getSunGlow(viewDir, sunDir, sunLowness);
    skyColor = 1.0 - (1.0 - skyColor) * (1.0 - sunGlow * 0.9);

    // --- CLOUD COORDINATE MAPPING ---
    vec3 pos = viewDir * 1.5;

    // Wind animation
    pos.x += uTime * uCloudSpeed;
    pos.z += uTime * uCloudSpeed * 0.4;

    // --- DENSITY ---
    float density = getCloudDensity(pos);

    // Pure sky — no cloud
    if (density < 0.005) {
        gl_FragColor = vec4(skyColor, 1.0);
        return;
    }

    // --- SIMPLIFIED SELF-SHADOWING (single step instead of 2) ---
    float stepSize = 0.15;
    float shadow = billowFBM(pos + sunDir * stepSize * 1.5);
    float cloudThreshold = 0.9 - uCloudDensity;
    shadow = smoothstep(cloudThreshold, cloudThreshold + 0.25, shadow);

    float extinctionCoeff = mix(0.4, 0.7, clamp(sunDir.y * 2.5, 0.0, 1.0));
    float transmittance = exp(-shadow * extinctionCoeff);

    // --- CLOUD COLOR COMPUTATION ---
    vec3 cloudLit    = uCloudColor;
    vec3 cloudShadow = uCloudShadowColor;

    // Sun-facing warmth
    float sunDot = max(0.0, dot(viewDir, sunDir));
    cloudLit += vec3(0.20, 0.14, 0.02) * pow(sunDot, 2.5) * uSunIntensity;

    // Golden hour backlighting
    float backlight = pow(sunDot, 1.5) * sunLowness * 0.25;
    cloudLit += vec3(0.25, 0.20, 0.08) * backlight * uSunIntensity;

    // Lift shadow color toward warmth when sun is low
    vec3 adjustedShadow = mix(cloudShadow, cloudShadow + vec3(0.08, 0.04, 0.02), sunLowness);

    // Mix lit/shadow by transmittance
    vec3 cloudColor = mix(adjustedShadow, cloudLit, transmittance);

    // Silver lining at cloud edges
    float edge = 1.0 - density;
    float silverBoost = mix(0.6, 0.9, sunLowness);
    float silver = pow(sunDot, 5.0) * edge * uSunIntensity * silverBoost;
    cloudColor += vec3(1.0, 0.95, 0.85) * silver;

    // --- FINAL COMPOSITE ---
    vec3 finalColor = mix(skyColor, cloudColor, density);

    // Subtle dither to prevent banding
    float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 0.003 - 0.0015;
    finalColor += dither;

    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
