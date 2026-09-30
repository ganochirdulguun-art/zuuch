# -*- coding: utf-8 -*-
"""Overture Maps (release 2026-09-23.1) -> resident-relevant POI list for Zuuch exterior tour.
Inputs (downloaded with the `overturemaps` CLI, bbox 106.8585,47.9130,106.9015,47.9420):
  ov_places.geojson          places theme   (Meta / Foursquare / Microsoft / AllThePlaces, CDLA-Permissive-2.0)
  ov_buildings_full.geojson  buildings theme (OSM ODbL-1.0 + ML footprints) - named / classed buildings only
  ov_land_use.geojson        base/land_use   (OSM ODbL-1.0)
  ov_infrastructure.geojson  base/infrastructure (OSM ODbL-1.0) - bus stops, ATMs
  ov_divarea.geojson         divisions/division_area - district polygons (address sanity check)
Output: poi_overture.json  (list of dicts, one per POI; see README in notes)
"""
import json, math, re, collections, os, sys
from shapely.geometry import shape, Point

HERE = sys.argv[1]  # «Зууч» хотын хавтан сан: <raw_dir> (build_poi_overture.py-аас, хотын хэмжээнд)
RELEASE = '2026-09-23.1'
LAT0, LNG0 = 47.9187, 106.9176  # хотын төв (зөвхөн эрэмбэлэх зайд)
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110540.0

def local(lat, lng):
    return (lng - LNG0) * KX, (LAT0 - lat) * KZ

def load(fn):
    with open(os.path.join(HERE, fn), encoding='utf-8') as f:
        return json.load(f)['features']

# ---------------- name rules ----------------
I = re.I
R_PARK_STRONG = re.compile(r'цэцэрлэгт\s*хүрээлэн|(?<![а-яөүё])төгөл(?![а-яөүё])|ногоон байгууламж', I)
R_PLAY = re.compile(r'тоглоомын\s*(талбай|төв)|playground|play\s?land|jungle', I)
R_PLAY_NOT = re.compile(r'дэлгүүр|store|shop', I)
R_DENTAL = re.compile(r'шүд|шvд|dental|\bdent\b|дент\b|тэргэлдент|orthodon|стоматолог', I)
R_PHARM = re.compile(r'эмийн\s*сан|\bem\s?san|emiin\s?san|pharmacy|аптек|apteka|эм хангамж|фарм\b|фарммаркет', I)
R_HIGH_STRONG = re.compile(r'дээд\s*сургуул|их\s*сургуул|deed\s*surguul|ikh\s*surguul|university|college|коллеж|политехник|polytechnic|'
                           r'\bМУИС|ШУТИС|АШУҮИС|ЭМШУИС|МУБИС|СЭЗИС|МҮИС|\bСУИС|МХТДС|conservator|консерватори|сувилахуйн сургууль|биоанагаах', I)
R_HIGH_WEAK = re.compile(r'институт|institute|тэнхим|факультет|faculty', I)
R_KINDER = re.compile(r'цэцэрлэг(?!т)|tsetserleg|kindergarten|детск\w*\s*сад|day\s?care|preschool|ясли', I)
R_SCHOOL_GEN = re.compile(r'ерөнхий\s*боловсрол|\bЕБС\b|ЕБ-ын|дунд\s*сургууль|бага\s*сургууль|ахлах\s*сургууль|цогцолбор\s*(?:сургууль|school)|гимнази|gymnasium|лицей|lyceum|'
                          r'secondary\s*school|high\s*school|elementary|primary\s*school|complex\s*school|laboratory\s*school|international\s*school|smart\s*school|'
                          r'(?<![\d.])\d{1,3}\s*(?:-?\s*(?:р|r|th|st|nd|rd|дугаар|dugaar)\.?)?\s*(?:сургууль|сургуул|school|surguul)', I)
