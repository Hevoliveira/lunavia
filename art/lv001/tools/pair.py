import sys
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
views = sys.argv[3].split(",")
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
rows = []
for v in views:
    ims = []
    for m in ("a", "b"):
        im = Image.open(f"{d}/{m}{v}.png").convert("RGB")
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        dr = ImageDraw.Draw(im)
        t = f"{'A  current' if m == 'a' else 'B  Blender prototype'}  ·  view {v}"
        dr.rectangle((0, 0, dr.textlength(t, font=f) + 12, 26), fill=(0, 0, 0))
        dr.text((6, 3), t, font=f, fill=(255, 255, 255))
        ims.append(im)
    rows.append(ims)
W = rows[0][0].width
H = rows[0][0].height
m = Image.new("RGB", (W * 2 + 6, (H + 6) * len(rows)), (40, 40, 40))
for i, (a, b) in enumerate(rows):
    m.paste(a, (0, i * (H + 6)))
    m.paste(b, (W + 6, i * (H + 6)))
m.save(out, quality=88)
