# Бичлэгт шигтгэх брэнд тэмдэг: QR (системийн танилцуулга) + лого + «Смарт Зууч · Virtual POV Tour технологи».
# Ажиллуулах: python tools/brand/video_badge.py [URL]  → public/brand/video-badge.png (тунгалаг дэвсгэртэй)
# Домэйн солигдвол URL-аа өгч дахин үүсгэнэ.
import sys, os
import qrcode
from PIL import Image, ImageDraw, ImageFont

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://zuuch-production.up.railway.app/?ref=video'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
F = 'C:/Windows/Fonts/' if os.name == 'nt' else '/usr/share/fonts/truetype/'
bold = ImageFont.truetype(F + 'segoeuib.ttf', 64); reg = ImageFont.truetype(F + 'segoeui.ttf', 36); sm = ImageFont.truetype(F + 'segoeuib.ttf', 30)

H, PAD, Q = 236, 22, 192
q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=1); q.add_data(URL); q.make(fit=True)
n = q.modules_count + 4; q.box_size = Q // n  # бүхэл пиксел модуль — уншигдах чадвар
qr = q.make_image(fill_color='#0B1220', back_color='white').convert('RGBA')
QW = qr.size[0]
logo = Image.open(os.path.join(ROOT, 'public', 'brand', 'icon-512.png')).convert('RGBA').resize((84, 84), Image.LANCZOS)

lines = [('Смарт Зууч', bold, '#FFFFFF'), ('Virtual POV Tour технологи', reg, '#D7E3F7'), ('ЗӨВХӨН СМАРТ ЗУУЧ СИСТЕМД', sm, '#5AB0FF')]
tmp = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
tw = max(tmp.textlength(t, font=f) + (96 if i == 0 else 0) for i, (t, f, _) in enumerate(lines))
W = int(PAD + Q + 28 + tw + PAD + 10)
img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, W - 1, H - 1], radius=30, fill=(11, 18, 32, 178), outline=(255, 255, 255, 70), width=2)
bgq = Image.new('RGBA', (Q, Q), (255, 255, 255, 255)); bgq.alpha_composite(qr, ((Q - QW) // 2, (Q - QW) // 2)); img.alpha_composite(bgq, (PAD, (H - Q) // 2))
x = PAD + Q + 28
img.alpha_composite(logo, (x - 6, 20)); d.text((x + 90, 22), lines[0][0], font=bold, fill=lines[0][2])
d.text((x, 118), lines[1][0], font=reg, fill=lines[1][2]); d.text((x, 168), lines[2][0], font=sm, fill=lines[2][2])
out = os.path.join(ROOT, 'public', 'brand', 'video-badge.png'); img.save(out, optimize=True); print(out, img.size)
