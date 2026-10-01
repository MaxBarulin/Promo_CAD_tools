"""Реальная геометрия района из открытых данных Overture Maps.

Overture Maps Foundation публикует открытые карты в виде GeoParquet: здания (контуры
OpenStreetMap и Microsoft ML Buildings, высоты и этажность, где они известны), воду,
землепользование, улицы, мосты, причалы, ограждения. Скрипт читает только нужный
прямоугольник через HTTP Range-запросы, сохраняет выборку в data/overture/*.parquet
и переводит её в систему координат модели → src/data/real-data.js.

Запуск:  python3 tools/overture_fetch.py            (берёт кэш data/overture, если есть)
         python3 tools/overture_fetch.py --refresh  (скачать заново)
Нужны: pyarrow, shapely, requests.
Лицензия данных: ODbL (© участники OpenStreetMap, Overture Maps Foundation, Microsoft).
"""

import io
import json
import math
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.parquet as pq
import requests
from shapely import wkb
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import transform, unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'data', 'overture')
OUT = os.path.join(ROOT, 'src', 'data', 'real-data.js')

BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com'
RELEASE = 'release/2026-09-23.1'
WGS_BBOX = (30.235, 59.903, 30.305, 59.942)  # запад, юг, восток, север

# Система координат модели (как в src/geo.js): начало — центр площади Репина.
LAT0, LON0 = 59.91694, 30.27948
R_LAT = 111412.0
R_LON = 111320.0 * math.cos(math.radians(LAT0))
# Границы модели, м
BOUNDS = dict(minX=-1450, minY=-850, maxX=800, maxY=2050)

LAYERS = {
    'buildings': 'theme=buildings/type=building',
    'building_part': 'theme=buildings/type=building_part',
    'water': 'theme=base/type=water',
    'land_use': 'theme=base/type=land_use',
    'infrastructure': 'theme=base/type=infrastructure',
    'segment': 'theme=transportation/type=segment',
}

SESSION = requests.Session()
if os.path.exists('/root/.ccr/ca-bundle.crt'):
    SESSION.verify = '/root/.ccr/ca-bundle.crt'


# ---------- загрузка ----------

def list_keys(prefix):
    keys, token = [], None
    while True:
        url = f'{BASE}/?list-type=2&prefix={prefix}' + (f'&continuation-token={requests.utils.quote(token)}' if token else '')
        t = SESSION.get(url, timeout=60).text
        keys += [(k, int(s)) for k, s in zip(re.findall(r'<Key>([^<]+)</Key>', t), re.findall(r'<Size>([^<]+)</Size>', t))]
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', t)
        if not m:
            return keys
        token = m.group(1)


class RangeFile(io.RawIOBase):
    """Файл на S3 с чтением по диапазонам байт (parquet читает только footer и нужные группы строк)."""

    def __init__(self, key, size):
        self.url = f'{BASE}/{key}'
        self.size = size
        self.pos = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n <= 0:
            return b''
        a, b = self.pos, min(self.size, self.pos + n) - 1
        for attempt in range(5):
            try:
                r = SESSION.get(self.url, headers={'Range': f'bytes={a}-{b}'}, timeout=120)
                r.raise_for_status()
                break
            except Exception:
                if attempt == 4:
                    raise
        self.pos = b + 1
        return r.content

    def readinto(self, buf):
        d = self.read(len(buf))
        buf[:len(d)] = d
        return len(d)


