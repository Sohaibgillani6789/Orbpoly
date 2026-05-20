// skyVertex.glsl — Pixar Sky System
// Computes view direction in vertex shader (optimization: avoids per-pixel normalize)
// OPTIMIZATION: horizon blend precomputed here to save fragment ops

varying vec3 vWorldPosition;
varying vec3 vViewDirection;
varying vec2 vUv;
varying float vHorizonBlend; // Pre-computed horizon gradient for fragment shader

void main() {
    vUv = uv;

    // Transform vertex to world space for view direction calculation
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    // View direction: from camera to this vertex
    vec3 viewDir = normalize(worldPos.xyz - cameraPosition);
    vViewDirection = viewDir;

    // OPTIMIZATION: Calculate horizon blend in vertex shader
    // This saves a normalize + pow per fragment on the entire sky dome
    vHorizonBlend = pow(max(0.0, 1.0 - abs(viewDir.y)), 2.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
