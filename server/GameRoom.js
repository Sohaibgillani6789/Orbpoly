/**
 * GameRoom — Encapsulates a single multiplayer game instance.
 *
 * Lifecycle:  WAITING → COUNTDOWN → PLAYING → GAME_OVER
 *
 * Tick loop runs at 30Hz via setInterval. Each tick:
 *   1. Drain the input queue
 *   2. Integrate physics for all players
 *   3. Check ring-outs
 *   4. Broadcast state snapshot to all clients
 *
 * State snapshot is a flat array for minimal JSON overhead:
 *   [id, x, y, z, rotY, animState, health, isAlive, lastSeq, ...]
 *
 * Memory: zero allocations in the hot loop — all scratch objects pre-allocated.
 */

import {
    integratePlayer,
    applyMovementInput,
    applyJump,
    applyImpulse,
    isRingOut,
    isGrounded
} from './ServerPhysics.js';
import {
    checkAttackHit,
    flatDirection,
    knockbackMagnitude
} from './HitboxMath.js';

/** @enum {string} */
export const RoomState = Object.freeze({
    WAITING: 'waiting',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    GAME_OVER: 'game_over',
});

/** Attack animation states — must match client AnimState values */
const ATTACK_ANIMS = new Set([
    'swordAttack', 'swordAttack2', 'punch', 'staffAttack', 'bowShoot'
]);

/** Duration in ms that an attack hitbox is active */
const ATTACK_ACTIVE_MS = 500;

/** Damage per hit */
const DAMAGE_PER_HIT = 15;

/** Base knockback power */
const BASE_KNOCKBACK = 10;

/** Upward lift on knockback */
const LIFT_FORCE = 5;

/** Min ms between repeated hits on the same pair */
const HIT_COOLDOWN_MS = 300;

/** Server tick rate */
const TICK_RATE = 30;
const TICK_INTERVAL_MS = Math.round(1000 / TICK_RATE);

/** Ring-out Y threshold */
const RING_OUT_Y = -20;

/** Heartbeat timeout (ms) */
const HEARTBEAT_TIMEOUT = 5000;

/** Max players per room */
const MAX_PLAYERS = 6;

/** Spawn positions for up to 6 players (spread around platform) */
const SPAWN_POSITIONS = [
    { x: 0, y: 0, z: 18 },
    { x: 0, y: 0, z: -18 },
    { x: 18, y: 0, z: 0 },
    { x: -18, y: 0, z: 0 },
    { x: 13, y: 0, z: 13 },
    { x: -13, y: 0, z: -13 },
];

export class GameRoom {
    /**
     * @param {string} roomId
     * @param {import('socket.io').Server} io
     * @param {number} platformRadius
     */
    constructor(roomId, io, platformRadius = 25) {
        this.roomId = roomId;
        this.io = io;
        this.platformRadius = platformRadius;
        this.state = RoomState.WAITING;

        /** @type {Map<string, Object>} socketId → player state */
        this.players = new Map();

        /** @type {Array<Object>} Queued inputs to process next tick */
        this.inputQueue = [];

        /** @type {Map<string, number>} Hit cooldown tracker: "idA-idB" → timestamp */
        this.recentHits = new Map();

        /** @type {NodeJS.Timeout|null} */
        this._tickInterval = null;

        /** @type {number} Server time tracking */
        this._lastTickTime = 0;

        /** @type {number} Monotonic tick counter */
        this.tickCount = 0;

        /** @type {Array<Object>} History buffer for lag compensation */
        this.historyBuffer = [];

        /**
         * Delta compression: last-broadcast state per player.
         * Map: socketId → { x, y, z, rotY, anim, hp, alive, seq }
         * Used to compute per-field diffs so we only send what changed.
         * @type {Map<string, Object>}
         */
        this._lastBroadcastState = new Map();
    }

