#!/usr/bin/env python3
"""Build one self-contained HTML file from index.html.

Inlines live.css, app.js and every img/ and brand/ file that index.html
references (PNG -> WebP, SVG as-is), so the page works when it is opened or
served without the files that sit next to it.

    python3 -I site/landing/build-standalone.py
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / 'bridgecast-landing.html'
REF = re.compile(r'\b((?:img|brand)/[A-Za-z0-9_.-]+\.(?:png|svg|webp))')


def data_uri(rel: str) -> str:
    path = HERE / rel
    if path.suffix == '.svg':
        return 'data:image/svg+xml;base64,' + base64.b64encode(path.read_bytes()).decode()
    im = Image.open(path)
    if rel.endswith('digioh-logo-white.png'):
        # shown at 115x32, so 4x is plenty (the source is 8000px wide)
        im = im.resize((460, round(460 * im.height / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=88, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    html = (HERE / 'index.html').read_text()
    css = (HERE / 'live.css').read_text()
    js = (HERE / 'app.js').read_text()

    html = html.replace('<link rel="stylesheet" href="live.css" />', '<style>\n' + css + '\n</style>', 1)
    html = html.replace('<script src="app.js" defer></script>', '<script>\n' + js + '\n</script>', 1)

    cache: dict[str, str] = {}

    def sub(m: re.Match) -> str:
        rel = m.group(1)
        if rel not in cache:
            cache[rel] = data_uri(rel)
        return cache[rel]

    html = REF.sub(sub, html)
    leftovers = REF.findall(html)
    assert not leftovers, leftovers
    OUT.write_text(html)
    print(f'{OUT.name}: {OUT.stat().st_size / 1024:.0f} KB, {len(cache)} assets inlined')


if __name__ == '__main__':
    main()
