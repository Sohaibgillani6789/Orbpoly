import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'lil-gui'
import grassVertexShader from './shaders/grassVertex.glsl';
import grassFragmentShader from './shaders/grassFragment.glsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import skyVertexShader from './shaders/skyVertex.glsl';
import skyFragmentShader from './shaders/skyFragment.glsl';
import rockVertexShader from './shaders/rockVertex.glsl';
import rockFragmentShader from './shaders/rockFragment.glsl';

import { noise3D, fbm3D } from './simplex3d.js';
import { Tree } from '@dgreenheck/ez-tree';
import { GameManager } from './game/GameManager.js';
import { NetworkManager } from './game/NetworkManager.js';

// All available character IDs for random bot selection
const ALL_CHARACTERS = ['warrior', 'wizard', 'rogue', 'ranger', 'monk', 'cleric'];

// Scene initialization state — must be declared before loading manager callback
let sceneInitialized = false;

// First, let's create a Promise-based asset loader
const loadingPromises = [];

// Loading Manager modification
const loadingManager = new THREE.LoadingManager(
    // Loaded
    () => {
        console.log('📦 All assets loaded by LoadingManager');
        Promise.all(loadingPromises).then(() => {
            console.log('🤝 All loadingPromises resolved');
            window.setTimeout(() => {
                const loaderOverlay = document.getElementById('loading-overlay');
                if (loaderOverlay) {
                    console.log('⏳ Fading out loader');
                    loaderOverlay.style.opacity = '0';
                    setTimeout(() => {
                        loaderOverlay.remove();
                        initializeScene();
                    }, 500);
                } else {
                    initializeScene();
                }
            }, 500);
        });
    },
    // Progress
    (itemUrl, itemsLoaded, itemsTotal) => {
        const progressRatio = itemsLoaded / itemsTotal;
        console.log(`🚀 Loading progress: ${Math.round(progressRatio * 100)}% (${itemUrl})`);
        const loaderBar = document.getElementById('loading-bar');
        const loaderBg = document.getElementById('loading-bg');
        if (loaderBar) {
            loaderBar.style.transform = `scaleX(${progressRatio})`;
        }
        if (loaderBg) {
            loaderBg.style.opacity = 0.2 + (0.8 * progressRatio);
        }
    },
    // Error
    (url) => {
        console.error('❌ Error loading:', url);
    }
);

// Texture loader (must be before any texture loads)
const textureLoader = new THREE.TextureLoader(loadingManager);

// Add Audio
const listener = new THREE.AudioListener();
const sound = new THREE.Audio(listener);
const audioLoader = new THREE.AudioLoader(loadingManager);

// Load the audio but don't play it yet
let audioBuffer = null;
audioLoader.load(
    '/sounds/lol.mp3',
    (buffer) => {
        audioBuffer = buffer;
        console.log("✅ Audio loaded and ready to play");
    },
    (progress) => {
        console.log('Audio loading:', (progress.loaded / progress.total * 100) + '% loaded');
    },
    (error) => {
        console.error('Error loading audio:', error);
    }
);

