<p align="center">
  <img src="docs/_static/zarr-vectors-logo.png" alt="Zarr Vectors" width="320">
</p>

# Zarr Vectors Spec

**Published site:** https://alleninstitute.github.io/zarr_vectors/

This is a draft repo exploring what a zarr-based storage specification would be for large-scale N-dimensional "vector" data formats.  *Vectors* here means places where the location in an N-dimensional space is represented by the coordinates of each entity in that space, as opposed to most zarr-based data where you have a dense array of values and the index into that array represents space.  Examples include point clouds, skeletons, streamlines, meshes, tracks over time, etc.

## Format version

This repo describes Zarr Vectors format **0.10.0**.  The format's
metadata layer is the registered
[Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors)
(v0.1.0): every node keeps its properties in one `zarr_vectors`
attribute and registers the convention in `zarr_conventions`.  The store
also uses the [multiscales](https://github.com/zarr-conventions/multiscales)
and [proj](https://github.com/zarr-conventions/proj) conventions and an
OME-Zarr RFC 8 `ome` node.  Cell payloads are byte-for-byte those of
0.9.4.  Stores written as 0.9.x migrate in place by rewriting metadata
only; see the change log (Appendix J).

The reference implementation is
[zarr-vectors-py](https://github.com/AllenInstitute/zarr-vectors-py).

## Statement of support

This specification was developed as a draft to explore whether a single specification framework could cover a wide array of use cases using zarr as the fundamental storage backend technology.  Comments or refinements are welcome if others find this exercise useful — it is being released to spark conversation.

## Repo layout

- [`docs/`](docs/) — the 15 numbered spec chapters (rendered as the published site).
- [`docs/images/`](docs/images/) — illustrations + the matplotlib script that regenerates them.
- [`docs/design_artifacts/`](docs/design_artifacts/) — earlier design notes kept for historical context.

## Building the site locally

```bash
pip install -r docs/requirements.txt
sphinx-build -b html -W docs docs/_build/html
open docs/_build/html/index.html
```

The site auto-deploys to GitHub Pages on every push to `main` via [`.github/workflows/docs.yml`](.github/workflows/docs.yml).