R_SCHOOL_WORD = re.compile(r'сургууль|сургуул|\bschool\b|surguul', I)
R_EDU_WORDS = re.compile(r'авто|driving|dance|бүжиг|ballet|балет|\bart\b|\bарт\b|урлан|урлаг|music|хөгжим|piano|төгөлдөр|language|хэлний|english|англи|'
                         r'солонгос|korean|topik|япон|japan|chinese|хятад хэл|cyber|coding|программ|библи|bible|шатар|chess|сургалт|training|academy|академи|'
                         r'education|боловсролын төв|давтлага|tutor|дугуйлан|beauty|гоо сайхан|puzzle|math|математик|ЭЕШ|agency|агентлаг|зуучлал|'
                         r'center|centre|learn|byte|eco-school|foundation|project|\bТББ\b|llc|ххк|trade|development', I)
R_NUM_FAC = re.compile(r'(?<![\d.])(\d{1,3})\s*(?:-?\s*(?:р|r|th|st|nd|rd|дугаар|dugaar)\.?)?\s*(?:сургууль|сургуул|school|surguul|цэцэрлэг|tsetserleg|kindergarten)', I)
R_NUM_FAC2 = re.compile(r'(?:сургууль|school|цэцэрлэг|kindergarten)\s*(?:№|no\.?|#)\s*(\d{1,3})', I)
R_HEALTH = re.compile(r'эмнэлэг|эмнэлг|emneleg|clinic|клиник|hospital|поликлиник|сувилал|suvilal|төрөх|turuh|амаржих|эрүүл\s*мэндийн\s*төв|'
                      r'\bЭМТ\b|ӨЭМТ|ЭМН\b|оношлогоо|diagnos|лаборатори|medical|\bmed\b|мед\b|эх\s*нялх|eh\s*nyalh|эх\s*хүүхд|eh\s*huuhd|'
                      r'уламжлалт|бариа\s*засал|сэргээн\s*засах|сэтгэц|зүрх\s*судас', I)
R_HEALTH_NOT = re.compile(r'laundry|геодез|хэмжил|fashion|\btoy|хувцас|хэрэгсл|тоног|pet|нохой|муур|мал\s*эмнэл|\bvet|гоо\s*сайхан|beauty|\bspa\b|салон|salon|шоп|\bshop|store|дэлгүүр|pharma\b|group|брэнд|brand', I)
R_SPORT = re.compile(r'спорт|sport|фитнес|fitness|\bgym\b|заал\b|бялдаржуулах|йог|yoga|бокс|boxing|таэквондо|taekwondo|jiu|жүдо|judo|волейбол|volleyball|'
                     r'сагс|basketball|хөл\s*бөмбөг|football|soccer|теннис|tennis|усан\s*сан|усан\s*спорт|swimming|тэшүүр|skating|stadium|цэнгэлдэх|бүжиг|dance|ballet|балет|climbing', I)
R_SPORT_NOT = re.compile(r'биллиард|billiard|\bbar\b|pub\b|бар\b|дэлгүүр|store|shop|sportswear|спорт аялалын цүнх|бооцоо|\bbet\b|бараа|хувцас|huvtsas|өмсгөл|үйлдвэр|market|nutrition|motors|моторс|esport|promotion|чуулга|chuulga|equipment|тоног', I)
R_BANK = re.compile(r'банк|\bbank\b|khanbank|хадгаламж\s*зээлийн|credit\s*union', I)
R_BANK_NOT = re.compile(r'ББСБ|NBFI|ломбард|lombard|finance|финанс|leasing|лизинг|аудит|audit', I)
R_ATM = re.compile(r'\bATM\b|\bАТМ\b|bankomat', I)
R_POST = re.compile(r'шуудан|post\s*office|\bpost\b', I)
R_LIB = re.compile(r'номын\s*сан|library|номын\s*өргөө', I)
R_GOV = re.compile(r'(?:\d+\s*(?:-?\s*(?:р|r|th|дугаар|dugaar)\.?)?\s*(?:хороо(?!л)|khoroo(?!l)|horoo(?!l)))|(?:khoroo|horoo)\s*\d+|хорооны|хорооны\s*байр|^хорооны байр$|'
                   r'засаг\s*даргын|ЗДТГ|тамгын\s*газар|татварын|tatvariin|иргэний\s*бүртгэл|улсын\s*бүртгэл|нийгмийн\s*даатгал|хэлтэс|heltes|цагдаа|police|прокурор|'
                   r'шүүх\b|court|онцгой\s*байдл|гал\s*унтраах|АСАП|төрийн\s*үйлчилгээ|нотариат|насан\s*туршийн\s*суралцах|ерөнхий\s*газар', I)
