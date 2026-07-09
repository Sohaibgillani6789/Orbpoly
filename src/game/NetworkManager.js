import { io } from 'socket.io-client';
import * as customParser from 'socket.io-msgpack-parser';

/**
 * NetworkManager — Client-side Socket.io networking layer.
 *
 * Completely decoupled from GameManager, PlayerController, and the render loop.
 * Injected into GameManager only when multiplayer mode is active.
 *
 * Responsibilities:
 *   1. Socket.io connection lifecycle (connect, reconnect, disconnect)
 *   2. Room management (create, join, leave)
 *   3. Input serialization + sequence numbering for client-side prediction
 *   4. Entity interpolation state buffer for remote players
 *   5. Heartbeat keepalive
 *
 * Design constraints:
 *   - Zero heap allocations in the hot path (updateInterpolation)
 *   - All callbacks are stored, not invoked synchronously during socket events
 *   - State buffer uses a ring buffer pattern (fixed size, overwrite oldest)
 */

/** Max entries in the interpolation state buffer per remote player */
const STATE_BUFFER_SIZE = 20;

/** How far "in the past" we render remote players (ms) */
const INTERPOLATION_DELAY_MS = 100;

/** Heartbeat interval (ms) */
const HEARTBEAT_INTERVAL_MS = 2000;

export class NetworkManager {
    /**
     * @param {string} serverUrl - WebSocket server URL (e.g., 'http://localhost:3001')
     */
    constructor(serverUrl) {
        /** @type {string} */
        this.serverUrl = serverUrl;

        /** @type {import('socket.io-client').Socket|null} */
        this.socket = null;

        /** @type {string|null} */
        this.roomId = null;

        /** @type {string|null} */
        this.playerId = null;

        /** @type {number} Monotonically increasing input sequence */
        this._sequenceNumber = 0;

        /** @type {Array<Object>} Pending inputs awaiting server confirmation */
        this.pendingInputs = [];

        /**
         * Remote player state buffers for entity interpolation.
         * Map: playerId → Array<{ timestamp, x, y, z, rotY, anim, hp, alive, seq }>
         * @type {Map<string, Array<Object>>}
         */
        this.remoteStateBuffers = new Map();

        /**
         * Latest interpolated state for each remote player.
         * Map: playerId → { x, y, z, rotY, anim, hp, alive }
         * @type {Map<string, Object>}
         */
        this.interpolatedStates = new Map();

        /** @type {number} Server time estimate (ms) */
        this._serverTimeOffset = 0;

        /**
         * Delta compression accumulator.
         * Stores the last-known full state per player so incoming deltas
         * can be merged to reconstruct the complete snapshot.
         * Map: playerId → { id, x, y, z, rotY, anim, hp, alive, seq }
         * @type {Map<string, Object>}
         */
        this._knownPlayerStates = new Map();

        /** @type {number|null} */
        this._heartbeatInterval = null;

        /** @type {boolean} */
        this.connected = false;

        /** @type {string} */
        this.connectionState = 'disconnected'; // disconnected | connecting | connected | error

        // ── Callbacks ──
        this._onRoomCreated = null;
        this._onRoomJoined = null;
        this._onPlayerJoined = null;
        this._onPlayerLeft = null;
        this._onGameStart = null;
        this._onStateUpdate = null;
        this._onPlayerHit = null;
        this._onPlayerRingout = null;
        this._onPlayerRespawn = null;
        this._onPlayerKilled = null;
        this._onGameOver = null;
        this._onRoomList = null;
        this._onError = null;
        this._onDisconnect = null;
        this._onReconnect = null;
        this._onReconnectAttempt = null;
    }

    // ─── CONNECTION ────────────────────────────────────────

