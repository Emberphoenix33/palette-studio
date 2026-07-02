import uuid

from flask import Flask, jsonify, render_template, request, send_file
from io import BytesIO

from color_extract import extract_palette

app = Flask(__name__)

# Load rembg session once at startup to avoid reloading the model per request
from rembg import new_session, remove as _rembg_remove
_rembg_session = new_session("u2net")

# In-memory image store for composition overlay reuse
image_store = {}
subject_mask_store = {}


def _bounded_store_set(store, key, value, limit=20):
    store[key] = value
    while len(store) > limit:
        oldest = next(iter(store))
        del store[oldest]


def _drop_cached_image(image_id):
    image_store.pop(image_id, None)
    subject_mask_store.pop(image_id, None)


def _get_subject_alpha(image_id, image_bytes, np):
    cached = subject_mask_store.get(image_id)
    if cached is not None:
        return cached

    from PIL import Image

    result = _rembg_remove(image_bytes, session=_rembg_session)
    img = Image.open(BytesIO(result)).convert("RGBA")
    alpha = np.array(img)[:, :, 3]
    _bounded_store_set(subject_mask_store, image_id, alpha)
    return alpha


def _parse_palette_hex(palette_hex):
    palette_rgb = []
    for h in palette_hex.split(","):
        h = h.strip().lstrip("#")
        if len(h) != 6:
            continue
        try:
            palette_rgb.append([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)])
        except ValueError:
            continue
    return palette_rgb


def _merge_small_regions(label_map, simplify_level, n_colors, cv2, np):
    if simplify_level <= 0:
        return label_map

    merged = label_map.copy()
    height, width = merged.shape
    min_area = max(24, int((height * width) * (0.00035 + simplify_level * 0.00022)))
    kernel = np.ones((3, 3), dtype=np.uint8)

    for color_idx in range(n_colors):
        mask = (merged == color_idx).astype(np.uint8)
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)

        for comp in range(1, num_labels):
            area = stats[comp, cv2.CC_STAT_AREA]
            if area >= min_area:
                continue

            component = labels == comp
            expanded = cv2.dilate(component.astype(np.uint8), kernel, iterations=1).astype(bool)
            neighbor_colors = merged[expanded & ~component]
            if neighbor_colors.size == 0:
                continue

            counts = np.bincount(neighbor_colors, minlength=n_colors)
            counts[color_idx] = 0
            replacement = int(np.argmax(counts))
            if counts[replacement] > 0:
                merged[component] = replacement

    return merged


def _simplify_label_map(label_map, simplify_level, n_colors, cv2, np):
    if simplify_level <= 0:
        return label_map

    working = label_map.astype(np.uint8)
    kernel_size = 3 if simplify_level < 6 else 5

    blur_passes = 1 if simplify_level < 4 else 2
    for _ in range(blur_passes):
        working = cv2.medianBlur(working, kernel_size)

    working = _merge_small_regions(working.astype(np.int32), simplify_level, n_colors, cv2, np)
    return working.astype(np.int32)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/extract", methods=["POST"])
def extract():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file = request.files["image"]
    image_bytes = file.read()
    n_colors = request.form.get("n_colors", 6, type=int)
    n_colors = max(2, min(12, n_colors))

    colors = extract_palette(image_bytes, n_colors=n_colors)

    # Store image for composition overlay
    image_id = str(uuid.uuid4())
    _bounded_store_set(image_store, image_id, image_bytes)

    # Keep store bounded
    while len(image_store) > 20:
        _drop_cached_image(next(iter(image_store)))

    return jsonify({"id": image_id, "colors": colors})


@app.route("/image/<image_id>")
def get_image(image_id):
    if image_id not in image_store:
        return jsonify({"error": "Image not found"}), 404
    return send_file(BytesIO(image_store[image_id]), mimetype="image/jpeg")