R_GOV_NOT = re.compile(r'хэрэгсл|зохицуулалт|хулгай', I)
R_MALL = re.compile(r'худалдааны\s*төв|hudaldaanii\s*tuv|trade\s*cent|их\s*дэлгүүр|их\s*дэлүүр|ikh\s*delguur|shopping\s*(?:store|cent)|\bmall\b|молл|плаза|plaza|\bзах\b|бөмбөгөр|bumbugur|department\s*store|ахуй\s*үйлчилгээний\s*төв|мөнгөн\s*завь', I)
R_MALL_NOT = re.compile(r'авто|auto|office|оффис|хотхон|residence|зочид|coffee|кофе|caffe|\bcafe|bakery|салон|salon|тоглоомын\s*дэлгүүр|онлайн|online|захиал|\bllc\b|ххк|үйлдвэр|гутал|номын|kitchen|шашин|оптик|хувцасны|\btoy|\bshop\b|брэнд|brand|цогцолбор', I)
R_GROCERY = re.compile(r'хүнс|supermarket|супер\s*маркет|супермаркет|mini\s*market|мини\s*маркет|minimarket|\bmart\b|(?<![а-яөүё])март\b|e-?mart|емарт|номин|nomin|миний\s*дэлгүүр|minii\s*delguur|'
                       r'\bCU\b|GS25|circle\s*k|good\s*price|fresco|мухлаг|market$|маркет$|\bz market\b|орос\s*дэлгүүр|дэлгүүр$', I)
R_GROCERY_NOT = re.compile(r'авто|auto|утас|гутал|gutal|хувцас|тавилга|барилг|цэцэг|гоо|beauty|cosmetic|косметик|онлайн|online|эрхи|хөөрөг|бичиг|textile|бөс|тоглоом|toy|'
                           r'электрон|electron|гялгар|цүнх|сэлбэг|пүүз|гэрэл|сормуус|хумс|насанд хүрэгч|ягаан|цэцг|номын|цагны|fashion|тавилг|загас|амьт|гутл|нярай|хүүхдийн\s*бараа|аялл|үсний|brand|цахим|интернэт|хөшиг|watch|baby|эслэг|амин\s*чанар|тахил|захиал|бөөний|kfc|септик|sport|спорт|оптик', I)
R_SKIP = re.compile(r'дацан|хийд|сүм\b|temple|monastery|church|сүм$|mosque|зарна|embassy|элчин', I)

