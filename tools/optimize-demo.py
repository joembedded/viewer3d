"""Rebuild the material sample; optionally optimize a supplied panorama."""
import argparse
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--panorama', type=Path, help='Optional original panorama to convert (requires Pillow)')
args = parser.parse_args()
source = (ROOT / 'models' / 'testball.glb').read_bytes()
json_size = struct.unpack_from('<I', source, 12)[0]
model = json.loads(source[20:20 + json_size])
binary = source[28 + json_size:]

# The masonry bump is inappropriate for this metal sample. Keep all geometry
# and remove its image and extension together, including the embedded bytes.
assert len(model['images']) == 1 and len(model['bufferViews']) == 13
binary = binary[:model['bufferViews'][12]['byteOffset']]
model['bufferViews'] = model['bufferViews'][:12]
for key in ('images', 'textures', 'samplers', 'extensionsUsed'):
    model.pop(key, None)
for material in model['materials']:
    material.pop('extensions', None)
    material.pop('emissiveFactor', None)
for material, name, color, metal, roughness in zip(
    model['materials'], ['Polished aluminium', 'Red polymer', 'Satin metal'],
    [[0.72, 0.74, 0.76, 1], [0.36, 0.012, 0.008, 1], [0.66, 0.68, 0.70, 1]],
    [1, 0, 1], [0.10, 0.30, 0.28]
):
    material['name'] = name
    material['pbrMetallicRoughness'] = dict(baseColorFactor=color,
        metallicFactor=metal, roughnessFactor=roughness)
model['buffers'][0]['byteLength'] = len(binary)
encoded = json.dumps(model, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
binary += b'\0' * (-len(binary) % 4)
result = (struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(binary))
    + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
    + struct.pack('<II', len(binary), 0x004E4942) + binary)
(ROOT / 'models' / 'testball-optimized.glb').write_bytes(result)

if args.panorama:
    from PIL import Image
    with Image.open(args.panorama) as panorama:
        panorama.thumbnail((2560, 1280), Image.Resampling.LANCZOS)
        panorama.save(ROOT / 'skyboxes' / 'southern-germany.webp', quality=85, method=6)
for name in ('models/testball-optimized.glb', 'skyboxes/southern-germany.webp'):
    print(name, (ROOT / name).stat().st_size, 'bytes')
