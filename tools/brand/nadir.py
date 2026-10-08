# 360 (equirectangular) бичлэг, зурагт хөлийн доор (nadir) тавих «Смарт Зууч» дугуй лого.
# Доош харахад тэгш дугуй харагдахаар: equirect-ийн доод туузын пиксел бүрийг гномон проекцоор (y = -1 хавтгай) дугуй лого руу буулгана.
# Ажиллуулах: python tools/brand/nadir.py  → public/brand/nadir-disc.png (дугуй), public/brand/nadir-3840.png (3840 өргөн тууз)
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
F = 'C:/Windows/Fonts/' if os.name == 'nt' else '/usr/share/fonts/truetype/'
S = 1024                    # дугуй логоны хэмжээ
ALPHA = 17.0                # дугуйн өнцгийн радиус (градус) — савааг нууж, хэт том биш
W, H = 3840, 1920           # манай 360 гаралтын хэмжээ (бусад өргөнд масштаблана)

# 1) Дугуй лого (тунгалаг дэвсгэр)
disc = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(disc)
d.ellipse([0, 0, S - 1, S - 1], fill=(11, 18, 32, 242))
d.ellipse([22, 22, S - 23, S - 23], outline=(90, 176, 255, 255), width=10)
logo = Image.open(os.path.join(ROOT, 'public', 'brand', 'icon-512.png')).convert('RGBA').resize((330, 330), Image.LANCZOS)
disc.alpha_composite(logo, ((S - 330) // 2, 205))
f1 = ImageFont.truetype(F + 'segoeuib.ttf', 112); f2 = ImageFont.truetype(F + 'segoeui.ttf', 56)
for txt, fnt, y, col in [('Смарт Зууч', f1, 560, (255, 255, 255, 255)), ('Virtual Tour (POV)', f2, 705, (174, 205, 245, 255))]:
    w = d.textlength(txt, font=fnt); d.text(((S - w) / 2, y), txt, font=fnt, fill=col)
disc.save(os.path.join(ROOT, 'public', 'brand', 'nadir-disc.png'), optimize=True)

# 2) Equirect тууз: 2× дээж авч (anti-alias) буулгана
SS = 2; band = int(round(H * ALPHA / 180.0)) + 2
u = (np.arange(W * SS) + 0.5) / (W * SS); v = (np.arange(band * SS) + 0.5) / (H * SS)
lon = u * 2 * math.pi - math.pi; lat = math.pi / 2 - (1 - band / H + v) * math.pi
LON, LAT = np.meshgrid(lon, lat)
x = np.cos(LAT) * np.sin(LON); y = np.sin(LAT); z = np.cos(LAT) * np.cos(LON)
R = math.tan(math.radians(ALPHA)); with_np = np.errstate(divide='ignore', invalid='ignore')
with with_np:
    px = x / (-y); pz = z / (-y)
# Урагш (lon=0, +z) харж байгаад доош харахад бичиг зөв уншигдана: дээд тал = +z, баруун = +x
dx = (px / R + 1) / 2 * S; dy = (1 - pz / R) / 2 * S
arr = np.asarray(disc).astype(np.float32)
ix = np.clip(dx, 0, S - 1).astype(np.int32); iy = np.clip(dy, 0, S - 1).astype(np.int32)
out = arr[iy, ix]; out[(px ** 2 + pz ** 2) > R ** 2] = 0; out[y >= 0] = 0
img = Image.fromarray(out.astype(np.uint8), 'RGBA').resize((W, band), Image.LANCZOS)
img.save(os.path.join(ROOT, 'public', 'brand', 'nadir-3840.png'), optimize=True)
print('band', W, 'x', band)
