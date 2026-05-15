# 7. Core Arrays

This section is the array-by-array reference.  Each array is a Zarr v3
group whose chunks are single-chunk-per-coord 1-D `uint8` byte blobs.
A per-array `zarr.json` carries a `"zv_array"` discriminator plus a
small shape/dtype block; per-array `.zattrs` does **not** duplicate
fields the byte payload already carries (e.g. `vertex_fragments` does
not store `num_fragments` outside the blob).

> Throughout this chapter, `.zattrs` is colloquial shorthand for the
> per-array **attributes** block inside the array's Zarr v3
> `zarr.json` (Zarr v3 does not write a separate `.zattrs` file).

## 7.1 Vertex Positions

- **Name**: `vertices`
- **Path**: `<level>/vertices/<i.j.k>` (one chunk key per occupied
  spatial chunk).
- **Payload**: raw little-endian floats (`float16` / `float32` /
  `float64`, dtype declared in `.zattrs`).  Row k is one
  `sid_ndim`-tuple position; the chunk holds `N_k` rows back-to-back.
- **Encoding**: `raw` (default) or `draco` (mesh-only; positions and
  faces are co-encoded inside a single Draco point-cloud or mesh
  blob).
- **Compression**: Blosc + Zstd + BYTE-SHUFFLE.
- **`.zattrs`**: `{"zv_array": "vertices", "dtype": "<dtype>",
  "encoding": "raw" | "draco"}`.
