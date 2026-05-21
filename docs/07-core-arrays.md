# 7. Core Arrays

This section is the array-by-array reference.  Each array is a Zarr v3
array whose dtype, chunk shape, and codec pipeline depend on its role:

- **Geometry and attribute arrays** (`vertices`, `links`,
  `vertex_attributes`, `fragment_attributes`, `object_attributes`, ...) use standard numeric
  dtypes — `float16` / `float32` / `float64` / `int64` — declared in
  `.zattrs.dtype` and flow through the standard Zarr v3 codec
  pipeline.  A vanilla zarr reader sees them as ordinary numeric arrays.
- **Index and framing arrays** (`vertex_fragments`, `link_fragments`,
  per-object manifest blobs in `object_index/`) carry
  **project-internal binary record framings** inside `uint8` or
  vlen-bytes chunks.  They bypass the Zarr codec pipeline (see
  [§11.4](11-compression-and-encoding.md#114-compression-strategy)) and
  require a zarr-vectors-aware decoder to interpret.

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
- **Payload**: raw little-endian values whose dtype is declared in
  `.zattrs.dtype`.  Any numeric dtype that can carry spatial
  coordinates is allowed: **floats** (`float16` / `float32` /
  `float64`) for continuous physical units, or **integers** (signed
  or unsigned, any width — `uint8`, `int16`, `uint32`, `int64`, ...)
  for voxel-indexed positions, Draco-quantized stores, or
  fixed-precision data where storage matters more than continuous
  resolution.  Row k is one `sid_ndim`-tuple position; the chunk
  holds `N_k` rows back-to-back.

  The only formal requirement is that the dtype be comparable to the
  values in root `bounds` — i.e. orderable and broadcastable — so
  bounding-box queries work.  Float bounds with integer vertex
  positions (or vice-versa) are fine; the reader coerces at compare
  time.
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

### 7.3.1 Design rationale

The v1 fragment-index format makes three structural choices that are
not obvious from the byte layout in §7.3 alone: it supports two
fragment kinds (range and explicit), it discriminates between them
with a one-bit-per-fragment bitmap rather than a per-fragment tag,
and it pairs the bitmap with a dense per-kind table layout.  This
subsection explains why.  On codec choices for the blob itself see
[§11.4](11-compression-and-encoding.md#114-compression-strategy).

#### The single-owner vs. multi-owner tradeoff

The fragment-index format settles a question that recurs at every
layer of ZV's ownership hierarchy: **can one element be referenced
by more than one owner?** The same tension appears between vertices
or links and fragments (does a single row of `vertices/<chunk>`
belong to one fragment or many?), between fragments and objects
(does a fragment belong to one object's manifest or several?), and
between objects and groups (does an object belong to one group or
many?).  Each layer of the format makes its own choice; this
subsection is about the choice at the vertex/link → fragment layer.

Two extremes bound the design space:

- **Single-owner.**  Every row of `vertices/<chunk>` (or
  `links/0/<chunk>`) belongs to exactly one fragment.  Writers
  then have the freedom to organise the payload so that all rows
  of a fragment lie contiguously, and the index has to store only
  the run `[start, count)` per fragment.  Reads are cheap — one
  `np.arange`, one row-slice into the chunk's payload array —
  and index storage is `O(F)` with a small per-fragment constant.
- **Multi-owner.**  A single row may be referenced by several
  fragments.  Writers no longer get contiguity for free — a
  shared row can only sit in one place in the chunk payload, so
  it cannot also be adjacent to every fragment that claims it.
  The index has to carry an explicit list of row indices per
  fragment, storage grows to `O(sum of fragment sizes)`, and
  every fragment read becomes a gather rather than a slice.

The single-owner model is cheap when sharing is rare.  The
multi-owner model is necessary when duplicating the shared rows
would dominate storage.  The canonical case is the **coarsened
metanode-merged pyramid level**, where a single metavertex is on
the path of *N* parent objects and duplicating its row *N* times
costs N× storage plus N× bytes through the network on every bbox
read that touches the chunk.  But the same tension shows up
anywhere a writer might want to express row reuse without paying
for duplication — branchy graphs at level 0 where two edges share
an interior vertex, polyline endpoints claimed by separate
objects, custom writers that emit overlapping fragments by design.

The v1 fragment-index format chooses **neither extreme**.  It
gives writers the multi-owner capability — explicit fragments
are a first-class kind — while preserving the single-owner read
cost for fragments that *happen to be* contiguous runs.  The
bitmap discriminator (see below) is the mechanism that makes this
possible: the index declares "this fragment is a run" with one
bit and stores its two parameters in a dense range table, falling
back to the explicit row list only when the writer actually
needed sharing.  Crucially, readers classify any fragment as
"range" or "explicit" in O(1) from the bitmap alone — they do
not have to scan or decompress the index to find out.

The practical consequences:

- At level 0 with the default writer, every fragment is a range.
  The format collapses to "one `(start, count)` per non-empty
  bin", byte-equivalent (modulo the bitmap and header) to the
  pre-0.6 contiguous-row index.  The multi-owner machinery costs
  almost nothing when no one uses it.
- At coarsened metanode-merged levels, shared metavertices appear
  as explicit fragments while non-shared coarsened fragments stay
  as ranges.  Sharing is paid for only on the rows that actually
  need it.
- The format does not branch at the level or chunk header — only
  per-fragment, at the bitmap bit.  A single byte layout serves
  both modes.

The rest of this subsection explains *how* the format achieves
that hybrid: why two fragment kinds rather than always-explicit
(below), why a bitmap rather than other discriminators (further
below), and how the layout reads as a structural compression
scheme.

#### Why two fragment kinds at all

Storing every fragment as an explicit index list (the most general
form) is structurally simpler but fails on three counts:

1. **Storage cost.**  A typical level-0 bin holds dozens to hundreds
   of vertices.  As a range fragment it costs 16 bytes regardless of
   `count`.  As an explicit list it costs 4 bytes (CSR offset slot)
   plus `8 × count` bytes — so `count = 50` is 404 bytes vs. 16
   bytes, a ~25× blowup on the *common case* in service of a feature
   only coarsened levels need.
2. **Decode cost.**  Range fragments materialise as
   `np.arange(start, start + count)` — zero allocation when the
   caller just wants `vertices[start : start + count]`.  Explicit
   fragments require a gather load and a CSR offset lookup.  Forcing
   every fragment through the gather path adds per-fragment overhead
   that compounds across thousands of fragments in a typical chunk.
3. **Format predictability.**  The level-0 stable case maps cleanly
   to neighbouring formats' contiguous-row conventions (Arrow
   run-end, Parquet RLE, the pre-0.6 `(offset, count)` table).
   Keeping that representation first-class makes the format legible
   at a glance and makes level-0 reads byte-identical in their
   per-chunk hot path to what the pre-0.6 format produced.

Conversely, forcing *every* fragment into a range would forbid the
shared-metavertex case the 0.6 rewrite was undertaken for.  Hence
two kinds, paid for only where they're earned.

#### Why the bitmap is the discriminator

Given two kinds, the format needs a way for the reader to ask
"what kind is fragment `f`?" before deciding which table to consult.
Four plausible designs, with costs at `F = 256` fragments and
`E = 4` explicit:

| Design | Classify cost | Bytes for `F = 256`, `E = 4` | Random-access by `f` |
|--------|--------------|------------------------------|----------------------|
| Per-fragment tag byte | O(1) | 256 B | O(1) |
| Sorted list of explicit fragment IDs | O(log E) | 16 B | needs bsearch per query |
| One-bit-per-fragment bitmap | O(1) | 32 B | O(1) bit test |
| Detect dynamically from indices | O(`count`) scan | 0 B (but forces all-explicit storage) | scan per fragment |

The bitmap dominates: 1/8th the bytes of per-fragment tags, O(1)
classify-by-`f` (single byte fetch + shift + mask), and no scan over
the index list.  The "sorted explicit-ID list" is byte-cheaper when
`E` is tiny but loses the O(1) classify property — readers wouldn't
know "is `f = 137` explicit?" without a binary search per lookup.

The bitmap pays its modest fixed cost (`ceil(F/8)` bytes) in exchange
for *structural* compression: with one bit per fragment, the format
declares "this run is contiguous" without storing the run elements
themselves.  The range table then carries only two int64 values for
that run, regardless of length.

#### Reading the format as a structural compression scheme

The v1 layout is best understood as a small structural compression
scheme rather than as a data structure.  The bitmap encodes a 1-bit
"is this row range a constant arithmetic progression?" flag per
fragment — run-length encoding over *flags* rather than over values.
The range table stores the two parameters (`start`, `count`) that
reconstruct the implicit arithmetic progression — a tight
parametric form.  The CSR explicit table stores the override list
only for fragments where the parametric form does not apply.  The
header carries the popcount that lets the decoder build the
prefix-popcount lookup in one pass.

The reader pays the cost of the explicit override only when the
writer chose to use it.  The bitmap is what makes "is this a range?"
a free question — and that, more than any specific byte saving, is
the property the format exists to provide.

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
  `link_width` × integer vertex-row indices.  Vertex indices are
  **chunk-local** — they reference rows of `vertices/<i.j.k>`.
  Because the index space is bounded by `n_vertices_in_chunk`, the
  writer SHOULD pick the narrowest unsigned (or signed) integer dtype
  that covers the expected per-chunk vertex count: `uint8` for
  chunks with ≤ 256 vertices, `uint16` for ≤ 64 K, `uint32` for ≤ 4 G,
  `int64` as the universally-safe fallback.  Narrower dtypes are a
  4–8× storage savings on typical data and the reader honours
  whatever is declared in `.zattrs.dtype`.
- **Companion**: `link_fragments/<i.j.k>` — fragment index in the
  same v1 byte layout as [§7.3](#73-vertex-fragments) — carries the per-fragment partition of
  link rows.  Each link fragment is the set of link rows belonging to
  one vertex fragment (so `link_fragments` partitions
  `links/0/<i.j.k>` row-for-row in parallel with how
  `vertex_fragments/<i.j.k>` partitions `vertices/<i.j.k>`).
- **`.zattrs`**: `{"zv_array": "links", "level_delta": 0,
  "link_width": L, "num_links": M, "dtype": "<integer dtype>"}`.
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
- **Path** (v0.8+): records are filed into **K-separated sharded
  vlen-bytes zarr arrays** under
  `<level>/cross_chunk_links/<delta>/kK`, one `kK` per distinct K
  (`1 ≤ K ≤ link_width`).  Each `kK` array has shape `(Cx,…)*K`,
  inner chunks of `(1,)*(sid_ndim*K)`, and outer shards of
  `(4,)*(sid_ndim*K)` by default.  A record whose sorted-unique
  chunks are `(c_0, …, c_{K-1})` (lex order) lives at cell coord
  `(c_0 - origin) ⧺ … ⧺ (c_{K-1} - origin)` where `origin` is
  `kK.attrs.chunk_origin`.  See
  [§10.6](10-cross-chunk-linking.md#106-on-disk-layout-k-separated-sharded-vlen-bytes-arrays)
  for the full layout description.
- **Per-record payload**: each record is `link_width` chunk-indices
  (uint8, one per endpoint) followed by `link_width` local vertex
  indices (int64, one per endpoint) — total `9 * link_width` bytes
  per record.  The chunk-index `ci_i` selects one of the K sorted
  chunks in the cell coord; that's the chunk endpoint `i` lives in.
  No chunk coords are repeated inside the payload.
- **Parent-group `.zattrs`**: `{"zv_array": "cross_chunk_links",
  "level_delta": <delta>, "link_width": L, "sid_ndim": ndim, "layout":
  "sharded_v1"}`.  Each `kK` array additionally carries
  `{"zv_array": "cross_chunk_links_kN", "K": K, "chunk_origin":
  [o_0, …]}` and standard zarr `shape` / `chunk_shape` / codecs.
  `num_links` is no longer stored anywhere — per-cell counts are
  derived from cell byte length as `len(bytes) / (9 * link_width)`.
- **Endpoint level convention**: endpoint 0 (`ci_0`, `vi_0`) lives at
  the *owning* resolution level L; endpoints `k > 0` live at `L +
  delta`.  For `delta = 0` both endpoints are at the same level; for
  `delta ≠ 0` endpoint 0 is at level L and the remaining endpoints are
  at level `L + delta` (which may have a different `chunk_shape` and
  therefore a different chunk grid — see [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
- **Canonicalization**: writers MUST emit `ci = [0, 1]` for
  `delta = 0 AND link_width = 2` (undirected edges).  Other cases
  have no spec-mandated canonicalization; the `ci` permutation
  preserves semantic ordering (source/target for cross-level links,
  face winding for mesh records).
- **`link_width` values**: same as [§7.5](#75-vertex-links) — `2` for edges, `3` for
  triangle faces (the v0.5 replacement for the dropped
  `cross_chunk_faces/` array), `1` for single child references in
  metanode drill-down.
- **Capabilities**: any `cross_chunk_links/<delta>/` group at any
  delta makes the store advertise both `CAP_MULTISCALE_LINKS` and
  `CAP_PARTITIONED_CROSS_CHUNK_LINKS` in its `format_capabilities`.
  Stores that carry `multiscale_links` without
  `partitioned_cross_chunk_links` are v0.7-era monolithic-blob stores
  and need migration before a v0.8 reader can open them — see [§10.9](10-cross-chunk-linking.md#109-migration-from-v07).

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
- **Path** (v0.8+): partitioned in lockstep with `cross_chunk_links/`:
  `<level>/cross_chunk_link_attributes/<name>/<delta>/kK`.  One
  attribute kN array per matching link kN array, with matching cell
  coords.
- **Per-cell payload**: one row per cross-chunk record in the
  matching link cell, in record order.  Shape `(num_records_in_cell,)`
  or `(num_records_in_cell, C)` for multi-channel attributes; packed
  as vlen-bytes per cell.
- **Parent-group `.zattrs`**: `{"zv_array": "cross_chunk_link_attribute",
  "name": "<name>", "dtype": "<dtype>", "level_delta": <delta>,
  "shape": null or [C], "layout": "sharded_v1"}`.  `num_links` is
  no longer stored anywhere.
- **Per-cell parity invariant**: for every populated attribute cell,
  its record count equals the parallel
  `cross_chunk_links/<delta>/kK` cell's record count at the same
  cell coord.  A desynchronized write fails loudly at read time.

## 7.10 Object Attributes

- **Name**: `object_attributes`
- **Path**: `<level>/object_attributes/<name>/data` (single blob per
  attribute).
- **Payload**: dense per-object rows in object_id order, shape
  `(B,)` or `(B, C)`.  No fragment-indexing — the array is keyed by
  the same OID space as `object_index/`.
- **`.zattrs`**: standard attribute schema (`name`, `dtype`, `shape`,
  optional `channel_names`).

## 7.11 Fragment Attributes

- **Name**: `fragment_attributes`
- **Path**: `<level>/fragment_attributes/<name>/<i.j.k>`.
- **Payload**: raw little-endian rows, row-aligned to fragments in
  `vertex_fragments/<i.j.k>`.  Shape per chunk is `(F_k,)` for a
  scalar attribute or `(F_k, C)` for a multi-channel attribute (`C`
  declared in `.zattrs`), where `F_k` is the chunk's `num_fragments`
  carried in the [§7.3](#73-vertex-fragments) fragment-index header.
- **`.zattrs`**: `{"zv_array": "fragment_attribute", "name": "<name>",
  "dtype": "<dtype>", "shape": [...]}`.  The optional `channel_names`
  / `channel_dtype` fields describe per-channel labels for multi-channel
  attributes.
- **Optional**: emitted only when the writer chose to carry per-fragment
  attributes; absent by default.
- **Selective access**: a reader fetches only the
  `fragment_attributes/<name>/<i.j.k>` chunks it needs; chunk listings
  are O(non-empty-chunks).