def fetch_layer(path, bb):
    keys = list_keys(f'{RELEASE}/{path}/')

    def scan(item):
        key, size = item
        md = pq.ParquetFile(RangeFile(key, size)).metadata
        idx = {md.schema.column(i).path: i for i in range(md.num_columns)}
        groups = []
        for g in range(md.num_row_groups):
            rg = md.row_group(g)
            st = {k: rg.column(idx[f'bbox.{k}']).statistics for k in ('xmin', 'xmax', 'ymin', 'ymax')}
            if st['xmin'].min > bb[2] or st['xmax'].max < bb[0] or st['ymin'].min > bb[3] or st['ymax'].max < bb[1]:
                continue
            groups.append(g)
        return (key, size, groups) if groups else None

    with ThreadPoolExecutor(24) as ex:
        hits = [h for h in ex.map(scan, keys) if h]

    def read(hit):
        key, size, groups = hit
        t = pq.ParquetFile(RangeFile(key, size)).read_row_groups(groups)
        b = t.column('bbox').combine_chunks()
        xmin, xmax = b.field('xmin').to_numpy(), b.field('xmax').to_numpy()
        ymin, ymax = b.field('ymin').to_numpy(), b.field('ymax').to_numpy()
        m = (xmax >= bb[0]) & (xmin <= bb[2]) & (ymax >= bb[1]) & (ymin <= bb[3])
        return t.filter(pa.array(m))

    with ThreadPoolExecutor(8) as ex:
        tables = [t for t in ex.map(read, hits) if t.num_rows]
    return pa.concat_tables(tables, promote_options='default')


def ensure_cache(refresh):
    os.makedirs(CACHE, exist_ok=True)
    for name, path in LAYERS.items():
        f = os.path.join(CACHE, name + '.parquet')
        if os.path.exists(f) and not refresh:
            continue
        print(f'  загрузка {path} …', flush=True)
        pq.write_table(fetch_layer(path, WGS_BBOX), f)


# ---------- преобразование ----------

def to_local(g):
    return transform(lambda x, y, z=None: ((x - LON0) * R_LON, (y - LAT0) * R_LAT), g)


def load(name):
    rows = pq.read_table(os.path.join(CACHE, name + '.parquet')).to_pylist()
    for r in rows:
        r['geom'] = to_local(wkb.loads(r['geometry']))
    return rows


def name_of(r):
    n = r.get('names')
    return n.get('primary') if n else None


