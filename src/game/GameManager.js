import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld.js';
import { InputManager } from './InputManager.js';
import { PlayerController } from './PlayerController.js';
import { AnimationStateMachine } from './AnimationStateMachine.js';
import { CombatSystem } from './CombatSystem.js';
import { CollectibleOrb } from './CollectibleOrb.js';
import { BotController } from './BotController.js';
import { ShieldEffect } from './ShieldEffect.js';
import { RemotePlayerController } from './RemotePlayerController.js';

/**
 * Game state enum.
 */
export const GameState = Object.freeze({
    WAITING: 'waiting',
    PLAYING: 'playing',
    ROUND_END: 'round_end',
    GAME_OVER: 'game_over'
});

/**
 * GameManager — Central orchestrator for the Sumo Sky game.
 * 
 * Update loop follows correct physics ordering:
 *   1. Process input → apply forces
 *   2. Step physics simulation
 *   3. Sync model positions from physics bodies
 *   4. Check win conditions
 */
export class GameManager {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {Object} options
     */
    constructor(scene, camera, options = {}) {
        this.scene = scene;
        this.camera = camera;
        this.state = GameState.WAITING;
        this.platformRadius = options.platformRadius || 25;

        // --- Subsystems ---
        this.physicsWorld = new PhysicsWorld({
            platformRadius: this.platformRadius
        });

        this.inputManager = new InputManager();
        this.inputManager.enabled = false;

        this.combatSystem = new CombatSystem();

        // --- Players ---
        this.players = [];
        this.localPlayer = null;

        // --- Bot ---
        this.botPlayer = null;
        this.botController = null;
        this.botScore = 0;

        // --- Multiplayer ---
        /** @type {import('./NetworkManager.js').NetworkManager|null} */
        this.networkManager = null;
        /** @type {Map<string, RemotePlayerController>} socketId → RemotePlayerController */
        this.remotePlayers = new Map();
        /** @type {boolean} True when in multiplayer mode */
        this.isMultiplayer = false;

        // --- Camera state ---
        this.cameraYaw = 0;

        // --- Config ---
        this._ringOutY = options.ringOutY !== undefined ? options.ringOutY : -50;
        this._respawnDelay = options.respawnDelay || 3000;
        
        // --- Orb Collection ---
        this.playerScore = 0;
        this.currentOrb = null;
        this.orbSpawnTimer = 0;
        this.orbSpawnInterval = 10; // seconds
        this.winScore = 5;

        // --- Rock1 spawn positions (set externally via setRock1Positions) ---
        this.rock1Positions = [];

        // --- Camera shake ---
        this._shakeTimer = 0;
        this._shakeDuration = 0;
        this._shakeIntensity = 0;

        // --- Barge Visuals (3D) ---
        this._bargeGroup = this._initBargeVisuals();
        this._bargeTimer = 0;
        this._bargeDuration = 0.6;

        // --- Shield Visuals (3D) ---
        this._shieldEffect = new ShieldEffect(this.scene);

        // --- Hit Sparks (Object Pool) ---
        this._hitSparks = [];
        this._activeHitSparks = [];
        this._initHitSparks(5); // Pool of 5 hit sparks

        // --- Combat System Hooks ---
        this.combatSystem.onHit((data) => {
            const { attacker, victim } = data;
            // Calculate flat direction from attacker to victim
            const dir = new CANNON.Vec3(
                victim.body.position.x - attacker.body.position.x,
                0,
                victim.body.position.z - attacker.body.position.z
            );
            if (dir.length() > 0.001) {
                dir.normalize();
            } else {
                dir.set(0, 0, 1);
            }
            // Trigger 3D stylized hit spark
            this.triggerHitSpark(victim.model, dir);
        });
    }

