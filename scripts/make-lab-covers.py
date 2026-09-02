#!/usr/bin/env python3
"""Generate the 研究所 tile covers in public/labs/.

Committed so the artwork can be regenerated or replaced without hunting for the
recipe. Each cover is an ABSTRACT geometric motif for its city — deliberately
not a photo and deliberately without baked-in text, because the navbar prints
the 研究所 name underneath the picture (see public/labs/README.md).

House palette: a near-black ground with ONE low-saturation hue per institute,
so six tiles read as six distinct places without turning the panel into a
rainbow (配色契约: colour belongs to the material, and a tile IS material).

    python3 scripts/make-lab-covers.py
"""
from PIL import Image, ImageDraw, ImageFilter
import math, pathlib

W, H = 640, 360
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'labs'
GROUND = (24, 26, 31)

def wash(img, hue, strength=0.95):
    """A soft top-down wash of the institute's hue over the ink ground."""
    g = Image.new('RGB', (W, H), GROUND)
    d = ImageDraw.Draw(g)
    for y in range(H):
        t = (1 - y / H) ** 1.3 * strength
        d.line([(0, y), (W, y)], fill=(
            int(GROUND[0] + (hue[0] - GROUND[0]) * t),
            int(GROUND[1] + (hue[1] - GROUND[1]) * t),
            int(GROUND[2] + (hue[2] - GROUND[2]) * t),
        ))
    img.paste(g, (0, 0))

def vancouver(d, hue):
    """Layered peaks over water — three ridges, back to front."""
    # Atmospheric perspective: the FAR ridge is the hazy pale one and the near
    # ridge is darkest. The first pass had these reversed and the three ridges
    # collapsed into one blob.
    for i, (base, alpha) in enumerate([(0.58, 205), (0.70, 140), (0.83, 78)]):
        pts, y0 = [(0, H)], H * base
        for x in range(0, W + 1, 20):
            y = y0 + math.sin(x / (70 + i * 34) + i * 1.7) * (34 - i * 8) - abs(math.sin(x / 190 + i)) * 26
            pts.append((x, y))
        pts.append((W, H))
        d.polygon(pts, fill=tuple(int(c * alpha / 255) for c in hue))
    for y in range(int(H * 0.87), H, 8):  # water, catching the last of the light
        d.line([(70, y), (W - 70, y)], fill=tuple(int(c * 0.55) for c in hue), width=1)

def toronto(d, hue):
    """A skyline of towers, one tall spire."""
    x = 40
    heights = [0.30, 0.46, 0.38, 0.62, 0.34, 0.50, 0.42, 0.58, 0.36, 0.44]
    for i, h in enumerate(heights):
        w = 26 + (i % 3) * 12
        top = H - H * h
        d.rectangle([x, top, x + w, H], fill=tuple(int(c * (0.35 + 0.07 * (i % 4))) for c in hue))
        x += w + 16
    d.rectangle([W * 0.60, H * 0.14, W * 0.60 + 9, H], fill=hue)      # spire
    d.ellipse([W * 0.60 - 17, H * 0.30, W * 0.60 + 26, H * 0.38], fill=hue)

def ottawa(d, hue):
    """Gothic arches."""
    for i in range(5):
        x = 70 + i * 105
        top, w = H * (0.30 + 0.05 * (i % 2)), 62
        d.arc([x, top, x + w, top + w], 180, 360, fill=hue, width=3)
        d.line([(x, top + w / 2), (x, H)], fill=hue, width=3)
        d.line([(x + w, top + w / 2), (x + w, H)], fill=hue, width=3)
    d.polygon([(W / 2 - 26, H * 0.30), (W / 2, H * 0.10), (W / 2 + 26, H * 0.30)], outline=hue, width=3)

def waterloo(d, hue):
    """Circuit lattice — nodes on a grid, some traced."""
    step = 52
    for gy in range(1, H // step):
        for gx in range(1, W // step):
            x, y = gx * step, gy * step
            if (gx * 7 + gy * 5) % 4:
                d.line([(x, y), (x + step, y)], fill=tuple(int(c * 0.30) for c in hue), width=1)
            if (gx * 3 + gy * 11) % 5:
                d.line([(x, y), (x, y + step)], fill=tuple(int(c * 0.30) for c in hue), width=1)
            if (gx + gy) % 3 == 0:
                d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=hue)

def edmonton(d, hue):
    """Aurora — stacked bands of light."""
    for i in range(7):
        pts = []
        base = H * (0.22 + i * 0.085)
        for x in range(0, W + 1, 12):
            pts.append((x, base + math.sin(x / 95 + i * 0.9) * (20 + i * 3)))
        d.line(pts, fill=tuple(int(c * (0.85 - i * 0.10)) for c in hue), width=max(1, 7 - i))

def montreal(d, hue):
    """Bridge arcs over the river."""
    for i, (cx, r) in enumerate([(150, 120), (330, 150), (510, 120)]):
        d.arc([cx - r, H * 0.42, cx + r, H * 0.42 + r * 1.5], 180, 360, fill=hue, width=4)
        for k in range(-r, r + 1, 30):  # suspension lines
            d.line([(cx + k, H * 0.42 + r * 0.75 - math.sqrt(max(0, r * r - k * k)) * 0.75), (cx + k, H * 0.78)],
                   fill=tuple(int(c * 0.40) for c in hue), width=1)
    d.line([(0, H * 0.78), (W, H * 0.78)], fill=hue, width=3)

CITIES = [
    ('vancouver', (72, 138, 156), vancouver),   # cool teal — coast and mountains
    ('toronto',   (78, 112, 184), toronto),     # blue — skyline
    ('ottawa',    (158, 94, 94), ottawa),       # muted red — parliament stone
    ('waterloo',  (104, 142, 96), waterloo),    # green — circuit lattice
    ('edmonton',  (128, 104, 174), edmonton),   # violet — aurora
    ('montreal',  (172, 132, 82), montreal),    # amber — bridges
]

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, hue, draw_motif in CITIES:
        img = Image.new('RGB', (W, H), GROUND)
        wash(img, hue)
        # Draw straight onto the washed ground: compositing the motif through a
        # blend was what turned the first pass into six near-black rectangles.
        draw_motif(ImageDraw.Draw(img), tuple(min(255, int(c * 1.45)) for c in hue))
        img = img.filter(ImageFilter.SMOOTH)
        # A gentle vignette, only at the corners, so the name printed under the
        # tile stays legible without dimming the motif itself.
        v = Image.new('L', (W, H), 255)
        ImageDraw.Draw(v).ellipse([-W * 0.35, -H * 0.55, W * 1.35, H * 1.55], fill=255)
        ImageDraw.Draw(v).rectangle([0, 0, W, H], outline=150, width=70)
        img = Image.composite(img, Image.new('RGB', (W, H), GROUND), v.filter(ImageFilter.GaussianBlur(45)))
        img.save(OUT / f'{name}.jpg', quality=82, optimize=True)
        print('wrote', (OUT / f'{name}.jpg').relative_to(OUT.parent.parent))

if __name__ == '__main__':
    main()
