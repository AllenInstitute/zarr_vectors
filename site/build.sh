#!/usr/bin/env bash
# Build the Zarr Vectors site into site/_site/:
#
#   /           the front door (site/hub/) and the ecosystem page
#   /spec/      this repo's docs/, the specification
#   /python/    the docs of AllenInstitute/zarr-vectors-py, pulled from its main at build time
#   /tools/     the docs of AllenInstitute/zarr-vectors-tools, pulled the same way
#
# Every part gets the shared look from site/theme/ (two lines added to a copy of its conf.py; no repo
# is changed). The spec builds strictly, as before: a warning fails the build. The libraries cannot
# break the site: if one fails to fetch or build, its last good build is reused (ZV_LIB_CACHE), or a
# short notice pointing to Read the Docs stands in. Old spec addresses (/04-data-model.html) redirect
# to their new place under /spec/.
#
#   site/build.sh                                  # served from /  (local preview)
#   ZV_BASE=/zarr_vectors/ site/build.sh           # served from that path (GitHub Pages)
#
# Needs git and a Python with site/requirements.txt and the zarr-vectors package (for the API pages).
set -euo pipefail
SITE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$SITE")
BASE=${ZV_BASE:-/}
OUT=${OUT:-$SITE/_site}
SRC=$SITE/.src
CACHE=${ZV_LIB_CACHE:-$SITE/.lib-cache}

export ZV_SITE_URLS=$(cat <<JSON
{"home": "${BASE}", "spec": "${BASE}spec/", "python": "${BASE}python/", "tools": "${BASE}tools/",
 "ecosystem": "${BASE}ecosystem.html"}
JSON
)

rm -rf "$OUT"; mkdir -p "$OUT" "$SRC" "$CACHE"

# themed DOCS KEY: a copy of the docs folder DOCS beside it, with the shared look added; prints its path.
# (A sibling, so paths in conf.py such as ".." still lead where they did.)
themed() {
  local docs=$1 key=$2 copy
  copy="$(dirname "$docs")/.zv-site-docs"
  rm -rf "$copy"; cp -r "$docs" "$copy"; rm -rf "$copy/_build"
  cat >> "$copy/conf.py" <<PY

# -- added by site/build.sh: the shared Zarr Vectors look ---------------------
import sys as _zv_sys; _zv_sys.path.insert(0, "$SITE/theme")
import zv_site; zv_site.apply(globals(), "$key")
PY
  echo "$copy"
}

# 1. the specification, from this repo; strict
echo "building spec from this repo"
spec=$(themed "$REPO/docs" spec)
sphinx-build -q -W --keep-going -b html "$spec" "$OUT/spec"
rm -rf "$spec"

# 2. the libraries, live from their main; never fatal
notice() {  # PATH REPO DOCS-URL: a stand-in page when a library's docs could not be built
  mkdir -p "$OUT/$1"
  cat > "$OUT/$1/index.html" <<HTML
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docs unavailable</title><body style="font: 16px/1.6 system-ui, sans-serif; max-width: 36rem; margin: 15vh auto; padding: 0 1rem">
<h1 style="font-size: 1.5rem">These docs could not be built just now</h1>
<p>The documentation for <a href="https://github.com/$2">$2</a> is also on <a href="$3">Read the Docs</a>.
<p><a href="${BASE}">Zarr Vectors</a></body></html>
HTML
}
grep -v '^\s*#' "$SITE/sources.txt" | while read -r path repo ref docs key rtd; do
  [ -n "$path" ] || continue
  dir=$SRC/${repo#*/}
  ok=1
  if [ -d "$dir/.git" ]; then
    git -C "$dir" fetch -q --depth 1 origin "$ref" && git -C "$dir" checkout -q -f FETCH_HEAD || ok=0
  else
    git clone -q --depth 1 --branch "$ref" "https://github.com/$repo.git" "$dir" || ok=0
  fi
  if [ $ok = 1 ]; then
    echo "building $path from $repo@$(git -C "$dir" rev-parse --short HEAD)"
    copy=$(themed "$dir/$docs" "$key")
    sphinx-build -q -b html "$copy" "$OUT/$path" || ok=0
    rm -rf "$copy"
  fi
  if [ $ok = 1 ]; then
    rm -rf "$CACHE/$path"; cp -r "$OUT/$path" "$CACHE/$path"
  elif [ -d "$CACHE/$path" ]; then
    echo "::warning::$repo docs did not build; using the last good build"
    rm -rf "$OUT/$path"; cp -r "$CACHE/$path" "$OUT/$path"
  else
    echo "::warning::$repo docs did not build and there is no earlier build; publishing a notice"
    rm -rf "$OUT/$path"; notice "$path" "$repo" "$rtd"
  fi
done

# 3. the front door
echo "building the front door"
sphinx-build -q -b html "$SITE/hub" "$OUT"
cp "$SITE/hub/_generated/home.html" "$OUT/index.html"   # the hand-built page replaces Sphinx's index
cp "$SITE/hub/home/home.css" "$SITE/hub/home/home.js" "$OUT/"

# 4. the spec used to live at the root: send its old addresses to /spec/
python3 "$SITE/redirects.py" "$OUT"

touch "$OUT/.nojekyll"
echo "done: $OUT"