    /**
     * Creates the dynamic 2-part shockwave for the Barge ability.
     * @private
     */
    _initBargeVisuals() {
        const group = new THREE.Group();
        group.visible = false;

        // 1. Expanding ground ring (Thin, sharp shockwave ring)
        // Using 0.9 as inner radius makes it a much thinner ring
        const ringGeo = new THREE.RingGeometry(0.9, 1, 64);
        const ringMat = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0x88ccff) }, // Light blue energy color
                uProgress: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float uProgress;
                varying vec2 vUv;
                
                // Classic 2D noise
                float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
                float noise(vec2 p){
                    vec2 ip = floor(p); vec2 u = fract(p); u = u*u*(3.0-2.0*u);
                    float res = mix(
                        mix(rand(ip),rand(ip+vec2(1.0,0.0)),u.x),
                        mix(rand(ip+vec2(0.0,1.0)),rand(ip+vec2(1.0,1.0)),u.x),u.y);
                    return res*res;
                }

                void main() {
                    // vUv.x represents radius (0.0 inner, 1.0 outer)
                    // Twist the boundaries slightly for a dynamic, non-perfect ring
                    float twist = noise(vec2(vUv.y * 20.0, uProgress * 10.0)) * 0.2;
                    
                    // Create a sharp, thin peak in the middle of the narrow geometry
                    float intensity = smoothstep(0.0, 0.5 + twist, vUv.x) * smoothstep(1.0, 0.5 - twist, vUv.x);
                    
                    // Fast fade out
                    float fade = 1.0 - uProgress;
                    float alpha = intensity * fade * 2.0;
                    
                    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2; // Flat on ground
        ringMesh.name = "ring";
        group.add(ringMesh);

        // 2. Central smoky bubble burst
        const bubbleGeo = new THREE.SphereGeometry(1, 32, 16);
        const bubbleMat = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0xffffff) },
                uProgress: { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float uProgress;
                varying vec3 vNormal;
                varying vec3 vPosition;
                
                float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
                float noise(vec2 p){
                    vec2 ip = floor(p); vec2 u = fract(p); u = u*u*(3.0-2.0*u);
                    float res = mix(
                        mix(rand(ip),rand(ip+vec2(1.0,0.0)),u.x),
                        mix(rand(ip+vec2(0.0,1.0)),rand(ip+vec2(1.0,1.0)),u.x),u.y);
                    return res*res;
                }

                void main() {
                    // Larger noise scale and more intense energy
                    float n = noise(vPosition.xy * 5.0 + uProgress * 2.0) * noise(vPosition.yz * 5.0 - uProgress * 1.5);
                    float intensity = smoothstep(0.0, 0.6, n);
                    
                    // Fade out slower so it is visible
                    float fade = smoothstep(0.6, 0.0, uProgress);
                    
                    // Boost the brightness multiplier
                    gl_FragColor = vec4(color, intensity * fade * 1.5);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const bubbleMesh = new THREE.Mesh(bubbleGeo, bubbleMat);
        bubbleMesh.position.y = 0.5; // Lift up a bit
        bubbleMesh.name = "bubble";
        group.add(bubbleMesh);

        this.scene.add(group);
        return group;
    }

    /**
     * Initializes the object pool for AAA Genshin-style hit sparks.
     * @private
     */
    _initHitSparks(poolSize) {
        const geo = new THREE.PlaneGeometry(3, 3);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0.0 }, // 0 to 1
                colorA: { value: new THREE.Color(0xffffff) }, // Hot white core
                colorB: { value: new THREE.Color(0xffcc00) }, // Golden yellow
                colorC: { value: new THREE.Color(0xff3300) }  // Fiery red/orange
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uProgress;
                uniform vec3 colorA;
                uniform vec3 colorB;
                uniform vec3 colorC;
                varying vec2 vUv;

                // Simple 2D rotation for the slash
                mat2 rot(float a) {
                    float s = sin(a), c = cos(a);
                    return mat2(c, -s, s, c);
                }

                void main() {
                    vec2 center = vec2(0.5, 0.5);
                    vec2 p = vUv - center;
                    
                    // Slightly rotate over time for dynamic "whipping" motion
                    p *= rot(uProgress * 1.5);
                    
                    // Distance from center
                    float dist = length(p);
                    
                    // Create an oval/slash shape by squishing the Y axis
                    vec2 squishedP = vec2(p.x * 0.5, p.y * 3.0);
                    float slashDist = length(squishedP);
                    
                    // The core slash shape (gets larger and thinner over time)
                    float slashCore = 1.0 - smoothstep(0.0, 0.2 + (uProgress * 0.3), slashDist);
                    
                    // Cross burst (X / Star shape)
                    float angle = atan(p.y, p.x);
                    // 4-point star burst logic
                    float star = abs(sin(angle * 2.0));
                    float starCore = 1.0 - smoothstep(0.0, 0.1 + dist, star * dist * 3.0);
                    
                    float intensity = max(slashCore, starCore * 0.8) * (1.0 - dist * 2.0);
                    
                    // Fade out fast
                    float alpha = max(0.0, intensity * (1.0 - pow(uProgress, 1.5)) * 3.0);
                    
                    // Color mapping based on intensity
                    vec3 finalColor = mix(colorC, colorB, intensity * 1.5);
                    finalColor = mix(finalColor, colorA, smoothstep(0.7, 1.0, intensity));
                    
                    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });

        for (let i = 0; i < poolSize; i++) {
            const mesh = new THREE.Mesh(geo, mat.clone()); // clone mat so uniforms are independent
            mesh.visible = false;
            // No adding to scene here! We will add to the victim mesh directly.
            this._hitSparks.push(mesh);
        }
    }

    /**
     * Creates and registers a player from loaded GLTF data.
     */
    addPlayer(id, name, model, animationClips, isLocal = false) {
        const mixer = new THREE.AnimationMixer(model);
        const animSM = new AnimationStateMachine(mixer, animationClips);

        const controller = new PlayerController(model, this.physicsWorld, animSM, {
            characterClass: id,
            isLocalPlayer: isLocal,
            lives: 2
        });

        this.combatSystem.registerPlayer(controller);

        // Hook hit feedback for local player only
        if (isLocal) {
            controller.setOnHitCallback(() => {
                this._triggerScreenShake(0.35, 0.25);
                this._triggerVignette();
            });

            // Hook barge ability
            controller._onBargeCallback = () => {
                this._executeBarge(controller);
            };

            // Hook shield ability
            controller._onShieldCallback = () => {
                this._executeShield(controller);
            };
            controller._onShieldEndCallback = () => {
                this._shieldEffect.deactivate();
            };
        }

        const playerData = { id, name, controller, animSM };
        this.players.push(playerData);

        if (isLocal) {
            this.localPlayer = playerData;
        }

        console.log(`🎮 Player added: ${name} (local: ${isLocal})`);
        return playerData;
    }

    /**
     * Triggers camera shake.
     * @param {number} intensity - Max offset in world units
     * @param {number} duration  - Seconds
     * @private
     */
    _triggerScreenShake(intensity, duration) {
        this._shakeIntensity = intensity;
        this._shakeDuration = duration;
        this._shakeTimer = duration;
    }

    /**
     * Flashes the red vignette overlay.
     * @private
     */
    _triggerVignette() {
        const el = document.getElementById('hit-vignette');
        if (!el) return;
        el.classList.remove('flash');
        // Force reflow so the animation restarts
        void el.offsetWidth;
        el.classList.add('flash');
    }

    /**
     * Creates and registers the Bot opponent.
     * @param {string} id - Character class id
     * @param {string} name
     * @param {THREE.Object3D} model
     * @param {THREE.AnimationClip[]} animationClips
     */
    addBot(id, name, model, animationClips) {
        const mixer = new THREE.AnimationMixer(model);
        const animSM = new AnimationStateMachine(mixer, animationClips);

        const controller = new PlayerController(model, this.physicsWorld, animSM, {
            characterClass: id,
            isLocalPlayer: false,
            lives: 2
        });

        // Spawn bot at opposite edge position
        controller.body.position.set(0, 1, -18);
        model.position.set(0, 0, -18);

        this.combatSystem.registerPlayer(controller);

        const botData = { id, name, controller, animSM };
        this.players.push(botData);
        this.botPlayer = botData;

        this.botController = new BotController(controller, {
            platformRadius: this.platformRadius
        });

        console.log(`🤖 Bot added: ${name}`);
        return botData;
    }

    /**
     * Starts the game.
     */
    start() {
        this.state = GameState.PLAYING;
        this.inputManager.enabled = true;
        
        // Spawn first orb immediately (single-player only)
        if (!this.isMultiplayer) {
            this.spawnCollectibleOrb();
        }
        
        // Initialize HUD state
        this._updateHUD();
        this._updateLivesHUD();
        
        console.log(`🎮 Sumo Sky — FIGHT! (${this.isMultiplayer ? 'MULTIPLAYER' : 'SINGLE PLAYER'})`);
    }

    // ─── MULTIPLAYER METHODS ─────────────────────────────

    /**
     * Attaches a NetworkManager for multiplayer mode.
     * @param {import('./NetworkManager.js').NetworkManager} networkManager
     */
    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
        this.isMultiplayer = true;
        
        if (this.localPlayer) {
            this.localPlayer.id = networkManager.playerId;
        }
        
        console.log('🌐 GameManager: Multiplayer mode enabled');
    }

    /**
     * Adds a remote player to the scene.
     * @param {string} playerId - Socket.io ID
     * @param {string} characterClass
     * @param {string} playerName
     * @param {{ x: number, y: number, z: number }} position
     * @returns {Promise<RemotePlayerController>}
     */
    async addRemotePlayer(playerId, characterClass, playerName, position) {
        if (this.remotePlayers.has(playerId)) {
            console.warn(`🌐 Remote player ${playerId} already exists`);
            return this.remotePlayers.get(playerId);
        }

        const remote = new RemotePlayerController(
            playerId, characterClass, playerName, this.scene
        );

        await remote.load(new THREE.Vector3(position.x, position.y, position.z));
        this.remotePlayers.set(playerId, remote);

        console.log(`🌐 Remote player added: ${playerName} (${characterClass})`);
        return remote;
    }

    /**
     * Removes a remote player from the scene.
     * @param {string} playerId
     */
    removeRemotePlayer(playerId) {
        const remote = this.remotePlayers.get(playerId);
        if (!remote) return;

        remote.dispose();
        this.remotePlayers.delete(playerId);
        console.log(`🌐 Remote player removed: ${playerId}`);
    }

    /**
     * Gets a player's mesh by Socket.io ID.
     * @param {string} playerId 
     * @returns {THREE.Object3D|null}
     */
    _getPlayerMeshById(playerId) {
        if (this.localPlayer && this.localPlayer.id === playerId) {
            return this.localPlayer.controller.model;
        }
        const remote = this.remotePlayers.get(playerId);
        if (remote) {
            return remote.model;
        }
        return null;
    }

    /**
     * Handles remote hit events from the server.
     * @param {Object} hitData 
     */
    handleRemoteHit(hitData) {
        const victimMesh = this._getPlayerMeshById(hitData.victimId);
        const attackerMesh = this._getPlayerMeshById(hitData.attackerId);
        
        if (victimMesh && attackerMesh) {
            const dx = victimMesh.position.x - attackerMesh.position.x;
            const dz = victimMesh.position.z - attackerMesh.position.z;
            const impactDir = new CANNON.Vec3(dx, 0, dz);
            
            this.triggerHitSpark(victimMesh, impactDir);
        }
    }

    /**
     * Handles remote respawn events from the server.
     * @param {Object} respawnData 
     */
    handleRemoteRespawn(respawnData) {
        if (this.localPlayer && this.localPlayer.id === respawnData.id) {
            // Respawn local player physically
            this.localPlayer.controller.respawn(respawnData.position, 0);
        } else {
            // Remote players teleport
            const remote = this.remotePlayers.get(respawnData.id);
            if (remote) {
                remote.teleport(respawnData.position.x, respawnData.position.y, respawnData.position.z);
            }
        }
    }

    /**
     * Main update loop. Correct physics ordering:
     *   1. processInput (apply forces)
     *   2. step physics
     *   3. syncModel (read positions)
     * 
     * @param {number} deltaTime - seconds
     */
    update(deltaTime) {
        if (this.state !== GameState.PLAYING) return;

        // Phase 1: Process input → apply forces to physics bodies
        for (const player of this.players) {
            const ctrl = player.controller;
            if (ctrl.isLocalPlayer) {
                ctrl.processInput(deltaTime, this.inputManager, this.cameraYaw);
            }
        }

        // Phase 1a: Send input to server (multiplayer)
        if (this.isMultiplayer && this.networkManager && this.localPlayer) {
            const ctrl = this.localPlayer.controller;
            this.networkManager.sendInput({
                moveX: ctrl._lastInputDir.x,
                moveZ: ctrl._lastInputDir.z,
                jump: ctrl._lastJumped,
                animState: ctrl.animStateMachine ? ctrl.animStateMachine.currentState : 'idle',
            });
        }

        // Phase 1b: Bot AI (single-player only)
        if (!this.isMultiplayer && this.botController && this.localPlayer) {
            this.botController.update(
                deltaTime,
                this.localPlayer.controller,
                this.currentOrb
            );
        }

        // Phase 2: Step physics simulation
        this.physicsWorld.step(deltaTime);

        // Phase 2a: Server reconciliation (multiplayer) — correct local player toward server authority
        if (this.isMultiplayer && this.networkManager && this.localPlayer) {
            const serverState = this.networkManager.getLocalServerState();
            if (serverState) {
                this.localPlayer.controller.applyServerState(serverState);
            }
        }

        // Phase 3: Sync model positions from physics + update animations
        for (const player of this.players) {
            const ctrl = player.controller;
            ctrl.syncModel(deltaTime);

            // Ring-out check — server-authoritative in multiplayer
            if (!this.isMultiplayer) {
                if (ctrl.isAlive && ctrl.body.position.y < this._ringOutY) {
                    this._handleRingOut(player);
                }
                if (ctrl.isAlive && ctrl.health <= 0) {
                    this._handleHealthDeath(player);
                }
            }
        }

        // Phase 4: Collectible Orb Logic
        if (this.state === GameState.PLAYING) {
            this._updateOrb(deltaTime);
        }

        // Phase 5: Hit Sparks (Visuals)
        for (let i = this._activeHitSparks.length - 1; i >= 0; i--) {
            const data = this._activeHitSparks[i];
            data.timer -= deltaTime;
            
            if (data.timer <= 0) {
                // Lifespan ended, return to pool
                data.mesh.visible = false;
                data.mesh.removeFromParent(); // Detach from victim
                this._hitSparks.push(data.mesh);
                this._activeHitSparks.splice(i, 1);
            } else {
                // Progress the shader (0 to 1 over lifespan)
                const t = 1.0 - (data.timer / 0.25);
                data.mesh.material.uniforms.uProgress.value = t;
            }
        }

        // Phase 5: Update HUD
        this._updateHUD();
        this._updateBargeCooldownHUD(deltaTime);

        // Phase 6: Camera shake
        if (this._shakeTimer > 0) {
            this._shakeTimer -= deltaTime;
            const t = this._shakeTimer / this._shakeDuration;
            // Damped sine wave: creates an immersive physical feel instead of jagged randomness
            const decay = t * t; // fades to zero quickly
            const frequency = 40; // speed of the shake
            const waveX = Math.sin(t * frequency) * this._shakeIntensity * decay;
            const waveY = Math.cos(t * frequency * 1.2) * this._shakeIntensity * decay;
            
            this.camera.position.x += waveX;
            this.camera.position.y += waveY;
            if (this._shakeTimer <= 0) this._shakeTimer = 0;
        }

        // Phase 7: Barge 3D visual animation
        if (this._bargeTimer > 0) {
            this._bargeTimer -= deltaTime;
            const t = 1 - (this._bargeTimer / this._bargeDuration);
            
            // Expand rapidly and fade rim
            const easeOutCubic = 1 - Math.pow(1 - t, 3);
            const ringScale = 0.1 + easeOutCubic * 12; // Ring goes far
            const bubbleScale = 0.1 + (1 - Math.pow(1 - t, 5)) * 6; // Bubble burst is larger now
            
            const ring = this._bargeGroup.getObjectByName("ring");
            if (ring) {
                ring.scale.set(ringScale, ringScale, ringScale);
                ring.material.uniforms.uProgress.value = t;
            }
            
            const bubble = this._bargeGroup.getObjectByName("bubble");
            if (bubble) {
                bubble.scale.set(bubbleScale, bubbleScale, bubbleScale);
                bubble.material.uniforms.uProgress.value = t;
            }
            
            if (this._bargeTimer <= 0) {
                this._bargeGroup.visible = false;
            }
        }

        // Phase 8: Shield VFX animation
        if (this._shieldEffect.isActive && this.localPlayer) {
            const ctrl = this.localPlayer.controller;
            this._shieldEffect.update(
                deltaTime,
                ctrl.model.position,
                ctrl.model.rotation.y
            );
        }

        // Phase 9: Multiplayer — update remote players from interpolation
        if (this.isMultiplayer && this.networkManager) {
            this.networkManager.updateInterpolation(deltaTime);
            const remoteStates = this.networkManager.getRemoteStates();
            for (const [playerId, state] of remoteStates) {
                const remote = this.remotePlayers.get(playerId);
                if (remote) {
                    remote.update(deltaTime, state);
                }
            }
        }
    }

    /**
     * Handles orb spawning, collection, and win conditions.
     * @private
     */
    _updateOrb(deltaTime) {
        // 1. Spawning Timer Logic
        this.orbSpawnTimer += deltaTime;
        if (this.orbSpawnTimer >= this.orbSpawnInterval) {
            this.spawnCollectibleOrb();
            this.orbSpawnTimer = 0;
        }

        // 2. Update existing orb
        if (this.currentOrb) {
            this.currentOrb.update(deltaTime);

            const orbPos = this.currentOrb.group.position;

            // 3a. Player collection check
            if (this.localPlayer && this.localPlayer.controller.isAlive) {
                const playerPos = this.localPlayer.controller.model.position;
                const dist = playerPos.distanceTo(orbPos);
                if (dist < 4.0) {
                    this._collectOrb('player');
                    return;
                }
            }

            // 3b. Bot collection check
            if (this.botPlayer && this.botPlayer.controller.isAlive) {
                const botPos = this.botPlayer.controller.model.position;
                const dist = botPos.distanceTo(orbPos);
                if (dist < 4.0) {
                    this._collectOrb('bot');
                }
            }
        }
    }

    /**
     * Registers the world-space positions of rock1 instances.
     * Called from script.js after rocks are placed.
     * @param {Array<{x: number, z: number}>} positions
     */
    setRock1Positions(positions) {
        this.rock1Positions = positions;
        console.log(`🪨 GameManager received ${positions.length} rock1 positions for orb spawning`);
    }

    /**
     * Spawns a new collectible orb on top of a random rock1 instance.
     */
    spawnCollectibleOrb() {
        if (this.state !== GameState.PLAYING) return;

        // Remove old orb if it exists
        if (this.currentOrb) {
            this.currentOrb.destroy();
            this.currentOrb = null;
        }

        this.currentOrb = new CollectibleOrb();

        let x, z;
        if (this.rock1Positions.length > 0) {
            // Pick a random rock1 position
            const rock = this.rock1Positions[
                Math.floor(Math.random() * this.rock1Positions.length)
            ];
            x = rock.x;
            z = rock.z;
        } else {
            // Fallback: center of platform (shouldn't happen if positions are set)
            x = 0;
            z = 0;
        }

        // Spawn slightly above the rock surface so it floats visibly on top
        const y = 2.0;

        this.currentOrb.setPosition(x, y, z);
        this.scene.add(this.currentOrb.group);
        console.log(`✨ New Orb spawned on rock1 at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }

    /**
     * Triggered when the local player collects the orb.
     * @private
     */
    /**
     * @param {'player'|'bot'} collector
     * @private
     */
    _collectOrb(collector) {
        if (!this.currentOrb) return;
        
        // Despawn orb
        this.currentOrb.destroy();
        this.currentOrb = null;
        this.orbSpawnTimer = 0;

        if (collector === 'player') {
            this.playerScore++;
            console.log(`🔔 Player collected orb! (${this.playerScore}/${this.winScore})`);
        } else {
            this.botScore++;
            if (this.botController) this.botController.orbsCollected = this.botScore;
            console.log(`🤖 Bot collected orb! (${this.botScore}/${this.winScore})`);
        }

        // Update HUD
        this._updateHUD();
        
        // Win check
        if (this.playerScore >= this.winScore) {
            this.declareWinner('Player');
        } else if (this.botScore >= this.winScore) {
            this.declareWinner('Bot');
        }
    }
    
    /**
     * Triggered when a player reaches the win condition limit.
     */
    /**
     * @param {string} winnerName
     */
    declareWinner(winnerName = 'Player') {
        console.log(`🏆 ${winnerName} Wins!`);
        this.state = GameState.GAME_OVER;
        this.inputManager.enabled = false;
        
        if (this.currentOrb) {
            this.currentOrb.destroy();
            this.currentOrb = null;
        }

        // Show winner banner
        const banner = document.getElementById('winner-banner');
        const text = document.getElementById('winner-text');
        if (banner && text) {
            text.textContent = `${winnerName} Wins!`;
            banner.classList.add('visible');
        }
    }

    /**
     * Updates DOM HUD with current health/orb state.
     * Called every frame — uses direct style mutation (no DOM reads).
     * @private
     */
    _updateHUD() {
        // Player health bar
        const playerFill = document.getElementById('player-health-fill');
        if (playerFill && this.localPlayer) {
            const h = this.localPlayer.controller.health;
            playerFill.style.width = `${h}%`;
            // Color shift: green → yellow → red
            if (h > 60) playerFill.style.background = 'linear-gradient(90deg, #00e676, #76ff03)';
            else if (h > 30) playerFill.style.background = 'linear-gradient(90deg, #ffab00, #ffd600)';
            else playerFill.style.background = 'linear-gradient(90deg, #ff1744, #ff5252)';
        }

        // Bot health bar
        const botFill = document.getElementById('bot-health-fill');
        if (botFill && this.botPlayer) {
            const h = this.botPlayer.controller.health;
            botFill.style.width = `${h}%`;
            if (h > 60) botFill.style.background = 'linear-gradient(90deg, #00e676, #76ff03)';
            else if (h > 30) botFill.style.background = 'linear-gradient(90deg, #ffab00, #ffd600)';
            else botFill.style.background = 'linear-gradient(90deg, #ff1744, #ff5252)';
        }

        // Orb counts
        const playerOrbs = document.getElementById('player-orb-count');
        if (playerOrbs) playerOrbs.textContent = `${this.playerScore}/${this.winScore}`;

        const botOrbs = document.getElementById('bot-orb-count');
        if (botOrbs) botOrbs.textContent = `${this.botScore}/${this.winScore}`;
    }

    /**
     * Executes the Barge: AoE force-push around the local player.
     * @private
     */
    _executeBarge(barger) {
        const bargerPos = barger.body.position;
        let hitCount = 0;

        for (const player of this.players) {
            const ctrl = player.controller;
            if (ctrl === barger || !ctrl.isAlive) continue;

            const dx = ctrl.body.position.x - bargerPos.x;
            const dz = ctrl.body.position.z - bargerPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < barger.bargeRange) {
                // Direction away from barger, normalized
                const invDist = dist > 0.01 ? 1 / dist : 1;
                // Falloff: closer = stronger (inverse square feel)
                const strength = barger.bargePower * (1 - (dist / barger.bargeRange) * 0.5);

                barger._bargeImpulse.set(
                    dx * invDist * strength,
                    barger.bargeLift,
                    dz * invDist * strength
                );
                ctrl.body.applyImpulse(barger._bargeImpulse);
                ctrl.damagePercent += 5; // minor damage
                ctrl.receiveHit(new CANNON.Vec3(0, 0, 0)); // triggers HIT anim + flash, no extra impulse
                hitCount++;
            }
        }

        // Visual + screen feedback
        this._triggerShockwave(bargerPos);
        this._triggerScreenShake(0.6, 0.35);

        console.log(`💥 BARGE! Hit ${hitCount} target(s)`);
    }

    /**
     * Activates the shield VFX at the player's position.
     * @private
     */
    _executeShield(controller) {
        this._shieldEffect.activate(
            controller.model.position,
            controller.model.rotation.y,
            controller.shieldDuration
        );
        console.log(`🛡️ SHIELD activated for ${controller.shieldDuration}s`);
    }

    /**
     * Triggers the 3D shockwave visual effect in the scene.
     * @private
     */
    _triggerShockwave(position) {
        if (!this._bargeGroup) return;
        
        this._bargeGroup.position.copy(position);
        this._bargeGroup.position.y += 0.6; // Raised higher to clear the grass
        
        const ring = this._bargeGroup.getObjectByName("ring");
        if (ring) {
            ring.scale.set(0.1, 0.1, 0.1);
            ring.material.uniforms.uProgress.value = 0.0;
        }
        
        const bubble = this._bargeGroup.getObjectByName("bubble");
        if (bubble) {
            bubble.scale.set(0.1, 0.1, 0.1);
            bubble.material.uniforms.uProgress.value = 0.0;
        }

        this._bargeGroup.visible = true;
        this._bargeTimer = this._bargeDuration;
    }

    /**
     * Triggers a directional hit spark attached to the victim.
     * @param {THREE.Object3D} victimMesh The mesh to attach the spark to.
     * @param {CANNON.Vec3} impactDir Direction vector representing the punch force.
     */
    triggerHitSpark(victimMesh, impactDir) {
        if (this._hitSparks.length === 0) return; // Pool empty
        
        const spark = this._hitSparks.pop();
        
        // Setup initial uniform and scale
        spark.material.uniforms.uProgress.value = 0.0;
        
        // Randomize scale to keep hits dynamic
        const scale = 1.0 + Math.random() * 0.5;
        spark.scale.set(scale, scale, scale);
        
        // Attach to the center of the victim
        spark.position.set(0, 1.0, 0); // ~Chest height relative to victim origin
        
        // Direct the plane to face the impact splash direction
        // Normally plane faces +Z. We use lookAt to aim it.
        const lookTarget = new THREE.Vector3().copy(spark.position).add(
            new THREE.Vector3(impactDir.x, impactDir.y, impactDir.z).normalize()
        );
        spark.lookAt(lookTarget);

        victimMesh.add(spark);
        spark.visible = true;

        this._activeHitSparks.push({
            mesh: spark,
            victimMsg: victimMesh,
            timer: 0.25 // Fast 0.25 second lifespan
        });
    }

    /**
     * Updates the barge cooldown bar in the HUD.
     * @private
     */
    _updateBargeCooldownHUD(dt) {
        if (!this.localPlayer) return;
        const ctrl = this.localPlayer.controller;
        const fill = document.getElementById('barge-fill');
        if (!fill) return;

        if (ctrl.bargeCooldown > 0) {
            // Bar recharges from 0% to 100%
            const ratio = 1 - (ctrl.bargeCooldown / ctrl.bargeCooldownMax);
            fill.style.width = `${ratio * 100}%`;
            fill.classList.remove('ready');
        } else {
            // Power is ready
            fill.style.width = '100%';
            fill.classList.add('ready');
        }
    }

    /**
     * Returns the local player's model position (for camera follow).
     * @returns {THREE.Vector3|null}
     */
    getLocalPlayerPosition() {
        if (this.localPlayer && this.localPlayer.controller.isAlive) {
            return this.localPlayer.controller.model.position;
        }
        return null;
    }

    /**
     * Updates the camera yaw for relative movement calculations.
     * @param {number} yaw
     */
    setCameraYaw(yaw) {
        this.cameraYaw = yaw;
    }

    /** @private */
    _handleRingOut(player) {
        const savedDamage = player.controller.damagePercent; // remember pre-fall health
        player.controller.die();                              // plays DEATH anim
        player.controller.lives--;                            // explicitly consume a life
        this._updateLivesHUD();
        console.log(`💥 ${player.name} fell! Lives left: ${player.controller.lives}`);

        if (player.controller.lives > 0) {
            // Respawn after delay — restore health to what it was before the fall
            setTimeout(() => {
                const spawnPos = (player === this.localPlayer) ? { x: 0, y: 0, z: 18 } : { x: 0, y: 0, z: -18 };
                player.controller.respawn(spawnPos, savedDamage);
                this._updateHUD();
            }, this._respawnDelay);
        } else {
            // No lives left — other side wins
            const winner = (player === this.localPlayer) ? 'Bot' : 'Player';
            setTimeout(() => this.declareWinner(winner), 2500);
        }
    }

    /**
     * Called when a character's health drops to zero.
     * Plays death animation then ends the game — no respawn, no life loss.
     * @private
     */
    _handleHealthDeath(player) {
        if (!player.controller.isAlive) return; // guard double-trigger
        player.controller.die(); // plays DEATH animation
        const winner = (player === this.localPlayer) ? 'Bot' : 'Player';
        console.log(`☠️ ${player.name} health reached 0. ${winner} wins!`);
        // 2.5s delay so the death animation plays before the banner appears
        setTimeout(() => this.declareWinner(winner), 2500);
    }

    /**
     * Updates the heart icons for both player and bot lives.
     * @private
     */
    _updateLivesHUD() {
        const full = '❤️';
        const empty = '🖤';
        const total = 2;

        // Player lives
        const playerLivesEl = document.getElementById('player-lives');
        if (playerLivesEl && this.localPlayer) {
            const lives = Math.max(0, this.localPlayer.controller.lives);
            playerLivesEl.textContent = full.repeat(lives) + empty.repeat(Math.max(0, total - lives));
        }

        // Bot lives
        const botLivesEl = document.getElementById('bot-lives');
        if (botLivesEl && this.botPlayer) {
            const lives = Math.max(0, this.botPlayer.controller.lives);
            botLivesEl.textContent = full.repeat(lives) + empty.repeat(Math.max(0, total - lives));
        }
    }

    /** @private */
    _findPlayerByController(controller) {
        return this.players.find(p => p.controller === controller);
    }

    dispose() {
        this.inputManager.dispose();
        if (this.botController) this.botController.dispose();
        for (const player of this.players) {
            player.controller.dispose();
            player.animSM.dispose();
        }
        this.players = [];
        this.localPlayer = null;
        this.botPlayer = null;
        this.botController = null;
        
        if (this.currentOrb) {
            this.currentOrb.destroy();
            this.currentOrb = null;
        }

        if (this._shieldEffect) {
            this._shieldEffect.dispose();
            this._shieldEffect = null;
        }

        // Cleanup multiplayer
        for (const remote of this.remotePlayers.values()) {
            remote.dispose();
        }
        this.remotePlayers.clear();
        if (this.networkManager) {
            this.networkManager.dispose();
            this.networkManager = null;
        }
        this.isMultiplayer = false;
    }
}
