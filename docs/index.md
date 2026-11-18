# Zarr Vectors Spec

:::{image} _static/zarr-vectors-logo.png
:alt: Zarr Vectors
:width: 320px
:align: center
:::

> Draft specification for storing large-scale N-dimensional **vector**
> data — point clouds, skeletons, streamlines, meshes, tracks-over-time —
> on top of Zarr v3.  Released to spark conversation.

This specification describes format **0.10.0**.  Its metadata layer is
the [Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors)
v0.1.0; see [§1.4.7](01-introduction.md#147-zarr-conventions-the-metadata-layer).

```{toctree}
:maxdepth: 2
:caption: Specification

01-introduction
02-scope-and-goals
03-terminology-and-concepts
04-data-model
05-zarr-store-structure
06-spatial-indexing
07-core-arrays
08-metadata
09-multi-resolution-support
10-cross-chunk-linking
11-compression-and-encoding
12-geometry-types
13-conformance-and-validation
14-examples
15-appendices
```
