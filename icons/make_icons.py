#!/usr/bin/env python3
"""Regenerate the SpellCoach PNG icons from scratch (no SVG renderer needed).

    python icons/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

INDIGO = (99, 102, 241)
VIOLET = (139, 92, 246)
GREEN = (52, 211, 153)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\seguibl.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\verdanab.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "DejaVuSans-Bold.ttf",
]


def find_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def gradient(size):
    """Vertical indigo -> violet wash, upscaled from a 1px strip."""
    strip = Image.new("RGB", (1, size))
    px = strip.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = (
            int(INDIGO[0] + (VIOLET[0] - INDIGO[0]) * t),
            int(INDIGO[1] + (VIOLET[1] - INDIGO[1]) * t),
            int(INDIGO[2] + (VIOLET[2] - INDIGO[2]) * t),
        )
    return strip.resize((size, size), Image.BILINEAR).convert("RGBA")


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def load_font(size):
    path = find_font()
    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def draw_glyphs(base, size, scale, text="Aa"):
    """Draw the wordmark + underline + success dot onto `base`."""
    d = ImageDraw.Draw(base)

    # text
    font_size = int(size * 0.44 * scale)
    font = load_font(font_size)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx = size // 2
    cy = int(size * (0.54 if scale > 0.8 else 0.50))
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=font, fill=(255, 255, 255, 255))

    # underline
    line_w = int(size * 0.44 * scale)
    lw = max(4, int(size * 0.045 * scale))
    ly = int(cy + th / 2 + size * 0.10 * scale)
    d.rounded_rectangle(
        [cx - line_w // 2, ly, cx + line_w // 2, ly + lw],
        radius=lw // 2, fill=(255, 255, 255, 210),
    )

    # success dot
    r = int(size * 0.075 * scale)
    dot_x = int(cx + line_w / 2 - r * 0.2)
    dot_y = int(cy - th / 2 - r * 0.3)
    d.ellipse([dot_x - r, dot_y - r, dot_x + r, dot_y + r], fill=GREEN + (255,))


def make(size, out, maskable=False):
    img = gradient(size)
    if not maskable:
        img.putalpha(rounded_mask(size, int(size * 0.23)))
    draw_glyphs(img, size, 1.0 if not maskable else 0.78)
    img.save(os.path.join(HERE, out), "PNG")
    print("wrote", out, f"{size}x{size}")


def make_svg():
    src = os.path.join(HERE, "icon.svg")
    if os.path.exists(src):
        print("icon.svg present (authored by hand)")


if __name__ == "__main__":
    make(192, "icon-192.png")
    make(512, "icon-512.png")
    make(512, "icon-maskable-512.png", maskable=True)
    make_svg()
