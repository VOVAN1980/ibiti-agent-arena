"""Make the certificate pictures that go on-chain from the artwork files.

    python art/certificate/shrink.py <folder with IBITI-Arena-<metal>-Artwork.svg>

Each artwork file is an SVG that wraps one 1536x1024 PNG (drawn with ChatGPT, no text in it).
The PNG is shrunk to 768x512 and saved here as a baseline JPEG: every wallet, explorer and
browser can show a JPEG inside an SVG. ArenaArt writes the words over it.

The JPEG gets a comment ("IBITI Agent Arena" and spaces) that makes its length a multiple of 27.
ArenaArt keeps the picture on-chain already base64-encoded three times, the form it takes inside
tokenURI, and that is only possible when every layer of the encoding ends on a whole group.
"""
import base64, io, re, sys
from pathlib import Path
from PIL import Image

QUALITY = {'gold': 74, 'silver': 74, 'bronze': 74, 'graphite': 78}
src, here = Path(sys.argv[1]), Path(__file__).parent


def comment(jpeg: bytes) -> bytes:
    """The JPEG with a COM segment after its start marker, padded to a multiple of 27 bytes."""
    words = b'IBITI Agent Arena'
    extra = 4 + len(words)  # marker, length, words
    while (len(jpeg) + extra) % 27:
        extra += 1
    payload = words + b' ' * (extra - 4 - len(words))
    segment = b'\xff\xfe' + (len(payload) + 2).to_bytes(2, 'big') + payload
    return jpeg[:2] + segment + jpeg[2:]


for metal, q in QUALITY.items():
    svg = (src / f'IBITI-Arena-{metal}-Artwork.svg').read_text(encoding='utf-8')
    png = base64.b64decode(re.search(r'data:image/png;base64,([^"\']+)', svg).group(1))
    im = Image.open(io.BytesIO(png)).convert('RGB').resize((768, 512), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=q, optimize=True)
    jpeg = comment(out.getvalue())
    assert len(jpeg) % 27 == 0
    (here / f'{metal}.jpg').write_bytes(jpeg)
    Image.open(here / f'{metal}.jpg').load()  # still a JPEG
    print(metal, len(jpeg), 'bytes')
