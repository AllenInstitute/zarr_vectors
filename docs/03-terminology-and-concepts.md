# 3. Terminology and Concepts

## 3.1 Core Terms

| Term | Meaning |
|------|---------|
| Spatial index | The N-dimensional coordinate system data is organized in (it may include time).  `sid_ndim` is its number of axes. |
| Spatial chunk | A region of the spatial index, addressed by an integer N-tuple on the chunk grid. |
| Vertex | A point with associated data: one row of a chunk's `vertices/<chunk>` blob. |
| Fragment | A subset of a chunk's vertex rows (and the parallel attribute and intra-chunk link rows): a range `[start, count)` or an explicit row list.  The unit of coarsening, object membership and (when shared) row re-use. |
| Fragment index | The per-chunk byte layout listing a cell's fragments, in `vertex_fragments/<chunk>` or `link_fragments/<chunk>`: header, range bitmap, range table, CSR explicit list ([§7.3](07-core-arrays.md#73-vertex-fragments)). |
| Manifest block | One entry of an object's manifest: a chunk and one or more fragments in it.  A mode-0 (single), mode-1 (range) or mode-2 (explicit) record in a vlen manifest blob, or one row of `manifest_blocks` in the dense layout ([§7.6](07-core-arrays.md#76-object-index)). |
| Object | A logical entity (mesh, streamline, cell, neuron) whose vertices may span many fragments and chunks, identified by a non-negative integer ID. |
| Group | A named collection of objects with no spatial extent (cell type, brain region, tract); one ragged row per group in `groups`. |
| Channel dimension | The attribute axis carrying multi-channel data (gene expression, colour, source/sink pair). |
| Per-level `chunk_shape` | A level's override of the root `chunk_shape`, a positive integer multiple per axis. |

## 3.2 Geometry Terms

| Term | Meaning |
|------|---------|
| Point cloud | Unstructured points; no links. |
| Mesh | Vertices joined into faces, carried by the `links/0/` family (`link_width = 3` for triangles). |
| Skeleton | A tree of parent edges (`link_width = 2`); most parents implicit under `links_convention = "implicit_sequential_with_branches"`. |
| Streamline / polyline | An ordered sequence of points (`links_convention = "implicit_sequential"`; links only where a path crosses a chunk). |
| Path | A connected sequence within a skeleton. |

## 3.3 Storage Terms

| Term | Meaning |
|------|---------|
| Zarr store | The underlying Zarr v3 storage (filesystem, object store, transactional store). |
| Zarr array | A Zarr v3 array.  Each per-chunk quantity is one vlen-bytes array over the level's chunk grid; non-spatial arrays are ragged or dense arrays.  Zarr stores the bytes; Zarr Vectors frames the records inside each cell. |
| Cell | One element of a per-chunk array: the payload of one spatial chunk.  Chunk `c` is cell `c - chunk_grid_origin`, stored at `<array>/c/<i>/<j>/<k>`. |
| Chunk | The unit of spatial chunking.  Metadata such as `nonempty_chunks` names it in dotted form, `<i.j.k>`. |
| `chunk_scale_factor` | The per-axis integer multiple of the root `chunk_shape` that a level's override applies. |
| Metadata | The attributes of each `zarr.json`; a node's format metadata is one attribute, `zarr_vectors`, discriminated by `kind` ([§3.7](#37-metadata-terms)). |
| Shard | One storage object holding the cells of several chunks of one per-chunk array.  Sharding changes only packing — keys, cells and metadata are unchanged — but the shard becomes the unit of write atomicity. |
| `shard_shape` | Optional root field: the writer's default cells per shard per axis (one integer, or one per axis).  Absent means unsharded.  Each array's own `zarr.json` says how it is packed. |
| `octree_sharding` | An optional Zarr v3 sharding codec (legacy name `zarr_octree_sharding`, also accepted), implemented by `zarr-octree`.  It stores a shard's cells in Z order, grouped into runs, with a sparse index of one row per stored cell.  Also the root field holding the codec's configuration (requires `shard_shape`) and the capability token.  A reader without the codec cannot read the arrays that use it. |

## 3.4 Indexing Terms

| Term | Meaning |
|------|---------|
| Spatial index chunk | Same as spatial chunk. |
| Object index | A level's `object_index/` group, mapping object IDs to manifests.  `layout` is `vlen_manifests_v1` (one `manifests` blob per row), `vlen_manifests_v2` (plus `object_ids`, so IDs may be sparse) or `dense_manifests_v1`.  Optional under `object_index_convention = "identity"` in a single-chunk store; required otherwise. |
| Dense manifests | The `dense_manifests_v1` layout: `manifest_spans` (`int64`, `(num_objects, 2)`: start, count) indexes `manifest_blocks` (`int64` or `int32`, `(n_blocks, sid_ndim + 1)`: chunk coordinates, fragment index), with `object_ids` as in v2.  Chosen by the root's `manifest_layout: "dense"`; declared by `dense_manifests`. |
| Octree chunks | An optional per-level layout where each chunk is a **leaf**: an aligned cube of `2^k` cells per side, sized by vertex count, stored at its minimum-corner cell's key.  Declared by the level's `octree_chunks` object and the `octree_chunks` capability.  The level's per-chunk arrays carry the `zarr_vectors_octree_chunks` marker codec, so an unaware reader fails rather than misreading leaves as cells. |
| Cross-chunk link | A record in `links/<delta>/<offsets>/` with a non-zero offsets segment: its endpoints are in different chunks (and, if `delta ≠ 0`, different levels).  An intra-chunk link is a record in the same family with all-zero offsets.  Each record is `link_width` chunk-local vertex indices ([§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)). |
| Source chunk | The chunk whose cell holds a link record; offsets are relative to it. |
| Resolution level | A pyramid level, named by bare integer (`0/`, `1/`, …). |
| Pyramid-level delta | The `<delta>` path segment of `links/` and `link_attributes/<name>/`: `0` intra-level, otherwise cross-level ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)). |
| Offsets segment | The path segment giving where a record's other endpoints sit relative to its source chunk: `link_width - 1` signed `sid_ndim`-tuples joined by `_`, or `self` when `link_width = 1`. |

