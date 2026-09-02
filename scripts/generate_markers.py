import os
import math
from PIL import Image, ImageDraw, ImageFont
import qrcode

def generate_custom_marker():
    print("Generating custom marker and .patt...")
    size = 512
    # Standard AR.js marker proportions:
    # whiteMargin = 10% (0.1)
    # patternRatio = 0.5 (inner pattern is 50% of the active area)
    # blackMargin = 80% * (1 - 0.5) / 2 = 20%
    # innerMargin = 10% + 20% = 30% -> 0.30 * 512 = 153.6 -> 154 px
    
    # 1. Create the full marker image (512x512)
    marker_img = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(marker_img)
    
    # Outer black box (starts at 10% margin = ~51px, ends at 90% = ~461px)
    outer_m = int(size * 0.10)
    draw.rectangle([outer_m, outer_m, size - outer_m, size - outer_m], fill="black")
    
    # Inner white box (starts at 30% margin = ~154px, ends at 70% = ~358px)
    inner_m = int(size * 0.30)
    draw.rectangle([inner_m, inner_m, size - inner_m, size - inner_m], fill="white")
    
    # 2. Draw an asymmetrical icon inside the inner area (size ~204x204)
    # Let's create an inner image for precise sampling
    inner_size = size - 2 * inner_m
    inner_img = Image.new("RGB", (inner_size, inner_size), "white")
    inner_draw = ImageDraw.Draw(inner_img)
    
    # Draw a bold letter "N" (for Nexel) or a stylish geometric emblem
    pad = int(inner_size * 0.15)
    w = int(inner_size * 0.22)
    # Left vertical bar
    inner_draw.rectangle([pad, pad, pad + w, inner_size - pad], fill="black")
    # Right vertical bar
    inner_draw.rectangle([inner_size - pad - w, pad, inner_size - pad, inner_size - pad], fill="black")
    # Diagonal bar
    inner_draw.polygon([
        (pad + w, pad),
        (pad, pad),
        (inner_size - pad - w, inner_size - pad),
        (inner_size - pad, inner_size - pad)
    ], fill="black")
    
    # Paste inner image onto marker
    marker_img.paste(inner_img, (inner_m, inner_m))
    
    # Save marker image
    os.makedirs("assets", exist_ok=True)
    marker_path = os.path.join("assets", "custom-marker.png")
    marker_img.save(marker_path)
    print(f"Saved custom marker image: {marker_path}")
    
    # 3. Generate .patt file following AR.js / ARToolKit algorithm
    # Step: resize inner image to 16x16
    thumb = inner_img.resize((16, 16), Image.Resampling.BILINEAR)
    
    # We need 4 orientations: 0, 90, 180, 270 degrees clockwise
    # In THREEx.ArPatternFile:
    # for orientation = 0 to -2*PI step -PI/2:
    # context.rotate(orientation) -> negative angle is clockwise
    # Channel order is B, G, R (channelOffset = 2, 1, 0)
    orientations = [0, 90, 180, 270]
    patt_lines = []
    
    for idx, deg in enumerate(orientations):
        # Rotate image clockwise by deg
        # PIL rotate rotates counter-clockwise for positive angles, so use -deg
        rot_img = thumb.rotate(-deg, expand=False, fillcolor=(255, 255, 255))
        pixels = rot_img.load()
        
        # Add separator between orientations
        if idx > 0:
            patt_lines.append("")
            
        # Channels: B (2), G (1), R (0)
        for channel in [2, 1, 0]:
            for y in range(16):
                row_vals = []
                for x in range(16):
                    r, g, b = pixels[x, y]
                    val = [r, g, b][channel]
                    row_vals.append(f"{val:3d}")
                patt_lines.append(" ".join(row_vals))
                
    patt_content = "\n".join(patt_lines) + "\n"
    patt_path = os.path.join("assets", "pattern-custom.patt")
    with open(patt_path, "w", encoding="ascii") as f:
        f.write(patt_content)
    print(f"Saved pattern file: {patt_path}")

def generate_qr_hiro():
    print("Generating combined QR code + Hiro marker...")
    target_url = "https://nexel-craft.github.io/AR-Website/exercice-5/"
    
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # 30% error correction
        box_size=14,
        border=4,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    qr_w, qr_h = qr_img.size
    
    # Hiro marker should occupy ~26% of the QR width
    # 26% width means 0.26 * 0.26 = ~6.8% area, well within 30% error correction
    hiro_target_size = int(qr_w * 0.26)
    
    hiro_source_path = os.path.join("assets", "HIRO.jpg")
    if not os.path.exists(hiro_source_path):
        raise FileNotFoundError("HIRO.jpg not found in assets/")
        
    hiro_img = Image.open(hiro_source_path).convert("RGB")
    hiro_resized = hiro_img.resize((hiro_target_size, hiro_target_size), Image.Resampling.LANCZOS)
    
    # Create white buffer around Hiro to preserve contrast and prevent QR modules from touching Hiro's border
    buffer_margin = int(hiro_target_size * 0.08)
    buffer_size = hiro_target_size + 2 * buffer_margin
    buffer_img = Image.new("RGB", (buffer_size, buffer_size), "white")
    buffer_img.paste(hiro_resized, (buffer_margin, buffer_margin))
    
    # Paste centered
    center_x = (qr_w - buffer_size) // 2
    center_y = (qr_h - buffer_size) // 2
    qr_img.paste(buffer_img, (center_x, center_y))
    
    out_path = os.path.join("assets", "qr-hiro-marker.png")
    qr_img.save(out_path)
    # Also save as qr-hiro.png for convenience
    qr_img.save(os.path.join("assets", "qr-hiro.png"))
    print(f"Saved combined QR-Hiro marker: {out_path} ({qr_w}x{qr_h})")

if __name__ == "__main__":
    generate_custom_marker()
    generate_qr_hiro()
    print("Assets generated successfully!")
