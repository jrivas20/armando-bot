"""
JRZ Marketing — Viral Reel Generator
Usage: python3 generate_reel.py '<json>' <output.mp4>

JSON input shape:
{
  "hook":        "¿POR QUÉ",
  "hook_sub":    "tu competencia crece\nMÁS RÁPIDO que tú?",
  "content":     ["→  punto 1", "→  punto 2", "→  punto 3"],
  "climax1":     "NO ES",
  "climax2":     "MAGIA.",
  "climax_sub":  "Es sistema."
}
"""

import sys, json, os, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── Args ──────────────────────────────────────────────────────────────────────
data    = json.loads(sys.argv[1])
out_mp4 = sys.argv[2]

# ── Brand ─────────────────────────────────────────────────────────────────────
W, H    = 1080, 1080
FPS     = 30
BG      = (255, 255, 255)
BLACK   = (10, 10, 10)
RED     = (210, 35, 35)
GRAY    = (200, 200, 200)

LOGO_URL = "https://res.cloudinary.com/dbsuw1mfm/image/upload/jrz/logo.png"
BOOKING  = "jrzmarketing.com"
PHONE    = "(407) 844-6376"

# ── Font loader ────────────────────────────────────────────────────────────────
def load_font(size):
    for p in [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",   # Render/Ubuntu
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",             # macOS dev
        "/Library/Fonts/Arial Bold.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

FONT_HOOK   = load_font(120)
FONT_BIG    = load_font(82)
FONT_MED    = load_font(62)
FONT_BULLET = load_font(50)
FONT_SMALL  = load_font(36)

# ── Logo ──────────────────────────────────────────────────────────────────────
LOGO_CACHE = "/tmp/jrz_logo_cache.png"
if not os.path.exists(LOGO_CACHE):
    req = urllib.request.Request(LOGO_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r, open(LOGO_CACHE, "wb") as f:
        f.write(r.read())

logo_img = Image.open(LOGO_CACHE).convert("RGBA")
logo_img.thumbnail((150, 150), Image.LANCZOS)
LW, LH = logo_img.size

# ── Helpers ───────────────────────────────────────────────────────────────────
def blank():
    return Image.new("RGB", (W, H), BG)

def center_text(draw, text, y, font, color=BLACK):
    bb = draw.textbbox((0, 0), text, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    draw.text(((W - tw) // 2, y), text, font=font, fill=color)
    return y + th

def rule(draw, y, color=RED, pad=100, weight=5):
    draw.line([(pad, y), (W - pad, y)], fill=color, width=weight)

def paste_logo(img, y=None):
    ly = y if y is not None else (H - LH - 40)
    img.paste(logo_img, ((W - LW) // 2, ly), logo_img)

# ── Scene 1 — Heavy hook ──────────────────────────────────────────────────────
def scene_hook():
    img = blank(); d = ImageDraw.Draw(img)
    y = 130
    y = center_text(d, data["hook"], y, FONT_HOOK, RED) + 20
    rule(d, y); y += 35
    for line in data["hook_sub"].split("\n"):
        y = center_text(d, line.strip(), y, FONT_BIG, BLACK) + 18
    paste_logo(img)
    return img

# ── Scene 2 — Contrast, well spaced ──────────────────────────────────────────
def scene_content():
    img = blank(); d = ImageDraw.Draw(img)
    y = 100
    y = center_text(d, "Tienen un",   y, FONT_MED, BLACK) + 8
    y = center_text(d, "SISTEMA.",    y, FONT_BIG, BLACK) + 38
    rule(d, y, color=GRAY, weight=3); y += 38
    y = center_text(d, "Tú tienes",   y, FONT_MED, RED) + 8
    y = center_text(d, "intuición.",  y, FONT_BIG, RED) + 48
    rule(d, y); y += 34
    for b in data["content"][:3]:
        y = center_text(d, b, y, FONT_BULLET, BLACK) + 22
    paste_logo(img)
    return img

# ── Scene 3 — Climax ─────────────────────────────────────────────────────────
def scene_climax():
    img = blank(); d = ImageDraw.Draw(img)
    y = 200
    y = center_text(d, data["climax1"],   y, FONT_HOOK, BLACK) + 28
    y = center_text(d, data["climax2"],   y, FONT_HOOK, RED)   + 40
    rule(d, y); y += 40
    center_text(d, data["climax_sub"], y, FONT_BIG, BLACK)
    paste_logo(img)
    return img

# ── Scene 4 — CTA ─────────────────────────────────────────────────────────────
def scene_cta():
    img = blank(); d = ImageDraw.Draw(img)
    paste_logo(img, y=160)
    y = 360
    rule(d, y); y += 40
    y = center_text(d, "Agenda tu consulta GRATIS", y, FONT_MED, BLACK) + 28
    y = center_text(d, BOOKING,                     y, FONT_MED, RED)   + 24
    center_text(d, PHONE, y, FONT_SMALL, (140, 140, 140))
    return img

scenes = [
    (scene_hook(),    4),
    (scene_content(), 5),
    (scene_climax(),  4),
    (scene_cta(),     2),
]

# ── Render ────────────────────────────────────────────────────────────────────
FADE  = 12
white = blank()
frames = []

def blend(a, b, t):
    return Image.fromarray(
        (np.array(a, float) * (1 - t) + np.array(b, float) * t).astype(np.uint8)
    )

for scene, secs in scenes:
    total = secs * FPS
    hold  = total - FADE * 2
    for i in range(FADE):
        frames.append(np.array(blend(white, scene, i / FADE)))
    arr = np.array(scene)
    for _ in range(hold):
        frames.append(arr)
    for i in range(FADE):
        frames.append(np.array(blend(scene, white, i / FADE)))

import imageio
writer = imageio.get_writer(out_mp4, fps=FPS, quality=9, macro_block_size=1)
for f in frames:
    writer.append_data(f)
writer.close()

print(f"OK:{out_mp4}:{len(frames)/FPS:.1f}s")
