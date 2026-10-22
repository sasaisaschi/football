"""Puts the before/after lab pictures of each scene side by side (half size). Usage: python side-by-side.py <before> <after> <out>"""
import glob, os, sys
from PIL import Image, ImageDraw

before, after, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
for b in sorted(glob.glob(os.path.join(before, '*-before.png'))):
    name = os.path.basename(b).replace('-before.png', '')
    A, B = Image.open(b).convert('RGB'), Image.open(os.path.join(after, name + '-after.png')).convert('RGB')
    w, h = A.size
    img = Image.new('RGB', (w * 2 + 8, h), (6, 11, 22))
    img.paste(A, (0, 0)); img.paste(B, (w + 8, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 260, 34], fill=(6, 11, 22)); d.rectangle([w + 8, 0, w + 268, 34], fill=(6, 11, 22))
    d.text((12, 10), f'vorher (Phase B, 1b262f6) - {name}', fill=(255, 138, 42)); d.text((w + 20, 10), 'nachher (Restarbeiten R5)', fill=(255, 138, 42))
    img.resize((img.width // 2, img.height // 2)).save(os.path.join(out, name + '.jpg'), quality=85)
print(sorted(os.listdir(out)))
