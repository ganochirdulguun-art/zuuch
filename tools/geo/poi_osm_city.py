# «Зууч» хотын хавтан сан — OSM орчны цэгийг хэвийн болгох (osmpoi/normalize.py-аас; хотын хэмжээнд: сүлжээт бүлэглэл)
# Хэрэглээ: python poi_osm_city.py <raw_dir>   (<raw_dir>/osm/poi_*.json — Overpass «out center tags»)
import json, re, math, collections, sys, os, glob
SCR = sys.argv[1]
js = {"elements": []}; _seen = set(); OSM_BASE = None
for _f in sorted(glob.glob(os.path.join(SCR, "osm", "poi_*.json"))):
    _j = json.load(open(_f, encoding="utf-8")); OSM_BASE = OSM_BASE or _j.get("osm3s", {}).get("timestamp_osm_base")
    for _e in _j.get("elements", []):
        _k = (_e["type"], _e["id"])
        if _k not in _seen: _seen.add(_k); js["elements"].append(_e)
lat0, lng0 = 47.9187, 106.9176  # хотын төв (зөвхөн эрэмбэлэх зайд)
kx = math.cos(math.radians(lat0)) * 111320; kz = 110540
EX, EZ = 0.0, 0.0
R = re.compile
I = re.I
SPEC_RE = R(r"цэцэрлэг|сургууль|лицей|гимнази|цогцолбор|их сургууль|коллеж|эмнэлэг|поликлиник|өрхийн|эмийн сан|дэлгүүр|маркет|супермаркет|(?<!\w)зах(?!\w)|худалдааны төв|буудал", I)
EXTRA_RE = R(r"клиник|эрүүл мэнд|hospital|clinic|medical|медикал|шүдний|dent|сувилал|аптек|pharm|банк|\bbank|цагдаа|police|хороо(?!л)|засаг дарга|соёлын|ордон|театр|кино|cinema|музей|номын сан|фитнес|fitness|спорт|sport|заал|gym|boxing|бокс|биллиард|billiard|club|клуб|(?<!\w)төв(?!\w)|center|centre|центр|плаза|plaza|mall|mart|market|store|shop|ресторан|restaurant|кафе|cafe|coffee|цайны газар|зоогийн|хоолны|pub|паб|пуб|lounge|караоке|karaoke|салон|үсчин|угаалга|carwash|засвар|ломбард|game|тоглоом|саун|сүм|хийд|mosque|church|temple|school|kindergarten|university|college|institute|академи|hotel|зочид|unitel|юнитэл|skytel|mobicom|мобиком", I)
TRIVIAL_AM = {"bench", "waste_basket", "waste_disposal", "recycling", "vending_machine", "bicycle_parking", "parking_entrance", "parking_space", "telephone", "clock",
              "drinking_water", "fountain", "shower", "grit_bin", "post_box", "motorcycle_parking", "loading_dock", "smoking_area", "water_point", "hunting_stand",
              "compressed_air", "letter_box", "toilets"}
FAC_BLD = {"school", "kindergarten", "university", "college", "hospital", "retail", "commercial", "supermarket", "shopping", "mall", "market", "shop", "kiosk", "public",
           "civic", "government", "temple", "church", "mosque", "cathedral", "chapel", "hotel", "sports_hall", "stadium", "train_station", "transportation", "service",
           "office", "clinic", "pharmacy", "fire_station", "police"}
