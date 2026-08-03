#!/usr/bin/env python3
from PIL import Image

flyer = Image.open("/home/hermes/projects/LITEVM/marketing/flyer-preview.png")
w, h = flyer.size
def mx(mm): return int(mm * w / 210)
def my(mm): return int(mm * h / 297)

# Pitch text is #B8C6E8 (184,198,232). Count exact-match-ish pixels in header region
pitch_px = 0
pitch_ys = []
for y in range(my(30), my(66)):
    for x in range(mx(14), mx(145)):
        r, g, b = flyer.getpixel((x, y))[:3]
        if abs(r-184) < 30 and abs(g-198) < 30 and abs(b-232) < 30:
            pitch_px += 1
            pitch_ys.append(y)
print("pitch-colored pixels:", pitch_px)
if pitch_ys:
    print("  y range:", min(pitch_ys), "-", max(pitch_ys), "=", max(pitch_ys)/(h/297), "mm max")

# Header bottom (navy->white)
col_x = mx(30)
boundary = None
for y in range(my(5), my(80)):
    r, g, b = flyer.getpixel((col_x, y))[:3]
    if (r+g+b)/3 > 200:
        boundary = y
        break
print("navy boundary:", boundary, "=", boundary/(h/297), "mm")
if pitch_ys:
    print("gap from last pitch text to boundary:", boundary - max(pitch_ys), "px =", (boundary - max(pitch_ys))/(h/297)*1000, "microns")