TAX = {  # overture taxonomy primary -> (cat, sub, needs_name_support)
    'preschool': ('kinder', 'preschool', False), 'day_care_preschool': ('kinder', 'day_care', False),
    'elementary_school': ('school', 'elementary', False), 'high_school': ('school', 'high', False),
    'public_school': ('school', 'public', False), 'private_school': ('school', 'private', False),
    'school': ('school', 'school', False),
    'college_university': ('college', 'college_university', True), 'campus_building': ('college', 'campus', True),
    'vocational_and_technical_school': ('edu_center', 'vocational', False),
    'educational_service': ('edu_center', 'educational_service', False), 'tutoring_service': ('edu_center', 'tutoring', False),
    'education': ('edu_center', 'education', False), 'language_school': ('edu_center', 'language', False),
    'driving_school': ('edu_center', 'driving', False), 'art_school': ('edu_center', 'art', False),
    'music_school': ('edu_center', 'music', False), 'computer_coaching': ('edu_center', 'computer', False),
    'specialty_school': ('edu_center', 'specialty', False), 'library': ('library', 'library', False),
    'hospital': ('health', 'hospital', False), 'dental_clinic': ('dental', 'dental', False),
    'general_dentistry': ('dental', 'dental', False), 'orthodontics': ('dental', 'orthodontics', False),
    'pediatric_clinic': ('health', 'pediatric', False), 'outpatient_care_facility': ('health', 'outpatient', False),
    'doctors_office': ('health', 'doctor', False), 'laboratory_testing': ('health', 'lab', False), 'radiology': ('health', 'radiology', False),
    'medical_service_organization': ('health', 'medical_service', True), 'reproductive_perinatal_and_womens_care': ('health', 'womens', True),
    'obstetrics_and_gynecology': ('health', 'womens', False), 'physical_therapy': ('health', 'rehab', False),
    'psychology': ('health', 'mental', True), 'alcohol_and_drug_treatment_center': ('health', 'addiction', True), 'embassy': (None, None, True),
    'health_care': ('health', 'health_care', True),
    'pharmacy': ('pharmacy', 'pharmacy', False),
    'grocery_store': ('grocery', 'grocery', True), 'organic_grocery_store': ('grocery', 'organic', False),
    'convenience_store': ('grocery', 'convenience', False), 'supermarket': ('grocery', 'supermarket', False),
    'food_and_beverage_store': ('grocery', 'food_store', True), 'butcher_shop': ('grocery', 'butcher', False),
    'shopping_mall': ('mall', 'mall', False), 'department_store': ('mall', 'department_store', False),
    'bank_or_credit_union': ('bank', 'bank', False), 'atm': ('atm', 'atm', False),
    'government_office': ('gov', 'government_office', False), 'town_hall': ('gov', 'town_hall', True),
    'courthouse': ('gov', 'court', False), 'police_station': ('gov', 'police', False),
    'community_center': ('gov', 'community_center', True), 'social_or_community_service': ('gov', 'social_service', True),
    'electric_utility_provider': ('gov', 'utility', True),
    'park': ('park', 'park', False), 'hiking_trail': ('park', 'trail', False), 'playground': ('playground', 'playground', False),
    'gym': ('sport', 'gym', False), 'yoga_studio': ('sport', 'yoga', False), 'fitness_studio': ('sport', 'fitness', False),
    'dance_studio': ('sport', 'dance', True), 'fitness_trainer': ('sport', 'fitness', True),
    'volleyball_court': ('sport', 'court', False), 'baseball_field': ('sport', 'field', True), 'hockey_field': ('sport', 'field', True),
    'soccer_field': ('sport', 'field', False), 'swimming_pool': ('sport', 'pool', False), 'roller_skating_rink': ('sport', 'rink', False),
    'skate_park': ('sport', 'skate_park', True), 'stadium_arena': ('sport', 'stadium', False),
    'sports_and_recreation': ('sport', 'generic', True),
    'train_station': ('rail', 'train_station', False), 'bus_station': ('bus', 'bus_station', False),
    'shopping': (None, None, True), 'warehouse_club_store': (None, None, True), 'discount_store': (None, None, True),
    'community_and_government': (None, None, True),
}
# taxonomy-only acceptance is refused when the name looks like a company/online shop etc.
R_TAX_NOT = re.compile(r'дэлгүүр|ххк|trade|трейд|\bshop\b|\bstore\b|бараа|kitchen|гутал|захиал|үйлдвэр|шашин|leather|дээл|fashion|\btoy|journey|coffee|\bcafe|bakery|online|онлайн|pet\b|нохой|муур|мал\s*эмнэл|\bvet|зарна|захиалга|бөөний|\bLLC\b|group\b|brand\b|брэнд|distribut|pharma\b|'
                       r'cosmetic|косметик|халаагуур|цүнх|баглаа|coworking|хумс|салон|salon|билльярд|billiard|paintball', I)

