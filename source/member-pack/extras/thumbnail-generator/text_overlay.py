#!/usr/bin/env python3
"""
Crisp headline text overlay for YouTube thumbnails, using REAL fonts (Anton /
Archivo Black / Bebas Neue) instead of letting the AI render text. This is what
makes the result look professionally designed instead of "generic AI".

A headline spec (passed in the job JSON under "headline") looks like:
{
  "lines": [
     [{"t": "COMMAND", "fill": "white"}],
     [{"t": "AI AGENTS", "fill": "grad:#3aa0ff,#a855f7,#ec4899"}]
  ],
  "font": "anton",            # anton | archivo | bebas
  "anchor": "top",            # top | center | bottom
  "underline": "#ec4899",     # optional color, or null
  "stroke": "#101010",        # outline color (thin, clean) or null
  "max_width_frac": 0.92,     # fraction of width the text may fill
  "shadow": true
}

Colors: named (white/black/red/yellow/blue) or #hex. "grad:c1,c2,..." = left-to-
right gradient fill across that segment's text.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "fonts")
FONTS = {
    "anton": "Anton-Regular.ttf",
    "archivo": "ArchivoBlack-Regular.ttf",
    "bebas": "BebasNeue-Regular.ttf",
}
NAMED = {
    "white": (255, 255, 255), "black": (15, 15, 15), "red": (230, 28, 28),
    "yellow": (255, 209, 0), "blue": (40, 120, 255), "green": (40, 200, 90),
    "pink": (236, 72, 153), "purple": (168, 85, 247), "orange": (255, 140, 30),
}


def _rgb(c):
    if isinstance(c, (list, tuple)):
        return tuple(c)
    c = c.strip()
    if c.startswith("#"):
        c = c.lstrip("#")
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    return NAMED.get(c.lower(), (255, 255, 255))


def _font(name, size):
    path = os.path.join(FONT_DIR, FONTS.get(name, FONTS["anton"]))
    return ImageFont.truetype(path, size)


def _seg_width(draw, text, font, tracking):
    w = draw.textlength(text, font=font)
    return w + tracking * max(len(text) - 1, 0)


def _line_width(draw, segs, font, tracking):
    total = 0
    for i, s in enumerate(segs):
        t = s["t"] + (" " if i < len(segs) - 1 else "")
        total += _seg_width(draw, t, font, tracking)
    return total


def _gradient_rgba(size, colors):
    w, h = size
    base = Image.new("RGB", (max(w, 1), 1))
    px = base.load()
    cols = [_rgb(c) for c in colors]
    n = len(cols)
    for x in range(max(w, 1)):
        f = x / max(w - 1, 1) * (n - 1)
        i = min(int(f), n - 2)
        t = f - i
        a, b = cols[i], cols[i + 1]
        px[x, 0] = tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))
    return base.resize((max(w, 1), max(h, 1)))


def render_headline(img, spec):
    """Overlay a headline onto a PIL image (RGB). Returns a new RGB image."""
    img = img.convert("RGBA")
    W, H = img.size
    draw = ImageDraw.Draw(img)
    font_name = spec.get("font", "anton")
    lines = spec["lines"]
    max_w = spec.get("max_width_frac", 0.92) * W
    stroke = spec.get("stroke", "#101010")
    stroke_rgb = _rgb(stroke) if stroke else None
    do_shadow = spec.get("shadow", True)
    upper = spec.get("case", "upper") == "upper"

    if upper:
        for ln in lines:
            for s in ln:
                s["t"] = s["t"].upper()

    # ---- find the largest font size that fits every line within max_w ----
    size = int(H * 0.30)
    tracking = 0
    while size > 10:
        font = _font(font_name, size)
        tracking = max(1, int(size * 0.02))
        widest = max(_line_width(draw, ln, font, tracking) for ln in lines)
        asc, desc = font.getmetrics()
        line_h = asc + desc
        total_h = line_h * len(lines) * 1.02
        if widest <= max_w and total_h <= H * 0.46:
            break
        size -= 4
    font = _font(font_name, size)
    line_h = sum(font.getmetrics())
    gap = int(line_h * 0.02)
    block_h = line_h * len(lines) + gap * (len(lines) - 1)

    anchor = spec.get("anchor", "top")
    if anchor == "top":
        y = int(H * 0.05)
    elif anchor == "bottom":
        y = int(H - block_h - H * 0.06)
    else:
        y = int((H - block_h) / 2)

    stroke_w = max(2, int(size * 0.05))
    shadow_off = max(3, int(size * 0.045))

    last_line_bottom = y
    last_line_x0 = W
    last_line_x1 = 0
    for ln in lines:
        lw = _line_width(draw, ln, font, tracking)
        x = (W - lw) / 2
        line_x0, line_x1 = x, x + lw
        # shadow pass (whole line, soft)
        if do_shadow:
            sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            sd = ImageDraw.Draw(sh)
            cx = x
            for i, s in enumerate(ln):
                t = s["t"] + (" " if i < len(ln) - 1 else "")
                sd.text((cx + shadow_off, y + shadow_off), t, font=font,
                        fill=(0, 0, 0, 170))
                cx += _seg_width(draw, t, font, tracking)
            sh = sh.filter(ImageFilter.GaussianBlur(shadow_off * 0.6))
            img.alpha_composite(sh)
            draw = ImageDraw.Draw(img)
        # stroke pass first (so fills sit on top cleanly)
        cx = x
        for i, s in enumerate(ln):
            t = s["t"] + (" " if i < len(ln) - 1 else "")
            if stroke_rgb:
                draw.text((cx, y), t, font=font, fill=stroke_rgb + (255,),
                          stroke_width=stroke_w, stroke_fill=stroke_rgb + (255,))
            cx += _seg_width(draw, t, font, tracking)
        # fill pass (solid or gradient) per segment
        cx = x
        for i, s in enumerate(ln):
            t = s["t"] + (" " if i < len(ln) - 1 else "")
            fill = s.get("fill", "white")
            seg_w = int(_seg_width(draw, t, font, tracking))
            if isinstance(fill, str) and fill.startswith("grad:"):
                cols = fill[5:].split(",")
                mask = Image.new("L", (seg_w, line_h), 0)
                md = ImageDraw.Draw(mask)
                md.text((0, 0), t, font=font, fill=255)
                grad = _gradient_rgba((seg_w, line_h), cols).convert("RGBA")
                img.paste(grad, (int(cx), int(y)), mask)
                draw = ImageDraw.Draw(img)
            else:
                draw.text((cx, y), t, font=font, fill=_rgb(fill) + (255,))
            cx += seg_w
        last_line_bottom = y + line_h
        last_line_x0, last_line_x1 = line_x0, line_x1
        y += line_h + gap

    # underline bar beneath the last line
    ul = spec.get("underline")
    if ul:
        bar_h = max(5, int(size * 0.09))
        pad = int((last_line_x1 - last_line_x0) * 0.02)
        by = int(last_line_bottom - line_h * 0.12)
        draw.rectangle([last_line_x0 + pad, by,
                        last_line_x1 - pad, by + bar_h], fill=_rgb(ul) + (255,))

    return img.convert("RGB")
