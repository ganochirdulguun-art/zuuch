# Хотын гадаах орчны өгөгдлийн сан (Улаанбаатар)

500×500 м хавтангаар хадгалсан, гадаах орчны 3D аялал (`exterior.generate`) болон алхалтын хүртээмжид (`/api/geo/access`) ашиглагдах өгөгдөл.
Хамрах хүрээ: уртраг 106.64–107.14°, өргөрөг 47.83–48.01°.

| Файл | Агуулга |
|---|---|
| `index.json` | хавтангийн сүлжээ, хавтан бүрийн тоо, эх сурвалж, бүтээсэн огноо |
| `t/<i>_<j>.json.gz` | хавтан: OSM зам/талбай (цэгийн id-тай), мод/орц, OSM орчны цэг, Overture барилга, нэгтгэсэн орчны цэг |
| `ghsl.json.gz` | барилгын дундаж өндөр (≈90 м нүд) |
| `access.json`, `access.bin.gz` | Ш2: 50 м нүд бүрт ангилал бүрийн хамгийн ойр байгууллага хүртэлх явган замын зай |
| `sat.json`, `trees.bin.gz` | хиймэл дагуулын сүлжээ (≈10 м) ба ESA WorldCover модны маск (uint8, баруун-хойд булангаас) |
| `../../public/geo/s2/<i>_<j>.jpg` | Sentinel-2 бодит өнгөт газрын дэвсгэр, 2 км хавтан (3D үзэгч шууд ачаална) |
| `overrides.json` | оршин суугч/агентын баталсан барилгын засвар (давхар, төрөл, дээврийн тоглоомын талбай) — гараар засна |

## Эх сурвалж ба лиценз

- © OpenStreetMap contributors — ODbL-1.0 (Overpass API-аар татсан)
- Overture Maps Foundation, release 2026-09-23.1 — Buildings (ODbL-1.0: OSM + Microsoft/Google ML контур), Places (CDLA-Permissive-2.0), Base (ODbL-1.0)
- GHS-BUILT-H ANBH E2018 R2023A — European Commission, Joint Research Centre (CC BY 4.0)
- Contains modified Copernicus Sentinel data 2025 — Sentinel-2 L2A (48UXU, 2025-09-25), Copernicus open licence: газрын дэвсгэр ба ≥ 250 м² барилгын дээврийн өнгө (10 м нарийвчлал — ойролцоо)
- ESA WorldCover 2021 v200 — © ESA WorldCover project / Contains modified Copernicus Sentinel data (2021), CC BY 4.0: модны бүрхэвч

Google-ийн өгөгдөл ашиглаагүй. Түгжрэлийн судалгааг (Google Routes) хавтан санд оруулаагүй — объект бүрт хүсэлтээр тооцно.

## Дахин бүтээх

```
python tools/geo/export_overture.py <raw>      # Overture GeoParquet → оролт
python tools/geo/poi_osm_city.py <raw>         # OSM орчны цэг
python tools/geo/poi_overture_city.py <raw>    # Overture орчны цэг
node   tools/geo/poi_merge_city.js <raw>       # нэгтгэл
python tools/geo/build_sat.py <raw> .          # Sentinel-2 + WorldCover → public/geo/s2, data/geo/sat.json, trees.bin.gz, <raw>/roof_colors.json (rasterio)
node   tools/geo/build_tiles.js <raw>          # → data/geo
node   tools/geo/build_access.js               # → data/geo/access.*
node   tools/geo/validate.js <lat> <lng> [жишиг.json]
```
`<raw>` = Overture татсан файлууд (`overturemaps download --bbox=106.64,47.83,107.14,48.01 -f geoparquet -t building|place`, `-f geojson -t land_use|infrastructure|division_area`), `osm/` (Overpass: зам, талбай, орчны цэг), `ghsl_city.json`.
