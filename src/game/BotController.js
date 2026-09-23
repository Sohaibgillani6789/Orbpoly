import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { AnimState } from './AnimationStateMachine.js';

/**
 * Bot AI States — Finite State Machine
 */
export const BotState = Object.freeze({
    SEARCHING: 'searching',
    AGGRESSIVE: 'aggressive',
    DEFENSIVE: 'defensive'
});

/**
 * BotController — Autonomous AI opponent with 3-state decision engine.
 *
 * Wraps a PlayerController and drives it programmatically (no InputManager).
 * Shares the same physics body / AnimationStateMachine pipeline as the player.
 *
 * Performance contract:
 *   - Zero heap allocations in update() — all vectors pre-allocated
 *   - AI decisions at ~5Hz (200ms), movement forces every frame
 *   - Edge avoidance runs every frame (cheap dot product)
 */
export class BotController {
    /**
     * @param {import('./PlayerController.js').PlayerController} controller
     * @param {Object} options
     */
    constructor(controller, options = {}) {
        this.controller = controller;

        // --- AI State ---
        this.aiState = BotState.SEARCHING;
        this.decisionTimer = 0;
        this.decisionInterval = options.decisionInterval || 0.20;

        // --- Tuning (medium-serious difficulty) ---
        this.aggroRange = 12;         // Increased from 6 to detect player sooner
        this.punchRange = 3.0;        // Increased from 2.2 to hit more reliably
        this.facingThreshold = 0.4;   // Relaxed from 0.6 to attack faster
        this.moveForce = 75;
        this.defensiveHealthThreshold = 35;
        this.platformRadius = options.platformRadius || 25;
        this.edgeAvoidanceRatio = 0.75;

        // --- Attack ---
        this.attackCooldown = 0;
        this.attackCooldownTime = 0.7;

        // --- Score ---
        this.orbsCollected = 0;

        // --- Pre-allocated vectors (zero GC) ---
        this._forceVec = new CANNON.Vec3();
        this._cachedMoveDir = new THREE.Vector3();
        this._tempVec = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._wanderTarget = new THREE.Vector3();
        this._wanderTimer = 5; // force immediate wander target
        this._shouldAttack = false;

        // --- Jump logic ---
        this._shouldJump = false;
        this.jumpTimer = 0;
        this.jumpInterval = 3 + Math.random() * 4; // Jump every 3-7 seconds

        // --- Pause ---
        this.paused = false;
    }

    /** Freeze / unfreeze the bot. When paused, all AI and movement stops. */
    setPaused(val) {
        this.paused = !!val;
        if (this.paused) {
            // Kill momentum so bot doesn't slide while frozen
            this.controller.body.velocity.x = 0;
            this.controller.body.velocity.z = 0;
            this._cachedMoveDir.set(0, 0, 0);
            if (!this.controller.animStateMachine.isLocked) {
                this.controller.animStateMachine.setState(AnimState.IDLE);
            }
        }
    }

    /**
     * Called every frame from GameManager.
     * @param {number} dt
     * @param {import('./PlayerController.js').PlayerController} playerCtrl
     * @param {import('./CollectibleOrb.js').CollectibleOrb|null} currentOrb
     */
    update(dt, playerCtrl, currentOrb) {
        if (!this.controller.isAlive) return;
        if (this.paused) return;

        this.attackCooldown = Math.max(0, this.attackCooldown - dt);

        // Throttled AI decision
        this.decisionTimer += dt;
        if (this.decisionTimer >= this.decisionInterval) {
            this.decisionTimer = 0;
            this._makeDecision(playerCtrl, currentOrb);
        }

        // Apply cached decision every frame
        this._executeMovement(dt);
        this._executeAttack();
        this._applyEdgeAvoidance();

        // Update jump timer
        this.jumpTimer += dt;
        if (this.jumpTimer >= this.jumpInterval) {
            this.jumpTimer = 0;
            this.jumpInterval = 3 + Math.random() * 4;
            this._shouldJump = true;
        }
    }

    // ─── DECISION PHASE (runs at ~5Hz) ───────────────────────