RES_BLD = {"apartments", "residential", "house", "detached", "dormitory", "terrace", "ger", "garage", "garages", "construction", "hut", "shed", "roof", "industrial", "warehouse"}
RES_NAME = R(r"^\s*[\d/\-\.\sА-Яа-яA-Za-zӨөҮү]{0,6}\s*$|байр\b|хотхон|residence|apartment|apt\b|таун|town|хороолол|house|хаус|цамхаг|tower|граж|гараж|garage|орон сууц|зүлэг|далан|хоолой|substation|худаг", I)
HIGHER_ED = R(r"(дээд сургууль|их сургууль|институт|коллеж|university|college|institute|академи|лахь)", I)
GENERAL_ED = R(r"(дунд сургууль|бага сургууль|ахлах сургууль|ерөнхий боловсрол|ЕБС|цогцолбор сургууль|secondary|high school|elementary|лицей|гимнази|\d+\s*-?\s*(р|дугаар|дүгээр)?\s*сургууль)", I)
TRAINING = R(r"авто сургууль|auto surguuli|driving|жолооч|жолооны|сургалтын төв|сургалтын газар|курс(?!\w)|ballet|балет|бүжгийн|language school|хэлний сургалт", I)
KINDER = R(r"цэцэрлэг(?!т\s*хүрээлэн)|kindergarten|садик|tsetserleg|детский сад", I)
PARKNM = R(r"цэцэрлэгт\s*хүрээлэн|(?<!\w)парк(?!\w)|\bpark\b|амрах талбай", I)
SCHOOLNM = R(r"сургууль|лицей|гимнази|school|surguuli|(?<!\w)ЕБС(?!\w)", I)
HEALTHNM = R(r"эмнэлэг|поликлиник|өрхийн|клиник|эрүүл мэнд|hospital|clinic|medical|медикал|шүдний|dental|сувилал|оношилгоо|emneleg|(?<!\w)ЭМТ(?!\w)", I)
PHARMNM = R(r"эмийн сан|аптек|pharm|фарм", I)
GOVNM = R(r"khoroo|horoo|(?<!\w)хороо(?!л)|хорооны|засаг дарга|цагдаа|police|онцгой байдал|гал команд|шуудан|татвар|нотариат|шүүх(?!\w)|прокурор|хэлтэс", I)
BANKNM = R(r"банк|\bbank\b", I)
CULTNM = R(r"соёлын|ордон|театр|кино(?!\w)|cinema|theatre|музей|museum|номын сан|library", I)
SPORTNM = R(r"фитнес|fitness|спорт|sport|заал|gym|boxing|бокс|биллиард|billiard|бассейн|pool\b", I)
FOODNM = R(r"ресторан|restaurant|кафе|(?<!\w)cafe|coffee|цайны газар|зоогийн|хоолны|(?<!\w)pub(?!\w)|паб|пуб|lounge", I)
NIGHTNM = R(r"караоке|karaoke|клуб|club|\bbar\b", I)
WORSHNM = R(r"сүм(?!\w)|хийд|мечеть|mosque|church|temple|дуган", I)
HOTELNM = R(r"зочид буудал|hotel|буудал|hostel", I)
MALLNM = R(r"худалдааны төв|их дэлгүүр|их дэлүүр|(?<!\w)зах(?!\w)|захын|mall|плаза|plaza|megastore|мегастор|(?<!\w)төв(?!\w)|center|centre|центр|бөөний", I)
GROCNM = R(r"супермаркет|супер маркет|supermarket|маркет|market|(?<!\w)mart|март(?!\w)|хүнс|түц|minimarket|mini market|circle k|(?<!\w)cu(?!\w)|gs25|emart|e-mart|номин", I)
NONFOOD = R(r"барилг|гутал|гутлын|хувцас|тавилга|цахилгаан бараа|утас|оптик|нүдний шил|эмийн|электроник|компьютер|авто|сэлбэг|гоо сайхан|косметик|(?<!\w)ном(?!ин)|бичиг хэрэг", I)
SHOPNM = R(r"дэлгүүр|store|shop|бараа", I)
SERVNM = R(r"салон|үсчин|угаалга|carwash|засвар|хими цэвэрлэгээ|ломбард|game|тоглоом|саун|оёдол|ателье", I)
OFFICENM = R(r"\bllc\b|ххк|аудит|consult|телевиз|радио|business center|бизнес төв|\btv\b|unitel|юнитэл|skytel|mobicom|мобиком", I)
GROC_SHOPS = {"supermarket", "convenience", "greengrocer", "butcher", "deli", "dairy", "general", "food", "frozen_food", "kiosk", "beverages", "bakery", "confectionery",
              "seafood", "alcohol", "wine", "pastry", "farm", "health_food", "spices", "tea", "coffee", "water"}
