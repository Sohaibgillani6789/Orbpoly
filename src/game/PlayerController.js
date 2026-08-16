import * as CANNON from 'cannon-es';
import { AnimState } from './AnimationStateMachine.js';

/**
 * PlayerController — Bridges input, physics, and visuals for a single character.
 * 
 * Split into three phases for correct physics update ordering:
 *   1. processInput()  — reads keys, applies forces to physics body
 *   2. [physics world steps externally]
 *   3. syncModel()     — copies physics position → Three.js model
 */
export class PlayerController {
    /**
     * @param {THREE.Object3D} model - The character's 3D model (GLTF scene)
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     * @param {import('./AnimationStateMachine.js').AnimationStateMachine} animStateMachine
     * @param {Object} options
     * @param {boolean} options.isLocalPlayer - Whether this player is keyboard-controlled
     * @param {number} options.lives - Starting lives (default: 3)
     * @param {number} options.moveForce - Force applied per frame when moving (default: 220)
     * @param {number} options.maxVelocity - Horizontal speed cap (default: 28)
     * @param {number} options.sphereRadius - Physics collider radius (default: 0.5)
     */
    constructor(model, physicsWorld, animStateMachine, options = {}) {
        /** @type {THREE.Object3D} */
        this.model = model;

        /** @type {import('./PhysicsWorld.js').PhysicsWorld} */
        this.physicsWorld = physicsWorld;

        /** @type {import('./AnimationStateMachine.js').AnimationStateMachine} */
        this.animStateMachine = animStateMachine;

        // --- Player state ---
        this.damagePercent = 0;
        this.isAttacking = false;
        this.lives = options.lives !== undefined ? options.lives : 2;
        this.isAlive = true;
        this.isLocalPlayer = options.isLocalPlayer || false;
        this.characterClass = options.characterClass || 'warrior';

        // --- Movement tuning ---
        this._moveForce = options.moveForce || 80;
        this._maxVelocity = options.maxVelocity || 10;

        /** Computed health = 100 - damagePercent, clamped to [0, 100] */

        // --- Physics body ---
        const sphereRadius = options.sphereRadius || 0.5;
        this.body = new CANNON.Body({
            mass: 1,
            material: physicsWorld.playerMaterial,
            position: new CANNON.Vec3(
                model.position.x,
                model.position.y + sphereRadius,
                model.position.z
            ),
            linearDamping: 0.5,
            angularDamping: 1.0,
            fixedRotation: true
        });
        this.body.addShape(new CANNON.Sphere(sphereRadius));

        // Custom properties for collision identification
        this.body.isPlayer = true;
        this.body.playerController = this;

        physicsWorld.addBody(this.body);

        this._sphereRadius = sphereRadius;
        this._punchTimeout = null;
        this._hitFlashTimeout = null;
        this._onHitCallback = null;
        this._onBargeCallback = null;
        this._onShieldCallback = null;
        this._onShieldEndCallback = null;

        // --- Barge ability ---
        this.bargeCooldown = 0;        // seconds remaining
        this.bargeCooldownMax = 5;     // 5 second recharge
        this.bargeRange = 5;           // affect enemies within 5 units
        this.bargePower = 25;         // impulse strength
        this.bargeLift = 0;            // upward pop (removed)

        // Reusable vectors to avoid per-frame allocation
        this._forceVec = new CANNON.Vec3();
        this._bargeImpulse = new CANNON.Vec3();

        // --- Multiplayer tracking ---
        /** @type {boolean} True if the player jumped this frame (consumed by GameManager for network) */
        this._lastJumped = false;
        /** @type {{x: number, z: number}} Last computed camera-relative movement direction */
        this._lastInputDir = { x: 0, z: 0 };

        // --- Shield ability ---
        this.isShielding = false;
        this.shieldCooldown = 0;
        this.shieldCooldownMax = 5;
        this.shieldTimer = 0;
        this.shieldDuration = 10;
    }

    /**
     * Register a callback fired when this player receives a hit.
     * Signature: () => void
     * Used by GameManager to trigger screen shake / red flash.
     * @param {Function} fn
     */
    setOnHitCallback(fn) {
        this._onHitCallback = fn;
    }