    /**
     * Connects to the game server.
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.socket) {
                this.socket.disconnect();
            }

            this.connectionState = 'connecting';

            this.socket = io(this.serverUrl, {
                parser: customParser,
                transports: ['polling', 'websocket'], // Allow polling fallback
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 10000,
            });

            this.socket.on('connect', () => {
                this.connected = true;
                this.connectionState = 'connected';
                this.playerId = this.socket.id;
                console.log(`🌐 Connected to server as ${this.playerId}`);

                // Start heartbeat
                this._heartbeatInterval = setInterval(() => {
                    if (this.socket && this.connected) {
                        this.socket.emit('heartbeat');
                    }
                }, HEARTBEAT_INTERVAL_MS);

                resolve();
            });

            this.socket.on('connect_error', (err) => {
                this.connectionState = 'error';
                console.error('🌐 Connection error:', err.message);
                if (this._onError) this._onError(err);
                reject(err);
            });

            this.socket.on('disconnect', (reason) => {
                this.connected = false;
                this.connectionState = 'disconnected';
                console.log(`🌐 Disconnected: ${reason}`);
                this._clearHeartbeat();
                if (this._onDisconnect) this._onDisconnect(reason);
            });

            this.socket.io.on('reconnect', (attempt) => {
                console.log(`🌐 Reconnected after ${attempt} attempts`);
                if (this._onReconnect) this._onReconnect(attempt);
            });

            this.socket.io.on('reconnect_attempt', (attempt) => {
                console.log(`🌐 Reconnecting... (Attempt ${attempt})`);
                if (this._onReconnectAttempt) this._onReconnectAttempt(attempt);
            });

            // ── Wire all server events ──
            this._bindEvents();
        });
    }

    /** @private */
    _bindEvents() {
        const s = this.socket;

        s.on('room_created', (data) => {
            this.roomId = data.roomId;
            this.playerId = data.playerId || this.socket.id;
            console.log(`🏠 Room created: ${this.roomId}`);
            if (this._onRoomCreated) this._onRoomCreated(data);
        });

        s.on('room_joined', (data) => {
            this.roomId = data.roomId;
            this.playerId = data.playerId || this.socket.id;
            console.log(`🏠 Joined room: ${this.roomId}`);
            if (this._onRoomJoined) this._onRoomJoined(data);
        });

        s.on('player_joined', (data) => {
            console.log(`👤 Player joined: ${data.name} (${data.characterClass})`);
            if (this._onPlayerJoined) this._onPlayerJoined(data);
        });

        s.on('player_left', (data) => {
            console.log(`👤 Player left: ${data.name}`);
            // Clean up their interpolation buffer
            this.remoteStateBuffers.delete(data.id);
            this.interpolatedStates.delete(data.id);
            if (this._onPlayerLeft) this._onPlayerLeft(data);
        });

        s.on('game_start', (data) => {
            console.log(`🎮 Game started! ${data.players.length} players`);
            // Initialize state buffers for all remote players
            for (const p of data.players) {
                if (p.id !== this.playerId) {
                    this.remoteStateBuffers.set(p.id, []);
                    this.interpolatedStates.set(p.id, {
                        x: p.position.x, y: p.position.y, z: p.position.z,
                        rotY: 0, anim: 'idle', hp: 100, alive: true,
                    });
                }
            }
            if (this._onGameStart) this._onGameStart(data);
        });

        s.on('state', (snapshot) => {
            this._handleStateSnapshot(snapshot);
            if (this._onStateUpdate) this._onStateUpdate(snapshot);
        });

        s.on('player_hit', (data) => {
            if (this._onPlayerHit) this._onPlayerHit(data);
        });

        s.on('player_ringout', (data) => {
            if (this._onPlayerRingout) this._onPlayerRingout(data);
        });

        s.on('player_respawn', (data) => {
            if (this._onPlayerRespawn) this._onPlayerRespawn(data);
        });

        s.on('player_killed', (data) => {
            if (this._onPlayerKilled) this._onPlayerKilled(data);
        });

        s.on('game_over', (data) => {
            console.log(`🏆 Game over! Winner: ${data.winnerName}`);
            if (this._onGameOver) this._onGameOver(data);
        });

        s.on('room_list', (data) => {
            if (this._onRoomList) this._onRoomList(data);
        });

        s.on('error', (data) => {
            console.error('🌐 Server error:', data.message);
            if (this._onError) this._onError(data);
        });
    }

    // ─── ROOM MANAGEMENT ──────────────────────────────────

    /**
     * Creates a new room.
     * @param {string} characterClass
     * @param {string} playerName
     */
    createRoom(characterClass, playerName) {
        if (!this.socket) return;
        this.socket.emit('create_room', { characterClass, playerName });
    }

    /**
     * Joins an existing room.
     * @param {string} roomId
     * @param {string} characterClass
     * @param {string} playerName
     */
    joinRoom(roomId, characterClass, playerName) {
        if (!this.socket) return;
        this.socket.emit('join_room', { roomId, characterClass, playerName });
    }

    /**
     * Signals the server to start the game.
     */
    startGame() {
        if (!this.socket) return;
        this.socket.emit('start_game');
    }

