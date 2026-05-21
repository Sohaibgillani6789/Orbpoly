/**
 * HitboxMath — Pure math sphere collision for server-side hit detection.
 *
 * The server never imports Three.js. All collision is done with
 * distance-squared checks between sphere centers — O(1) per pair.
 *
 * Character hitbox/hurtbox layout (offsets from model origin):
 *   Head:   {dy: 1.7, radius: 0.3}
 *   Torso:  {dy: 1.0, radius: 0.4}
 *   Legs:   {dy: 0.3, radius: 0.35}
 *   Hand:   {dy: 1.0, dx: ±0.6, radius: 0.25}  (only active during attack)
 */

/**
 * Default hurtbox layout (always active) — offsets from character origin.
 * These match the approximate skeleton proportions of the GLTF models.
 */
export const HURTBOX_LAYOUT = [
    { name: 'head',  dy: 1.7, dx: 0, dz: 0, radius: 0.3 },
    { name: 'torso', dy: 1.0, dx: 0, dz: 0, radius: 0.4 },
    { name: 'legs',  dy: 0.3, dx: 0, dz: 0, radius: 0.35 },
];

/**
 * Default hitbox (active only during attack frames).
 * Positioned in front of the character based on their facing direction.
 */
export const HITBOX = {
    forwardOffset: 0.8,  // Distance in front of character
    dy: 1.0,             // Height offset
    radius: 0.4,         // Hitbox sphere radius
};

/**
 * Checks if two spheres overlap.
 *
 * @param {number} ax - Sphere A center X
 * @param {number} ay - Sphere A center Y
 * @param {number} az - Sphere A center Z
 * @param {number} ar - Sphere A radius
 * @param {number} bx - Sphere B center X
 * @param {number} by - Sphere B center Y
 * @param {number} bz - Sphere B center Z
 * @param {number} br - Sphere B radius
 * @returns {boolean}
 */
export function sphereOverlap(ax, ay, az, ar, bx, by, bz, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    const distSq = dx * dx + dy * dy + dz * dz;
    const radiiSum = ar + br;
    return distSq < radiiSum * radiiSum;
}

/**
 * Gets the world-space position of a hitbox sphere for an attacking character.
 *
 * @param {Object} attackerPos - {x, y, z} attacker position
 * @param {number} attackerRotY - Y-axis rotation in radians
 * @returns {{x: number, y: number, z: number, radius: number}}
 */
export function getAttackHitboxWorld(attackerPos, attackerRotY) {
    const sinR = Math.sin(attackerRotY);
    const cosR = Math.cos(attackerRotY);
    return {
        x: attackerPos.x + sinR * HITBOX.forwardOffset,
        y: attackerPos.y + HITBOX.dy,
        z: attackerPos.z + cosR * HITBOX.forwardOffset,
        radius: HITBOX.radius,
    };
}

/**
 * Checks if an attacker's hitbox overlaps any of a victim's hurtboxes.
 *
 * @param {Object} attackerPos - {x, y, z}
 * @param {number} attackerRotY - Radians
 * @param {Object} victimPos - {x, y, z}
 * @returns {{ hit: boolean, hurtbox: string|null }}
 */
export function checkAttackHit(attackerPos, attackerRotY, victimPos) {
    const hitbox = getAttackHitboxWorld(attackerPos, attackerRotY);

    for (const hb of HURTBOX_LAYOUT) {
        const hbX = victimPos.x + hb.dx;
        const hbY = victimPos.y + hb.dy;
        const hbZ = victimPos.z + hb.dz;

        if (sphereOverlap(
            hitbox.x, hitbox.y, hitbox.z, hitbox.radius,
            hbX, hbY, hbZ, hb.radius
        )) {
            return { hit: true, hurtbox: hb.name };
        }
    }

    return { hit: false, hurtbox: null };
}

/**
 * Calculates flat (XZ plane) direction from A to B, normalized.
 *
 * @param {Object} from - {x, z}
 * @param {Object} to - {x, z}
 * @returns {{x: number, z: number, length: number}}
 */
export function flatDirection(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return { x: 0, z: 1, length: 0 };
    return { x: dx / len, z: dz / len, length: len };
}

/**
 * Calculates Smash Bros-style knockback magnitude.
 *
 * @param {number} basePower - Base knockback force
 * @param {number} damagePercent - Victim's accumulated damage
 * @returns {number}
 */
export function knockbackMagnitude(basePower, damagePercent) {
    return basePower * (1 + damagePercent / 100);
}
