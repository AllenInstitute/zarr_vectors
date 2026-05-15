"""Sphinx configuration for the Zarr Vectors spec site.

This site is pure prose (markdown via MyST) — no Python autodoc.
"""

from __future__ import annotations

# -- Project information -----------------------------------------------------

project = "Zarr Vectors Spec"
author = "Allen Institute"
copyright = "2026, Allen Institute"
release = "draft"

# -- General configuration ---------------------------------------------------

extensions = [
    "myst_parser",
    "sphinx_copybutton",
    "sphinx.ext.autosectionlabel",
]

# Heading-anchor scoping: prefix every label with the document path so two
# chapters can both have e.g. "Overview" headings without collision.
autosectionlabel_prefix_document = True
autosectionlabel_maxdepth = 3

myst_enable_extensions = [
    "colon_fence",       # :::{note} ... :::
    "deflist",
    "fieldlist",
    "tasklist",
    "attrs_inline",
    "dollarmath",
]
myst_heading_anchors = 3

source_suffix = {".md": "markdown"}

exclude_patterns = [
    "_build",
    "Thumbs.db",
    ".DS_Store",
    "design_artifacts/**",
]

templates_path: list[str] = []
html_static_path = ["_static"]

# -- HTML output -------------------------------------------------------------

html_theme = "furo"
html_title = "Zarr Vectors Spec"
html_css_files = ["custom.css"]
html_js_files = [("https://hypothes.is/embed.js", {"async": "async"})]
html_logo = "_static/zarr-vectors-logo.png"
html_favicon = "_static/favicon.png"

html_theme_options = {
    "source_repository": "https://github.com/AllenInstitute/zarr_vectors/",
    "source_branch": "main",
    "source_directory": "docs/",
    "light_css_variables": {
        "color-brand-primary": "#e0195c",
        "color-brand-content": "#e0195c",
    },
    "dark_css_variables": {
        "color-brand-primary": "#ff72c0",
        "color-brand-content": "#ff72c0",
    },
    "sidebar_hide_name": True,  # logo already contains the wordmark
    "footer_icons": [
        {
            "name": "GitHub",
            "url": "https://github.com/AllenInstitute/zarr_vectors",
            "html": (
                '<svg stroke="currentColor" fill="currentColor" '
                'stroke-width="0" viewBox="0 0 16 16" height="1em" width="1em">'
                '<path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 '
                "2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49"
                "-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15"
                "-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33"
                ".66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87"
                ".31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82"
                ".64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82"
                " 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 "
                "3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 "
                '1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"></path></svg>'
            ),
            "class": "",
        },
    ],
}
