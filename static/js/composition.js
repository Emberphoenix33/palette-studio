// Reference image + grid overlay rendering
const Composition = {
    image: null,
    flipped: false,
    grayscale: false,
    zoomedCell: null,

    loadImage(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.image = img;
                this.flipped = false;
                this.grayscale = false;
                this.zoomedCell = null;
                if (callback) callback();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    getDimensions(canvas) {
        const containerWidth = canvas.parentElement.clientWidth;
        const aspect = this.image.height / this.image.width;
        return { w: containerWidth, h: containerWidth * aspect };
    },

    render(canvas) {
        if (!this.image) return;

        const { w, h } = this.getDimensions(canvas);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        if (this.flipped) {
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
        }

        ctx.drawImage(this.image, 0, 0, w, h);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.applyAdjustments(ctx, canvas.width, canvas.height);
        this.drawGrid(ctx, w, h);
    },

    renderZoomed(canvas) {
        if (!this.image || !this.zoomedCell) return;

        const divisions = parseInt(document.getElementById('grid-divisions')?.value || 4);
        const { row, col } = this.zoomedCell;

        const srcW = this.image.width / divisions;
        const srcH = this.image.height / divisions;
        const srcX = col * srcW;
        const srcY = row * srcH;

        const containerWidth = canvas.parentElement.clientWidth;
        const aspect = srcH / srcW;
        const dispW = containerWidth;
        const dispH = containerWidth * aspect;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = dispW * dpr;
        canvas.height = dispH * dpr;
        canvas.style.width = dispW + 'px';
        canvas.style.height = dispH + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        if (this.flipped) {
            const flippedSrcX = this.image.width - srcX - srcW;
            ctx.translate(dispW, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(this.image, flippedSrcX, srcY, srcW, srcH, 0, 0, dispW, dispH);
        } else {
            ctx.drawImage(this.image, srcX, srcY, srcW, srcH, 0, 0, dispW, dispH);
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.applyAdjustments(ctx, canvas.width, canvas.height);

        // Label
        const color = document.getElementById('overlay-color')?.value || '#ffffff';
        const opacity = (document.getElementById('overlay-opacity')?.value || 70) / 100;
        const cellNum = row * divisions + col + 1;
        ctx.globalAlpha = opacity;
        ctx.font = 'bold 16px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(`Square ${cellNum}`, 9, 9);
        ctx.fillStyle = color;
        ctx.fillText(`Square ${cellNum}`, 8, 8);
        ctx.globalAlpha = 1;
    },

    applyAdjustments(ctx, w, h) {
        const contrast = (document.getElementById('ref-contrast')?.value || 100) / 100;
        const brightness = (document.getElementById('ref-brightness')?.value || 100) / 100;
        const needsAdjust = contrast !== 1 || brightness !== 1 || this.grayscale;

        if (!needsAdjust) return;

        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;

        // Contrast: scale around midpoint (128)
        // Brightness: simple multiply
        const c = contrast;
        const b = brightness;

        for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i+1], bl = d[i+2];

            // Brightness
            r *= b; g *= b; bl *= b;

            // Contrast (around midpoint)
            r = (r - 128) * c + 128;
            g = (g - 128) * c + 128;
            bl = (bl - 128) * c + 128;

            if (this.grayscale) {
                const gray = r * 0.299 + g * 0.587 + bl * 0.114;
                r = g = bl = gray;
            }

            d[i]   = Math.max(0, Math.min(255, r));
            d[i+1] = Math.max(0, Math.min(255, g));
            d[i+2] = Math.max(0, Math.min(255, bl));
        }

        ctx.putImageData(imageData, 0, 0);
    },

    drawGrid(ctx, w, h) {
        const color = document.getElementById('overlay-color')?.value || '#ffffff';
        const opacity = (document.getElementById('overlay-opacity')?.value || 70) / 100;
        const divisions = parseInt(document.getElementById('grid-divisions')?.value || 4);

        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = 1.5;

        for (let i = 1; i < divisions; i++) {
            ctx.beginPath();
            ctx.moveTo(w * i / divisions, 0);
            ctx.lineTo(w * i / divisions, h);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, h * i / divisions);
            ctx.lineTo(w, h * i / divisions);
            ctx.stroke();
        }

        // Number the grid squares
        ctx.globalAlpha = opacity * 0.9;
        ctx.font = `bold ${Math.max(11, Math.floor(w / divisions / 4))}px -apple-system, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        let num = 1;
        for (let row = 0; row < divisions; row++) {
            for (let col = 0; col < divisions; col++) {
                const x = col * w / divisions + 4;
                const y = row * h / divisions + 3;

                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillText(num, x + 1, y + 1);
                ctx.fillStyle = color;
                ctx.fillText(num, x, y);
                num++;
            }
        }

        ctx.globalAlpha = 1;
    },

    hitTestGrid(canvas, clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const { w, h } = this.getDimensions(canvas);
        const divisions = parseInt(document.getElementById('grid-divisions')?.value || 4);

        const col = Math.floor(x / (w / divisions));
        const row = Math.floor(y / (h / divisions));

        if (row >= 0 && row < divisions && col >= 0 && col < divisions) {
            return { row, col };
        }
        return null;
    }
};
