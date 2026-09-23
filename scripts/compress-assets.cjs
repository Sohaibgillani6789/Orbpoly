/**
 * Asset compression script for Poki optimization.
 * Compresses images, textures, and audio for production.
 * Uses sharp (already in devDependencies).
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const STATIC = path.resolve(__dirname, '../static');

async function compressImage(inputPath, outputPath, opts = {}) {
    const { width, quality = 80 } = opts;
    let pipeline = sharp(inputPath);
    if (width) pipeline = pipeline.resize(width, null, { withoutEnlargement: true });
    await pipeline.webp({ quality, effort: 6 }).toFile(outputPath);
    const before = fs.statSync(inputPath).size;
    const after = fs.statSync(outputPath).size;
    console.log(`  ${path.basename(inputPath)}: ${(before/1024).toFixed(0)} KB -> ${(after/1024).toFixed(0)} KB (${((1-after/before)*100).toFixed(0)}% reduction)`);
}

async function compressJPG(inputPath, outputPath, quality = 80) {
    await sharp(inputPath).jpeg({ quality, mozjpeg: true }).toFile(outputPath);
    const before = fs.statSync(inputPath).size;
    const after = fs.statSync(outputPath).size;
    console.log(`  ${path.basename(inputPath)}: ${(before/1024).toFixed(0)} KB -> ${(after/1024).toFixed(0)} KB (${((1-after/before)*100).toFixed(0)}% reduction)`);
}

async function main() {
    console.log('=== Orbpoly Asset Compression ===\n');

    // --- Background Images (PNG masquerading as .webp) ---
    console.log('Background Images:');
    // Resize to 1920 max width and compress as proper WebP
    const tmpStart = path.join(STATIC, 'images/startimage_opt.webp');
    const tmpHome = path.join(STATIC, 'images/homepage_opt.webp');
    await compressImage(
        path.join(STATIC, 'images/startimage.webp'),
        tmpStart,
        { width: 1920, quality: 75 }
    );
    await compressImage(
        path.join(STATIC, 'images/homepage.webp'),
        tmpHome,
        { width: 1920, quality: 75 }
    );
    // Replace originals
    fs.renameSync(tmpStart, path.join(STATIC, 'images/startimage.webp'));
    fs.renameSync(tmpHome, path.join(STATIC, 'images/homepage.webp'));

    // --- Mountain Textures ---
    console.log('\nMountain Textures:');
    const mtDir = path.join(STATIC, 'textures/mountain');
    for (const file of ['color.jpg', 'normal.jpg', 'ao.jpg', 'displacement.jpg']) {
        const src = path.join(mtDir, file);
        const tmp = path.join(mtDir, file.replace('.jpg', '_opt.jpg'));
        // Keep at original resolution but optimize JPEG quality
        const quality = file === 'displacement.jpg' ? 70 : 78;
        await compressJPG(src, tmp, quality);
        fs.renameSync(tmp, src);
    }

    // --- House Textures ---
    console.log('\nHouse Textures:');
    const houseDir = path.join(STATIC, 'models/house');
    for (const file of ['cottage_diffuse.jpg', 'cottage_normal.jpg']) {
        const src = path.join(houseDir, file);
        const tmp = path.join(houseDir, file.replace('.jpg', '_opt.jpg'));
        await compressJPG(src, tmp, 78);
        fs.renameSync(tmp, src);
    }

    // --- Grass + Cloud textures ---
    console.log('\nSmall Textures:');
    const grassSrc = path.join(STATIC, 'textures/grass/grass.jpg');
    const grassTmp = path.join(STATIC, 'textures/grass/grass_opt.jpg');
    await compressJPG(grassSrc, grassTmp, 80);
    fs.renameSync(grassTmp, grassSrc);

    const cloudSrc = path.join(STATIC, 'textures/clouds/cloud.jpg');
    const cloudTmp = path.join(STATIC, 'textures/clouds/cloud_opt.jpg');
    await compressJPG(cloudSrc, cloudTmp, 80);
    fs.renameSync(cloudTmp, cloudSrc);

    console.log('\n✅ All assets compressed!');
}

main().catch(console.error);