@app.route("/colormap/<image_id>")
def get_colormap(image_id):
    if image_id not in image_store:
        return jsonify({"error": "Image not found"}), 404

    import cv2
    import numpy as np

    # Get palette colors from query params (hex values comma-separated)
    palette_hex = request.args.get("colors", "")
    if not palette_hex:
        return jsonify({"error": "No colors provided"}), 400

    simplify_level = max(0, min(10, request.args.get("simplify", 5, type=int)))
    palette_rgb = _parse_palette_hex(palette_hex)

    if not palette_rgb:
        return jsonify({"error": "Invalid colors"}), 400

    palette_arr = np.array(palette_rgb, dtype=np.float64)

    image_bytes = image_store[image_id]

    # Decode image
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Resize for speed (higher res for better detail)
    max_dim = 900
    h, w = img_rgb.shape[:2]
    ratio = max_dim / max(h, w)
    if ratio < 1:
        img_rgb = cv2.resize(img_rgb, (int(w * ratio), int(h * ratio)),
                             interpolation=cv2.INTER_AREA)

    if simplify_level > 0:
        diameter = 5 + simplify_level
        sigma = 18 + simplify_level * 4
        img_rgb = cv2.bilateralFilter(img_rgb, diameter, sigma, sigma)

    # Convert image and palette to LAB for perceptually accurate matching
    img_lab = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2LAB).astype(np.float64)
    palette_rgb_arr = np.array(palette_rgb, dtype=np.uint8).reshape(1, -1, 3)
    palette_lab = cv2.cvtColor(palette_rgb_arr, cv2.COLOR_RGB2LAB).astype(np.float64).reshape(-1, 3)

    # Map each pixel to nearest palette color in LAB space
    pixels_lab = img_lab.reshape(-1, 3)
    distances = np.array([
        np.sqrt(np.sum((pixels_lab - c) ** 2, axis=1))
        for c in palette_lab
    ])
    nearest = np.argmin(distances, axis=0)

    # Reconstruct image using palette colors + original luminance for detail
    h_img, w_img = img_rgb.shape[:2]
    nearest_2d = nearest.reshape(h_img, w_img)

    nearest_2d = _simplify_label_map(nearest_2d, simplify_level, len(palette_rgb), cv2, np)
    mapped_2d = palette_arr[nearest_2d].astype(np.float64)

    # Get original pixel luminance relative to its palette color's luminance
    # This preserves shadows, highlights, and form
    orig_gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY).astype(np.float64)
    palette_gray = np.array([
        0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] for c in palette_arr
    ])
    mapped_gray = palette_gray[nearest_2d]

    # Ratio of original brightness to palette color brightness
    # Clamp to avoid division by zero and extreme values
    mapped_gray = np.clip(mapped_gray, 1, 255)
    luminance_ratio = orig_gray / mapped_gray
    luminance_ratio = np.clip(luminance_ratio, 0.4, 1.6)

    # Apply luminance variation to the palette colors
    result = np.zeros((h_img, w_img, 3), dtype=np.uint8)
    for ch in range(3):
        adjusted = mapped_2d[:, :, ch] * luminance_ratio
        result[:, :, ch] = np.clip(adjusted, 0, 255).astype(np.uint8)

    # Convert to BGR for drawing
    result_bgr = cv2.cvtColor(result, cv2.COLOR_RGB2BGR)

    # Draw region borders: find pixels where neighbor has a different color index
    border_mask = np.zeros((h_img, w_img), dtype=np.uint8)
    border_mask[:-1, :] |= (nearest_2d[:-1, :] != nearest_2d[1:, :]).astype(np.uint8)
    border_mask[:, :-1] |= (nearest_2d[:, :-1] != nearest_2d[:, 1:]).astype(np.uint8)
    result_bgr[border_mask == 1] = [60, 60, 60]

    # Place number labels in each color region using connected components
    n_colors = len(palette_rgb)
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.3, min(0.6, w_img / 800))
    thickness = 1

    for color_idx in range(n_colors):
        # Create mask for this color
        mask = (nearest_2d == color_idx).astype(np.uint8) * 255

        # Find connected components (individual regions of this color)
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
            mask, connectivity=8
        )

        # Minimum region size to label (skip tiny fragments)
        min_area = (w_img * h_img) / 400

        label_num = str(color_idx + 1)
        text_size = cv2.getTextSize(label_num, font, font_scale, thickness)[0]

        for comp in range(1, num_labels):  # skip background (0)
            area = stats[comp, cv2.CC_STAT_AREA]
            if area < min_area:
                continue

            cx, cy = int(centroids[comp][0]), int(centroids[comp][1])

            # Offset text to center it
            tx = cx - text_size[0] // 2
            ty = cy + text_size[1] // 2

            # Pick contrasting text color
            r, g, b = palette_rgb[color_idx]
            luminance = 0.299 * r + 0.587 * g + 0.114 * b
            text_color = (40, 40, 40) if luminance > 128 else (240, 240, 240)
            outline_color = (240, 240, 240) if luminance > 128 else (40, 40, 40)

            # Draw outline then text for readability
            cv2.putText(result_bgr, label_num, (tx, ty), font, font_scale,
                        outline_color, thickness + 2, cv2.LINE_AA)
            cv2.putText(result_bgr, label_num, (tx, ty), font, font_scale,
                        text_color, thickness, cv2.LINE_AA)

    _, buf = cv2.imencode(".png", result_bgr)
    return send_file(BytesIO(buf.tobytes()), mimetype="image/png")