def classify_name(n):
    """return (cat, sub, trust) from the name alone, or None"""
    if not n: return None
    if R_SKIP.search(n): return ('SKIP', None, None)
    if R_PARK_STRONG.search(n): return ('park', 'park', 'high')
    if R_PLAY.search(n) and not R_PLAY_NOT.search(n): return ('playground', 'playground', 'high')
    if R_DENTAL.search(n): return ('dental', 'dental', 'high')
    if R_PHARM.search(n): return ('pharmacy', 'pharmacy', 'high')
    if R_HIGH_STRONG.search(n): return ('college', 'higher_ed', 'high')
    if R_KINDER.search(n): return ('kinder', 'kindergarten', 'high')
    if R_SCHOOL_GEN.search(n): return ('school', 'general_ed', 'high')
    if R_SCHOOL_WORD.search(n) and not R_EDU_WORDS.search(n): return ('school', 'school_unverified', 'low')
    if R_HEALTH.search(n) and not R_HEALTH_NOT.search(n): return ('health', 'health', 'high')
    if R_SPORT.search(n) and not R_SPORT_NOT.search(n): return ('sport', 'sport', 'medium')
    if R_ATM.search(n): return ('atm', 'atm', 'high')
    if R_BANK.search(n) and not R_BANK_NOT.search(n): return ('bank', 'bank', 'high')
    if R_POST.search(n): return ('post', 'post', 'medium')
    if R_LIB.search(n): return ('library', 'library', 'high')
    if R_GOV.search(n) and not R_GOV_NOT.search(n): return ('gov', 'gov', 'high')
    if R_MALL.search(n) and not R_MALL_NOT.search(n): return ('mall', 'mall', 'medium')
    if R_GROCERY.search(n) and not R_GROCERY_NOT.search(n):
        generic = re.search(r'дэлгүүр$', n, I) and not re.search(r'хүнс|маркет|mart|номин|миний|орос', n, I)
        return ('grocery', 'shop_generic' if generic else 'grocery', 'low' if generic else 'high')
    if R_HIGH_WEAK.search(n): return ('college?', 'higher_ed_weak', 'low')
    if R_SCHOOL_WORD.search(n) or R_EDU_WORDS.search(n): return ('edu?', None, None)
    return None

def fac_num(n):
    if not n: return None
    m = R_NUM_FAC.search(n) or R_NUM_FAC2.search(n)
    return int(m.group(1)) if m else None

# ---------------- districts ----------------
DIST = {}
for f in load('ov_division_area.geojson'):
    p = f['properties']
    if p.get('subtype') == 'county':
        DIST[p['names']['primary'].split()[0]] = shape(f['geometry'])
DIST_ADDR = [
    ('Баянгол', re.compile(r'баянгол|\bБГД\b|bayangol|\bBGD\b|баянол', I)),
    ('Чингэлтэй', re.compile(r'чингэлтэй|чингилтэй|\bЧД\b|chingeltei|\bCHD\b', I)),
    ('Сүхбаатар', re.compile(r'сүхбаатар|\bСБД\b|sukhbaatar|\bSBD\b', I)),
    ('Хан-Уул', re.compile(r'хан[\s-]*уул|\bХУД\b|khan[\s-]*uul|\bKhUD\b|\bHUD\b', I)),
    ('Баянзүрх', re.compile(r'баянзүрх|\bБЗД\b|bayanzurkh|\bBZD\b', I)),
    ('Сонгинохайрхан', re.compile(r'сонгинохайрхан|\bСХД\b|songino', I)),
]
def district_of(lat, lng):
    pt = Point(lng, lat)
    for k, g in DIST.items():
        if g.contains(pt): return k
    return None
def addr_districts(a):
    return [k for k, r in DIST_ADDR if r.search(a or '')]

HOME_DISTRICT = district_of(LAT0, LNG0)

out = []

def emit(**kw):
    x, z = local(kw['lat'], kw['lng'])
    kw['x'] = round(x, 1); kw['z'] = round(z, 1); kw['dist_m'] = round(math.hypot(x, z))
    kw['src'] = 'overture'; kw['release'] = RELEASE
    kw['num'] = fac_num(kw.get('name')) if kw['cat_guess'] in ('kinder', 'school') else None
    if kw['cat_guess'] == 'gov':
        n = kw.get('name') or ''
        if re.search(r'хороо(?!л)|khoroo(?!l)|horoo(?!l)', n, I): kw['sub'] = 'khoroo_office'
        elif re.search(r'цагдаа|police', n, I): kw['sub'] = 'police'
        elif re.search(r'татвар|tatvar', n, I): kw['sub'] = 'tax_office'
        elif re.search(r'насан\s*туршийн', n, I): kw['sub'] = 'lifelong_learning_center'
        else: kw['sub'] = 'agency'
    d = district_of(kw['lat'], kw['lng']); kw['district'] = d
    ad = addr_districts(kw.get('address') or '')
    flags = kw.setdefault('flags', [])
    if ad and d and d not in ad: flags.append('addr_district_mismatch:' + '/'.join(ad))
    out.append(kw)

