/**
 * InputManager — Captures and exposes keyboard and mouse state.
 * 
 * Provides a polling-based API: check current state each frame
 * rather than reacting to events. This prevents missed inputs
 * and simplifies the game loop.
 */
export class InputManager {
    constructor() {
        /** @type {Object<string, boolean>} Currently pressed keys by KeyboardEvent.code */
        this.keys = {};

        this.mouseDelta = { x: 0, y: 0 };
        /** @private Reusable result object for zero allocations per frame */
        this._deltaResult = { x: 0, y: 0 };

        /** @private */
        this._primaryAttack = false;
        /** @private */
        this._primaryAttackReleased = false;
        /** @private */
        this._doubleAttack = false;
        /** @private */
        this._secondaryAttack = false;

        /** @private */
        this._barge = false;

        /** @private */
        this._shield = false;

        /** @private */
        this._isPrimaryDown = false;

        /** @private */
        this._jump = false;

        /** @private */
        this._enabled = true;

        // Bind handlers so we can remove them on dispose
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onDoubleClick = this._onDoubleClick.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onBlur = this._onBlur.bind(this);
        this._onVisibilityChange = this._onVisibilityChange.bind(this);

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('dblclick', this._onDoubleClick);
        window.addEventListener('contextmenu', this._onContextMenu);
        window.addEventListener('blur', this._onBlur);
        document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    /** @private */
    _onKeyDown(e) {
        if (!this._enabled) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        this.keys[e.code] = true;
        if (e.code === 'Space' && !e.repeat) {
            this._jump = true;
        }
        if (e.code === 'KeyF' && !e.repeat) {
            this._shield = true;
        }
    }

    /** @private */
    _onKeyUp(e) {
        this.keys[e.code] = false;
    }

    /** @private */
    _onMouseDown(e) {
        if (!this._enabled) return;
        
        // Request pointer lock on canvas click if not locked
        if (e.target.tagName === 'CANVAS' && !document.pointerLockElement) {
            e.target.requestPointerLock();
        }

        // Left click
        if (e.button === 0) {
            this._primaryAttack = true;
            this._isPrimaryDown = true;
        } 
        // Middle click — Barge
        else if (e.button === 1) {
            this._barge = true;
        }
        // Right click
        else if (e.button === 2) {
            this._secondaryAttack = true;
        }
    }

    /** @private */
    _onMouseUp(e) {
        if (!this._enabled) return;

        // Left click release
        if (e.button === 0) {
            this._isPrimaryDown = false;
            this._primaryAttackReleased = true;
        }
    }

    /** @private */
    _onDoubleClick(e) {
        if (!this._enabled) return;
        if (e.button === 0) {
            this._doubleAttack = true;
            this._primaryAttack = false; // Override pending single click if any
        }
    }

    /** @private */
    _onMouseMove(e) {
        if (!this._enabled) return;
        if (document.pointerLockElement) {
            this.mouseDelta.x += e.movementX;
            this.mouseDelta.y += e.movementY;
        }
    }

    /** @private — Prevent right-click context menu during gameplay */
    _onContextMenu(e) {
        if (this._enabled) {
            e.preventDefault();
        }
    }

    /** Resets all active inputs and clears key states */
    reset() {
        this.keys = {};
        this._primaryAttack = false;
        this._primaryAttackReleased = false;
        this._isPrimaryDown = false;
        this._secondaryAttack = false;
        this._doubleAttack = false;
        this._jump = false;
        this._barge = false;
        this._shield = false;
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
    }

    /** @private Clear pressed inputs on window blur (alt-tab, ad overlay) */
    _onBlur() {
        this.reset();
    }

    /** @private Clear inputs when tab is hidden */
    _onVisibilityChange() {
        if (document.hidden) {
            this.reset();
        }
    }

    /**
     * Returns a normalized movement vector from WASD keys.
     * Diagonal movement is normalized to prevent faster diagonal speed.
     * @returns {{ x: number, z: number }}
     */
    getMovementVector() {
        let x = 0;
        let z = 0;

        if (this.keys['KeyW']) z -= 1;
        if (this.keys['KeyS']) z += 1;
        if (this.keys['KeyA']) x -= 1;
        if (this.keys['KeyD']) x += 1;

        // Normalize for consistent diagonal speed
        const length = Math.sqrt(x * x + z * z);
        if (length > 0) {
            x /= length;
            z /= length;
        }

        return { x, z };
    }

    /**
     * Consumes and returns the primary attack flag.
     * @returns {boolean}
     */
    consumePrimaryAttack() {
        const clicked = this._primaryAttack;
        this._primaryAttack = false;
        return clicked;
    }

    /**
     * Consumes and returns the primary attack release flag.
     * @returns {boolean}
     */
    consumePrimaryRelease() {
        const released = this._primaryAttackReleased;
        this._primaryAttackReleased = false;
        return released;
    }

    /**
     * Returns true if the primary attack (left click) is currently held down.
     * @returns {boolean}
     */
    get isPrimaryDown() {
        return this._isPrimaryDown;
    }

    /**
     * Consumes and returns the secondary attack flag.
     * @returns {boolean}
     */
    consumeSecondaryAttack() {
        const clicked = this._secondaryAttack;
        this._secondaryAttack = false;
        return clicked;
    }

    /**
     * Consumes and returns the double attack flag.
     * @returns {boolean}
     */
    consumeDoubleAttack() {
        const clicked = this._doubleAttack;
        this._doubleAttack = false;
        return clicked;
    }

    /**
     * Consumes and returns the jump flag.
     * @returns {boolean}
     */
    consumeJump() {
        const jumped = this._jump;
        this._jump = false;
        return jumped;
    }

    /**
     * Consumes and returns the barge (middle click) flag.
     * @returns {boolean}
     */
    consumeBarge() {
        const val = this._barge;
        this._barge = false;
        return val;
    }

    /**
     * Consumes and returns the shield (F key) flag.
     * @returns {boolean}
     */
    consumeShield() {
        const val = this._shield;
        this._shield = false;
        return val;
    }

    /**
     * Consumes and returns the mouse movement delta.
     * @returns {{x: number, y: number}}
     */
    consumeMouseDelta() {
        this._deltaResult.x = this.mouseDelta.x;
        this._deltaResult.y = this.mouseDelta.y;
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
        return this._deltaResult;
    }

    /** @param {boolean} val */
    set enabled(val) {
        this._enabled = val;
        if (!val) {
            // Clear all keys when disabled
            this.keys = {};
            this._primaryAttack = false;
            this._primaryAttackReleased = false;
            this._isPrimaryDown = false;
            this._secondaryAttack = false;
            this._doubleAttack = false;
            this._jump = false;
            this._barge = false;
            this._shield = false;
        }
    }

    /** @returns {boolean} */
    get enabled() {
        return this._enabled;
    }

    /** Clean up event listeners */
    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('dblclick', this._onDoubleClick);
        window.removeEventListener('contextmenu', this._onContextMenu);
        window.removeEventListener('blur', this._onBlur);
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this.reset();
    }
}