@app.route("/sketch/<image_id>")
def get_sketch(image_id):
    if image_id not in image_store:
        return jsonify({"error": "Image not found"}), 404

    import cv2
    import numpy as np

    # Detail level: 1 (minimal/clean) to 20 (maximum detail)
    detail = request.args.get("detail", 5, type=int)
    detail = max(1, min(20, detail))
    suppression = request.args.get("suppression", 5, type=int)
    suppression = max(1, min(10, suppression))
    thickness = request.args.get("thickness", 2, type=int)
    thickness = max(1, min(4, thickness))
    outline_only = request.args.get("outline_only", "0").lower() in {"1", "true", "yes", "on"}

    image_bytes = image_store[image_id]

    # Decode image
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    # Resize for speed
    max_dim = 800
    h, w = img.shape[:2]
    ratio = max_dim / max(h, w)
    if ratio < 1:
        img = cv2.resize(img, (int(w * ratio), int(h * ratio)),
                         interpolation=cv2.INTER_AREA)

    h_img, w_img = img.shape[:2]

    subject_alpha = _get_subject_alpha(image_id, image_bytes, np)
    subject_alpha = cv2.resize(subject_alpha, (w_img, h_img), interpolation=cv2.INTER_LINEAR)
    subject_alpha = cv2.GaussianBlur(subject_alpha, (0, 0), sigmaX=1.4, sigmaY=1.4)
    subject_mask = np.where(subject_alpha > 24, 255, 0).astype(np.uint8)

    mask_coverage = float(np.count_nonzero(subject_mask)) / float(h_img * w_img)
    use_subject_focus = 0.05 < mask_coverage < 0.92

    if use_subject_focus:
        subject_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        subject_mask = cv2.morphologyEx(subject_mask, cv2.MORPH_CLOSE, subject_kernel)
        subject_mask = cv2.morphologyEx(subject_mask, cv2.MORPH_OPEN, subject_kernel)

        expanded_mask = cv2.dilate(
            subject_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)),
            iterations=1,
        )
        contour_band = cv2.subtract(
            cv2.dilate(subject_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1),
            cv2.erode(subject_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1),
        )
        subject_outline = cv2.morphologyEx(
            subject_mask, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        )
        touch_mask = cv2.dilate(
            expanded_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
            iterations=1,
        )
    else:
        expanded_mask = None
        contour_band = None
        subject_outline = None
        touch_mask = None

    # Step 1: Downscale then upscale to naturally remove fine texture (fur).
    # Higher suppression = stronger texture cleanup before edge detection.
    suppression_factor = (suppression - 1) / 9.0
    shrink_factor = 5.2 - (detail - 1) * 0.26 + suppression_factor * 2.3
    if use_subject_focus:
        shrink_factor *= 0.78
    shrink_factor = max(1.8, min(7.2, shrink_factor))
    small_h, small_w = int(img.shape[0] / shrink_factor), int(img.shape[1] / shrink_factor)
    small = cv2.resize(img, (small_w, small_h), interpolation=cv2.INTER_AREA)
    img_smooth = cv2.resize(small, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_CUBIC)

    # Step 2: Bilateral smoothing preserves important forms while muting fur.
    n_passes = max(1, int(round((7 - detail * 0.5) + suppression_factor * 3)))
    if use_subject_focus:
        n_passes = max(1, n_passes - 1)
    bilateral_sigma = int(round(55 + suppression_factor * 40))
    for _ in range(n_passes):
        img_smooth = cv2.bilateralFilter(img_smooth, 9, bilateral_sigma, bilateral_sigma)

    # Step 3: Convert to grayscale and normalize local contrast.
    gray = cv2.cvtColor(img_smooth, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # Step 4: Build edges from both texture-preserving and silhouette-preserving passes.
    median = float(np.median(gray))
    contrast = float(np.std(gray))
    detail_factor = detail / 10.0

    low_thresh = int(max(10, (0.7 - detail_factor * 0.2) * median))
    high_thresh = int(min(255, max(low_thresh + 25, (1.35 - detail_factor * 0.1) * median + contrast * 0.35)))
    if use_subject_focus:
        low_thresh = max(8, int(low_thresh * 0.78))
        high_thresh = min(255, max(low_thresh + 22, int(high_thresh * 0.84)))
    detail_edges = cv2.Canny(gray, low_thresh, high_thresh)

    shape_sigma = max(1.2, 4.1 - detail * 0.2 + suppression_factor * 0.8)
    shape_gray = cv2.GaussianBlur(gray, (0, 0), sigmaX=shape_sigma, sigmaY=shape_sigma)
    shape_low = max(10, int(low_thresh * 0.75))
    shape_high = min(255, max(shape_low + 20, int(high_thresh * 0.9)))
    shape_edges = cv2.Canny(shape_gray, shape_low, shape_high)

    if use_subject_focus:
        subject_detail_edges = cv2.bitwise_and(detail_edges, expanded_mask)
        subject_shape_edges = cv2.bitwise_and(shape_edges, expanded_mask)
        contour_edges = cv2.bitwise_and(shape_edges, contour_band)
        edges = subject_shape_edges if outline_only else cv2.bitwise_or(subject_detail_edges, subject_shape_edges)
        edges = cv2.bitwise_or(edges, contour_edges)
        edges = cv2.bitwise_or(edges, subject_outline)
    else:
        edges = shape_edges if outline_only else cv2.bitwise_or(detail_edges, shape_edges)

    # Step 5: Close tiny gaps and remove speckle components.
    close_size = 3 if outline_only else (3 if suppression >= 7 else 2)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, close_kernel)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(edges, connectivity=8)
    if outline_only:
        min_component_area = max(24, int((h_img * w_img) / (1100 + detail * 110)))
    else:
        min_component_area = max(
            12,
            int((h_img * w_img) / (2200 + detail * 180 - suppression_factor * 700))
        )
    cleaned = np.zeros_like(edges)
    for comp in range(1, num_labels):
        area = stats[comp, cv2.CC_STAT_AREA]
        if area < min_component_area:
            continue

        if use_subject_focus:
            component = labels == comp
            overlap = int(np.count_nonzero(touch_mask[component]))
            if overlap < max(18, int(area * 0.12)):
                continue

        cleaned[labels == comp] = 255
    edges = cleaned

    # Step 6: Let the user thicken lines without reintroducing most of the noise.
    if thickness > 1:
        kernel_size = thickness if outline_only else 1 + thickness
        dilate_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
        )
        edges = cv2.dilate(edges, dilate_kernel, iterations=1)

    # Step 7: Invert — dark lines on white background.
    result = 255 - edges

    _, buf = cv2.imencode(".png", result)
    return send_file(BytesIO(buf.tobytes()), mimetype="image/png")


