"""Shared look for every Zarr Vectors docs site (front door, spec, Python, tools).

Each site's conf.py ends with:

    import zv_site
    zv_site.apply(globals(), "spec")      # or "home", "python", "tools"

It sets the Furo colours and fonts, the favicon and sidebar mark, and the top
bar that links the sites together. Each site keeps its own custom.css for
page-specific rules; zv.css loads after it, so the shared colours win.

Where each part lives is read from ZV_SITE_URLS (JSON, key -> URL), which
site/build.sh sets; without it, the published addresses are used.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

MAGENTA = "#e01073"        # the logo's magenta
MAGENTA_DARK = "#ff72c0"   # the same accent, lifted for dark backgrounds

DEFAULT_URLS = {
    "home": "https://alleninstitute.github.io/zarr_vectors/",
    "spec": "https://alleninstitute.github.io/zarr_vectors/spec/",
    "python": "https://alleninstitute.github.io/zarr_vectors/python/",
    "tools": "https://alleninstitute.github.io/zarr_vectors/tools/",
    "ecosystem": "https://alleninstitute.github.io/zarr_vectors/ecosystem.html",
    "ngplatform": "https://alleninstitute.github.io/ngplatform/",
    "github": "https://github.com/AllenInstitute/zarr_vectors",
}

LINKS = [  # (key, label) in the order they appear in the top bar
    ("spec", "Spec"),
    ("python", "Python"),
    ("tools", "Tools"),
    ("ecosystem", "Ecosystem"),
    ("ngplatform", "ngplatform"),
]

TITLES = {
    "home": "Zarr Vectors",
    "spec": "Zarr Vectors Spec",
    "python": "zarr-vectors",
    "tools": "zarr-vectors-tools",
}

GITHUB_SVG = (
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">'
    '<path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 '
    "0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 "
    "1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15"
    "-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 "
    "2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 "
    "1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z\"></path></svg>"
)


# Furo's own toggle (light, dark, auto); its script cycles every .theme-toggle on the page
THEME_TOGGLE = (
    '<span class="theme-toggle-container zv-theme">'
    '<button class="theme-toggle" aria-label="Toggle Light / Dark / Auto color theme">'
    '<svg class="theme-icon-when-auto-light"><use href="#svg-sun-with-moon"></use></svg>'
    '<svg class="theme-icon-when-auto-dark"><use href="#svg-moon-with-sun"></use></svg>'
    '<svg class="theme-icon-when-dark"><use href="#svg-moon"></use></svg>'
    '<svg class="theme-icon-when-light"><use href="#svg-sun"></use></svg>'
    "</button></span>"
)


def urls():
    u = dict(DEFAULT_URLS)
    u.update(json.loads(os.environ.get("ZV_SITE_URLS", "{}")))
    return u


def topbar(site, u, mark_src):
    items = []
    for key, label in LINKS:
        here = ' aria-current="page"' if key == site else ""
        ext = key == "ngplatform"
        items.append(
            f'<a class="zv-bar-link" href="{u[key]}"{here}>{label}'
            + ('<span class="zv-ext" aria-hidden="true">&#8599;</span>' if ext else "")
            + "</a>"
        )
    return (
        '<nav class="zv-bar" aria-label="Zarr Vectors sites">'
        f'<a class="zv-bar-home" href="{u["home"]}"><img src="{mark_src}" alt="" width="30" height="20">'
        '<span>Zarr Vectors</span></a>'
        f'<span class="zv-bar-links">{"".join(items)}</span>'
        '<span class="zv-bar-end">'
        f'{THEME_TOGGLE}'
        f'<a class="zv-bar-gh" href="{u["github"]}" aria-label="Zarr Vectors on GitHub">{GITHUB_SVG}</a>'
        '</span>'
        "</nav>"
    )


def apply(conf, site):
    """Give the Sphinx config in `conf` (a conf.py's globals()) the shared look."""
    u = urls()
    conf["html_theme"] = "furo"
    conf["html_title"] = TITLES[site]

    static = list(conf.get("html_static_path", []))
    static.append(os.path.join(HERE, "static"))
    conf["html_static_path"] = static
    css = [c for c in conf.get("html_css_files", []) if c != "zv.css"]
    conf["html_css_files"] = css + ["zv.css"]          # after the site's own custom.css

    conf["html_logo"] = os.path.join(HERE, "static", "zv-mark.png")
    conf["html_favicon"] = os.path.join(HERE, "static", "favicon.png")

    opts = dict(conf.get("html_theme_options", {}))
    light = dict(opts.get("light_css_variables", {}))
    dark = dict(opts.get("dark_css_variables", {}))
    light.update({
        "color-brand-primary": MAGENTA,
        "color-brand-content": MAGENTA,
        "color-sidebar-link-text--top-level": "var(--color-foreground-primary)",
        "font-stack": "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
        "font-stack--monospace": "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-stack--headings": "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    })
    dark.update({"color-brand-primary": MAGENTA_DARK, "color-brand-content": MAGENTA_DARK,
                 "color-sidebar-link-text--top-level": "var(--color-foreground-primary)"})
    opts["light_css_variables"] = light
    opts["dark_css_variables"] = dark
    opts["sidebar_hide_name"] = False
    # pages sit at different depths, so the bar points at the site's own copy of the mark by full address
    mark_src = u[site].rstrip("/") + "/_static/zv-mark.png"
    opts["announcement"] = topbar(site, u, mark_src)
    conf["html_theme_options"] = opts
