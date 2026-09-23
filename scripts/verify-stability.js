/**
 * Orbpoly QA Stability & Integrity Verification Suite
 * Per TESTING.md requirements: asset integrity, math correctness,
 * physics stability, disposal safety, and zero memory leaks.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('🧪 Starting Orbpoly QA Verification Suite...\n');

let passCount = 0;
let testCount = 0;

function runTest(name, fn) {
    testCount++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
}

// ── 1. ASSET INTEGRITY AUDIT ──
console.log('📦 1. Auditing Critical Assets on Disk:');

const REQUIRED_CHARACTERS = ['Warrior.glb', 'Wizard.glb', 'Rogue.glb', 'Ranger.glb', 'Monk.glb', 'Cleric.glb'];
REQUIRED_CHARACTERS.forEach(charFile => {
    runTest(`Character Model: ${charFile}`, () => {
        const fullPath = path.join(rootDir, 'static', 'models', 'characters', charFile);
        assert(fs.existsSync(fullPath), `File does not exist: ${fullPath}`);
        const stat = fs.statSync(fullPath);
        assert(stat.size > 1000000, `Model file size too small: ${stat.size} bytes`);
    });
});

const REQUIRED_TEXTURES = [
    'textures/grass/grass.jpg',
    'textures/clouds/cloud.jpg',
    'textures/mountain/color.jpg',
    'textures/mountain/normal.jpg',
    'textures/mountain/ao.jpg',
    'textures/mountain/displacement.jpg'
];
REQUIRED_TEXTURES.forEach(texPath => {
    runTest(`Texture: ${texPath}`, () => {
        const fullPath = path.join(rootDir, 'static', texPath);
        assert(fs.existsSync(fullPath), `Texture does not exist: ${fullPath}`);
        const stat = fs.statSync(fullPath);
        assert(stat.size > 5000, `Texture file too small: ${stat.size} bytes`);
    });
});

runTest('Audio asset: sounds/lol.mp3', () => {
    const fullPath = path.join(rootDir, 'static', 'sounds', 'lol.mp3');
    assert(fs.existsSync(fullPath), `Audio does not exist: ${fullPath}`);
});

runTest('Font asset: fonts/orbitron-latin.woff2', () => {
    const fullPath = path.join(rootDir, 'static', 'fonts', 'orbitron-latin.woff2');
    assert(fs.existsSync(fullPath), `Font does not exist: ${fullPath}`);
});

// ── 2. HITBOX MATH & FINITE-NUMBER INVARIANTS ──
console.log('\n📐 2. Testing HitboxMath & Floating-Point Stability:');

import { sphereOverlap, checkAttackHit, flatDirection, knockbackMagnitude } from '../server/HitboxMath.js';

runTest('sphereOverlap identifies colliding spheres', () => {
    assert.strictEqual(sphereOverlap(0, 0, 0, 1.0, 1.5, 0, 0, 1.0), true);
    assert.strictEqual(sphereOverlap(0, 0, 0, 1.0, 3.0, 0, 0, 1.0), false);
});

runTest('flatDirection handles zero-length offset without NaN', () => {
    const dir = flatDirection({ x: 5, y: 0, z: 5 }, { x: 5, y: 0, z: 5 });
    assert(Number.isFinite(dir.x) && Number.isFinite(dir.z), 'Must produce finite values');
    assert.strictEqual(dir.x, 0);
    assert.strictEqual(dir.z, 1); // Documented fallback
});

runTest('knockbackMagnitude scales monotonically with damage', () => {
    const kb0 = knockbackMagnitude(10, 0);
    const kb50 = knockbackMagnitude(10, 50);
    const kb100 = knockbackMagnitude(10, 100);
    assert(kb0 < kb50 && kb50 < kb100, `Knockback must increase: ${kb0} < ${kb50} < ${kb100}`);
    assert.strictEqual(kb0, 10);
    assert.strictEqual(kb100, 20);
});

// ── 3. SERVER PHYSICS SIMULATION INVARIANTS ──
console.log('\n⚙️ 3. Testing ServerPhysics Invariants:');

import { integratePlayer, applyMovementInput, applyJump, applyImpulse, isRingOut } from '../server/ServerPhysics.js';

runTest('integratePlayer maintains finite positions and applies gravity', () => {
    const player = {
        position: { x: 0, y: 5, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        grounded: false
    };
    integratePlayer(player, 0.033, 25);
    assert(player.position.y < 5, 'Player should fall due to gravity');
    assert(Number.isFinite(player.position.y), 'Position Y must be finite');
    assert(Number.isFinite(player.velocity.y), 'Velocity Y must be finite');
});

runTest('isRingOut triggers at RING_OUT_Y (-20)', () => {
    assert.strictEqual(isRingOut({ position: { x: 0, y: 0, z: 0 } }, -20), false);
    assert.strictEqual(isRingOut({ position: { x: 0, y: -21, z: 0 } }, -20), true);
});

// ── 4. CANNON-ES PHYSICS WORLD INTEGRATION ──
console.log('\n🥊 4. Testing PhysicsWorld (Cannon-es):');

import { PhysicsWorld } from '../src/game/PhysicsWorld.js';
import * as CANNON from 'cannon-es';

runTest('PhysicsWorld steps cleanly without NaN', () => {
    const pw = new PhysicsWorld({ platformRadius: 25 });
    const body = new CANNON.Body({ mass: 1, position: new CANNON.Vec3(0, 5, 0) });
    body.addShape(new CANNON.Sphere(0.5));
    pw.addBody(body);

    for (let i = 0; i < 60; i++) {
        pw.step(1 / 60);
        assert(Number.isFinite(body.position.y), `Position must be finite at step ${i}`);
    }
    assert(body.position.y <= 5, 'Body must have fallen');
    pw.removeBody(body);
});

// ── 5. COMBAT SYSTEM & DISPOSAL AUDIT ──
console.log('\n🛡️ 5. Testing CombatSystem Lifecycle & Memory Disposal:');

import { CombatSystem } from '../src/game/CombatSystem.js';

runTest('CombatSystem cleans up collision listeners on unregister and dispose', () => {
    const combat = new CombatSystem();
    const mockBody = new CANNON.Body({ mass: 1 });
    let listenerCount = 0;
    const origAdd = mockBody.addEventListener.bind(mockBody);
    const origRemove = mockBody.removeEventListener.bind(mockBody);

    mockBody.addEventListener = (type, fn) => {
        listenerCount++;
        return origAdd(type, fn);
    };
    mockBody.removeEventListener = (type, fn) => {
        listenerCount--;
        return origRemove(type, fn);
    };

    const mockPlayer = {
        body: mockBody,
        isAlive: true,
        isAttacking: false,
        isShielding: false,
        damagePercent: 0
    };

    combat.registerPlayer(mockPlayer);
    assert.strictEqual(listenerCount, 1, 'Listener should be added');

    combat.unregisterPlayer(mockPlayer);
    assert.strictEqual(listenerCount, 0, 'Listener should be removed on unregisterPlayer');
    assert.strictEqual(mockPlayer._combatCollisionHandler, null, 'Handler reference should be cleared');

    // Register again, then call dispose()
    combat.registerPlayer(mockPlayer);
    assert.strictEqual(listenerCount, 1);
    combat.dispose();
    assert.strictEqual(listenerCount, 0, 'Listener should be removed on combat.dispose()');
});

// ── 6. REPEATED SESSION RESTART STRESS TEST (10 ITERATIONS) ──
console.log('\n🔁 6. Running 10 Repeated Session Disposal Stress Cycles:');

runTest('10 Consecutive PhysicsWorld + CombatSystem create/run/dispose cycles', () => {
    for (let session = 1; session <= 10; session++) {
        const pw = new PhysicsWorld({ platformRadius: 25 });
        const combat = new CombatSystem();

        const bodies = [];
        for (let p = 0; p < 4; p++) {
            const body = new CANNON.Body({ mass: 1, position: new CANNON.Vec3(p * 2, 1, 0) });
            body.isPlayer = true;
            body.playerController = { isAlive: true, isAttacking: false, isShielding: false, damagePercent: 0, body };
            pw.addBody(body);
            combat.registerPlayer(body.playerController);
            bodies.push(body);
        }

        // Simulate 30 frames of combat
        for (let frame = 0; frame < 30; frame++) {
            pw.step(0.016);
        }

        // Dispose session
        for (const b of bodies) {
            combat.unregisterPlayer(b.playerController);
            pw.removeBody(b);
        }
        combat.dispose();
    }
});

// ── SUMMARY REPORT ──
console.log('\n' + '─'.repeat(50));
console.log(`📊 QA VERIFICATION RESULT: ${passCount}/${testCount} TESTS PASSED`);
console.log('─'.repeat(50) + '\n');

if (passCount !== testCount) {
    process.exit(1);
}
