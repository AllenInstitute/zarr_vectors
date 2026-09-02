# 7. Core Arrays

This section is the array-by-array reference.  Two physical shapes
cover every array in a store:

- **Per-spatial-chunk arrays** (`vertices`, `vertex_fragments`,
  `link_fragments`, `links/<delta>/<offsets>`,
  `vertex_attributes/<name>`, `fragment_attributes/<name>`,
  `link_attributes/<name>/<delta>/<offsets>`) are each **one** Zarr v3
  vlen-bytes array over the level's chunk grid.  One cell holds one
  spatial chunk's payload bytes; the element dtype and the record
  framing inside a cell are declared in the array's attributes and are
  opaque to Zarr.  Chapter [§5.2](05-zarr-store-structure.md#52-zarr-version-requirements)
  gives the cell model — grid origin, presence, sharding — and this
  chapter gives each array's payload.
- **Non-spatial arrays** (`object_index/manifests`, `groups`,
  `object_attributes/<name>`, `group_attributes/<name>`) are single
  Zarr arrays at their logical path, ragged (vlen-bytes) or dense
  (numeric) as noted per array.

Throughout, `<i.j.k>` names a spatial chunk; that chunk is a *cell* of
the array, and its file lives at `<array>/c/<i>/<j>/<k>`.

A per-array `zarr.json` carries a `"zv_array"` discriminator plus a
small shape/dtype block; it does **not** duplicate fields the byte
payload already carries (e.g. `vertex_fragments` does not store
`num_fragments` outside the blob).

> Throughout this chapter, `.zattrs` is colloquial shorthand for the
> per-array **attributes** block inside the array's Zarr v3
> `zarr.json` (Zarr v3 does not write a separate `.zattrs` file).

## 7.1 Vertex Positions

- **Name**: `vertices`
- **Path**: `<level>/vertices`, one cell per occupied spatial chunk
  (file at `c/<i>/<j>/<k>`).
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
- **Compression**: none by default; see
  [§5.2](05-zarr-store-structure.md#52-zarr-version-requirements).
- **`.zattrs`**: `{"zv_array": "vertices", "dtype": "<dtype>",
  "encoding": "raw" | "draco"}`, plus the per-chunk-array attributes
  `nonempty_chunks` and (when non-zero) `chunk_grid_origin`.  The
  element dtype MUST be read from the `dtype` attribute — the Zarr
  `data_type` is `variable_length_bytes` for every cell.
- **Row count**: `N_k` is derived, `len(cell) // (itemsize * sid_ndim)`;
  it is not stored.
- **Spatial locality**: rows lie within the chunk's spatial bounds
  modulo boundary policy (writers may keep vertices physically outside
  the bin grid when they belong to objects that straddle a boundary;
  see [§6.4](06-spatial-indexing.md#64-boundary-conditions) and [§10](10-cross-chunk-linking.md)).

## 7.2 Vertex Attributes

- **Name**: `vertex_attributes`
- **Path**: `<level>/vertex_attributes/<name>`, one cell per spatial
  chunk.
- **Payload**: raw little-endian rows, row-aligned to the `vertices`
  cell at the same coordinate.  Shape per chunk is `(N_k,)` for a
  scalar attribute or `(N_k, C)` for a multi-channel attribute (`C`
  declared in `.zattrs`).
- **`.zattrs`**: `{"zv_array": "attribute", "name": "<name>",
  "dtype": "<dtype>", "row_shape": [] | [C]}`.  `row_shape` is the
  authority on column count — `[]` for a scalar attribute, `[C]` for a
  multi-channel one.  The optional `channel_names` / `channel_dtype`
  fields describe per-channel labels (gene names, etc.); they are
  labels, **not** a substitute for `row_shape`, so an unnamed
  multi-column attribute still reads back at its true width.
- **Selective access**: a reader fetches only the cells it needs, and
  enumerates occupied cells from `nonempty_chunks` in O(1).

## 7.3 Vertex Fragments

- **Name**: `vertex_fragments`
- **Path**: `<level>/vertex_fragments`, one cell per spatial chunk.
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

- **`.zattrs`**: `{"zv_array": "vertex_fragments", "encoding":
  "fragment_index_v1"}`.  All structural numbers (F, R, T) live in the
  blob header so the attributes stay minimal.
- **Empty chunk**: a 16-byte header-only blob with `F = 0`, `R = 0`,
  no bitmap, no range table, no CSR.
- **Random access**: `is_range(f)` is a single bit lookup; `range(f)`
  and `indices(f)` use a lazy prefix-popcount of the bitmap.
- **Compression**: none — the blob is written through the vlen-bytes
  serializer as-is.

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
  the intra-chunk link array) belongs to exactly one fragment.  Writers
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
  bin", byte-equivalent (modulo the bitmap and header) to a plain
  contiguous-row index.  The multi-owner machinery costs almost
  nothing when no one uses it.
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
   run-end, Parquet RLE, a plain `(offset, count)` table).
   Keeping that representation first-class makes the format legible
   at a glance and keeps the level-0 per-chunk hot path as cheap as a
   contiguous-row index would be.

Conversely, forcing *every* fragment into a range would forbid the
shared-metavertex case that explicit fragments exist to serve.  Hence
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
- **Path**: `<level>/groups` — a single 1-D vlen-bytes array of shape
  `(G,)`.  Row `gid` is that group's `int64` member-id list.
- **`.zattrs`**: `{"zv_array": "groups", "num_groups": G}`, plus an
  optional `group_ranges` map.
- **Contiguous groups**: a group whose members are exactly
  `range(start, stop)` may be stored as an O(1) descriptor —
  `group_ranges: {"<gid>": [start, stop]}` — with an empty placeholder
  row in the array.  A reader MUST consult `group_ranges` before
  concluding that an empty row means an empty group.
- **Companion**: `group_attributes/<name>` is a dense array of shape
  `(G,)` or `(G, C)` with `.zattrs` `{"zv_array": "groupings_attribute",
  "name": "<name>", "dtype": "<dtype>", "shape": [...]}`.  The
  discriminator literal is spelled `groupings_attribute`, not
  `group_attributes`; that spelling is normative.

Groups have no spatial extent — they describe arbitrary partitions of
the object set (cell types, brain regions, fascicle bundles, …).
Group hierarchy is encoded via group-level attributes (`super_type`,
parent id, …); the format does not impose a tree.

## 7.5 Vertex Links

- **Name**: `links`
- **Path**: `<level>/links/<delta>/<offsets>`, one cell per spatial
  chunk.  `links/<delta>` is a **group**, not an array; its children
  are one array per distinct relative-offset segment.
  [§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)
  is the normative reference for the path grammar and cell placement;
  this section covers the record.
- **`<delta>` axis**: the *pyramid-level delta* between the source
  endpoint and the others.  `delta = 0` is mandatory whenever the
  geometry has explicit links; `delta ≠ 0` is optional and only
  emitted when `cross_level_storage != "none"` (see
  [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
- **`<offsets>` axis**: where the other endpoints sit relative to the
  source chunk.  All-zero offsets are the intra-chunk case; `self` is
  the segment when `link_width == 1`.

### The record

- **Payload**: rows of `link_width` integer vertex-row indices, one
  per endpoint, optionally preceded by a permutation index in column 0
  (see `has_perm` in
  [§10.6.5](10-cross-chunk-linking.md#1065-whether-a-permutation-index-is-present)).
  Every index is **chunk-local**: `vi_k` references a row of the
  `vertices` cell at chunk `src + o_k`, where `src` is the cell holding
  the record and `o_0 = 0` by definition.  No record stores a global
  vertex ID or names a chunk.
- **dtype**: because the index space is bounded by
  `n_vertices_in_chunk`, a writer SHOULD pick the narrowest integer
  dtype that covers the expected per-chunk vertex count: `uint8` for
  chunks with ≤ 256 vertices, `uint16` for ≤ 64 K, `uint32` for ≤ 4 G,
  `int64` as the universally-safe fallback.  Narrower dtypes are a
  4–8× storage saving on typical data and the reader honours whatever
  is declared in `.zattrs.dtype`.
- **`link_width`**:
  - `1` — single parent reference (skeleton parents, pyramid
    metanode drill-down).
  - `2` — generic edge (graph, polyline-with-branches).
  - `3` — mesh face (triangle).

  `link_width` is a property of the whole `<delta>` family, declared on
  the family group, not of an individual offsets array.

### Cell framing and the fragment sidecar

- The array at `delta == 0` whose offsets are **all zero** stores flat
  concatenated rows and carries a companion `link_fragments` cell —
  fragment index in the same v1 byte layout as
  [§7.3](#73-vertex-fragments) — giving the per-fragment partition of
  link rows.  Each link fragment is the set of link rows belonging to
  one vertex fragment.
- **Every other array** — any non-zero offset, any `delta ≠ 0` — uses
  an inline self-describing ragged blob and has **no** sidecar.
- `link_fragments` is keyed by chunk **alone**: it carries no delta and
  no offsets segment, so exactly one array in the store may write it.
  A second writer would silently clobber the first.

### `.zattrs`

Family group `links/<delta>`:
`{"zv_array": "links_family", "level_delta": <delta>, "link_width": L,
"sid_ndim": ndim, "directed": bool, "store": "canonical" | "duplicate",
"num_links": M, "num_physical_records": P}` — the two counts are absent
until the family is finalized.

Offsets array `links/<delta>/<offsets>`:
`{"zv_array": "links", "dtype": "<integer dtype>", "offsets": [[...]],
"has_perm": bool, "link_width": L, "level_delta": <delta>}`.

### Implicit-sequential convention

When the geometry is purely sequential — streamlines, polylines, or
skeletons that are mostly sequential with a few branches — the root
metadata's `links_convention` lets writers skip materializing the
intra-level link records:

- `"implicit_sequential"` — within each fragment, vertex `i` connects
  to vertex `i+1`.  The `links/0/` group is omitted entirely.
- `"implicit_sequential_with_branches"` — sequential parents are
  implicit; the intra-chunk array `links/0/<all-zero offsets>` stores
  only the *non-sequential* (branch) rows.
- `"explicit"` — every link is materialized.

The convention governs only the **intra-chunk** array.  Links that
cross a chunk boundary (a non-zero offsets segment) and cross-level
links (`delta ≠ 0`) are always explicit — a sequential run that leaves
a chunk cannot be implied by row adjacency, because the next vertex is
row-numbered in a different chunk.

## 7.6 Object Index

- **Name**: `object_index`
- **Path**: `<level>/object_index/manifests` — a 1-D vlen-bytes array
  of shape `(B,)`.  Row `object_id` holds that object's manifest blob;
  the array is addressed positionally, so a single-object read fetches
  one Zarr chunk.  `object_index/` itself is a group carrying the index
  metadata.
- **Chunking**: manifests are chunked in buckets of at most 16 384
  objects, which sets the read-amplification ceiling for a single-OID
  fetch.  The bucket is fixed when the array is **created** — a resize
  cannot change a Zarr chunk shape — so a writer that sizes it from
  however many objects the *first* flush happens to carry fixes that
  size for the life of the store.  In a chunk-by-chunk build the first
  flush is often a sparse edge chunk holding a few dozen objects, and
  the resulting file count can exceed the intended one by orders of
  magnitude; size the bucket from the expected object count, not from
  the first write.
- **Payload**: one manifest blob per object.  Each manifest is a
  sequence of *manifest blocks*; each block names one spatial chunk
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

- **`.zattrs`** (on the `object_index` group): `{"zv_array":
  "object_index", "num_objects": B, "num_present": P, "sid_ndim":
  ndim, "layout": "vlen_manifests_v1"}`.  `num_objects` is the slot
  count; `num_present` is how many slots hold a non-empty manifest.  A
  reader MUST reject any other `layout` value rather than guess.
- **Empty manifest**: `B_obj = 0`, exactly four bytes — an object that
  exists in the OID space but carries no fragments at this level (used
  by ID-preserving pyramids that drop objects without renumbering).
  Object presence is therefore a property of the manifest, not of the
  OID range: `0 <= id < num_objects` does **not** imply the object is
  present at this level.

### Identity convention

When the store has exactly one spatial chunk, the root metadata may
set `object_index_convention = "identity"`.  In this mode the
`object_index/` array is omitted entirely; `object_id ==
fragment_index` for the single chunk.  Multi-chunk stores must use
the explicit standard convention (`object_index_convention =
"standard"`, the default).

## 7.7 Link Attributes

- **Name**: `link_attributes`
- **Path**: `<level>/link_attributes/<name>/<delta>/<offsets>`, one
  cell per spatial chunk.  `link_attributes/<name>/<delta>` is a
  **group** mirroring `links/<delta>`.
- **Payload**: a flat dense blob, row-aligned to the link cell at the
  same coordinate in the array with the same offsets segment.  One row
  per link record, in the same order.  Shape `(M_k,)` or `(M_k, C)`.
  There is no encoding branch — the record boundaries come from the
  link array, so an attribute cell never needs its own framing.
- **`.zattrs`**: family group `{"zv_array": "link_attribute_family",
  "name": "<name>", "level_delta": <delta>}`; array `{"zv_array":
  "link_attribute", "name": "<name>", "dtype": "<dtype>", "row_shape":
  [] | [C], "offsets": [[...]], "level_delta": <delta>}`.
- **Parity invariant**: for every populated attribute cell, its row
  count equals the record count of the parallel link cell.  A
  desynchronized write fails loudly at read time.
- **Optional**: emitted only when the writer chose to carry per-link
  attributes; absent by default.

## 7.8 Object Attributes

- **Name**: `object_attributes`
- **Path**: `<level>/object_attributes/<name>` — a single dense array
  per attribute.
- **Payload**: dense per-object rows in object_id order, shape
  `(B,)` or `(B, C)`.  No fragment-indexing — the array is keyed by
  the same OID space as `object_index/`.  Rows are chunked at 65 536.
- **Absence is in-band**: an object with no value for this attribute
  reads back as the array's `fill_value` — NaN for floats, the dtype
  minimum for signed integers, the dtype maximum for unsigned, the
  empty string for text.
- **`.zattrs`**: `{"zv_array": "object_attribute", "name": "<name>",
  "dtype": "<dtype>", "shape": [...], "fill_sentinel_meaning":
  "absent"}`, plus optional `channel_names`.

## 7.9 Fragment Attributes

- **Name**: `fragment_attributes`
- **Path**: `<level>/fragment_attributes/<name>`, one cell per spatial
  chunk.
- **Payload**: raw little-endian rows, row-aligned to the fragments of
  the `vertex_fragments` cell at the same coordinate.  Shape per chunk
  is `(F_k,)` for a scalar attribute or `(F_k, C)` for a multi-channel
  attribute (`C` declared in `.zattrs`), where `F_k` is the chunk's
  `num_fragments`.
- **Row count is self-describing**: `F_k` is derived from the cell's
  own byte length, `len(cell) / (itemsize * ncols)` — a reader does
  **not** need to decode [§7.3](#73-vertex-fragments) to size this
  array.  A byte length that is not an exact multiple of the row
  stride is an error, not a truncation.
- **`.zattrs`**: `{"zv_array": "fragment_attribute", "name": "<name>",
  "dtype": "<dtype>", "row_shape": [] | [C]}`.  The optional
  `channel_names` / `channel_dtype` fields describe per-channel labels
  for multi-channel attributes.
- **Optional**: emitted only when the writer chose to carry per-fragment
  attributes; absent by default.  A common use is materializing parent
  IDs — an `object_id` fragment attribute carrying the OID that owns
  each fragment.
- **Selective access**: a reader fetches only the cells it needs, and
  enumerates occupied cells from `nonempty_chunks` in O(1).
