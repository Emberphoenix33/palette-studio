// Common artist pigment database
const PIGMENTS = [
    // Yellows
    { name: "Lemon Yellow", hex: "#fff44f", code: "PY3", temp: "cool" },
    { name: "Cadmium Yellow Light", hex: "#ffe44d", code: "PY35", temp: "warm" },
    { name: "Cadmium Yellow Medium", hex: "#ffcc00", code: "PY37", temp: "warm" },
    { name: "Yellow Ochre", hex: "#cb9d2c", code: "PY43", temp: "warm" },
    { name: "Naples Yellow", hex: "#fada5e", code: "PY41", temp: "warm" },
    { name: "Indian Yellow", hex: "#e3a857", code: "PY150", temp: "warm" },
    { name: "Raw Sienna", hex: "#c68a2c", code: "PBr7", temp: "warm" },

    // Oranges
    { name: "Cadmium Orange", hex: "#ed872d", code: "PO20", temp: "warm" },

    // Reds
    { name: "Cadmium Red Light", hex: "#e04040", code: "PR108", temp: "warm" },
    { name: "Cadmium Red Medium", hex: "#c82536", code: "PR108", temp: "warm" },
    { name: "Alizarin Crimson", hex: "#e32636", code: "PR83", temp: "cool" },
    { name: "Quinacridone Rose", hex: "#d4467a", code: "PV19", temp: "cool" },
    { name: "Venetian Red", hex: "#a0522d", code: "PR101", temp: "warm" },
    { name: "Burnt Sienna", hex: "#a0522d", code: "PBr7", temp: "warm" },
    { name: "Burnt Umber", hex: "#6e4b3a", code: "PBr7", temp: "warm" },
    { name: "Raw Umber", hex: "#826644", code: "PBr7", temp: "cool" },

    // Violets / Purples
    { name: "Dioxazine Purple", hex: "#5c2d82", code: "PV23", temp: "cool" },
    { name: "Cobalt Violet", hex: "#8b5ea0", code: "PV14", temp: "cool" },

    // Blues
    { name: "Ultramarine Blue", hex: "#1b3a8c", code: "PB29", temp: "warm" },
    { name: "Cobalt Blue", hex: "#2456a4", code: "PB28", temp: "cool" },
    { name: "Cerulean Blue", hex: "#2a73b1", code: "PB35", temp: "cool" },
    { name: "Phthalo Blue", hex: "#0f2c6b", code: "PB15", temp: "cool" },
    { name: "Prussian Blue", hex: "#003153", code: "PB27", temp: "cool" },

    // Greens
    { name: "Viridian", hex: "#1a7a4c", code: "PG18", temp: "cool" },
    { name: "Phthalo Green", hex: "#0a5c36", code: "PG7", temp: "cool" },
    { name: "Chromium Oxide Green", hex: "#5a7247", code: "PG17", temp: "warm" },
    { name: "Sap Green", hex: "#4a7c3f", code: "PG36", temp: "warm" },
    { name: "Terre Verte", hex: "#6b7f5e", code: "PG23", temp: "cool" },

    // Earth tones
    { name: "Gold Ochre", hex: "#c49a3e", code: "PY42", temp: "warm" },

    // Whites & Blacks
    { name: "Titanium White", hex: "#f5f5f0", code: "PW6", temp: "neutral" },
    { name: "Zinc White", hex: "#f0f0eb", code: "PW4", temp: "neutral" },
    { name: "Ivory Black", hex: "#1c1c1c", code: "PBk9", temp: "warm" },
    { name: "Lamp Black", hex: "#1a1a1a", code: "PBk6", temp: "cool" },
    { name: "Payne's Gray", hex: "#40404f", code: "PBk6/PB29", temp: "cool" },
];

const PigmentUtils = {
    findClosestSingle(targetHex) {
        let best = null;
        let bestDist = Infinity;
        for (const pig of PIGMENTS) {
            const dist = ColorUtils.colorDistance(targetHex, pig.hex);
            if (dist < bestDist) {
                bestDist = dist;
                best = pig;
            }
        }
        return { pigment: best, distance: bestDist };
    },

    findClosestMix(targetHex, topN = 3) {
        const results = [];
        for (let i = 0; i < PIGMENTS.length; i++) {
            for (let j = i + 1; j < PIGMENTS.length; j++) {
                // Try different ratios
                for (let ratio = 0.2; ratio <= 0.8; ratio += 0.1) {
                    const mixed = ColorUtils.blendPaint(PIGMENTS[i].hex, PIGMENTS[j].hex, ratio);
                    const dist = ColorUtils.colorDistance(targetHex, mixed);
                    results.push({
                        pigmentA: PIGMENTS[i],
                        pigmentB: PIGMENTS[j],
                        ratio: Math.round(ratio * 100),
                        mixed,
                        distance: dist
                    });
                }
            }
        }
        results.sort((a, b) => a.distance - b.distance);
        return results.slice(0, topN);
    }
};
