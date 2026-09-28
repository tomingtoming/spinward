"""Survey candidate bands using the actual MLIT N02 station geometry."""
import argparse
import hashlib
import json
from pathlib import Path
from geo import Frame, WIDTH, SPAN, fit

CANDIDATES = [
    ('tokyo-full', '丸ノ内線全線', 6677, '丸ノ内線', None),
    ('tokyo', '荻窪〜新宿〜四ツ谷', 6677, '丸ノ内線',
     ['荻窪','南阿佐ヶ谷','新高円寺','東高円寺','新中野','中野坂上','西新宿','新宿','新宿三丁目','新宿御苑前','四谷三丁目','四ツ谷']),
    ('tama', '永山〜多摩センター〜南大沢', 6677, '相模原線',
     ['京王永山','京王多摩センター','京王堀之内','南大沢']),
    ('azumino-full', '松本〜穂高', 6676, '大糸線',
     ['松本','北松本','島内','島高松','梓橋','一日市場','中萱','南豊科','豊科','柏矢町','穂高']),
    ('azumino', '一日市場〜豊科〜穂高〜安曇追分', 6676, '大糸線',
     ['一日市場','中萱','南豊科','豊科','柏矢町','穂高','有明','安曇追分']),
]


def main(root):
    path = root/'N02-25_Station.geojson'
    features = json.loads(path.read_text())['features']
    out = []
    for id_, name, epsg, line, names in CANDIDATES:
        stations = {}
        for f in features:
            p = f['properties']
            if line not in p['N02_003'] or (names and p['N02_005'] not in names):
                continue
            pts = f['geometry']['coordinates']
            lon, lat = [sum(p[i] for p in pts)/len(pts) for i in (0,1)]
            stations[p['N02_005']] = dict(name=p['N02_005'], position=[lon,lat], geometry=pts)
        if names:
            assert set(names) == set(stations), (id_, set(names)-set(stations))
        fitted = fit([p for s in stations.values() for p in s['geometry']], epsg)
        frame = Frame(epsg, fitted['origin'], fitted['angle'])
        for s in stations.values():
            s['local'] = frame.place(*s['position'])
        corners = [frame.geographic(x,y) for x,y in
                   [(-WIDTH/2,-SPAN/2),(WIDTH/2,-SPAN/2),(WIDTH/2,SPAN/2),(-WIDTH/2,SPAN/2)]]
        out.append(dict(id=id_, name=name, frame=fitted, stations=list(stations.values()),
                        corridor=corners, note='Station envelope only; track bends, buildings and complete 40 km coverage require separate checks.'))
    report = dict(origin='ai', created='2026-09-22', radius=3200, width=WIDTH, span=SPAN,
                  source='https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html',
                  sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(), candidates=out)
    (root/'survey.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    for x in out:
        print(x['id'], json.dumps(x['frame'],ensure_ascii=False), flush=True)


if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--root',type=Path,required=True)
    main(p.parse_args().root)
