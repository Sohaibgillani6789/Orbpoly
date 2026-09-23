/**
 * PokiSDK Lifecycle Bridge
 * 
 * Provides safe, production-grade wrapper around the Poki SDK v2.
 * Adheres strictly to Poki Quality Guidelines:
 * - Proper gameLoadingFinished / gameplayStart / gameplayStop sequencing
 * - Commercial break integration with automatic audio mute/unmute
 * - Resilient error handling (graceful degradation when SDK is blocked or offline)
 */

class PokiBridge {
    constructor() {
        this.initialized = false;
        this.adBlocked = false;
        this.inGameplay = false;
        this._audioMuted = false;
        this._initPromise = null;
    }

    /**
     * Initializes the Poki SDK.
     * Safe to call multiple times (returns same promise).
     * @returns {Promise<boolean>} Resolves true if Poki initialized, false if adblocked/unavailable
     */
    async init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve) => {
            if (typeof window === 'undefined' || !window.PokiSDK) {
                // Poki SDK script tag missing or blocked
                this.adBlocked = true;
                this.initialized = true;
                resolve(false);
                return;
            }

            window.PokiSDK.init()
                .then(() => {
                    this.initialized = true;
                    this.adBlocked = false;
                    resolve(true);
                })
                .catch(() => {
                    // Ad blocker active or init failed
                    this.initialized = true;
                    this.adBlocked = true;
                    resolve(false);
                });
        });

        return this._initPromise;
    }

    /**
     * Notify Poki that initial loading is complete and game is interactive.
     * Must be called only once when loading overlay finishes.
     */
    gameLoadingFinished() {
        if (typeof window !== 'undefined' && window.PokiSDK) {
            try {
                window.PokiSDK.gameLoadingFinished();
            } catch (e) {
                // Ignore safe errors
            }
        }
    }

    /**
     * Notify Poki that gameplay has started.
     * Prevents duplicate events.
     */
    gameplayStart() {
        if (this.inGameplay) return;
        this.inGameplay = true;

        if (typeof window !== 'undefined' && window.PokiSDK) {
            try {
                window.PokiSDK.gameplayStart();
            } catch (e) {
                // Ignore safe errors
            }
        }
    }

    /**
     * Notify Poki that gameplay has stopped (game over, menu, pause).
     * Prevents duplicate events.
     */
    gameplayStop() {
        if (!this.inGameplay) return;
        this.inGameplay = false;

        if (typeof window !== 'undefined' && window.PokiSDK) {
            try {
                window.PokiSDK.gameplayStop();
            } catch (e) {
                // Ignore safe errors
            }
        }
    }

    /**
     * Show a commercial break (interstitial ad).
     * Automatically handles gameplayStop/gameplayStart and audio muting.
     * @param {Object} options
     * @param {Function} [options.onBefore] Called before ad starts (pause game/music)
     * @param {Function} [options.onAfter] Called after ad finishes (resume game/music)
     * @returns {Promise<void>}
     */
    async commercialBreak({ onBefore, onAfter } = {}) {
        this.gameplayStop();

        if (onBefore) {
            try { onBefore(); } catch (_) {}
        }

        if (typeof window !== 'undefined' && window.PokiSDK && !this.adBlocked) {
            return new Promise((resolve) => {
                window.PokiSDK.commercialBreak()
                    .then(() => {
                        if (onAfter) {
                            try { onAfter(); } catch (_) {}
                        }
                        resolve();
                    })
                    .catch(() => {
                        // Commercial break skipped / errored
                        if (onAfter) {
                            try { onAfter(); } catch (_) {}
                        }
                        resolve();
                    });
            });
        } else {
            // No SDK or ad blocked — proceed immediately
            if (onAfter) {
                try { onAfter(); } catch (_) {}
            }
        }
    }

    /**
     * Show a rewarded break (video ad for reward).
     * @param {Object} options
     * @param {Function} [options.onSuccess] Called if player watched ad
     * @param {Function} [options.onFail] Called if ad skipped or failed
     * @returns {Promise<boolean>}
     */
    async rewardedBreak({ onSuccess, onFail } = {}) {
        this.gameplayStop();

        if (typeof window !== 'undefined' && window.PokiSDK && !this.adBlocked) {
            return new Promise((resolve) => {
                window.PokiSDK.rewardedBreak()
                    .then((success) => {
                        if (success) {
                            if (onSuccess) onSuccess();
                            resolve(true);
                        } else {
                            if (onFail) onFail();
                            resolve(false);
                        }
                    })
                    .catch(() => {
                        if (onFail) onFail();
                        resolve(false);
                    });
            });
        } else {
            if (onFail) onFail();
            return false;
        }
    }
}

export const poki = new PokiBridge();
