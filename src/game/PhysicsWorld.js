import * as CANNON from 'cannon-es';

/**
 * PhysicsWorld — Manages the Cannon-es physics simulation.
 * 
 * Creates a world with gravity, a static platform matching the floating island,
 * and contact materials defining how players interact with each other and the ground.
 */
export class PhysicsWorld {
    /**
     * @param {Object} options
     * @param {number} options.platformRadius - Radius of the island platform (default: 25)
     * @param {number} options.gravity - Gravity magnitude (default: 9.82)
     */
    constructor(options = {}) {
        const platformRadius = options.platformRadius || 25;
        const gravity = options.gravity || 9.82;

        // --- World ---
        this.world = new CANNON.World();
        this.world.gravity.set(0, -gravity, 0);
        this.world.broadphase = new CANNON.SAPBroadphase(this.world);
        this.world.allowSleep = false; // All bodies stay active for responsive gameplay

        // --- Materials ---
        this.playerMaterial = new CANNON.Material('playerMaterial');
        this.platformMaterial = new CANNON.Material('platformMaterial');

        // Player vs Player: low friction, high bounce (sumo feel)
        const playerPlayerContact = new CANNON.ContactMaterial(
            this.playerMaterial,
            this.playerMaterial,
            { friction: 0.1, restitution: 0.7 }
        );

        // Player vs Platform: zero friction, low bounce (stable footing, custom sliding logic)
        const playerPlatformContact = new CANNON.ContactMaterial(
            this.playerMaterial,
            this.platformMaterial,
            { friction: 0.0, restitution: 0.1 }
        );

        this.world.addContactMaterial(playerPlayerContact);
        this.world.addContactMaterial(playerPlatformContact);

        // --- Platform ---
        this._createPlatform(platformRadius);
    }

    /**
     * Creates a static cylinder body that matches the grass disc surface.
     * The top face sits at Y = 0.
     * @param {number} radius
     */
    _createPlatform(radius) {
        const height = 1;
        const platformShape = new CANNON.Cylinder(radius, radius, height, 32);
        this.platformBody = new CANNON.Body({
            mass: 0, // Static
            material: this.platformMaterial,
            position: new CANNON.Vec3(0, -height / 2, 0) // Top surface at Y=0
        });
        this.platformBody.addShape(platformShape);
        this.world.addBody(this.platformBody);
    }

    /**
     * Steps the physics simulation forward.
     * Uses fixed timestep at 60Hz with up to 3 substeps for stability.
     * @param {number} deltaTime - Frame delta in seconds
     */
    step(deltaTime) {
        const fixedTimeStep = 1 / 60;
        const maxSubSteps = 3;
        this.world.step(fixedTimeStep, deltaTime, maxSubSteps);
    }

    /**
     * @param {CANNON.Body} body
     */
    addBody(body) {
        this.world.addBody(body);
    }

    /**
     * @param {CANNON.Body} body
     */
    removeBody(body) {
        this.world.removeBody(body);
    }
}
