import * as THREE from 'three';

/**
 * Canonical animation state names.
 */
export const AnimState = Object.freeze({
    IDLE: 'idle',
    RUN: 'run',
    JUMP: 'jump',
    PUNCH: 'punch',
    SWORD_ATTACK_2: 'swordAttack2',
    SWORD_ATTACK: 'swordAttack',
    BOW_DRAW: 'bowDraw',
    BOW_SHOOT: 'bowShoot',
    STAFF_ATTACK: 'staffAttack',
    RECEIVE_HIT: 'receiveHit',
    DEATH: 'death',
    FALLING: 'falling'
});

/** States where movement input is locked */
const LOCKED_STATES = new Set([AnimState.PUNCH, AnimState.SWORD_ATTACK, AnimState.SWORD_ATTACK_2, AnimState.BOW_DRAW, AnimState.BOW_SHOOT, AnimState.STAFF_ATTACK, AnimState.RECEIVE_HIT, AnimState.DEATH]);

/** States that play only once (non-looping) */
const ONE_SHOT_STATES = new Set([AnimState.PUNCH, AnimState.SWORD_ATTACK, AnimState.SWORD_ATTACK_2, AnimState.BOW_DRAW, AnimState.BOW_SHOOT, AnimState.STAFF_ATTACK, AnimState.RECEIVE_HIT, AnimState.DEATH, AnimState.JUMP]);

/**
 * Name patterns to auto-detect animation clips from GLTF.
 * Each AnimState maps to an array of possible clip name substrings (case-insensitive).
 */
const ANIM_NAME_PATTERNS = {
    [AnimState.IDLE]: ['idle_attacking', 'idle_weapon', 'idle'],
    [AnimState.RUN]: ['run_weapon', 'run'],
    [AnimState.JUMP]: ['jump'],
    [AnimState.FALLING]: ['fall', 'air'],
    [AnimState.PUNCH]: ['punch', 'unarmed'],
    [AnimState.SWORD_ATTACK_2]: ['combo', 'attack2', 'slash2', 'swing2', 'heavy', 'spin', '2'],
    [AnimState.SWORD_ATTACK]: ['slash', 'sword', 'slice', 'swing', 'attack'],
    [AnimState.BOW_DRAW]: ['bow_draw', 'draw_bow', 'draw'],
    [AnimState.BOW_SHOOT]: ['bow_shoot', 'shoot', 'fire'],
    [AnimState.STAFF_ATTACK]: ['staff_attack', 'staff'],
    [AnimState.RECEIVE_HIT]: ['hit', 'receiv', 'hurt', 'damage'],
    [AnimState.DEATH]: ['death', 'die', 'dead']
};

/**
 * AnimationStateMachine — Finite state machine for character animations.
 * 
 * Auto-detects animation clips by NAME from the GLTF (not by index).
 * Falls back to index-based mapping if names don't match.
 */
export class AnimationStateMachine {
    /**
     * @param {THREE.AnimationMixer} mixer
     * @param {THREE.AnimationClip[]} clips - Animation clips from GLTF
     */
    constructor(mixer, clips) {
        this.mixer = mixer;
        this.actions = {};
        this.currentState = null;
        this.locked = false;

        // Auto-detect animations by name
        this._buildActionsFromNames(clips);

        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
            const found = Object.keys(this.actions).join(', ');
            console.log(`🎬 AnimSM mapped: [${found}] from ${clips.length} clips`);
        }

        // Listen for animation completion (one-shot → return to idle)
        this._onFinished = this._onAnimationFinished.bind(this);
        mixer.addEventListener('finished', this._onFinished);

        // Start in idle
        this.setState(AnimState.IDLE);
    }

    /**
     * Matches GLTF clip names to AnimState keys using substring patterns.
     * @private
     */
    _buildActionsFromNames(clips) {
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
            console.log('📋 Available clips:', clips.map((c, i) => `${i}:${c.name}`).join(', '));
        }

        const assignedClips = new Set();

        for (const [stateName, patterns] of Object.entries(ANIM_NAME_PATTERNS)) {
            const clip = this._findClipByName(clips, patterns, assignedClips);
            if (clip) {
                assignedClips.add(clip);
                const action = this.mixer.clipAction(clip);

                if (ONE_SHOT_STATES.has(stateName)) {
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                }

                this.actions[stateName] = action;
            } else if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
                console.warn(`⚠️ AnimSM: No clip found for "${stateName}" (searched: ${patterns.join(', ')})`);
            }
        }
    }

    /**
     * Finds a clip whose name contains any of the given patterns (case-insensitive).
     * @private
     */
    _findClipByName(clips, patterns, assignedClips) {
        for (const pattern of patterns) {
            const match = clips.find(c => !assignedClips.has(c) && c.name.toLowerCase().includes(pattern.toLowerCase()));
            if (match) return match;
        }
        return null;
    }

    /**
     * Transitions to a new animation state with cross-fading.
     * @param {string} newState
     */
    setState(newState) {
        // Allow combo override: SWORD_ATTACK -> SWORD_ATTACK_2
        const isCombo = (this.currentState === AnimState.SWORD_ATTACK && newState === AnimState.SWORD_ATTACK_2) || 
                        (this.currentState === AnimState.BOW_DRAW && newState === AnimState.BOW_SHOOT);
        // RECEIVE_HIT and DEATH can interrupt any state
        const isInterrupt = newState === AnimState.DEATH || newState === AnimState.RECEIVE_HIT;
        if (this.locked && !isInterrupt && !isCombo) return;
        if (this.currentState === newState) return;

        const newAction = this.actions[newState];
        if (!newAction) return;

        const oldAction = this.currentState ? this.actions[this.currentState] : null;

        newAction.reset();
        newAction.setEffectiveTimeScale(1);
        newAction.setEffectiveWeight(1);
        newAction.play();

        if (oldAction) {
            // RECEIVE_HIT snaps fast (0.05s) so the stagger is immediate
            const fadeTime = newState === AnimState.RECEIVE_HIT ? 0.05 : 0.2;
            oldAction.crossFadeTo(newAction, fadeTime, true);
        }

        this.currentState = newState;

        if (LOCKED_STATES.has(newState)) {
            this.locked = true;
        }
    }

    /** @private */
    _onAnimationFinished(event) {
        const currentAction = this.currentState ? this.actions[this.currentState] : null;
        if (event && event.action && currentAction && event.action !== currentAction) {
            return;
        }

        const st = this.currentState;
        if (st === AnimState.PUNCH || st === AnimState.SWORD_ATTACK || st === AnimState.SWORD_ATTACK_2 ||
            st === AnimState.STAFF_ATTACK || st === AnimState.RECEIVE_HIT || st === AnimState.BOW_SHOOT ||
            st === AnimState.BOW_DRAW) {
            this.locked = false;
            this.setState(AnimState.IDLE);
        }
    }

    /**
     * @param {number} deltaTime
     */
    update(deltaTime) {
        this.mixer.update(deltaTime);
    }

    get isLocked() {
        return this.locked;
    }

    forceUnlock() {
        this.locked = false;
    }

    dispose() {
        this.mixer.removeEventListener('finished', this._onFinished);
    }
}
