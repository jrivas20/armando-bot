"""
JRZ Marketing — Viral Reel Generator
Usage: python3 generate_reel.py '<json>' <output.mp4>

JSON input shape:
{
  "hook":        "¿POR QUÉ",          # big red hook word/phrase
  "hook_sub":    "tu competencia...", # supporting hook lines (newline-separated)
  "content":     ["→ IA 24/7", ...],  # bullet points (scene 2)
  "climax1":     "NO ES",             # scene 3 line 1 (black)
  "climax2":     "MAGIA.",            # scene 3 line 2 (red)
  "climax_sub":  "Es sistema."        # scene 3 supporting line
}
"""

import sys, json, os, urllib.request, subprocess, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── Args ─────────────────────────────────────────────────────────────────────
data    = json.loads(sys.argv[1])
out_mp4 = sys.argv[2]

# ── Brand constants ───────────────────────────────────────────────────────────
W, H    = 1080, 1080
FPS     = 30
BG      = (255, 255, 255)
BLACK   = (10, 10, 10)
RED     = (220, 38, 38)

LOGO_URL = "https://res.cloudinary.com/dbsuw1mfm/image/upload/jrz/logo.png"
BOOKING  = "jrzmarketing.com"
PHONE    = "(407) 844-6376"

# ── Font loader — tries Liberation (Ubuntu/Render) then falls back to system ──
def load_font(size, bold=True):
    candidates = [
        # Ubuntu / Render
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-Bold.ttf",
        # macOS dev
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

FONT_BIG  = load_font(108)
FONT_MED  = load_font(70)
FONT_SML  = load_font(46)
FONT_TINY = load_font(32)

# ── Logo ──────────────────────────────────────────────────────────────────────
logo_path = "/tmp/jrz_logo_cache.png"
if not os.path.exists(logo_path):
    req = urllib.request.Request(LOGO_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r, open(logo_path, "wb") as f:
        f.write(r.read())

logo_img = Image.open(logo_path).convert("RGBA")
logo_img.thumbnail((140, 140), Image.LANCZOS)

def paste_logo(img, y=910):
    lw, lh = logo_img.size
    x = (W - lw) // 2
    img.paste(logo_img, (x, y), logo_img)

# ── Drawing helpers ───────────────────────────────────────────────────────────
def blank():
    return Image.new("RGB", (W, H), BG)

def draw_text_centered(draw, text, y, font, color=BLACK):
    bb = draw.textbbox((0, 0), text, font=font)
    tw = bb[2] - bb[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=color)
    return y + (bb[3] - bb[1]) + 14

def draw_lines(draw, lines, y, font, color=BLACK, gap=10):
    for line in lines:
        y = draw_text_centered(draw, line, y, font, color) + gap
    return y

def accent_line(draw, y, pad=110):
    draw.line([(pad, y), (W - pad, y)], fill=RED, width=5)

# ── Build scenes ──────────────────────────────────────────────────────────────
def scene_hook():
    img = blank(); d = ImageDraw.Draw(img)
    y = 155
    y = draw_text_centered(d, data["hook"], y, FONT_BIG, RED)
    accent_line(d, y + 8)
    y += 30
    for line in data["hook_sub"].split("\n"):
        y = draw_text_centered(d, line.strip(), y, FONT_MED, BLACK)
    paste_logo(img)
    return img

def scene_content():
    img = blank(); d = ImageDraw.Draw(img)
    bullets = data["content"]
    y = 130
    # top label
    y = draw_text_centered(d, "LA DIFERENCIA:", y, FONT_SML, RED) + 10
    accent_line(d, y); y += 30
    for b in bullets[:5]:
        y = draw_text_centered(d, b, y, FONT_SML, BLACK) + 4
    paste_logo(img)
    return img

def scene_climax():
    img = blank(); d = ImageDraw.Draw(img)
    y = 210
    y = draw_text_centered(d, data["climax1"], y, FONT_BIG, BLACK)
    y = draw_text_centered(d, data["climax2"], y, FONT_BIG, RED)
    accent_line(d, y + 10); y += 40
    y = draw_text_centered(d, data["climax_sub"], y, FONT_MED, BLACK)
    paste_logo(img)
    return img

def scene_cta():
    img = blank(); d = ImageDraw.Draw(img)
    paste_logo(img, y=180)
    d_y = 370
    accent_line(d, d_y); d_y += 30
    d_y = draw_text_centered(d, "Agenda tu consulta GRATIS", d_y, FONT_SML, BLACK)
    d_y = draw_text_centered(d, BOOKING, d_y + 6, FONT_SML, RED)
    draw_text_centered(d, PHONE, d_y + 10, FONT_TINY, (130, 130, 130))
    return img

scenes = [
    (scene_hook(),    4),
    (scene_content(), 5),
    (scene_climax(),  4),
    (scene_cta(),     2),
]

FADE = 12  # ~0.4s crossfade

def blend(a, b, t):
    return Image.fromarray(
        (np.array(a, float) * (1 - t) + np.array(b, float) * t).astype(np.uint8)
    )

white = blank()
frames = []
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