@app.route("/valuemap/<image_id>")
def get_valuemap(image_id):
    if image_id not in image_store:
        return jsonify({"error": "Image not found"}), 404

    import cv2
    import numpy as np

    # Number of tonal bands (3-7, default 5)
    levels = request.args.get("levels", 5, type=int)
    levels = max(3, min(7, levels))

    # Decode image
    arr = np.frombuffer(image_store[image_id], np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    # Resize for speed (max 900px)
    max_dim = 900
    h, w = img.shape[:2]
    ratio = max_dim / max(h, w)
    if ratio < 1:
        img = cv2.resize(img, (int(w * ratio), int(h * ratio)),
                         interpolation=cv2.INTER_AREA)

    h_img, w_img = img.shape[:2]

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float64)

    # Create evenly spaced tonal bands from black to white
    # Band centers: e.g. for 5 levels -> [25.5, 76.5, 127.5, 178.5, 229.5]
    band_centers = np.linspace(255.0 / (2 * levels), 255.0 - 255.0 / (2 * levels), levels)

    # Map each pixel to the nearest band
    pixels = gray.reshape(-1, 1)
    distances = np.abs(pixels - band_centers.reshape(1, -1))
    nearest = np.argmin(distances, axis=1)
    nearest_2d = nearest.reshape(h_img, w_img)

    # Build the quantized grayscale image
    quantized = band_centers[nearest_2d].astype(np.uint8)
    result_bgr = cv2.cvtColor(quantized, cv2.COLOR_GRAY2BGR)

    # Draw region borders: find pixels where neighbor has a different band index
    border_mask = np.zeros((h_img, w_img), dtype=np.uint8)
    border_mask[:-1, :] |= (nearest_2d[:-1, :] != nearest_2d[1:, :]).astype(np.uint8)
    border_mask[:, :-1] |= (nearest_2d[:, :-1] != nearest_2d[:, 1:]).astype(np.uint8)
    result_bgr[border_mask == 1] = [60, 60, 60]

    # Place number labels in each band region using connected components
    # Label 1 = lightest, N = darkest
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.3, min(0.6, w_img / 800))
    thickness = 1

    for band_idx in range(levels):
        # Create mask for this band
        mask = (nearest_2d == band_idx).astype(np.uint8) * 255

        # Find connected components (individual regions of this band)
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
            mask, connectivity=8
        )

        # Minimum region size to label (skip tiny fragments)
        min_area = (w_img * h_img) / 400

        # Value number: 1 = lightest (highest band_center), N = darkest (lowest)
        # band_centers go dark-to-light (low index = dark), so invert
        value_num = str(levels - band_idx)
        text_size = cv2.getTextSize(value_num, font, font_scale, thickness)[0]

        for comp in range(1, num_labels):  # skip background (0)
            area = stats[comp, cv2.CC_STAT_AREA]
            if area < min_area:
                continue

            cx, cy = int(centroids[comp][0]), int(centroids[comp][1])

            # Offset text to center it
            tx = cx - text_size[0] // 2
            ty = cy + text_size[1] // 2

            # Pick contrasting text color based on band brightness
            luminance = band_centers[band_idx]
            text_color = (40, 40, 40) if luminance > 128 else (240, 240, 240)
            outline_color = (240, 240, 240) if luminance > 128 else (40, 40, 40)

            # Draw outline then text for readability
            cv2.putText(result_bgr, value_num, (tx, ty), font, font_scale,
                        outline_color, thickness + 2, cv2.LINE_AA)
            cv2.putText(result_bgr, value_num, (tx, ty), font, font_scale,
                        text_color, thickness, cv2.LINE_AA)

    _, buf = cv2.imencode(".png", result_bgr)
    return send_file(BytesIO(buf.tobytes()), mimetype="image/png")


@app.route("/remove-bg", methods=["POST"])
def remove_bg():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    from PIL import Image
    import numpy as np

    image_bytes = request.files["image"].read()
    result = _rembg_remove(image_bytes, session=_rembg_session)

    # Crop to bounding box of non-transparent pixels
    img = Image.open(BytesIO(result)).convert("RGBA")
    alpha = np.array(img)[:, :, 3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    if rows.any():
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        img = img.crop((cmin, rmin, cmax + 1, rmax + 1))

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    app.run(debug=True, host="0.0.0.0", port=port)