    /**
     * Phase 1: Read input and apply forces to the physics body.
     * Must be called BEFORE physics world.step().
     * 
     * @param {number} dt - Frame delta in seconds
     * @param {import('./InputManager.js').InputManager} inputManager
     * @param {number} cameraYaw - The current yaw of the camera
     */
    processInput(dt, inputManager, cameraYaw = 0) {
        if (!this.isAlive || !this.isLocalPlayer) return;

        // Reset per-frame multiplayer flags
        this._lastJumped = false;
        this._lastInputDir.x = 0;
        this._lastInputDir.z = 0;

        const jumpPressed = inputManager.consumeJump();
        const isGrounded = Math.abs(this.body.velocity.y) < 0.1;

        // --- Barge cooldown tick ---
        if (this.bargeCooldown > 0) {
            this.bargeCooldown = Math.max(0, this.bargeCooldown - dt);
        }

        // --- Barge input (middle click) ---
        if (inputManager.consumeBarge() && this.bargeCooldown <= 0) {
            this.bargeCooldown = this.bargeCooldownMax;
            if (this._onBargeCallback) this._onBargeCallback();
        }

        // --- Shield input (F key) ---
        if (this.shieldCooldown > 0) {
            this.shieldCooldown = Math.max(0, this.shieldCooldown - dt);
        }
        if (this.shieldTimer > 0) {
            this.shieldTimer -= dt;
            if (this.shieldTimer <= 0) {
                this.isShielding = false;
                this.shieldCooldown = this.shieldCooldownMax;
                if (this._onShieldEndCallback) this._onShieldEndCallback();
            }
        }
        if (inputManager.consumeShield() && this.shieldCooldown <= 0 && !this.isShielding) {
            this.isShielding = true;
            this.shieldTimer = this.shieldDuration;
            if (this._onShieldCallback) this._onShieldCallback();
        }

        // --- Attack input ---
        if (this.characterClass === 'ranger') {
            // Check for release first
            if (this.animStateMachine.currentState === AnimState.BOW_DRAW && inputManager.consumePrimaryRelease()) {
                this.startAttack(AnimState.BOW_SHOOT);
            } else if (!this.animStateMachine.isLocked) {
                if (inputManager.consumePrimaryAttack()) {
                    this.startAttack(AnimState.BOW_DRAW);
                } else if (inputManager.consumeSecondaryAttack()) {
                    this.startAttack(AnimState.PUNCH);
                }
            }
        } else if (this.characterClass === 'cleric') {
            if (!this.animStateMachine.isLocked) {
                if (inputManager.consumePrimaryAttack()) {
                    this.startAttack(AnimState.STAFF_ATTACK);
                } else if (inputManager.consumeSecondaryAttack()) {
                    this.startAttack(AnimState.PUNCH);
                }
            }
        } else {
            if (inputManager.consumeDoubleAttack()) {
                this.startAttack(AnimState.SWORD_ATTACK_2);
            } else if (!this.animStateMachine.isLocked) {
                if (inputManager.consumePrimaryAttack()) {
                    this.startAttack(AnimState.SWORD_ATTACK);
                } else if (inputManager.consumeSecondaryAttack()) {
                    this.startAttack(AnimState.PUNCH);
                }
            }
        }

        const isAttacking = this.animStateMachine.currentState === AnimState.SWORD_ATTACK ||
            this.animStateMachine.currentState === AnimState.SWORD_ATTACK_2 ||
            this.animStateMachine.currentState === AnimState.PUNCH ||
            this.animStateMachine.currentState === AnimState.STAFF_ATTACK;

        // --- Movement (allow input while attacking at reduced speed) ---
        if (!this.animStateMachine.isLocked || isAttacking) {
            if (jumpPressed && isGrounded && !this.animStateMachine.isLocked) {
                this.body.velocity.y = 8; // Jump velocity
                this.animStateMachine.setState(AnimState.JUMP);
                this._lastJumped = true; // Track for network
            }

            const move = inputManager.getMovementVector();
            const isMoving = move.x !== 0 || move.z !== 0;

            if (isMoving) {
                // Rotate movement vector by camera yaw
                const angle = Math.atan2(move.x, move.z) + cameraYaw;
                const dirX = Math.sin(angle);
                const dirZ = Math.cos(angle);

                // Apply force (reduce speed while attacking)
                if (isGrounded) {
                    const currentForce = isAttacking ? this._moveForce * 0.4 : this._moveForce;
                    this._forceVec.set(dirX * currentForce, 0, dirZ * currentForce);
                    this.body.applyForce(this._forceVec);
                }

                this.clampHorizontalVelocity();

                // Rotate model
                if (isGrounded) {
                    this.model.rotation.y = angle;
                }

                // Track for network
                this._lastInputDir.x = dirX;
                this._lastInputDir.z = dirZ;

                // Only switch to RUN animation if not currently playing a locked animation (like attack)
                if (isGrounded && !jumpPressed && !this.animStateMachine.isLocked) {
                    this.animStateMachine.setState(AnimState.RUN);
                } else if (!isGrounded && this.body.velocity.y <= 0.1 && !this.animStateMachine.isLocked) {
                    this.animStateMachine.setState(AnimState.FALLING);
                }
            } else {
                // Apply manual ground friction
                if (isGrounded) {
                    this.body.velocity.x *= 0.8;
                    this.body.velocity.z *= 0.8;
                }

                if (isGrounded && !jumpPressed && !this.animStateMachine.isLocked) {
                    this.animStateMachine.setState(AnimState.IDLE);
                } else if (!isGrounded && this.body.velocity.y <= 0.1 && !this.animStateMachine.isLocked) {
                    this.animStateMachine.setState(AnimState.FALLING);
                }
            }
        }
    }


