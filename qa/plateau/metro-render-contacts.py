"""Contact sheets from the recorded flight, aligned to its measured start.

One-second whole-frame triage; --fps 4 --crop X Y W H for a suspect interval.
The unmodified source video remains the evidence for unsampled instants.
"""
import argparse
import json
import pathlib
import subprocess

from PIL import Image, ImageDraw

p = argparse.ArgumentParser()
p.add_argument('trace', type=pathlib.Path)
p.add_argument('--ffmpeg', required=True)
p.add_argument('--start', type=float, default=0)
p.add_argument('--seconds', type=float, default=120)
p.add_argument('--fps', type=float, default=1)
p.add_argument('--crop', type=int, nargs=4, metavar=('X', 'Y', 'W', 'H'))
p.add_argument('--prefix', default='flight')
a = p.parse_args()
d = json.loads(a.trace.read_text())
region, latency = d['summary']['region'], d['summary']['latency']
out = a.trace.parent / f'visual-{region}-{latency}'
out.mkdir(exist_ok=True)
offset = d['phases'][0]['at'] / 1000 + a.start
if a.crop:
    x, y, w, h = a.crop
    filters, columns, rows = f'crop={w}:{h}:{x}:{y}', 2, 4
else:
    w, h, filters, columns, rows = 320, 240, 'scale=320:240', 4, 6
raw = subprocess.check_output([a.ffmpeg, '-v', 'error', '-threads', '1', '-ss', str(offset),
    '-i', d['summary']['video'], '-t', str(a.seconds), '-vf', f'fps={a.fps},{filters}',
    '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
step = w * h * 3
frames = [Image.frombytes('RGB', (w, h), raw[i:i + step]) for i in range(0, len(raw) - step + 1, step)]
size = columns * rows
for n in range(0, len(frames), size):
    sheet = Image.new('RGB', (columns * w, rows * (h + 20)), 'white')
    draw = ImageDraw.Draw(sheet)
    for k, frame in enumerate(frames[n:n + size]):
        x, y = k % columns * w, k // columns * (h + 20)
        draw.text((x + 5, y + 3), f'{region} {latency}ms flight {a.start + (n + k) / a.fps:.2f}s', fill='black')
        sheet.paste(frame, (x, y + 20))
    sheet.save(out / f'{a.prefix}-{n // size}.jpg', quality=94 if a.crop else 90)
print(out, len(frames), 'frames')