AMAP = {"bank": "bank", "atm": "atm", "bureau_de_change": "atm", "post_office": "post", "police": "police", "fire_station": "fire", "townhall": "gov", "courthouse": "gov",
        "library": "culture", "place_of_worship": "worship", "monastery": "worship", "cafe": "cafe", "restaurant": "restaurant", "fast_food": "restaurant",
        "food_court": "restaurant", "ice_cream": "cafe", "pub": "nightlife", "bar": "nightlife", "nightclub": "nightlife", "biergarten": "nightlife",
        "karaoke_box": "nightlife", "cinema": "culture", "theatre": "culture", "arts_centre": "culture", "community_centre": "culture", "social_centre": "culture",
        "studio": "office", "fuel": "fuel", "charging_station": "fuel", "parking": "parking", "car_wash": "car", "vehicle_inspection": "car", "car_rental": "car",
        "car_sharing": "car", "veterinary": "vet", "social_facility": "social", "nursing_home": "social", "toilets": "other", "internet_cafe": "nightlife",
        "casino": "nightlife", "gambling": "nightlife", "public_bath": "service", "conference_centre": "culture", "events_venue": "culture", "exhibition_centre": "culture"}


def names(t):
    return " | ".join(v for k, v in t.items() if (k == "name" or k.startswith("name:") or k in ("official_name", "alt_name", "old_name", "short_name", "brand", "operator")))


def pname(t):
    for k in ("name", "name:mn", "official_name", "alt_name", "name:en", "brand", "operator"):
        if t.get(k): return t[k]
    return None


def edu_split(nm, default):
    if TRAINING.search(nm): return "training"
    if default == "school": return "college" if HIGHER_ED.search(nm) and not GENERAL_ED.search(nm) else "school"
    return "school" if GENERAL_ED.search(nm) and not HIGHER_ED.search(nm) else "college"