# ---------------- 1) places theme ----------------
places = load('ov_places_city.geojson')
stack = collections.Counter((round(f['geometry']['coordinates'][1], 5), round(f['geometry']['coordinates'][0], 5)) for f in places)
for f in places:
    p = f['properties']; lng, lat = f['geometry']['coordinates']
    name = (p.get('names') or {}).get('primary') or ''
    tax = p.get('taxonomy') or {}
    tprim = tax.get('primary'); hier = tax.get('hierarchy') or []
    nc = classify_name(name)
    if nc and nc[0] == 'SKIP': continue
    tm = TAX.get(tprim)
    if tm is None and hier:  # try parents
        for h in reversed(hier[:-1]):
            if h in TAX and TAX[h][0]: tm = TAX[h]; break
    cat = sub = trust = basis = None
    if nc and nc[0] not in ('college?', 'edu?'):
        cat, sub, trust = nc; basis = 'name'
        if tm and tm[0] == cat: basis = 'name+taxonomy'; trust = 'high' if trust != 'low' else 'medium'
        if cat == 'school' and sub == 'school_unverified' and tm and tm[0] == 'school': trust = 'medium'
    elif tm and tm[0]:
        tcat, tsub, needs = tm
        if tcat == 'college':
            if nc and nc[0] == 'college?': cat, sub, trust, basis = 'college', 'higher_ed_weak', 'low', 'taxonomy+weak_name'
            else: cat, sub, trust, basis = 'edu_center', 'college_tagged_training', 'low', 'taxonomy'
        elif tcat == 'school' and nc and nc[0] == 'edu?':
            cat, sub, trust, basis = 'edu_center', 'school_tagged_training', 'low', 'taxonomy'
        elif needs:
            continue  # generic taxonomy without name support -> skip
        elif R_TAX_NOT.search(name) or (p.get('confidence') or 0) < 0.5:
            continue
        else:
            cat, sub, basis = tcat, tsub, 'taxonomy'
            trust = 'medium' if (p.get('confidence') or 0) >= 0.7 else 'low'
    elif re.search('цогцолбор', name, I) and tm and tm[0] in ('school', 'edu_center'):
        cat, sub, trust, basis = 'school', 'complex_school', 'medium', 'name+taxonomy'
    elif nc and nc[0] == 'college?' and tprim in ('research_institute', 'educational_research_institute'):
        cat, sub, trust, basis = 'college', 'research_institute', 'low', 'name+taxonomy'
    else:
        continue
    k = (round(lat, 5), round(lng, 5)); sn = stack[k]
    geo = 'bad' if sn >= 20 else ('shared' if sn >= 4 else 'ok')
    flags = []
    if geo == 'bad': flags.append('geocode_fallback_cluster(%d places on one point)' % sn)
    addr = ' ; '.join((a.get('freeform') or '').replace('\n', ' ').strip() for a in (p.get('addresses') or []) if a.get('freeform'))
    srcs = [{'dataset': s.get('dataset'), 'record_id': s.get('record_id'), 'license': s.get('license'), 'update_time': s.get('update_time')}
            for s in p.get('sources') or [] if s.get('property') == '']
    emit(name=name, cat_guess=cat, sub=sub, lat=round(lat, 7), lng=round(lng, 7), theme='places', id=f['id'],
         categories={'primary': tprim, 'hierarchy': hier, 'alternates': tax.get('alternates'), 'basic_category': p.get('basic_category')},
         confidence=round(p.get('confidence') or 0, 3), trust=trust, basis=basis, geo_quality=geo, stack_n=sn,
         address=addr, upstream=srcs, flags=flags,
         phones=p.get('phones'), websites=p.get('websites'))