def polys(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    if g.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [p for p in g.geoms if p.geom_type == 'Polygon']
    return []


def rnd(coords):
    return [[round(x, 1), round(y, 1)] for x, y in list(coords)[:-1]]


def ring_ccw(coords, ccw=True):
    pts = rnd(coords)
    s = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if (s > 0) == ccw else pts[::-1]


def poly_json(p):
    return [ring_ccw(p.exterior.coords, True)] + [ring_ccw(i.coords, False) for i in p.interiors]


ROAD_W = {'primary': 17, 'secondary': 14, 'tertiary': 12, 'residential': 9, 'unclassified': 8, 'living_street': 7, 'pedestrian': 7, 'service': 6}


def main():
    ensure_cache('--refresh' in sys.argv)
    B = box(BOUNDS['minX'], BOUNDS['minY'], BOUNDS['maxX'], BOUNDS['maxY'])

    land_use = load('land_use')
    yard = unary_union([r['geom'] for r in land_use if name_of(r) == 'Адмиралтейские верфи'])
    yard_parts = sorted(polys(yard), key=lambda p: p.centroid.y)

    # вода (без причалов-пирсов: они суша)
    infra = [r for r in load('infrastructure') if r['geom'].intersects(B)]
    piers = unary_union([r['geom'] if r['geom'].geom_type == 'Polygon' else r['geom'].buffer(2.0) for r in infra if r['class'] == 'pier'])
    water_rows = [r for r in load('water') if r['geom'].geom_type in ('Polygon', 'MultiPolygon') and r['geom'].intersects(B)]
    water = unary_union([r['geom'] for r in water_rows]).intersection(B).difference(piers)
    water = water.simplify(0.3)

    # здания
    # Части зданий (OSM building:part): своя высота, отметка основания, форма крыши — разновысотные
    # корпуса, барабаны и купола храмов. Высоты — от земли: height — верх части, min_height — низ.
    def osm_style(r):
        out = {}
        if r.get('roof_shape'):
            out['roof'] = r['roof_shape']
        if r.get('roof_height'):
            out['roofH'] = round(r['roof_height'], 1)
        for k, key in (('facade_material', 'fm'), ('facade_color', 'fc'), ('roof_material', 'rm'), ('roof_color', 'rc')):
            if r.get(k):
                out[key] = r[k]
        return out

    parts_by = {}
    for p in load('building_part'):
        if p.get('is_underground') or not p['geom'].intersects(B):
            continue
        top = p['height'] or (p['num_floors'] * 3.4 + 0.6 if p['num_floors'] else None)
        if not top:
            continue
        base = p['min_height'] or ((p['min_floor'] or 0) * 3.4)
        for g in polys(p['geom']):
            g = g.simplify(0.2)
            if g.area < 2 or top - base < 0.5:
                continue
            parts_by.setdefault(p.get('building_id'), []).append((g, {
                'poly': poly_json(g)[0],
                'holes': poly_json(g)[1:],
                'h': round(top, 1),
                'minH': round(base, 1),
                'floors': p['num_floors'],
                'hTop': bool(p['height']),  # высота из OSM — до верха кровли
                **osm_style(p),
            }))
    buildings = []
    for r in load('buildings'):
        g = r['geom']
        if r.get('is_underground') or not g.intersects(B) or not B.contains(g.representative_point()):
            continue
        for p in polys(g):
            p = p.simplify(0.25)
            if p.area < 8:
                continue
            in_yard = yard.buffer(1.5).contains(p.representative_point())
            own = r['height'] or (r['num_floors'] * 3.4 + 0.6 if r['num_floors'] else None)
            mine = [d for gp, d in parts_by.get(r['id'], []) if p.buffer(1.0).contains(gp.representative_point())]
            h = own or (max(d['h'] for d in mine) if mine else None)
            src = (r.get('sources') or [{}])[0].get('dataset', '')
            b = {
                'id': r['id'][:12],
                'poly': poly_json(p)[0],
                'holes': poly_json(p)[1:],
                'h': round(h, 1) if h else None,
                'floors': r['num_floors'],
                'name': name_of(r),
                'cls': r['class'],
                'src': 'osm' if src == 'OpenStreetMap' else 'ml',
                'yard': in_yard,
                'hTop': bool(r['height']),
                **osm_style(r),
            }
            if mine:
                # доля контура, закрытая частями от земли: если меньше 0,7 — основной объём рисуется тоже
                ground = unary_union([gp for gp, d in parts_by[r['id']] if d['minH'] < 1 and p.buffer(1.0).contains(gp.representative_point())])
                b['parts'] = mine
                b['cover'] = round(ground.intersection(p).area / p.area, 2) if not ground.is_empty else 0
                b['hOwn'] = round(own, 1) if own else None
            buildings.append(b)

    # улицы, внутризаводские проезды, ж/д
    roads, rails, crossings = [], [], []
    for r in load('segment'):
        g = r['geom'].intersection(B)
        if g.is_empty:
            continue
        flags = [(v, f.get('between')) for f in (r.get('road_flags') or []) for v in f['values']]
        if any(v in ('is_tunnel', 'is_indoor') and b is None for v, b in flags):
            continue
        lines = [g] if g.geom_type == 'LineString' else [l for l in getattr(g, 'geoms', []) if l.geom_type == 'LineString']
        if r['subtype'] == 'rail':
            if r['class'] == 'standard_gauge':
                for l in lines:
                    rails.append({'line': rnd(list(l.coords) + [l.coords[-1]]), 'yard': yard.buffer(5).contains(l.centroid)})
            continue
        cls = r['class']
        if cls == 'footway' and r.get('subclass') == 'crosswalk':
            for l in lines:
                if 3 < l.length < 40:
                    crossings.append(rnd(list(l.coords) + [l.coords[-1]]))
            continue
        if cls not in ROAD_W:
            continue
        for l in lines:
            mid = l.interpolate(0.5, normalized=True)
            in_yard = yard.buffer(1.0).contains(mid)
            if cls == 'service' and not in_yard:
                continue
            w = ROAD_W[cls]
            for wr in r.get('width_rules') or []:
                if wr.get('between') is None and wr.get('value'):
                    w = max(4.0, min(30.0, float(wr['value'])))
            bridge = [b for v, b in flags if v == 'is_bridge']
            roads.append({
                'cls': cls,
                'name': name_of(r),
                'w': round(w, 1),
                'line': rnd(list(l.coords) + [l.coords[-1]]),
                'yard': in_yard,
                'bridge': [b or [0, 1] for b in bridge],
            })

    # мосты: полигоны настилов и линии мостов
    water_full = unary_union([r['geom'] for r in water_rows])
    bridges = []
    covered = []
    for r in infra:
        if r['class'] != 'bridge' or r['geom'].geom_type != 'Polygon':
            continue
        p = r['geom']
        if not p.intersects(water_full) or p.area < 30:
            continue
        rect = p.minimum_rotated_rectangle
        c = list(rect.exterior.coords)[:4]
        e = [math.dist(c[i], c[(i + 1) % 4]) for i in range(4)]
        i = 0 if e[0] < e[1] else 1  # короткая сторона — ширина
        a = ((c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2)
        b = ((c[i + 2][0] + c[(i + 3) % 4][0]) / 2, (c[i + 2][1] + c[(i + 3) % 4][1]) / 2)
        bridges.append({'name': name_of(r), 'from': [round(a[0], 1), round(a[1], 1)], 'to': [round(b[0], 1), round(b[1], 1)], 'w': round(e[i], 1), 'poly': poly_json(p.simplify(0.3))[0]})
        covered.append(p.buffer(3))
    covered = unary_union(covered) if covered else Polygon()
    for r in infra:
        if r['class'] != 'bridge' or r['geom'].geom_type != 'LineString':
            continue
        l = r['geom']
        if not l.intersects(water_full) or covered.contains(l.centroid) or l.length < 8:
            continue
        a, b = l.coords[0], l.coords[-1]
        bridges.append({'name': name_of(r), 'from': [round(a[0], 1), round(a[1], 1)], 'to': [round(b[0], 1), round(b[1], 1)], 'w': 12.0, 'poly': None})

    # скверы, газоны, площади (вне верфи)
    AREA_KIND = {('park', 'park'): 'garden', ('managed', 'grass'): 'lawn', ('pedestrian', 'plaza'): 'square', ('horticulture', 'garden'): 'garden', ('recreation', 'playground'): 'lawn'}
    areas = []
    for r in land_use:
        k = AREA_KIND.get((r['subtype'], r['class']))
        if not k:
            continue
        for p in polys(r['geom'].intersection(B)):
            if p.area < (250 if k == 'lawn' else 60) or yard.contains(p.representative_point()):
                continue
            areas.append({'kind': k, 'name': name_of(r), 'poly': poly_json(p.simplify(0.4))[0]})

    # ворота и шлагбаумы на границе верфи
    gates = []
    for r in infra:
        if r['class'] in ('gate', 'lift_gate') and r['geom'].geom_type == 'Point' and r['geom'].distance(yard.boundary) < 20:
            gates.append({'at': [round(r['geom'].x, 1), round(r['geom'].y, 1)], 'kind': r['class'], 'name': name_of(r)})

    data = {
        'source': 'Overture Maps Foundation, ' + RELEASE.split('/')[-1] + ' (© участники OpenStreetMap, Microsoft; ODbL)',
        'bounds': BOUNDS,
        'yard': [poly_json(p.simplify(0.3)) for p in yard_parts],
        'water': [poly_json(p) for p in polys(water) if p.area > 20],
        'buildings': buildings,
        'roads': roads,
        'rails': rails,
        'crossings': crossings,
        'bridges': bridges,
        'areas': areas,
        'gates': gates,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/overture_fetch.py из открытых данных Overture Maps — не редактировать вручную.\n')
        f.write('// Данные © участники OpenStreetMap, Overture Maps Foundation, Microsoft; лицензия ODbL.\n')
        f.write('export default ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f"территория верфи: {round(yard.area / 1e4, 1)} га, участков {len(yard_parts)}")
    print(f"зданий {len(buildings)} (на верфи {sum(b['yard'] for b in buildings)}, с высотой {sum(1 for b in buildings if b['h'])}), "
          f"водных полигонов {len(data['water'])}, улиц {len(roads)}, переходов {len(crossings)}, ж/д {len(rails)}, мостов {len(bridges)}, площадок {len(areas)}, ворот {len(gates)}")
    print(f"→ {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} КБ)")


if __name__ == '__main__':
    main()
