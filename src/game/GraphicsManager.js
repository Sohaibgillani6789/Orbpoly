/**
 * GraphicsManager.js — Unified Graphics & Performance Preset Engine
 * 
 * Provides 3 fine-tuned graphics presets (Low, Medium, High) engineered
 * to guarantee stable 60 FPS across low-end mobile hardware, mid-tier devices,
 * and high-end desktop workstations.
 */

export const GRAPHICS_PRESETS = {
    low: {
        id: 'low',
        name: 'LOW',
        label: 'PERFORMANCE',
        badge: '⚡ 60 FPS',
        description: 'Best performance for budget mobile devices and older GPUs',
        dprMobile: 0.9,
        dprDesktop: 1.0,
        bladeCount: 40000,
        bladeWidth: 1.15, // Wider blades maintain full ground coverage
        dustMotesCount: 100,
        anisotropy: 1,
        orbPointLight: false,
        orbLightIntensity: 0,
        orbSmokeCount: 35,
        orbFireCount: 40,
        shadows: false,
    },
    medium: {
        id: 'medium',
        name: 'MEDIUM',
        label: 'BALANCED',
        badge: '⚖️ BALANCED',
        description: 'Smooth 60 FPS balance of crisp visuals and high performance',
        dprMobile: 1.15,
        dprDesktop: 1.4,
        bladeCount: 75000,
        bladeWidth: 0.90,
        dustMotesCount: 350,
        anisotropy: 2,
        orbPointLight: true,
        orbLightIntensity: 12,
        orbSmokeCount: 65,
        orbFireCount: 75,
        shadows: false,
    },
    high: {
        id: 'high',
        name: 'HIGH',
        label: 'ULTRA',
        badge: '✨ ULTRA',
        description: 'Maximum visual fidelity, ultra-dense grass, and rich effects',
        dprMobile: 1.4,
        dprDesktop: 2.0,
        bladeCount: 120000,
        bladeWidth: 0.80,
        dustMotesCount: 800,
        anisotropy: 4,
        orbPointLight: true,
        orbLightIntensity: 22,
        orbSmokeCount: 110,
        orbFireCount: 120,
        shadows: false,
    }
};

const STORAGE_KEY = 'orbpoly_graphics_quality';

class GraphicsManager {
    constructor() {
        this.listeners = new Set();
        this.currentPreset = 'medium';
        this.adaptiveScale = 1.0;
        this._isMobile = this._detectMobile();
        this._initPreset();
    }

    /**
     * Mobile device detection (synchronous & cached)
     */
    _detectMobile() {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || ('ontouchstart' in window && window.innerWidth < 1024);
    }

    isMobile() {
        return this._isMobile;
    }

    /**
     * Automatic hardware profiling for optimal out-of-the-box preset
     */
    detectOptimalPreset() {
        if (!this._isMobile) {
            // Check for very low hardware concurrency on desktop
            const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
            return cores <= 2 ? 'medium' : 'high';
        }

        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const memory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
        const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;

        // Low-end mobile devices (e.g. Infinix Smart 10, low RAM or <=4 cores)
        if (memory <= 4 || cores <= 4 || dpr > 2.5) {
            return 'low';
        }

        return 'medium';
    }

    _initPreset() {
        let saved = null;
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                saved = window.localStorage.getItem(STORAGE_KEY);
            }
        } catch (e) {
            // Storage access restricted (iframe / private browsing)
        }

        if (saved && GRAPHICS_PRESETS[saved]) {
            this.currentPreset = saved;
        } else {
            this.currentPreset = this.detectOptimalPreset();
        }
    }

    /**
     * Gets current preset ID ('low', 'medium', 'high')
     */
    getQuality() {
        return this.currentPreset;
    }

    /**
     * Gets current configuration object
     */
    getConfig() {
        return GRAPHICS_PRESETS[this.currentPreset];
    }

    /**
     * Sets graphics quality preset
     * @param {'low'|'medium'|'high'} presetId 
     * @param {boolean} [saveToStorage=true] 
     */
    setQuality(presetId, saveToStorage = true) {
        if (!GRAPHICS_PRESETS[presetId]) {
            console.warn(`[GraphicsManager] Unknown preset: ${presetId}, ignoring.`);
            return;
        }

        if (this.currentPreset === presetId && !saveToStorage) return;

        this.currentPreset = presetId;
        const config = GRAPHICS_PRESETS[presetId];

        if (saveToStorage) {
            try {
                if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.setItem(STORAGE_KEY, presetId);
                }
            } catch (e) {
                // Ignore storage write failure
            }
        }

        // Notify all registered listeners
        this.listeners.forEach(fn => {
            try {
                fn(presetId, config);
            } catch (err) {
                console.error('[GraphicsManager] Error in listener callback:', err);
            }
        });
    }

    /**
     * Calculates effective pixel ratio for Three.js WebGLRenderer
     */
    getEffectivePixelRatio() {
        const config = this.getConfig();
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

        if (this._isMobile) {
            return Math.max(0.75, Math.min(config.dprMobile * this.adaptiveScale, 1.5));
        }

        const targetDpr = Math.min(dpr, config.dprDesktop);
        return Math.max(0.85, targetDpr * this.adaptiveScale);
    }

    /**
     * Allows adaptive governor to slightly modulate scale during thermal throttle
     */
    setAdaptiveScale(scale) {
        this.adaptiveScale = Math.max(0.75, Math.min(scale, 1.0));
    }

    getAdaptiveScale() {
        return this.adaptiveScale;
    }

    /**
     * Subscribe to quality change events
     * @param {function(string, object): void} callback 
     * @returns {function(): void} unsubscribe
     */
    onQualityChange(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
}

export const graphicsManager = new GraphicsManager();
