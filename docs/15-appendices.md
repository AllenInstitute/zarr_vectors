# 15. Appendices

## Appendix A: JSON Schema Definitions

The **normative** schema for Zarr Vectors metadata is the JSON Schema
published with the Zarr Vectors convention v0.1.0:

- Schema: <https://raw.githubusercontent.com/Andrew-Keenlyside/zarr-vectors/refs/tags/v0.1.0/schema.json>
- Convention: <https://github.com/Andrew-Keenlyside/zarr-vectors/blob/v0.1.0/README.md>

It validates one `zarr.json` document at a time and covers:

- the `zarr_vectors` object of every node, discriminated by `kind`
  (`root`, `level`, `parametric` and every array and family-group
  kind of [§8.4](08-metadata.md#84-array-level-metadata));
- the `zarr_conventions` registration on every node;
- the root's `multiscales` block (one `layout` entry per level, no
  non-identity transform);
- the enumerations: `geometry_types`, `links_convention`,
  `object_index_convention`, `cross_chunk_strategy`,
  `cross_level_storage`, `coarsening_method`, `encoding`, `store`,
  `layout`, `manifest_layout`, `manifest_block_dtype` and the
  capability tokens.

Rules that span nodes or fields — `sid_ndim` entries (one per axis), integer
chunk / bin ratios, `multiscales` assets matching the level groups,
`parent_level` chains, `has_perm` and `offsets` consistency, array
shapes matching the chunk grid — are not expressible in a per-node
schema; they are listed in [§8](08-metadata.md) and
[§13.2](13-conformance-and-validation.md#132-validation-rules) and
checked by validators.

The reference implementation also keeps a LinkML model,
`schema/zarr_vectors.linkml.yaml` in zarr-vectors-py, from which a
JSON Schema, Pydantic models and other artefacts can be generated with
the standard `gen-*` LinkML generators.  It models the `zarr_vectors`
objects only (not `multiscales`, `zarr_conventions`, `proj:projjson`
or `ome`).  Where it and the convention's schema disagree, the
convention's schema wins.

## Appendix B: Zarr Implementation Details

- **Zarr version**: v3 only.
- **Per-array layout**: each per-spatial-chunk array is a single
  vlen-bytes array over the level's chunk grid, one cell per chunk,
  cell files at `c/<i>/<j>/<k>`; the non-spatial arrays are single
  ragged or dense arrays at their logical path.  Internal record
  framing (fragment-index, manifest-block, link-record streams) lives
  in project byte layouts inside each cell's payload.
- **Cell addressing**: chunk at absolute coord `c` → cell
  `c - chunk_grid_origin`; occupied cells are listed in the
  `nonempty_chunks` field of the array's `zarr_vectors` object.
- **Sharding**: optional, via Zarr v3's native `sharding_indexed`
  codec or, on a store marked octree, the registered `octree_sharding`
  codec (Appendix D).  There is no shard format specific to Zarr
  Vectors.
- **Node metadata**: every Zarr Vectors node's `zarr.json` carries one
  attribute, `zarr_vectors`, discriminated by `kind`, plus a
  `zarr_conventions` registration, alongside the Zarr v3 standard
  `node_type` / `zarr_format` fields ([§8](08-metadata.md)).
- **Variable-length bytes**: per-chunk arrays, `groups`,
  `object_index/manifests` and `parametric/names` use the
  zarr-extensions variable-length `bytes` data type with the
  `vlen-bytes` codec.  zarr-python 3 spells the data type
  `"variable_length_bytes"`; readers MUST accept that spelling as well
  as `"bytes"`.
- **Multi-store hosting**: stores work on any Zarr v3 store backend
  (LocalStore, FsspecStore over S3 / GCS / Azure Blob, in-memory,
  icechunk transactional stores, …).

## Appendix C: Coordinate Reference Systems

- A store's CRS is the root attribute `proj:projjson`, a
  [PROJJSON](https://proj.org/specifications/projjson.html) object, as
  defined by the [proj convention](https://github.com/zarr-conventions/proj)
  v0.1 (uuid `f17cb550-5864-4468-aeb7-f3180cfb622f`), which the root
  then registers in `zarr_conventions`
  ([§8.8](08-metadata.md#88-coordinate-reference-system-crs)).  A store
  without a CRS has neither.
- Writers write `proj:projjson` only, never `proj:code` or
  `proj:wkt2`.  A reader MAY accept those two forms from other writers.
- The CRS applies to world positions: stored position plus the root's
  `coordinate_offset` (absent ⇒ zero).
- Axes are the root object's `axes` list, using OME-Zarr RFC 4's
  descriptor shape (`name`, `type`, `unit`).  Per-axis units use
  UDUNITS-2 names (`"micrometer"`, `"second"`, …).  The format does not
  stamp placeholder unit strings — unknown units must be omitted.
- There are no per-level coordinate transforms: every level stores
  vertices in level-0 coordinates, and the root `multiscales` block
  carries no transform ([§8.10](08-metadata.md#810-multiscales)).

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

Any of these may additionally be wrapped in a sharding codec by
supplying a `shard_shape`; sharding composes with the codec, it does
not replace it.  Note that this table is the *recommended* pipeline —
the default is no compressor at all (see
[§11.3](11-compression-and-encoding.md)).

Mesh stores may use Draco-encoded vertex+face co-encoding instead of
the raw Blosc pipeline; the `vertices` array's `encoding: "draco"`
field flags this.  Draco output is already compressed, so the Zarr
codec pipeline is left empty (or wrapped in a minimal pass-through
codec).

### Sharding codecs

| Codec | Where | Notes |
|-------|-------|-------|
| `sharding_indexed` | Any per-chunk array with a shard shape; object-layer arrays sharded along rows | Core Zarr v3 codec.  Dense shard index, 16 bytes per possible inner chunk. |
| `octree_sharding` | Sharded per-chunk arrays of a store whose root sets `octree_sharding` (capability `octree_sharding`) | Optional, per array. |

`octree_sharding` is a registered Zarr v3 `array -> bytes` sharding
codec.  Its configuration is that of `sharding_indexed` without
`index_codecs` and `index_location`: `chunk_shape` (the inner chunk,
`[1, …, 1]` for a per-chunk array), `codecs` (the inner codecs,
starting with `vlen-bytes`) and an optional `layout` that only steers
writers (`{"name": "octree", …}` or `{"name": "runs", …}`).  Keys,
cells, inner codecs and fill value mean what they mean with
`sharding_indexed`; only the shard bytes differ.  Stored inner chunks
are contiguous in Z (Morton) order, grouped into runs a reader can
fetch as one byte range, and the index is sparse — one row (Z-order
code, length) per *stored* chunk plus a run table — located by a
16-byte footer with its size and a CRC-32C checksum.  For sparse data
this index is far smaller than `sharding_indexed`'s dense one.  A Zarr
implementation without the codec refuses the array as unknown, so it
never misreads a shard.

Readers SHOULD also accept the legacy name `zarr_octree_sharding`
(zarr-octree 0.3 and earlier: flat configuration, index version 2 with
a CRC-32 checksum); writers MUST NOT write it.  The codec is
specified in, and implemented by, the
[zarr-octree](https://github.com/Andrew-Keenlyside/zarr-octree)
package (`registry/codecs/octree_sharding/README.md`).

### Marker codec

`zarr_vectors_octree_chunks` is a pass-through `bytes -> bytes` codec
that ends the cell codecs (inside any sharding codec) of every
per-chunk array on a level with octree chunks
([§6.5](06-spatial-indexing.md#65-octree-chunks)).  It exists so that a
Zarr reader that does not know it refuses the array instead of reading
octree leaves as uniform cells.

### Record framings

The fragment-index byte layout
([§7.3](07-core-arrays.md#73-vertex-fragments)) and manifest-block
stream ([§7.6](07-core-arrays.md#76-object-index)) are **not** Zarr
codecs: they are record framings inside each cell's bytes.

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

## Appendix G: Performance Considerations

- **Chunk size**: larger chunks amortise per-chunk overhead at the
  cost of larger minimum-read units.  Coarser pyramid levels may grow
  `chunk_shape` independently of level 0.
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

## Appendix H: Extensibility

- **Custom geometry types**: writers may add a new value to
  `geometry_types` outside the canonical set (`point_cloud`,
  `line`, `polyline`, `streamline`, `skeleton`, `graph`, `mesh`),
  at the cost of dropping conformance-level checks for that
  geometry.
- **Custom metadata**: application metadata goes under the root's
  `user_metadata` attribute, one namespace per application, never
  inside `zarr_vectors`.  Other conventions MAY add prefixed keys
  (`proj:` …).  Within a `zarr_vectors` object, readers should ignore
  fields they do not recognise; a node whose `kind` they do not
  recognise should be rejected.
- **Capability tokens**: stores advertise optional features via
  `format_capabilities`.  Readers that don't recognize a token
  must either treat the corresponding feature as absent or refuse
  to open the store.  Features a reader cannot safely ignore are also
  listed in `required_capabilities`
  ([§8.2](08-metadata.md#capability-tokens-format_capabilities)).
- **Version evolution**: the format version (`zv_version`) and the
  convention version (the tag in the `zarr_conventions` URLs) are
  versioned independently.  Readers refuse a newer minor format
  version ([§8.12](08-metadata.md#812-version-rules)); no shim layer
  ships with the implementation.  Appendix J records what each version
  changed.

## Appendix I: References

- TRX format specification:
  <https://tee-ar-ex.github.io/trx-python/stable/trx_specifications.html>
- Zarr v3 specification: <https://zarr-specs.readthedocs.io/>
- Zarr Vectors convention v0.1.0 (metadata layer; normative JSON
  Schema): <https://github.com/Andrew-Keenlyside/zarr-vectors/blob/v0.1.0/README.md>
- Zarr Conventions specification:
  <https://github.com/zarr-conventions/zarr-conventions-spec>
- multiscales convention v0.1:
  <https://github.com/zarr-conventions/multiscales/blob/v0.1/README.md>
- proj convention v0.1:
  <https://github.com/zarr-conventions/proj/blob/v0.1/README.md>
- PROJJSON: <https://proj.org/specifications/projjson.html>
- OME-Zarr (NGFF) specification: <https://ngff.openmicroscopy.org/>
  (RFC 4 axes; RFC 8 collections and nodes)
- `sharding_indexed` codec:
  <https://zarr-specs.readthedocs.io/en/latest/v3/codecs/sharding-indexed/>
- `octree_sharding` codec (zarr-extensions registry; implementation
  zarr-octree): <https://github.com/Andrew-Keenlyside/zarr-octree>
- zarr-extensions variable-length `bytes` data type and `vlen-bytes`
  codec: <https://github.com/zarr-developers/zarr-extensions>
- LinkML: <https://linkml.io/>
- Neuroglancer precomputed mesh format:
  <https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/meshes.md>
- Neuroglancer precomputed annotation format:
  <https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/annotations.md>
  (see Appendix K for the mapping to Zarr Vectors).

## Appendix J: Change Log

*This appendix is the only place in the specification that describes
prior versions of the format.  Sections 1-14 and the other appendices
describe the current version only.*

Each entry records one version bump.  Patch versions (0.9.1–0.9.4) are
additive: an older reader of the same minor version reads a store that
does not use the new feature.

### Migration

**0.9.x → 0.10.0: in place, metadata only.**  Format 0.10.0 cells are
byte-for-byte those of 0.9.4, so a 0.9.x store migrates by rewriting
its `zarr.json` documents; no chunk is read or written.  The reference
implementation does this with
`zarr_vectors.building.migrate_metadata_0_10(path)` (`dry_run=True`
counts the nodes it would rewrite).  It rewrites every level, array and
parametric node first and **the root last**, so an interrupted run
leaves a store that is still refused as 0.9.x, and running it again
finishes the job.  On a 0.10.0 store it changes nothing.

| 0.9.x | 0.10.0 |
|-------|--------|
| Root `zarr_vectors` | The same object with `kind: "root"` and `zv_version` `"0.10.0"` |
| Root `zarr_vectors.crs` | Root `proj:projjson`, plus the proj registration |
| Root `multiscales[0].axes` | Root `zarr_vectors.axes` |
| Root `multiscales` (NGFF 0.4 list) | `{"layout": [{"asset": "<level>"}, …]}`; `metadata.format` is dropped |
| Level `zarr_vectors_level` | Level `zarr_vectors` with `kind: "level"` |
| Level `zarr_vectors_presence` | The level object's `presence` |
| Array `zv_array` and its fields at the top level | `zarr_vectors` with `kind` and the same fields |
| `zv_array: "attribute"` | `kind: "vertex_attribute"` |
| `zv_array: "groupings_attribute"` | `kind: "group_attribute"` |
| `parametric/` `parametric_types` | `zarr_vectors` with `kind: "parametric"` |
| No registration | `zarr_conventions` on every node above |

A coarse level whose bins were stored only in its NGFF entry gets them
copied into its level object (`bin_ratio` = `scale`, `bin_shape` =
2 × `translation`).  Fields added in 0.9.1–0.9.4 keep their names.  A
0.9.x reader cannot read a migrated store.

**Anything older than 0.9.0: rewrite from source.**  Every earlier bump
changed the cell layout.  0.10.0 is the first in-place migration since
the 0.7 → 0.8 helper, which is obsolete: 0.8 → 0.9 moved every
per-chunk array to a single vlen array over the chunk grid, and re-keyed
cross-chunk records by source chunk instead of by sorted endpoint
tuple, which cannot be recovered where `perm_idx` was not stored.

A reader MUST reject a store it cannot identify rather than read it on
a best-effort basis
([§13.2](13-conformance-and-validation.md#132-validation-rules)).

### Version-at-a-glance

| Version | Headline change | New capability tokens | Hard break? | Migration |
|---------|-----------------|-----------------------|-------------|-----------|
| **0.10.0** | Metadata on the Zarr Vectors convention: one `zarr_vectors` object per node with `kind`; `zarr_conventions`; axes in the root object; multiscales convention; CRS as `proj:projjson` | — | Yes (metadata only; cells unchanged) | **In place**, `migrate_metadata_0_10` |
| **0.9.4** | Optional dense object-index layout `dense_manifests_v1` (root `manifest_layout: "dense"`); octree sharding; octree chunks; `required_capabilities` | `dense_manifests`, `octree_sharding`, `octree_chunks` | No (additive) | None needed |
| **0.9.3** | Optional root `shard_shape`; `ome` world system gains `id`; deferred presence | — | No (additive) | None needed |
| **0.9.2** | Optional RFC 8 `ome` collection node on the root | — | No (additive) | `stamp_ome_node` adds it in place |
| **0.9.1** | Optional root `attribute_specs`; `vlen_manifests_v2` object index (stored `object_ids`) | — | No (additive) | None needed |
| **0.9** | Single vlen array per per-chunk array (cells over the chunk grid); `cross_chunk_links` merged into `links/<delta>/<offsets>/` | — (retires `partitioned_cross_chunk_links`) | Yes | Rewrite |
| **0.8.1** | Flat single-array layout for the dense / ragged arrays; `present_mask` replaced by `fill_value` | — | Yes | Rewrite |
| **0.8** | Partitioned `cross_chunk_links/<delta>/` (kN array cells keyed by sorted unique chunks) | `partitioned_cross_chunk_links` | Yes | In-place helper *(obsoleted by 0.9)* |
| **0.7** | Per-level `chunk_shape` override; pyramid levels may grow chunks | — | Yes | Rewrite |
| **0.6** | Fragment-index byte layout for `vertex_fragments/` + `link_fragments/`; manifest-block `object_index/data` | `fragment_index`, `shared_fragments` (replaces `shared_vertex_groups`) | Yes | Rewrite |
| **0.5** | NGFF axis alignment; `format_version` → `zv_version`; flat `(K,)` vertex-offset layout; drops `vertex_counts/`, `metanode_children/`, `cross_chunk_faces/`, `object_index/pending/` | — | Yes | Rewrite |
| **0.4.1** | Bare-integer level group names (`0/`, `1/`, …) | — | Yes (path-only) | Rewrite |
| **0.4** | `<delta>` sub-folder layout for `links/`, `cross_chunk_links/`, `link_attributes/`, `cross_chunk_link_attributes/`; cross-pyramid-level link arrays | `multiscale_links` | Yes | Rewrite |

### Cumulative capability set as of v0.10

A v0.10 store may carry any subset of:

- `multiscale_links` — `delta ≠ 0` link arrays present (since 0.4;
  since 0.9 it says nothing about chunk-spanning records);
- `shared_fragments` — fragments referenced by several manifests
  (renamed from `shared_vertex_groups` in 0.6);
- `preserved_object_ids` — a level kept its parent's OID space (since
  0.4);
- `dense_manifests` — a `dense_manifests_v1` object index (0.9.4);
- `octree_sharding` — sharded arrays use the `octree_sharding` codec
  (0.9.4);
- `octree_chunks` — a level has octree chunks; also in
  `required_capabilities` (0.9.4);
- `fragment_index` — reserved: defined since 0.6, mandatory in
  meaning, never written by the reference implementation.

Tokens are open-set; readers must tolerate unknown values.

### Per-version detail

- **0.10.0** — the metadata moves onto the
  [Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors)
  v0.1.0.  Cell payloads are unchanged from 0.9.4.
  - Every node's Zarr Vectors properties sit under one attribute,
    `zarr_vectors`, discriminated by `kind`: `root`, `level`,
    `parametric`, or an array kind.  Array fields (`dtype`, `name`,
    `nonempty_chunks`, …) move inside it; `zarr_vectors_level` becomes
    `zarr_vectors` with `kind: "level"`, and the level's
    `zarr_vectors_presence` becomes its `presence` field.  Two array
    kinds are renamed: `attribute` → `vertex_attribute`,
    `groupings_attribute` → `group_attribute`.
  - `zarr_conventions` registers the convention on every such node, and
    the multiscales (and, with a CRS, proj) conventions on the root.
  - Axes move from NGFF `multiscales[0].axes` into
    `zarr_vectors.axes`.
  - The bare-root OME-NGFF 0.4 `multiscales` list — which pointed
    `datasets` at groups and reused `scale` / `translation` for bin
    geometry — is replaced by the multiscales convention's
    `{"layout": [{"asset": "<level>"}]}` with no transform.  A coarse
    level's `bin_shape` and `bin_ratio` live only in its level object.
  - `crs` leaves the root object for `proj:projjson`.
  - Readers refuse 0.9.x stores (naming the migration) and stores with
    a newer minor version.  Migration: in place (see *Migration*).

- **0.9.4** — optional dense object-index layout,
  `dense_manifests_v1`: `object_index/manifest_spans` (`int64
  (n_objects, 2)`, start and count) indexing
  `object_index/manifest_blocks` (`int64 (n_blocks, sid_ndim + 1)`,
  chunk coordinates then fragment index, one row per fragment an object
  references), with `object_index/object_ids` as in
  `vlen_manifests_v2`.  Chosen per store by the root's
  `manifest_layout: "dense"` (absent means vlen, so every 0.9.3 store
  reads unchanged; `manifest_block_dtype: "int32"` narrows the blocks)
  and declared by `dense_manifests`.  A 0.9.3 reader rejects the
  unknown `layout` rather than misreading it.  Also shipped under
  0.9.4: the root's `octree_sharding` block and capability (sharded
  arrays use zarr-octree's codec, then named `zarr_octree_sharding`),
  octree-chunked levels (`octree_chunks` capability, level
  `octree_chunks` block, marker codec), and the root's
  `required_capabilities`.  Migration: none.

- **0.9.3** — optional root `shard_shape`: cells per shard per axis,
  an integer when every axis agrees.  It records the store's packing
  for every path that allocates an array, including arrays a worker
  creates later; each array's own `zarr.json` remains the truth.
  Absent ⇒ unsharded, so 0.9.0–0.9.2 stores read unchanged.  Also: the
  `ome` scene's `world` coordinate system gains `id` beside `name`; and
  a per-chunk array may omit `nonempty_chunks` while its level declares
  presence `"deferred"` (then a top-level `zarr_vectors_presence`
  attribute), a build-time state a coordinator ends.  A finished store
  is readable by a 0.9.2 reader; one caught mid-build is not (that
  reader treats the missing list as an empty array).  Migration: none.

- **0.9.2** — optional root `ome` block: an OME-Zarr RFC 8
  `collection` node (`version`, `type`, `name`, one `zv:level` leaf
  per level, and a `scene` declaring the `world` coordinate system with
  the store's axes and units), so an OME collection elsewhere can name
  the store by path.  Every field restates one in `zarr_vectors` or
  `multiscales`, which stay authoritative.  Migration: none, or
  `stamp_ome_node` to add the block in place.

- **0.9.1** — optional root `attribute_specs`: declared attributes by
  scope (`{"vertex": {"intensity": {"dtype": "float32", "unit":
  "microvolt"}}, "object": {…}, "link": {…}}`).  A declaration is not a
  promise that the array exists; `unit` and `description` are also
  stamped on the attribute array when written.  Also shipped under
  0.9.1: the `vlen_manifests_v2` object-index layout, which stores
  object ids in `object_index/object_ids` instead of implying them by
  row.  Migration: none.

- **0.9.0** — two independent on-disk breaks, shipped together.
  *One array per logical array:* every per-spatial-chunk array becomes
  **one** Zarr v3 vlen-bytes array over the level's chunk grid, one
  cell per spatial chunk at `<array>/c/<i>/<j>/<k>`, replacing one
  single-chunk `uint8` sub-array per spatial chunk.  Cells are offset
  by `chunk_grid_origin` (absent ⇒ zero), occupied cells are listed in
  `nonempty_chunks`, and an optional `shard_shape` wraps the cells in
  `sharding_indexed`.  *One connectivity family:* `cross_chunk_links`
  and `cross_chunk_link_attributes` merge into `links` and
  `link_attributes`.  `links/<delta>` becomes a group with one vlen
  array per relative-offset segment (`links/<delta>/<offsets>`, cell =
  the record's source chunk), mirrored by
  `link_attributes/<name>/<delta>/<offsets>`.
  `partitioned_cross_chunk_links` is retired and `multiscale_links`
  narrows to "`delta ≠ 0` arrays are present".  Migration: rewrite.

- **0.8.1** — each non-spatial array (`object_attributes`,
  `group_attributes`, `groups`, parametric blobs) becomes a single
  Zarr v3 array at its logical path instead of a group with a `data`
  child.  Sparse coverage moves from a `present_mask` sibling to the
  array's `fill_value`; ragged arrays move to vlen-bytes; custom
  per-array attributes move onto the array.  Also adds optional
  `directed`, `store` and `num_physical_records` to the cross-chunk
  link family.  Migration: rewrite.

- **0.8.0** — the monolithic `cross_chunk_links/<delta>/data` blob is
  replaced by one sharded vlen array `kK` per endpoint-chunk count K,
  one cell per sorted-unique chunk tuple, records of `9 * link_width`
  bytes with a per-endpoint chunk index; `layout = "sharded_v1"` on the
  family group; new `partitioned_cross_chunk_links` token (coupled with
  `multiscale_links`).  Migration: an in-place helper, now obsolete.

- **0.7.0** — optional per-level `chunk_shape`, a positive integer
  multiple of the root `chunk_shape` on every axis (nested grids).
  Migration: rewrite.

- **0.6.0** — fragment-index byte layout: `vertex_group_offsets` is
  replaced by `vertex_fragments`; the inline `delta = 0` link blob is
  split into flat `links/0/<chunk>` plus a `link_fragments` sidecar;
  `object_index/data` adopts the manifest-block encoding.
  `shared_vertex_groups` is renamed `shared_fragments`; `fragment_index`
  is introduced.  Migration: rewrite.

- **0.5.0** — NGFF alignment and simplification: `format_version` →
  `zv_version`; axes move to NGFF `multiscales[0].axes`; per-array
  dtype duplication dropped; `vertex_counts/`, `metanode_children/`,
  `cross_chunk_faces/`, `attributes/<name>/<key>_offsets` and
  `object_index/pending/` removed; flat `(K,)` vertex offsets;
  cross-chunk faces move to `cross_chunk_links/<delta>/` with
  `link_width = 3`.  Migration: rewrite.

- **0.4.1** — level groups renamed `resolution_<n>/` → `<n>/`.
  Path-only break.  Migration: rename level groups.

- **0.4** — `<delta>` sub-folders for `links/`, `cross_chunk_links/`
  and their attribute families; cross-pyramid-level link arrays;
  `cross_level_depth` / `cross_level_storage`; `multiscale_links`
  token.  Migration: rewrite.

## Appendix K: Mapping from Neuroglancer Precomputed Annotations

The [Neuroglancer precomputed annotation format](https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/annotations.md)
stores small geometric primitives — points, lines, axis-aligned
bounding boxes, and ellipsoids — with per-annotation properties,
per-segment relationships, and a multi-resolution random-subsample
spatial index.  It serves a similar purpose to Zarr Vectors but with
narrower geometry semantics and a different multi-resolution model.
This appendix maps the two layouts so authors can pick the right
target and converters can translate between them.

### K.1 Conceptual mapping

| Neuroglancer Precomputed Annotations          | Zarr Vectors equivalent                                      |
|-----------------------------------------------|--------------------------------------------------------------|
| `info["@type"] = "neuroglancer_annotations_v1"` | root `zarr_vectors` (`kind: "root"`, `zv_version`) + `geometry_types` |
| `annotation_type` (geometry discriminator)    | `geometry_types` (list) + per-record `link_width`            |
| `dimensions`, `lower_bound`, `upper_bound`    | Root `zarr_vectors.axes` (with units) + `bounds`             |
| `properties[]` (per-annotation attributes)    | `vertex_attributes/<name>/<chunk>` (per-vertex), or `object_attributes/<name>` (per-object) when one annotation = one object |
| `relationships[]` (per-segment links)         | `groups` + `group_attributes/<name>` (groups keyed by segment id) |
| `by_id/` (annotation ID → record)             | `object_index/manifests` (manifest keyed by dense `[0, B)` OID)   |
| `spatial/<level>/` (multi-res grid + random subsample) | Pyramid levels `0/`, `1/`, … with per-object coarsening + `cross_level_storage` for fine→coarse mapping |
| `spatial[level].grid_shape` × `chunk_size`    | Per-level effective `chunk_shape` (root + optional level `chunk_shape` override) |
| `spatial[level].limit` (max annotations / cell) | Implicit via vertex count / bin_shape; pyramid coarsening controlled by `reduction_factor` and `coarsening_method` |
| Sharded vs unsharded `by_id/` and `spatial/`  | Zarr v3 chunk-key encoding handles both transparently; sharding is a backend concern, not a schema choice |
| Random subsampling between levels             | `coarsening_method = "per_object"` with `object_sparsity ∈ (0, 1]` and `preserves_object_ids = true` |

### K.2 Mapping the four geometry primitives

Precomputed annotations are zero-dimensional primitives, each carrying
a fixed positional record.  Zarr Vectors expresses them via the
`geometry_types` list plus the appropriate per-record layout:

| Precomputed `annotation_type` | Positional record           | Zarr Vectors representation                                                         |
|-------------------------------|-----------------------------|-------------------------------------------------------------------------------------|
| `POINT`                       | 1 vector                    | `geometry_types = ["point_cloud"]`; one fragment per annotation, single vertex row. |
| `LINE`                        | 2 vectors (endpoint A, B)   | `geometry_types = ["polyline"]` or `["line"]`; one fragment per annotation, 2-vertex range; no `links/` needed under `links_convention = "implicit_sequential"`. |
| `AXIS_ALIGNED_BOUNDING_BOX`   | 2 vectors (min, max)        | Two options. **(a)** `geometry_types = ["point_cloud"]` with per-object attributes `min_corner`, `max_corner` carrying the box (one annotation = one object).  **(b)** `geometry_types = ["line"]` with the diagonal endpoints — readers reconstruct the AABB.  Option (a) preserves "this is a box" semantics; (b) is simpler when boxes coexist with lines. |
| `ELLIPSOID`                   | 2 vectors (center, radii)   | `geometry_types = ["point_cloud"]` with per-object attributes `center` and `radii`.  Same shape as option (a) for AABB.  Centers populate `vertices/<chunk>`; the `radii` `object_attribute` carries the second vector. |
| `POLYLINE`                    | uint32 count + N vectors    | `geometry_types = ["polyline"]`; one fragment per polyline (a range `[start, count)` over `vertices/<chunk>`); manifest in `object_index/manifests` carries one block per chunk the polyline crosses; `links_convention = "implicit_sequential"`. |

Multi-geometry stores are natural in Zarr Vectors (just list every
geometry in `geometry_types`); the precomputed format restricts a
single store to one `annotation_type` and would require co-locating
several stores to mix kinds.

### K.3 Properties and relationships

**Per-annotation properties** in precomputed correspond directly to
per-vertex (or per-object) attributes:

- Numeric properties (`uint8`, `int8`, ..., `float32`) → typed
  `vertex_attributes/<name>/<chunk>` or `object_attributes/<name>`.
  Zarr Vectors uses the array's `dtype` directly; no per-property
  enum table is needed at the schema level.
- `rgb` / `rgba` → either an `(N, 3)` / `(N, 4)` uint8 attribute, or
  three / four channels of a multi-channel attribute with declared
  `channel_names`.
- `enum_values` / `enum_labels` → carried as `channel_names` /
  per-attribute side metadata.  Zarr Vectors does not currently
  reserve a top-level enum-mapping slot; writers stamp the mapping
  as a JSON dict in the attribute array's `zarr_vectors` object.

**Relationships** (each annotation linked to a list of segment IDs)
map onto Zarr Vectors **groups**:

- The precomputed `relationships[<rel_name>]` becomes a per-relationship
  `groups` array (or, if multiple relationships, one `groups`-like
  structure per relationship name — typically expressed today by
  rechunking by relationship; see [§8](08-metadata.md)).
- Each group corresponds to one segment id.  Its membership list is
  the annotation IDs (= object IDs in Zarr Vectors).
- The inverse — annotation → list of segments — is then the
  group-membership matrix (which annotations belong to which groups);
  in Zarr Vectors this is recovered by iterating `groups`, the
  same operation that powers "show all annotations on segment X" in
  precomputed.

### K.4 The spatial index

Both formats use a multi-resolution spatial grid to keep query cost
bounded, but the *selection rule* differs:

- **Precomputed**: each level has a per-cell `limit`.  A cell with
  more annotations than the limit gets a random subsample at this
  level; the rest propagate to finer children.  Cell coverage is
  controlled by `grid_shape` × `chunk_size`, anchored at
  `lower_bound`.  Levels coarsen by integer division of cells.
- **Zarr Vectors**: each level has a fixed `bin_shape` (and
  optionally an overridden `chunk_shape`).  Coarsening is
  per-object: each surviving object's vertices are aggregated into
  metavertices at the coarser bin grid.  `object_sparsity ∈ (0, 1]`
  in level metadata records what fraction of objects survived.

Equivalents:

| Concept                            | Precomputed                       | Zarr Vectors                                       |
|------------------------------------|-----------------------------------|----------------------------------------------------|
| Grid cells per axis at level L     | `spatial[L].grid_shape`           | `ceil((bounds_max - bounds_min) / chunk_shape_L)`  |
| Cell size at level L               | `spatial[L].chunk_size`           | root `chunk_shape` × per-level `chunk_scale_factor` |
| LOD selection knob                 | `spatial[L].limit`                | `reduction_factor` + per-level `object_sparsity`   |
| Cross-level identity               | annotation ID is shared across levels | OID-preserving pyramid (`preserves_object_ids = true`) |
| Drillable parent→child mapping     | implicit (random subsample)       | optional `links/<delta>/<offsets>` arrays ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional))   |

Precomputed's "drill the visible cells until you've returned at most
`limit` annotations per cell" maps to Zarr Vectors' "ask each level
for the object set; stop when `object_sparsity * source_count` fits
your budget."  The precomputed model is simpler and gets random
sampling for free; the Zarr Vectors model is more general (handles
extended objects, not just points) at the cost of an explicit
coarsener.

### K.5 Practical conversion notes

- **Single annotation type → single Zarr Vectors store** is a
  straightforward 1:1 transcode.  Pick the geometry mapping from
  [§K.2](#k2-mapping-the-four-geometry-primitives); emit one fragment per annotation; populate `object_index/`
  in dense OID order from the original `by_id` listing.
- **Properties** transcode field-for-field; preserve the original
  uint8 / int8 / ... types rather than upcasting.
- **Relationships** transcode to groups keyed by segment id.  In
  practice, very large segment-id spaces (10⁸+ segments) suggest
  using `object_attributes/segment_id` rather than `groups` if
  most segments touch zero or one annotation.
- **Spatial index** does NOT transcode 1:1.  The pyramid is rebuilt
  using the per-object coarsener; the precomputed `limit` rule has
  no direct Zarr Vectors equivalent.  A reasonable default is
  `reduction_factor = 8`, `object_sparsity ≈ limit / max_cell_count`
  per level, and `cross_level_storage = "implicit"` if downstream
  readers need to drill from coarse to fine.
- **Sharded vs unsharded** is invisible to the schema mapping —
  Zarr Vectors writes per-chunk blobs into a Zarr v3 store regardless
  of the backend's sharding.

### K.6 What Zarr Vectors adds over precomputed annotations

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

### K.7 What precomputed annotations preserve that Zarr Vectors does not (yet)

- **Sharded back-end** as a first-class schema concern.  Zarr Vectors
  delegates sharding to the underlying Zarr v3 store; it does not
  expose `sharding` blocks per index.
- **Per-property enum tables** as a typed schema field
  (`enum_values` / `enum_labels`).  Zarr Vectors carries this as
  free-form array metadata.
- **The "limit" LOD heuristic** — automatic, occupancy-driven
  downsampling without writing a coarsening pass.  In Zarr Vectors
  the writer must pick `bin_ratio` / `chunk_scale_factor` /
  `object_sparsity` deliberately.