## 3.5 Convention Terms

| Field | Values | Meaning |
|-------|--------|---------|
| `links_convention` | `explicit`, `implicit_sequential`, `implicit_sequential_with_branches` | How intra-chunk links are stored |
| `object_index_convention` | `standard`, `identity` | Whether `object_index/` exists (`identity` omits it in single-chunk stores) |
| `cross_chunk_strategy` | `explicit_links`, `boundary_deduplication`, `both` | How cross-chunk connectivity is represented |
| `cross_level_storage` | `none`, `implicit`, `explicit` | Which cross-level link arrays exist ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)) |
| `coarsening_method` | `per_object`, `manual`, `none` | How a level was generated |

## 3.6 Capability Tokens

Optional features advertised in the root's `format_capabilities`
([§8.2](08-metadata.md#82-root-level-metadata)):

| Token | Meaning |
|-------|---------|
| `fragment_index` | Reserved.  Every store uses the fragment index, and each fragment array declares it (`encoding: "fragment_index_v1"`); writers need not list it and readers MUST NOT require it. |
| `shared_fragments` | Fragments may be named by more than one object's manifest. |
| `preserved_object_ids` | A level inherits its parent's object-ID space; dropped objects keep empty manifests. |
| `multiscale_links` | The store has cross-level link arrays (`delta ≠ 0`).  Chunk-spanning records are ordinary links and need no token. |
| `dense_manifests` | An object index uses `dense_manifests_v1`. |
| `octree_sharding` | Sharded per-chunk arrays use the `octree_sharding` codec; reading them needs it. |
| `octree_chunks` | A level has octree chunks.  Also listed in `required_capabilities`; a reader without it MUST NOT read such a level. |

The set is open.  A reader that meets an unknown token MUST treat the
feature as absent or refuse the store; it MUST NOT assume the feature is
present.  `required_capabilities` lists the tokens a reader needs to
read the store at all; a reader SHOULD refuse a store that lists one it
does not support.

## 3.7 Metadata Terms

| Term | Meaning |
|------|---------|
| Convention | A registered, versioned metadata contract under the [Zarr Conventions specification](https://github.com/zarr-conventions/zarr-conventions-spec).  The format uses the [Zarr Vectors convention](https://github.com/AllenInstitute/zarr-vectors-convention) v0.1.0 (its whole metadata layer) and, on the root, the multiscales and proj conventions ([§1.4.7](01-introduction.md#147-zarr-conventions-the-metadata-layer)). |
| `zarr_conventions` | The attribute listing the conventions a node follows.  Every node with a `zarr_vectors` attribute MUST register the Zarr Vectors convention: the full entry (`schema_url`, `spec_url`, `uuid`, `name`, `description`) on the root, at least `{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}` elsewhere.  Writers keep other conventions' entries ([§8.9](08-metadata.md#89-convention-registration-zarr_conventions)). |
| `zarr_vectors` | The one attribute holding a node's Zarr Vectors properties.  Other conventions' keys (`multiscales`, `proj:projjson`, `ome`) and application metadata (`user_metadata`) sit beside it. |
| `kind` | The required field of every `zarr_vectors` object, naming the node's role.  Groups: `root`, `level`, `links_family`, `link_attribute_family`, `object_index`, `parametric`.  Arrays: `vertices`, `vertex_fragments`, `link_fragments`, `links`, `vertex_attribute`, `fragment_attribute`, `link_attribute`, `object_attribute`, `groups`, `group_attribute`, `parametric_objects`, `parametric_names`.  A reader SHOULD reject a node whose `kind` it does not recognise and MUST NOT interpret it as a known kind ([§8.12](08-metadata.md#812-version-rules)). |
| Root object | The root's `zarr_vectors` object (`kind: "root"`): `zv_version`, `axes`, `chunk_shape`, `bounds`, `geometry_types`, store-wide conventions and writer defaults ([§8.2](08-metadata.md#82-root-level-metadata)). |
| Level object | A level's `zarr_vectors` object (`kind: "level"`), including a coarse level's `bin_shape` and `bin_ratio` ([§8.3](08-metadata.md#83-resolution-level-metadata)). |
| Presence | Which cells of a per-chunk array hold data, cached in the array's `nonempty_chunks` as dotted keys. |
| Presence deferral | A build-time state, declared by the level object's `presence: "deferred"`, in which the level's per-chunk arrays carry no `nonempty_chunks`, so independent writers share no state.  A reader MUST then take presence from the store and MUST NOT treat such an array as empty.  A coordinator ends it by writing every `nonempty_chunks` and removing `presence` ([§8](08-metadata.md#deferred-presence)). |
| `attribute_specs` | Optional root field declaring attributes by scope (`vertex`, `object`, `link`, …), each `{name: {dtype, unit?}}`.  A declaration does not promise the array exists. |
| `zv_version` | The format version, on the root object.  A 0.10.0 reader refuses 0.9.x stores and newer minor versions ([§8.12](08-metadata.md#812-version-rules)). |
