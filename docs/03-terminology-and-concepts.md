# 3. Terminology and Concepts

## 3.1 Core Terms

- **Spatial Index**: N-dimensional coordinate system for organizing
  data (may include time).  Number of *space* axes is `sid_ndim`.
- **Spatial Chunk**: A region in spatial-index space containing
  vector data, addressed by an integer N-tuple in chunk-grid space.
- **Vertex**: A point in N-dimensional space with associated data.
  Lives as one row inside a chunk's `vertices/<chunk>` byte blob.
- **Fragment**: A subset of rows of a chunk's `vertices/<chunk>` (and
  the parallel rows of `vertex_attributes/`, `links/0/<chunk>`, …),
  expressed as either a contiguous range `[start, count)` or an
  explicit list of row indices.  The unit of pyramid coarsening,
  object membership, and (when shared) row re-use.  Carried in
  `vertex_fragments/<chunk>` in the fragment-index byte layout.
- **Vertex Group** *(deprecated)*: pre-0.6 term for what the current
  schema calls a **fragment**.  Some on-disk discriminator literals
  (`"groupings_attribute"`) retain the legacy spelling for
  back-compatibility; prose uses **fragment** uniformly.
- **Fragment Index**: The per-chunk byte layout that describes the
  F fragments inside one chunk's `vertex_fragments/<chunk>` (or
  `link_fragments/<chunk>`).  Header + range bitmap + range table +
  CSR explicit list ([§7.3](07-core-arrays.md#73-vertex-fragments)).
- **Manifest Block**: One entry in an object's per-object manifest in
  `object_index/data`.  Names a chunk and references one or more
  fragments within that chunk via mode-0 (single), mode-1 (range),
  or mode-2 (explicit) encoding ([§7.6](07-core-arrays.md#76-object-index)).
- **Object**: A logical entity (a mesh, a streamline, a cell, a
  neuron, …) whose vertices may live in many fragments across many
  chunks.  Identified by a dense object ID `[0, B)`.
- **Group**: A named collection of objects with no spatial extent —
  partitions the object set (cell types, brain regions, fascicle
  bundles, …).  Stored as flat ragged CSR at `groups/data`.
- **Channel Dimension**: Per-vertex (or per-object, per-group)
  attribute axis carrying multi-channel data (gene expression,
  color, source/sink region pair, …).
- **Per-Level chunk_shape (v0.7)**: Each pyramid level may override
  the root `chunk_shape` by a positive integer multiple per axis.
  Coarser levels can grow chunks the way OME-Zarr image pyramids do
  via voxel-size scaling.

## 3.2 Geometry Terms

- **Point Cloud**: Unstructured collection of points (no links).
- **Mesh**: Connected vertices forming surfaces or volumes;
  `links/0/<chunk>` carries faces (`link_width = 3` for triangles).
- **Skeleton**: Graph structure with parent links (`link_width = 1`,
  most parents implicit under
  `links_convention = "implicit_sequential_with_branches"`).
- **Streamline / Polyline**: Ordered sequence of connected points
  (`links_convention = "implicit_sequential"`; no `links/` array).
- **Path**: A connected sequence within a skeleton.

## 3.3 Storage Terms

- **Zarr Store**: The underlying Zarr v3 storage (filesystem, object
  store, transactional store …).
- **Zarr Array**: A multi-dimensional array in Zarr v3 format.  In
  ZV, every named array is a 1-D `uint8` single-chunk-per-coord
  array — Zarr handles compression and storage, ZV handles record
  framing inside each chunk's payload.
- **Chunk**: In ZV, the unit of *spatial chunking* — addressed by
  an N-tuple in chunk-grid space.  The Zarr v3 chunk-key encoding is
  the dot-separated form (`<i.j.k>`).
- **chunk_scale_factor**: The per-axis integer multiple of root
  `chunk_shape` carried by a per-level chunk_shape override
  (v0.7+).  Exposed by `chunk_scale_factor(root_meta, level_meta)`.
- **Metadata**: Structured information stored in Zarr v3 `zarr.json`
  files under namespaced keys (`zarr_vectors`, `zarr_vectors_level`,
  `zv_array`).

## 3.4 Indexing Terms

- **Spatial Index Chunk**: A region in spatial-index space; same as
  *spatial chunk* above.
- **Object Index**: Index mapping object IDs to per-chunk manifest
  blocks (`object_index/data`).  Optional when `object_index_convention
  = "identity"` and the store has exactly one spatial chunk;
  required otherwise.
- **Cross-Chunk Link**: A record in a `cross_chunk_links/<delta>/kK`
  sharded vlen-bytes array (one per distinct K, `1 ≤ K ≤ link_width`)
  whose endpoints live in different chunks (and, when `delta ≠ 0`,
  at different pyramid levels).  Each record is `L = link_width`
  `(chunk_index, vertex_index)` pairs; the chunk identity of each
  endpoint is recovered from the cell coord's K sorted chunk segments
  via the per-endpoint `chunk_index`.  See [§10.6](10-cross-chunk-linking.md#106-on-disk-layout-k-separated-sharded-vlen-bytes-arrays).
- **Resolution Level**: A level in the multi-resolution pyramid,
  named by bare integer (`0/`, `1/`, …, `N/`).
- **Pyramid-Level Delta**: The `<delta>` segment in
  `links/<delta>/<chunk>` / `cross_chunk_links/<delta>/kK` paths.
  `delta = 0` is intra-level; `delta ≠ 0` is cross-pyramid-level
  (optional — see [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).

## 3.5 Convention Terms

- **`links_convention`** ∈ `{"explicit", "implicit_sequential",
  "implicit_sequential_with_branches"}`: how intra-chunk links are
  stored.
- **`object_index_convention`** ∈ `{"standard", "identity"}`:
  whether `object_index/` is materialized (`"identity"` omits it for
  single-chunk stores).
- **`cross_chunk_strategy`** ∈ `{"explicit_links",
  "boundary_deduplication", "both"}`: how cross-chunk connectivity
  is represented.
- **`cross_level_storage`** ∈ `{"none", "implicit", "explicit"}`:
  whether (and which direction) of cross-pyramid-level link arrays
  to materialize ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
- **`coarsening_method`** ∈ `{"per_object", "manual", "none"}`: how
  a pyramid level was generated.

## 3.6 Capability Tokens

Optional features advertised in `format_capabilities` (see [§8.2](08-metadata.md#82-root-level-metadata)):

- **`fragment_index`** — store uses the v0.6 fragment-index encoding
  (mandatory for 0.6+).
- **`shared_fragments`** — per-chunk fragments may be referenced by
  multiple objects' manifests (renamed from pre-0.6
  `shared_vertex_groups`).
- **`preserved_object_ids`** — at least one pyramid level inherits
  the parent OID space; dropped objects retain empty manifest slots.
- **`multiscale_links`** — store uses the `<delta>` sub-folder layout
  and may contain cross-pyramid-level edges.
- **`partitioned_cross_chunk_links`** — store uses the v0.8
  sharded cross-chunk-link layout (kN array cells keyed by sorted
  unique chunks).  Coupled with `multiscale_links`: any store with a
  `cross_chunk_links/<delta>/` group MUST carry both tokens.
