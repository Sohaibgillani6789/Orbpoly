import glsl from 'vite-plugin-glsl';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
    root: 'src/',
    publicDir: '../static/',
    base: './',
    plugins: [glsl()],
    server: {
        host: true,
        open: !('SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env)
    },
    esbuild: {
        drop: mode === 'production' ? ['console', 'debugger'] : []
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: false,
        minify: 'esbuild',
        rollupOptions: {
            output: {
                // Keep a single bundle — avoid over-splitting for a game
                inlineDynamicImports: true
            }
        },
        // Target modern browsers for smaller output
        target: 'es2020',
        // Increase chunk warning limit (single-bundle game)
        chunkSizeWarningLimit: 2000
    }
}))