    /**
     * Phase 2: Sync the 3D model position to the physics body.
     * Must be called AFTER physics world.step().
     * 
     * @param {number} dt - Frame delta in seconds
     */
    syncModel(dt) {
        // Always update animation mixer — death animation must tick even after isAlive=false.
        // Without this, die() triggers DEATH state but mixer never advances → frozen pose.
        this.animStateMachine.update(dt);

        if (!this.isAlive) return;

        // Copy physics body position → Three.js model
        this.model.position.set(
            this.body.position.x,
            this.body.position.y - this._sphereRadius,
            this.body.position.z
        );
    }

    // ─── MULTIPLAYER RECONCILIATION ───────────────────

    /**
     * Applies authoritative server state to the local player's physics body.
     * Called during reconciliation when a server snapshot arrives.
     *
     * Uses a three-tier blending strategy:
     *   1. Dead zone (error < 0.05 units): ignore — sub-pixel noise, not worth touching.
     *   2. Smooth blend (0.05 ≤ error < 3.0 units): exponential lerp toward server.
     *      The blend rate scales with error magnitude so small drifts correct
     *      slowly (invisible to the player) and medium errors correct within ~200ms.
     *   3. Hard snap (error ≥ 3.0 units): teleport immediately — likely a respawn,
     *      ring-out reset, or severe desync that can't be smoothed visually.
     *
     * This replaces the old binary threshold approach which caused visible jitter
     * on every correction frame.
     *
     * @param {Object} serverState - { x, y, z, rotY, hp, alive }
     */
    applyServerState(serverState) {
        if (!serverState) return;

        // Server sends model-space Y; physics body Y = model Y + sphereRadius
        const serverBodyY = serverState.y + this._sphereRadius;

        const dx = serverState.x - this.body.position.x;
        const dy = serverBodyY - this.body.position.y;
        const dz = serverState.z - this.body.position.z;
        const errorSq = dx * dx + dy * dy + dz * dz;

        // Tier 1: Dead zone — sub-pixel noise, skip entirely
        const DEAD_ZONE_SQ = 0.0025; // 0.05^2
        // Tier 3: Hard snap threshold — teleport events
        const SNAP_THRESHOLD_SQ = 9.0; // 3.0^2

        if (errorSq > DEAD_ZONE_SQ) {
            if (errorSq >= SNAP_THRESHOLD_SQ) {
                // Tier 3: Hard snap — too far to blend smoothly
                this.body.position.x = serverState.x;
                this.body.position.y = serverBodyY;
                this.body.position.z = serverState.z;
            } else {
                // Tier 2: Smooth exponential blend
                // Blend rate scales with error: tiny drift → slow, visible drift → fast
                // At error=0.5 → t≈0.15 (smooth), at error=2.0 → t≈0.45 (snappy)
                const error = Math.sqrt(errorSq);
                const t = Math.min(0.1 + error * 0.18, 0.5);

                this.body.position.x += dx * t;
                this.body.position.y += dy * t;
                this.body.position.z += dz * t;
            }
        }

        // Update health from server (always authoritative)
        if (serverState.hp !== undefined) {
            this.health = serverState.hp;
            this.damagePercent = Math.max(0, 100 - serverState.hp);
        }
    }

    /**
     * Returns health as 100 - damagePercent, clamped to [0, 100].
     * @returns {number}
     */
    get health() {
        return Math.max(0, Math.min(100, 100 - this.damagePercent));
    }

    /**
     * Clamps horizontal velocity to maxVelocity while preserving vertical velocity.
     */
    clampHorizontalVelocity() {
        const vel = this.body.velocity;
        const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

        if (horizontalSpeed > this._maxVelocity) {
            const scale = this._maxVelocity / horizontalSpeed;
            vel.x *= scale;
            vel.z *= scale;
        }
    }

    /**
     * Initiates an attack: sets isAttacking flag, plays attack animation,
     * and auto-clears the flag after 500ms (the hitbox window).
     */
    startAttack(animState) {
        this.isAttacking = true;
        this.animStateMachine.setState(animState);

        if (this._punchTimeout) clearTimeout(this._punchTimeout);
        this._punchTimeout = setTimeout(() => {
            this.isAttacking = false;
        }, 500);
    }

