/**
 * HUD — HTML/CSS overlay for game UI elements.
 * 
 * Projects 3D character positions to 2D screen coordinates and renders
 * floating damage percentages above each player. Color shifts from
 * white → yellow → red as damage increases.
 */
export class HUD {
    constructor() {
        /** @type {HTMLElement} */
        this.container = null;

        /** @type {Map<string, HTMLElement>} playerId → DOM element */
        this.playerElements = new Map();

        this._createContainer();
    }

    /**
     * Creates or locates the HUD container element.
     * @private
     */
    _createContainer() {
        this.container = document.getElementById('game-hud');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'game-hud';
            document.body.appendChild(this.container);
        }
    }

    /**
     * Adds a player HUD element.
     * @param {string} playerId
     * @param {string} name - Display name
     */
    addPlayer(playerId, name) {
        const el = document.createElement('div');
        el.className = 'player-hud';
        el.id = `player-hud-${playerId}`;
        el.innerHTML = `
            <div class="player-name">${name}</div>
            <div class="damage-display">0%</div>
            <div class="lives-display"></div>
        `;
        this.container.appendChild(el);
        this.playerElements.set(playerId, el);
    }

    /**
     * Updates a player's HUD position and damage display.
     * @param {string} playerId
     * @param {number} damagePercent
     * @param {number} lives
     * @param {{ x: number, y: number, visible: boolean }} screenPos
     */
    updatePlayer(playerId, damagePercent, lives, screenPos) {
        const el = this.playerElements.get(playerId);
        if (!el) return;

        // Position on screen
        el.style.transform = `translate(-50%, -100%) translate(${screenPos.x}px, ${screenPos.y}px)`;

        // Damage text
        const damageDisplay = el.querySelector('.damage-display');
        damageDisplay.textContent = `${Math.round(damagePercent)}%`;

        // Color shift: white(0%) → yellow(75%) → red(150%+)
        const t = Math.min(damagePercent / 150, 1);
        const r = 255;
        const g = Math.round(255 * (1 - t * 0.8));
        const b = Math.round(255 * (1 - t));
        damageDisplay.style.color = `rgb(${r}, ${g}, ${b})`;

        // Lives display (hearts)
        const livesDisplay = el.querySelector('.lives-display');
        livesDisplay.textContent = '❤️'.repeat(Math.max(0, lives));

        // Visibility
        el.style.display = screenPos.visible ? 'block' : 'none';
    }

    /**
     * Shows a "KO!" flash animation over a player.
     * @param {string} playerId
     */
    showKO(playerId) {
        const el = this.playerElements.get(playerId);
        if (!el) return;

        const ko = document.createElement('div');
        ko.className = 'ko-flash';
        ko.textContent = 'KO!';
        el.appendChild(ko);

        // Auto-remove after animation
        setTimeout(() => {
            if (ko.parentNode) ko.remove();
        }, 1500);
    }

    /**
     * Projects a 3D world position to 2D screen coordinates.
     * @param {THREE.Vector3} position3D - Character model position
     * @param {THREE.Camera} camera
     * @returns {{ x: number, y: number, visible: boolean }}
     */
    projectToScreen(position3D, camera) {
        const pos = position3D.clone();
        pos.y += 2.0; // Offset above character head
        pos.project(camera);

        const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
        const y = (pos.y * -0.5 + 0.5) * window.innerHeight;

        // Behind camera check
        const visible = pos.z < 1;

        return { x, y, visible };
    }

    /**
     * Removes a player HUD element.
     * @param {string} playerId
     */
    removePlayer(playerId) {
        const el = this.playerElements.get(playerId);
        if (el) {
            el.remove();
            this.playerElements.delete(playerId);
        }
    }

    /** Clean up all HUD elements */
    dispose() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.playerElements.clear();
    }
}
