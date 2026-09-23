import * as CANNON from 'cannon-es';

/**
 * CombatSystem — Handles collision detection, damage, and knockback.
 * 
 * Implements the Smash Bros-style formula:
 *   knockback = basePower × (1 + damagePercent / 100)
 * 
 * Differentiates between active punches (super knockback) and
 * Differentiates between active attacks (super knockback) and
 * passive bumps (tiny nudge) using the isAttacking flag on PlayerController.
 */
export class CombatSystem {
    /**
     * @param {Object} options
     * @param {number} options.basePower - Base knockback force (default: 10)
     * @param {number} options.liftForce - Upward pop on knockback (default: 5)
     * @param {number} options.damagePerHit - Damage added per punch (default: 15)
     * @param {number} options.nudgeForce - Force for passive bumps (default: 2)
     */
    constructor(options = {}) {
        /** @private */
        this._basePower = options.basePower || 10;
        /** @private */
        this._liftForce = options.liftForce || 5;
        /** @private */
        this._damagePerHit = options.damagePerHit || 15;
        /** @private */
        this._nudgeForce = options.nudgeForce || 2;

        /** @private @type {import('./PlayerController.js').PlayerController[]} */
        this._players = [];

        /** @private @type {Function[]} */
        this._onHitCallbacks = [];

        /**
         * @private
         * Tracks collision pairs to prevent duplicate hits within a short window.
         * Key: "bodyIdA-bodyIdB", Value: timestamp
         * @type {Map<string, number>}
         */
        this._recentHits = new Map();

        /** @private Minimum ms between repeated hits on same pair */
        this._hitCooldown = 300;

        /** @private Reusable impulse vector for knockbacks/nudges */
        this._impulseVec = new CANNON.Vec3();

        /** @private Timestamp of last hit map cleanup */
        this._lastCleanup = Date.now();
    }

    /**
     * Registers a player for collision detection.
     * @param {import('./PlayerController.js').PlayerController} playerController
     */
    registerPlayer(playerController) {
        this._players.push(playerController);

        // Attach collision listener to this player's physics body
        const handler = (event) => {
            this._handleCollision(playerController, event);
        };

        // Store reference for potential cleanup
        playerController._combatCollisionHandler = handler;
        playerController.body.addEventListener('collide', handler);
    }

    /**
     * Registers a callback fired whenever a punch lands.
     * @param {Function} callback - Receives { attacker, victim, damage, totalDamage }
     */
    onHit(callback) {
        this._onHitCallbacks.push(callback);
    }

    /**
     * @private
     * Processes a physics collision event.
     * Determines if it's a punch or passive bump and applies appropriate force.
     */
    _handleCollision(player, event) {
        const otherBody = event.body;

        // Only handle player–player collisions
        if (!otherBody.isPlayer) return;

        const otherPlayer = otherBody.playerController;
        if (!otherPlayer || !otherPlayer.isAlive || !player.isAlive) return;

        const now = Date.now();
        // Periodic cleanup of recent hits (every 5s)
        if (now - this._lastCleanup > 5000) {
            this._lastCleanup = now;
            for (const [key, time] of this._recentHits) {
                if (now - time > 1000) {
                    this._recentHits.delete(key);
                }
            }
        }

        // Deduplicate: prevent same collision from being processed by both bodies
        const pairKey = this._getPairKey(player.body.id, otherBody.id);
        const lastHit = this._recentHits.get(pairKey);

        if (lastHit && (now - lastHit) < this._hitCooldown) return;

        if (player.isAttacking) {
            this._recentHits.set(pairKey, now);
            // Shield blocks the hit entirely
            if (otherPlayer.isShielding) return;
            this._applySuperKnockback(player, otherPlayer);
        } else {
            this._applyTinyNudge(player, otherPlayer);
        }
    }

    /**
     * @private
     * Generates a consistent numeric key for a pair of body IDs (order-independent).
     */
    _getPairKey(idA, idB) {
        const min = idA < idB ? idA : idB;
        const max = idA < idB ? idB : idA;
        return (min << 16) | (max & 0xffff);
    }

    /**
     * @private
     * Applies Smash Bros-style knockback: direction × basePower × (1 + damage/100).
     */
    _applySuperKnockback(attacker, victim) {
        // Increase victim's damage
        victim.damagePercent += this._damagePerHit;

        // Direction from attacker to victim (horizontal plane)
        const dx = victim.body.position.x - attacker.body.position.x;
        const dz = victim.body.position.z - attacker.body.position.z;
        const length = Math.sqrt(dx * dx + dz * dz);

        // Fallback direction if players overlap exactly
        const dirX = length > 0.001 ? dx / length : 1;
        const dirZ = length > 0.001 ? dz / length : 0;

        // Scale force by victim's accumulated damage
        const multiplier = 1 + (victim.damagePercent / 100);
        const totalForce = this._basePower * multiplier;

        this._impulseVec.set(
            dirX * totalForce,
            this._liftForce,   // Pop-up effect
            dirZ * totalForce
        );

        victim.receiveHit(this._impulseVec);

        // Notify listeners
        for (const cb of this._onHitCallbacks) {
            cb({
                attacker,
                victim,
                damage: this._damagePerHit,
                totalDamage: victim.damagePercent
            });
        }
    }

    /**
     * @private
     * Applies a tiny nudge for passive (non-punch) collisions.
     */
    _applyTinyNudge(player, other) {
        const dx = other.body.position.x - player.body.position.x;
        const dz = other.body.position.z - player.body.position.z;
        const length = Math.sqrt(dx * dx + dz * dz);

        if (length < 0.001) return;

        this._impulseVec.set(
            (dx / length) * this._nudgeForce,
            0.5,
            (dz / length) * this._nudgeForce
        );

        other.body.applyImpulse(this._impulseVec);
    }

    /**
     * Removes a player from the combat system.
     * @param {import('./PlayerController.js').PlayerController} playerController
     */
    unregisterPlayer(playerController) {
        if (!playerController) return;
        if (playerController._combatCollisionHandler && playerController.body) {
            playerController.body.removeEventListener('collide', playerController._combatCollisionHandler);
            playerController._combatCollisionHandler = null;
        }
        const index = this._players.indexOf(playerController);
        if (index > -1) {
            this._players.splice(index, 1);
        }
    }

    /** Clears the hit cooldown cache (call periodically or on round reset) */
    clearCooldowns() {
        this._recentHits.clear();
    }

    /** Disposes all player collision listeners and clears references */
    dispose() {
        for (const player of this._players) {
            if (player && player._combatCollisionHandler && player.body) {
                player.body.removeEventListener('collide', player._combatCollisionHandler);
                player._combatCollisionHandler = null;
            }
        }
        this._players = [];
        this._onHitCallbacks = [];
        this._recentHits.clear();
    }
}
