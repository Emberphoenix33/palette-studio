// Canvas grid rendering with Retina support
const Grids = {
    setupCanvas(canvas, width, height) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return ctx;
    },

    drawSwatchGrid(canvas, colors, size = 5) {
        if (!colors.length) return;

        const containerWidth = canvas.parentElement.clientWidth - 32;
        const cellSize = Math.floor(containerWidth / size);
        const totalSize = cellSize * size;
        const ctx = this.setupCanvas(canvas, totalSize, totalSize);
        const gap = 2;

        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const idx = (row * size + col) % colors.length;
                const x = col * cellSize + gap;
                const y = row * cellSize + gap;
                const w = cellSize - gap * 2;
                const h = cellSize - gap * 2;

                // Rounded rect
                const r = 4;
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + w - r, y);
                ctx.quadraticCurveTo(x + w, y, x + w, y + r);
                ctx.lineTo(x + w, y + h - r);
                ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                ctx.lineTo(x + r, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
                ctx.closePath();
                ctx.fillStyle = colors[idx];
                ctx.fill();

                // Hex label
                if (cellSize > 45) {
                    ctx.font = '10px -apple-system, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = ColorUtils.contrastColor(colors[idx]);
                    ctx.fillText(colors[idx], x + w / 2, y + h / 2 + 4);
                }
            }
        }
    },

    drawTonalGrid(canvas, colors, steps = 7) {
        if (!colors.length) return;

        const containerWidth = canvas.parentElement.clientWidth - 32;
        const cellW = Math.floor(containerWidth / steps);
        const cellH = 48;
        const totalW = cellW * steps;
        const totalH = cellH * colors.length;
        const ctx = this.setupCanvas(canvas, totalW, totalH);
        const gap = 1;

        colors.forEach((hex, row) => {
            for (let col = 0; col < steps; col++) {
                // From tint (white) to shade (black)
                const t = col / (steps - 1);
                let color;
                if (t < 0.5) {
                    color = ColorUtils.tint(hex, 1 - t * 2);
                } else {
                    color = ColorUtils.shade(hex, (t - 0.5) * 2);
                }

                const x = col * cellW + gap;
                const y = row * cellH + gap;
                ctx.fillStyle = color;
                ctx.fillRect(x, y, cellW - gap * 2, cellH - gap * 2);

                if (cellW > 45) {
                    ctx.font = '9px -apple-system, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = ColorUtils.contrastColor(color);
                    ctx.fillText(color, x + (cellW - gap * 2) / 2, y + cellH / 2);
                }
            }
        });
    },

    drawMixingGrid(canvas, colorA, colorB, size = 5) {
        const containerWidth = canvas.parentElement.clientWidth - 32;
        const cellSize = Math.floor(containerWidth / (size + 1));
        const totalSize = cellSize * (size + 1);
        const ctx = this.setupCanvas(canvas, totalSize, totalSize);
        const gap = 1;

        // Header row: Color A gradations
        for (let col = 1; col <= size; col++) {
            const t = (col - 1) / (size - 1);
            const color = ColorUtils.tint(colorA, 1 - t);
            ctx.fillStyle = color;
            ctx.fillRect(col * cellSize + gap, gap, cellSize - gap * 2, cellSize - gap * 2);
        }

        // Header column: Color B gradations
        for (let row = 1; row <= size; row++) {
            const t = (row - 1) / (size - 1);
            const color = ColorUtils.tint(colorB, 1 - t);
            ctx.fillStyle = color;
            ctx.fillRect(gap, row * cellSize + gap, cellSize - gap * 2, cellSize - gap * 2);
        }

        // Grid cells: blend of row/col colors
        for (let row = 1; row <= size; row++) {
            for (let col = 1; col <= size; col++) {
                const tA = (col - 1) / (size - 1);
                const tB = (row - 1) / (size - 1);
                const cA = ColorUtils.tint(colorA, 1 - tA);
                const cB = ColorUtils.tint(colorB, 1 - tB);
                const mixed = ColorUtils.blendPaint(cA, cB, 0.5);

                const x = col * cellSize + gap;
                const y = row * cellSize + gap;
                ctx.fillStyle = mixed;
                ctx.fillRect(x, y, cellSize - gap * 2, cellSize - gap * 2);

                if (cellSize > 45) {
                    ctx.font = '8px -apple-system, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = ColorUtils.contrastColor(mixed);
                    ctx.fillText(mixed, x + (cellSize - gap * 2) / 2, y + (cellSize - gap * 2) / 2 + 3);
                }
            }
        }

        // Top-left corner label
        ctx.fillStyle = '#e8e6e1';
        ctx.fillRect(gap, gap, cellSize - gap * 2, cellSize - gap * 2);
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#888';
        ctx.fillText('A \u00d7 B', cellSize / 2, cellSize / 2 + 4);
    }
};
