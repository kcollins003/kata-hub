"""Draws the Home Screen icon (out/tracker-icon.png): KW in Cinzel Black, bone on black, the red rule under it.
Needs Cinzel-Black.ttf (SIL Open Font License); pass its path, or keep it at ../shelved/fonts/."""
import pathlib, sys
from PIL import Image, ImageDraw, ImageFont

here = pathlib.Path(__file__).parent
ttf = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent / "shelved" / "fonts" / "Cinzel-Black.ttf"
S = 4                                   # draw large, then shrink, for clean edges
size = 180 * S
img = Image.new("RGB", (size, size), "#0a0908")
d = ImageDraw.Draw(img)
font = ImageFont.truetype(str(ttf), 78 * S)
text, gap = "KW", 6 * S
widths = [d.textlength(ch, font=font) for ch in text]
x = (size - (sum(widths) + gap * (len(text) - 1))) / 2
box = d.textbbox((0, 0), text, font=font)
top, bottom = box[1], box[3]
rule_gap, rule_h, rule_w = 12 * S, 4 * S, 34 * S
y = (size - ((bottom - top) + rule_gap + rule_h)) / 2 - top
for ch, w in zip(text, widths):
    d.text((x, y), ch, font=font, fill="#f2ede5"); x += w + gap
ry = y + bottom + rule_gap
d.rectangle([(size - rule_w) / 2, ry, (size + rule_w) / 2, ry + rule_h], fill="#a8322c")
out = here / "out"; out.mkdir(exist_ok=True)
img.resize((180, 180), Image.LANCZOS).save(out / "tracker-icon.png", optimize=True)
print(out / "tracker-icon.png")
