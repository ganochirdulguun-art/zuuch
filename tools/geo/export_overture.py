# -*- coding: utf-8 -*-
"""«Зууч» хотын хавтан сан — Overture GeoParquet → хавтан бүтээгчийн оролт.
Хэрэглээ: python export_overture.py <raw_dir>
  <raw_dir>/ov_buildings.parquet, ov_places.parquet  (overturemaps CLI: download --bbox=... -f geoparquet)
Гаралт:
  <raw_dir>/ov_b.ndjson          барилга бүр нэг мөр: {i, r:[[lng,lat],...] гадна цагираг(ууд), c, s, f, h, n, w}
  <raw_dir>/ov_places_city.geojson   places (POI шинжилгээнд)
  <raw_dir>/ov_bnamed_city.geojson   нэртэй/ангилалтай барилгууд (POI шинжилгээнд)
"""
import json, os, sys
import pyarrow.parquet as pq
from shapely import wkb

RAW = sys.argv[1]

def rings(geom):
    if geom.geom_type == 'Polygon': return [list(geom.exterior.coords)]
    if geom.geom_type == 'MultiPolygon': return [list(p.exterior.coords) for p in geom.geoms]
    return []

def osm_way(sources):
    for s in sources or []:
        if s and s.get('dataset') == 'OpenStreetMap':
            rid = s.get('record_id') or ''
            if rid.startswith('w'):
                try: return int(rid[1:].split('@')[0])
                except ValueError: return 0
    return 0

def ml(sources):
    return bool(sources) and not any(s and s.get('dataset') == 'OpenStreetMap' for s in sources)

t = pq.read_table(os.path.join(RAW, 'ov_buildings.parquet'), columns=['id', 'names', 'sources', 'height', 'num_floors', 'subtype', 'class', 'geometry', 'is_underground'])
n = 0; named = []
with open(os.path.join(RAW, 'ov_b.ndjson'), 'w', encoding='utf-8') as out:
    for b in t.to_pylist():
        if b.get('is_underground'): continue
        g = wkb.loads(b['geometry']); rs = rings(g)
        if not rs: continue
        names = b.get('names') or {}; nm = names.get('primary')
        cm = names.get('common')  # pyarrow map → [(хэл, нэр), …] эсвэл dict
        if not nm and cm: nm = (list(cm.values())[0] if isinstance(cm, dict) else cm[0][1])
        rec = {'i': b['id'], 'r': [[[round(x, 7), round(y, 7)] for x, y in r] for r in rs]}
        if b.get('class'): rec['c'] = b['class']
        if b.get('subtype'): rec['s'] = b['subtype']
        if b.get('num_floors'): rec['f'] = b['num_floors']
        if b.get('height'): rec['h'] = round(b['height'], 1)
        if nm: rec['n'] = nm
        w = osm_way(b.get('sources'))
        if w: rec['w'] = w
        elif ml(b.get('sources')): rec['m'] = 1
        out.write(json.dumps(rec, ensure_ascii=False, separators=(',', ':')) + '\n'); n += 1
        if nm or b.get('class') or b.get('subtype'):
            named.append({'type': 'Feature', 'id': b['id'], 'geometry': json.loads(json.dumps(g.__geo_interface__)),
                          'properties': {'names': b.get('names'), 'class': b.get('class'), 'subtype': b.get('subtype'), 'num_floors': b.get('num_floors'), 'height': b.get('height'), 'sources': b.get('sources')}})
print('buildings', n, 'named/classed', len(named))
json.dump({'type': 'FeatureCollection', 'features': named}, open(os.path.join(RAW, 'ov_bnamed_city.geojson'), 'w', encoding='utf-8'), ensure_ascii=False, default=str)

p = pq.read_table(os.path.join(RAW, 'ov_places.parquet'))
feats = []
for r in p.to_pylist():
    g = wkb.loads(r.pop('geometry')); r.pop('bbox', None)
    feats.append({'type': 'Feature', 'id': r.get('id'), 'geometry': json.loads(json.dumps(g.__geo_interface__)), 'properties': r})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(RAW, 'ov_places_city.geojson'), 'w', encoding='utf-8'), ensure_ascii=False, default=str)
print('places', len(feats))
