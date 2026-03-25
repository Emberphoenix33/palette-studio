import uuid

from flask import Flask, jsonify, render_template, request, send_file
from io import BytesIO

from color_extract import extract_palette

app = Flask(__name__)

# In-memory image store for composition overlay reuse
image_store = {}


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
    image_store[image_id] = image_bytes

    # Keep store bounded
    if len(image_store) > 20:
        oldest = next(iter(image_store))
        del image_store[oldest]

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

    palette_rgb = []
    for h in palette_hex.split(","):
        h = h.strip().lstrip("#")
        if len(h) == 6:
            palette_rgb.append([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)])

    if not palette_rgb:
        return jsonify({"error": "Invalid colors"}), 400

    palette_arr = np.array(palette_rgb, dtype=np.float64)

    # Decode image
    arr = np.frombuffer(image_store[image_id], np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Resize for speed (higher res for better detail)
    max_dim = 900
    h, w = img_rgb.shape[:2]
    ratio = max_dim / max(h, w)
    if ratio < 1:
        img_rgb = cv2.resize(img_rgb, (int(w * ratio), int(h * ratio)),
                             interpolation=cv2.INTER_AREA)

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
    mapped = palette_arr[nearest].astype(np.float64)
    h_img, w_img = img_rgb.shape[:2]
    mapped_2d = mapped.reshape(h_img, w_img, 3)
    nearest_2d = nearest.reshape(h_img, w_img)

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

    # Detail level: 1 (minimal/clean) to 10 (maximum detail)
    detail = request.args.get("detail", 5, type=int)
    detail = max(1, min(10, detail))

    # Decode image
    arr = np.frombuffer(image_store[image_id], np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    # Resize for speed
    max_dim = 800
    h, w = img.shape[:2]
    ratio = max_dim / max(h, w)
    if ratio < 1:
        img = cv2.resize(img, (int(w * ratio), int(h * ratio)),
                         interpolation=cv2.INTER_AREA)

    # Step 1: Downscale then upscale to naturally remove fine texture (fur)
    # Lower detail = more aggressive downscale = less fur noise
    shrink_factor = 6 - (detail - 1) * 0.4  # 6x down to 2.4x
    shrink_factor = max(2, shrink_factor)
    small_h, small_w = int(img.shape[0] / shrink_factor), int(img.shape[1] / shrink_factor)
    small = cv2.resize(img, (small_w, small_h), interpolation=cv2.INTER_AREA)
    img_smooth = cv2.resize(small, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_CUBIC)

    # Step 2: Multiple bilateral filter passes to smooth remaining texture
    # while preserving strong edges (silhouette, eyes, nose)
    n_passes = max(1, 8 - detail)  # 7 passes at detail=1, 1 pass at detail=8+
    for _ in range(n_passes):
        img_smooth = cv2.bilateralFilter(img_smooth, 9, 75, 75)

    # Step 3: Convert to grayscale
    gray = cv2.cvtColor(img_smooth, cv2.COLOR_BGR2GRAY)

    # Step 4: Canny edge detection
    # Lower detail = higher thresholds = fewer edges
    low_thresh = int(80 - (detail - 1) * 6)    # 80 down to 26
    high_thresh = int(160 - (detail - 1) * 10)  # 160 down to 70
    edges = cv2.Canny(gray, low_thresh, high_thresh)

    # Step 5: Dilate slightly to make lines visible
    kernel = np.ones((2, 2), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    # Step 6: Clean up tiny noise with morphological open
    if detail < 5:
        kernel_clean = np.ones((2, 2), np.uint8)
        edges = cv2.morphologyEx(edges, cv2.MORPH_OPEN, kernel_clean)

    # Step 7: Invert — dark lines on white background
    result = 255 - edges

    _, buf = cv2.imencode(".png", result)
    return send_file(BytesIO(buf.tobytes()), mimetype="image/png")


@app.route("/remove-bg", methods=["POST"])
def remove_bg():
    """Remove background from an image using rembg (U2Net), return transparent PNG."""
    if "image" not in request.files:
        return jsonify({"error": "No image"}), 400

    from rembg import remove
    from PIL import Image
    import cv2
    import numpy as np

    file = request.files["image"]
    image_bytes = file.read()

    # Open with Pillow
    img = Image.open(BytesIO(image_bytes)).convert("RGBA")

    # Resize for speed if very large
    max_dim = 1024
    if max(img.size) > max_dim:
        ratio = max_dim / max(img.size)
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)

    # Remove background with rembg
    result = remove(img)

    # Crop to content bounding box
    arr = np.array(result)
    alpha = arr[:, :, 3]
    coords = np.argwhere(alpha > 10)
    if len(coords) > 0:
        y0, x0 = coords.min(axis=0)
        y1, x1 = coords.max(axis=0) + 1
        pad = 5
        y0 = max(0, y0 - pad)
        x0 = max(0, x0 - pad)
        y1 = min(arr.shape[0], y1 + pad)
        x1 = min(arr.shape[1], x1 + pad)
        result = result.crop((x0, y0, x1, y1))

    buf = BytesIO()
    result.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


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


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    app.run(debug=True, host="0.0.0.0", port=port)
