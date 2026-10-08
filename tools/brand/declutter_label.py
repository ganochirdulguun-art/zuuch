# Виртуал цэгцлэлт хийсэн зурагт заавал шигтгэх ил тод шошго: лого + «Смарт Зууч · виртуал цэгцлэлт»
# Ажиллуулах: python tools/brand/declutter_label.py → public/brand/declutter-label.png
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
F = 'C:/Windows/Fonts/' if os.name == 'nt' else '/usr/share/fonts/truetype/'
b = ImageFont.truetype(F + 'segoeuib.ttf', 46); r = ImageFont.truetype(F + 'segoeui.ttf', 46)
t1, t2 = 'Смарт Зууч', ' · виртуал цэгцлэлт'
tmp = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
H, PAD, LG = 92, 18, 62
W = int(PAD + LG + 14 + tmp.textlength(t1, font=b) + tmp.textlength(t2, font=r) + PAD + 6)
img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, W - 1, H - 1], radius=22, fill=(11, 18, 32, 170), outline=(255, 255, 255, 60), width=2)
logo = Image.open(os.path.join(ROOT, 'public', 'brand', 'icon-512.png')).convert('RGBA').resize((LG, LG), Image.LANCZOS)
img.alpha_composite(logo, (PAD, (H - LG) // 2))
x = PAD + LG + 14; d.text((x, 16), t1, font=b, fill=(255, 255, 255, 255)); d.text((x + tmp.textlength(t1, font=b), 16), t2, font=r, fill=(214, 228, 248, 255))
out = os.path.join(ROOT, 'public', 'brand', 'declutter-label.png'); img.save(out, optimize=True); print(out, img.size)
