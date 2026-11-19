"""The Zarr Vectors front door: landing page and ecosystem, in the shared look."""

import html
import json
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "theme"))   # site/theme
import zv_site  # noqa: E402

project = "Zarr Vectors"
author = "Allen Institute for Brain Science"
copyright = "Allen Institute for Brain Science"
extensions = ["myst_parser"]
exclude_patterns = ["_build", "_generated", "README.md"]
html_static_path = ["_static"]
html_show_sourcelink = False
html_copy_source = False

zv_site.apply(globals(), "home")

URLS = zv_site.urls()
ICONS = json.load(open(os.path.join(HERE, "_icons.json")))


def fill(text):
    """Replace @key with the site address for key, and @icon:name with that icon."""
    for name, svg in ICONS.items():
        text = text.replace(f"@icon:{name}", svg)
    for key in sorted(URLS, key=len, reverse=True):
        text = text.replace(f'"@{key}"', f'"{URLS[key]}"')
    return text


import re

KEYS = "|".join(sorted(URLS, key=len, reverse=True))


def fill_paths(text):
    """"@key" or "@key<path>" inside an attribute: the site address for key, plus the path."""
    return re.sub(r'"@(' + KEYS + r')([^"]*)"', lambda m: '"' + URLS[m.group(1)] + m.group(2) + '"', text)


def eco_compact():
    groups = yaml.safe_load(open(os.path.join(HERE, "ecosystem.yml")))
    out = []
    for g in groups:
        for it in g["items"]:
            links = dict(it.get("links") or {})
            links["GitHub"] = f'https://github.com/{it["repo"]}'
            a = "".join(f'<a href="{URLS.get(u[1:], u) if u.startswith("@") else u}">{html.escape(k)}</a>' for k, u in links.items())
            out.append(
                f'<div class="eco-item"><div class="eco-head"><h3>{html.escape(it["name"])}</h3>'
                f'<span class="role {it["role"]}">{it["role"]}</span></div>'
                f'<span class="repo">{it["repo"]}</span><p>{html.escape(it["text"])}</p>'
                f'<div class="eco-links">{a}</div></div>'
            )
    return "".join(out)


def theme_icons():
    """Furo's four theme icons, as inline SVG for the front door's toggle."""
    import furo
    src = open(os.path.join(os.path.dirname(furo.__file__), "theme", "furo", "partials", "icons.html")).read()
    out = []
    for sym, cls in (("svg-sun-with-moon", "i-auto-light"), ("svg-moon-with-sun", "i-auto-dark"), ("svg-moon", "i-dark"), ("svg-sun", "i-light")):
        m = re.search(r'<symbol id="' + sym + r'"[^>]*>.*?(<svg .*?</svg>)\s*</symbol>', src, re.S)
        svg = re.sub(r"<title>.*?</title>", "", m.group(1), flags=re.S)
        out.append(svg.replace("<svg ", f'<svg aria-hidden="true" class="{cls}" ', 1))
    return "".join(out)


def home_html():
    text = open(os.path.join(HERE, "home", "index.html.in")).read()
    text = text.replace("@theme-icons", theme_icons())
    for name, svg in ICONS.items():
        text = text.replace(f"@icon:{name}", svg.replace('class="zv-ico"', 'class="zv-ico" aria-hidden="true"'))
    text = text.replace("@github-svg", zv_site.GITHUB_SVG).replace("@ecosystem", eco_compact())
    # version the page's own files by their contents, so a browser never pairs a new page with an old
    # cached script or stylesheet (GitHub Pages lets browsers reuse files for ten minutes unchecked)
    import hashlib
    for name in ("home.css", "home.js"):
        digest = hashlib.sha256(open(os.path.join(HERE, "home", name), "rb").read()).hexdigest()[:10]
        text = text.replace(f'"{name}"', f'"{name}?v={digest}"')
    return fill_paths(text)


def eco_html():
    groups = yaml.safe_load(open(os.path.join(HERE, "ecosystem.yml")))
    out = []
    for g in groups:
        out.append(f'<h2>{html.escape(g["group"])}</h2><div class="zv-eco">')
        for it in g["items"]:
            links = dict(it.get("links") or {})
            links["GitHub"] = f'https://github.com/{it["repo"]}'
            a = "".join(f'<a href="{URLS.get(u[1:], u) if u.startswith("@") else u}">{html.escape(k)}</a>'
                        for k, u in links.items())
            pip = (f'<span class="zv-install"><code>pip install {it["pip"]}</code>'
                   f'<button class="zv-copy" type="button" data-copy="pip install {it["pip"]}">Copy</button></span>'
                   if it.get("pip") else "")
            role = it["role"]
            out.append(
                f'<div class="zv-card"><div class="zv-eco-head"><h3>{html.escape(it["name"])}</h3>'
                f'<span class="zv-role {role}">{role}</span></div>'
                f'<span class="zv-repo">{it["repo"]}</span>'
                f'<p>{html.escape(it["text"])}</p>{pip}<div class="zv-eco-links">{a}</div></div>'
            )
        out.append("</div>")
    return '<div class="zv-wide">' + "\n".join(out) + "</div>"


os.makedirs(os.path.join(HERE, "_generated"), exist_ok=True)
with open(os.path.join(HERE, "_generated", "ecosystem.html"), "w") as f:
    f.write(eco_html() + open(os.path.join(HERE, "_copy.js.html")).read())
with open(os.path.join(HERE, "_generated", "home.html"), "w") as f:
    f.write(home_html())