    /**
     * Adds a player to the room.
     * @param {string} socketId
     * @param {string} characterClass
     * @param {string} playerName
     * @returns {{ success: boolean, reason?: string, spawnIndex?: number }}
     */
    addPlayer(socketId, characterClass, playerName) {
        if (this.players.size >= MAX_PLAYERS) {
            return { success: false, reason: 'Room is full' };
        }
        if (this.state === RoomState.PLAYING || this.state === RoomState.GAME_OVER) {
            return { success: false, reason: 'Game already in progress' };
        }

        const spawnIndex = this.players.size;
        const spawn = SPAWN_POSITIONS[spawnIndex];

        const playerState = {
            id: socketId,
            name: playerName || `Player${spawnIndex + 1}`,
            characterClass,
            position: { x: spawn.x, y: spawn.y, z: spawn.z },
            velocity: { x: 0, y: 0, z: 0 },
            rotation: 0,
            animState: 'idle',
            health: 100,
            damage: 0,
            isAlive: true,
            lastProcessedSeq: 0,
            lastHeartbeat: Date.now(),
            attackTimer: 0,      // ms remaining for active hitbox
            lives: 2,
            score: 0,
            lag: 0,              // client latency estimate
        };

        this.players.set(socketId, playerState);
        console.log(`[Room ${this.roomId}] Player joined: ${playerName} as ${characterClass} (${this.players.size}/${MAX_PLAYERS})`);

        return { success: true, spawnIndex };
    }

    /**
     * Removes a player from the room.
     * @param {string} socketId
     */
    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (!player) return;

        this.players.delete(socketId);
        console.log(`[Room ${this.roomId}] Player left: ${player.name} (${this.players.size}/${MAX_PLAYERS})`);

        // Broadcast removal to remaining players
        this.io.to(this.roomId).emit('player_left', {
            id: socketId,
            name: player.name,
            remaining: this.players.size,
        });

        // If room empty, stop tick loop
        if (this.players.size === 0) {
            this.stop();
        }

