from io import BytesIO

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans


def _rgb_to_lab(rgb):
    """Convert Nx3 RGB (0-255) array to CIELAB color space."""
    # Normalize to 0-1
    rgb_norm = rgb / 255.0

    # Linearize sRGB
    mask = rgb_norm > 0.04045
    rgb_lin = np.where(mask, ((rgb_norm + 0.055) / 1.055) ** 2.4, rgb_norm / 12.92)

    # RGB to XYZ (D65 illuminant)
    mat = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = rgb_lin @ mat.T

    # Normalize by D65 white point
    xyz[:, 0] /= 0.95047
    xyz[:, 1] /= 1.00000
    xyz[:, 2] /= 1.08883

    # XYZ to LAB
    epsilon = 0.008856
    kappa = 903.3
    mask = xyz > epsilon
    f = np.where(mask, np.cbrt(xyz), (kappa * xyz + 16) / 116)

    lab = np.zeros_like(xyz)
    lab[:, 0] = 116 * f[:, 1] - 16      # L: 0-100
    lab[:, 1] = 500 * (f[:, 0] - f[:, 1])  # a: ~-128 to 128
    lab[:, 2] = 200 * (f[:, 1] - f[:, 2])  # b: ~-128 to 128

    return lab


def _lab_to_rgb(lab):
    """Convert Nx3 LAB array back to RGB (0-255)."""
    f_y = (lab[:, 0] + 16) / 116
    f_x = lab[:, 1] / 500 + f_y
    f_z = f_y - lab[:, 2] / 200

    epsilon = 0.008856
    kappa = 903.3

    x = np.where(f_x ** 3 > epsilon, f_x ** 3, (116 * f_x - 16) / kappa)
    y = np.where(lab[:, 0] > kappa * epsilon, f_y ** 3, lab[:, 0] / kappa)
    z = np.where(f_z ** 3 > epsilon, f_z ** 3, (116 * f_z - 16) / kappa)

    # De-normalize by D65
    x *= 0.95047
    z *= 1.08883

    xyz = np.stack([x, y, z], axis=1)

    # XYZ to linear RGB
    mat_inv = np.array([
        [ 3.2404542, -1.5371385, -0.4985314],
        [-0.9692660,  1.8760108,  0.0415560],
        [ 0.0556434, -0.2040259,  1.0572252],
    ])
    rgb_lin = xyz @ mat_inv.T
    rgb_lin = np.clip(rgb_lin, 0, 1)

    # Gamma encode
    mask = rgb_lin > 0.0031308
    rgb_norm = np.where(mask, 1.055 * (rgb_lin ** (1 / 2.4)) - 0.055, 12.92 * rgb_lin)
    rgb_norm = np.clip(rgb_norm, 0, 1)

    return (rgb_norm * 255).astype(np.uint8)


def _lab_distance(c1, c2):
    """Euclidean distance in LAB space (perceptually uniform)."""
    return np.sqrt(np.sum((np.array(c1) - np.array(c2)) ** 2))


