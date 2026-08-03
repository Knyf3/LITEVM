#!/usr/bin/env python3
from PIL import Image
import os

base = os.path.expanduser("~/projects/LITEVM/marketing/screenshots")
for f in ["01-registration-form.png", "02-photos-uploaded.png", "04-registration-result.png", "05-guard-pin.png", "06-guard-today-list.png", "07-guard-lookup-result.png"]:
    im = Image.open(os.path.join(base, f))
    print(f, im.size, "aspect:", round(im.size[0]/im.size[1], 4))

slide = Image.open(os.path.expanduser("~/projects/LITEVM/marketing/deck/slide-05.jpg"))
w, h = slide.size
print("slide size:", w, h)
for cx_in in [1.8, 5.0, 8.2]:
    px = int(cx_in / 10 * w)
    first_light = last_light = None
    for py in range(h):
        r, g, b = slide.getpixel((px, py))[:3]
        if (r + g + b) / 3 > 150:
            if first_light is None:
                first_light = py
            last_light = py
    print(f"col {cx_in}in: light y-range {first_light}-{last_light} (of {h})")
