import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationStateMachine, AnimState } from './AnimationStateMachine.js';

/**
 * RemotePlayerController — Manages a remote player's visual representation.
 *
 * Unlike PlayerController, this has:
 *   - NO physics body (server is authoritative)
 *   - NO InputManager (inputs come from the network)
 *   - Smooth position/rotation lerping from entity interpolation data
 *   - AnimationStateMachine driven by server-provided animation state strings
 *
 * The NetworkManager provides interpolated {x, y, z, rotY, anim, hp, alive}
 * and this controller applies them to the Three.js model each frame.
 */
export class RemotePlayerController {
    /**
     * @param {string} playerId - Socket.io ID of the remote player
     * @param {string} characterClass - Character ID (warrior, wizard, etc.)
     * @param {string} playerName - Display name
     * @param {THREE.Scene} scene - The Three.js scene to add the model to
     */
    constructor(playerId, characterClass, playerName, scene) {
        this.playerId = playerId;
        this.characterClass = characterClass;
        this.playerName = playerName;
        this.scene = scene;

        /** @type {THREE.Object3D|null} */
        this.model = null;

        /** @type {AnimationStateMachine|null} */
        this.animStateMachine = null;

        /** @type {THREE.AnimationMixer|null} */
        this.mixer = null;

        /** @type {boolean} */
        this.isLoaded = false;

        /** @type {boolean} */
        this.isAlive = true;

        /** @type {number} */
        this.health = 100;

        /** @type {string} Current animation state from server */
        this._currentAnim = 'idle';

        // Smoothing: we lerp the model toward the target position
        // to smooth out any jitter from interpolation
        this._targetPosition = new THREE.Vector3(0, 0, 0);
        this._targetRotationY = 0;

        /** @type {number} Smoothing factor for position (higher = snappier) */
        this._positionLerpSpeed = 12;

        /** @type {number} Smoothing factor for rotation */
        this._rotationLerpSpeed = 10;

        // Name label (3D floating text — optional, can be added later)
        this._nameSprite = null;
    }

    /**
     * Loads the character model and initializes the animation state machine.
     * @param {THREE.Vector3} [initialPosition] - Optional spawn position
     * @returns {Promise<void>}
     */
    async load(initialPosition) {
        const modelName = this.characterClass.charAt(0).toUpperCase() + this.characterClass.slice(1);

        const gltfLoader = new GLTFLoader();

        const gltf = await new Promise((resolve, reject) => {
            gltfLoader.load(
                `/models/characters/${modelName}.gltf`,
                resolve,
                undefined,
                reject
            );
        });

        const { scene: model, animations = [] } = gltf;

        // Configure shadows
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Set initial position
        if (initialPosition) {
            model.position.copy(initialPosition);
            this._targetPosition.copy(initialPosition);
        }

        this.scene.add(model);
        this.model = model;

        // Animation
        this.mixer = new THREE.AnimationMixer(model);
        this.animStateMachine = new AnimationStateMachine(this.mixer, animations);

        this.isLoaded = true;

        console.log(`🌐 Remote player loaded: ${this.playerName} (${modelName})`);
    }

    /**
     * Updates the remote player's visual state.
     * Called every frame from GameManager.
     *
     * @param {number} dt - Frame delta in seconds
     * @param {Object|null} interpolatedState - From NetworkManager
     */
    update(dt, interpolatedState) {
        if (!this.isLoaded || !this.model) return;

        // Update animation mixer
        if (this.animStateMachine) {
            this.animStateMachine.update(dt);
        }

        if (!interpolatedState) return;

        // Update target from interpolated data
        this._targetPosition.set(interpolatedState.x, interpolatedState.y, interpolatedState.z);
        this._targetRotationY = interpolatedState.rotY;
        this.health = interpolatedState.hp;
        this.isAlive = interpolatedState.alive;

        // Smooth position lerp
        const posLerp = Math.min(this._positionLerpSpeed * dt, 1.0);
        this.model.position.lerp(this._targetPosition, posLerp);

        // Smooth rotation lerp (shortest path)
        let rotDiff = this._targetRotationY - this.model.rotation.y;
        if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        const rotLerp = Math.min(this._rotationLerpSpeed * dt, 1.0);
        this.model.rotation.y += rotDiff * rotLerp;

        // Update animation state (only change if different)
        if (interpolatedState.anim && interpolatedState.anim !== this._currentAnim) {
            this._currentAnim = interpolatedState.anim;
            if (this.animStateMachine) {
                // Map server anim string to AnimState
                this.animStateMachine.forceUnlock();
                this.animStateMachine.setState(interpolatedState.anim);
            }
        }
    }

    /**
     * Teleports the remote player to a position (no lerp).
     * Used for respawn.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    teleport(x, y, z) {
        if (this.model) {
            this.model.position.set(x, y, z);
        }
        this._targetPosition.set(x, y, z);
    }

    /**
     * Removes the model from the scene and cleans up resources.
     */
    dispose() {
        if (this.animStateMachine) {
            this.animStateMachine.dispose();
            this.animStateMachine = null;
        }
        if (this.mixer) {
            this.mixer = null;
        }
        if (this.model) {
            this.scene.remove(this.model);
            // Dispose geometry and materials
            this.model.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        const mats = Array.isArray(child.material)
                            ? child.material
                            : [child.material];
                        mats.forEach((m) => {
                            for (const key of Object.keys(m)) {
                                const val = m[key];
                                if (val && typeof val.dispose === 'function') {
                                    val.dispose();
                                }
                            }
                            m.dispose();
                        });
                    }
                }
            });
            this.model = null;
        }
        if (this._nameSprite) {
            this.scene.remove(this._nameSprite);
            this._nameSprite = null;
        }
        this.isLoaded = false;
        console.log(`🌐 Remote player disposed: ${this.playerName}`);
    }
}
