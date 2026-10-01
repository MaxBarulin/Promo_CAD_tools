"""Привязка карты предприятия к реальной границе территории (Overture/OSM).

Подбирает аффинное преобразование «пиксель карты → метры модели», при котором контуры
участков с карты (src/data/map-trace.js) лучше всего ложатся на реальную границу
территории верфи (src/data/real-data.js): начальное приближение по центрам участков,
затем ICP по точкам контуров. Печатает параметры для GEOREF в src/data/mapdata.js.
"""
import json
import os

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_js(path):
    s = open(os.path.join(ROOT, path), encoding='utf-8').read()
    return json.loads(s[s.index('export default ') + 15:].rstrip().rstrip(';'))


def sample_ring(ring, step):
    pts = []
    for i in range(len(ring)):
        a, b = np.array(ring[i], float), np.array(ring[(i + 1) % len(ring)], float)
        n = max(1, int(np.linalg.norm(b - a) / step))
        for k in range(n):
            pts.append(a + (b - a) * k / n)
    return np.array(pts)


def fit_affine(src, dst, similarity=False):
    if similarity:
        mu_s, mu_d = src.mean(0), dst.mean(0)
        S, D = src - mu_s, dst - mu_d
        U, sig, Vt = np.linalg.svd(D.T @ S)
        d = np.sign(np.linalg.det(U @ Vt))
        R = U @ np.diag([1, d]) @ Vt
        s = (sig * [1, d]).sum() / (S ** 2).sum()
        A = s * R
        t = mu_d - A @ mu_s
        return np.hstack([A, t[:, None]])
    X = np.hstack([src, np.ones((len(src), 1))])
    M, *_ = np.linalg.lstsq(X, dst, rcond=None)
    return M.T


def apply(M, p):
    return p @ M[:, :2].T + M[:, 2]


def main():
    trace = load_js('src/data/map-trace.js')
    real = load_js('src/data/real-data.js')
    # ось y карты направлена вниз — переворачиваем, чтобы искать преобразование без отражения
    map_polys = [Polygon([(x, -y) for x, y in p['poly']]) for p in sorted(trace['pieces'], key=lambda p: p['cx'])]
    real_polys = [Polygon(p[0], p[1:]) for p in real['yard']]
    real_polys.sort(key=lambda p: p.centroid.y)
    real_u = unary_union(real_polys)
    # 1) по центрам участков (карта слева направо ↔ реальность с юга на север)
    src = np.array([[p.centroid.x, p.centroid.y] for p in map_polys])
    dst = np.array([[p.centroid.x, p.centroid.y] for p in real_polys])
    M = fit_affine(src, dst, similarity=True)
    # 2) ICP по контурам: точки карты → ближайшие точки реальной границы того же участка
    from shapely.geometry import Point
    from shapely.ops import nearest_points
    for mode in ('similarity', 'affine'):
        for it in range(25):
            S, D = [], []
            for mp, rp in zip(map_polys, real_polys):
                pts = sample_ring(list(mp.exterior.coords)[:-1], 4)
                tp = apply(M, pts)
                for s, t in zip(pts, tp):
                    q = nearest_points(rp.exterior, Point(t))[0]
                    if np.hypot(q.x - t[0], q.y - t[1]) < 80:
                        S.append(s)
                        D.append([q.x, q.y])
            M = fit_affine(np.array(S), np.array(D), similarity=(mode == 'similarity'))
        warped = unary_union([Polygon(apply(M, np.array(mp.exterior.coords))) for mp in map_polys])
        iou = warped.intersection(real_u).area / warped.union(real_u).area
        res = np.hypot(*(apply(M, np.array(S)) - np.array(D)).T)
        A = M[:, :2]
        sx, sy = np.linalg.norm(A[:, 0]), np.linalg.norm(A[:, 1])
        print(f'{mode}: IoU={iou:.3f}, медиана отклонения контура {np.median(res):.1f} м, 90% {np.percentile(res, 90):.1f} м, масштаб {sx:.3f}/{sy:.3f} м/пикс')
        # обратно к пиксельной оси y (вниз): столбец при y меняет знак
        Mp = M.copy()
        Mp[:, 1] *= -1
        print('  M (пиксель → метры) =', json.dumps([[round(v, 6) for v in row] for row in Mp.tolist()]))


if __name__ == '__main__':
    main()