        // If only 1 player left during game, declare winner
        if (this.state === RoomState.PLAYING && this.players.size === 1) {
            const winner = this.players.values().next().value;
            this._declareWinner(winner);
        }
    }

    /**
     * Queues a player input for processing on next tick.
     * @param {string} socketId
     * @param {Object} inputData
     */
    queueInput(socketId, inputData) {
        if (!this.players.has(socketId)) return;
        this.inputQueue.push({ socketId, ...inputData });
    }

    /**
     * Updates heartbeat timestamp for a player.
     * @param {string} socketId
     */
    heartbeat(socketId) {
        const player = this.players.get(socketId);
        if (player) player.lastHeartbeat = Date.now();
    }

    /**
     * Starts the game and the tick loop.
     */
    start() {
        if (this.state === RoomState.PLAYING) return;

        this.state = RoomState.PLAYING;
        this._lastTickTime = performance.now();
        this.tickCount = 0;

        this._tickInterval = setInterval(() => {
            this._tick();
        }, TICK_INTERVAL_MS);

        this.io.to(this.roomId).emit('game_start', {
            players: this._getPlayersSnapshot(),
            platformRadius: this.platformRadius,
        });

        console.log(`[Room ${this.roomId}] Game started with ${this.players.size} players`);
    }

    /**
     * Stops the tick loop.
     */
    stop() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
            console.log(`[Room ${this.roomId}] Tick loop stopped`);
        }
    }

    // ─── TICK LOOP (30Hz) ─────────────────────────────────────

    /** @private */
    _tick() {
        const now = performance.now();
        const dt = Math.min((now - this._lastTickTime) / 1000, 0.1); // cap at 100ms
        this._lastTickTime = now;
        this.tickCount++;

        if (this.state !== RoomState.PLAYING) return;

        // Phase 1: Process queued inputs
        this._processInputs(dt);

        // Phase 2: Integrate physics for all players
        for (const player of this.players.values()) {
            if (!player.isAlive) continue;
            integratePlayer(player, this.platformRadius, dt);
        }

        // Phase 3: Check active attacks → hit detection
        this._processAttacks(dt);

        // Phase 4: Ring-out checks
        for (const player of this.players.values()) {
            if (player.isAlive && isRingOut(player, RING_OUT_Y)) {
                this._handleRingOut(player);
            }
        }

        // Phase 5: Check heartbeats
        this._checkHeartbeats(now);

        // Phase 6: Broadcast state to all clients
        this._broadcastState();
    }

    /** @private */
    _processInputs(dt) {
        for (const input of this.inputQueue) {
            const player = this.players.get(input.socketId);
            if (!player || !player.isAlive) continue;

            // Track sequence number for client-side prediction reconciliation
            if (input.seq !== undefined) {
                player.lastProcessedSeq = input.seq;
            }

            // Track lag for compensation
            if (input.clientTime) {
                const calculatedLag = Date.now() - input.clientTime;
                // clamp lag to prevent extreme rewinds
                player.lag = Math.max(0, Math.min(calculatedLag, 400));
            }

            // Movement
            if (input.moveX !== undefined && input.moveZ !== undefined) {
                const len = Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
                if (len > 0.01) {
                    const nx = input.moveX / len;
                    const nz = input.moveZ / len;
                    applyMovementInput(player, nx, nz, dt);

                    // Update rotation to face movement direction
                    player.rotation = Math.atan2(nx, nz);
                }
            }

            // Animation state
            if (input.animState) {
                player.animState = input.animState;

                // Start attack timer if this is an attack animation
                if (ATTACK_ANIMS.has(input.animState)) {
                    player.attackTimer = ATTACK_ACTIVE_MS;
                }
            }

            // Jump
            if (input.jump) {
                if (applyJump(player)) {
                    player.animState = 'jump';
                }
            }
        }

        // Clear queue
        this.inputQueue.length = 0;
    }

    /** @private */
    _processAttacks(dt) {
        const dtMs = dt * 1000;

        for (const attacker of this.players.values()) {
            if (!attacker.isAlive || attacker.attackTimer <= 0) continue;

            attacker.attackTimer -= dtMs;

            // Check hits against all other players
            for (const victim of this.players.values()) {
                if (victim === attacker || !victim.isAlive) continue;

                // Cooldown check
                const pairKey = this._pairKey(attacker.id, victim.id);
                const now = Date.now();
                const lastHit = this.recentHits.get(pairKey);
                if (lastHit && (now - lastHit) < HIT_COOLDOWN_MS) continue;

                // Lag compensation: Rewind victim
                const rewindTime = now - (attacker.lag || 0);
                const historicalPos = this._getHistoricalPosition(victim.id, rewindTime);
                const victimPos = historicalPos || victim.position;

                const result = checkAttackHit(
                    attacker.position, attacker.rotation,
                    victimPos
                );

                if (result.hit) {
                    this.recentHits.set(pairKey, now);
                    this._applyHit(attacker, victim);
                }
            }
        }
    }

    /** @private */
    _applyHit(attacker, victim) {
        // Apply damage
        victim.damage += DAMAGE_PER_HIT;
        victim.health = Math.max(0, 100 - victim.damage);

        // Knockback direction (attacker → victim, flat plane)
        const dir = flatDirection(attacker.position, victim.position);
        const magnitude = knockbackMagnitude(BASE_KNOCKBACK, victim.damage);

        applyImpulse(
            victim,
            dir.x * magnitude,
            LIFT_FORCE,
            dir.z * magnitude
        );

        victim.animState = 'receiveHit';

        // Broadcast hit event for VFX
        this.io.to(this.roomId).emit('player_hit', {
            attackerId: attacker.id,
            victimId: victim.id,
            damage: DAMAGE_PER_HIT,
            victimHealth: victim.health,
            hurtbox: 'torso',
        });

        // Health death check
        if (victim.health <= 0) {
            this._handleHealthDeath(victim, attacker);
        }

        console.log(`[Room ${this.roomId}] ${attacker.name} hit ${victim.name} (${victim.health} HP)`);
    }

    /** @private */
    _handleRingOut(player) {
        player.isAlive = false;
        player.lives--;
        player.animState = 'death';

        this.io.to(this.roomId).emit('player_ringout', {
            id: player.id,
            name: player.name,
            livesRemaining: player.lives,
        });

        console.log(`[Room ${this.roomId}] ${player.name} ring-out! Lives: ${player.lives}`);

        if (player.lives > 0) {
            // Respawn after 5 seconds
            setTimeout(() => {
                if (!this.players.has(player.id)) return; // disconnected
                const spawn = SPAWN_POSITIONS[Math.floor(Math.random() * SPAWN_POSITIONS.length)];
                player.position.x = spawn.x;
                player.position.y = spawn.y;
                player.position.z = spawn.z;
                player.velocity.x = 0;
                player.velocity.y = 0;
                player.velocity.z = 0;
                player.isAlive = true;
                player.animState = 'idle';

                this.io.to(this.roomId).emit('player_respawn', {
                    id: player.id,
                    position: player.position,
                });
            }, 5000);
        } else {
            this._checkWinCondition();
        }
    }

    /** @private */
    _handleHealthDeath(victim, attacker) {
        victim.isAlive = false;
        victim.animState = 'death';

        this.io.to(this.roomId).emit('player_killed', {
            victimId: victim.id,
            attackerId: attacker.id,
            victimName: victim.name,
            attackerName: attacker.name,
        });

        console.log(`[Room ${this.roomId}] ${victim.name} killed by ${attacker.name}!`);

        // In multiplayer, death = elimination. Check for winner.
        this._checkWinCondition();
    }

    /** @private */
    _checkWinCondition() {
        const alivePlayers = [];
        for (const p of this.players.values()) {
            if (p.isAlive || p.lives > 0) alivePlayers.push(p);
        }

        if (alivePlayers.length <= 1 && this.players.size > 1) {
            const winner = alivePlayers[0] || null;
            this._declareWinner(winner);
        }
    }

    /** @private */
    _declareWinner(winner) {
        this.state = RoomState.GAME_OVER;
        this.stop();

        this.io.to(this.roomId).emit('game_over', {
            winnerId: winner ? winner.id : null,
            winnerName: winner ? winner.name : 'Nobody',
        });

        console.log(`[Room ${this.roomId}] GAME OVER! Winner: ${winner ? winner.name : 'Nobody'}`);
    }

    /** @private */
    _checkHeartbeats(now) {
        // Collect IDs first to avoid mutating Map during iteration
        const toRemove = [];
        for (const [socketId, player] of this.players) {
            if (now - player.lastHeartbeat > HEARTBEAT_TIMEOUT) {
                console.log(`[Room ${this.roomId}] ${player.name} heartbeat timeout`);
                toRemove.push(socketId);
            }
        }
        for (const id of toRemove) {
            this.removePlayer(id);
        }
    }

    /** @private */
    _broadcastState() {
        const now = Date.now();
        // Send a full keyframe every 30 ticks (1Hz) to prevent drift
        const isKeyframe = this.tickCount % 30 === 0;

        // Build full state snapshot for history buffer (lag compensation needs full data)
        const fullSnapshot = {
            tick: this.tickCount,
            timestamp: now,
            players: [],
        };

        // Build the delta snapshot for transmission
        const deltaSnapshot = {
            tick: this.tickCount,
            timestamp: now,
            kf: isKeyframe ? 1 : 0,  // keyframe flag
            players: [],
        };

        for (const player of this.players.values()) {
            const curr = {
                id: player.id,
                x: Math.round(player.position.x * 100) / 100,
                y: Math.round(player.position.y * 100) / 100,
                z: Math.round(player.position.z * 100) / 100,
                rotY: Math.round(player.rotation * 100) / 100,
                anim: player.animState,
                hp: player.health,
                alive: player.isAlive,
                seq: player.lastProcessedSeq,
            };

            // Always push full data to history buffer
            fullSnapshot.players.push(curr);

            if (isKeyframe) {
                // Keyframe: send everything, reset baseline
                deltaSnapshot.players.push(curr);
                this._lastBroadcastState.set(player.id, { ...curr });
            } else {
                // Delta: only send fields that actually changed
                const prev = this._lastBroadcastState.get(player.id);
                if (!prev) {
                    // First time seeing this player — send full
                    deltaSnapshot.players.push(curr);
                    this._lastBroadcastState.set(player.id, { ...curr });
                } else {
                    const delta = { id: player.id };
                    let hasChanges = false;

                    if (curr.x !== prev.x) { delta.x = curr.x; hasChanges = true; }
                    if (curr.y !== prev.y) { delta.y = curr.y; hasChanges = true; }
                    if (curr.z !== prev.z) { delta.z = curr.z; hasChanges = true; }
                    if (curr.rotY !== prev.rotY) { delta.rotY = curr.rotY; hasChanges = true; }
                    if (curr.anim !== prev.anim) { delta.anim = curr.anim; hasChanges = true; }
                    if (curr.hp !== prev.hp) { delta.hp = curr.hp; hasChanges = true; }
                    if (curr.alive !== prev.alive) { delta.alive = curr.alive; hasChanges = true; }
                    // seq always changes when input is processed
                    if (curr.seq !== prev.seq) { delta.seq = curr.seq; hasChanges = true; }

                    if (hasChanges) {
                        deltaSnapshot.players.push(delta);
                    }
                    // Update baseline
                    this._lastBroadcastState.set(player.id, { ...curr });
                }
            }
        }

        // Clean up baselines for disconnected players
        for (const id of this._lastBroadcastState.keys()) {
            if (!this.players.has(id)) {
                this._lastBroadcastState.delete(id);
            }
        }

        // Save full snapshot to history buffer (for lag compensation)
        this.historyBuffer.push(fullSnapshot);
        if (this.historyBuffer.length > 60) { // 2 seconds at 30Hz
            this.historyBuffer.shift();
        }

        this.io.to(this.roomId).emit('state', deltaSnapshot);
    }

    /** @private — Returns initial player data for game_start */
    _getPlayersSnapshot() {
        const result = [];
        for (const player of this.players.values()) {
            result.push({
                id: player.id,
                name: player.name,
                characterClass: player.characterClass,
                position: { ...player.position },
                lives: player.lives,
            });
        }
        return result;
    }

    /** @private */
    _getHistoricalPosition(playerId, targetTime) {
        if (this.historyBuffer.length === 0) return null;

        let before = null;
        let after = null;

        for (let i = 0; i < this.historyBuffer.length - 1; i++) {
            if (this.historyBuffer[i].timestamp <= targetTime && this.historyBuffer[i + 1].timestamp >= targetTime) {
                before = this.historyBuffer[i];
                after = this.historyBuffer[i + 1];
                break;
            }
        }

        if (!before || !after) {
            if (targetTime < this.historyBuffer[0].timestamp) {
                const s = this.historyBuffer[0].players.find(p => p.id === playerId);
                return s ? { x: s.x, y: s.y, z: s.z } : null;
            } else {
                const s = this.historyBuffer[this.historyBuffer.length - 1].players.find(p => p.id === playerId);
                return s ? { x: s.x, y: s.y, z: s.z } : null;
            }
        }

        const pBefore = before.players.find(p => p.id === playerId);
        const pAfter = after.players.find(p => p.id === playerId);

        if (!pBefore || !pAfter) return null;

        const range = after.timestamp - before.timestamp;
        const t = range > 0 ? (targetTime - before.timestamp) / range : 0;

        return {
            x: pBefore.x + (pAfter.x - pBefore.x) * t,
            y: pBefore.y + (pAfter.y - pBefore.y) * t,
            z: pBefore.z + (pAfter.z - pBefore.z) * t
        };
    }

    /** @private */
    _pairKey(idA, idB) {
        return idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
    }

    /** Returns room info for lobby display */
    getInfo() {
        return {
            roomId: this.roomId,
            state: this.state,
            playerCount: this.players.size,
            maxPlayers: MAX_PLAYERS,
            players: Array.from(this.players.values()).map(p => ({
                name: p.name,
                characterClass: p.characterClass,
            })),
        };
    }
}
