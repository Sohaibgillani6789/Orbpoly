/**
 * Orbpoly Game Server — Socket.io Entry Point
 *
 * Responsibilities:
 *   - HTTP health check endpoint (GET /) for Render.com uptime monitoring
 *   - WebSocket server via Socket.io
 *   - Room management: create/join/leave
 *   - Routes socket events to the correct GameRoom instance
 *
 * Protocol:
 *   Client → Server:
 *     'create_room'   { characterClass, playerName }
 *     'join_room'     { roomId, characterClass, playerName }
 *     'input'         { seq, moveX, moveZ, jump, animState }
 *     'heartbeat'     {}
 *     'start_game'    {}  (room host only)
 *
 *   Server → Client:
 *     'room_created'       { roomId }
 *     'room_joined'        { roomId, players }
 *     'player_joined'      { id, name, characterClass, position }
 *     'player_left'        { id, name, remaining }
 *     'game_start'         { players, platformRadius }
 *     'state'              { tick, timestamp, players[] }
 *     'player_hit'         { attackerId, victimId, damage, ... }
 *     'player_ringout'     { id, name, livesRemaining }
 *     'player_respawn'     { id, position }
 *     'player_killed'      { victimId, attackerId, ... }
 *     'game_over'          { winnerId, winnerName }
 *     'room_list'          [{ roomId, state, playerCount, ... }]
 *     'error'              { message }
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameRoom, RoomState } from './GameRoom.js';

// ─── CONFIG ───────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://orbpoly.vercel.app';
const PLATFORM_RADIUS = 25;

// ─── HTTP SERVER ──────────────────────────────────────────
const app = express();

// Health check endpoints — intentionally BEFORE cors middleware
// so cron-job.org and Render health checks can reach them without CORS headers
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: Math.round(process.uptime()),
        rooms: rooms.size,
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        game: 'Orbpoly',
        rooms: rooms.size,
        uptime: Math.round(process.uptime()),
    });
});

// CORS — lock all remaining HTTP routes to the frontend origin
app.use(cors({ origin: FRONTEND_URL, methods: ['GET', 'POST'] }));

// Room list API (CORS-protected)
app.get('/rooms', (req, res) => {
    const roomList = [];
    for (const room of rooms.values()) {
        roomList.push(room.getInfo());
    }
    res.json(roomList);
});

const httpServer = createServer(app);

// ─── SOCKET.IO ────────────────────────────────────────────
const io = new Server(httpServer, {
    cors: {
        origin: FRONTEND_URL,
        methods: ['GET', 'POST'],
    },
    // Performance tuning
    pingTimeout: 10000,
    pingInterval: 5000,
    maxHttpBufferSize: 1e5,  // 100KB max payload
});

// ─── ROOM MANAGEMENT ─────────────────────────────────────
/** @type {Map<string, GameRoom>} */
const rooms = new Map();

/** @type {Map<string, string>} socketId → roomId */
const socketRoomMap = new Map();

/** Generates a short room ID */
function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let id = '';
    for (let i = 0; i < 5; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

/** Cleans up empty rooms */
function cleanupEmptyRooms() {
    for (const [roomId, room] of rooms) {
        if (room.players.size === 0) {
            room.stop();
            rooms.delete(roomId);
            console.log(`[Server] Room ${roomId} cleaned up (empty)`);
        }
    }
}

// ─── SOCKET EVENT HANDLING ────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[Server] Client connected: ${socket.id}`);

    // Send available rooms on connect
    socket.emit('room_list', getRoomList());

    // ── CREATE ROOM ──
    socket.on('create_room', (data) => {
        const { characterClass, playerName } = data || {};
        if (!characterClass) {
            socket.emit('error', { message: 'characterClass is required' });
            return;
        }

        const roomId = generateRoomId();
        const room = new GameRoom(roomId, io, PLATFORM_RADIUS);
        rooms.set(roomId, room);

        const result = room.addPlayer(socket.id, characterClass, playerName || 'Player1');
        if (!result.success) {
            socket.emit('error', { message: result.reason });
            rooms.delete(roomId);
            return;
        }

        socket.join(roomId);
        socketRoomMap.set(socket.id, roomId);

        socket.emit('room_created', {
            roomId,
            playerId: socket.id,
            spawnIndex: result.spawnIndex,
        });

        console.log(`[Server] Room ${roomId} created by ${playerName || 'Player1'}`);

        // Broadcast updated room list to all connected sockets
        io.emit('room_list', getRoomList());
    });

    // ── JOIN ROOM ──
    socket.on('join_room', (data) => {
        const { roomId, characterClass, playerName } = data || {};
        if (!roomId || !characterClass) {
            socket.emit('error', { message: 'roomId and characterClass are required' });
            return;
        }

        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: `Room ${roomId} not found` });
            return;
        }

        const result = room.addPlayer(socket.id, characterClass, playerName || 'Player');
        if (!result.success) {
            socket.emit('error', { message: result.reason });
            return;
        }

        socket.join(roomId);
        socketRoomMap.set(socket.id, roomId);

        // Notify the joiner of existing room state
        socket.emit('room_joined', {
            roomId,
            playerId: socket.id,
            spawnIndex: result.spawnIndex,
            players: room.getInfo().players,
        });

        // Notify existing players of the new arrival
        const playerState = room.players.get(socket.id);
        socket.to(roomId).emit('player_joined', {
            id: socket.id,
            name: playerState.name,
            characterClass: playerState.characterClass,
            position: playerState.position,
        });

        // Broadcast updated room list
        io.emit('room_list', getRoomList());
    });

    // ── START GAME (any player in room can start) ──
    socket.on('start_game', () => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        if (room.state !== RoomState.WAITING) {
            socket.emit('error', { message: 'Game already started' });
            return;
        }

        if (room.players.size < 2) {
            socket.emit('error', { message: 'Need at least 2 players to start' });
            return;
        }

        room.start();
    });

    // ── GAME INPUT ──
    socket.on('input', (data) => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room || room.state !== RoomState.PLAYING) return;

        room.queueInput(socket.id, data);
    });

    // ── HEARTBEAT ──
    socket.on('heartbeat', () => {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (room) room.heartbeat(socket.id);
    });

    // ── DISCONNECT ──
    socket.on('disconnect', (reason) => {
        console.log(`[Server] Client disconnected: ${socket.id} (${reason})`);

        const roomId = socketRoomMap.get(socket.id);
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                room.removePlayer(socket.id);
            }
            socketRoomMap.delete(socket.id);
        }

        cleanupEmptyRooms();

        // Broadcast updated room list
        io.emit('room_list', getRoomList());
    });

    // ── GET ROOM LIST ──
    socket.on('get_rooms', () => {
        socket.emit('room_list', getRoomList());
    });
});

function getRoomList() {
    const list = [];
    for (const room of rooms.values()) {
        list.push(room.getInfo());
    }
    return list;
}

// ─── START SERVER ─────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎮 Orbpoly Game Server`);
    console.log(`   HTTP:   http://0.0.0.0:${PORT}`);
    console.log(`   WS:     ws://0.0.0.0:${PORT}`);
    console.log(`   CORS:   ${FRONTEND_URL}`);
    console.log(`   Tick:   30Hz\n`);
});
