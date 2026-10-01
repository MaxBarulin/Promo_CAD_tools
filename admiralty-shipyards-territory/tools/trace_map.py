"""Оцифровка карты предприятия (data/source/enterprise-map.png) в пиксельные контуры.

Результат — src/data/map-trace.js: участки территории, здания, акватория, «коридор» акватории, мосты
в пиксельных координатах исходной карты. Перевод в метры модели (масштаб, поворот
по стрелке севера, привязка к площади Репина) выполняется в src/data/mapdata.js.

Запуск: python3 tools/trace_map.py   (нужны numpy и opencv-python-headless)
"""

import heapq
import json
import math
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'source', 'enterprise-map.png')
OUT = os.path.join(ROOT, 'src', 'data', 'map-trace.js')

BG = np.array([170, 203, 217])        # фон (вода / вне территории)
FILL = np.array([247, 241, 217])      # заливка территории
BUILDING = np.array([236, 228, 198])  # заливка зданий

# Мосты: (x1, y1, x2, y2, ширина_пикс) — по карте
BRIDGES = [
    {'id': 'MB1', 'name': 'Заводской мост через Фонтанку', 'a': [289, 297], 'b': [323, 309], 'w': 9, 'cut': [[296, 295], [319, 295], [319, 308], [296, 308]]},
    {'id': 'MB2', 'name': 'Заводской мост через Пряжку', 'a': [728, 352], 'b': [747, 352], 'w': 9, 'cut': [[731, 346], [744, 346], [744, 357], [731, 357]]},
    {'id': 'MB3', 'name': 'Мост через протоку (устье Мойки)', 'a': [1143, 298], 'b': [1171, 279], 'w': 10, 'cut': None, 'keep': True},
    {'id': 'MB4', 'name': 'Причальный мост над устьем Пряжки', 'a': [727, 237], 'b': [743, 237], 'w': 16, 'cut': [[731, 226], [739, 226], [739, 247], [731, 247]]},
]
# Линия разреза протоки между площадкой у устья Мойки и Ново-Адмиралтейским островом
CHANNEL_CUT = [(1136, 264), (1186, 336)]

# Подкрановые пути (узкие полосы вдоль причалов) и настил моста через протоку (81) —
# не препятствие для проездов
RUNWAY_IDX = {31, 40, 22, 34, 4, 81}

# Внутризаводские проезды: опорные точки (пикс.); путь между ними прокладывается
# автоматически по свободным от зданий полосам с предпочтением середины проезда.
ROADS = [
    {'id': 'R1', 'name': 'Главный проезд от проходной вдоль ковша', 'w': 9, 'via': [(512, 552), (486, 470), (486, 352)]},
    {'id': 'R2', 'name': 'Проезд вдоль западной стороны основной площадки', 'w': 8, 'via': [(486, 540), (420, 520), (380, 420), (352, 340), (326, 306)]},
    {'id': 'R3', 'name': 'Проезд вдоль западных цехов к Неве', 'w': 7, 'via': [(352, 340), (330, 260), (330, 140)]},
    {'id': 'R4', 'name': 'Проезд от проходной к мосту через Пряжку', 'w': 9, 'via': [(522, 548), (580, 445), (640, 372), (700, 356), (727, 352)]},
    {'id': 'R5', 'name': 'Проезд вдоль достроечной набережной основной площадки', 'w': 8, 'via': [(580, 445), (575, 330), (585, 255), (650, 252), (722, 252)]},
    {'id': 'R6', 'name': 'Главный проезд Матисова острова', 'w': 9, 'via': [(748, 352), (800, 360), (870, 350), (900, 300), (918, 240)]},
    {'id': 'R7', 'name': 'Проезд вдоль Невы (Матисов остров)', 'w': 7, 'via': [(750, 270), (830, 266), (880, 262)]},
    {'id': 'R8', 'name': 'Проезд к воротам Матисова острова', 'w': 8, 'via': [(800, 360), (800, 420), (815, 455)]},
    {'id': 'R9', 'name': 'Проезд по причалу у устья Мойки', 'w': 8, 'via': [(918, 240), (1000, 232), (1062, 232), (1110, 268), (1143, 298)]},
    {'id': 'R10', 'name': 'Продольный проезд Нового Адмиралтейства', 'w': 8, 'via': [(1171, 279), (1340, 395), (1470, 482), (1500, 500)]},
    {'id': 'R11', 'name': 'Проезд вдоль Невы (Новое Адмиралтейство)', 'w': 8, 'via': [(1160, 262), (1290, 228), (1330, 268), (1400, 295), (1450, 330)]},
    {'id': 'R12', 'name': 'Поперечный проезд Нового Адмиралтейства', 'w': 8, 'via': [(1210, 270), (1250, 340)]},
    {'id': 'R13', 'name': 'Проезд Галерного острова', 'w': 8, 'via': [(290, 300), (240, 285), (180, 255), (130, 200), (110, 140)]},
    {'id': 'R14', 'name': 'Проезд к воротам Галерного острова', 'w': 7, 'via': [(240, 285), (180, 278)]},
]
SCALE = 1.514  # м/пикс (для ширины проездов)

