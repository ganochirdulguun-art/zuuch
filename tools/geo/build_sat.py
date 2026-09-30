# -*- coding: utf-8 -*-
"""«Зууч» хотын хавтан сан — нээлттэй хиймэл дагуулын өгөгдөл (Sentinel-2 10 м, ESA WorldCover 10 м).
Хэрэглээ: python build_sat.py <raw_dir> <repo_dir>
  1) Газрын дэвсгэр: Sentinel-2 L2A бодит өнгө (TCI) → EPSG:4326 сүлжээ (~10 м) → public/geo/s2/<i>_<j>.jpg (2 км хавтан) + data/geo/sat.json
  2) Дээврийн бодит өнгө: ≥ 250 м² барилгын дээврийн дотор талын (ирмэгээс 5 м) пикселийн медиан → <raw_dir>/roof_colors.json (Overture id → #rrggbb)
  3) Мод: WorldCover «Tree cover» (10) нүд → data/geo/trees.bin.gz (uint8 маск, sat.json-ийн сүлжээгээр)
Лиценз: Contains modified Copernicus Sentinel data 2025 (Copernicus open licence); ESA WorldCover 2021 v200 (CC BY 4.0).
"""
import json, os, sys, gzip, math
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
import shapely
from shapely.geometry import Polygon
from PIL import Image

RAW, REPO = sys.argv[1], sys.argv[2]
S2 = '/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/48/U/XU/2025/9/S2C_48UXU_20250925_0_L2A/TCI.tif'
WC = '/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N45E105_Map.tif'
W0, S0, E0, N0 = 106.64, 47.83, 107.14, 48.01
DX, DY = 0.000134, 0.00009          # ≈ 10.0 м × 10.0 м (47.9°)
NX, NY = int(round((E0 - W0) / DX)), int(round((N0 - S0) / DY))
DST = from_origin(W0, N0, DX, DY)
os.environ.setdefault('GDAL_HTTP_MAX_RETRY', '4'); os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')

def warp(src_path, bands, resampling, dtype):
    with rasterio.open(src_path) as src:
        out = np.zeros((len(bands), NY, NX), dtype=dtype)
        for k, b in enumerate(bands):
            reproject(rasterio.band(src, b), out[k], dst_transform=DST, dst_crs='EPSG:4326', resampling=resampling)
    return out

print('Sentinel-2 TCI …', NX, 'x', NY)
tci = warp(S2, [1, 2, 3], Resampling.bilinear, np.uint8)
np.save(os.path.join(RAW, 's2_tci.npy'), tci)
print('WorldCover …')
wc = warp(WC, [1], Resampling.nearest, np.uint8)[0]
np.save(os.path.join(RAW, 'wc.npy'), wc)

# Өнгөний засвар: TCI-ийн манан/ногоовтор өнгийг бага зэрэг арилгаж, 3D-ийн өнгөтэй зохицуулна (цагаан тэнцвэр + гамма + ханалт)
f = tci.astype(np.float32) / 255.0
f = np.clip((f - 0.035) / 0.9, 0, 1) ** 0.92
wb = np.array([1.03, 1.0, 0.95], np.float32)[:, None, None]; f = np.clip(f * wb, 0, 1)
lum = (0.3 * f[0] + 0.59 * f[1] + 0.11 * f[2])[None]; f = np.clip(lum + (f - lum) * 0.85, 0, 1)
rgb = (f * 255 + 0.5).astype(np.uint8)

