#!/usr/bin/env python3
from PIL import Image

slide = Image.open("/home/hermes/projects/LITEVM/marketing/deck/slide-08.jpg")
w, h = slide.size
print("slide:", w, h)

# Cards: x = 0.7 + i*2.2 inches, w=2.0in, y=1.95in, h=3.0in on a 10in x 5.625in slide
# Scale: 1in = w/10 px
def inch_to_px(v):
    return int(v * w / 10)

# Find card top edges: scan each card's center column for the card background color change
# Cards are at x centers 1.7, 3.9, 6.1, 8.3 inches
card_colors = {
    0: "white card",
    1: "blue card",
    2: "green card",
    3: "dark blue card",
}
for i, cx_in in enumerate([1.7, 3.9, 6.1, 8.3]):
    px = inch_to_px(cx_in)
    # scan from top: find where card color region starts (below header area ~y=1.9in)
    start = inch_to_px(1.8)
    # look at y = 1.95in exactly
    y_card_top = inch_to_px(1.95)
    # Sample a vertical strip and find the first row that differs from navy background
    navy = (30, 39, 97)
    first_non_navy = None
    for py in range(inch_to_px(1.5), inch_to_px(2.3)):
        r, g, b = slide.getpixel((px, py))[:3]
        if abs(r - navy[0]) + abs(g - navy[1]) + abs(b - navy[2]) > 60:
            first_non_navy = py
            break
    print(f"card {i} ({card_colors[i]}): first non-navy pixel at y={first_non_navy}px = {first_non_navy / (w/10):.2f}in" if first_non_navy else f"card {i}: none found")

# Multi-Site card: x center 8.3in, check header vs price overlap
# header text y=1.95+0.12=2.07in to 2.47in; price y=2.45in to 3.05in
px = inch_to_px(8.3)
print("\nMulti-Site card column scan (x=8.3in):")
for py in range(inch_to_px(2.0), inch_to_px(3.2), 4):
    r, g, b = slide.getpixel((px, py))[:3]
    print(f"  y={py/(w/10):.2f}in rgb={r},{g},{b} {'LIGHT' if (r+g+b)/3>120 else 'dark'}")
