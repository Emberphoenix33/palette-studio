// Main app controller
const App = {
    activePalette: [],
    _currentFile: null,
    _imageId: null,
    _colormapImg: null,
    _showingOriginal: false,
    _originalImage: null,
    _sketchCache: {},
    _sketchMode: false,
    _sketchLoading: false,
    _sketchRequestId: 0,
    _collageImages: [],
    _collagePets: null,
    _collageActive: null,
    _eyedropperMode: false,
    _eyedropperHex: null,
    _timerInterval: null,
    _timerSeconds: 0,
    _timerRunning: false,
    _progressImage: null,
    _pendingCanvasTap: null,

    init() {
        this.setupUpload();
        this.setupCollage();
        this.setupTabs();
        this.setupReference();
        this.setupPalette();
        this.setupPaint();
        this.setupTimer();
        this.setupExport();
        this.addToast();
    },

    // --- Toast ---
    addToast() {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.id = 'toast';
        document.body.appendChild(toast);
    },

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1500);
    },

    // --- Upload Screen ---
    setupUpload() {
        const imageInput = document.getElementById('image-input');
        const imageCameraInput = document.getElementById('image-camera-input');
        const handleImageSelection = (event) => {
            const file = event.target.files[0];
            if (file) this.loadPhoto(file);
            event.target.value = '';
        };

        imageInput.addEventListener('change', handleImageSelection);
        imageCameraInput.addEventListener('change', handleImageSelection);
    },

    // --- Collage ---
    setupCollage() {
        const collageInput = document.getElementById('collage-input');

        collageInput.addEventListener('change', () => {
            const files = Array.from(collageInput.files);
            if (files.length < 2) {
                this.showToast('Select at least 2 photos');
                return;
            }
            if (files.length > 10) {
                this.showToast('Maximum 10 photos');
                return;
            }
            this.processCollage(files);
        });

        document.getElementById('collage-use-btn').addEventListener('click', () => {
            this.useCollage();
        });

        document.getElementById('collage-reset-btn').addEventListener('click', () => {
            this._collageImages = [];
            this._collagePets = null;
            this._collageActive = null;
            document.getElementById('collage-preview').classList.add('hidden');
            document.getElementById('collage-input').value = '';
        });
    },

    async processCollage(files) {
        this.showToast('Removing backgrounds (first time may take a moment)...');
        document.getElementById('collage-zone').querySelector('p').textContent = 'Processing...';

        const cutouts = [];
        for (const file of files) {
            try {
                const fd = new FormData();
                fd.append('image', file);
                const resp = await fetch('/remove-bg', { method: 'POST', body: fd });
                if (!resp.ok) throw new Error('Server error');
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const img = await new Promise((resolve, reject) => {
                    const i = new Image();
                    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
                    i.onerror = reject;
                    i.src = url;
                });
                cutouts.push(img);
            } catch (err) {
                this.showToast('Background removal failed');
                document.getElementById('collage-zone').querySelector('p').textContent = 'Tap to select 2–10 photos';
                return;
            }
        }

        document.getElementById('collage-zone').querySelector('p').textContent = 'Tap to select 2–10 photos';
        this._collageImages = cutouts;
        this.renderCollagePreview();
    },

    renderCollagePreview() {
        const canvas = document.getElementById('collage-canvas');
        const images = this._collageImages;
        const n = images.length;

        const canvasW = 1200;
        const canvasH = 900;
        canvas.width = canvasW;
        canvas.height = canvasH;

        // Initialize pet state for dragging/resizing if not already set
        if (!this._collagePets || this._collagePets.length !== n) {
            this._collagePets = images.map((img, i) => {
                // Default: scale to fit ~60% height, spread across canvas
                const targetH = canvasH * 0.65;
                const scale = targetH / img.height;
                const w = img.width * scale;
                const h = img.height * scale;
                const spacing = canvasW / (n + 1);
                return {
                    img,
                    x: spacing * (i + 1) - w / 2,
                    y: canvasH - h,
                    w, h,
                    scale,
                    z: i,
                };
            });
        }

        this._drawCollage();
        this._setupCollageTouch(canvas);

        document.getElementById('collage-preview').classList.remove('hidden');
        this.showToast('Drag to position, pinch to resize');
    },

    _drawCollage() {
        const canvas = document.getElementById('collage-canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw in z-order
        const sorted = [...this._collagePets].sort((a, b) => a.z - b.z);
        sorted.forEach(p => {
            ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
        });

        // Draw selection ring on active pet
        if (this._collageActive != null) {
            const p = this._collagePets[this._collageActive];
            ctx.strokeStyle = 'rgba(201, 107, 60, 0.8)';
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 4]);
            ctx.strokeRect(p.x, p.y, p.w, p.h);
            ctx.setLineDash([]);
        }

        this._renderLayerPanel();
    },

    _normalizeZ() {
        const sorted = [...this._collagePets].sort((a, b) => a.z - b.z);
        sorted.forEach((p, i) => { p.z = i; });
    },

    _renderLayerPanel() {
        const panel = document.getElementById('layer-panel');
        if (!this._collagePets || !this._collagePets.length) return;

        panel.innerHTML = '';

        // Show top layer first
        const order = this._collagePets
            .map((pet, idx) => ({ pet, idx }))
            .sort((a, b) => b.pet.z - a.pet.z);

        order.forEach(({ pet, idx }) => {
            const item = document.createElement('div');
            item.className = 'layer-item' + (idx === this._collageActive ? ' layer-active' : '');

            // Thumbnail
            const thumb = document.createElement('canvas');
            thumb.width = 44;
            thumb.height = 44;
            const tctx = thumb.getContext('2d');
            const ratio = Math.min(44 / pet.img.width, 44 / pet.img.height);
            const tw = pet.img.width * ratio;
            const th = pet.img.height * ratio;
            tctx.drawImage(pet.img, (44 - tw) / 2, (44 - th) / 2, tw, th);
            item.appendChild(thumb);

            // Select on tap
            item.addEventListener('click', () => {
                this._collageActive = idx;
                this._drawCollage();
            });

            // Up/down buttons
            const btns = document.createElement('div');
            btns.className = 'layer-btns';

            const btnUp = document.createElement('button');
            btnUp.textContent = '▲';
            btnUp.className = 'layer-btn';
            btnUp.title = 'Bring forward';
            btnUp.addEventListener('click', (e) => {
                e.stopPropagation();
                const above = this._collagePets
                    .filter(p => p.z > pet.z)
                    .sort((a, b) => a.z - b.z)[0];
                if (above) { const tmp = above.z; above.z = pet.z; pet.z = tmp; }
                this._drawCollage();
            });

            const btnDown = document.createElement('button');
            btnDown.textContent = '▼';
            btnDown.className = 'layer-btn';
            btnDown.title = 'Send back';
            btnDown.addEventListener('click', (e) => {
                e.stopPropagation();
                const below = this._collagePets
                    .filter(p => p.z < pet.z)
                    .sort((a, b) => b.z - a.z)[0];
                if (below) { const tmp = below.z; below.z = pet.z; pet.z = tmp; }
                this._drawCollage();
            });

            btns.appendChild(btnUp);
            btns.appendChild(btnDown);
            item.appendChild(btns);
            panel.appendChild(item);
        });
    },

    _collageHitTest(cx, cy) {
        // Simple bounding box hit test, highest z first
        const sorted = [...this._collagePets]
            .map((p, i) => ({ ...p, idx: i }))
            .sort((a, b) => b.z - a.z);

        for (const p of sorted) {
            // Use a slightly padded hit area for easier touch targeting
            const pad = 20;
            if (cx >= p.x - pad && cx <= p.x + p.w + pad &&
                cy >= p.y - pad && cy <= p.y + p.h + pad) {
                return p.idx;
            }
        }
        return null;
    },

    _setupCollageTouch(canvas) {
        // Avoid re-binding if already set up
        if (canvas._collageListenersAttached) return;
        canvas._collageListenersAttached = true;

        let dragging = false;
        let dragStartX, dragStartY, petStartX, petStartY;
        let pinchStartDist = 0, pinchStartScale = 0;

        const getPos = (e) => {
            const source = e.touches ? e.touches[0] : e;
            const r = canvas.getBoundingClientRect();
            return {
                x: (source.clientX - r.left) * (canvas.width / r.width),
                y: (source.clientY - r.top) * (canvas.height / r.height),
            };
        };

        const getPinchDist = (e) => {
            const t1 = e.touches[0], t2 = e.touches[1];
            return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        };

        // --- Touch events ---
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const pos = getPos(e);
            const hit = this._collageHitTest(pos.x, pos.y);
            if (hit != null) {
                this._collageActive = hit;
                const maxZ = Math.max(...this._collagePets.map(p => p.z));
                this._collagePets[hit].z = maxZ + 1;
                dragging = true;
                dragStartX = pos.x;
                dragStartY = pos.y;
                petStartX = this._collagePets[hit].x;
                petStartY = this._collagePets[hit].y;
            } else {
                this._collageActive = null;
                dragging = false;
            }
            this._drawCollage();

            if (e.touches.length === 2 && this._collageActive != null) {
                pinchStartDist = getPinchDist(e);
                pinchStartScale = this._collagePets[this._collageActive].scale;
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!dragging || this._collageActive == null) return;

            if (e.touches.length === 2 && pinchStartDist > 0) {
                const dist = getPinchDist(e);
                const ratio = dist / pinchStartDist;
                const pet = this._collagePets[this._collageActive];
                const newScale = pinchStartScale * ratio;
                const cx = pet.x + pet.w / 2;
                const cy = pet.y + pet.h / 2;
                pet.scale = newScale;
                pet.w = pet.img.width * newScale;
                pet.h = pet.img.height * newScale;
                pet.x = cx - pet.w / 2;
                pet.y = cy - pet.h / 2;
                this._drawCollage();
                return;
            }

            const pos = getPos(e);
            const pet = this._collagePets[this._collageActive];
            pet.x = petStartX + (pos.x - dragStartX);
            pet.y = petStartY + (pos.y - dragStartY);
            this._drawCollage();
        }, { passive: false });

        canvas.addEventListener('touchend', () => { dragging = false; });

        // --- Mouse events (for desktop testing) ---
        canvas.addEventListener('mousedown', (e) => {
            const pos = getPos(e);
            const hit = this._collageHitTest(pos.x, pos.y);
            if (hit != null) {
                this._collageActive = hit;
                const maxZ = Math.max(...this._collagePets.map(p => p.z));
                this._collagePets[hit].z = maxZ + 1;
                dragging = true;
                dragStartX = pos.x;
                dragStartY = pos.y;
                petStartX = this._collagePets[hit].x;
                petStartY = this._collagePets[hit].y;
            } else {
                this._collageActive = null;
                dragging = false;
            }
            this._drawCollage();
        });

        // Listen on window so drag continues even if mouse leaves canvas
        window.addEventListener('mousemove', (e) => {
            if (!dragging || this._collageActive == null) return;
            const pos = getPos(e);
            const pet = this._collagePets[this._collageActive];
            pet.x = petStartX + (pos.x - dragStartX);
            pet.y = petStartY + (pos.y - dragStartY);
            this._drawCollage();
        });

        window.addEventListener('mouseup', () => { dragging = false; });
    },

    useCollage() {
        const canvas = document.getElementById('collage-canvas');
        canvas.toBlob(blob => {
            const file = new File([blob], 'collage.png', { type: 'image/png' });
            this.loadPhoto(file);
        });
    },

    loadPhoto(file) {
        this._currentFile = file;

        // Load image for reference/grid view
        Composition.loadImage(file, () => {
            // Store original and reset sketch state
            this._originalImage = Composition.image;
            this._sketchCache = {};
            this._sketchMode = false;
            this._sketchLoading = false;
            document.getElementById('sketch-btn').style.background = '';
            document.getElementById('sketch-controls').classList.add('hidden');

            // Show the main app
            document.getElementById('upload-screen').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            document.getElementById('tab-bar').classList.remove('hidden');

            // Render reference grid
            Composition.render(document.getElementById('ref-canvas'));

            // Extract palette
            this.extractColors(file);
        });
    },

    async extractColors(file) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('n_colors', document.getElementById('n-colors').value);

        try {
            const resp = await fetch('/extract', { method: 'POST', body: formData });
            const data = await resp.json();
            this._imageId = data.id;
            this.renderExtractedPalette(data.colors);
        } catch (err) {
            this.showToast('Color extraction failed');
        }
    },

    // --- Tabs ---
    setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

                if (btn.dataset.tab === 'paint') this.refreshPaint();
                if (btn.dataset.tab === 'reference') {
                    Composition.render(document.getElementById('ref-canvas'));
                }
            });
        });
    },

    // --- Reference Tab ---
    setupReference() {
        // Flip button
        document.getElementById('flip-btn').addEventListener('click', () => {
            Composition.flipped = !Composition.flipped;
            const btn = document.getElementById('flip-btn');
            btn.style.background = Composition.flipped ? 'var(--accent)' : '';
            this.renderRef();
        });

        // Grayscale button
        document.getElementById('grayscale-btn').addEventListener('click', () => {
            Composition.grayscale = !Composition.grayscale;
            document.getElementById('grayscale-btn').style.background = Composition.grayscale ? 'var(--accent)' : '';
            this.renderRef();
        });

        // Contrast slider
        const contrastSlider = document.getElementById('ref-contrast');
        const contrastVal = document.getElementById('ref-contrast-val');
        contrastSlider.addEventListener('input', () => {
            contrastVal.textContent = contrastSlider.value + '%';
            this.renderRef();
        });

        // Brightness slider
        const brightSlider = document.getElementById('ref-brightness');
        const brightVal = document.getElementById('ref-brightness-val');
        brightSlider.addEventListener('input', () => {
            brightVal.textContent = brightSlider.value + '%';
            this.renderRef();
        });

        // Sketch toggle
        document.getElementById('sketch-btn').addEventListener('click', () => {
            this.toggleSketch();
        });

        const sketchDetail = document.getElementById('sketch-detail');
        const sketchDetailVal = document.getElementById('sketch-detail-val');
        sketchDetail.addEventListener('input', () => {
            sketchDetailVal.textContent = sketchDetail.value;
            if (this._sketchMode) {
                this.loadSketch();
            }
        });

        const sketchSuppression = document.getElementById('sketch-suppression');
        const sketchSuppressionVal = document.getElementById('sketch-suppression-val');
        sketchSuppression.addEventListener('input', () => {
            sketchSuppressionVal.textContent = sketchSuppression.value;
            if (this._sketchMode) {
                this.loadSketch();
            }
        });

        const sketchThickness = document.getElementById('sketch-thickness');
        const sketchThicknessVal = document.getElementById('sketch-thickness-val');
        sketchThickness.addEventListener('input', () => {
            sketchThicknessVal.textContent = sketchThickness.value;
            if (this._sketchMode) {
                this.loadSketch();
            }
        });

        const sketchOutlineOnly = document.getElementById('sketch-outline-only');
        sketchOutlineOnly.addEventListener('change', () => {
            if (this._sketchMode) {
                this.loadSketch();
            }
        });

        // New photo button
        document.getElementById('change-photo-btn').addEventListener('click', () => {
            document.getElementById('main-app').classList.add('hidden');
            document.getElementById('tab-bar').classList.add('hidden');
            document.getElementById('upload-screen').classList.remove('hidden');
            // Reset file input
            document.getElementById('image-input').value = '';
        });

        // Grid controls
        const gridDiv = document.getElementById('grid-divisions');
        const gridDivVal = document.getElementById('grid-divisions-val');
        gridDiv.addEventListener('input', () => {
            gridDivVal.textContent = gridDiv.value;
            this.renderRef();
        });

        document.getElementById('overlay-color').addEventListener('input', () => this.renderRef());

        const opacitySlider = document.getElementById('overlay-opacity');
        const opacityVal = document.getElementById('overlay-opacity-val');
        opacitySlider.addEventListener('input', () => {
            opacityVal.textContent = opacitySlider.value + '%';
            this.renderRef();
        });

        // Tap grid square to zoom (or eyedropper)
        const refCanvas = document.getElementById('ref-canvas');
        refCanvas.addEventListener('click', (e) => {
            if (this._pendingCanvasTap?.target === refCanvas) {
                this._pendingCanvasTap = null;
                return;
            }
            this.handleReferenceTap(refCanvas, e.clientX, e.clientY);
        });

        this.setupCanvasTap(refCanvas, ({ clientX, clientY }) => {
            this.handleReferenceTap(refCanvas, clientX, clientY);
        });

        // Eyedropper on zoom canvas too
        const zoomCanvas = document.getElementById('zoom-canvas');
        zoomCanvas.addEventListener('click', (e) => {
            if (this._pendingCanvasTap?.target === zoomCanvas) {
                this._pendingCanvasTap = null;
                return;
            }
            if (this._eyedropperMode) {
                this._pickColor(zoomCanvas, e);
            }
        });

        this.setupCanvasTap(zoomCanvas, ({ clientX, clientY }) => {
            if (this._eyedropperMode) {
                this._pickColor(zoomCanvas, { clientX, clientY });
            }
        });

        // Progress comparison setup
        const handleProgressSelection = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                this._progressImage = img;
                document.getElementById('progress-compare').classList.remove('hidden');
                this.renderComparison();
            };
            img.src = url;
            e.target.value = '';
        };

        document.getElementById('progress-input').addEventListener('change', handleProgressSelection);
        document.getElementById('progress-camera-input').addEventListener('change', handleProgressSelection);

        document.getElementById('compare-slider').addEventListener('input', () => {
            this.renderComparison();
        });

        // Back from zoom
        document.getElementById('zoom-back-btn').addEventListener('click', () => {
            Composition.zoomedCell = null;
            document.getElementById('zoom-view').classList.add('hidden');
            document.getElementById('zoom-hint').classList.remove('hidden');
            const wrap = document.querySelector('.ref-canvas-wrap');
            wrap.classList.remove('hidden');
            Composition.render(document.getElementById('ref-canvas'));
        });
    },

    renderRef() {
        if (Composition.zoomedCell) {
            Composition.renderZoomed(document.getElementById('zoom-canvas'));
        } else {
            Composition.render(document.getElementById('ref-canvas'));
        }
    },

    handleReferenceTap(canvas, clientX, clientY) {
        if (this._eyedropperMode) {
            this._pickColor(canvas, { clientX, clientY });
            return;
        }

        const cell = Composition.hitTestGrid(canvas, clientX, clientY);
        if (!cell) return;

        Composition.zoomedCell = cell;
        document.getElementById('zoom-hint').classList.add('hidden');
        document.getElementById('zoom-view').classList.remove('hidden');
        canvas.parentElement.classList.add('hidden');
        Composition.renderZoomed(document.getElementById('zoom-canvas'));
    },

    setupCanvasTap(canvas, onTap) {
        let startPoint = null;
        const moveThreshold = 12;

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) {
                startPoint = null;
                return;
            }

            const touch = e.touches[0];
            startPoint = { clientX: touch.clientX, clientY: touch.clientY };
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (!startPoint || e.touches.length !== 1) {
                startPoint = null;
                return;
            }

            const touch = e.touches[0];
            const moved = Math.hypot(touch.clientX - startPoint.clientX, touch.clientY - startPoint.clientY);
            if (moved > moveThreshold) {
                startPoint = null;
            }
        }, { passive: true });

        canvas.addEventListener('touchend', (e) => {
            if (!startPoint) return;

            const touch = e.changedTouches[0];
            const moved = Math.hypot(touch.clientX - startPoint.clientX, touch.clientY - startPoint.clientY);
            startPoint = null;
            if (moved > moveThreshold) return;

            this._pendingCanvasTap = { target: canvas };
            onTap({ clientX: touch.clientX, clientY: touch.clientY });
        }, { passive: true });
    },

    // --- Sketch ---
    toggleSketch() {
        if (this._sketchLoading) return;

        this._sketchMode = !this._sketchMode;
        const btn = document.getElementById('sketch-btn');
        btn.style.background = this._sketchMode ? 'var(--accent)' : '';
        document.getElementById('sketch-controls').classList.toggle('hidden', !this._sketchMode);

        if (this._sketchMode) {
            // Save original image and load sketch
            if (!this._originalImage) this._originalImage = Composition.image;
            this.loadSketch();
        } else {
            // Restore original image
            Composition.image = this._originalImage;
            this.renderRef();
        }
    },

    async loadSketch() {
        if (!this._imageId) {
            this.showToast('Upload a photo first');
            return;
        }

        const detail = document.getElementById('sketch-detail').value;
        const suppression = document.getElementById('sketch-suppression').value;
        const thickness = document.getElementById('sketch-thickness').value;
        const outlineOnly = document.getElementById('sketch-outline-only').checked ? '1' : '0';
        const cacheKey = `${this._imageId}:${detail}:${suppression}:${thickness}:${outlineOnly}`;

        // Use cached sketch if available
        if (this._sketchCache[cacheKey]) {
            Composition.image = this._sketchCache[cacheKey];
            this.renderRef();
            return;
        }

        const requestId = ++this._sketchRequestId;
        this._sketchLoading = true;
        this.showToast('Generating sketch...');

        try {
            const resp = await fetch(`/sketch/${this._imageId}?detail=${detail}&suppression=${suppression}&thickness=${thickness}&outline_only=${outlineOnly}`);
            if (!resp.ok) throw new Error();

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                if (requestId !== this._sketchRequestId) return;
                this._sketchCache[cacheKey] = img;
                this._sketchLoading = false;
                if (!this._sketchMode) return;
                Composition.image = img;
                this.renderRef();
            };
            img.src = url;
        } catch (err) {
            if (requestId === this._sketchRequestId) {
                this._sketchLoading = false;
            }
            this.showToast('Sketch generation failed');
        }
    },

    // --- Palette Tab ---
    setupPalette() {
        const nColors = document.getElementById('n-colors');
        const nColorsVal = document.getElementById('n-colors-val');
        nColors.addEventListener('input', () => nColorsVal.textContent = nColors.value);

        document.getElementById('re-extract-btn').addEventListener('click', () => {
            if (this._currentFile) this.extractColors(this._currentFile);
        });

        document.getElementById('clear-palette-btn').addEventListener('click', () => {
            this.activePalette = [];
            this.renderActivePalette();
        });

        document.getElementById('colormap-btn').addEventListener('click', () => {
            this.generateColorMap();
        });

        document.getElementById('original-btn').addEventListener('click', () => {
            this.toggleOriginal();
        });

        const colormapSimplify = document.getElementById('colormap-simplify');
        const colormapSimplifyVal = document.getElementById('colormap-simplify-val');
        colormapSimplify.addEventListener('input', () => {
            colormapSimplifyVal.textContent = colormapSimplify.value;
        });

        // Eyedropper — switches to Reference tab to pick, then comes back
        document.getElementById('eyedropper-btn').addEventListener('click', () => {
            this._eyedropperMode = true;
            this._eyedropperReturnTab = 'palette';
            document.getElementById('eyedropper-btn').style.background = 'var(--accent)';
            // Switch to reference tab
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="reference"]').classList.add('active');
            document.getElementById('tab-reference').classList.add('active');
            Composition.render(document.getElementById('ref-canvas'));
            this.showToast('Tap the photo to pick a color');
        });

        document.getElementById('eyedrop-add-btn').addEventListener('click', () => {
            if (!this._eyedropperHex) return;
            if (this.activePalette.includes(this._eyedropperHex)) {
                this.showToast('Color already in palette');
                return;
            }
            if (this.activePalette.length >= 12) {
                this.showToast('Max 12 colors in active palette');
                return;
            }
            this.activePalette.push(this._eyedropperHex);
            this.renderActivePalette();
            this.showToast('Added ' + this._eyedropperHex);
        });

        // Value map
        const valueLevels = document.getElementById('value-levels');
        const valueLevelsVal = document.getElementById('value-levels-val');
        valueLevels.addEventListener('input', () => valueLevelsVal.textContent = valueLevels.value);

        document.getElementById('valuemap-btn').addEventListener('click', () => {
            this.generateValueMap();
        });
    },

    renderExtractedPalette(colors) {
        const container = document.getElementById('extracted-palette');
        container.innerHTML = '';
        colors.forEach(c => {
            const swatch = this.createSwatch(c.hex, `${c.pct}%`);
            container.appendChild(swatch);
        });
    },

    createSwatch(hex, label) {
        const div = document.createElement('div');
        div.className = 'swatch';
        div.style.backgroundColor = hex;
        div.dataset.hex = hex;
        if (this.activePalette.includes(hex)) div.classList.add('in-active');

        if (label) {
            const lbl = document.createElement('span');
            lbl.className = 'swatch-label';
            lbl.textContent = label;
            div.appendChild(lbl);
        }

        div.addEventListener('click', () => {
            if (this.activePalette.includes(hex)) {
                this.activePalette = this.activePalette.filter(c => c !== hex);
                div.classList.remove('in-active');
            } else if (this.activePalette.length < 12) {
                this.activePalette.push(hex);
                div.classList.add('in-active');
            } else {
                this.showToast('Max 12 colors in active palette');
                return;
            }
            this.renderActivePalette();
        });

        // Long press to copy hex
        let pressTimer;
        div.addEventListener('touchstart', () => {
            pressTimer = setTimeout(() => {
                navigator.clipboard?.writeText(hex);
                this.showToast('Copied ' + hex);
            }, 500);
        });
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('touchmove', () => clearTimeout(pressTimer));

        return div;
    },

    renderActivePalette() {
        const container = document.getElementById('active-palette');
        container.innerHTML = '';
        this.activePalette.forEach(hex => {
            const div = document.createElement('div');
            div.className = 'swatch';
            div.style.backgroundColor = hex;

            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '\u00d7';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.activePalette = this.activePalette.filter(c => c !== hex);
                this.renderActivePalette();
                document.querySelectorAll('.swatch').forEach(s => {
                    if (s.dataset.hex === hex) s.classList.remove('in-active');
                });
            });
            div.appendChild(removeBtn);

            div.addEventListener('click', () => {
                navigator.clipboard?.writeText(hex);
                this.showToast('Copied ' + hex);
            });

            container.appendChild(div);
        });

    },

    // --- Color Map ---
    async generateColorMap() {
        if (!this._imageId || this.activePalette.length === 0) {
            this.showToast('Add colors to your palette first');
            return;
        }

        const btn = document.getElementById('colormap-btn');
        const simplify = document.getElementById('colormap-simplify').value;
        btn.textContent = 'Generating...';

        const colors = this.activePalette.join(',');
        try {
            const resp = await fetch(`/colormap/${this._imageId}?colors=${encodeURIComponent(colors)}&simplify=${encodeURIComponent(simplify)}`);
            if (!resp.ok) throw new Error();

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = () => {
                const canvas = document.getElementById('colormap-canvas');
                const containerWidth = canvas.parentElement.clientWidth - 32;
                const aspect = img.height / img.width;
                const dpr = window.devicePixelRatio || 1;
                const w = containerWidth;
                const h = containerWidth * aspect;

                canvas.width = w * dpr;
                canvas.height = h * dpr;
                canvas.style.width = w + 'px';
                canvas.style.height = h + 'px';

                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.drawImage(img, 0, 0, w, h);

                URL.revokeObjectURL(url);

                this._colormapImg = img;
                this._showingOriginal = false;
                document.getElementById('colormap-container').classList.remove('hidden');
                document.getElementById('original-btn').classList.remove('hidden');
                document.getElementById('original-btn').textContent = 'Show Original';
                btn.textContent = 'Regenerate Color Map';

                // Render legend
                const legend = document.getElementById('colormap-legend');
                legend.innerHTML = '';
                this.activePalette.forEach((hex, i) => {
                    const item = document.createElement('div');
                    item.className = 'legend-item';

                    const swatch = document.createElement('div');
                    swatch.className = 'legend-swatch';
                    swatch.style.backgroundColor = hex;

                    const num = document.createElement('span');
                    num.className = 'legend-num';
                    num.textContent = i + 1;
                    // Pick contrasting text
                    const r = parseInt(hex.slice(1,3), 16);
                    const g = parseInt(hex.slice(3,5), 16);
                    const b = parseInt(hex.slice(5,7), 16);
                    num.style.color = (0.299*r + 0.587*g + 0.114*b) > 128 ? '#222' : '#fff';
                    swatch.appendChild(num);

                    const label = document.createElement('span');
                    label.className = 'legend-label';
                    label.textContent = hex;

                    item.appendChild(swatch);
                    item.appendChild(label);
                    legend.appendChild(item);
                });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                this.showToast('Color map failed');
                btn.textContent = 'Generate Color Map';
            };
            img.src = url;
        } catch (err) {
            this.showToast('Color map failed');
            btn.textContent = 'Generate Color Map';
        }
    },

    toggleOriginal() {
        const canvas = document.getElementById('colormap-canvas');
        const btn = document.getElementById('original-btn');
        this._showingOriginal = !this._showingOriginal;

        const img = this._showingOriginal ? Composition.image : this._colormapImg;
        if (!img) return;

        const containerWidth = canvas.parentElement.clientWidth - 32;
        const aspect = img.height / img.width;
        const dpr = window.devicePixelRatio || 1;
        const w = containerWidth;
        const h = containerWidth * aspect;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.drawImage(img, 0, 0, w, h);

        btn.textContent = this._showingOriginal ? 'Show Color Map' : 'Show Original';
    },

    // --- Value Map ---
    async generateValueMap() {
        if (!this._imageId) {
            this.showToast('Upload a photo first');
            return;
        }

        const btn = document.getElementById('valuemap-btn');
        btn.textContent = 'Generating...';

        const levels = document.getElementById('value-levels').value;
        try {
            const resp = await fetch(`/valuemap/${this._imageId}?levels=${levels}`);
            if (!resp.ok) throw new Error();

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);

            const img = new Image();
            img.onload = () => {
                const canvas = document.getElementById('valuemap-canvas');
                const containerWidth = canvas.parentElement.clientWidth - 32;
                const aspect = img.height / img.width;
                const dpr = window.devicePixelRatio || 1;
                const w = containerWidth;
                const h = containerWidth * aspect;

                canvas.width = w * dpr;
                canvas.height = h * dpr;
                canvas.style.width = w + 'px';
                canvas.style.height = h + 'px';

                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.drawImage(img, 0, 0, w, h);

                URL.revokeObjectURL(url);

                document.getElementById('valuemap-container').classList.remove('hidden');
                btn.textContent = 'Regenerate Value Map';

                // Render legend: value 1 (lightest) to N (darkest)
                const legend = document.getElementById('valuemap-legend');
                legend.innerHTML = '';
                const nLevels = parseInt(levels);
                for (let i = 0; i < nLevels; i++) {
                    const gray = Math.round(255 - (i * 255 / (nLevels - 1)));
                    const hex = '#' + gray.toString(16).padStart(2, '0').repeat(3);

                    const item = document.createElement('div');
                    item.className = 'legend-item';

                    const swatch = document.createElement('div');
                    swatch.className = 'legend-swatch';
                    swatch.style.backgroundColor = hex;

                    const num = document.createElement('span');
                    num.className = 'legend-num';
                    num.textContent = i + 1;
                    num.style.color = gray > 128 ? '#222' : '#fff';
                    swatch.appendChild(num);

                    const label = document.createElement('span');
                    label.className = 'legend-label';
                    label.textContent = i === 0 ? 'Lightest' : i === nLevels - 1 ? 'Darkest' : 'Value ' + (i + 1);

                    item.appendChild(swatch);
                    item.appendChild(label);
                    legend.appendChild(item);
                }
            };
            img.src = url;
        } catch (err) {
            this.showToast('Value map failed');
            btn.textContent = 'Generate Value Map';
        }
    },

    // --- Paint Tab ---
    setupPaint() {
        this.renderPigmentList();
    },

    refreshPaint() {
        const container = document.getElementById('mix-suggestions');
        container.innerHTML = '';

        if (this.activePalette.length === 0) {
            container.innerHTML = '<p class="hint">Add colors to your active palette to see mixing suggestions</p>';
            return;
        }

        this.activePalette.forEach(hex => {
            const temp = ColorUtils.getTemperature(hex);
            const single = PigmentUtils.findClosestSingle(hex);
            const bestMix = PigmentUtils.findClosestMix(hex, 1)[0];

            let mixHtml = '';
            if (bestMix) {
                const ratioA = 100 - bestMix.ratio;
                const ratioB = bestMix.ratio;
                mixHtml = `
                    <div class="mix-row" style="margin-top:6px">
                        <div class="mini-swatch" style="background:${bestMix.mixed}"></div>
                        <div>
                            <div class="pigment-name" style="font-size:12px">${bestMix.pigmentA.name} (${ratioA}%) + ${bestMix.pigmentB.name} (${ratioB}%)</div>
                        </div>
                    </div>
                `;
            }

            container.innerHTML += `
                <div class="suggestion-card">
                    <div class="mix-row">
                        <div class="mini-swatch" style="background:${hex}"></div>
                        <div style="flex:1">
                            <div class="pigment-name">${hex} <span class="temp-indicator ${temp.label}" style="font-size:11px">${temp.label}</span></div>
                        </div>
                    </div>
                    <div class="match-label" style="margin-top:8px">Closest pigment</div>
                    <div class="mix-row">
                        <div class="mini-swatch" style="background:${single.pigment.hex}"></div>
                        <div>
                            <div class="pigment-name">${single.pigment.name}</div>
                            <div class="pigment-code">${single.pigment.code} &middot; ${single.pigment.temp}</div>
                        </div>
                    </div>
                    <div class="match-label" style="margin-top:8px">Best mix (approximate)</div>
                    ${mixHtml}
                </div>
            `;
        });
    },

    renderPigmentList() {
        const container = document.getElementById('pigment-list');
        PIGMENTS.forEach(pig => {
            const card = document.createElement('div');
            card.className = 'pigment-card';
            card.innerHTML = `
                <div class="pig-swatch" style="background:${pig.hex}"></div>
                <div>
                    <div class="pig-name">${pig.name}</div>
                    <div class="pig-code">${pig.code}</div>
                </div>
                <div class="pig-temp" style="color:${pig.temp === 'warm' ? '#d45b20' : pig.temp === 'cool' ? '#2a73b1' : '#888'}">${pig.temp}</div>
            `;
            container.appendChild(card);
        });
    },

    // --- Eyedropper ---
    _pickColor(canvas, e) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        const ctx = canvas.getContext('2d');
        const pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');

        this._eyedropperHex = hex;
        document.getElementById('eyedrop-swatch').style.backgroundColor = hex;
        document.getElementById('eyedrop-hex').textContent = hex;

        const closest = PigmentUtils.findClosestSingle(hex);
        document.getElementById('eyedrop-pigment').textContent = closest.pigment.name + ' (' + closest.pigment.code + ')';

        document.getElementById('eyedropper-panel').classList.remove('hidden');

        // Turn off eyedropper mode and return to palette tab
        this._eyedropperMode = false;
        document.getElementById('eyedropper-btn').style.background = '';
        if (this._eyedropperReturnTab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="' + this._eyedropperReturnTab + '"]').classList.add('active');
            document.getElementById('tab-' + this._eyedropperReturnTab).classList.add('active');
            this._eyedropperReturnTab = null;
        }
    },

    // --- Progress Comparison ---
    renderComparison() {
        const canvas = document.getElementById('compare-canvas');
        const ctx = canvas.getContext('2d');
        const slider = document.getElementById('compare-slider');
        const split = slider.value / 100;

        const containerWidth = canvas.parentElement.clientWidth;
        const refImg = this._originalImage || Composition.image;
        if (!refImg || !this._progressImage) return;

        const aspect = refImg.height / refImg.width;
        const dpr = window.devicePixelRatio || 1;
        const w = containerWidth;
        const h = containerWidth * aspect;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        ctx.scale(dpr, dpr);

        // Draw reference (full)
        ctx.drawImage(refImg, 0, 0, w, h);

        // Draw progress on right side
        const splitX = w * split;
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitX, 0, w - splitX, h);
        ctx.clip();
        ctx.drawImage(this._progressImage, 0, 0, w, h);
        ctx.restore();

        // Draw split line
        ctx.strokeStyle = '#7b5ea7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(splitX, 0);
        ctx.lineTo(splitX, h);
        ctx.stroke();
    },

    // --- Session Timer ---
    setupTimer() {
        // Load saved sessions from localStorage
        this._sessions = JSON.parse(localStorage.getItem('drae-sessions') || '[]');
        this._renderSessionLog();

        document.getElementById('timer-start-btn').addEventListener('click', () => {
            if (this._timerRunning) {
                clearInterval(this._timerInterval);
                this._timerRunning = false;
                document.getElementById('timer-start-btn').textContent = 'Start';
            } else {
                this._timerRunning = true;
                document.getElementById('timer-start-btn').textContent = 'Pause';
                this._timerInterval = setInterval(() => {
                    this._timerSeconds++;
                    this._updateTimerDisplay();
                }, 1000);
            }
        });

        document.getElementById('timer-done-btn').addEventListener('click', () => {
            if (this._timerSeconds === 0) {
                this.showToast('No time to record');
                return;
            }
            // Stop timer and log the session
            clearInterval(this._timerInterval);
            this._timerRunning = false;
            document.getElementById('timer-start-btn').textContent = 'Start';

            this._sessions.push({
                date: new Date().toLocaleDateString(),
                seconds: this._timerSeconds,
            });
            localStorage.setItem('drae-sessions', JSON.stringify(this._sessions));

            this.showToast('Session saved!');
            this._timerSeconds = 0;
            this._updateTimerDisplay();
            this._renderSessionLog();
        });

        document.getElementById('timer-reset-btn').addEventListener('click', () => {
            clearInterval(this._timerInterval);
            this._timerRunning = false;
            this._timerSeconds = 0;
            this._updateTimerDisplay();
            document.getElementById('timer-start-btn').textContent = 'Start';
        });

        document.getElementById('session-clear-btn').addEventListener('click', () => {
            this._sessions = [];
            localStorage.removeItem('drae-sessions');
            this._renderSessionLog();
            this.showToast('Session log cleared');
        });
    },

    _formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    },

    _updateTimerDisplay() {
        document.getElementById('timer-display').textContent = this._formatTime(this._timerSeconds);
    },

    _renderSessionLog() {
        const logDiv = document.getElementById('session-log');
        const entries = document.getElementById('session-entries');

        if (this._sessions.length === 0) {
            logDiv.classList.add('hidden');
            return;
        }

        logDiv.classList.remove('hidden');
        entries.innerHTML = '';

        this._sessions.forEach((s, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg);border-radius:10px;margin-bottom:6px;font-size:14px';
            row.innerHTML = `
                <span style="color:var(--text-muted)">${s.date}</span>
                <span style="font-weight:600;font-variant-numeric:tabular-nums">${this._formatTime(s.seconds)}</span>
            `;
            entries.appendChild(row);
        });

        const total = this._sessions.reduce((sum, s) => sum + s.seconds, 0);
        document.getElementById('session-total').textContent = this._formatTime(total);
    },

    // --- Export ---
    setupExport() {
        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const canvas = document.getElementById(btn.dataset.canvas);
                canvas.toBlob(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = btn.dataset.canvas + '.png';
                    a.click();
                    URL.revokeObjectURL(url);
                    this.showToast('Image saved');
                });
            });
        });
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