// Setup play button functionality
const playButton = document.querySelector('.play-button');
playButton.addEventListener('pointerdown', (e) => e.stopPropagation());
playButton.addEventListener('click', () => {
    if (!sound.isPlaying) {
        // Resume AudioContext if it was suspended
        if (listener.context.state === 'suspended') {
            listener.context.resume();
        }

        // Set up and play the sound if it's not already playing
        if (!sound.buffer) {
            sound.setBuffer(audioBuffer);
            sound.setLoop(true);
            sound.setVolume(0.5);
        }
        sound.play();

        // Update button icon to pause (optional)
        playButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24px" height="24px">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
        `;
    } else {
        sound.pause();
        // Update button icon back to play
        playButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24px" height="24px">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
    }
});

// Grass
const grassTexture = textureLoader.load(
    '/textures/grass/grass.jpg',
    () => console.log("✅ Grass texture loaded")
);
grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.colorSpace = THREE.SRGBColorSpace;

// Clouds
const cloudTexture = textureLoader.load(
    '/textures/clouds/cloud.jpg',
    () => console.log("✅ Cloud texture loaded")
);
cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping;
cloudTexture.repeat.set(2, 2);
cloudTexture.colorSpace = THREE.SRGBColorSpace;

// --- GRASS SHADER SYSTEM ---
const PLANE_SIZE = 50;
const BLADE_COUNT = 120000;
const BLADE_WIDTH = 0.8;           // Wider blades — each covers more ground area
const BLADE_HEIGHT = 0.45;
const BLADE_HEIGHT_VARIATION = 0.25;

// Time uniform for animation
const timeUniform = { value: 0.0 };

// Shader uniforms for grass
const grassUniforms = {
    textures: { value: [grassTexture, cloudTexture] },
    iTime: { value: 0.0 },
    uGrassContrast: { value: 1.38 },
    uGrassBrightness: { value: 0.05 },
    uCloudMix: { value: 0.15 },
    uWaveSize: { value: 10.0 },
    uTipDistance: { value: 0.3 },
    uCenterDistance: { value: 0.1 },
    // Lighting & color uniforms
    uSunDirection: { value: new THREE.Vector3(0.4, 0.6, 0.8).normalize() },
    uAmbientLightColor: { value: new THREE.Color('#b9d5ff') }, // Synced from scene ambient light
    uAOStrength: { value: 0.75 },
    uSSSStrength: { value: 0.35 },
    uHueVariation: { value: 1.0 },
    // Mood tinting (time-of-day color shift)
    uMoodTint: { value: new THREE.Color(1.0, 1.0, 1.0) },       // Neutral white = no tint
    uMoodTintStrength: { value: 0.0 },                           // 0 = day (no tint)
};

const grassMaterial = new THREE.ShaderMaterial({
    uniforms: grassUniforms,
    vertexShader: grassVertexShader,
    fragmentShader: grassFragmentShader,
    vertexColors: true,
    side: THREE.DoubleSide
});

// ...existing code...

function convertRange(val, oldMin, oldMax, newMin, newMax) {
    return (((val - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
}

// Pooled vectors for generateBlade — avoids 7+ allocations per blade (opt.md §1)
const _yawUnitVec = new THREE.Vector3();
const _tipBendUnitVec = new THREE.Vector3();
const _bl = new THREE.Vector3();
const _br = new THREE.Vector3();
const _tl = new THREE.Vector3();
const _tr = new THREE.Vector3();
const _tc = new THREE.Vector3();
const _tempVec = new THREE.Vector3();

function generateBlade(center, vArrOffset, uv) {
    const MID_WIDTH = BLADE_WIDTH * 0.65;  // Wider mid-section (was 0.5) — retains coverage through blade body
    const TIP_OFFSET = 0.18;               // Tip droops into neighboring empty space
    const height = BLADE_HEIGHT + (Math.random() * BLADE_HEIGHT_VARIATION);

    const yaw = Math.random() * Math.PI * 2;
    _yawUnitVec.set(Math.sin(yaw), 0, -Math.cos(yaw));
    const tipBend = Math.random() * Math.PI * 2;
    _tipBendUnitVec.set(Math.sin(tipBend), 0, -Math.cos(tipBend));

    // Outward lean — blades fan out from root, covering gaps between neighbors
    // This is the primary gap-filling technique: each blade's tip reaches into
    // the empty space around its base, so from above the field looks dense
    const leanStrength = 0.35;
    const leanX = (Math.random() - 0.5) * leanStrength;
    const leanZ = (Math.random() - 0.5) * leanStrength;

    // Base vertices (ground level, full blade width)
    _bl.copy(center).add(_tempVec.copy(_yawUnitVec).multiplyScalar(BLADE_WIDTH / 2));
    _br.copy(center).add(_tempVec.copy(_yawUnitVec).multiplyScalar(-BLADE_WIDTH / 2));

    // Mid vertices — wider ratio keeps coverage, lean shifts them outward
    _tl.copy(center).add(_tempVec.copy(_yawUnitVec).multiplyScalar(MID_WIDTH / 2));
    _tl.x += leanX * 0.4;
    _tl.z += leanZ * 0.4;
    _tr.copy(center).add(_tempVec.copy(_yawUnitVec).multiplyScalar(-MID_WIDTH / 2));
    _tr.x += leanX * 0.4;
    _tr.z += leanZ * 0.4;

    // Tip — full lean applied, bends outward into neighboring space
    _tc.copy(center).add(_tempVec.copy(_tipBendUnitVec).multiplyScalar(TIP_OFFSET));
    _tc.x += leanX;
    _tc.z += leanZ;

    _tl.y += height / 2;
    _tr.y += height / 2;
    _tc.y += height;

    const black = [0, 0, 0];
    const gray = [0.5, 0.5, 0.5];
    const white = [1.0, 1.0, 1.0];

    const verts = [
        { pos: _bl.toArray(), uv: uv, color: black },
        { pos: _br.toArray(), uv: uv, color: black },
        { pos: _tr.toArray(), uv: uv, color: gray },
        { pos: _tl.toArray(), uv: uv, color: gray },
        { pos: _tc.toArray(), uv: uv, color: white }
    ];

    const indices = [
        vArrOffset, vArrOffset + 1, vArrOffset + 2,
        vArrOffset + 2, vArrOffset + 4, vArrOffset + 3,
        vArrOffset + 3, vArrOffset, vArrOffset + 2
    ];

    return { verts, indices };
}





function generateField() {
    const positions = [];
    const uvs = [];
    const indices = [];
    const colors = [];

    for (let i = 0; i < BLADE_COUNT; i++) {
        const VERTEX_COUNT = 5;
        const radius = PLANE_SIZE / 2;
        const r = radius * Math.sqrt(Math.random());
        const theta = Math.random() * 2 * Math.PI;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const pos = new THREE.Vector3(x, 0, y);

        const surfaceMin = PLANE_SIZE / 2 * -1;
        const surfaceMax = PLANE_SIZE / 2;
        const uv = [
            convertRange(pos.x, surfaceMin, surfaceMax, 0, 1),
            convertRange(pos.z, surfaceMin, surfaceMax, 0, 1)
        ];
        const blade = generateBlade(pos, i * VERTEX_COUNT, uv);
        blade.verts.forEach(vert => {
            positions.push(...vert.pos);
            uvs.push(...vert.uv);
            colors.push(...vert.color);
        });
        blade.indices.forEach(indice => indices.push(indice));
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);

    const mesh = new THREE.Mesh(geom, grassMaterial);
    geom.computeBoundingSphere(); // Frustum culling (opt.md §5)
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
}


const ambientColor = new THREE.Color(0x333333); // A dark gray ambient light
const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(10, 10, 10);



// Characters
let loadedCharacterData = null;

async function loadCharacters(charId) {
    const gltfLoader = new GLTFLoader(); // Do not use initial loadingManager

    const modelName = charId.charAt(0).toUpperCase() + charId.slice(1);

    const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(`/models/characters/${modelName}.gltf`, resolve, undefined, reject);
    });

    const { scene: model, animations = [] } = gltf;

    // Position at center of island
    model.position.set(0, 0, 0);

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    scene.add(model);

    loadedCharacterData = {
        name: modelName,
        model,
        animations
    };

    console.log(`✅ ${modelName} loaded (${animations.length} animations):`,
        animations.map(a => a.name));

    return loadedCharacterData;
}







// Canvas
const canvas = document.querySelector('canvas.webgl');

// Scene
const scene = new THREE.Scene();

// ============================================================
// PIXAR SKY SYSTEM
// ============================================================
const skyUniforms = {
    uTime: { value: 0.0 },
    uSunPosition: { value: new THREE.Vector3(0.4, 0.35, 0.8).normalize() },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uSkyColorTop: { value: new THREE.Color('#3da5f5') },     // Bright sky blue
    uSkyColorBottom: { value: new THREE.Color('#67bdfe') },  // Bright sky blue (solid)
    uCloudColor: { value: new THREE.Color('#ffffff') },      // Pure white highlights
    uCloudShadowColor: { value: new THREE.Color('#e6f0fa') },// Very light blueish white for subtle volume
    uCloudSpeed: { value: 0.008 },                            // Wind speed
    uCloudDensity: { value: 0.68 },                           // Coverage threshold (0.5 = ~50% sky, matches reference)
    uSunIntensity: { value: 1.2 },                           // Sun brightness
    uNightBlend: { value: 0.0 },                              // 0=day/evening, 1=night (starfield)
    uMoonDirection: { value: new THREE.Vector3(22, 18, -42).normalize() }, // Moon direction for sky glow
    uMoonGlow: { value: 0.0 },                                // Moon glow intensity (0=off, 1=full)
};

// ============================================================
// TIME-OF-DAY MOOD SYSTEM
// ============================================================

/**
 * Mood profiles — exact target values for each time-of-day state.
 * Day values are preserved identically from the current scene baseline.
 */
const MOOD_PROFILES = {
    day: {
        sunPosition:        new THREE.Vector3(0.4, 0.35, 0.8),
        skyColorTop:        new THREE.Color('#3da5f5'),
        skyColorBottom:     new THREE.Color('#67bdfe'),
        cloudColor:         new THREE.Color('#ffffff'),
        cloudShadowColor:   new THREE.Color('#e6f0fa'),
        ambientColor:       new THREE.Color('#b9d5ff'),
        ambientIntensity:   0.55,
        directionalColor:   new THREE.Color(0xfff5e6),
        directionalIntensity: 2.2,
        sunIntensity:       1.2,
        nightBlend:         0.0,
        clearColor:         new THREE.Color('#67bdfe'),
        exposure:           0.85,
        fogColor:           new THREE.Color('#a8d8ff'),
        fogNear:            25,
        fogFar:             80,
        grassTint:          new THREE.Color(1.0, 1.0, 1.0),
        grassTintStrength:  0.0,
        cloudMix:           0.15,    // Normal cloud shadow on grass
    },
    evening: {
        // Golden hour — warm golden horizon, pale blue-grey upper sky, luminous clouds behind sun
        // Refined to match realistic sunset photography with golden/yellow highlights and cool shadows
        sunPosition:        new THREE.Vector3(0.8, 0.15, 0.4),
        skyColorTop:        new THREE.Color('#8faac6'),    // Pale blue-grey upper sky (very natural)
        skyColorBottom:     new THREE.Color('#ffe8b5'),    // Bright, soft golden-yellow (removes harsh dark orange)
        cloudColor:         new THREE.Color('#fff7e6'),    // Bright golden-white highlights
        cloudShadowColor:   new THREE.Color('#8a8279'),    // Soft warm grey-brown shadows (blocks light realistically)
        ambientColor:       new THREE.Color('#a8b8c8'),    // Cool pale blue-grey ambient fill (keeps grass shadows green)
        ambientIntensity:   0.65,                          // Boosted ambient to keep grass lit in shadow
        directionalColor:   new THREE.Color('#fff2d4'),    // Warm white-golden directional sunlight
        directionalIntensity: 2.5,                         // Stronger sun highlights on the grass tips
        sunIntensity:       1.3,                           // Moderate — glow has own intensity scaling
        nightBlend:         0.0,
        clearColor:         new THREE.Color('#ffe8b5'),    // Horizon clear color
        exposure:           0.90,                          // Bright high-quality exposure
        fogColor:           new THREE.Color('#dfd5c3'),    // Soft desaturated warm sand/grey (natural light scattering)
        fogNear:            20,
        fogFar:             70,
        grassTint:          new THREE.Color(1.02, 1.02, 0.95), // Retain fresh vibrant green (removes muddy red-orange shift)
        grassTintStrength:  0.15,                          // Low strength lets natural green grass shine
        cloudMix:           0.1,
    },
    night: {
        // RDR2-quality moonlit night — objects clearly visible, cool blue tint
        // Moon direction points UP and to the side (visible in sky)
        sunPosition:        new THREE.Vector3(0.3, 0.6, -0.5),
        skyColorTop:        new THREE.Color('#0a0f2e'),    // Deep indigo (not black)
        skyColorBottom:     new THREE.Color('#1a1a40'),    // Slightly lighter at horizon
        cloudColor:         new THREE.Color('#4a5a70'),    // Moonlit cloud edges
        cloudShadowColor:   new THREE.Color('#1a2030'),    // Visible cloud shadow
        ambientColor:       new THREE.Color('#3a4568'),    // Brighter blue ambient — enhanced moonlight fill
        ambientIntensity:   0.85,                          // Boosted for brighter moonlit scene
        directionalColor:   new THREE.Color('#99aacc'),    // Brighter cool moonlight
        directionalIntensity: 2.2,                         // Strong moonlight on surfaces
        sunIntensity:       0.5,
        nightBlend:         1.0,
        clearColor:         new THREE.Color('#1a1a40'),
        exposure:           0.88,                          // Brighter overall exposure
        fogColor:           new THREE.Color('#141428'),    // Visible blue-purple mist
        fogNear:            20,
        fogFar:             70,
        grassTint:          new THREE.Color(0.55, 0.65, 0.9), // Cool moonlit blue
        grassTintStrength:  0.5,
        cloudMix:           0.02,    // Almost no cloud shadow at night (prevents muddy grass)
        moonGlow:           1.0,     // Full moon glow in sky
    }
};

// Current transition state
let currentMoodKey = 'day';
let targetMoodKey = 'day';
const TRANSITION_DURATION = 15.0; // seconds — cinematic slow transition
const LERP_SPEED = 1.0 / TRANSITION_DURATION; // ~0.067 per second

// ============================================================
// AUTO DAY/NIGHT CYCLE SYSTEM
// ============================================================
const MOOD_SEQUENCE = ['day', 'evening', 'night']; // Cycle order
const MOOD_HOLD_DURATION = 20.0; // seconds to hold each settled state
let autoCycleActive = false;
let moodHoldTimer = 0.0;        // Accumulates deltaTime while holding
let currentSequenceIndex = 0;   // Index into MOOD_SEQUENCE
let moodSettled = true;         // True when the current transition is visually complete

/**
 * Start the automatic day/night cycle.
 * Called once after character selection completes.
 */
function startAutoCycle() {
    if (autoCycleActive) return;
    autoCycleActive = true;
    moodHoldTimer = 0.0;
    currentSequenceIndex = 0; // Start at 'day'
    moodSettled = true;
    console.log('🌅 Auto day/night cycle started');
}

// Pre-allocated scratch objects for zero-GC lerping in tick loop
const _scratchColor = new THREE.Color();
const _scratchVec3 = new THREE.Vector3();

/**
 * Smoothly transition the entire scene to a new mood.
 * Uses exponential lerp in tick() — no setTimeout, no coroutines, frame-perfect.
 */
function transitionTo(moodKey) {
    if (!MOOD_PROFILES[moodKey]) {
        console.warn(`Unknown mood: ${moodKey}`);
        return;
    }
    if (moodKey === targetMoodKey) return; // Already transitioning/at this mood

    targetMoodKey = moodKey;
    console.log(`🌤️ Transitioning to: ${moodKey}`);
}

const skyGeometry = new THREE.IcosahedronGeometry(50, 15);
const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
});
const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
skyMesh.renderOrder = -1;   // Render BEFORE moon meshes
skyMesh.matrixAutoUpdate = false;
skyMesh.updateMatrix();
scene.add(skyMesh);

const gui = new GUI();
gui.hide();

// Sky Debug UI
const skyFolder = gui.addFolder('Sky & Clouds');
skyFolder.add(skyUniforms.uCloudDensity, 'value').min(0.0).max(1.0).step(0.01).name('Cloud Density (Lower = More)');
skyFolder.add(skyUniforms.uCloudSpeed, 'value').min(0.0).max(0.5).step(0.001).name('Cloud Speed');
skyFolder.add(skyUniforms.uSunIntensity, 'value').min(0.0).max(5.0).step(0.1).name('Sun Intensity');

const skyColors = {
    top: skyUniforms.uSkyColorTop.value.getHex(),
    bottom: skyUniforms.uSkyColorBottom.value.getHex(),
    cloud: skyUniforms.uCloudColor.value.getHex(),
    shadow: skyUniforms.uCloudShadowColor.value.getHex()
};

skyFolder.addColor(skyColors, 'top').name('Sky Top Color').onChange(v => skyUniforms.uSkyColorTop.value.setHex(v));
skyFolder.addColor(skyColors, 'bottom').name('Sky Bottom Color').onChange(v => skyUniforms.uSkyColorBottom.value.setHex(v));
skyFolder.addColor(skyColors, 'cloud').name('Cloud Highlight').onChange(v => skyUniforms.uCloudColor.value.setHex(v));
skyFolder.addColor(skyColors, 'shadow').name('Cloud Shadow').onChange(v => skyUniforms.uCloudShadowColor.value.setHex(v));
skyFolder.open();

// Grass Debug UI
const grassFolder = gui.addFolder('Grass');
grassFolder.add(grassUniforms.uGrassContrast, 'value').min(0.0).max(3.0).step(0.01).name('Contrast');
grassFolder.add(grassUniforms.uGrassBrightness, 'value').min(-1.0).max(1.0).step(0.01).name('Brightness');
grassFolder.add(grassUniforms.uCloudMix, 'value').min(0.0).max(1.0).step(0.01).name('Cloud Shadow Mix');
grassFolder.add(grassUniforms.uWaveSize, 'value').min(0.0).max(50.0).step(0.1).name('Wind Wave Size');
grassFolder.add(grassUniforms.uTipDistance, 'value').min(0.0).max(2.0).step(0.01).name('Wind Tip Distance');
grassFolder.add(grassUniforms.uCenterDistance, 'value').min(0.0).max(2.0).step(0.01).name('Wind Center Distance');
grassFolder.add(grassUniforms.uAOStrength, 'value').min(0.0).max(1.0).step(0.01).name('AO Strength');
grassFolder.add(grassUniforms.uSSSStrength, 'value').min(0.0).max(1.0).step(0.01).name('SSS Strength');
grassFolder.add(grassUniforms.uHueVariation, 'value').min(0.0).max(2.0).step(0.01).name('Hue Variation');
grassFolder.close();


// Add ez-tree
const tree = new Tree();
tree.options.leaves.count = 0;
tree.generate();
tree.position.set(0, 0, 0); // Placed in the center of the grass
tree.scale.set(0.5, 0.5, 0.5); // Made larger
tree.castShadow = true;
tree.receiveShadow = true;
tree.matrixAutoUpdate = false;
tree.updateMatrix();
scene.add(tree);

// Generate grass field (after scene is initialized)
generateField();


// --- GENERATE FLOWERS ---
// (Flower generation removed)
// ------------------------

// ============================================================
// FLOATING ISLAND ROCK UNDERSIDE
// ============================================================

// --- Mountain Textures (triplanar PBR) ---
// ao.jpg is an ARM map: R=AmbientOcclusion, G=Roughness, B=Metalness
const mountainColorTex = textureLoader.load('/textures/mountain/color.jpg',
    () => console.log('✅ Mountain color loaded'));
const mountainNormalTex = textureLoader.load('/textures/mountain/normal.jpg',
    () => console.log('✅ Mountain normal loaded'));
const mountainARMTex = textureLoader.load('/textures/mountain/ao.jpg',         // ARM = AO+Roughness+Metalness
    () => console.log('✅ Mountain ARM (ao.jpg) loaded'));
const mountainDisplaceTex = textureLoader.load('/textures/mountain/displacement.jpg',
    () => console.log('✅ Mountain displacement loaded'));

// Configure wrapping for triplanar (must tile seamlessly)
[mountainColorTex, mountainNormalTex, mountainARMTex, mountainDisplaceTex].forEach(tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
});
mountainColorTex.colorSpace = THREE.SRGBColorSpace; // Color map is sRGB, rest are linear

// --- Rock Parameters ---
const ROCK_DEPTH = 38;          // units below Y=0 (tested: 35-40 range)
const ROCK_RADIUS = PLANE_SIZE / 2; // match grass disc (25)
const ROCK_RADIAL_SEGMENTS = 72;    // horizontal smoothness
const ROCK_VERTICAL_SEGMENTS = 56;  // vertical detail

/**
 * Generates the procedural floating island rock geometry.
 * 
 * Algorithm:
 * 1. Create a tapered cylinder (wide at top, point at bottom)
 * 2. Apply multi-octave 3D Simplex noise displacement for organic craggy surface
 * 3. Constrain top ring to exactly match grass disc radius
 * 4. Cap the top with a flat disc
 * 
 * The taper follows: r(t) = R * (1 - t^1.8) where t ∈ [0,1] top→bottom
 * This gives a slow initial narrowing that accelerates toward the tip.
 */
function generateRockGeometry() {
    const positions = [];
    const normals = [];
    const indices = [];

    const radialSegs = ROCK_RADIAL_SEGMENTS;
    const verticalSegs = ROCK_VERTICAL_SEGMENTS;

    // --- Generate the tapered body vertices ---
    for (let v = 0; v <= verticalSegs; v++) {
        const t = v / verticalSegs; // 0 = top, 1 = bottom
        const y = -t * ROCK_DEPTH;  // Y goes from 0 to -ROCK_DEPTH

        // Taper profile: slow narrowing, accelerating toward tip
        // Uses power curve with slight noise for organic feel
        const taperPower = 1.8;
        let baseRadius = ROCK_RADIUS * Math.pow(1.0 - t, 1.0 / taperPower);

        // Add some variation to the taper itself
        const taperNoise = fbm3D(t * 3.0, 42.0, 0.0, 3, 2.0, 0.5);
        baseRadius *= (1.0 + taperNoise * 0.15);

        // Near-tip pinch: more aggressive narrowing at the very bottom
        if (t > 0.85) {
            const pinch = (t - 0.85) / 0.15; // 0→1 in last 15%
            baseRadius *= (1.0 - pinch * 0.7);
        }

        for (let r = 0; r <= radialSegs; r++) {
            const theta = (r / radialSegs) * Math.PI * 2;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);

            let x = cosT * baseRadius;
            let z = sinT * baseRadius;

            // --- 3D Noise Displacement ---
            // Only displace if not at the very top (preserve grass edge match)
            if (t > 0.02) {
                // Displacement strength increases away from top edge
                const displaceStrength = Math.pow(Math.min(t * 3.0, 1.0), 1.5);

                // Large-scale bulges and overhangs
                const n1 = fbm3D(
                    x * 0.08, y * 0.06, z * 0.08,
                    4, 2.0, 0.55
                );

                // Medium-scale crag detail
                const n2 = fbm3D(
                    x * 0.2 + 100.0, y * 0.15 + 100.0, z * 0.2 + 100.0,
                    3, 2.0, 0.5
                );

                // Fine surface roughness
                const n3 = noise3D(
                    x * 0.5 + 200.0, y * 0.4 + 200.0, z * 0.5 + 200.0
                );

                const totalDisplacement = (
                    n1 * 4.0 +    // large bulges (±4 units)
                    n2 * 1.5 +    // medium crags (±1.5 units)
                    n3 * 0.5      // fine roughness (±0.5 units)
                ) * displaceStrength;

                // Displace along the radial direction (outward/inward)
                x += cosT * totalDisplacement;
                z += sinT * totalDisplacement;

                // Also displace Y slightly for overhangs
                const yDisplace = fbm3D(
                    x * 0.12 + 300.0, y * 0.1, z * 0.12 + 300.0,
                    3, 2.0, 0.5
                ) * 1.5 * displaceStrength;
                // Apply Y displacement (stored in a temp)
                positions.push(x, y + yDisplace, z);
            } else {
                // Top ring: exact radius match, no displacement
                positions.push(x, y, z);
            }

            // Placeholder normal (will recompute later)
            normals.push(0, 0, 0);
        }
    }

    // --- Generate body indices ---
    for (let v = 0; v < verticalSegs; v++) {
        for (let r = 0; r < radialSegs; r++) {
            const a = v * (radialSegs + 1) + r;
            const b = a + 1;
            const c = a + (radialSegs + 1);
            const d = c + 1;

            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }

    // --- Add top cap (flat disc at Y=0 to fill the opening) ---
    const centerIndex = positions.length / 3;
    positions.push(0, -0.01, 0); // center of disc, slightly below Y=0
    normals.push(0, 1, 0);       // facing up

    // Connect to top ring vertices
    const topRingStart = 0;
    for (let r = 0; r < radialSegs; r++) {
        const a = topRingStart + r;
        const b = topRingStart + r + 1;
        indices.push(centerIndex, a, b);
    }

    // --- Build BufferGeometry ---
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // proper smooth normals from face topology

    return geometry;
}

const rockGeometry = generateRockGeometry();

const rockUniforms = {
    uColorMap: { value: mountainColorTex },
    uNormalMap: { value: mountainNormalTex },
    uARMMap: { value: mountainARMTex },      // R=AO, G=Roughness, B=Metalness
    uLightDirection: { value: light.position.clone().normalize() },
    uLightColor: { value: new THREE.Color(0xfff5e6) },
    uAmbientColor: { value: new THREE.Color(0xffffff) },
    uTexScale: { value: 0.03 },         // triplanar UV tiling increased for more detail
    uMossBlend: { value: 0.15 },        // moss extends top 15%
    uMossColor: { value: new THREE.Color(0x5a7a3a) },   // mossy green (matches texture)
    uRockTintDark: { value: new THREE.Color(0x6a6055) }, // subtle weathered darkening (was too black)
    uRockDepth: { value: ROCK_DEPTH }
};

const rockMaterial = new THREE.ShaderMaterial({
    vertexShader: rockVertexShader,
    fragmentShader: rockFragmentShader,
    uniforms: rockUniforms,
    side: THREE.DoubleSide
});

const rockMesh = new THREE.Mesh(rockGeometry, rockMaterial);
rockMesh.matrixAutoUpdate = false;
rockMesh.updateMatrix();
scene.add(rockMesh);

// ============================================================
// SCENE ROCK PROPS — OBJ models placed on island surface
// ============================================================

/**
 * Shared MeshStandardMaterial for all OBJ rocks.
 * Calibrated to match the scene's PBR lighting:
 *   - Directional light: 0xfff5e6 warm daylight @ intensity 2.2
 *   - Ambient light:     #b9d5ff sky-tinted @ intensity 0.55
 * Roughness 0.92 keeps them matte like real stone.
 * envMapIntensity 0 is fine since we have no envMap — IBL handled manually.
 */
const rockObjMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x8c7b6a),   // warm grey-brown stone
    roughness: 0.92,
    metalness: 0.03,
    envMapIntensity: 0.0,
});

/**
 * Helper: load a single OBJ, apply material, configure shadows.
 * @param {string} url   - public path to the .obj
 * @param {THREE.Material} mat
 * @returns {Promise<THREE.Group>}
 */
function loadOBJRock(url, mat) {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();
        loader.load(
            url,
            (obj) => {
                obj.traverse((child) => {
                    if (child.isMesh) {
                        child.material = mat;
                        child.castShadow = true;
                        child.receiveShadow = true;
                        // Ensure smooth normals from geometry
                        if (child.geometry) child.geometry.computeVertexNormals();
                    }
                });
                resolve(obj);
            },
            undefined,
            reject
        );
    });
}

/**
 * Places an OBJ group at a world-space position with given scale and Y-rotation.
 * Y position is set to 0 so rocks sit flush on the island surface.
 */
function placeRock(obj, x, z, scale, rotationY) {
    const clone = obj.clone(true); // deep-clone so each instance is independent
    clone.position.set(x, 0, z);
    clone.scale.setScalar(scale);
    clone.rotation.y = rotationY;
    clone.matrixAutoUpdate = false;
    clone.updateMatrix();
    scene.add(clone);
}

/**
 * Island geometry reference: circular disc, radius = PLANE_SIZE/2 = 25.
 *
 * rock1  — large angular boulder (~48 KB mesh). Placed at 5 strategic
 *           near-edge/corner locations.  Kept inside radius to avoid
 *           floating over the edge (placed at r ≈ 19-22).
 *
 * rock2-5 — smaller accent rocks randomly scattered across the interior.
 *           Each type gets a cluster so the island feels naturally littered.
 */
/** World-space positions of all rock1 instances (used for orb spawning). */
const rock1WorldPositions = [];

async function spawnSceneRocks() {
    const ISLAND_R = PLANE_SIZE / 2; // 25 units

    // ── rock1 — 5 edge/corner positions (hand-tuned for visual balance) ──
    // Angles are evenly spread with slight offset so they don't feel mechanical.
    // r kept at ~78% of island radius to keep them visually on the island.
    const rock1EdgePlacements = [
        { angle: 0.0, r: 20, scale: 0.08, rotY: 0.3 },   // +Z edge
        { angle: Math.PI * 2 / 5, r: 21, scale: 0.10, rotY: 1.8 },   // NE
        { angle: Math.PI * 4 / 5, r: 19, scale: 0.07, rotY: 0.7 },   // NW
        { angle: Math.PI * 6 / 5, r: 22, scale: 0.09, rotY: 2.5 },   // SW
        { angle: Math.PI * 8 / 5, r: 20, scale: 0.06, rotY: 4.1 },   // SE
    ];

    // ── rock2-5 random interior scatter ──
    // Seeded pseudo-random using a simple LCG so placement is deterministic
    // across reloads (no jarring jumps), but still looks organic.
    const rng = (() => {
        let seed = 0x4a9f3c;
        return () => {
            seed = (seed * 1664525 + 1013904223) & 0xffffffff;
            return (seed >>> 0) / 0xffffffff;
        };
    })();

    // Stratified random positions — each rock type gets a different
    // radial band so they don't all cluster in one zone.
    const scatterConfigs = [
        // { file, count, minR, maxR, scaleMin, scaleMax }
        { file: 'rock2.obj', count: 1, minR: 3, maxR: 18, scaleMin: 0.04, scaleMax: 0.08 },
        { file: 'rock3.obj', count: 1, minR: 5, maxR: 20, scaleMin: 0.03, scaleMax: 0.07 },
        { file: 'rock4.obj', count: 1, minR: 2, maxR: 16, scaleMin: 0.04, scaleMax: 0.09 },
        { file: 'rock5.obj', count: 1, minR: 6, maxR: 22, scaleMin: 0.03, scaleMax: 0.06 },
    ];

    try {
        // Load rock1 first (largest, used for edge accent)
        const rock1 = await loadOBJRock('/models/rocks/rock1.obj', rockObjMaterial);
        console.log('✅ rock1.obj loaded');

        for (const p of rock1EdgePlacements) {
            const x = Math.cos(p.angle) * p.r;
            const z = Math.sin(p.angle) * p.r;
            const randomScale = p.scale * (0.6 + 0.4 * rng());
            placeRock(rock1, x, z, randomScale, p.rotY);
            // Store world position for orb spawning
            rock1WorldPositions.push({ x, z });
        }

        // Load and scatter rock2–5 in parallel for speed
        const scatterPromises = scatterConfigs.map(async (cfg) => {
            const obj = await loadOBJRock(`/models/rocks/${cfg.file}`, rockObjMaterial.clone());
            console.log(`✅ ${cfg.file} loaded`);

            for (let i = 0; i < cfg.count; i++) {
                // Uniform disc sampling: sqrt(rng()) biases toward perimeter
                const rawR = cfg.minR + (cfg.maxR - cfg.minR) * rng();
                const angle = rng() * Math.PI * 2;
                const x = Math.cos(angle) * rawR;
                const z = Math.sin(angle) * rawR;
                const scale = cfg.scaleMin + (cfg.scaleMax - cfg.scaleMin) * rng();
                const rotY = rng() * Math.PI * 2;
                placeRock(obj, x, z, scale, rotY);
            }
        });

        await Promise.all(scatterPromises);
        console.log('🪨 All scene rocks placed successfully');

    } catch (err) {
        console.error('❌ Failed to load scene rocks:', err);
    }
}

// Spawn rocks immediately (they're decorative — not gating game start)
spawnSceneRocks();



// Rock Debug UI
const rockFolder = gui.addFolder('Rock / Mountain');
rockFolder.add(rockUniforms.uTexScale, 'value').min(0.01).max(0.5).step(0.005).name('Texture Scale');
rockFolder.add(rockUniforms.uMossBlend, 'value').min(0.0).max(1.0).step(0.01).name('Moss Blend');
const rockColors = {
    ambient: rockUniforms.uAmbientColor.value.getHex(),
    lightColor: rockUniforms.uLightColor.value.getHex(),
    moss: rockUniforms.uMossColor.value.getHex(),
    darkTint: rockUniforms.uRockTintDark.value.getHex()
};
rockFolder.addColor(rockColors, 'ambient').name('Ambient Color').onChange(v => rockUniforms.uAmbientColor.value.setHex(v));
rockFolder.addColor(rockColors, 'lightColor').name('Light Color').onChange(v => rockUniforms.uLightColor.value.setHex(v));
rockFolder.addColor(rockColors, 'moss').name('Moss Color').onChange(v => rockUniforms.uMossColor.value.setHex(v));
rockFolder.addColor(rockColors, 'darkTint').name('Rock Dark Tint').onChange(v => rockUniforms.uRockTintDark.value.setHex(v));
rockFolder.open();




/**
 * Lights
 */
// Ambient light — bright daytime
const ambientLight = new THREE.AmbientLight('#b9d5ff', 0.55)

// gui.add(ambientLight, 'intensity').min(0).max(1).step(0.001)
scene.add(ambientLight)

// Directional light
const moonLight = new THREE.DirectionalLight(0xfff5e6, 2.2); // Warm daylight
moonLight.position.set(4, 5, - 2)
// gui.add(moonLight, 'intensity').min(0).max(5).step(0.001)
// gui.add(moonLight.position, 'x').min(- 5).max(5).step(0.001)
// gui.add(moonLight.position, 'y').min(- 5).max(5).step(0.001)
// gui.add(moonLight.position, 'z').min(- 5).max(5).step(0.001)
scene.add(moonLight)


/**
 * Atmospheric Fog — subtle depth haze that transitions with mood
 */
const sceneFog = new THREE.Fog('#a8d8ff', 25, 80); // Light blue day haze — closer range for visible effect
scene.fog = sceneFog;

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}



/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 200)
// Calculate initial position — start further back and lower to see the whole island
const cameraStartPos = new THREE.Vector3(15, -20, 15);
camera.position.copy(cameraStartPos);
camera.add(listener); // Add audio listener to camera
scene.add(camera)



// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
// controls.enabled = false 
controls.enablePan = true        // Enables moving the camera sideways/up/down (panning)
controls.enableRotate = true    // Enables rotating the camera (orbiting)
controls.enableZoom = true

// Minimum zoom (how close the camera can get to the focus point)
controls.minDistance = 0;

// Maximum zoom (how far the camera can move away from the focus point)
controls.maxDistance = Infinity;

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    powerPreference: 'high-performance'
})
renderer.setClearColor('#3da5f5') // Match sky horizon color
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

/**
 * Renderer settings
 */
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; // Brighter for daytime

window.addEventListener('resize', () => {
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update sky resolution uniform
    skyUniforms.uResolution.value.set(sizes.width, sizes.height);

    // Update renderer
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
})


/**
 * Animate
 */
const clock = new THREE.Clock()
let previousTime = 0;

// Pre-allocated vectors for render loop — zero allocations per frame (opt.md §2)
const _currentTarget = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _targetLookPos = new THREE.Vector3();

const tick = () => {
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime;
    previousTime = elapsedTime;

    // Camera sweep animation — starts below island, sweeps up to scene view
    if (cameraAnimation.active) {
        const now = Date.now();
        const progress = Math.min((now - cameraAnimation.startTime) / cameraAnimation.duration, 1);

        // Smooth ease-in-out
        const eased = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // Interpolate camera position
        camera.position.lerpVectors(
            cameraAnimation.startPos,
            cameraAnimation.endPos,
            eased
        );

        // Interpolate look-at target
        _currentTarget.lerpVectors(
            cameraAnimation.startTarget,
            cameraAnimation.endTarget,
            eased
        );
        controls.target.copy(_currentTarget);

        // End animation when complete
        if (progress === 1) {
            cameraAnimation.active = false;

            // Reveal character selection UI when camera settles
            const uiRoot = document.getElementById('ui-root');
            if (uiRoot) {
                console.log('✨ Camera settled, revealing UI');
                uiRoot.classList.add('is-visible');
            }
        }
    }

    // Update controls
    controls.update()

    // Animate grass: scale to ms to match shader
    grassUniforms.iTime.value = elapsedTime * 1000.0;

    // ☁️ Animate Sky
    skyUniforms.uTime.value = elapsedTime;

    // ============================================================
    // MOOD TRANSITION SYSTEM — smooth lerp toward target mood
    // ============================================================
    const target = MOOD_PROFILES[targetMoodKey];
    if (target) {
        // Frame-rate independent smooth lerp factor
        // Using 1 - exp(-speed * dt) for perfectly smooth exponential decay
        const lerpFactor = 1.0 - Math.exp(-LERP_SPEED * 2.5 * deltaTime);

        // --- Sky uniforms ---
        skyUniforms.uSkyColorTop.value.lerp(target.skyColorTop, lerpFactor);
        skyUniforms.uSkyColorBottom.value.lerp(target.skyColorBottom, lerpFactor);
        skyUniforms.uCloudColor.value.lerp(target.cloudColor, lerpFactor);
        skyUniforms.uCloudShadowColor.value.lerp(target.cloudShadowColor, lerpFactor);
        skyUniforms.uSunPosition.value.lerp(target.sunPosition, lerpFactor);
        skyUniforms.uSunIntensity.value = THREE.MathUtils.lerp(skyUniforms.uSunIntensity.value, target.sunIntensity, lerpFactor);
        skyUniforms.uNightBlend.value = THREE.MathUtils.lerp(skyUniforms.uNightBlend.value, target.nightBlend, lerpFactor);

        // --- Scene lights ---
        ambientLight.color.lerp(target.ambientColor, lerpFactor);
        ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, target.ambientIntensity, lerpFactor);
        moonLight.color.lerp(target.directionalColor, lerpFactor);
        moonLight.intensity = THREE.MathUtils.lerp(moonLight.intensity, target.directionalIntensity, lerpFactor);

        // --- Sync rock uniforms with scene lights ---
        rockUniforms.uLightColor.value.copy(moonLight.color);
        rockUniforms.uAmbientColor.value.copy(ambientLight.color);

        // --- Sync grass sun direction + ambient color ---
        grassUniforms.uSunDirection.value.copy(skyUniforms.uSunPosition.value).normalize();
        grassUniforms.uAmbientLightColor.value.copy(ambientLight.color);

        // --- Grass mood tinting ---
        grassUniforms.uMoodTint.value.lerp(target.grassTint, lerpFactor);
        grassUniforms.uMoodTintStrength.value = THREE.MathUtils.lerp(grassUniforms.uMoodTintStrength.value, target.grassTintStrength, lerpFactor);

        // --- Renderer sync ---
        _scratchColor.copy(renderer.getClearColor(_scratchColor));
        _scratchColor.lerp(target.clearColor, lerpFactor);
        renderer.setClearColor(_scratchColor);
        renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, target.exposure, lerpFactor);

        // --- Fog transition ---
        if (sceneFog) {
            sceneFog.color.lerp(target.fogColor, lerpFactor);
            sceneFog.near = THREE.MathUtils.lerp(sceneFog.near, target.fogNear, lerpFactor);
            sceneFog.far = THREE.MathUtils.lerp(sceneFog.far, target.fogFar, lerpFactor);
        }

        // --- Moon sky glow ---
        // Drive sky-shader moon glow (smooth radial light scatter, no geometry)
        const targetGlow = target.moonGlow || 0.0;
        skyUniforms.uMoonGlow.value = THREE.MathUtils.lerp(skyUniforms.uMoonGlow.value, targetGlow, lerpFactor);

        // --- Grass cloud shadow mix ---
        grassUniforms.uCloudMix.value = THREE.MathUtils.lerp(grassUniforms.uCloudMix.value, target.cloudMix, lerpFactor);

        // Track current mood when transition is effectively complete
        const dist = skyUniforms.uSkyColorTop.value.getHex() === target.skyColorTop.getHex();
        if (dist) currentMoodKey = targetMoodKey;

        // --- AUTO CYCLE: advance to next mood after hold period ---
        if (autoCycleActive) {
            if (currentMoodKey === targetMoodKey) {
                // Transition settled — accumulate hold time
                if (!moodSettled) {
                    moodSettled = true;
                    moodHoldTimer = 0.0;
                    console.log(`🌤️ Settled at: ${currentMoodKey} — holding for ${MOOD_HOLD_DURATION}s`);
                }
                moodHoldTimer += deltaTime;

                if (moodHoldTimer >= MOOD_HOLD_DURATION) {
                    // Advance to next mood in sequence
                    currentSequenceIndex = (currentSequenceIndex + 1) % MOOD_SEQUENCE.length;
                    const nextMood = MOOD_SEQUENCE[currentSequenceIndex];
                    moodSettled = false;
                    moodHoldTimer = 0.0;
                    transitionTo(nextMood);
                }
            }
        }
    }


    // Update Game (physics, input, combat, animations)
    if (gameManager) {
        gameManager.update(deltaTime);

        // Third-person camera follow
        if (cameraFollowMode && !cameraAnimation.active) {
            const playerPos = gameManager.getLocalPlayerPosition();
            if (playerPos) {
                // Read mouse delta for camera rotation
                const mouseDelta = gameManager.inputManager.consumeMouseDelta();
                if (document.pointerLockElement) {
                    // Lowered sensitivity from 0.005 to 0.002 for smoother mouse look
                    cameraTheta -= mouseDelta.x * 0.002; // horizontal rotation
                    cameraPhi -= mouseDelta.y * 0.002;   // vertical rotation

                    // clamp phi to prevent camera flipping or going under floor
                    const minPhi = 0.1;
                    const maxPhi = Math.PI / 2 - 0.1; // stop slightly above ground
                    cameraPhi = Math.max(minPhi, Math.min(maxPhi, cameraPhi));
                }

                // Calculate camera position using spherical coordinates around player
                const camX = playerPos.x + cameraRadius * Math.sin(cameraPhi) * Math.sin(cameraTheta);
                const camY = playerPos.y + cameraRadius * Math.cos(cameraPhi) + 1.5; // +1.5 offset above ground
                const camZ = playerPos.z + cameraRadius * Math.sin(cameraPhi) * Math.cos(cameraTheta);

                const lerpFactor = Math.min(8.0 * deltaTime, 1.0);
                _targetPos.set(camX, camY, camZ);
                camera.position.lerp(_targetPos, lerpFactor);

                // Make controls target the player's upper body
                _targetLookPos.set(playerPos.x, playerPos.y + 1.5, playerPos.z);
                controls.target.lerp(_targetLookPos, lerpFactor);

                // Pass camera yaw to gameManager so W always moves forward relative to view
                gameManager.setCameraYaw(cameraTheta);
            }
        }
    }

    // Render directly (no post-processing)
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}
const cameraAnimation = {
    active: false,
    startTime: 0,
    duration: 6000,
    startPos: new THREE.Vector3(25, -27, 40),
    endPos: new THREE.Vector3(28, 6.0, -8),
    startTarget: new THREE.Vector3(0, -15, 0),
    endTarget: new THREE.Vector3(0, 1, 0)
};

// ============================================================
// GAME MANAGER INTEGRATION
// ============================================================

/** @type {GameManager|null} */
let gameManager = null;

/** Camera follow mode: true = follow player, false = free orbit */
let cameraFollowMode = true; // Default to follow mode

/** Spherical camera variables for GTA-style mouse look */
let cameraTheta = Math.PI; // Yaw
let cameraPhi = Math.PI / 3; // Pitch
const cameraRadius = 10;

/**
 * Initializes the GameManager with the selected character + random bot.
 */
async function initGameManager(charId, charData) {
    if (!charData) {
        console.error('❌ No character data loaded');
        return;
    }

    gameManager = new GameManager(scene, camera, {
        platformRadius: PLANE_SIZE / 2,
        ringOutY: -20,
        respawnDelay: 5000
    });

    gameManager.addPlayer(
        charId,
        charData.name,
        charData.model,
        charData.animations,
        true // local player
    );

    // --- Load random Bot character (different from player) ---
    const available = ALL_CHARACTERS.filter(c => c !== charId);
    const botCharId = available[Math.floor(Math.random() * available.length)];

    console.log(`🤖 Loading bot character: ${botCharId}`);
    const botData = await loadBotCharacter(botCharId);

    if (botData) {
        gameManager.addBot(
            botCharId,
            botData.name,
            botData.model,
            botData.animations
        );

        // Update bot name in HUD
        const botNameEl = document.getElementById('bot-name');
        if (botNameEl) botNameEl.textContent = botData.name.toUpperCase();
    }

    // --- Pass rock1 positions for orb spawning ---
    if (rock1WorldPositions.length > 0) {
        gameManager.setRock1Positions(rock1WorldPositions);
    }

    console.log(`🎮 GameManager initialized with ${charData.name} vs ${botData?.name || 'none'}`);
}

/**
 * Loads a character GLTF for the bot (separate from player loader).
 * Does NOT modify the global loadedCharacterData.
 */
async function loadBotCharacter(charId) {
    const gltfLoader = new GLTFLoader();
    const modelName = charId.charAt(0).toUpperCase() + charId.slice(1);

    try {
        const gltf = await new Promise((resolve, reject) => {
            gltfLoader.load(`/models/characters/${modelName}.gltf`, resolve, undefined, reject);
        });

        const { scene: model, animations = [] } = gltf;
        model.position.set(8, 0, 8); // Offset from player spawn

        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        scene.add(model);

        console.log(`✅ Bot ${modelName} loaded (${animations.length} animations):`,
            animations.map(a => a.name));

        return { name: modelName, model, animations };
    } catch (err) {
        console.error(`❌ Failed to load bot model ${modelName}:`, err);
        return null;
    }
}

// Toggle camera mode with C key
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC' && gameManager) {
        cameraFollowMode = !cameraFollowMode;
        console.log(`📷 Camera mode: ${cameraFollowMode ? 'Follow Player' : 'Free Orbit'}`);
    }
});

tick()



function initializeScene() {
    if (sceneInitialized) return;
    sceneInitialized = true;

    console.log('🎬 initializeScene called');
    const canvas = document.querySelector('.webgl');
    if (canvas) {
        canvas.style.display = 'block';
    }

    // Start camera animation
    cameraAnimation.active = true;
    cameraAnimation.startTime = Date.now();

    // Trigger any initial animations or state
    if (sound.buffer && !sound.isPlaying) {
        sound.play();
    }

    // ── Character Selection UI — Horizontal Card Scroller ──
    const uiRoot = document.getElementById('ui-root');
    console.log('🔍 uiRoot found:', !!uiRoot);
    if (uiRoot) {
        uiRoot.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    const track = document.getElementById('cs-track');
    const arrowLeft = document.getElementById('cs-arrow-left');
    const arrowRight = document.getElementById('cs-arrow-right');

    // Note: UI reveal is now handled in tick() after camera animation finishes



    // Handle Custom Carousel logic
    let activeCardIndex = 0;
    const cards = Array.from(document.querySelectorAll('.char-card'));

    function updateCarousel(newIndex) {
        if (newIndex < 0 || newIndex >= cards.length) return;

        cards.forEach((card, idx) => {
            card.classList.remove('is-active', 'out-left', 'out-right');
            if (idx === newIndex) {
                card.classList.add('is-active');
            } else if (idx < newIndex) {
                card.classList.add('out-left');
            } else {
                card.classList.add('out-right');
            }
        });



        activeCardIndex = newIndex;
    }

    // Initial setup
    cards.forEach((card, idx) => {
        if (idx !== 0) card.classList.add('out-right');
        else card.classList.add('is-active');
    });

    if (arrowLeft) {
        arrowLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeCardIndex > 0) updateCarousel(activeCardIndex - 1);
        });
    }
    if (arrowRight) {
        arrowRight.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeCardIndex < cards.length - 1) updateCarousel(activeCardIndex + 1);
        });
    }


    // Handle character card clicks — just select the clicked card
    document.querySelectorAll('.char-card').forEach((card, idx) => {
        card.addEventListener('pointerdown', (e) => e.stopPropagation());

        card.addEventListener('click', (e) => {
            if (e.target.closest('.char-select__arrow')) return;
            if (!uiRoot || uiRoot.classList.contains('is-exiting')) return;

            // If an adjacent card is clicked, bring it to the center
            if (idx !== activeCardIndex) {
                updateCarousel(idx);
            }
        });
    });

    // Helper to get currently selected character from carousel
    function getSelectedCharacter() {
        return cards[activeCardIndex].dataset.character;
    }

    // Single-player start game flow
    function startGame(selectedCharacter) {
        if (!uiRoot || uiRoot.classList.contains('is-exiting')) return;
        
        console.log(`⚔️ Singleplayer selected: ${selectedCharacter}`);
        
        // Trigger exit animation
        uiRoot.classList.remove('is-visible');
        uiRoot.classList.add('is-exiting');

        // After exit animation completes, hide overlay and load character and start game
        setTimeout(async () => {
            uiRoot.style.display = 'none';

            const charData = await loadCharacters(selectedCharacter);
            await initGameManager(selectedCharacter, charData);

            if (gameManager) {
                gameManager.start();

                // Show combat HUD
                const combatHud = document.getElementById('combat-hud');
                if (combatHud) combatHud.classList.add('visible');

                // Update player name in HUD
                const playerNameEl = document.getElementById('player-hud-name');
                if (playerNameEl) playerNameEl.textContent = selectedCharacter.toUpperCase();

                // Begin automatic day/night cycle
                startAutoCycle();
            }
            console.log('🎮 Game started');
        }, 800);
    }

    // Add listeners for global action buttons
    const btnPlayOffline = document.getElementById('btn-play-offline');
    const btnPlayMultiplayer = document.getElementById('btn-play-multiplayer');

    if (btnPlayOffline) {
        btnPlayOffline.addEventListener('pointerdown', (e) => e.stopPropagation());
        btnPlayOffline.addEventListener('click', (e) => {
            e.stopPropagation();
            startGame(getSelectedCharacter());
        });
    }

    if (btnPlayMultiplayer) {
        btnPlayMultiplayer.addEventListener('pointerdown', (e) => e.stopPropagation());
        btnPlayMultiplayer.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectedCharacter = getSelectedCharacter();
            console.log(`🌐 Multiplayer selected: ${selectedCharacter}`);
            openMultiplayerLobby(selectedCharacter);
        });
    }

    // ── MULTIPLAYER LOBBY FLOW ──────────────────────────────
    // Server URL: dynamically resolve for local dev, or fallback to production URL
    const MP_SERVER_URL = import.meta.env.VITE_MP_SERVER_URL || 
        (import.meta.env.DEV ? `http://${window.location.hostname}:3001` : 'https://orbpoly-server.onrender.com');

    let mpNetworkManager = null;
    let mpSelectedCharacter = null;

    // Back button — close lobby, return to char select
    const mpBackBtn = document.getElementById('mp-back-btn');
    if (mpBackBtn) {
        mpBackBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        mpBackBtn.addEventListener('click', () => {
            const lobby = document.getElementById('mp-lobby');
            if (lobby) lobby.style.display = 'none';
            if (mpNetworkManager) {
                mpNetworkManager.disconnect();
                mpNetworkManager = null;
            }
        });
    }

    // Create Room button
    const mpCreateBtn = document.getElementById('mp-create-btn');
    if (mpCreateBtn) {
        mpCreateBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        mpCreateBtn.addEventListener('click', () => {
            if (!mpNetworkManager || !mpSelectedCharacter) return;
            mpNetworkManager.createRoom(mpSelectedCharacter, mpSelectedCharacter.toUpperCase());
        });
    }

    // Join Room button
    const mpJoinBtn = document.getElementById('mp-join-btn');
    if (mpJoinBtn) {
        mpJoinBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        mpJoinBtn.addEventListener('click', () => {
            const codeInput = document.getElementById('mp-room-code');
            const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
            if (!code || !mpNetworkManager || !mpSelectedCharacter) return;
            mpNetworkManager.joinRoom(code, mpSelectedCharacter, mpSelectedCharacter.toUpperCase());
        });
    }

    // Start Game button
    const mpStartBtn = document.getElementById('mp-start-btn');
    if (mpStartBtn) {
        mpStartBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        mpStartBtn.addEventListener('click', () => {
            if (mpNetworkManager) mpNetworkManager.startGame();
        });
    }

    /**
     * Opens the multiplayer lobby for a given character selection.
     */
    async function openMultiplayerLobby(characterId) {
        mpSelectedCharacter = characterId;
        const lobby = document.getElementById('mp-lobby');
        const status = document.getElementById('mp-status');
        const actions = document.getElementById('mp-actions');
        const waiting = document.getElementById('mp-waiting');

        if (!lobby) return;
        lobby.style.display = 'flex';
        if (status) status.textContent = 'Connecting to server...';
        if (actions) actions.style.display = 'none';
        if (waiting) waiting.style.display = 'none';

        // Connect to server
        mpNetworkManager = new NetworkManager(MP_SERVER_URL);

        // Wire callbacks
        mpNetworkManager.onRoomCreated((data) => {
            showWaitingRoom(data.roomId);
        });

        mpNetworkManager.onRoomJoined((data) => {
            showWaitingRoom(data.roomId);
            updatePlayersList(data.players || []);
        });

        mpNetworkManager.onPlayerJoined((data) => {
            // Refresh player list in waiting room
            const list = document.getElementById('mp-players-list');
            if (list) {
                const item = document.createElement('div');
                item.className = 'mp-lobby__player-item';
                item.innerHTML = `<span>${data.name}</span><span class="mp-lobby__player-class">${data.characterClass}</span>`;
                list.appendChild(item);
            }
        });

        mpNetworkManager.onPlayerLeft((data) => {
            console.log(`👤 ${data.name} left the room`);
        });

        mpNetworkManager.onGameStart(async (data) => {
            console.log('🎮 Multiplayer game starting!');
            const lobby = document.getElementById('mp-lobby');
            if (lobby) lobby.style.display = 'none';

            // Hide char select
            if (uiRoot) {
                uiRoot.classList.remove('is-visible');
                uiRoot.classList.add('is-exiting');
                setTimeout(() => { uiRoot.style.display = 'none'; }, 400);
            }

            // Load local player character
            const charData = await loadCharacters(mpSelectedCharacter);
            await initGameManager(mpSelectedCharacter, charData);

            if (gameManager && mpNetworkManager) {
                // Enable multiplayer mode
                gameManager.setNetworkManager(mpNetworkManager);

                // Load remote players
                for (const p of data.players) {
                    if (p.id !== mpNetworkManager.playerId) {
                        await gameManager.addRemotePlayer(
                            p.id,
                            p.characterClass,
                            p.name,
                            p.position
                        );
                    }
                }

                // Wire hit/ringout/respawn/gameover events
                mpNetworkManager.onPlayerHit((hitData) => {
                    if (gameManager) {
                        gameManager.handleRemoteHit(hitData);
                        // Play VFX for hits (screen shake if local player is victim)
                        if (hitData.victimId === mpNetworkManager.playerId) {
                            gameManager._triggerScreenShake(0.35, 0.25);
                            gameManager._triggerVignette();
                        }
                    }
                });
                
                mpNetworkManager.onPlayerRingout((data) => {
                    if (gameManager && data.id === mpNetworkManager.playerId) {
                        gameManager._triggerScreenShake(0.5, 0.4);
                        gameManager._triggerVignette();
                    }
                });
                
                mpNetworkManager.onPlayerRespawn((data) => {
                    if (gameManager) {
                        gameManager.handleRemoteRespawn(data);
                    }
                });

                mpNetworkManager.onPlayerLeft((leftData) => {
                    gameManager.removeRemotePlayer(leftData.id);
                });

                mpNetworkManager.onGameOver((overData) => {
                    const isLocalWinner = overData.winnerId === mpNetworkManager.playerId;
                    gameManager.declareWinner(isLocalWinner ? 'You' : overData.winnerName);
                });

                gameManager.start();

                // Show combat HUD
                const combatHud = document.getElementById('combat-hud');
                if (combatHud) combatHud.classList.add('visible');

                const playerNameEl = document.getElementById('player-hud-name');
                if (playerNameEl) playerNameEl.textContent = mpSelectedCharacter.toUpperCase();

                startAutoCycle();
                console.log('🎮 Multiplayer game started!');

                // ── Mid-game disconnect recovery ──
                // Override the lobby disconnect handler with a game-aware one
                mpNetworkManager.onDisconnect((reason) => {
                    console.warn(`⚠️ Mid-game disconnect: ${reason}`);
                    if (gameManager) {
                        gameManager.stop();
                        // Remove all remote player meshes from scene
                        if (gameManager.remotePlayers) {
                            for (const [id, rpc] of gameManager.remotePlayers) {
                                if (rpc.model) scene.remove(rpc.model);
                            }
                            gameManager.remotePlayers.clear();
                        }
                        gameManager = null;
                    }
                    if (mpNetworkManager) {
                        mpNetworkManager.disconnect();
                        mpNetworkManager = null;
                    }
                    cameraFollowMode = false;
                    showDisconnectOverlay();
                });
            }
        });

        mpNetworkManager.onRoomList((rooms) => {
            const roomsDiv = document.getElementById('mp-rooms');
            const roomsList = document.getElementById('mp-rooms-list');
            if (!roomsDiv || !roomsList) return;

            if (rooms.length === 0) {
                roomsDiv.style.display = 'none';
                return;
            }

            roomsDiv.style.display = 'block';
            roomsList.innerHTML = '';
            for (const room of rooms) {
                if (room.state !== 'waiting') continue;
                const item = document.createElement('div');
                item.className = 'mp-lobby__room-item';
                item.innerHTML = `<span>${room.roomId}</span><span>${room.playerCount}/${room.maxPlayers}</span>`;
                item.addEventListener('click', () => {
                    mpNetworkManager.joinRoom(room.roomId, mpSelectedCharacter, mpSelectedCharacter.toUpperCase());
                });
                roomsList.appendChild(item);
            }
        });

        mpNetworkManager.onError((err) => {
            if (status) status.textContent = `Error: ${err.message}`;
        });

        mpNetworkManager.onDisconnect((reason) => {
            if (status) status.textContent = `Disconnected: ${reason}`;
            if (actions) actions.style.display = 'none';
        });

        mpNetworkManager.onReconnectAttempt((attempt) => {
            if (status) status.textContent = `Reconnecting... (Attempt ${attempt})`;
        });

        mpNetworkManager.onReconnect(() => {
            if (status) status.textContent = 'Reconnected!';
            if (actions) actions.style.display = 'flex';
        });

        const retryBtn = document.getElementById('mp-retry-btn');
        const handleConnect = async () => {
            if (retryBtn) retryBtn.style.display = 'none';
            if (status) status.textContent = 'Connecting to server...';

            // Show "waking up" message if connection takes > 2.5s (Render free tier cold start)
            const wakingTimeout = setTimeout(() => {
                if (status) status.textContent = '⏳ Waking up combat servers...';
            }, 2500);

            try {
                await mpNetworkManager.connect();
                clearTimeout(wakingTimeout);
                if (status) status.textContent = 'Connected!';
                if (actions) actions.style.display = 'flex';
            } catch (err) {
                clearTimeout(wakingTimeout);
                if (status) status.textContent = `Failed to connect: ${err.message}`;
                if (retryBtn) retryBtn.style.display = 'block';
            }
        };

        if (retryBtn) {
            // Remove previous event listeners by replacing the node
            const newRetryBtn = retryBtn.cloneNode(true);
            retryBtn.parentNode.replaceChild(newRetryBtn, retryBtn);
            newRetryBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
            newRetryBtn.addEventListener('click', handleConnect);
        }

        handleConnect();
    }

    /**
     * Shows the disconnect overlay and auto-returns to character select after 3 seconds.
     */
    function showDisconnectOverlay() {
        const overlay = document.getElementById('disconnect-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            // Auto-dismiss after 3s and return to char select
            setTimeout(() => {
                overlay.style.display = 'none';
                // Show character selection again
                const uiRoot = document.getElementById('ui-root');
                if (uiRoot) {
                    uiRoot.style.display = '';
                    uiRoot.classList.remove('is-exiting');
                    uiRoot.classList.add('is-visible');
                }
                // Hide combat HUD
                const combatHud = document.getElementById('combat-hud');
                if (combatHud) combatHud.classList.remove('visible');
                // Hide lobby
                const lobby = document.getElementById('mp-lobby');
                if (lobby) lobby.style.display = 'none';
            }, 3000);
        }
    }

    function showWaitingRoom(roomId) {
        const actions = document.getElementById('mp-actions');
        const waiting = document.getElementById('mp-waiting');
        const roomDisplay = document.getElementById('mp-room-id-display');
        const rooms = document.getElementById('mp-rooms');

        if (actions) actions.style.display = 'none';
        if (rooms) rooms.style.display = 'none';
        if (waiting) waiting.style.display = 'flex';
        if (roomDisplay) roomDisplay.textContent = roomId;
    }

    function updatePlayersList(players) {
        const list = document.getElementById('mp-players-list');
        if (!list) return;
        list.innerHTML = '';
        for (const p of players) {
            const item = document.createElement('div');
            item.className = 'mp-lobby__player-item';
            item.innerHTML = `<span>${p.name}</span><span class="mp-lobby__player-class">${p.characterClass}</span>`;
            list.appendChild(item);
        }
    }

    // Expose for character cards to trigger multiplayer
    window.__openMultiplayerLobby = openMultiplayerLobby;
}

// Orientation logic
const orientationPrompt = document.querySelector('.orientation-prompt');

function checkOrientation() {
    if (window.innerHeight > window.innerWidth) {
        // Portrait → show orientation prompt
        if (orientationPrompt) orientationPrompt.classList.add('visible');
    } else {
        // Landscape → hide prompt
        if (orientationPrompt) orientationPrompt.classList.remove('visible');
    }
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
checkOrientation(); // run once at start

// ============================================================
// DISPOSAL — GPU memory cleanup
// ============================================================
function disposeScene() {
    scene.traverse((obj) => {
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        if (obj.material) {
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of materials) {
                for (const key of Object.keys(mat)) {
                    const val = mat[key];
                    if (val && typeof val.dispose === 'function') {
                        val.dispose(); // textures, render targets, etc.
                    }
                }
                mat.dispose();
            }
        }
    });

    renderer.dispose();
    controls.dispose();
    gui.destroy();
    console.log('🧹 Scene disposed — GPU memory released');
}

// Expose for external use (e.g., page navigation / HMR cleanup)
window.__disposeScene = disposeScene;
