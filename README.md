<p align="center">
  <img src="docs/_static/zarr-vectors-logo.png" alt="Zarr Vectors" width="320">
</p>

# Zarr Vectors Spec

**Published site:** https://alleninstitute.github.io/zarr_vectors/ (the spec is at [`/spec/`](https://alleninstitute.github.io/zarr_vectors/spec/), beside the [Python](https://alleninstitute.github.io/zarr_vectors/python/) and [tools](https://alleninstitute.github.io/zarr_vectors/tools/) docs)

This is a draft repo exploring what a zarr-based storage specification would be for large-scale N-dimensional "vector" data formats.  *Vectors* here means places where the location in an N-dimensional space is represented by the coordinates of each entity in that space, as opposed to most zarr-based data where you have a dense array of values and the index into that array represents space.  Examples include point clouds, skeletons, streamlines, meshes, tracks over time, etc.

## Statement of support

This specification was developed as a draft to explore whether a single specification framework could cover a wide array of use cases using zarr as the fundamental storage backend technology.  Comments or refinements are welcome if others find this exercise useful — it is being released to spark conversation.

## Repo layout

- [`docs/`](docs/) — the 15 numbered spec chapters (rendered as the published site).
- [`docs/images/`](docs/images/) — illustrations + the matplotlib script that regenerates them.
- [`docs/design_artifacts/`](docs/design_artifacts/) — earlier design notes kept for historical context.
- [`site/`](site/) — the project site around the spec: the front door, the shared look, and the build that pulls in the Python and tools docs (see [`site/README.md`](site/README.md)).

## Building the spec locally

```bash
pip install -r docs/requirements.txt
sphinx-build -b html -W docs docs/_build/html
open docs/_build/html/index.html
```

## Building the whole site

```bash
pip install -r site/requirements.txt zarr-vectors
site/build.sh                      # into site/_site/
python -m http.server -d site/_site 8000
```

The site deploys to GitHub Pages on every push to `main`, and once a day to pick up docs changes in the library repos, via [`.github/workflows/docs.yml`](.github/workflows/docs.yml). Pull requests build it without deploying.
