// rockVertex.glsl — Mountain / Floating Island Rock
// Passes world-space data for triplanar PBR in fragment shader.

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying float vHeightNorm;  // 0 = top (grass edge), 1 = bottom tip
varying float vFogDepth;    // camera-space depth for exponential fog

uniform float uRockDepth;

void main() {
    // World-space position — needed for triplanar UV generation
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    // World-space normal — needed for triplanar blend weights and lighting
    // normalMatrix is the transpose-inverse of modelMatrix (removes non-uniform scale)
    vWorldNormal = normalize(normalMatrix * normal);

    // View direction (world-space) — for Fresnel and specular
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    // Normalized vertical position: 0 at top (Y=0), 1 at bottom tip (Y=-uRockDepth)
    vHeightNorm = clamp(-position.y / uRockDepth, 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;
}