    /** @private */
    _makeDecision(playerCtrl, currentOrb) {
        const botPos = this.controller.model.position;
        const playerPos = playerCtrl.model.position;

        const dx = playerPos.x - botPos.x;
        const dz = playerPos.z - botPos.z;
        const distToPlayer = Math.sqrt(dx * dx + dz * dz);

        const healthPercent = Math.max(0, 100 - this.controller.damagePercent);

        // --- State transitions ---
        if (currentOrb) {
            // Orb exists: Chase orb UNLESS player is in immediate threat range (5 units)
            if (distToPlayer < 5) {
                this.aiState = BotState.AGGRESSIVE;
            } else {
                this.aiState = BotState.SEARCHING; // Chase orb
            }
        } else {
            // No orb: Focus on combat or exploration
            if (healthPercent < this.defensiveHealthThreshold && distToPlayer < this.aggroRange) {
                this.aiState = BotState.DEFENSIVE;
            } else if (distToPlayer < this.aggroRange) {
                this.aiState = BotState.AGGRESSIVE;
            } else {
                this.aiState = BotState.SEARCHING; // Wander
            }
        }

        this._shouldAttack = false;

        switch (this.aiState) {
            case BotState.SEARCHING:
                this._planSearching(currentOrb);
                break;
            case BotState.AGGRESSIVE:
                this._planAggressive(playerCtrl, distToPlayer);
                break;
            case BotState.DEFENSIVE:
                this._planDefensive(playerCtrl, currentOrb, distToPlayer);
                break;
        }
    }

    /** @private — Find nearest orb or wander */
    _planSearching(currentOrb) {
        const botPos = this.controller.model.position;

        if (currentOrb) {
            const orbPos = currentOrb.group.position;
            this._cachedMoveDir.set(orbPos.x - botPos.x, 0, orbPos.z - botPos.z);
            const len = this._cachedMoveDir.length();
            if (len > 0.1) this._cachedMoveDir.divideScalar(len);
        } else {
            this._wanderTimer += this.decisionInterval;
            if (this._wanderTimer > 1.5) { // Faster wander target updates
                this._wanderTimer = 0;
                const angle = Math.random() * Math.PI * 2;
                // Wander across most of the platform (80% radius)
                const r = Math.random() * this.platformRadius * 0.8;
                this._wanderTarget.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
            }
            this._cachedMoveDir.set(
                this._wanderTarget.x - botPos.x, 0,
                this._wanderTarget.z - botPos.z
            );
            const len = this._cachedMoveDir.length();
            if (len > 0.1) this._cachedMoveDir.divideScalar(len);
        }
    }

    /**
     * @private — Chase player, position for ring-out knockback.
     * Strategy: position between player and island center so punch
     * sends player OUTWARD toward the edge.
     */
    _planAggressive(playerCtrl, distToPlayer) {
        const botPos = this.controller.model.position;
        const playerPos = playerCtrl.model.position;

        if (distToPlayer < this.punchRange) {
            // Face player directly
            this._cachedMoveDir.set(playerPos.x - botPos.x, 0, playerPos.z - botPos.z);
            const len = this._cachedMoveDir.length();
            if (len > 0.01) this._cachedMoveDir.divideScalar(len);

            if (this.attackCooldown <= 0 && this._isFacing(playerPos)) {
                this._shouldAttack = true;
            }
        } else {
            // Strategic: ideal position is between center and player
            // playerToCenter direction
            const pcLen = Math.sqrt(playerPos.x * playerPos.x + playerPos.z * playerPos.z);
            const pcX = pcLen > 0.01 ? playerPos.x / pcLen : 0;
            const pcZ = pcLen > 0.01 ? playerPos.z / pcLen : 0;

            // Ideal spot: 1.5 units "behind" the player (toward center)
            const idealX = playerPos.x - pcX * 1.5;
            const idealZ = playerPos.z - pcZ * 1.5;

            this._cachedMoveDir.set(idealX - botPos.x, 0, idealZ - botPos.z);
            const len = this._cachedMoveDir.length();
            if (len > 0.1) this._cachedMoveDir.divideScalar(len);
        }
    }

