varying vec2 vUv;
varying vec2 cloudUV;
varying vec3 vColor;
varying float vHeight;       // normalized blade height 0..1
varying vec3 vWorldPos;      // world-space position for lighting
varying vec3 vWorldNormal;   // approximate face normal
varying vec2 vGrassVariation;
varying vec3 vAmbientInfluence;
varying float vNdotL;

uniform float iTime;
uniform float uWaveSize;
uniform float uTipDistance;
uniform float uCenterDistance;
uniform vec3 uSunDirection;
uniform vec3 uAmbientLightColor;

// Simple hash for per-blade variation (deterministic from position)
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
    vUv = uv;
    cloudUV = uv;
    vColor = color;

    // Compute blade variation (runs once per vertex instead of per pixel)
    float variation = hash(uv) * 2.0 - 1.0;
    float valueShift = hash(uv + vec2(99.0, 33.0)) - 0.5;
    vGrassVariation = vec2(variation, valueShift);

    // Compute NdotL (approximate normal faces straight up)
    vec3 normal = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vNdotL = dot(normal, normalize(uSunDirection));

    // Compute ambient light color influence
    vec3 normalizedAmbient = uAmbientLightColor / vec3(0.73, 0.84, 1.0);
    normalizedAmbient = clamp(normalizedAmbient, 0.2, 1.5);
    vAmbientInfluence = mix(vec3(1.0), normalizedAmbient, 0.55);

    vec3 cpos = position;
    // iTime is in milliseconds; divide by 2500 for a gentle but visible breeze
    float t = iTime / 2500.0;

    // Per-blade phase offset from UV (gives each blade unique timing)
    float phase = hash(uv) * 6.2831;
    float phaseB = hash(uv + vec2(42.0, 17.0)) * 6.2831;

    // Height factor: color.x encodes normalized height
    // black=0 (base), gray=0.5 (mid), white=1.0 (tip)
    float heightFactor = color.x;
    vHeight = heightFactor;

    // ── Multi-frequency wind ──
    // Primary wave — slow, large-scale field sway
    float windPrimary = sin(t * 0.9 + uv.x * uWaveSize + phase) * 0.6
                      + sin(t * 1.1 + uv.y * uWaveSize * 0.7 + phase) * 0.3;

    // Secondary ripple — gentle flutter, much slower than before
    float windSecondary = sin(t * 1.5 + uv.x * uWaveSize * 1.8 + phaseB) * 0.2
                        + cos(t * 1.2 + uv.y * uWaveSize * 1.3 + phaseB) * 0.15;

    // Gust — rare, subtle long-period pulse
    float gust = sin(t * 0.25 + uv.x * 2.5) * sin(t * 0.12 + uv.y * 2.0);
    gust = max(gust, 0.0) * 0.25; // only positive gusts, reduced amplitude

    float totalWind = windPrimary + windSecondary * 0.5 + gust;

    // Height-based stiffness: base doesn't move, tip moves most
    // Using quadratic falloff for realistic stiffness (grass is stiff at base)
    float stiffness = heightFactor * heightFactor;

    // Apply wind displacement
    if (heightFactor > 0.6) {
        // Tip vertices — full movement
        cpos.x += totalWind * uTipDistance * stiffness;
        cpos.z += (windSecondary + gust * 0.5) * uTipDistance * 0.4 * stiffness;
        // Slight vertical compression when bending (conservation of length)
        cpos.y -= abs(totalWind) * uTipDistance * 0.05 * stiffness;
    } else if (heightFactor > 0.0) {
        // Mid vertices — reduced movement
        cpos.x += totalWind * uCenterDistance * stiffness;
        cpos.z += windSecondary * uCenterDistance * 0.3 * stiffness;
    }

    // Cloud shadow drift — moderate pace
    cloudUV.x += iTime / 40000.0;
    cloudUV.y += iTime / 20000.0;

    // Pass world position
    vec4 worldPos = modelMatrix * vec4(cpos, 1.0);
    vWorldPos = worldPos.xyz;

    // Approximate normal (grass blades face outward/up)
    vWorldNormal = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);

    // Final position
    vec4 mvPosition = projectionMatrix * modelViewMatrix * vec4(cpos, 1.0);
    gl_Position = mvPosition;
}