# ---------------- 2) buildings theme (named or education/medical class) ----------------
BCLASS = {'kindergarten': ('kinder', 'kindergarten'), 'school': ('school', 'school'), 'university': ('college', 'university'),
          'college': ('college', 'college'), 'hospital': ('health', 'hospital'), 'clinic': ('health', 'clinic'),
          'supermarket': ('grocery', 'supermarket'), 'library': ('library', 'library'), 'dormitory': (None, None)}
for f in load('ov_bnamed_city.geojson'):
    p = f['properties']; name = ((p.get('names') or {}).get('primary') or '').strip()
    cls = p.get('class'); sub_t = p.get('subtype')
    if re.fullmatch(r'[\dА-Яа-яA-Za-z]{0,3}[\d/ .,-]*[А-Яа-яA-Za-z]?\s*(байр|bair)?', name, I): name_ok = False
    else: name_ok = True
    nc = classify_name(name) if name_ok else None
    if nc and nc[0] == 'SKIP': continue
    bc = BCLASS.get(cls)
    cat = sub = trust = basis = None
    if nc and nc[0] not in ('college?', 'edu?') and nc[0] not in ('park',):
        cat, sub, trust = nc; basis = 'name'
        if bc and bc[0] == cat: basis = 'name+class'; trust = 'high'
    elif nc and nc[0] == 'edu?' and (sub_t == 'education' or cls in ('school', 'college', 'university')):
        cat, sub, trust, basis = 'edu_center', 'training', 'low', 'name+class'
    elif bc and bc[0] and cat is None and (sub_t in ('education', 'medical') or cls in ('supermarket', 'library')):
        cat, sub = bc; trust = 'medium' if name_ok else 'low'; basis = 'class' + ('' if name_ok else ' (unnamed)')
    elif sub_t in ('education', 'medical') and not name_ok:
        cat, sub = ('school', 'education_building') if sub_t == 'education' else ('health', 'medical_building')
        trust, basis = 'low', 'subtype (unnamed)'
    else:
        continue
    if cls == 'ger': trust = 'low'
    g = shape(f['geometry']); rp = g.representative_point()
    srcs = [{'dataset': s.get('dataset'), 'record_id': s.get('record_id'), 'license': s.get('license'), 'update_time': s.get('update_time')}
            for s in p.get('sources') or [] if s.get('property') == '']
    a = g.area * KX * KZ
    emit(name=name if name_ok else None, cat_guess=cat, sub=sub, lat=round(rp.y, 7), lng=round(rp.x, 7), theme='buildings', id=f['id'],
         categories={'subtype': sub_t, 'class': cls}, confidence=None, trust=trust, basis=basis, geo_quality='footprint',
         stack_n=None, address='', upstream=srcs, flags=[], footprint_m2=round(a), levels=p.get('num_floors'))

# ---------------- 3) base/land_use ----------------
LCLASS = {'kindergarten': ('kinder', 'kindergarten_grounds'), 'school': ('school', 'school_grounds'), 'college': ('college', 'campus'),
          'university': ('college', 'campus'), 'hospital': ('health', 'hospital_grounds'), 'clinic': ('health', 'clinic_grounds'),
          'park': ('park', 'park'), 'village_green': ('park', 'green'), 'garden': ('park', 'garden'),
          'playground': ('playground', 'playground'), 'pitch': ('sport', 'pitch'), 'track': ('sport', 'track'),
          'sports_centre': ('sport', 'sports_centre'), 'stadium': ('sport', 'stadium'), 'retail': ('mall', 'retail_area')}
