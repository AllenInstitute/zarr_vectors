# The Zarr Vectors site

One site for the project, published from this repo:

| Path | What | Source |
|---|---|---|
| `/` | Front door: what the format is, live scenes, ecosystem | [`hub/home/`](hub/home/) |
| `/ecosystem.html` | Every project around the format | [`hub/ecosystem.yml`](hub/ecosystem.yml) |
| `/spec/` | The specification | this repo's [`docs/`](../docs/) |
| `/python/` | zarr-vectors docs | `docs/` of [AllenInstitute/zarr-vectors-py](https://github.com/AllenInstitute/zarr-vectors-py), at build time |
| `/tools/` | zarr-vectors-tools docs | `docs/` of [AllenInstitute/zarr-vectors-tools](https://github.com/AllenInstitute/zarr-vectors-tools), at build time |

## How the build works ([`build.sh`](build.sh))

- **Nothing is copied into this repo.** The library docs are cloned from their `main` (listed in
  [`sources.txt`](sources.txt)) and built with Sphinx from their own `docs/` folders, so they need no
  changes and no matching versions; what is on their `main` is what is published.
- **One look.** Each part gets the shared theme from [`theme/`](theme/): two lines added to a
  temporary copy of its `conf.py`. It sets the colours from the logo (magenta `#e01073`, `#ff72c0` in
  dark mode), DM Sans and JetBrains Mono (bundled, OFL), the logo's mark, and the top bar that links
  the parts, with a light / dark / auto switch shared across them.
- **The spec builds strictly**, as before: a Sphinx warning fails the build.
- **The libraries cannot break the site.** If one fails to fetch or build, its last good build is
  reused (kept in the Actions cache), or a short notice pointing to its Read the Docs site stands in.
- **Old addresses keep working.** The spec used to be the whole site; [`redirects.py`](redirects.py)
  puts a small page at each old address (`/04-data-model.html`) that forwards to `/spec/`, keeping
  any `#section`.

The workflow runs on every push to `main`, on pull requests (build only), daily, and by hand from the
Actions tab.

## The front door ([`hub/home/`](hub/home/))

A plain page with small 3-D scenes on canvases, no libraries ([`home.js`](hub/home/home.js)):

- **Opening:** the logo's mark opens into a store: its cube becomes the chunk lattice, its nodes
  become vertices.
- **Hero:** points and neuron skeletons in a 4 × 4 × 4 chunk store; a query box follows the cursor,
  or bounces round the store, and lights what a box query returns: the chunks it reads, the points
  inside it, and the skeleton nodes inside it with the edges whose ends are both inside, with a live
  count.
- **Geometries:** one set of vertices becomes points, streamlines, a skeleton, a graph and a mesh as
  the chapters beside it scroll past.
- **Pyramids:** the same points merge into bin centroids, level by level.

Reduced motion skips the opening and all drifting. The page's script and stylesheet are linked with
a version taken from their contents, so a browser never mixes old and new files.

To add a project to the ecosystem lists, add an entry to [`hub/ecosystem.yml`](hub/ecosystem.yml).