    /**
     * Called by CombatSystem when this player is hit.
     * Guarantees visual feedback even if RECEIVE_HIT clip is missing.
     * @param {CANNON.Vec3} knockbackImpulse
     */
    receiveHit(knockbackImpulse) {
        // Force-unlock so RECEIVE_HIT can always interrupt (even mid-punch)
        this.animStateMachine.forceUnlock();
        this.animStateMachine.setState(AnimState.RECEIVE_HIT);
        this.body.applyImpulse(knockbackImpulse);

        // Emissive red flash on all meshes — works even without RECEIVE_HIT clip
        this._flashModel();

        // Fire callback so GameManager can add camera shake / vignette
        if (this._onHitCallback) this._onHitCallback();
    }

    /**
     * Helper to cache and return all emissive materials on the character model.
     * @private
     * @returns {THREE.Material[]}
     */
    _getMeshMaterials() {
        if (!this._cachedMaterials) {
            this._cachedMaterials = [];
            this.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => {
                        if (m.emissive !== undefined) {
                            m._origEmissive = m._origEmissive || { r: m.emissive.r, g: m.emissive.g, b: m.emissive.b };
                            m._origEmissiveIntensity = m._origEmissiveIntensity ?? m.emissiveIntensity;
                            this._cachedMaterials.push(m);
                        }
                    });
                }
            });
        }
        return this._cachedMaterials;
    }

    /**
     * Briefly sets emissive to red on all child meshes, then reverts.
     * Creates a visible "damage flash" regardless of animation state.
     * @private
     */
    _flashModel() {
        if (this._hitFlashTimeout) {
            clearTimeout(this._hitFlashTimeout);
            this._hitFlashTimeout = null;
        }

        const mats = this._getMeshMaterials();
        for (let i = 0; i < mats.length; i++) {
            const m = mats[i];
            m.emissive.setRGB(1, 0, 0);
            m.emissiveIntensity = 2.5;
        }

        // Revert after 220ms
        this._hitFlashTimeout = setTimeout(() => {
            const matsToRevert = this._getMeshMaterials();
            for (let i = 0; i < matsToRevert.length; i++) {
                const m = matsToRevert[i];
                if (m._origEmissive) {
                    m.emissive.setRGB(m._origEmissive.r, m._origEmissive.g, m._origEmissive.b);
                    m.emissiveIntensity = m._origEmissiveIntensity ?? 0;
                }
            }
            this._hitFlashTimeout = null;
        }, 220);
    }

    /** Kills the player — plays death animation. Lives decrement is handled by GameManager. */
    die() {
        this.isAlive = false;
        this.isAttacking = false;
        this.isShielding = false;
        this.shieldTimer = 0;
        if (this._punchTimeout) clearTimeout(this._punchTimeout);
        if (this._hitFlashTimeout) {
            clearTimeout(this._hitFlashTimeout);
            // Revert any emissive flash so death pose looks correct
            const mats = this._getMeshMaterials();
            for (let i = 0; i < mats.length; i++) {
                const m = mats[i];
                if (m._origEmissive) {
                    m.emissive.setRGB(m._origEmissive.r, m._origEmissive.g, m._origEmissive.b);
                    m.emissiveIntensity = m._origEmissiveIntensity ?? 0;
                }
            }
            this._hitFlashTimeout = null;
        }
        this.animStateMachine.forceUnlock();
        this.animStateMachine.setState(AnimState.DEATH);
    }

    /**
     * Respawns the player at a given position, preserving health from before the fall.
     * @param {{ x: number, y: number, z: number }} position
     * @param {number} [savedDamage=0] - damagePercent to restore (pre-fall value)
     */
    respawn(position, savedDamage = 0) {
        this.isAlive = true;
        this.damagePercent = savedDamage; // preserve health, not reset to full
        this.isAttacking = false;

        this.body.position.set(position.x, position.y + this._sphereRadius, position.z);
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
        this.body.force.set(0, 0, 0);

        // Face towards the center of the arena
        const angleToCenter = Math.atan2(-position.x, -position.z);
        this.model.rotation.set(0, angleToCenter, 0);

        this.animStateMachine.forceUnlock();
        this.animStateMachine.setState(AnimState.IDLE);
    }

    dispose() {
        if (this._punchTimeout) clearTimeout(this._punchTimeout);
        if (this._hitFlashTimeout) clearTimeout(this._hitFlashTimeout);
        this.physicsWorld.removeBody(this.body);
    }
}
