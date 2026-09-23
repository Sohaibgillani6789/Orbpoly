// moonVertex.glsl — Moon surface vertex shader

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position; // Local space position for procedural noise
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