for f in load('ov_land_use.geojson'):
    p = f['properties']; cls = p.get('class'); name = ((p.get('names') or {}).get('primary') or '').strip()
    if cls not in LCLASS: continue
    if cls == 'retail' and not name: continue
    cat, sub = LCLASS[cls]
    nc = classify_name(name) if name else None
    basis = 'class'; trust = 'medium' if name else 'low'
    if nc and nc[0] not in ('SKIP', 'college?', 'edu?'):
        if nc[0] != cat and cat in ('kinder', 'school', 'college'): cat = nc[0]; basis = 'name(overrides class)'
        elif nc[0] == cat: basis = 'name+class'; trust = 'high'
    g = shape(f['geometry']); rp = g.representative_point()
    srcs = [{'dataset': s.get('dataset'), 'record_id': s.get('record_id'), 'license': s.get('license'), 'update_time': s.get('update_time')}
            for s in p.get('sources') or [] if s.get('property') == '']
    emit(name=name or None, cat_guess=cat, sub=sub, lat=round(rp.y, 7), lng=round(rp.x, 7), theme='base/land_use', id=f['id'],
         categories={'subtype': p.get('subtype'), 'class': cls}, confidence=None, trust=trust, basis=basis, geo_quality='polygon',
         stack_n=None, address='', upstream=srcs, flags=[], area_m2=round(g.area * KX * KZ))

# ---------------- 4) base/infrastructure: bus stops, ATMs ----------------
ICLASS = {'bus_stop': ('bus', 'bus_stop'), 'bus_station': ('bus', 'bus_station'), 'atm': ('atm', 'atm')}
for f in load('ov_infrastructure.geojson'):
    p = f['properties']; cls = p.get('class')
    if cls not in ICLASS: continue
    name = ((p.get('names') or {}).get('primary') or '').strip()
    g = shape(f['geometry']); rp = g if g.geom_type == 'Point' else g.representative_point()
    cat, sub = ICLASS[cls]
    srcs = [{'dataset': s.get('dataset'), 'record_id': s.get('record_id'), 'license': s.get('license'), 'update_time': s.get('update_time')}
            for s in p.get('sources') or [] if s.get('property') == '']
    emit(name=name or None, cat_guess=cat, sub=sub, lat=round(rp.y, 7), lng=round(rp.x, 7), theme='base/infrastructure', id=f['id'],
         categories={'subtype': p.get('subtype'), 'class': cls}, confidence=None, trust='medium' if name else 'low', basis='class',
         geo_quality='point', stack_n=None, address='', upstream=srcs, flags=[], operator=(p.get('operator') if 'operator' in p else None))

# ---------------- duplicate hints ----------------
def norm(s):
    return re.sub(r'[^0-9a-zа-яөүё]+', '', (s or '').lower())
for i, a in enumerate(out):
    a['dup_key'] = ('%s#%d' % (a['cat_guess'], a['num'])) if a.get('num') is not None else None
# link same numbered facility (same cat, same num, <400 m) and same normalised name (<150 m)
gid = {}
def find(i):
    while gid.get(i, i) != i: i = gid[i]
    return i
CELL = 400.0; grid = collections.defaultdict(list)
for i, a in enumerate(out): grid[(int(a['x'] // CELL), int(a['z'] // CELL))].append(i)
for i in range(len(out)):
    a = out[i]; ci, cj = int(a['x'] // CELL), int(a['z'] // CELL)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for j in grid.get((ci + di, cj + dj), ()):
                if j <= i: continue
                b = out[j]
                d = math.hypot(a['x'] - b['x'], a['z'] - b['z'])
                same = (a['dup_key'] and a['dup_key'] == b['dup_key'] and d < 400) or                        (a['name'] and b['name'] and norm(a['name']) == norm(b['name']) and d < 150 and a['cat_guess'] == b['cat_guess'])
                if same: gid[find(j)] = find(i)
groups = collections.defaultdict(list)
for i in range(len(out)): groups[find(i)].append(i)
for g, idx in groups.items():
    if len(idx) > 1:
        for i in idx: out[i]['dup_group'] = 'g%d' % g
for a in out: a.setdefault('dup_group', None)

out.sort(key=lambda a: (a['dist_m']))
with open(os.path.join(HERE, 'poi_overture.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)
print('home district:', HOME_DISTRICT, '| total', len(out))
print(collections.Counter((a['theme'], a['cat_guess']) for a in out))
