#!/usr/bin/env python3
"""Generate FauciPies home-screen icons — cream pie with FAUCI PIES label."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PIE = ROOT / "assets" / "pie.png"

# App palette
BG = (22, 28, 34)
BG_MID = (40, 58, 72)
BERRY = (139, 30, 45)
CREAM = (255, 246, 232)
GLOW = (158, 185, 206)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/Library/Fonts/Impact.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def fit_font(draw: ImageDraw.ImageDraw, lines: list[str], max_w: float, max_h: float) -> ImageFont.ImageFont:
    """Largest Impact-style size that keeps both lines inside the pie cream."""
    lo, hi = 8, int(max_h * 0.55)
    best = load_font(lo)
    while lo <= hi:
        mid = (lo + hi) // 2
        font = load_font(mid)
        widths = [draw.textbbox((0, 0), line, font=font)[2] for line in lines]
        line_h = draw.textbbox((0, 0), "Hg", font=font)[3]
        total_h = line_h * len(lines) + int(mid * 0.12) * (len(lines) - 1)
        if max(widths) <= max_w and total_h <= max_h:
            best = font
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def draw_label(canvas: Image.Image, size: int) -> None:
    """Berry-red FAUCI PIES centered on the cream, like in-app pie chips."""
    draw = ImageDraw.Draw(canvas)
    lines = ["FAUCI", "PIES"]
    max_w = size * 0.42
    max_h = size * 0.28
    font = fit_font(draw, lines, max_w, max_h)

    line_boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    line_heights = [b[3] - b[1] for b in line_boxes]
    gap = max(2, int(size * 0.012))
    total_h = sum(line_heights) + gap * (len(lines) - 1)
    cy = size * 0.50
    y = cy - total_h / 2

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)

    for line, box, lh in zip(lines, line_boxes, line_heights):
        tw = box[2] - box[0]
        x = (size - tw) / 2 - box[0]
        # Soft cream halo so berry text stays readable on whipped cream
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            sd.text((x + dx * max(1, size // 180), y + dy * max(1, size // 180)), line, font=font, fill=CREAM + (220,))
        sd.text((x, y + max(1, size // 200)), line, font=font, fill=(255, 255, 255, 90))
        sd.text((x, y), line, font=font, fill=BERRY + (255,))
        y += lh + gap

    canvas.alpha_composite(shadow)


def build_icon(size: int, maskable: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG + (255,))

    # Soft stage glow (matches app blue-grey atmosphere)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(
        (size * 0.12, size * 0.12, size * 0.88, size * 0.88),
        fill=GLOW + (55,),
    )
    gd.ellipse(
        (size * 0.22, size * 0.22, size * 0.78, size * 0.78),
        fill=BG_MID + (70,),
    )
    canvas = Image.alpha_composite(
        canvas, glow.filter(ImageFilter.GaussianBlur(radius=max(4, size // 14)))
    )

    pie = Image.open(PIE).convert("RGBA")
    # Maskable needs more safe-area inset for Android adaptive icons
    scale = 0.72 if maskable else 0.86
    pie_size = int(size * scale)
    pie = pie.resize((pie_size, pie_size), Image.Resampling.LANCZOS)

    # Soft drop shadow under pie
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    pad = (size - pie_size) // 2
    inset = int(pie_size * 0.06)
    sd.ellipse(
        (
            pad + inset,
            pad + pie_size * 0.55,
            pad + pie_size - inset,
            pad + pie_size * 0.95,
        ),
        fill=(0, 0, 0, 90),
    )
    canvas = Image.alpha_composite(
        canvas, shadow.filter(ImageFilter.GaussianBlur(radius=max(4, size // 28)))
    )

    ox = (size - pie_size) // 2
    oy = (size - pie_size) // 2
    canvas.alpha_composite(pie, (ox, oy))

    draw_label(canvas, size)
    return canvas


def save_icons() -> None:
    if not PIE.exists():
        raise SystemExit(f"Missing pie asset: {PIE}")

    # Base icons
    specs = [
        ("icon-512.png", 512, False),
        ("icon-192.png", 192, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
        ("apple-touch-icon-180x180.png", 180, False),
        ("apple-touch-icon-167x167.png", 167, False),
        ("apple-touch-icon-152x152.png", 152, False),
        ("apple-touch-icon-120x120.png", 120, False),
        ("apple-touch-icon-precomposed.png", 180, False),
        ("favicon-32.png", 32, False),
    ]
    for name, size, maskable in specs:
        img = build_icon(size, maskable=maskable)
        out = img.convert("RGB")
        out.save(ROOT / name, "PNG", optimize=True)
        print(f"Wrote {ROOT / name}")


if __name__ == "__main__":
    save_icons()