# Контур «коридора» акватории (пиксели): всё фоновое внутри него — вода, вне — городская суша.
# Со стороны города проходит по берегам (Лоцманская ул., жилая часть Матисова о. и т. д.).
WATER_CORRIDOR = [
    (0, 0), (1650, 0), (1650, 602), (1628, 602), (1597, 544),   # Нева у северного торца, устье канала
    (1455, 580), (1424, 580), (1170, 335), (1150, 300),          # канал → Мойка вдоль ЮВ берега острова
    (1088, 382), (870, 487),                                      # восточный берег ковша Матисова о.
    (760, 428), (745, 425), (728, 418),                           # граница с жилой частью, выход Пряжки
    (690, 402), (640, 392), (530, 582),                           # Лоцманская ул. (по ограде)
    (440, 560), (461, 602), (423, 602), (410, 575), (293, 350),   # Фонтанка (≈50 м)
    (222, 375), (190, 288), (137, 272), (107, 262), (62, 128), (0, 118),  # левый берег Фонтанки (Рижский пр.)
]


def load():
    im = cv2.imread(SRC, cv2.IMREAD_COLOR)[:, :, ::-1].astype(int)
    return im


def color_dist(im, c):
    return np.abs(im - c).sum(axis=2)


def contour_polys(mask, eps, min_area):
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < min_area:
            continue
        p = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(p) >= 3:
            out.append({'poly': [[int(x), int(y)] for x, y in p], 'area': float(a)})
    return out


def dijkstra(clear, start, goal, min_clear, box_pad=90):
    """Кратчайший путь по сетке с штрафом за близость к препятствиям (8-связность)."""
    h, w = clear.shape
    x0 = max(0, min(start[0], goal[0]) - box_pad)
    x1 = min(w - 1, max(start[0], goal[0]) + box_pad)
    y0 = max(0, min(start[1], goal[1]) - box_pad)
    y1 = min(h - 1, max(start[1], goal[1]) + box_pad)
    sub = clear[y0:y1 + 1, x0:x1 + 1]
    ok = sub >= min_clear
    cost = 1.0 + 8.0 / np.maximum(sub, 0.5)
    sx, sy = start[0] - x0, start[1] - y0
    gx, gy = goal[0] - x0, goal[1] - y0
    H, W = sub.shape
    dist = np.full((H, W), np.inf)
    prev = -np.ones((H, W), np.int64)
    dist[sy, sx] = 0.0
    pq = [(0.0, sy, sx)]
    steps = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0), (-1, -1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (1, 1, 1.4142)]
    while pq:
        d, y, x = heapq.heappop(pq)
        if d > dist[y, x]:
            continue
        if y == gy and x == gx:
            break
        for dy, dx, l in steps:
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and ok[ny, nx]:
                nd = d + l * 0.5 * (cost[y, x] + cost[ny, nx])
                if nd < dist[ny, nx]:
                    dist[ny, nx] = nd
                    prev[ny, nx] = y * W + x
                    heapq.heappush(pq, (nd, ny, nx))
    if not np.isfinite(dist[gy, gx]):
        return None
    path = []
    cur = gy * W + gx
    while cur >= 0:
        y, x = divmod(int(cur), W)
        path.append((x + x0, y + y0))
        if y == sy and x == sx:
            break
        cur = prev[y, x]
    return path[::-1]


def snap_free(clear, p, min_clear, r=25):
    """Ближайшая к точке клетка с достаточным запасом до препятствий."""
    x, y = p
    best = None
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            yy, xx = y + dy, x + dx
            if 0 <= yy < clear.shape[0] and 0 <= xx < clear.shape[1] and clear[yy, xx] >= min_clear:
                d = dx * dx + dy * dy
                if best is None or d < best[0]:
                    best = (d, (xx, yy))
    return best[1] if best else None


def route_roads(terr, building_polys):
    free = terr.copy().astype(np.uint8)
    # проезжие мосты — свободное пространство
    for b in BRIDGES:
        cv2.line(free, tuple(b['a']), tuple(b['b']), 1, b['w'])
    obst = np.zeros_like(free)
    for i, poly in enumerate(building_polys):
        if i in RUNWAY_IDX:
            continue
        cv2.fillPoly(obst, [np.array(poly, np.int32)], 1)
        cv2.polylines(obst, [np.array(poly, np.int32)], True, 1, 2)
    free[obst > 0] = 0
    # съезды с мостов: полоса моста продлевается на берег поверх мелких препятствий
    for b in BRIDGES:
        a_, b_ = np.array(b['a'], float), np.array(b['b'], float)
        d = (b_ - a_) / np.linalg.norm(b_ - a_)
        cv2.line(free, tuple(int(v) for v in a_ - d * 10), tuple(int(v) for v in b_ + d * 10), 1, b['w'])
    clear = cv2.distanceTransform(free, cv2.DIST_L2, 5)
    out = []
    for r in ROADS:
        need = r['w'] / 2 / SCALE + 0.5
        pts = []
        for a, b in zip(r['via'][:-1], r['via'][1:]):
            sa = snap_free(clear, a, need)
            sb = snap_free(clear, b, need)
            path = dijkstra(clear, sa, sb, need) if sa and sb else None
            if path is None:
                print(f"  ! проезд {r['id']}: нет пути {a} → {b}")
                continue
            if pts and pts[-1] == path[0]:
                path = path[1:]
            pts += path
        if len(pts) < 2:
            continue
        simp = cv2.approxPolyDP(np.array(pts, np.int32).reshape(-1, 1, 2), 1.6, False).reshape(-1, 2)
        out.append({'id': r['id'], 'name': r['name'], 'w': r['w'], 'line': [[int(x), int(y)] for x, y in simp]})
    return out