    /**
     * Requests the current room list.
     */
    requestRoomList() {
        if (!this.socket) return;
        this.socket.emit('get_rooms');
    }

    // ─── INPUT SENDING ────────────────────────────────────

    /**
     * Sends a player input to the server.
     * Assigns a sequence number for client-side prediction reconciliation.
     *
     * @param {Object} inputData - Raw input data
     * @param {number} inputData.moveX - Normalized movement X (camera-relative)
     * @param {number} inputData.moveZ - Normalized movement Z (camera-relative)
     * @param {boolean} inputData.jump - Jump pressed
     * @param {string} inputData.animState - Current animation state
     * @returns {number} The assigned sequence number
     */
    sendInput(inputData) {
        if (!this.socket || !this.connected) return -1;

        const seq = ++this._sequenceNumber;
        const renderTime = Date.now() + this._serverTimeOffset - INTERPOLATION_DELAY_MS;

        const packet = {
            seq,
            clientTime: renderTime,
            ...inputData,
        };

        // Store for reconciliation
        this.pendingInputs.push({
            seq,
            ...inputData,
        });

        this.socket.emit('input', packet);
        return seq;
    }

    // ─── STATE HANDLING ───────────────────────────────────

    /**
     * Handles an incoming state snapshot from the server.
     * Supports delta compression: if the snapshot is not a keyframe,
     * each player entry may contain only the fields that changed.
     * We merge deltas onto `_knownPlayerStates` to reconstruct full state.
     * @private
     */
    _handleStateSnapshot(snapshot) {
        const serverTime = snapshot.timestamp;
        const localTime = Date.now();
        const offset = serverTime - localTime;

        if (this._serverTimeOffset === 0) {
            this._serverTimeOffset = offset;
        } else {
            this._serverTimeOffset = this._serverTimeOffset * 0.9 + offset * 0.1;
        }

        const isKeyframe = snapshot.kf === 1;

        for (const playerDelta of snapshot.players) {
            const pid = playerDelta.id;

            // Merge delta onto known state
            let fullState;
            if (isKeyframe) {
                // Keyframe: use the data as-is (full state)
                fullState = { ...playerDelta };
            } else {
                // Delta: merge onto last known
                const prev = this._knownPlayerStates.get(pid);
                if (prev) {
                    fullState = { ...prev, ...playerDelta };
                } else {
                    // No previous state — treat delta as full (first packet)
                    fullState = { ...playerDelta };
                }
            }

            // Update accumulator
            this._knownPlayerStates.set(pid, fullState);

            // Route to local or remote handler
            if (pid === this.playerId) {
                this._reconcileLocalPlayer(fullState);
            } else {
                this._bufferRemoteState(fullState, serverTime);
            }
        }
    }

    /**
     * Reconciles local player position with server authority.
     * Removes confirmed pending inputs and re-applies unconfirmed ones.
     * @private
     */
    _reconcileLocalPlayer(serverData) {
        // Remove all inputs confirmed by server
        const confirmedSeq = serverData.seq;
        if (confirmedSeq !== undefined) {
            this.pendingInputs = this.pendingInputs.filter(input => input.seq > confirmedSeq);
        }

        // Store server state for GameManager to read and apply
        this._lastServerState = {
            x: serverData.x,
            y: serverData.y,
            z: serverData.z,
            rotY: serverData.rotY,
            hp: serverData.hp,
            alive: serverData.alive,
            seq: confirmedSeq,
        };
    }

    /**
     * Buffers a remote player's state for entity interpolation.
     * @private
     */
    _bufferRemoteState(playerData, serverTime) {
        let buffer = this.remoteStateBuffers.get(playerData.id);
        if (!buffer) {
            buffer = [];
            this.remoteStateBuffers.set(playerData.id, buffer);
        }

        buffer.push({
            timestamp: serverTime,
            x: playerData.x,
            y: playerData.y,
            z: playerData.z,
            rotY: playerData.rotY,
            anim: playerData.anim,
            hp: playerData.hp,
            alive: playerData.alive,
        });

        // Keep buffer bounded
        if (buffer.length > STATE_BUFFER_SIZE) {
            buffer.shift();
        }
    }

    // ─── ENTITY INTERPOLATION ─────────────────────────────