# 1) 2 км хавтан (4×4 хотын 500 м хавтан) — JPEG
TI, TJ = 0.0268, 0.018
out_dir = os.path.join(REPO, 'public', 'geo', 's2'); os.makedirs(out_dir, exist_ok=True)
ni, nj = int(math.ceil((E0 - W0) / TI)), int(math.ceil((N0 - S0) / TJ)); n = 0
for i in range(ni):
    for j in range(nj):
        x0 = int(round((i * TI) / DX)); x1 = min(NX, int(round(((i + 1) * TI) / DX)))
        yN = int(round((N0 - (S0 + (j + 1) * TJ)) / DY)); yS = int(round((N0 - (S0 + j * TJ)) / DY))
        yN = max(0, yN); yS = min(NY, yS)
        if x1 <= x0 or yS <= yN: continue
        tile = rgb[:, yN:yS, x0:x1].transpose(1, 2, 0)
        Image.fromarray(tile).save(os.path.join(out_dir, f'{i}_{j}.jpg'), quality=86, optimize=True); n += 1
meta = {'v': 1, 'bbox': [W0, S0, E0, N0], 'tile': [TI, TJ], 'ni': ni, 'nj': nj, 'px': [DX, DY], 'date': '2025-09-25',
        'source': 'Contains modified Copernicus Sentinel data 2025 (Sentinel-2 L2A, 48UXU)', 'trees': 'ESA WorldCover 2021 v200 (CC BY 4.0)'}
json.dump(meta, open(os.path.join(REPO, 'data', 'geo', 'sat.json'), 'w'))
json.dump(meta, open(os.path.join(out_dir, 'index.json'), 'w'))  # 3D үзэгч (public) хавтангийн сүлжээг эндээс уншина
print('хавтан', n)

# 3) Мод (WorldCover 10 = Tree cover) — маск
tree = (wc == 10).astype(np.uint8)
open(os.path.join(REPO, 'data', 'geo', 'trees.bin.gz'), 'wb').write(gzip.compress(tree.tobytes(), 9))
print('модтой нүд', int(tree.sum()), 'нийт', tree.size)

# 2) Дээврийн өнгө
KX = math.cos(math.radians((S0 + N0) / 2)) * 111320.0; KZ = 110540.0
def to_px(lng, lat): return (lng - W0) / DX, (N0 - lat) / DY
res = {}; done = 0; skipped = 0
with open(os.path.join(RAW, 'ov_b.ndjson'), encoding='utf-8') as fh:
    for line in fh:
        b = json.loads(line); ring = b['r'][0]
        lat0 = ring[0][1]; lng0 = ring[0][0]
        P = [((x - lng0) * KX, (y - lat0) * KZ) for x, y in ring]
        try: poly = Polygon(P)
        except Exception: continue
        if not poly.is_valid or poly.area < 250: continue
        inner = poly.buffer(-5.0)
        cand = inner if (not inner.is_empty and inner.area > 1) else None
        if cand is None:
            if poly.minimum_rotated_rectangle.length / 2 < 1: continue
            rp = poly.representative_point(); pts = [(rp.x, rp.y)]
        else:
            minx, minz, maxx, maxz = cand.bounds
            gx, gz = np.meshgrid(np.arange(minx + 2.5, maxx, 5.0), np.arange(minz + 2.5, maxz, 5.0))
            gx, gz = gx.ravel(), gz.ravel(); m = shapely.contains_xy(cand, gx, gz) if gx.size else np.zeros(0, bool)
            pts = list(zip(gx[m], gz[m]))
            if not pts: rp = cand.representative_point(); pts = [(rp.x, rp.y)]
        cols = []
        for xx, zz in pts[:200]:
            lng = lng0 + xx / KX; lat = lat0 + zz / KZ; px, py = to_px(lng, lat); ix, iy = int(px), int(py)
            if 0 <= ix < NX and 0 <= iy < NY: cols.append(rgb[:, iy, ix])
        if not cols: skipped += 1; continue
        c = np.median(np.array(cols), axis=0).astype(int)
        res[b['i']] = '#%02x%02x%02x' % tuple(int(v) for v in c); done += 1
json.dump(res, open(os.path.join(RAW, 'roof_colors.json'), 'w'))
print('дээврийн өнгө', done, 'алгассан', skipped)
