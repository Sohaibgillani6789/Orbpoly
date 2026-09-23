import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Shared Asset Registry and Object Instancing System (mobileopt.md)
 * 
 * Prevents redundant HTTP fetches, JSON parsing, and GPU buffer decodes
 * by caching parsed GLTF models in memory and instantiating them via
 * SkeletonUtils.clone (sharing geometries and textures).
 */

const gltfLoader = new GLTFLoader();
const assetPromises = new Map();

/**
 * Loads and caches a GLTF asset promise.
 * @param {string} url
 * @returns {Promise<any>}
 */
export function loadGLTF(url) {
    if (!assetPromises.has(url)) {
        assetPromises.set(url, new Promise((resolve, reject) => {
            gltfLoader.load(url, resolve, undefined, reject);
        }));
    }
    return assetPromises.get(url);
}

/**
 * Instantiates a character model using SkeletonUtils.clone.
 * Reuses geometry buffers and textures on the GPU while creating
 * isolated bone hierarchies and AnimationMixer-compatible rigs.
 * 
 * @param {string} charId - e.g. 'warrior', 'wizard', etc.
 * @returns {Promise<{name: string, model: THREE.Group, animations: THREE.AnimationClip[]}>}
 */
export async function instantiateCharacter(charId) {
    const modelName = charId.charAt(0).toUpperCase() + charId.slice(1);
    const gltf = await loadGLTF(`/models/characters/${modelName}.glb`);
    
    // SkeletonUtils.clone clones skins and bones correctly
    const model = SkeletonUtils.clone(gltf.scene);
    
    return {
        name: modelName,
        model,
        animations: gltf.animations || []
    };
}
