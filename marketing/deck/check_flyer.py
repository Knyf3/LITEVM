#!/usr/bin/env python3
from PIL import Image

flyer = Image.open("/home/hermes/projects/LITEVM/marketing/flyer-preview.png")
w, h = flyer.size
print("flyer:", w, h)

# A4 portrait at dsf=2: 794*2 x 1123*2 = 1588 x 2246
# header pitch text ~ x 14mm-144mm, y ~ around 46-58mm
# mm -> px: x*1588/210, y*2246/297
def mx(mm): return int(mm * w / 210)
def my(mm): return int(mm * h / 297)

# find the navy/white boundary (bottom of header) in the left column
# scan column at x=30mm from top down: navy (30,39,97) -> light
col_x = mx(30)
boundary = None
for y in range(my(5), my(80)):
    r, g, b = flyer.getpixel((col_x, y))[:3]
    if (r + g + b) / 3 > 200:  # light bg
        boundary = y
        break
print("navy->white boundary at y_px", boundary, "=", boundary / (h/297), "mm")

# scan for the last dark-ish text pixel in the header region (before boundary)
# the pitch is light blue #B8C6E8 on navy — moderately bright
# check if any pitch text is near/at the boundary
found_near = []
for y in range(max(0, boundary - 30), boundary):
    for x in range(mx(14), mx(145)):
        r, g, b = flyer.getpixel((x, y))[:3]
        # pitch text ~ (184, 198, 232); navy bg (30,39,97)
        if r > 120 and g > 120 and b > 150 and r < 230:
            found_near.append((x, y))
print("bright-ish pixels in 30px band above boundary:", len(found_near))
if found_near:
    ys = [p[1] for p in found_near]
    print("  min/max y:", min(ys), max(ys), "-> closest to boundary:", boundary - max(ys), "px gap")
