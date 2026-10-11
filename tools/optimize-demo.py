"""Build demo derivatives without modifying source assets. Requires Pillow."""
import json
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'testball.glb').read_bytes()
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
(ROOT / 'testball-optimized.glb').write_bytes(result)

with Image.open(ROOT / '2912x_southern_germany.jpg') as panorama:
    panorama.thumbnail((2560, 1280), Image.Resampling.LANCZOS)
    panorama.save(ROOT / 'southern-germany.webp', quality=85, method=6)
for name in ('testball-optimized.glb', 'southern-germany.webp'):
    print(name, (ROOT / name).stat().st_size, 'bytes')
