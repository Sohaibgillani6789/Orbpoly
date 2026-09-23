// rockFragment.glsl — Mountain / Floating Island Rock
// Optimized Triplanar shader with energy-conserving matte lighting
// Texture set: color.jpg, normal.jpg, ao.jpg (AO-only)

precision mediump float;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying float vHeightNorm;
varying float vFogDepth;

// ── Textures ──────────────────────────────────────────────────────────────────
uniform sampler2D uColorMap;      // sRGB albedo
uniform sampler2D uNormalMap;     // tangent-space normal (linear)
uniform sampler2D uARMMap;        // AO map (greyscale in R channel)

// ── Lighting ──────────────────────────────────────────────────────────────────
uniform vec3 uLightDirection;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;

// ── Tuning ────────────────────────────────────────────────────────────────────
uniform float uTexScale;
uniform float uMossBlend;
uniform vec3  uMossColor;
uniform vec3  uRockTintDark;
uniform float uRockDepth;

// Exponential fog (FogExp2)
uniform vec3 uFogColor;
uniform float uFogDensity;

// ─────────────────────────────────────────────────────────────────────────────
// TRIPLANAR COLOR SAMPLE
// ─────────────────────────────────────────────────────────────────────────────
vec4 triplanarSample(sampler2D tex, vec3 worldPos, vec3 blend, float scale) {
    vec4 xSamp = texture2D(tex, worldPos.zy * scale);
    vec4 ySamp = texture2D(tex, worldPos.xz * scale);
    vec4 zSamp = texture2D(tex, worldPos.xy * scale);
    return xSamp * blend.x + ySamp * blend.y + zSamp * blend.z;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIPLANAR NORMAL — UDN (Updated Derivative Normal) blending
// ─────────────────────────────────────────────────────────────────────────────
vec3 triplanarNormal(sampler2D normalTex, vec3 worldPos, vec3 geoNormal, vec3 blend, float scale) {
    vec3 tnX = texture2D(normalTex, worldPos.zy * scale).rgb * 2.0 - 1.0;
    vec3 tnY = texture2D(normalTex, worldPos.xz * scale).rgb * 2.0 - 1.0;
    vec3 tnZ = texture2D(normalTex, worldPos.xy * scale).rgb * 2.0 - 1.0;

    vec3 nX = vec3(tnX.z * sign(geoNormal.x), tnX.y, tnX.x);
    vec3 nY = vec3(tnY.x, tnY.z * sign(geoNormal.y), tnY.y);
    vec3 nZ = vec3(tnZ.x, tnZ.y, tnZ.z * sign(geoNormal.z));

    return normalize(nX * blend.x + nY * blend.y + nZ * blend.z + geoNormal);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
void main() {
    // ── Triplanar blend weights ──
    vec3 absNormal = abs(vWorldNormal);
    vec3 blend = pow(absNormal, vec3(4.0));
    blend /= (blend.x + blend.y + blend.z + 0.0001);

    float scale = uTexScale;

    // ── Sample all maps via triplanar ──
    vec3 albedo  = triplanarSample(uColorMap,  vWorldPosition, blend, scale).rgb;
    float ao     = triplanarSample(uARMMap,    vWorldPosition, blend, scale).r;
    vec3 N       = triplanarNormal(uNormalMap, vWorldPosition, vWorldNormal, blend, scale);

    // ── Subtle height-based color variation ──
    float darkening = smoothstep(0.5, 1.0, vHeightNorm);
    albedo = mix(albedo, albedo * uRockTintDark, darkening * 0.3);

    // ── Direct diffuse lighting (Lambertian / energy-conserving matte rock) ──
    vec3 L = normalize(uLightDirection);
    float NdotL = max(dot(N, L), 0.0);

    // Energy-conserving dielectric diffuse (kD ≈ 0.96 / PI ≈ 0.3056)
    vec3 diffuse = albedo * 0.305577;
    vec3 Lo = diffuse * uLightColor * NdotL;

    // ── Ambient (single AO application) ──
    vec3 ambient = uAmbientColor * albedo * ao * vec3(0.9, 0.95, 1.0);

    // ── Half-Lambert wrap for fill lighting ──
    float wrap = dot(N, L) * 0.5 + 0.5;
    vec3 fillLight = albedo * uAmbientColor * wrap * 0.3;

    // ── Final composite ──
    vec3 color = ambient + Lo + fillLight;

    // ── Exponential squared fog (Beer-Lambert) ──
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    color = mix(color, uFogColor, fogFactor);

    // Very mild gamma-like brightening to prevent crushing blacks
    color = pow(color, vec3(0.95));
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}