def main():
    im = load()
    h, w = im.shape[:2]
    terr = color_dist(im, BG) > 40
    terr[0:70, 800:900] = False  # стрелка севера

    # разрезаем мосты
    cut = terr.copy()
    for b in BRIDGES:
        if b['cut']:
            cv2.fillPoly(cut.view(np.uint8), [np.array(b['cut'], np.int32)], 0)
    cv2.line(cut.view(np.uint8), CHANNEL_CUT[0], CHANNEL_CUT[1], 0, 3)

    # участки территории
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cut.astype(np.uint8), 8)
    pieces = []
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 400:
            continue
        m = lab == i
        ps = contour_polys(m, 0.9, 400)
        for p in ps:
            x, y = np.mean(np.array(p['poly']), axis=0)
            pieces.append({'cx': float(x), 'cy': float(y), **p})
    pieces.sort(key=lambda p: p['cx'])

    # здания
    bmask = (color_dist(im, BUILDING) < 14) & terr
    # мосты из зданий исключаем
    excl = np.zeros_like(bmask, dtype=np.uint8)
    for b in BRIDGES:
        if not b.get('keep'):  # на мосту через протоку стоит будка (здание 81) — сохраняем
            cv2.line(excl, tuple(b['a']), tuple(b['b']), 1, b['w'] + 4)
    bmask &= excl == 0
    buildings = []
    nb, lb, sb, cb = cv2.connectedComponentsWithStats(bmask.astype(np.uint8), 4)
    for i in range(1, nb):
        a = sb[i, cv2.CC_STAT_AREA]
        if a < 10:
            continue
        m = (lb == i).astype(np.uint8)
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cnts, key=cv2.contourArea)
        rect = cv2.minAreaRect(c)
        (rx, ry), (rw, rh), ang = rect
        poly = cv2.approxPolyDP(c, 0.9, True).reshape(-1, 2)
        fill_ratio = float(a) / max(1.0, rw * rh)
        buildings.append({
            'poly': [[int(x), int(y)] for x, y in poly],
            'rect': [round(rx, 2), round(ry, 2), round(rw, 2), round(rh, 2), round(ang, 2)],
            'area': int(a),
            'fill': round(fill_ratio, 3),
        })

    # проезды
    roads = route_roads(terr, [b['poly'] for b in buildings])

    # акватория
    water = (~terr).astype(np.uint8)
    for b in BRIDGES:
        if b['cut']:
            cv2.fillPoly(water, [np.array(b['cut'], np.int32)], 1)
    cv2.line(water, CHANNEL_CUT[0], CHANNEL_CUT[1], 1, 3)
    corridor = np.zeros_like(water)
    cv2.fillPoly(corridor, [np.array(WATER_CORRIDOR, np.int32)], 1)
    water &= corridor
    # чуть расширяем воду под контур территории (линия обводки ~2 пикс.)
    water_polys = contour_polys(water, 0.9, 300)

    data = {
        'source': 'data/source/enterprise-map.png',
        'size': [w, h],
        'north': {'tail': [826, 54], 'center': [852.5, 50], 'tip': [894, 45]},
        'pieces': pieces,
        'buildings': buildings,
        'water': water_polys,
        'corridor': [list(p) for p in WATER_CORRIDOR],
        'roads': roads,
        'bridges': [{k: v for k, v in b.items() if k not in ('cut', 'keep')} for b in BRIDGES],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// Сгенерировано tools/trace_map.py из data/source/enterprise-map.png — не редактировать вручную.\n')
        f.write('// Пиксельные координаты исходной карты предприятия (x — вправо, y — вниз).\n')
        f.write('export default ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'участков: {len(pieces)}, зданий: {len(buildings)}, водных контуров: {len(water_polys)}, проездов: {len(roads)}')
    for p in pieces:
        print(f"  участок cx={p['cx']:.0f} cy={p['cy']:.0f} площадь={p['area']:.0f} пикс, вершин {len(p['poly'])}")
    for wp in water_polys:
        print(f"  вода: площадь {wp['area']:.0f} пикс, вершин {len(wp['poly'])}")


if __name__ == '__main__':
    main()
