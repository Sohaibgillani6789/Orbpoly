varying vec2 vUv;
varying vec2 cloudUV;
varying vec3 vColor;
varying vec2 vGrassVariation;
varying float vFogDepth;     // camera-space depth for exponential fog

uniform float iTime;
uniform float uWaveSize;
uniform float uTipDistance;
uniform float uCenterDistance;
uniform vec2 uCloudDrift;

void main() {
    vUv = uv;
    cloudUV = uv + uCloudDrift;
    vColor = color;

    // Per-blade variation and phases baked into vertex attributes (zero runtime hashes/trig)
    float heightFactor = color.x;
    float variation = color.y * 2.0 - 1.0;
    float valueShift = (color.y - 0.5);
    vGrassVariation = vec2(variation, valueShift);

    vec3 cpos = position;
    // iTime is in milliseconds; multiply by 0.0004 (1/2500) for breeze
    float t = iTime * 0.0004;

    float phase = color.z * 6.2831853;
    float phaseB = fract(color.z * 1.6180339) * 6.2831853;

    // ── Multi-frequency wind ──
    // Primary wave — slow, large-scale field sway
    float windPrimary = sin(t * 0.9 + uv.x * uWaveSize + phase) * 0.6
                      + sin(t * 1.1 + uv.y * uWaveSize * 0.7 + phase) * 0.3;

    // Secondary ripple — gentle flutter
    float windSecondary = sin(t * 1.5 + uv.x * uWaveSize * 1.8 + phaseB) * 0.2
                        + cos(t * 1.2 + uv.y * uWaveSize * 1.3 + phaseB) * 0.15;

    // Gust — rare, subtle long-period pulse
    float gust = sin(t * 0.25 + uv.x * 2.5) * sin(t * 0.12 + uv.y * 2.0);
    gust = max(gust, 0.0) * 0.25;

    float totalWind = windPrimary + windSecondary * 0.5 + gust;

    // Height-based stiffness: base doesn't move, tip moves most
    float stiffness = heightFactor * heightFactor;

    // Apply wind displacement
    if (heightFactor > 0.6) {
        cpos.x += totalWind * uTipDistance * stiffness;
        cpos.z += (windSecondary + gust * 0.5) * uTipDistance * 0.4 * stiffness;
        cpos.y -= abs(totalWind) * uTipDistance * 0.05 * stiffness;
    } else if (heightFactor > 0.0) {
        cpos.x += totalWind * uCenterDistance * stiffness;
        cpos.z += windSecondary * uCenterDistance * 0.3 * stiffness;
    }

    // Final position
    vec4 mvPosition = modelViewMatrix * vec4(cpos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Fog depth: camera-space depth (distance in front of camera)
    vFogDepth = -mvPosition.z;
}
