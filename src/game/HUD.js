import * as THREE from 'three';

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

        /** @type {Map<string, { el: HTMLElement, damageDisplay: HTMLElement, livesDisplay: HTMLElement }>} playerId → DOM element cache */
        this.playerElements = new Map();

        /** @private Scratch vector for 3D projection (zero heap allocations per frame) */
        this._projVec = new THREE.Vector3();
        /** @private Scratch result object for projection */
        this._projResult = { x: 0, y: 0, visible: true };

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
        this.playerElements.set(playerId, {
            el,
            damageDisplay: el.querySelector('.damage-display'),
            livesDisplay: el.querySelector('.lives-display')
        });
    }

    /**
     * Updates a player's HUD position and damage display.
     * @param {string} playerId
     * @param {number} damagePercent
     * @param {number} lives
     * @param {{ x: number, y: number, visible: boolean }} screenPos
     */
    updatePlayer(playerId, damagePercent, lives, screenPos) {
        const item = this.playerElements.get(playerId);
        if (!item) return;

        // Position on screen — use CSS transform, skip if within 1px tolerance
        const px = Math.round(screenPos.x);
        const py = Math.round(screenPos.y);
        if (item._lastPx !== px || item._lastPy !== py) {
            item.el.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`;
            item._lastPx = px;
            item._lastPy = py;
        }

        // Damage text — only update when changed (mobileopt.md: dirty-flag HUD)
        const roundedDamage = Math.round(damagePercent);
        if (item.damageDisplay && item._lastDamage !== roundedDamage) {
            item.damageDisplay.textContent = `${roundedDamage}%`;
            item._lastDamage = roundedDamage;

            // Color shift: white(0%) → yellow(75%) → red(150%+)
            const t = Math.min(damagePercent / 150, 1);
            const r = 255;
            const g = Math.round(255 * (1 - t * 0.8));
            const b = Math.round(255 * (1 - t));
            item.damageDisplay.style.color = `rgb(${r}, ${g}, ${b})`;
        }

        // Lives display (hearts) — only update when changed
        if (item.livesDisplay && item._lastLives !== lives) {
            item.livesDisplay.textContent = '❤️'.repeat(Math.max(0, lives));
            item._lastLives = lives;
        }

        // Visibility — only toggle when changed
        const vis = screenPos.visible ? 'block' : 'none';
        if (item._lastVis !== vis) {
            item.el.style.display = vis;
            item._lastVis = vis;
        }
    }

    /**
     * Shows a "KO!" flash animation over a player.
     * @param {string} playerId
     */
    showKO(playerId) {
        const item = this.playerElements.get(playerId);
        if (!item) return;

        const ko = document.createElement('div');
        ko.className = 'ko-flash';
        ko.textContent = 'KO!';
        item.el.appendChild(ko);

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
        this._projVec.copy(position3D);
        this._projVec.y += 2.0; // Offset above character head
        this._projVec.project(camera);

        this._projResult.x = (this._projVec.x * 0.5 + 0.5) * window.innerWidth;
        this._projResult.y = (this._projVec.y * -0.5 + 0.5) * window.innerHeight;
        this._projResult.visible = this._projVec.z < 1;

        return this._projResult;
    }

    /**
     * Removes a player HUD element.
     * @param {string} playerId
     */
    removePlayer(playerId) {
        const item = this.playerElements.get(playerId);
        if (item) {
            item.el.remove();
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
