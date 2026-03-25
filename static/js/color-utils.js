// Color utility functions
const ColorUtils = {
    hexToRgb(hex) {
        hex = hex.replace('#', '');
        return [
            parseInt(hex.substring(0, 2), 16),
            parseInt(hex.substring(2, 4), 16),
            parseInt(hex.substring(4, 6), 16)
        ];
    },

    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(v =>
            Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
        ).join('');
    },

    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        return [h * 360, s * 100, l * 100];
    },

    hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        let r, g, b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    },

    hexToHsl(hex) {
        const [r, g, b] = this.hexToRgb(hex);
        return this.rgbToHsl(r, g, b);
    },

    hslToHex(h, s, l) {
        const [r, g, b] = this.hslToRgb(h, s, l);
        return this.rgbToHex(r, g, b);
    },

    blendColors(hexA, hexB, ratio = 0.5) {
        const a = this.hexToRgb(hexA);
        const b = this.hexToRgb(hexB);
        return this.rgbToHex(
            a[0] + (b[0] - a[0]) * ratio,
            a[1] + (b[1] - a[1]) * ratio,
            a[2] + (b[2] - a[2]) * ratio
        );
    },

    // Simulate paint mixing (subtractive-ish blend via slight desaturation)
    blendPaint(hexA, hexB, ratio = 0.5) {
        const a = this.hexToHsl(hexA);
        const b = this.hexToHsl(hexB);

        // Blend hue on shortest arc
        let hDiff = b[0] - a[0];
        if (hDiff > 180) hDiff -= 360;
        if (hDiff < -180) hDiff += 360;
        let h = (a[0] + hDiff * ratio + 360) % 360;

        let s = a[1] + (b[1] - a[1]) * ratio;
        let l = a[2] + (b[2] - a[2]) * ratio;

        // Desaturate slightly to simulate subtractive mixing
        s *= 0.9;
        // Darken slightly
        l *= 0.95;

        return this.hslToHex(h, s, l);
    },

    getTemperature(hex) {
        const [h, s] = this.hexToHsl(hex);
        if (s < 10) return { label: 'neutral', score: 0 };
        // Warm: reds, oranges, yellows (0-75, 285-360)
        if (h <= 75 || h >= 285) {
            return { label: 'warm', score: h <= 75 ? 75 - h : h - 285 };
        }
        return { label: 'cool', score: Math.min(h - 75, 285 - h) };
    },

    isWarm(hex) {
        return this.getTemperature(hex).label === 'warm';
    },

    getLuminance(hex) {
        const [r, g, b] = this.hexToRgb(hex).map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    },

    contrastColor(hex) {
        return this.getLuminance(hex) > 0.4 ? '#2c2c2c' : '#ffffff';
    },

    colorDistance(hexA, hexB) {
        const a = this.hexToRgb(hexA);
        const b = this.hexToRgb(hexB);
        return Math.sqrt(
            (a[0] - b[0]) ** 2 +
            (a[1] - b[1]) ** 2 +
            (a[2] - b[2]) ** 2
        );
    },

    tint(hex, amount) {
        return this.blendColors(hex, '#ffffff', amount);
    },

    shade(hex, amount) {
        return this.blendColors(hex, '#000000', amount);
    }
};