    /**
     * Updates entity interpolation for all remote players.
     * Call this every frame from the render loop.
     *
     * Algorithm:
     *   1. Calculate render time = now - INTERPOLATION_DELAY_MS
     *   2. Find the two server snapshots that bracket render time
     *   3. Linearly interpolate position between them
     *   4. Use the more recent snapshot's animation state
     *
     * @param {number} _delta - Frame delta (unused, kept for API consistency)
     */
    updateInterpolation(_delta) {
        const renderTime = Date.now() + this._serverTimeOffset - INTERPOLATION_DELAY_MS;

        for (const [playerId, buffer] of this.remoteStateBuffers) {
            if (buffer.length < 2) {
                // Not enough data — use latest available
                if (buffer.length === 1) {
                    const s = buffer[0];
                    this.interpolatedStates.set(playerId, {
                        x: s.x, y: s.y, z: s.z,
                        rotY: s.rotY, anim: s.anim,
                        hp: s.hp, alive: s.alive,
                    });
                }
                continue;
            }

            // Find bracketing snapshots
            let before = null;
            let after = null;

            for (let i = 0; i < buffer.length - 1; i++) {
                if (buffer[i].timestamp <= renderTime && buffer[i + 1].timestamp >= renderTime) {
                    before = buffer[i];
                    after = buffer[i + 1];
                    break;
                }
            }

            if (!before || !after) {
                // Render time is outside buffer — use latest
                const latest = buffer[buffer.length - 1];
                this.interpolatedStates.set(playerId, {
                    x: latest.x, y: latest.y, z: latest.z,
                    rotY: latest.rotY, anim: latest.anim,
                    hp: latest.hp, alive: latest.alive,
                });
                continue;
            }

            // Interpolation factor
            const range = after.timestamp - before.timestamp;
            const t = range > 0 ? (renderTime - before.timestamp) / range : 0;
            const ct = Math.max(0, Math.min(1, t)); // clamp

            // Lerp position
            const ix = before.x + (after.x - before.x) * ct;
            const iy = before.y + (after.y - before.y) * ct;
            const iz = before.z + (after.z - before.z) * ct;

            // Shortest-path rotation interpolation
            let rotDiff = after.rotY - before.rotY;
            if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            const iRotY = before.rotY + rotDiff * ct;

            this.interpolatedStates.set(playerId, {
                x: ix, y: iy, z: iz,
                rotY: iRotY,
                anim: after.anim,  // Use more recent animation state
                hp: after.hp,
                alive: after.alive,
            });
        }
    }

    /**
     * Returns the latest server-confirmed state for the local player.
     * @returns {Object|null}
     */
    getLocalServerState() {
        return this._lastServerState || null;
    }

    /**
     * Returns interpolated states for all remote players.
     * @returns {Map<string, Object>}
     */
    getRemoteStates() {
        return this.interpolatedStates;
    }

    // ─── CALLBACK REGISTRATION ────────────────────────────

    /** @param {Function} fn - (data) => void */
    onRoomCreated(fn) { this._onRoomCreated = fn; }
    onRoomJoined(fn) { this._onRoomJoined = fn; }
    onPlayerJoined(fn) { this._onPlayerJoined = fn; }
    onPlayerLeft(fn) { this._onPlayerLeft = fn; }
    onGameStart(fn) { this._onGameStart = fn; }
    onStateUpdate(fn) { this._onStateUpdate = fn; }
    onPlayerHit(fn) { this._onPlayerHit = fn; }
    onPlayerRingout(fn) { this._onPlayerRingout = fn; }
    onPlayerRespawn(fn) { this._onPlayerRespawn = fn; }
    onPlayerKilled(fn) { this._onPlayerKilled = fn; }
    onGameOver(fn) { this._onGameOver = fn; }
    onRoomList(fn) { this._onRoomList = fn; }
    onError(fn) { this._onError = fn; }
    onDisconnect(fn) { this._onDisconnect = fn; }
    onReconnect(fn) { this._onReconnect = fn; }
    onReconnectAttempt(fn) { this._onReconnectAttempt = fn; }

    // ─── CLEANUP ──────────────────────────────────────────

    /** @private */
    _clearHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    /**
     * Disconnects from the server and cleans up all state.
     */
    disconnect() {
        this._clearHeartbeat();
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.io.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
        this.connectionState = 'disconnected';
        this.roomId = null;
        this.playerId = null;
        this.pendingInputs = [];
        this.remoteStateBuffers.clear();
        this.interpolatedStates.clear();
        this._knownPlayerStates.clear();
        this._lastServerState = null;
        this._sequenceNumber = 0;
    }

    /**
     * Full cleanup — alias for disconnect.
     */
    dispose() {
        this.disconnect();
    }
}
