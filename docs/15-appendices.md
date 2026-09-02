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
- **Per-array layout**: each per-spatial-chunk array is a single
  vlen-bytes array over the level's chunk grid, one cell per chunk,
  cell files at `c/<i>/<j>/<k>`; the non-spatial arrays are single
  ragged or dense arrays at their logical path.  Internal record
  framing (fragment-index, manifest-block, link-record streams) lives
  in project byte layouts inside each cell's payload.
- **Cell addressing**: chunk at absolute coord `c` → cell
  `c - chunk_grid_origin`; occupied cells are listed in the array's
  `nonempty_chunks` attribute.
- **Sharding**: optional, via Zarr v3's native `sharding_indexed`
  codec.  There is no ZV-specific shard format.
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

| Array                                        | Dtype                                                                | Compressor                                                                                          | Shuffle      |
|----------------------------------------------|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|--------------|
| `vertices`                                   | user-declared (float or integer; see [§7.1](07-core-arrays.md#71-vertex-positions)) | Blosc(Zstd, clevel=5)                                                                 | BYTE-SHUFFLE |
| `vertex_attributes/<name>`                   | user-declared                                                         | Blosc(Zstd, clevel=5)                                                                               | BYTE-SHUFFLE |
| `fragment_attributes/<name>`                 | user-declared                                                         | Blosc(Zstd, clevel=5)                                                                               | BYTE-SHUFFLE |
| `vertex_fragments`                           | opaque `uint8` ([§7.3](07-core-arrays.md#73-vertex-fragments))       | none — opaque bytes (see [§11.4](11-compression-and-encoding.md#114-compression-strategy))          | —            |
| `link_fragments`                             | opaque `uint8` ([§7.5](07-core-arrays.md#75-vertex-links))           | none — opaque bytes (see [§11.4](11-compression-and-encoding.md#114-compression-strategy))          | —            |
| `links/<delta>/<offsets>`                    | user-declared integer (width chosen to fit `n_vertices_in_chunk`; see [§7.5](07-core-arrays.md#75-vertex-links)) | Blosc(Zstd, clevel=5)                                          | BITSHUFFLE   |
| `link_attributes/<name>/<delta>/<offsets>`   | user-declared                                                         | Blosc(Zstd, clevel=5)                                                                               | BYTE-SHUFFLE |
| `object_index/manifests`                     | vlen-bytes (opaque manifest blob — [§7.6](07-core-arrays.md#76-object-index)) | Blosc(Zstd, clevel=5)                                                                       | BYTE-SHUFFLE |
| `object_attributes/<name>`                   | user-declared                                                         | Blosc(Zstd, clevel=5)                                                                               | BYTE-SHUFFLE |
| `groups`                                     | vlen-bytes (per-group `int64` id lists)                               | Blosc(Zstd, clevel=5)                                                                               | BYTE-SHUFFLE |
| `group_attributes/<name>`                    | user-declared                                                         | Blosc(Zstd, clevel=5)                                                                               | BYTE-SHUFFLE |

Any of these may additionally be wrapped in `sharding_indexed` by
supplying a `shard_shape`; sharding composes with the codec, it does
not replace it.  Note that this table is the *recommended* pipeline —
the default is no compressor at all (see
[§11.3](11-compression-and-encoding.md)).

Mesh stores may use Draco-encoded vertex+face co-encoding instead of
the raw Blosc pipeline; the per-array `.zattrs.encoding = "draco"`
field flags this.  Draco output is already compressed, so the Zarr
codec pipeline is left empty (or wrapped in a minimal pass-through
codec).

The fragment-index byte layout ([§7.3](07-core-arrays.md#73-vertex-fragments)) and manifest-block stream
([§7.6](07-core-arrays.md#76-object-index)) are **not** Zarr codecs — they are project-internal record
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
| Bounding-box at one level            | `vertices` cells for intersected chunks                                  |
| Per-bin sub-chunk filter             | `vertex_fragments` cell → row-slice into the `vertices` cell             |
| Single object reconstruction         | `object_index/manifests[oid]` → per-chunk `vertex_fragments` → `vertices` |
| All objects in a group               | `groups[gid]` → object ids → `object_index/manifests` → vertices         |
| Per-object attribute query           | `object_attributes/<name>` (no vertex read)                              |
| Enumerate occupied chunks            | the array's `nonempty_chunks` attribute — no store listing               |
| Pyramid drill-down (fine → coarse)   | `links/+1/<offsets>` (when `cross_level_storage != "none"`)              |
| Links leaving chunk `c` in direction `d` | `links/0/<offsets for d>` at cell `c - chunk_grid_origin` — one cell read |
| All links incident on chunk `c`      | one cell read per offsets segment under `links/0/`; a single cell if the family uses `store = "duplicate"` |

## Appendix G: Migration Guide

There is no in-place migration utility across major ZV versions.  Each
step changed the on-disk record layout in a way that breaks readers
built for the previous version; stores must be **rewritten from
source**.

The 0.7 → 0.8 step was briefly an exception — it shipped a one-shot
helper that repartitioned the monolithic cross-chunk-link blob into
the sharded per-tuple layout.  **That helper is obsolete.**  0.9
changed the physical form of every per-spatial-chunk array *and*
re-keyed cross-chunk records from endpoint tuples to source chunks, so
a 0.8 store has nothing at a path a 0.9 reader looks at, and the two
families' cell sets do not correspond.  See
[§10.9](10-cross-chunk-linking.md#109-migration-to-v09).

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
  read cost scales with the number of link rows in the cell of
  `links/<delta>/<offsets>`
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
- Neuroglancer precomputed annotation format:
  <https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/annotations.md>
  (see Appendix L for the mapping to zarr-vectors).

## Appendix K: Change Log

ZV is versioned per-feature, not per-release: every entry below
describes a breaking on-disk change made under a single version bump.
Each major version is a hard break — rewrite stores from source
between versions.  The 0.7 → 0.8 step once shipped an in-place helper;
0.9 obsoleted it (see [§10.9](10-cross-chunk-linking.md#109-migration-to-v09)),
so there is now no version pair with a migration path.

### Version-at-a-glance

| Version | Headline change | New capability tokens | Hard break? | Migration |
|---------|-----------------|-----------------------|-------------|-----------|
| **0.9** | Single vlen array per per-chunk array (cells over the chunk grid); `cross_chunk_links` merged into `links/<delta>/<offsets>/` | — (retires `partitioned_cross_chunk_links`) | Yes | Rewrite |
| **0.8.1** | Flat single-array layout for the dense / ragged arrays; `present_mask` replaced by `fill_value` | — | Yes | Rewrite |
| **0.8** | Partitioned `cross_chunk_links/<delta>/` (kN array cells keyed by sorted unique chunks) | `partitioned_cross_chunk_links` | Yes | In-place helper *(obsoleted by 0.9)* |
| **0.7** | Per-level `chunk_shape` override (`LevelMetadata.chunk_shape`); pyramid levels may grow chunks | — | Yes | Rewrite |
| **0.6** | Fragment-index byte layout for `vertex_fragments/` + `link_fragments/`; manifest-block `object_index/data` | `fragment_index`, `shared_fragments` (replaces `shared_vertex_groups`) | Yes | Rewrite |
| **0.5** | NGFF axis alignment; `format_version` → `zv_version`; flat `(K,)` vertex-offset layout; drops `vertex_counts/`, `metanode_children/`, `cross_chunk_faces/`, `object_index/pending/` | — | Yes | Rewrite |
| **0.4.1** | Bare-integer level group names (`0/`, `1/`, …) | — | Yes (path-only) | Rewrite |
| **0.4** | `<delta>` sub-folder layout for `links/`, `cross_chunk_links/`, `link_attributes/`, `cross_chunk_link_attributes/`; cross-pyramid-level link arrays | `multiscale_links` | Yes | Rewrite |

### Cumulative capability set as of v0.9

A v0.9 store may carry any subset of:

- `multiscale_links` (any `delta ≠ 0` link array present; first
  available in 0.4.  Since 0.9 it says nothing about chunk-spanning
  records, only level-spanning ones)
- `fragment_index` (mandatory in 0.6+)
- `shared_fragments` (per-chunk fragments referenced by multiple
  object manifests; renamed from `shared_vertex_groups` in 0.6)
- `preserved_object_ids` (per-object pyramid retained the parent's
  OID space; available since 0.4)

Tokens are open-set; readers must tolerate unknown values.

### Per-version detail

- **0.9.0** — two independent on-disk breaks, shipped together.

  *One array per logical array.*  Every per-spatial-chunk array —
  `vertices`, `vertex_fragments`, `link_fragments`,
  `links/<delta>/<offsets>`, `vertex_attributes/<name>`,
  `fragment_attributes/<name>`,
  `link_attributes/<name>/<delta>/<offsets>` — becomes **one** Zarr v3
  vlen-bytes array whose shape is the level's chunk grid, with one
  cell per spatial chunk and its file at `<array>/c/<i>/<j>/<k>`.
  This replaces the layout in which every spatial chunk was its own
  single-chunk `uint8` sub-array under a per-array group.  A chunk at
  absolute coord `c` lands in cell `c - origin`, where
  `origin = floor(min_corner / chunk_shape)` is stored as the array's
  `chunk_grid_origin` attribute (absent ⇒ zero origin), which lets
  data with negative coordinates map onto a 0-indexed array.
  Non-empty cells are tracked in `nonempty_chunks` for O(1)
  enumeration.  An optional `shard_shape` wraps the cells in Zarr v3's
  `sharding_indexed` codec.  See
  [§5.2](05-zarr-store-structure.md#52-zarr-version-requirements).

  *One connectivity family.*  `cross_chunk_links` and
  `cross_chunk_link_attributes` are **merged into** `links` and
  `link_attributes`.  Connectivity is one family: an intra-chunk link
  is just a link whose relative chunk offset is zero.
  `links/<delta>` becomes a **group** whose children are one rank-D
  vlen array per relative-offset segment
  (`links/<delta>/<offsets>`, cell = the record's *source* chunk,
  `vi_k` local to `src + o_k`), and
  `link_attributes/<name>/<delta>/<offsets>` mirrors it exactly — same
  offsets, same cells, same row order.  Endpoint tuples are no longer
  part of any path, so both families are ordinary chunk-grid arrays
  and shard like everything else.  The
  `partitioned_cross_chunk_links` capability token is retired and
  `multiscale_links` narrows to mean only "`delta ≠ 0` arrays are
  present".  See
  [§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family).

  Migration: **rewrite from source**; the 0.7 → 0.8 helper does not
  apply ([§10.9](10-cross-chunk-linking.md#109-migration-to-v09)).

- **0.8.1** — flat single-array layout for the dense and ragged
  arrays.  Removes the `group`-with-a-`data`-child pattern used by
  every non-spatial array (`object_attributes`, `group_attributes`,
  `groups`, the parametric blobs) and writes each logical array as a
  single standard Zarr v3 array at its logical path.  Sparse coverage
  is expressed through the array's own `fill_value` — NaN for floats,
  a sentinel for integers — instead of a sibling `present_mask`
  child array, so absence is in-band and cannot desynchronize from
  the data.  Ragged arrays move to the vlen-bytes codec, matching what
  `object_index/manifests` already used.  Custom per-array attributes
  move from the parent group's `attributes` block into the array's
  own.  Migration: rewrite.

- **0.8.0** — sharded cross-chunk-link layout
  ([§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)).
  The single monolithic `cross_chunk_links/<delta>/data` int64 blob
  (and its parallel
  `cross_chunk_link_attributes/<name>/<delta>/data`) is replaced by
  **K-separated sharded vlen-bytes zarr arrays** — one `kK` sub-array
  per distinct K (`1 ≤ K ≤ link_width`) under
  `cross_chunk_links/<delta>/`.  Each `kK` array is N-D with shape
  `(Cx,…) * K` (one cell per sorted-unique chunk tuple), inner
  chunks of `(1,)*(sid_ndim*K)`, outer shards of `(4,)*(sid_ndim*K)`
  by default, and the zarr v3 `sharding_indexed` + `vlen_bytes`
  codecs.  Each record's encoding drops from `link_width * (sid_ndim + 1) * 8`
  bytes (chunk coords baked into the payload) to `9 * link_width`
  bytes (chunk identity recovered from the cell coord's K segments
  via a per-endpoint `uint8` chunk-index in the record).
  Canonicalization rule: `delta=0, link_width=2` records MUST emit
  `ci = [0, 1]` (one orientation per undirected edge).  New
  `layout = "sharded_v1"` discriminator stamped on every
  `cross_chunk_links/<delta>/` parent group `.zattrs`; new
  `partitioned_cross_chunk_links` capability token, coupled with
  `multiscale_links` (any store with a `cross_chunk_links/<delta>/`
  group MUST carry both).  `num_links` is no longer at the group
  level — per-cell counts are derivable from cell byte length
  (`len(bytes) / (9 * link_width)`).  Migration: **in-place helper**
  that regroups records by their sorted unique
  chunks, rewrites the leaves, and bumps `zv_version` —
  see [§10.9](10-cross-chunk-linking.md#109-migration-to-v09).

- **0.7.0** — per-level `chunk_shape` override on `LevelMetadata`
  ([§6.6](06-spatial-indexing.md#66-per-level-chunk-shape-v07)).
  `RootMetadata.chunk_shape` remains the level-0 default; pyramid
  levels may carry a positive-integer-multiple chunk-shape override
  so coarser levels can grow chunks the way OME-Zarr image pyramids
  do via voxel-size scaling.  Invariant: per-level `chunk_shape`
  must be a positive integer multiple of root `chunk_shape` along
  every axis (nested chunk grids).  Cross-pyramid-level link arrays
  carried both endpoints' chunk coords inline (still true under 0.8
  via the kN array cell path); the per-axis multiplier is exposed by
  `chunk_scale_factor(root, level)`.  Migration: rewrite (no helper).

- **0.6.0** — fragment-index byte layout
  ([§7.3](07-core-arrays.md#73-vertex-fragments)).
  `vertex_group_offsets` is replaced by `vertex_fragments` — a v1
  byte layout with header, range bitmap, range table, and explicit-
  CSR row indices, supporting vertex re-use across fragments.
  Inline self-describing link blobs at `delta = 0` are split into a
  flat `links/0/<chunk>` payload plus a sibling
  `link_fragments/<chunk>` group with the same v1 fragment-index
  layout.  `object_index/data` adopts the manifest-block encoding
  (modes 0 / 1 / 2 — single / range / explicit) with chunk-local
  fragment references.  The `shared_vertex_groups` capability token
  is renamed to `shared_fragments` (the sharing primitive is now a
  fragment, not a contiguous-byte vertex group); the new
  `fragment_index` capability is mandatory for 0.6+ stores.
  Migration: rewrite.

- **0.5.0** — NGFF alignment and format simplification.  Several
  on-disk simplifications shipped under the 0.5 series without
  separate version bumps (consumers should pin to a specific point
  release):
  - renamed `format_version` → `zv_version` to disambiguate from
    Zarr v3's `zarr_format` field;
  - moved axes to NGFF `multiscales[0].axes` (no longer duplicated
    under `spatial_index_dims`);
  - dropped per-array dtype duplication (read from `zarr.json`
    `data_type` directly);
  - removed `vertex_counts/`, `metanode_children/`,
    `cross_chunk_faces/`, `attributes/<name>/<key>_offsets`, and
    `object_index/pending/`;
  - replaced the `(K, 2)` paired vertex-offset layout with a flat
    `(K,)` int64 vertex-offsets array (itself superseded by the
    fragment index in 0.6);
  - cross-chunk face identity moves to `cross_chunk_links/<delta>/`
    with `link_width = 3`.
  Migration: rewrite.

- **0.4.1** — bare-integer resolution-level group names (`0/`, `1/`,
  …, `N/`).  Renamed from `resolution_0/`, `resolution_1/`, … to
  mirror OME-Zarr's level naming.  Path-level break only; on-disk
  array layouts identical to 0.4.  Migration: rename level groups in
  place.

- **0.4** — multiscale-link arrays.  Introduced the `<delta>`
  sub-folder layout for `links/`, `cross_chunk_links/`,
  `link_attributes/`, and `cross_chunk_link_attributes/` and the
  `cross_level_depth` / `cross_level_storage` writer knobs.  This is
  the version where cross-pyramid-level links became expressible.
  New `multiscale_links` capability token marks stores with any
  `delta ≠ 0` array.  Migration: rewrite.

## Appendix L: Mapping from Neuroglancer Precomputed Annotations

The [Neuroglancer precomputed annotation format](https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/annotations.md)
stores small geometric primitives — points, lines, axis-aligned
bounding boxes, and ellipsoids — with per-annotation properties,
per-segment relationships, and a multi-resolution random-subsample
spatial index.  It serves a similar purpose to zarr-vectors but with
narrower geometry semantics and a different multi-resolution model.
This appendix maps the two layouts so authors can pick the right
target and converters can translate between them.

### L.1 Conceptual mapping

| Neuroglancer Precomputed Annotations          | Zarr-vectors equivalent                                      |
|-----------------------------------------------|--------------------------------------------------------------|
| `info["@type"] = "neuroglancer_annotations_v1"` | `zarr.json["zarr_vectors"]["zv_version"]` + `geometry_types` |
| `annotation_type` (geometry discriminator)    | `geometry_types` (list) + per-record `link_width`            |
| `dimensions`, `lower_bound`, `upper_bound`    | NGFF `multiscales[0].axes` (with units) + `bounds`           |
| `properties[]` (per-annotation attributes)    | `vertex_attributes/<name>/<chunk>` (per-vertex), or `object_attributes/<name>` (per-object) when one annotation = one object |
| `relationships[]` (per-segment links)         | `groups` + `group_attributes/<name>` (groups keyed by segment id) |
| `by_id/` (annotation ID → record)             | `object_index/manifests` (manifest keyed by dense `[0, B)` OID)   |
| `spatial/<level>/` (multi-res grid + random subsample) | Pyramid levels `0/`, `1/`, … with per-object coarsening + `cross_level_storage` for fine→coarse mapping |
| `spatial[level].grid_shape` × `chunk_size`    | Per-level effective `chunk_shape` (root + optional v0.7 `LevelMetadata.chunk_shape` override) |
| `spatial[level].limit` (max annotations / cell) | Implicit via vertex count / bin_shape; pyramid coarsening controlled by `reduction_factor` and `coarsening_method` |
| Sharded vs unsharded `by_id/` and `spatial/`  | Zarr v3 chunk-key encoding handles both transparently; sharding is a backend concern, not a schema choice |
| Random subsampling between levels             | `coarsening_method = "per_object"` with `object_sparsity ∈ (0, 1]` and `preserves_object_ids = true` |

### L.2 Mapping the four geometry primitives

Precomputed annotations are zero-dimensional primitives, each carrying
a fixed positional record.  Zarr-vectors expresses them via the
`geometry_types` list plus the appropriate per-record layout:

| Precomputed `annotation_type` | Positional record           | Zarr-vectors representation                                                         |
|-------------------------------|-----------------------------|-------------------------------------------------------------------------------------|
| `POINT`                       | 1 vector                    | `geometry_types = ["point_cloud"]`; one fragment per annotation, single vertex row. |
| `LINE`                        | 2 vectors (endpoint A, B)   | `geometry_types = ["polyline"]` or `["line"]`; one fragment per annotation, 2-vertex range; no `links/` needed under `links_convention = "implicit_sequential"`. |
| `AXIS_ALIGNED_BOUNDING_BOX`   | 2 vectors (min, max)        | Two options. **(a)** `geometry_types = ["point_cloud"]` with per-object attributes `min_corner`, `max_corner` carrying the box (one annotation = one object).  **(b)** `geometry_types = ["line"]` with the diagonal endpoints — readers reconstruct the AABB.  Option (a) preserves "this is a box" semantics; (b) is simpler when boxes coexist with lines. |
| `ELLIPSOID`                   | 2 vectors (center, radii)   | `geometry_types = ["point_cloud"]` with per-object attributes `center` and `radii`.  Same shape as option (a) for AABB.  Centers populate `vertices/<chunk>`; the `radii` `object_attribute` carries the second vector. |
| `POLYLINE`                    | uint32 count + N vectors    | `geometry_types = ["polyline"]`; one fragment per polyline (a range `[start, count)` over `vertices/<chunk>`); manifest in `object_index/manifests` carries one block per chunk the polyline crosses; `links_convention = "implicit_sequential"`. |

Multi-geometry stores are natural in zarr-vectors (just list every
geometry in `geometry_types`); the precomputed format restricts a
single store to one `annotation_type` and would require co-locating
several stores to mix kinds.

### L.3 Properties and relationships

**Per-annotation properties** in precomputed correspond directly to
per-vertex (or per-object) attributes:

- Numeric properties (`uint8`, `int8`, ..., `float32`) → typed
  `vertex_attributes/<name>/<chunk>` or `object_attributes/<name>`.
  Zarr-vectors uses the array's `dtype` directly; no per-property
  enum table is needed at the schema level.
- `rgb` / `rgba` → either an `(N, 3)` / `(N, 4)` uint8 attribute, or
  three / four channels of a multi-channel attribute with declared
  `channel_names`.
- `enum_values` / `enum_labels` → carried as `channel_names` /
  per-attribute side metadata.  Zarr-vectors does not currently
  reserve a top-level enum-mapping slot; writers stamp the mapping
  as a JSON dict in the attribute's `.zattrs`.

**Relationships** (each annotation linked to a list of segment IDs)
map onto zarr-vectors **groups**:

- The precomputed `relationships[<rel_name>]` becomes a per-relationship
  `groups` array (or, if multiple relationships, one `groups`-like
  structure per relationship name — typically expressed today by
  rechunking by relationship; see [§8](08-metadata.md)).
- Each group corresponds to one segment id.  Its membership list is
  the annotation IDs (= object IDs in zarr-vectors).
- The inverse — annotation → list of segments — is then the
  group-membership matrix (which annotations belong to which groups);
  in zarr-vectors this is recovered by iterating `groups`, the
  same operation that powers "show all annotations on segment X" in
  precomputed.

### L.4 The spatial index

Both formats use a multi-resolution spatial grid to keep query cost
bounded, but the *selection rule* differs:

- **Precomputed**: each level has a per-cell `limit`.  A cell with
  more annotations than the limit gets a random subsample at this
  level; the rest propagate to finer children.  Cell coverage is
  controlled by `grid_shape` × `chunk_size`, anchored at
  `lower_bound`.  Levels coarsen by integer division of cells.
- **Zarr-vectors**: each level has a fixed `bin_shape` (and
  optionally an overridden `chunk_shape`, v0.7).  Coarsening is
  per-object: each surviving object's vertices are aggregated into
  metavertices at the coarser bin grid.  `object_sparsity ∈ (0, 1]`
  in level metadata records what fraction of objects survived.

Equivalents:

| Concept                            | Precomputed                       | Zarr-vectors                                       |
|------------------------------------|-----------------------------------|----------------------------------------------------|
| Grid cells per axis at level L     | `spatial[L].grid_shape`           | `ceil((bounds_max - bounds_min) / chunk_shape_L)`  |
| Cell size at level L               | `spatial[L].chunk_size`           | `RootMetadata.chunk_shape` × per-level `chunk_scale_factor` (v0.7) |
| LOD selection knob                 | `spatial[L].limit`                | `reduction_factor` + per-level `object_sparsity`   |
| Cross-level identity               | annotation ID is shared across levels | OID-preserving pyramid (`preserves_object_ids = true`) |
| Drillable parent→child mapping     | implicit (random subsample)       | optional `links/<delta>/<offsets>` arrays ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional))   |

Precomputed's "drill the visible cells until you've returned at most
`limit` annotations per cell" maps to zarr-vectors' "ask each level
for the object set; stop when `object_sparsity * source_count` fits
your budget."  The precomputed model is simpler and gets random
sampling for free; the zarr-vectors model is more general (handles
extended objects, not just points) at the cost of an explicit
coarsener.

### L.5 Practical conversion notes

- **Single annotation type → single zarr-vectors store** is a
  straightforward 1:1 transcode.  Pick the geometry mapping from
  [§L.2](#l2-mapping-the-four-geometry-primitives); emit one fragment per annotation; populate `object_index/`
  in dense OID order from the original `by_id` listing.
- **Properties** transcode field-for-field; preserve the original
  uint8 / int8 / ... types rather than upcasting.
- **Relationships** transcode to groups keyed by segment id.  In
  practice, very large segment-id spaces (10⁸+ segments) suggest
  using `object_attributes/segment_id` rather than `groups` if
  most segments touch zero or one annotation.
- **Spatial index** does NOT transcode 1:1.  The pyramid is rebuilt
  using the per-object coarsener; the precomputed `limit` rule has
  no direct zarr-vectors equivalent.  A reasonable default is
  `reduction_factor = 8`, `object_sparsity ≈ limit / max_cell_count`
  per level, and `cross_level_storage = "implicit"` if downstream
  readers need to drill from coarse to fine.
- **Sharded vs unsharded** is invisible to the schema mapping —
  zarr-vectors writes per-chunk blobs into a Zarr v3 store regardless
  of the backend's sharding.

### L.6 What zarr-vectors adds over precomputed annotations

- **Connected geometries** (polylines with branches, skeletons,
  meshes) live in the same store, not just zero-dimensional
  primitives.  `link_width = 1, 2, 3, ...` and the fragment-index
  partitioning carry the connectivity.
- **Fragment / vertex re-use**: explicit fragment indices let
  multiple objects reference the same per-chunk vertex rows
  (`shared_fragments`), saving storage on overlapping geometries
  (streamline bundles, mesh rims).
- **Per-link attributes**: edges / faces carry their own attribute
  arrays (`link_attributes/<name>/<delta>/<chunk>`), not just the
  per-annotation properties precomputed supports.
- **Cross-pyramid-level links** ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)) make the pyramid drillable
  — given a coarse metavertex, walk back to the fine-level vertices
  that produced it.  Precomputed's random-subsample model loses this
  mapping at construction time.
- **Pluggable coarsening**: `coarsening_method = "per_object"` is the
  default, but mesh decimation and streamline point-reduction slot
  into the same level structure.

### L.7 What precomputed annotations preserve that zarr-vectors does not (yet)

- **Sharded back-end** as a first-class schema concern.  Zarr-vectors
  delegates sharding to the underlying Zarr v3 store; it does not
  expose `sharding` blocks per index.
- **Per-property enum tables** as a typed schema field
  (`enum_values` / `enum_labels`).  Zarr-vectors carries this as
  free-form `.zattrs` metadata.
- **The "limit" LOD heuristic** — automatic, occupancy-driven
  downsampling without writing a coarsening pass.  In zarr-vectors
  the writer must pick `bin_ratio` / `chunk_scale_factor` /
  `object_sparsity` deliberately.
