/**
 * Dev-only performance monitor for Orbpoly.
 * Displays FPS, Frame Time, Draw Calls, Triangles, Geometries, Textures, and JS Heap.
 * Toggle visibility with backtick (`).
 */
export class PerfMonitor {
    constructor(renderer) {
        this.renderer = renderer;
        this.active = false;

        if (!import.meta.env.DEV) return;

        this.container = document.createElement('div');
        this.container.id = 'perf-monitor';
        Object.assign(this.container.style, {
            position: 'fixed',
            top: '10px',
            left: '10px',
            padding: '8px 12px',
            background: 'rgba(0, 0, 0, 0.85)',
            color: '#00ffcc',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineHeight: '1.4',
            borderRadius: '6px',
            zIndex: '99999',
            pointerEvents: 'none',
            border: '1px solid #00ffcc44',
            display: 'none',
        });
        document.body.appendChild(this.container);

        this.frameCount = 0;
        this.lastTime = performance.now();
        this.fps = 60;
        this.frameTime = 16.6;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') {
                this.active = !this.active;
                this.container.style.display = this.active ? 'block' : 'none';
            }
        });
    }

    update(now = performance.now()) {
        if (!import.meta.env.DEV || !this.active) return;

        this.frameCount++;
        const elapsed = now - this.lastTime;

        if (elapsed >= 500) {
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameTime = (elapsed / this.frameCount).toFixed(1);
            this.frameCount = 0;
            this.lastTime = now;

            const renderInfo = this.renderer.info.render;
            const memoryInfo = this.renderer.info.memory;
            const heap = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : 'N/A';

            this.container.innerHTML = `
<b>ORBPOLY PERF MONITOR</b> [~]<br/>
FPS: <b>${this.fps}</b> (${this.frameTime} ms)<br/>
Draw Calls: ${renderInfo.calls}<br/>
Triangles: ${renderInfo.triangles.toLocaleString()}<br/>
Geometries: ${memoryInfo.geometries}<br/>
Textures: ${memoryInfo.textures}<br/>
JS Heap: ${heap}
            `;
        }
    }
}