def cat_of(t):
    nm = names(t)
    am, sh, le, hc = t.get("amenity", ""), t.get("shop", ""), t.get("leisure", ""), t.get("healthcare", "")
    hw, pt, bd, lu = t.get("highway", ""), t.get("public_transport", ""), t.get("building", ""), t.get("landuse", "")
    tou, of = t.get("tourism", ""), t.get("office", "")
    # 1. хүчтэй таг
    if am in ("kindergarten", "childcare"): return "kinder", "tag:amenity"
    if am == "school": return edu_split(nm, "school"), "tag:amenity"
    if am in ("university", "college"): return edu_split(nm, "college"), "tag:amenity"
    if am in ("driving_school", "language_school", "music_school", "dancing_school", "training", "prep_school", "tutoring"): return "training", "tag:amenity"
    if am == "pharmacy" or hc == "pharmacy": return "pharmacy", "tag"
    if am in ("hospital", "clinic", "doctors", "dentist") or (hc and hc != "pharmacy"): return "health", "tag"
    if hw == "bus_stop" or pt in ("platform", "stop_position", "station", "stop_area") or am == "bus_station" or t.get("railway") in ("tram_stop", "station", "halt"):
        return "bus", "tag:transport"
    if am == "marketplace": return "mall", "tag:amenity"
    if sh in ("mall", "department_store"): return "mall", "tag:shop"
    if sh in GROC_SHOPS:
        if MALLNM.search(nm) and not GROCNM.search(nm): return "mall", "tag:shop+name"
        if NONFOOD.search(nm): return "shop", "tag:shop+name(nonfood)"
        return "grocery", "tag:shop"
    if sh: return "shop", "tag:shop"
    if le == "playground": return "playground", "tag:leisure"
    if le in ("park", "garden", "nature_reserve", "common", "dog_park"): return "park", "tag:leisure"
    if le in ("pitch", "sports_centre", "fitness_centre", "fitness_station", "stadium", "sports_hall", "swimming_pool", "track", "ice_rink", "horse_riding",
              "golf_course", "water_park"): return "sport", "tag:leisure"
    if am in ("community_centre", "townhall", "social_facility") and GOVNM.search(nm): return "gov", "tag:amenity+name"
    if am in ("social_facility", "studio") and FOODNM.search(nm): return "restaurant", "tag:amenity+name"
    if am in AMAP: return AMAP[am], "tag:amenity"
    # 2. нэрээр хүчтэй ангилал (таггүй / building=yes / office гэх мэт)
    if TRAINING.search(nm): return "training", "name"
    if KINDER.search(nm) or bd == "kindergarten": return "kinder", ("tag:building" if bd == "kindergarten" else "name")
    if PARKNM.search(nm) and not bd: return "park", "name"
    if SCHOOLNM.search(nm) or HIGHER_ED.search(nm) or bd in ("school", "university", "college") or lu == "education":
        base = "school" if (bd == "school" or SCHOOLNM.search(nm)) else "college"
        return edu_split(nm, base), ("tag:building" if bd in ("school", "university", "college") else "name")
    if PHARMNM.search(nm): return "pharmacy", "name"
    if HEALTHNM.search(nm) or bd in ("hospital", "clinic"): return "health", ("tag:building" if bd in ("hospital", "clinic") else "name")
    if GOVNM.search(nm): return ("police" if re.search(r"цагдаа|police", nm, I) else "gov"), "name"
    if am: return "amenity_other", "tag:amenity"
    if le: return "leisure_other", "tag:leisure"
    if t.get("craft"): return "service", "tag:craft"
    if tou in ("hotel", "hostel", "guest_house", "motel", "apartment", "chalet"): return "hotel", "tag:tourism"
    if tou: return "tourism", "tag:tourism"
    if of == "government": return "gov", "tag:office"
    if bd in ("temple", "church", "mosque", "cathedral", "chapel") or lu == "religious" or WORSHNM.search(nm): return "worship", "tag/name"
    if bd == "hotel" or HOTELNM.search(nm): return "hotel", "tag/name"
    if BANKNM.search(nm): return "bank", "name"
    if CULTNM.search(nm): return "culture", "name"
    if SPORTNM.search(nm): return "sport", "name"
    if FOODNM.search(nm): return "restaurant", "name"
    if NIGHTNM.search(nm): return "nightlife", "name"
    if re.search(r"(?<!\w)game|тоглоомын төв|биллиард|billiard", nm, I): return "service", "name(entertainment)"
    if re.search(r"(?<!\w)авто(?!\w)|auto(?!\w)|угаалга|carwash|car wash|засвар", nm, I) and not re.search(r"сургууль", nm, I): return "car", "name"
    if GROCNM.search(nm) and not NONFOOD.search(nm) and not re.search(r"их дэлгүүр|худалдааны төв", nm, I): return "grocery", "name"
    if MALLNM.search(nm) or bd in ("mall", "market"): return "mall", "name/tag"
    if SHOPNM.search(nm) or bd in ("shop", "kiosk", "retail", "supermarket", "shopping"): return "shop", "name/tag"
    if SERVNM.search(nm): return "service", "name"
    if of or OFFICENM.search(nm) or bd == "office": return "office", "tag/name"
    if bd in ("public", "civic", "government"): return "gov", "tag:building"
    if bd in ("commercial", "retail") or lu in ("retail", "commercial"): return "commercial", "tag:building/landuse"
    if re.search(r"цогцолбор", nm, I): return "complex", "name"
    return "other", "fallback"