    /** @private — Low health: grab orbs or flee */
    _planDefensive(playerCtrl, currentOrb, distToPlayer) {
        const botPos = this.controller.model.position;
        const playerPos = playerCtrl.model.position;

        if (currentOrb && distToPlayer > this.aggroRange * 0.6) {
            // Safe to go for orb
            const orbPos = currentOrb.group.position;
            this._cachedMoveDir.set(orbPos.x - botPos.x, 0, orbPos.z - botPos.z);
        } else {
            // Flee: 60% away from player + 40% toward center
            this._cachedMoveDir.set(
                (botPos.x - playerPos.x) * 0.6 + (-botPos.x) * 0.4,
                0,
                (botPos.z - playerPos.z) * 0.6 + (-botPos.z) * 0.4
            );
        }
        const len = this._cachedMoveDir.length();
        if (len > 0.01) this._cachedMoveDir.divideScalar(len);
    }

    // ─── EXECUTION PHASE (runs every frame) ──────────────────

    /** @private */
    _executeMovement(_dt) {
        if (this._cachedMoveDir.lengthSq() < 0.001) {
            // No movement — idle
            if (!this.controller.animStateMachine.isLocked) {
                const isGrounded = Math.abs(this.controller.body.velocity.y) < 0.5;
                if (isGrounded) {
                    this.controller.animStateMachine.setState(AnimState.IDLE);
                    // Friction when stopped
                    this.controller.body.velocity.x *= 0.85;
                    this.controller.body.velocity.z *= 0.85;
                }
            }
            return;
        }

        const body = this.controller.body;
        const isGrounded = Math.abs(body.velocity.y) < 0.5;

        if (isGrounded && !this.controller.animStateMachine.isLocked) {
            this._forceVec.set(
                this._cachedMoveDir.x * this.moveForce,
                0,
                this._cachedMoveDir.z * this.moveForce
            );
            body.applyForce(this._forceVec);

            // Clamp velocity
            this.controller.clampHorizontalVelocity();

            // Rotate model to face movement direction
            this.controller.model.rotation.y = Math.atan2(
                this._cachedMoveDir.x,
                this._cachedMoveDir.z
            );

            // Handle jumping
            if (this._shouldJump && isGrounded && !this.controller.animStateMachine.isLocked) {
                this.controller.body.velocity.y = 8;
                this.controller.animStateMachine.setState(AnimState.JUMP);
                this._shouldJump = false;
            }

            this.controller.animStateMachine.setState(AnimState.RUN);
        }
    }

    /** @private */
    _executeAttack() {
        if (!this._shouldAttack) return;
        if (this.controller.animStateMachine.isLocked) return;

        // Choose attack based on class
        const attackAnim = (this.controller.characterClass === 'warrior' || this.controller.characterClass === 'paladin')
            ? AnimState.SWORD_ATTACK
            : AnimState.PUNCH;

        this.controller.startAttack(attackAnim);
        this.attackCooldown = this.attackCooldownTime;
        this._shouldAttack = false;
    }

    /** @private — Prevent bot from walking off the island */
    _applyEdgeAvoidance() {
        // Respect stun/hit animations — if locked, bot can't resist falling
        if (this.controller.animStateMachine.isLocked) return;

        const pos = this.controller.model.position;
        const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        const threshold = this.platformRadius * this.edgeAvoidanceRatio;

        if (distFromCenter > threshold) {
            const strength = (distFromCenter - threshold) / (this.platformRadius - threshold);
            const invLen = 1 / Math.max(distFromCenter, 0.01);

            this._forceVec.set(
                -pos.x * invLen * this.moveForce * strength * 1.5, // Reduced from 2.5
                0,
                -pos.z * invLen * this.moveForce * strength * 1.5
            );
            this.controller.body.applyForce(this._forceVec);
        }
    }
    // ─── HELPERS ─────────────────────────────────────────────

    /** @private — Dot-product facing check (no allocation) */
    _isFacing(targetPos) {
        const botPos = this.controller.model.position;
        const rot = this.controller.model.rotation.y;

        // Direction to target
        this._tempVec.set(targetPos.x - botPos.x, 0, targetPos.z - botPos.z);
        const len = this._tempVec.length();
        if (len < 0.01) return true;
        this._tempVec.divideScalar(len);

        // Bot's forward vector from euler Y rotation
        this._forward.set(Math.sin(rot), 0, Math.cos(rot));

        return this._tempVec.dot(this._forward) > this.facingThreshold;
    }

    dispose() {
        // No event listeners to clean up — bot is purely polling-based
    }
}
