# 15. Appendices

## Appendix A: JSON Schema Definitions

The authoritative schema for ZV root, level, and array metadata is
the LinkML model at
`zarr_vectors-py/schema/zarr_vectors.linkml.yaml`.
Tools may derive JSON Schema, Pydantic models, SQLAlchemy classes,
or OWL ontologies from that file using the standard `gen-*` LinkML
generators.

The schema covers:

- Root metadata fields (`RootMetadata`).
- Per-level metadata (`LevelMetadata`).
- Per-array `.zattrs` shapes per `zv_array` discriminator.
- Enumerations: `LinksConvention`, `ObjectIndexConvention`,
  `CrossChunkStrategy`, `CrossLevelStorage`, `GeometryType`,
  `Encoding`, `CoarseningMethod`.

## Appendix B: Zarr Implementation Details

- **Zarr version**: v3 only.
- **Per-array layout**: every ZV array is a 1-D `uint8`,
  single-chunk-per-coord array.  Internal record framing
  (fragment-index, manifest-block, link-record streams) lives in
  project byte layouts inside each chunk's payload, not in Zarr's
  variable-length-chunk feature.
- **Group metadata**: root, level, and per-array `zarr.json` carry
  ZV-specific top-level keys (`zarr_vectors`,
  `zarr_vectors_level`, `zv_array`) alongside the Zarr v3 standard
  `node_type` / `zarr_format` fields.
- **Multi-store hosting**: stores work on any Zarr v3 store backend
  (LocalStore, FsspecStore over S3 / GCS / Azure Blob, in-memory,
  icechunk transactional stores, …).

## Appendix C: Coordinate Reference Systems

- ZV reuses OME-Zarr RFC 4 axes (`name`, `type`, `unit`) and RFC 5
  `coordinateTransformations` (`scale`, `translation`) for per-level
  coordinate transforms.
- The optional `crs` dict on root metadata is opaque to the format —
  it carries an EPSG code, WKT string, or transform pipeline as
  defined by the writer's CRS conventions.
- Per-axis units use UDUNITS-2 names (`"micrometer"`, `"second"`,
  …).  The format does not stamp placeholder unit strings — unknown
  units must be omitted.

## Appendix D: Compression Codec Reference

Default per-array codec pipelines (from
`zarr_vectors.encoding.compression`):

| Array                                 | Compressor              | Shuffle           |
|---------------------------------------|-------------------------|-------------------|
| `vertices`                            | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `vertex_attributes/<name>`            | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `vertex_fragments`                    | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `link_fragments`                      | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `links/<delta>`                       | Blosc(Zstd, clevel=5)   | BITSHUFFLE        |
| `object_index`                        | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `object_attributes/<name>`            | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `groups`                              | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `group_attributes/<name>`             | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `cross_chunk_links/<delta>`           | Blosc(Zstd, clevel=5)   | BYTE-SHUFFLE      |
| `cross_chunk_link_attributes/<name>/<delta>` | Blosc(Zstd, clevel=5) | BYTE-SHUFFLE  |

Mesh stores may use Draco-encoded vertex+face co-encoding instead of
the raw Blosc pipeline; the per-array `.zattrs.encoding = "draco"`
field flags this.  Draco output is already compressed, so the Zarr
codec pipeline is left empty (or wrapped in a minimal pass-through
codec).

The fragment-index byte layout (§7.3) and manifest-block stream
(§7.6) are **not** Zarr codecs — they are project-internal record
framings carried as the raw bytes inside single-chunk `uint8`
arrays.

## Appendix E: Downsampling Algorithms

The reference implementation provides one coarsening strategy:

- **Per-object coarsening** (`coarsening_method = "per_object"`):
  each level's vertices are produced by reducing each surviving
  object's fragments to one metavertex per coarse-bin, with attribute
  reduction following the per-attribute convention (mean / mode /
  sum, declared in the array metadata).  Object identity is
  preserved (`preserves_object_ids = true`); dropped objects leave
  empty manifest slots.

Future strategies (mesh edge-collapse decimation, skeleton path
simplification, streamline point reduction) plug into the same
`coarsening_method` slot; see `zarr_vectors.multiresolution`.

## Appendix F: Query Patterns

Common access patterns and which arrays they touch:

| Pattern                              | Arrays read                                                              |
|--------------------------------------|--------------------------------------------------------------------------|
| Bounding-box at one level            | `vertices/<chunk>` for intersected chunks                                |
| Per-bin sub-chunk filter             | `vertex_fragments/<chunk>` → row-slice into `vertices/<chunk>`           |
| Single object reconstruction         | `object_index/data` → per-chunk `vertex_fragments/<chunk>` → `vertices/` |
| All objects in a group               | `groups/data` → object ids → `object_index/data` → vertices              |
| Per-object attribute query           | `object_attributes/<name>/data` (no vertex read)                         |
| Pyramid drill-down (fine → coarse)   | `links/+1/<chunk>` (when `cross_level_storage != "none"`)                |
| Cross-chunk traversal                | `cross_chunk_links/0/data`                                               |

