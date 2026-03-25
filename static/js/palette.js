// Color theory palette generation
const PaletteGen = {
    complementary(hex) {
        const [h, s, l] = ColorUtils.hexToHsl(hex);
        return [hex, ColorUtils.hslToHex((h + 180) % 360, s, l)];
    },

    analogous(hex, spread = 30) {
        const [h, s, l] = ColorUtils.hexToHsl(hex);
        return [
            ColorUtils.hslToHex((h - spread + 360) % 360, s, l),
            hex,
            ColorUtils.hslToHex((h + spread) % 360, s, l)
        ];
    },

    triadic(hex) {
        const [h, s, l] = ColorUtils.hexToHsl(hex);
        return [
            hex,
            ColorUtils.hslToHex((h + 120) % 360, s, l),
            ColorUtils.hslToHex((h + 240) % 360, s, l)
        ];
    },

    splitComplementary(hex) {
        const [h, s, l] = ColorUtils.hexToHsl(hex);
        return [
            hex,
            ColorUtils.hslToHex((h + 150) % 360, s, l),
            ColorUtils.hslToHex((h + 210) % 360, s, l)
        ];
    },

    tetradic(hex) {
        const [h, s, l] = ColorUtils.hexToHsl(hex);
        return [
            hex,
            ColorUtils.hslToHex((h + 90) % 360, s, l),
            ColorUtils.hslToHex((h + 180) % 360, s, l),
            ColorUtils.hslToHex((h + 270) % 360, s, l)
        ];
    },

    generate(hex, scheme) {
        switch (scheme) {
            case 'complementary': return this.complementary(hex);
            case 'analogous': return this.analogous(hex);
            case 'triadic': return this.triadic(hex);
            case 'split': return this.splitComplementary(hex);
            case 'tetradic': return this.tetradic(hex);
            default: return [hex];
        }
    }
};