- **Spatial locality**: rows lie within the chunk's spatial bounds
  modulo boundary policy (writers may keep vertices physically outside
  the bin grid when they belong to objects that straddle a boundary;
  see [§6.4](06-spatial-indexing.md#64-boundary-conditions) and [§10](10-cross-chunk-linking.md)).

## 7.2 Vertex Attributes

- **Name**: `vertex_attributes`
- **Path**: `<level>/vertex_attributes/<name>/<i.j.k>`.
- **Payload**: raw little-endian rows, row-aligned to
  `vertices/<i.j.k>`.  Shape per chunk is `(N_k,)` for a scalar
  attribute or `(N_k, C)` for a multi-channel attribute (`C` declared
  in `.zattrs`).
- **`.zattrs`**: `{"zv_array": "attribute", "name": "<name>",
  "dtype": "<dtype>", "shape": [...]}`.  The optional `channel_names`
  / `channel_dtype` fields describe per-channel labels for multi-channel
  attributes (gene names, etc.).
- **Selective access**: a reader fetches only the
  `vertex_attributes/<name>/<i.j.k>` chunks it needs; chunk listings
  are O(non-empty-chunks).

## 7.3 Vertex Fragments

- **Name**: `vertex_fragments`
- **Path**: `<level>/vertex_fragments/<i.j.k>`.
- **Payload**: a single byte blob in the v1 fragment-index layout:

  ```text
  HEADER (16 bytes, 8-byte aligned)
    uint32 magic            = 0x5A56_4647  ('ZVFG')
    uint16 version          = 1
    uint16 flags            = 0
    uint32 num_fragments    F
    uint32 num_range_fragments R    (popcount of the bitmap; redundant)

  RANGE BITMAP
    ceil(F/8) bytes, padded to the next 8-byte boundary
    bit f (LSB-first within byte f//8) = 1 iff fragment f is a range

  RANGE TABLE                       (R entries × 16 bytes)
    int64 start, int64 count        per range fragment, in fragment order

  EXPLICIT CSR                      (E = F − R entries)
    uint32 explicit_offsets[E+1]    running offsets into explicit_indices
    int64  explicit_indices[T]      concatenated row indices,
                                    T = explicit_offsets[E]
  ```

  Each fragment is either a contiguous **range** `[start, start+count)`
  of row indices into `vertices/<i.j.k>` or an explicit **list** of
  row indices.  Explicit fragments may share row indices, enabling
  vertex re-use across fragments inside one chunk.

- **`.zattrs`**: `{"zv_array": "vertex_fragments"}`.  All structural
  numbers (F, R, T) live in the blob header so `.zattrs` stays
  minimal.
- **Random access**: `is_range(f)` is a single bit lookup; `range(f)`
  and `indices(f)` use a lazy prefix-popcount of the bitmap.
- **Compression**: Blosc + Zstd + BYTE-SHUFFLE (the heterogeneous
  int64 + uint32 payload decorrelates well after byte-shuffling).

The legacy `vertex_group_offsets` array (paired `(K, 2)` int64 offsets,
pre-0.5) was first reduced to a flat `(K,)` int64 of vertex offsets
(0.5), then replaced entirely by `vertex_fragments` (0.6) so that
fragment membership and row sharing can both be expressed.

## 7.4 Groups

- **Name**: `groups`
- **Path**: `<level>/groups/data`.
- **Payload**: flat ragged CSR.  Two blobs in practice — `groups/data`
  carries concatenated `int64` object IDs, with row partitions inside
  the same blob (CSR offsets prefixed; see the encoding implementation
  for byte details).  Logically `(G,)` rows, each a variable-length
  list of object IDs.
- **`.zattrs`**: `{"zv_array": "groups", "num_groups": G, ...}`.
- **Companion**: `group_attributes/<name>/data` carries per-group
  attribute arrays of shape `(G,)` or `(G, C)` with `.zattrs`
  `{"zv_array": "groupings_attribute", "name": "<name>", "dtype":
  "<dtype>", "shape": [...]}`.  (The discriminator literal kept the
  legacy string for on-disk compatibility; the conceptual rename is
  `groupings` → `groups`.)

Groups have no spatial extent — they describe arbitrary partitions of
the object set (cell types, brain regions, fascicle bundles, …).
Group hierarchy is encoded via group-level attributes (`super_type`,
parent id, …); the format does not impose a tree.

## 7.5 Vertex Links

- **Name**: `links`
- **Path**: `<level>/links/<delta>/<i.j.k>`.
- **`<delta>` axis**: the *pyramid-level delta* between the two link
  endpoints.  `delta = 0` is mandatory whenever the geometry has
  explicit links; `delta ≠ 0` is optional and only emitted when
  `cross_level_storage != "none"` (see [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).

### delta = 0 (intra-level)

- **Payload**: a flat concatenated payload of link rows, each row
  `link_width` × `int64` vertex-row indices.  Vertex indices are
  chunk-local (they reference rows of `vertices/<i.j.k>`).
- **Companion**: `link_fragments/<i.j.k>` — fragment index in the
  same v1 byte layout as [§7.3](#73-vertex-fragments) — carries the per-fragment partition of
  link rows.  Each link fragment is the set of link rows belonging to
  one vertex fragment (so `link_fragments` partitions
  `links/0/<i.j.k>` row-for-row in parallel with how
  `vertex_fragments/<i.j.k>` partitions `vertices/<i.j.k>`).
- **`.zattrs`**: `{"zv_array": "links", "level_delta": 0,
  "link_width": L, "num_links": M, "dtype": "int64"}`.
- **`link_width`**:
  - `1` — single parent reference (skeleton parents, pyramid
    metanode drill-down).
  - `2` — generic edge (graph, polyline-with-branches).
  - `3` — mesh face (triangle).

### delta ≠ 0 (cross-pyramid-level — optional)

- **Payload**: an inline self-describing record stream.  Each record
  is `link_width` endpoints, each endpoint a `(chunk_coords,
  local_vertex_index)` pair.  Endpoint 0 lives at the *owning* level
  L; endpoints `k > 0` live at level `L + delta`.  For `link_width =
  1`, the single endpoint is at `L + delta` and is paired with an
  implicit source defined by the owning chunk (the record stores only
  the child reference).
- **No `link_fragments/` companion**: cross-level links don't reuse
  the intra-level fragment-index partitioning.  Records carry their
  own chunk coordinates inline.
- **When emitted**: only when `cross_level_storage` ∈ {`implicit`,
  `explicit`}.  Stores with `cross_level_storage = "none"` never
  contain `links/<delta>/<chunk>` for `delta ≠ 0`.

### Implicit-sequential convention

When the geometry is purely sequential — streamlines, polylines, or
skeletons that are mostly sequential with a few branches — the root
metadata's `links_convention` lets writers skip materializing the
intra-level link records:

- `"implicit_sequential"` — within each fragment, vertex `i` connects
  to vertex `i+1`.  The `links/0/` group is omitted entirely.
- `"implicit_sequential_with_branches"` — sequential parents are
  implicit; `links/0/<i.j.k>` stores only the *non-sequential* (branch)
  rows.
- `"explicit"` — every link is materialized.

Cross-chunk links (`cross_chunk_links/0/`) and cross-level links
(`links/<delta>/`, `delta ≠ 0`) are unaffected by the implicit
convention — they are always explicit.

## 7.6 Object Index

- **Name**: `object_index`
- **Path**: `<level>/object_index/data` (single flat blob).
- **Payload**: B per-object manifests, back-to-back.  Each manifest is
  a sequence of *manifest blocks*; each block names one spatial chunk
  and a fragment reference:

  ```text
  Per-object manifest
    uint32 num_blocks B_obj

  Per block (one chunk's worth of references)
    int64 chunk_coords[sid_ndim]
    uint8 mode
      mode = 0  (single)       int64 fragment_index
      mode = 1  (range)        int64 start, int64 count
      mode = 2  (explicit)     uint32 count, int64 fragment_indices[count]
  ```

  All fragment references are **chunk-local** — they index into
  `vertex_fragments/<chunk_coords>` only.  This is what lets writers
  author chunks independently: no global fragment-numbering scheme.

- **`.zattrs`**: `{"zv_array": "object_index", "num_objects": B,
  "sid_ndim": ndim}`.
- **Empty manifest**: `B_obj = 0` — represents an object that exists
  in the OID space but carries no fragments at this level (used by
  ID-preserving pyramids that drop objects without renumbering).

### Identity convention

When the store has exactly one spatial chunk, the root metadata may
set `object_index_convention = "identity"`.  In this mode the
`object_index/` array is omitted entirely; `object_id ==
fragment_index` for the single chunk.  Multi-chunk stores must use
the explicit standard convention (`object_index_convention =
"standard"`, the default).

## 7.7 Cross-Chunk Links

- **Name**: `cross_chunk_links`
- **Path**: `<level>/cross_chunk_links/<delta>/data` (single flat
  blob per delta).
- **Payload**: `num_links` records back-to-back.  Each record holds
  `link_width` endpoints, each endpoint a
  `(int64 chunk_coords[sid_ndim], int64 local_vertex_index)`.
- **`.zattrs`**: `{"zv_array": "cross_chunk_links", "level_delta":
  <delta>, "link_width": L, "num_links": M, "sid_ndim": ndim}`.
- **Endpoint level convention**: endpoint 0 lives at the *owning*
  resolution level L; endpoints `k > 0` live at `L + delta`.  For
  `delta = 0` both endpoints are at the same level; for `delta ≠ 0`
  endpoint 0 is at level L and the remaining endpoints are at level
  `L + delta` (which may have a different `chunk_shape` and therefore
  a different chunk grid — see [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
- **`link_width` values**: same as [§7.5](#75-vertex-links) — `2` for edges, `3` for
  triangle faces (the v0.5 replacement for the dropped
  `cross_chunk_faces/` array), `1` for single child references in
  metanode drill-down.
- **Optional capability**: when any non-zero-delta `cross_chunk_links`
  array exists, the store advertises `CAP_MULTISCALE_LINKS` in its
  `format_capabilities`.

## 7.8 Link Attributes

- **Name**: `link_attributes`
- **Path**: `<level>/link_attributes/<name>/<delta>/<i.j.k>`.
- **Payload**: row-aligned to `links/<delta>/<i.j.k>`.  One row per
  link record.  Shape `(M_k,)` or `(M_k, C)`.
- **`.zattrs`**: same shape as [§7.2](#72-vertex-attributes).
- **Optional**: emitted only when the writer chose to carry per-link
  attributes; absent by default.

## 7.9 Cross-Chunk Link Attributes

- **Name**: `cross_chunk_link_attributes`
- **Path**: `<level>/cross_chunk_link_attributes/<name>/<delta>/data`.
- **Payload**: row-aligned to `cross_chunk_links/<delta>/data`.  Shape
  `(num_links,)` or `(num_links, C)`.
- **`.zattrs`**: `{"zv_array": "cross_chunk_link_attribute", "name":
  "<name>", "dtype": "<dtype>", "shape": [...]}`.
- **Length is runtime-checked** against the parallel CCL array's
  `num_links` field — a desynchronized write fails loudly.

## 7.10 Object Attributes

- **Name**: `object_attributes`
- **Path**: `<level>/object_attributes/<name>/data` (single blob per
  attribute).
- **Payload**: dense per-object rows in object_id order, shape
  `(B,)` or `(B, C)`.  No fragment-indexing — the array is keyed by
  the same OID space as `object_index/`.
- **`.zattrs`**: standard attribute schema (`name`, `dtype`, `shape`,
  optional `channel_names`).