def include(e):
    t = e.get("tags", {})
    if not t: return None
    if t.get("type") in ("route", "route_master", "boundary") or t.get("boundary") or t.get("place") or t.get("route"): return None
    am = t.get("amenity")
    if t.get("emergency") in ("assembly_point", "defibrillator", "fire_hydrant", "phone", "siren") and not am and not t.get("shop") and not t.get("building"): return None
    if am and am not in TRIVIAL_AM: return "amenity"
    for k in ("healthcare", "shop", "leisure", "tourism", "office", "craft", "club"):
        if t.get(k): return k
    if t.get("emergency") and t.get("emergency") not in ("no", "fire_hydrant", "defibrillator", "phone", "assembly_point", "siren"): return "emergency"
    if t.get("highway") == "bus_stop" or t.get("public_transport") or t.get("railway") in ("tram_stop", "station", "halt"): return "transport"
    bd = t.get("building")
    if bd in FAC_BLD: return "building"
    if t.get("landuse") in ("retail", "commercial", "education", "religious"): return "landuse"
    nm = names(t)
    if not nm: return None
    if SPEC_RE.search(nm): return "name_spec"
    if t.get("highway") or t.get("natural") or t.get("power"): return None
    if t.get("man_made") in ("mast", "tower", "water_tower", "pipeline") and not EXTRA_RE.search(nm): return None
    if EXTRA_RE.search(nm): return "name_extra"
    if t.get("landuse") or t.get("area") == "yes": return None
    if bd in RES_BLD or RES_NAME.search(t.get("name", "")): return None
    return "name_other"  # бусад нэртэй (оршин суугчийн бус) барилга/цэг


out = []; excluded = collections.Counter()
for e in js["elements"]:
    why = include(e)
    t = e.get("tags", {})
    if not why:
        excluded["building" if t.get("building") else "highway" if t.get("highway") else "other"] += 1
        continue
    if "lat" in e: la, lo = e["lat"], e["lon"]
    elif e.get("center"): la, lo = e["center"]["lat"], e["center"]["lon"]
    else: continue
    cat, basis = cat_of(t)
    x = (lo - lng0) * kx; z = (lat0 - la) * kz
    nm = pname(t)
    rec = {"name": nm, "cat_guess": cat, "lat": round(la, 7), "lng": round(lo, 7), "src": "osm", "id": f"{e['type']}/{e['id']}",
           "tags": t, "x": round(x, 1), "z": round(z, 1), "dist_m": round(math.hypot(x, z)), "dist_entr_m": round(math.hypot(x - EX, z - EZ)),
           "why": why, "cat_basis": basis, "osm_url": f"https://www.openstreetmap.org/{e['type']}/{e['id']}", "osm_base": OSM_BASE}
    if cat in ("kinder", "school") and nm:
        m = (re.search(r"(\d{1,3})\s*[-–]?\s*(?:р|дугаар|дүгээр|r)?\s*(?:дунд\s*|ахлах\s*|бага\s*)?(?:цэцэрлэг|сургууль|school|kinder|tsetserleg)", names(t), I)
             or re.search(r"(?:№|No\.?|#)\s*(\d{1,3})", names(t), I))
        if m: rec["num"] = int(m.group(1))
    out.append(rec)


def nkey(s):
    s = (s or "").lower()
    s = re.sub(r"[\"'«»“”.,()\-–_]", " ", s); s = re.sub(r"(?<=\d)\s*(р|дугаар|дүгээр)\b", "", s); s = re.sub(r"\s+", " ", s).strip()
    return s


# --- бүлэглэл: нэг байгууллагын давхардсан объект (барилга + amenity полигон, node + way г.м.)
par = list(range(len(out)))
gnums = [({out[i]["num"]} if out[i].get("num") else set()) for i in range(len(out))]
def f(a):
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
def u(a, b):
    ra, rb = f(a), f(b)
    if ra == rb: return
    if gnums[ra] and gnums[rb] and gnums[ra] != gnums[rb]: return  # өөр дугаартай цэцэрлэг/сургуулийг нийлүүлэхгүй
    par[ra] = rb; gnums[rb] |= gnums[ra]
