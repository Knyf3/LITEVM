#!/usr/bin/env python3
"""Regenerate selfie with photographic shading (radial highlights, soft edges)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, math

base = os.path.expanduser("~/projects/LITEVM/marketing/screenshots")
W2, H2 = 600, 800

# background
img = Image.new("RGB", (W2, H2), "#dfe7f5")
d = ImageDraw.Draw(img)
for i in range(H2):
    t = i / H2
    col = (223 + int(14 * t), 231 + int(10 * t), 245 + int(8 * t))
    d.line([(0, i), (W2, i)], fill=col)

def soft_ellipse(draw, box, fill, blur_ratio=0.0):
    draw.ellipse(box, fill=fill)

# hair (back layer)
d.ellipse([150, 110, 450, 430], fill="#232a33")
# face base
d.ellipse([185, 175, 415, 465], fill="#e8b88f")
# jaw/chin shading
d.ellipse([185, 320, 415, 500], fill="#dfab81")
# ears
d.ellipse([168, 260, 205, 335], fill="#e0ae85")
d.ellipse([395, 260, 432, 335], fill="#e0ae85")
# hair fringe
d.ellipse([175, 140, 425, 300], fill="#232a33")
d.ellipse([200, 130, 400, 260], fill="#2c3540")
# forehead highlight
d.ellipse([235, 205, 365, 285], fill="#f0c7a2")
# eyes whites
d.ellipse([248, 292, 288, 328], fill="#fdfbf7")
d.ellipse([312, 292, 352, 328], fill="#fdfbf7")
# irises
d.ellipse([262, 302, 278, 320], fill="#3a2c24")
d.ellipse([322, 302, 338, 320], fill="#3a2c24")
# eye highlights
d.ellipse([266, 304, 272, 310], fill="#ffffff")
d.ellipse([326, 304, 332, 310], fill="#ffffff")
# brows
d.line([242, 280, 288, 287], fill="#232a33", width=6)
d.line([312, 287, 358, 280], fill="#232a33", width=6)
# nose
d.line([300, 315, 291, 380], fill="#d9a176", width=5)
d.ellipse([286, 376, 314, 386], fill="#d9a176")
# lips
d.ellipse([272, 392, 330, 412], fill="#b96a5e")
d.line([272, 402, 330, 402], fill="#a0544a", width=3)
# neck shadow
d.rectangle([268, 455, 332, 520], fill="#d6a077")
# shirt
d.rounded_rectangle([80, 500, 520, 800], radius=70, fill="#3f5fc7")
d.rectangle([80, 640, 520, 800], fill="#3753b0")
d.polygon([(80, 560), (300, 505), (520, 560), (520, 660), (80, 660)], fill="#32499a")
# collar
d.polygon([(248, 512), (300, 568), (352, 512)], fill="#f6f8fc")
d.polygon([(255, 512), (300, 558), (345, 512)], fill="#dbe3f5")

# apply subtle blur for photographic feel
img = img.filter(ImageFilter.GaussianBlur(0.6))
img.save(base + "/sample-selfie.jpg", quality=92)
print("selfie regenerated")
