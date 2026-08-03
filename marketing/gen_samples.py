#!/usr/bin/env python3
"""Generate realistic sample photos: KTP-style ID card + portrait selfie."""
from PIL import Image, ImageDraw, ImageFont
import os

base = os.path.expanduser("~/projects/LITEVM/marketing/screenshots")

def font(size, bold=False):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else "")
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return None

# ---------- KTP-style ID card ----------
W, H = 860, 540
img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)
# card body
d.rounded_rectangle([20, 20, W - 20, H - 20], radius=12, fill="#ffffff", outline="#c7d2fe", width=3)
# header band
d.rounded_rectangle([20, 20, W - 20, 110], radius=12, fill="#4361ee")
d.rectangle([20, 60, W - 20, 110], fill="#4361ee")
d.rectangle([20, 90, W - 20, 110], fill="#3b55d9")
# header text
d.text((W // 2, 60), "PROVINSI DKI JAKARTA", fill="#ffffff", font=font(20, bold=True), anchor="mm")
d.text((W // 2, 90), "KOTA ADMINISTRASI JAKARTA PUSAT", fill="#e0e7ff", font=font(14), anchor="mm")
# photo box
d.rounded_rectangle([60, 140, 300, 380], radius=8, outline="#94a3b8", width=2)
d.rounded_rectangle([70, 150, 290, 370], radius=6, fill="#eef2ff")
# mini portrait in photo box
d.ellipse([140, 190, 230, 280], fill="#c7d2fe", outline="#818cf8", width=2)
d.arc([165, 240, 205, 280], start=20, end=160, fill="#6366f1", width=4)
d.rounded_rectangle([120, 290, 250, 380], radius=30, fill="#a5b4fc")
# fields
f_lbl = font(13)
f_val = font(15, bold=True)
fields = [
    ("Nama", "AHMAD FAUZI"),
    ("Tempat/Tgl Lahir", "Jakarta, 15-08-1990"),
    ("Jenis Kelamin", "LAKI-LAKI"),
    ("Golongan Darah", "O"),
    ("Alamat", "Jl. Melati No. 45, Kel. Menteng"),
    ("Agama", "ISLAM"),
    ("Status Perkawinan", "KAWIN"),
    ("Pekerjaan", "WIRASWASTA"),
    ("Kewarganegaraan", "WNI"),
    ("Berlaku Hingga", "SEUMUR HIDUP"),
]
y = 145
for label, value in fields:
    d.text((330, y), label, fill="#64748b", font=f_lbl)
    d.text((330, y + 18), value, fill="#0f172a", font=f_val)
    y += 42
# NIK box at bottom
d.rounded_rectangle([330, H - 110, W - 60, H - 60], radius=8, fill="#f1f5f9", outline="#c7d2fe")
d.text((350, H - 105), "NIK", fill="#64748b", font=f_lbl)
d.text((350, H - 87), "3174031508900003", fill="#0f172a", font=font(19, bold=True))
img.save(base + "/sample-id.jpg", quality=92)

# ---------- Portrait selfie ----------
W2, H2 = 600, 800
img2 = Image.new("RGB", (W2, H2), "#eef2ff")
d2 = ImageDraw.Draw(img2)
# soft background gradient
for i in range(H2):
    t = i / H2
    col = (238 + int(10 * t), 242 + int(8 * t), 255)
    d2.line([(0, i), (W2, i)], fill=col)
# hair
d2.ellipse([150, 120, 450, 420], fill="#1e293b")
d2.rounded_rectangle([140, 200, 460, 520], radius=120, fill="#1e293b")
# face
d2.ellipse([180, 180, 420, 460], fill="#f1c7a0")
d2.ellipse([200, 200, 400, 430], fill="#f6d3b2")
# ears
d2.ellipse([168, 260, 200, 330], fill="#eebd92")
d2.ellipse([400, 260, 432, 330], fill="#eebd92")
# eyes
d2.ellipse([245, 290, 285, 325], fill="#ffffff")
d2.ellipse([315, 290, 355, 325], fill="#ffffff")
d2.ellipse([262, 302, 278, 318], fill="#312e81")
d2.ellipse([322, 302, 338, 318], fill="#312e81")
d2.arc([230, 315, 280, 345], start=20, end=160, fill="#312e81", width=5)
d2.arc([320, 315, 370, 345], start=20, end=160, fill="#312e81", width=5)
# eyebrows
d2.line([240, 278, 285, 284], fill="#1e293b", width=5)
d2.line([315, 284, 360, 278], fill="#1e293b", width=5)
# nose
d2.line([300, 320, 292, 380], fill="#e0a87a", width=4)
d2.line([292, 380, 308, 382], fill="#e0a87a", width=4)
# mouth
d2.arc([268, 385, 332, 420], start=10, end=170, fill="#c0655a", width=5)
# neck
d2.rectangle([265, 440, 335, 520], fill="#eebd92")
# shoulders / shirt
d2.rounded_rectangle([90, 500, 510, 800], radius=60, fill="#4361ee")
d2.rectangle([90, 640, 510, 800], fill="#3b55d9")
d2.polygon([(90, 560), (300, 500), (510, 560), (510, 650), (90, 650)], fill="#3650c7")
# collar
d2.polygon([(250, 505), (300, 560), (350, 505)], fill="#ffffff")
d2.polygon([(255, 505), (300, 552), (345, 505)], fill="#dbeafe")
img2.save(base + "/sample-selfie.jpg", quality=92)

print("sample photos regenerated")
