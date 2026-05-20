// rockFragment.glsl — Mountain / Floating Island Rock
// Triplanar PBR with correct whiteout normal blending
// Texture set: color.jpg, normal.jpg, ao.jpg (AO-only), displacement.jpg

precision mediump float;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying float vHeightNorm;

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

// ─────────────────────────────────────────────────────────────────────────────
// TRIPLANAR COLOR SAMPLE
// ─────────────────────────────────────────────────────────────────────────────
vec4 triplanarSample(sampler2D tex, vec3 worldPos, vec3 blend, float scale) {
    // Use .zy for X-projection so V is Y (up) and U is Z (horizontal)
    vec4 xSamp = texture2D(tex, worldPos.zy * scale);
    vec4 ySamp = texture2D(tex, worldPos.xz * scale);
    vec4 zSamp = texture2D(tex, worldPos.xy * scale);
    return xSamp * blend.x + ySamp * blend.y + zSamp * blend.z;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIPLANAR NORMAL — Correct UDN (Updated Derivative Normal) blending
//
// For each projection axis, we:
//   1. Sample tangent-space normal from the texture
//   2. Re-orient it into world space based on which axis the face is pointing
//   3. Blend all three with the triplanar weights
//
// Reference: "Triplanar Mapping" by Ben Golus (2017)
// ─────────────────────────────────────────────────────────────────────────────
vec3 triplanarNormal(sampler2D normalTex, vec3 worldPos, vec3 geoNormal, vec3 blend, float scale) {
    // Sample all three projections and decode [0,1] → [-1,1]
    // Use .zy for X-projection to match color map orientation
    vec3 tnX = texture2D(normalTex, worldPos.zy * scale).rgb * 2.0 - 1.0;
    vec3 tnY = texture2D(normalTex, worldPos.xz * scale).rgb * 2.0 - 1.0;
    vec3 tnZ = texture2D(normalTex, worldPos.xy * scale).rgb * 2.0 - 1.0;

    // Apply face sign strictly to the tangent Z component (which becomes the main axis normal)
    // Map tangent space (U, V, W) to world space (X, Y, Z) based on the projection plane
    // X-projection: U=Z, V=Y, W=X
    vec3 nX = vec3(tnX.z * sign(geoNormal.x), tnX.y, tnX.x);
    // Y-projection: U=X, V=Z, W=Y
    vec3 nY = vec3(tnY.x, tnY.z * sign(geoNormal.y), tnY.y);
    // Z-projection: U=X, V=Y, W=Z
    vec3 nZ = vec3(tnZ.x, tnZ.y, tnZ.z * sign(geoNormal.z));

    // Combine blended tangent normal with base geometry normal (Whiteout blend)
    return normalize(nX * blend.x + nY * blend.y + nZ * blend.z + geoNormal);
}

// ─────────────────────────────────────────────────────────────────────────────
// GGX / Cook-Torrance specular (physically based)
// ─────────────────────────────────────────────────────────────────────────────
float distributionGGX(float NdotH, float roughness) {
    float a  = roughness * roughness;
    float a2 = a * a;
    float d  = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * d * d + 0.0001);
}

float geometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k + 0.0001);
}

float geometrySmith(float NdotV, float NdotL, float roughness) {
    return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
void main() {
    // ── Triplanar blend weights ──
    // Power of 4 is enough sharpness; 6 was too aggressive causing visible seams
    vec3 absNormal = abs(vWorldNormal);
    vec3 blend = pow(absNormal, vec3(4.0));
    blend /= (blend.x + blend.y + blend.z + 0.0001);

    float scale = uTexScale;

    // ── Sample all maps via triplanar ──
    vec3 albedo   = triplanarSample(uColorMap,    vWorldPosition, blend, scale).rgb;
    float aoSamp  = triplanarSample(uARMMap,      vWorldPosition, blend, scale).r;
    vec3 N        = triplanarNormal(uNormalMap,   vWorldPosition, vWorldNormal, blend, scale);

    // ── Material properties ──
    // ao.jpg is a single-channel AO map, NOT a packed ARM.
    // Use sensible rock defaults for roughness and metalness.
    float ao        = aoSamp;
    float roughness = 0.95;   // Highly matte rock
    float metalness = 0.0;    // Rock is purely dielectric

    // ── Subtle height-based color variation ──
    // vHeightNorm: 0 = top (grass edge), 1 = bottom tip
    // Slightly tint lower regions darker — but keep it very subtle
    float darkening = smoothstep(0.5, 1.0, vHeightNorm);
    albedo = mix(albedo, albedo * uRockTintDark, darkening * 0.3);


    // ── PBR lighting setup ──
    vec3 L  = normalize(uLightDirection);
    vec3 V  = normalize(vViewDir);
    vec3 H  = normalize(L + V);

    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0001);
    float NdotH = max(dot(N, H), 0.0);
    float HdotV = max(dot(H, V), 0.0);

    // Fresnel base: rock is dielectric (F0 ≈ 0.04)
    vec3 F0 = vec3(0.04);
    vec3 F  = fresnelSchlick(HdotV, F0);

    // Specular (Cook-Torrance GGX)
    float D   = distributionGGX(NdotH, roughness);
    float G   = geometrySmith(NdotV, NdotL, roughness);
    vec3  specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);

    // Energy-conserving diffuse
    vec3  kD     = (1.0 - F) * (1.0 - metalness);
    vec3  diffuse = kD * albedo / 3.14159265;

    // Direct lighting (removed specular completely for an ultra-matte look)
    vec3 Lo = diffuse * uLightColor * NdotL;

    // ── Fake Environment Reflection (Sky/Bounce Light) ──
    // Removed to prevent any shiny appearance
    vec3 skyLight = vec3(0.0);

    // ── Rim Lighting (Fresnel Glow) ──
    // Removed rim light to prevent glowing edges that might look like reflections
    vec3 rimLight = vec3(0.0);

    // ── Ambient (single AO application) ──
    // Mild sky tint to ambient to avoid pure black shadows
    vec3 ambient = uAmbientColor * albedo * ao * vec3(0.9, 0.95, 1.0);

    // ── Half-Lambert wrap for fill lighting ──
    // Prevents pure-black on faces pointing away from light
    float wrap = dot(N, L) * 0.5 + 0.5;
    vec3 fillLight = albedo * uAmbientColor * wrap * 0.3;

    // ── Final composite ──
    vec3 color = ambient + Lo + fillLight + (skyLight * albedo) + rimLight;

    // Very mild gamma-like brightening to prevent crushing blacks
    // No Reinhard tonemapping — let the renderer handle that
    color = pow(color, vec3(0.95));

    // Clamp to valid range
    color = clamp(color, 0.0, 1.0);

    gl_FragColor = vec4(color, 1.0);
}
