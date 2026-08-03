#!/usr/bin/env python3
from PIL import Image

flyer = Image.open("/home/hermes/projects/LITEVM/marketing/flyer-preview.png")
w, h = flyer.size
def mx(mm): return int(mm * w / 210)
def my(mm): return int(mm * h / 297)

# Scan several columns for navy->light boundary. Text-free columns: x=190mm (right edge, past pitch max-width 130mm)
for xmm in [20, 60, 100, 150, 190]:
    col_x = mx(xmm)
    boundary = None
    for y in range(my(5), my(80)):
        r, g, b = flyer.getpixel((col_x, y))[:3]
        if (r+g+b)/3 > 200:
            boundary = y
            break
    print(f"x={xmm}mm: first bright at y={boundary} = {boundary/(h/297):.1f}mm" if boundary else f"x={xmm}mm: none")

# At x=190mm (should be text-free navy), find the true header bottom
col_x = mx(190)
boundary = None
for y in range(my(5), my(80)):
    r, g, b = flyer.getpixel((col_x, y))[:3]
    if (r+g+b)/3 > 200:
        boundary = y
        break
print("\nTRUE header bottom (x=190mm):", boundary/(h/297), "mm")
print("Last pitch text at ~65.6mm, so padding below text =", boundary/(h/297) - 65.6, "mm")