## Appendix G: Migration Guide

There is no in-place migration utility across major ZV versions
(0.4 → 0.5 → 0.6 → 0.7).  Each step changed the on-disk record
layout in a way that breaks readers built for the previous version;
stores must be **rewritten from source**.

See Appendix K below for the per-version summary.

## Appendix H: Performance Considerations

- **Chunk size**: larger chunks amortise per-chunk overhead at the
  cost of larger minimum-read units.  v0.7 lets coarser pyramid
  levels grow `chunk_shape` independently of level 0.
- **Bin grid**: enabling a per-chunk bin grid (`base_bin_shape`)
  lets point-cloud queries narrow to individual bins without
  decoding the whole chunk — important when `vertex_count_per_chunk
  > 100k`.
- **Fragment vs object granularity**: fragments are the unit of
  pyramid coarsening and re-use.  When objects are very small
  (one fragment apiece, like nuclei), fragments and objects
  correspond 1-to-1; when objects are very large (a neuron with
  10⁵ vertices), fragments naturally chunk the object's vertices.
- **Per-link attributes**: `link_attributes/<name>/<delta>/<chunk>`
  read cost scales with the number of link rows in `links/<delta>/<chunk>`
  — the same fragment index that partitions vertices partitions
  these attributes.

## Appendix I: Extensibility

- **Custom geometry types**: writers may add a new value to
  `geometry_types` outside the canonical set (`point_cloud`,
  `line`, `polyline`, `streamline`, `skeleton`, `graph`, `mesh`),
  at the cost of dropping conformance-level checks for that
  geometry.
- **Custom metadata**: arbitrary keys may be added under the
  `zarr_vectors` or `zarr_vectors_level` namespaces; readers
  should ignore unknown keys.
- **Capability tokens**: stores advertise optional features via
  `format_capabilities`.  Readers that don't recognize a token
  must either treat the corresponding feature as absent or refuse
  to open the store.
- **Version evolution**: hard-break version bumps (0.4 → 0.5 → 0.6
  → 0.7) are the project's only versioning mechanism; no shim
  layer ships with the implementation.

## Appendix J: References

- TRX format specification:
  <https://tee-ar-ex.github.io/trx-python/stable/trx_specifications.html>
- Zarr v3 specification: <https://zarr-specs.readthedocs.io/>
- OME-Zarr (NGFF) specification: <https://ngff.openmicroscopy.org/>
- LinkML: <https://linkml.io/>
- Neuroglancer precomputed mesh format:
  <https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/meshes.md>

## Appendix K: Change Log

Each entry is a hard break — no migration utility ships; rewrite
stores from source between major versions.

- **0.7.0** — per-level `chunk_shape` override on `LevelMetadata`.
  `RootMetadata.chunk_shape` remains the level-0 default; pyramid
  levels may carry a positive-integer-multiple chunk-shape override
  so coarser levels can grow chunks the way OME-Zarr image
  pyramids do via voxel-size scaling.  Cross-pyramid-level link
  arrays already carry both endpoints' chunk coords inline; the
  per-axis multiplier is exposed by
  `chunk_scale_factor(root, level)`.

- **0.6.0** — fragment-index schema.  `vertex_group_offsets` was
  replaced by `vertex_fragments` (a v1 byte layout with header,
  range bitmap, range table, and CSR explicit list — see §7.3).
  Inline self-describing link blobs at `delta = 0` were split into
  `links/0/<chunk>` (flat payload) + `link_fragments/<chunk>`
  (fragment index).  `object_index/data` adopted the manifest-block
  encoding (modes 0 / 1 / 2 — single / range / explicit) with
  chunk-local fragment references.  The `shared_vertex_groups`
  capability token was renamed to `shared_fragments` and the new
  `fragment_index` capability is mandatory.

- **0.5.0** — NGFF alignment + format simplification.  Several
  on-disk simplifications shipped without a version bump (consumers
  should pin to a specific point release): renamed
  `format_version` → `zv_version`; moved axes to NGFF
  `multiscales[0].axes`; dropped per-array dtype duplication;
  removed `vertex_counts/`, `metanode_children/`, `cross_chunk_faces/`,
  `attributes/<name>/<key>_offsets`, and `object_index/pending/`;
  replaced the `(K, 2)` paired offset layout with a flat `(K,)` int64
  array of vertex offsets (later replaced again by the fragment
  index in 0.6).

- **0.4.1** — bare-integer resolution-level group names (`0/`, `1/`).
  Renamed from `resolution_0/`, `resolution_1/`, … to mirror OME-Zarr.

- **0.4** — multiscale-link arrays.  Introduced the `<delta>`
  sub-folder layout for `links/`, `cross_chunk_links/`,
  `link_attributes/`, and `cross_chunk_link_attributes/` and the
  `cross_level_depth` / `cross_level_storage` writer knobs.  This
  is the version where cross-pyramid-level links became
  expressible.
