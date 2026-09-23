uniform sampler2D textures[2];   // textures[0] = grass, textures[1] = clouds
uniform float uGrassContrast;
uniform float uGrassBrightness;
uniform float uCloudMix;
uniform float iTime;

// Lighting uniforms
uniform vec3 uSunDirection;
uniform vec3 uAmbientLightColor;  // Synced from scene ambient light — drives color shift
uniform float uAOStrength;
uniform float uSSSStrength;
uniform float uHueVariation;

// Mood/time-of-day tinting
uniform vec3 uMoodTint;          // Color multiplier (1,1,1 = neutral day)
uniform float uMoodTintStrength; // 0.0 = no tint, 1.0 = full tint

// Exponential fog (FogExp2)
uniform vec3 uFogColor;
uniform float uFogDensity;

varying vec2 vUv;
varying vec2 cloudUV;
varying vec3 vColor;
varying float vHeight;
varying vec2 vGrassVariation;
varying vec3 vAmbientInfluence;
varying float vNdotL;
varying float vFogDepth;

void main() {
    // ── Base color from texture ──
    vec3 color = texture2D(textures[0], vUv).rgb;

    // Contrast & brightness (existing system)
    color = (color - 0.4) * uGrassContrast + 0.6;
    color += vec3(uGrassBrightness);

    // ── Per-blade hue/saturation variation ──
    // Precomputed in vertex shader (runs once per vertex)
    float variation = vGrassVariation.x;
    vec3 warmShift = vec3(0.04, 0.02, -0.03) * variation * uHueVariation;
    float valueShift = vGrassVariation.y * 0.08 * uHueVariation;
    color += warmShift;
    color += vec3(valueShift);

    // ── Height-based depth and ambient occlusion ──
    // Improved: uses smoothstep for softer gradient at base
    float heightNorm = vColor.x; // 0=base, 0.5=mid, 1.0=tip

    // AO: dark at base, brightens quickly
    float ao = mix(0.25, 1.0, smoothstep(0.0, 0.45, heightNorm));
    ao = mix(1.0, ao, uAOStrength); // user-controllable strength
    color *= ao;

    // Tip brightening: grass tips catch more light
    float tipGlow = smoothstep(0.6, 1.0, heightNorm) * 0.12;
    color += vec3(tipGlow * 0.8, tipGlow, tipGlow * 0.3); // warm highlight at tips

    // ── Subsurface scattering approximation ──
    // When sun is behind the blade, light passes through giving a warm glow
    float NdotL = vNdotL;
    float sss = max(0.0, -NdotL) * heightNorm; // only visible higher up
    sss = sss * sqrt(sss) * uSSSStrength; // Fast hardware sqrt instead of pow(1.5)
    vec3 sssColor = vec3(0.4, 0.65, 0.15) * sss; // warm translucent green
    color += sssColor;

    // ── Soft directional light influence ──
    // Raised minimum floor to 0.88 to prevent grass going dark when sun/moon
    // direction changes — ensures visibility in all moods
    float directLight = max(0.0, NdotL) * 0.12 + 0.88;
    color *= directLight;

    // ── Cloud shadows ──
    vec3 clouds = texture2D(textures[1], cloudUV).rgb;
    color = mix(color, clouds, uCloudMix);

    // ── Ambient light color influence ──
    // Precomputed in vertex shader (runs once per vertex)
    color *= vAmbientInfluence;

    // ── Mood tinting (additional fine-tuning on top of ambient) ──
    vec3 tintedColor = color * uMoodTint;
    color = mix(color, tintedColor, uMoodTintStrength);

    // ── Color grading ──
    // Slightly boost greens, desaturate very slightly for natural look
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, 1.08); // tiny saturation boost

    // ── Exponential squared fog (Beer-Lambert) ──
    // fogFactor approaches 1.0 at distance — smooth natural falloff
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    color = mix(color, uFogColor, fogFactor);

    // Final output
    gl_FragColor = vec4(color, 1.0);
}
