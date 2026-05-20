// moonVertex.glsl — Moon surface vertex shader
// Passes UVs, normals, and local position to fragment shader for procedural detail
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position; // Local space position for procedural noise
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
