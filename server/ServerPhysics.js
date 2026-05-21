/**
 * ServerPhysics — Lightweight math-only physics for the authoritative server.
 *
 * Design rationale:
 *   - NO cannon-es dependency. The server must be lean (< 5ms per tick for 6 players).
 *   - Position integration: Euler method (pos += vel × dt)
 *   - Gravity: constant downward acceleration
 *   - Ground plane: circular platform at Y = 0
 *   - Velocity damping: simulates friction without contact resolution
 *
 * All positions/velocities are plain {x, y, z} objects — no class instances,
 * no prototype chains, no garbage collection pressure.
 */

/** @type {number} Gravity acceleration (m/s²) */
const GRAVITY = 9.82;

/** @type {number} Horizontal velocity damping per second (0 = no friction, 1 = instant stop) */
const GROUND_DAMPING = 0.92;

/** @type {number} Max horizontal speed (m/s) */
const MAX_HORIZONTAL_SPEED = 10;

/** @type {number} Jump velocity (m/s) */
const JUMP_VELOCITY = 8;

/** @type {number} Movement force → acceleration conversion (force / mass, mass = 1) */
const MOVE_ACCELERATION = 80;

/**
 * Integrates a single player's physics state forward by dt.
 *
 * @param {Object} state - Player state (mutated in-place)
 * @param {Object} state.position - {x, y, z}
 * @param {Object} state.velocity - {x, y, z}
 * @param {number} platformRadius - Radius of the circular platform
 * @param {number} dt - Time step in seconds
 */
export function integratePlayer(state, platformRadius, dt) {
    const pos = state.position;
    const vel = state.velocity;

    // --- Gravity ---
    vel.y -= GRAVITY * dt;

    // --- Position integration ---
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    // --- Ground collision (circular platform at Y = 0) ---
    const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    const isOverPlatform = distFromCenter < platformRadius;

    if (pos.y < 0 && isOverPlatform) {
        pos.y = 0;
        vel.y = 0;

        // Ground friction — exponential damping
        const dampFactor = Math.pow(1 - GROUND_DAMPING, dt);
        vel.x *= dampFactor;
        vel.z *= dampFactor;
    }

    // --- Horizontal speed clamp ---
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (hSpeed > MAX_HORIZONTAL_SPEED) {
        const scale = MAX_HORIZONTAL_SPEED / hSpeed;
        vel.x *= scale;
        vel.z *= scale;
    }
}

/**
 * Applies movement input to a player's velocity.
 * The input is a normalized direction vector rotated by the client's camera yaw.
 *
 * @param {Object} state - Player state (mutated in-place)
 * @param {number} dirX - Normalized movement direction X
 * @param {number} dirZ - Normalized movement direction Z
 * @param {number} dt - Time step in seconds
 */
export function applyMovementInput(state, dirX, dirZ, dt) {
    const isGrounded = state.position.y <= 0.01 && Math.abs(state.velocity.y) < 0.5;
    if (!isGrounded) return; // No air control on server

    state.velocity.x += dirX * MOVE_ACCELERATION * dt;
    state.velocity.z += dirZ * MOVE_ACCELERATION * dt;
}

/**
 * Applies a jump to the player if grounded.
 *
 * @param {Object} state - Player state (mutated in-place)
 * @returns {boolean} True if jump was applied
 */
export function applyJump(state) {
    const isGrounded = state.position.y <= 0.01 && Math.abs(state.velocity.y) < 0.5;
    if (!isGrounded) return false;

    state.velocity.y = JUMP_VELOCITY;
    return true;
}

/**
 * Applies a knockback impulse to a player.
 *
 * @param {Object} state - Player state (mutated in-place)
 * @param {number} ix - Impulse X
 * @param {number} iy - Impulse Y
 * @param {number} iz - Impulse Z
 */
export function applyImpulse(state, ix, iy, iz) {
    state.velocity.x += ix;
    state.velocity.y += iy;
    state.velocity.z += iz;
}

/**
 * Checks if a player has fallen below the ring-out threshold.
 *
 * @param {Object} state - Player state
 * @param {number} ringOutY - Y threshold for ring-out (e.g., -20)
 * @returns {boolean}
 */
export function isRingOut(state, ringOutY) {
    return state.position.y < ringOutY;
}

/**
 * Checks if a player is grounded on the platform.
 *
 * @param {Object} state - Player state
 * @returns {boolean}
 */
export function isGrounded(state) {
    return state.position.y <= 0.01 && Math.abs(state.velocity.y) < 0.5;
}

export {
    GRAVITY,
    GROUND_DAMPING,
    MAX_HORIZONTAL_SPEED,
    JUMP_VELOCITY,
    MOVE_ACCELERATION
};