EDU = {"kinder", "school", "college", "health", "mall", "training"}
N = len(out)
CELL = 250.0; grid = collections.defaultdict(list)
for i in range(N): grid[(int(out[i]["x"] // CELL), int(out[i]["z"] // CELL))].append(i)
def near(i, R):
    a = out[i]; ci, cj = int(a["x"] // CELL), int(a["z"] // CELL); k = int(math.ceil(R / CELL))
    for di in range(-k, k + 1):
        for dj in range(-k, k + 1):
            for j in grid.get((ci + di, cj + dj), ()): yield j
for i in range(N):
    a = out[i]
    if not a["name"]: continue
    for j in near(i, 250):
        if j <= i: continue
        b = out[j]
        if not b["name"] or a["cat_guess"] != b["cat_guess"]: continue
        d = math.hypot(a["x"] - b["x"], a["z"] - b["z"])
        if d > 250: continue
        if a.get("num") and a.get("num") == b.get("num") and a["cat_guess"] in ("kinder", "school"): u(i, j); continue
        if nkey(a["name"]) == nkey(b["name"]) and d < 150 and a["cat_guess"] not in ("bus", "parking", "atm", "pharmacy", "grocery", "shop"): u(i, j); continue
        if a["cat_guess"] == "bus" and nkey(a["name"]) == nkey(b["name"]) and d < 25: u(i, j); continue
# нэргүй боловсрол/эмнэлгийн объектыг 60 м доторх хамгийн ойр нэртэй ижил ангиллынхтай холбоно (гинжлэхгүй)
for i in range(N):
    a = out[i]
    if a["name"] or a["cat_guess"] not in EDU: continue
    best, bd = None, 60
    for j in near(i, 60):
        b = out[j]
        if not b["name"] or b["cat_guess"] != a["cat_guess"]: continue
        d = math.hypot(a["x"] - b["x"], a["z"] - b["z"])
        if d < bd: best, bd = j, d
    if best is not None: u(i, best)
groups = collections.defaultdict(list)
for i in range(N): groups[f(i)].append(i)
for g, idx in groups.items():
    best = max(idx, key=lambda k: (bool(out[k]["name"]), "amenity" in out[k]["tags"] or "shop" in out[k]["tags"] or "highway" in out[k]["tags"], len(out[k]["tags"]), -out[k]["dist_m"]))
    gid = out[best]["id"]; gmin = min(out[k]["dist_m"] for k in idx)
    for k in idx:
        out[k]["group"] = gid; out[k]["primary"] = (k == best); out[k]["group_size"] = len(idx); out[k]["group_min_dist_m"] = gmin
out.sort(key=lambda r: r["dist_m"])
json.dump(out, open(os.path.join(SCR, "poi_osm.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
meta = {"source": "OpenStreetMap via Overpass API", "endpoint": "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "osm_base": OSM_BASE,
        "license": "ODbL 1.0 — © OpenStreetMap contributors", "query_file": "tools/geo (osm_fetch poi)", "raw": "osm/poi_*.json", "radius_m": None,
        "center": [lat0, lng0], "count": len(out), "groups": len(groups), "excluded_elements": dict(excluded),
        "by_cat": dict(collections.Counter(r["cat_guess"] for r in out).most_common()),
        "by_cat_primary": dict(collections.Counter(r["cat_guess"] for r in out if r["primary"]).most_common()),
        "by_why": dict(collections.Counter(r["why"] for r in out).most_common())}
json.dump(meta, open(os.path.join(SCR, "poi_osm.meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({k: meta[k] for k in ("count", "groups", "by_cat_primary")}, ensure_ascii=False))
