uniform sampler2D textures[2];   // textures[0] = grass, textures[1] = clouds
uniform float uGrassContrast;
uniform float uGrassBrightness;
uniform float uCloudMix;

// Lighting uniforms
uniform float uSunNdotL;
uniform vec3 uAmbientInfluence;
uniform float uAOStrength;
uniform float uSSSStrength;
uniform float uHueVariation;

// Mood/time-of-day tinting
uniform vec3 uMoodTint;          // Color multiplier (1,1,1 = neutral day)
uniform float uMoodTintStrength; // 0.0 = no tint, 1.0 = full tint

// Exponential fog (FogExp2)
uniform vec3 uFogColor;
uniform float uFogDensitySq;     // Precomputed uFogDensity * uFogDensity

varying vec2 vUv;
varying vec2 cloudUV;
varying vec3 vColor;
varying vec2 vGrassVariation;
varying float vFogDepth;

void main() {
    // ── Base color from texture ──
    vec3 color = texture2D(textures[0], vUv).rgb;

    // Contrast & brightness
    color = (color - 0.4) * uGrassContrast + 0.6;
    color += vec3(uGrassBrightness);

    // ── Per-blade hue/saturation variation ──
    float variation = vGrassVariation.x;
    vec3 warmShift = vec3(0.04, 0.02, -0.03) * variation * uHueVariation;
    float valueShift = vGrassVariation.y * 0.08 * uHueVariation;
    color += warmShift;
    color += vec3(valueShift);

    // ── Height-based depth and ambient occlusion ──
    float heightNorm = vColor.x; // 0=base, 0.5=mid, 1.0=tip

    // AO: dark at base, brightens quickly
    float ao = mix(0.25, 1.0, smoothstep(0.0, 0.45, heightNorm));
    ao = mix(1.0, ao, uAOStrength);
    color *= ao;

    // Tip brightening: grass tips catch more light
    float tipGlow = smoothstep(0.6, 1.0, heightNorm) * 0.12;
    color += vec3(tipGlow * 0.8, tipGlow, tipGlow * 0.3);

    // ── Subsurface scattering approximation ──
    float NdotL = uSunNdotL;
    float sss = max(0.0, -NdotL) * heightNorm;
    sss = sss * sqrt(sss) * uSSSStrength;
    vec3 sssColor = vec3(0.4, 0.65, 0.15) * sss;
    color += sssColor;

    // ── Soft directional light influence ──
    float directLight = max(0.0, NdotL) * 0.12 + 0.88;
    color *= directLight;

    // ── Cloud shadows ──
    vec3 clouds = texture2D(textures[1], cloudUV).rgb;
    color = mix(color, clouds, uCloudMix);

    // ── Ambient light color influence ──
    color *= uAmbientInfluence;

    // ── Mood tinting ──
    vec3 tintedColor = color * uMoodTint;
    color = mix(color, tintedColor, uMoodTintStrength);

    // ── Color grading ──
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, 1.08);

    // ── Exponential squared fog (Beer-Lambert) ──
    float fogFactor = 1.0 - exp(-uFogDensitySq * vFogDepth * vFogDepth);
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    color = mix(color, uFogColor, fogFactor);

    // Final output
    gl_FragColor = vec4(color, 1.0);
}