def extract_palette(image_bytes, n_colors=6, max_dimension=300):
    """Extract dominant colors using LAB-space clustering with spatial sampling.

    Improvements over naive RGB KMeans:
    1. LAB color space — perceptually uniform, finds visually distinct colors
    2. Spatial grid sampling — ensures small features (tongue, eyes) are represented
    3. Background suppression — downsamples the dominant color so it doesn't eat clusters
    4. Oversample + merge — catches minority colors then merges similar ones

    Returns list of {"hex": "#RRGGBB", "rgb": [r,g,b], "pct": float}
    sorted by dominance percentage.
    """
    img = Image.open(BytesIO(image_bytes))

    # Handle RGBA by compositing onto white
    if img.mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    else:
        img = img.convert("RGB")

    # Resize for speed
    ratio = max_dimension / max(img.size)
    if ratio < 1:
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    img_arr = np.array(img)
    h, w = img_arr.shape[:2]
    all_pixels = img_arr.reshape(-1, 3).astype(np.float64)

    # --- Spatial grid sampling ---
    # Divide image into grid cells and take equal samples from each
    # This prevents large uniform backgrounds from drowning out small features
    grid_size = 8
    samples_per_cell = 200
    sampled_pixels = []

    cell_h = max(1, h // grid_size)
    cell_w = max(1, w // grid_size)

    for gy in range(grid_size):
        for gx in range(grid_size):
            y0, y1 = gy * cell_h, min((gy + 1) * cell_h, h)
            x0, x1 = gx * cell_w, min((gx + 1) * cell_w, w)
            cell_pixels = img_arr[y0:y1, x0:x1].reshape(-1, 3)
            if len(cell_pixels) == 0:
                continue
            n_sample = min(samples_per_cell, len(cell_pixels))
            idx = np.random.RandomState(42 + gy * grid_size + gx).choice(
                len(cell_pixels), n_sample, replace=len(cell_pixels) < n_sample
            )
            sampled_pixels.append(cell_pixels[idx])

    sampled = np.vstack(sampled_pixels).astype(np.float64)

    # --- Convert to LAB for perceptually uniform clustering ---
    sampled_lab = _rgb_to_lab(sampled)

    # --- Background suppression ---
    # Quick pre-cluster to find the dominant color, then downsample it
    pre_km = KMeans(n_clusters=min(5, n_colors), n_init=5, random_state=42)
    pre_km.fit(sampled_lab)
    pre_labels, pre_counts = np.unique(pre_km.labels_, return_counts=True)
    dominant_idx = pre_labels[np.argmax(pre_counts)]
    dominant_pct = pre_counts.max() / pre_counts.sum()

    # If one color is >35% of samples, downsample those pixels to 35%
    if dominant_pct > 0.35:
        is_dominant = pre_km.labels_ == dominant_idx
        dominant_pixels = sampled_lab[is_dominant]
        other_pixels = sampled_lab[~is_dominant]

        # Keep only enough dominant pixels to represent ~35%
        target_count = int(len(other_pixels) * 0.35 / 0.65)
        if target_count < len(dominant_pixels):
            rng = np.random.RandomState(42)
            keep_idx = rng.choice(len(dominant_pixels), target_count, replace=False)
            dominant_pixels = dominant_pixels[keep_idx]

        sampled_lab = np.vstack([other_pixels, dominant_pixels])

    # --- Oversample clusters to catch minority colors ---
    oversample = min(n_colors * 3, 36)
    oversample = max(oversample, n_colors + 4)

    kmeans = KMeans(n_clusters=oversample, n_init=10, random_state=42)
    kmeans.fit(sampled_lab)

    # --- Map ALL original pixels to get accurate percentages ---
    all_lab = _rgb_to_lab(all_pixels)
    all_labels = kmeans.predict(all_lab)
    labels, counts = np.unique(all_labels, return_counts=True)
    total = counts.sum()

    # Build cluster list with LAB centers and real pixel counts
    count_map = dict(zip(labels, counts))
    clusters = []
    for i, center_lab in enumerate(kmeans.cluster_centers_):
        count = count_map.get(i, 0)
        if count == 0:
            continue
        center_rgb = _lab_to_rgb(center_lab.reshape(1, 3))[0]
        clusters.append({
            "rgb": [int(center_rgb[0]), int(center_rgb[1]), int(center_rgb[2])],
            "lab": center_lab.tolist(),
            "pct": count / total * 100,
        })

    # --- Merge similar clusters (in LAB space) until we reach n_colors ---
    while len(clusters) > n_colors:
        min_dist = float("inf")
        merge_i, merge_j = 0, 1
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                d = _lab_distance(clusters[i]["lab"], clusters[j]["lab"])
                if d < min_dist:
                    min_dist = d
                    merge_i, merge_j = i, j

        # Weighted average merge in LAB space
        ci, cj = clusters[merge_i], clusters[merge_j]
        total_pct = ci["pct"] + cj["pct"]
        w_i = ci["pct"] / total_pct
        w_j = cj["pct"] / total_pct
        merged_lab = [ci["lab"][k] * w_i + cj["lab"][k] * w_j for k in range(3)]
        merged_rgb = _lab_to_rgb(np.array([merged_lab]))[0]

        clusters[merge_i] = {
            "rgb": [int(merged_rgb[0]), int(merged_rgb[1]), int(merged_rgb[2])],
            "lab": merged_lab,
            "pct": total_pct,
        }
        clusters.pop(merge_j)

    # Sort by dominance and format
    clusters.sort(key=lambda c: -c["pct"])
    colors = []
    for c in clusters:
        r, g, b = c["rgb"]
        colors.append({
            "hex": f"#{r:02x}{g:02x}{b:02x}",
            "rgb": [r, g, b],
            "pct": round(c["pct"], 1),
        })

    return colors
