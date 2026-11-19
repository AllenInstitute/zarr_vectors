"""The spec used to be the whole site; it now lives under /spec/. For every spec page, put a small
page at its old address that sends the reader on, keeping any #section in the link."""

import html
import os
import sys

out = sys.argv[1]
spec = os.path.join(out, "spec")
made = 0
for root, dirs, files in os.walk(spec):
    dirs[:] = [d for d in dirs if not d.startswith("_")]          # _static, _sources, _images
    for name in files:
        if not name.endswith(".html"):
            continue
        rel = os.path.relpath(os.path.join(root, name), spec)
        old = os.path.join(out, rel)
        if os.path.exists(old):                                    # the front door's own pages win
            continue
        target = "../" * rel.count(os.sep) + "spec/" + rel.replace(os.sep, "/")
        t = html.escape(target, quote=True)
        os.makedirs(os.path.dirname(old), exist_ok=True)
        with open(old, "w") as f:
            f.write(
                '<!doctype html><html lang="en"><meta charset="utf-8">'
                f'<title>Moved</title><link rel="canonical" href="{t}">'
                f'<meta http-equiv="refresh" content="0; url={t}">'
                f'<script>location.replace({target!r} + location.hash)</script>'
                f'<p>This page has moved to <a href="{t}">{t}</a>.</p></html>\n'
            )
        made += 1
print(f"redirects: {made} old spec addresses point to spec/")
