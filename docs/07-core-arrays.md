# 7. Core Arrays

This chapter is the array-by-array reference.  Two physical shapes
cover every array in a store:

- **Per-chunk arrays** (`vertices`, `vertex_fragments`,
  `link_fragments`, `links/<delta>/<offsets>`,
  `vertex_attributes/<name>`, `fragment_attributes/<name>`,
  `link_attributes/<name>/<delta>/<offsets>`) are each one Zarr v3
  `variable_length_bytes` array over the level's chunk grid.  One cell
  holds one spatial chunk's payload; the element dtype and record
  framing are declared in the array's metadata and are opaque to Zarr.
  [§5.2](05-zarr-store-structure.md#52-zarr-version-requirements) gives
  the cell model.
- **Non-spatial arrays** (the `object_index/` arrays, `groups`,
  `object_attributes/<name>`, `group_attributes/<name>`) are single
  Zarr arrays at their logical path, ragged or dense as noted.

`<i.j.k>` names a spatial chunk; it is a *cell* of the array, stored
at `<array>/c/<i>/<j>/<k>`.

## Array metadata

Each array's Zarr Vectors properties live in one attribute of its
`zarr.json`, the `zarr_vectors` object.  Its `kind` names the array's
role; its other fields describe the array.  The node also registers the
convention with the short form of its `zarr_conventions` entry.  The
`zarr.json` of `vertices/` in an unsharded 3-D store with a 3 × 3 × 3
grid:

```javascript
{
  "shape": [3, 3, 3],
  "data_type": "variable_length_bytes",
  "chunk_grid": {"name": "regular", "configuration": {"chunk_shape": [1, 1, 1]}},
  "chunk_key_encoding": {"name": "default", "configuration": {"separator": "/"}},
  "fill_value": "",
  "codecs": [{"name": "vlen-bytes", "configuration": {}}],
  "attributes": {
    "zarr_conventions": [{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}],
    "zarr_vectors": {
      "kind": "vertices",
      "nonempty_chunks": ["0.0.1", "0.1.1", "1.0.0", ...],
      "dtype": "float32",
      "encoding": "raw"
    }
  },
  ...
}
```

The array kinds:

| `kind` | Array or group | Section |
|--------|----------------|---------|
| `vertices` | `vertices/` | [§7.1](#71-vertex-positions) |
| `vertex_attribute` | `vertex_attributes/<name>/` | [§7.2](#72-vertex-attributes) |
| `vertex_fragments` | `vertex_fragments/` | [§7.3](#73-vertex-fragments) |
| `groups` | `groups` | [§7.4](#74-groups) |
| `group_attribute` | `group_attributes/<name>` | [§7.4](#74-groups) |
| `links_family` | `links/<delta>/` (group) | [§7.5](#75-vertex-links) |
| `links` | `links/<delta>/<offsets>/` | [§7.5](#75-vertex-links) |
| `link_fragments` | `link_fragments/` | [§7.5](#75-vertex-links) |
| `object_index` | `object_index/` (group) | [§7.6](#76-object-index) |
| `link_attribute_family` | `link_attributes/<name>/<delta>/` (group) | [§7.7](#77-link-attributes) |
| `link_attribute` | `link_attributes/<name>/<delta>/<offsets>/` | [§7.7](#77-link-attributes) |
| `object_attribute` | `object_attributes/<name>` | [§7.8](#78-object-attributes) |
| `fragment_attribute` | `fragment_attributes/<name>/` | [§7.9](#79-fragment-attributes) |

The other kinds are `root`, `level` and `parametric`
([§8](08-metadata.md)).  These spellings are normative on disk; an
implementation MAY use other in-memory tags.  Groups that only hold
arrays (`vertex_attributes/`, `links/`, …) have no `zarr_vectors`
object, except the link family groups and `object_index/`.  The
metadata does not duplicate fields the payload already carries (e.g.
`vertex_fragments` does not store `num_fragments`).

## Per-chunk array keys

Every per-chunk array's `zarr_vectors` object also carries:

- `chunk_grid_origin` — the absolute chunk coordinate of cell 0,
  present only when non-zero
  ([§6.2](06-spatial-indexing.md#62-spatial-chunk-addressing)).
- `nonempty_chunks` — the dotted absolute keys of the cells that hold
  data, so a reader enumerates occupied cells without listing the
  store or reading a shard index.

`nonempty_chunks` MAY be absent only while the level's `presence` is
`"deferred"` ([§8.3](08-metadata.md#83-resolution-level-metadata)), a
build-time state that ends when every array's `nonempty_chunks` is
written and `presence` removed.  While presence is deferred a reader
MUST take presence from the store (by listing or reading cells) and
MUST NOT treat an array without `nonempty_chunks` as empty.

Below, "metadata" means the array's `zarr_vectors` object.

## 7.1 Vertex Positions

- **Path**: `<level>/vertices`, one cell per occupied chunk.
- **Payload**: `N_k` rows of `sid_ndim` little-endian values of the
  metadata's `dtype`, back to back.  Any numeric dtype is allowed —
  floats for continuous units, integers of any width for voxel-indexed
  or quantized positions — provided it is comparable with the root
  `bounds`; readers coerce at compare time.
- **Row count**: `N_k = len(cell) // (itemsize * sid_ndim)`; not
  stored.
- **Encoding**: `raw` (default) or `draco` (meshes only; positions and
  faces in one Draco blob, [§11.2](11-compression-and-encoding.md#112-draco-encoding)).
- **Metadata**: `{"kind": "vertices", "dtype": "<dtype>", "encoding":
  "raw" | "draco"}` plus the per-chunk keys.  The element dtype MUST
  be read from `dtype`; the Zarr `data_type` is `variable_length_bytes`
  for every cell.
- **Spatial locality**: rows lie within the chunk's bounds, modulo the
  boundary policy ([§6.4](06-spatial-indexing.md#64-boundary-conditions),
  [§10](10-cross-chunk-linking.md)).

## 7.2 Vertex Attributes

- **Path**: `<level>/vertex_attributes/<name>`, one cell per chunk.
- **Payload**: one row per row of the `vertices` cell at the same
  coordinate, in the same order; shape `(N_k,)` or `(N_k, C)`.
- **Metadata**: `{"kind": "vertex_attribute", "name": "<name>",
  "dtype": "<dtype>", "row_shape": [] | [C]}`, optionally
  `channel_names` / `channel_dtype`.  `row_shape` is the authority on
  column count; `channel_names` are labels only.  Without `row_shape`
  an array has `len(channel_names)` columns, or one.
- **Categorical attributes** store integer codes and add `"encoding":
  "dictionary"`, `categories` (values indexed by code), `ordered` and
  optionally `_FillValue` (the code read as missing).  Readers return
  `categories[code]`.

## 7.3 Vertex Fragments

- **Path**: `<level>/vertex_fragments`, one cell per chunk.
- **Payload**: one blob in the v1 fragment-index layout, all integers
  little-endian:

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

  Each fragment is either a **range** `[start, start+count)` of rows of
  the `vertices` cell or an explicit **list** of rows.  Explicit
  fragments may share rows, so one vertex can belong to several
  fragments.  Range fragment `f` is range-table row `popcount(bitmap
  bits before f)`.
- **Empty chunk**: the 16-byte header alone, `F = 0`, `R = 0`.
- **Metadata**: `{"kind": "vertex_fragments", "encoding":
  "fragment_index_v1"}`.
- **Magic**: `'ZVFG'` is a frozen on-disk constant, not a name for the
  format; likewise the `zv_` prefix of `zv_version`.
- **Compression**: none by default
  ([§11.4](11-compression-and-encoding.md#114-compression-strategy)).
- **Tiling claim**: a level that sets `fragments_tile: true` guarantees
  that in every chunk the vertex fragments are ranges covering the
  `vertices` rows in order, with no gaps or overlaps; a reader MAY then
  read a cell without its fragment index.  Absent means unknown, not
  false.  A writer that modifies a chunk without re-establishing the
  property MUST remove the claim.

### 7.3.1 Design rationale

The layout serves both single-owner fragments (each row in one
fragment, stored as a contiguous run) and multi-owner fragments (a row
shared by several fragments, e.g. a coarse metavertex on the path of
several objects).  Range fragments cost 16 bytes whatever their length
and decode as a slice; explicit fragments cost `4 + 8 × count` bytes
and a gather, and are used only where sharing is needed.  The bitmap
classifies any fragment in O(1) for `ceil(F/8)` bytes — an eighth of a
per-fragment tag byte, and without the binary search a sorted list of
explicit ids would need.  At level 0, where every fragment is a range,
the index reduces to a plain `(start, count)` table.

## 7.4 Groups

- **Path**: `<level>/groups`, a 1-D vlen-bytes array of shape `(G,)`;
  row `gid` is the group's `int64` member-id list.
- **Metadata**: `{"kind": "groups", "num_groups": G}`, optionally
  `group_ranges`.
- **Contiguous groups**: a group whose members are exactly
  `range(start, stop)` MAY be stored as `group_ranges: {"<gid>":
  [start, stop]}` with an empty placeholder row.  A reader MUST
  consult `group_ranges` before concluding that an empty row is an
  empty group.
- **Group attributes**: `group_attributes/<name>`, dense, shape `(G,)`
  or `(G, C)`, metadata `{"kind": "group_attribute", "name": "<name>",
  "dtype": "<dtype>", "shape": [...]}`.

Groups are arbitrary partitions of the object set with no spatial
extent.  Hierarchy, if any, is expressed through group attributes; the
format imposes no tree.

## 7.5 Vertex Links

- **Path**: `<level>/links/<delta>/<offsets>`, one cell per chunk.
  `links/<delta>` is a group with one array per offsets segment.
  [§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)
  is normative for the path grammar and cell placement.
- **`<delta>`**: the pyramid-level delta.  `delta = 0` is required
  whenever the geometry has explicit links; `delta ≠ 0` is optional
  ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
- **`<offsets>`**: where the other endpoints sit relative to the source
  chunk; all zeros for intra-chunk links, `self` when `link_width == 1`.

### The record

- **Payload**: rows of `link_width` vertex-row indices, optionally
  preceded by a permutation index in column 0 (`has_perm`,
  [§10.6.5](10-cross-chunk-linking.md#1065-whether-a-permutation-index-is-present)).
  Every index is chunk-local: `vi_k` is a row of the `vertices` cell at
  chunk `src + o_k`, where `src` is the cell holding the record and
  `o_0 = 0`.  No record stores a global vertex id or names a chunk.
- **dtype**: `int64` (what the reference implementation writes).  A
  writer MAY use a narrower integer dtype that covers the per-chunk
  vertex count; a reader MUST honour the declared `dtype`.
- **`link_width`**: `1` single parent reference, `2` edge, `3`
  triangle.  It is a property of the whole `<delta>` family.

### Cell framing and the fragment sidecar

| Array | Payload | Sidecar |
|-------|---------|---------|
| `delta == 0`, offsets all zero | flat rows | `link_fragments` cell, v1 fragment index ([§7.3](#73-vertex-fragments)) |
| any other | inline ragged blob | none |

`link_fragments` is keyed by chunk alone, so exactly one array may
write it.  Link fragments need not correspond to vertex fragments,
unless the level sets `link_fragments_aligned: true`: then link
fragment `k` of every intra-chunk cell holds exactly the records whose
first endpoint is in vertex fragment `k`, and a reader MAY read the
links of chosen vertex fragments by reading only those link fragments.
As with `fragments_tile`, absent means unknown, and a writer that
breaks the property MUST remove the claim.

### Metadata

| Node | `zarr_vectors` |
|------|----------------|
| `links/<delta>` (group) | `{"kind": "links_family", "level_delta", "link_width", "sid_ndim", "directed", "store", "num_links", "num_physical_records"}`; `store` is `"canonical"` or `"duplicate"`; the counts are absent until the family is finalized |
| `links/<delta>/<offsets>` | `{"kind": "links", "dtype", "offsets": [[...]], "has_perm", "link_width", "level_delta"}` |
| `link_fragments` | `{"kind": "link_fragments", "encoding": "fragment_index_v1"}` |

### Implicit-sequential convention

The root `links_convention` lets writers of sequential geometry skip
intra-chunk records:

| Value | Intra-chunk array `links/0/<all-zero offsets>` |
|-------|-----------------------------------------------|
| `"implicit_sequential"` | omitted; within each fragment vertex `i` links to `i+1` |
| `"implicit_sequential_with_branches"` | holds only the non-sequential (branch) rows |
| `"explicit"` | holds every link |

Cross-chunk (non-zero offsets) and cross-level (`delta ≠ 0`) links are
always explicit.

## 7.6 Object Index

`<level>/object_index/` is a group holding the index metadata and the
arrays of one of the layouts below.  It maps an object id to its
**manifest**: the ordered `(chunk_coords, fragment_index)` references
that make up the object at this level.  Reading the fragments in order
gives the object's vertices in order.  References are chunk-local (they
index `vertex_fragments/<chunk_coords>`), so chunks can be written
independently.  At a level with `shared_fragments: true`, several
manifests may name one fragment.

### 7.6.1 Layouts

| `layout` | Arrays under `object_index/` | Row `k` holds |
|----------|------------------------------|---------------|
| `vlen_manifests_v1` | `manifests` | object id `k` |
| `vlen_manifests_v2` | `manifests`, `object_ids` | object id `object_ids[k]` |
| `dense_manifests_v1` | `manifest_spans`, `manifest_blocks`, `object_ids` | object id `object_ids[k]` |

A reader MUST reject an index whose `layout` is missing or unknown,
rather than guess.

### 7.6.2 Metadata

A `vlen_manifests_v2` index for ids 5, 9 and 12, where 12 has an empty
manifest:

```json
{
  "zarr_conventions": [{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}],
  "zarr_vectors": {
    "kind": "object_index",
    "num_objects": 3,
    "num_present": 2,
    "sid_ndim": 3,
    "layout": "vlen_manifests_v2",
    "object_ids_sorted": true
  }
}
```

| Key | Meaning |
|-----|---------|
| `kind` | `"object_index"` |
| `layout` | A layout from [§7.6.1](#761-layouts); required |
| `sid_ndim` | Coordinates per manifest block (one more on a level with a leading chunk axis, [§6.7](06-spatial-indexing.md#67-leading-non-spatial-chunk-axes)) |
| `num_objects` | Number of object rows |
| `num_present` | Rows with a non-empty manifest |
| `object_ids_sorted` | Layouts with `object_ids` only: `true` when `object_ids` is strictly ascending |
| `block_dtype` | Dense layout only, and only when `"int32"` |

The arrays under `object_index/` carry no `zarr_vectors` object.

### 7.6.3 Object ids and presence

Under `vlen_manifests_v1` an id is its row index.  Under the other
layouts `object_ids` (`int64`, shape `(num_objects,)`) gives row `k`'s
id; ids MUST be non-negative and unique and need not be contiguous.
Object attributes ([§7.8](#78-object-attributes)) align to rows, not
ids.

An empty manifest means the object is absent from the level; a
sparsified pyramid level keeps a row for every id of its source level
and empties the rows it drops.  So a row's existence does not imply
the object is present.  Looking up an id with no row is an error.
Object ids are stable for the life of a store.

### 7.6.4 Vlen layouts

`manifests` is a 1-D `variable_length_bytes` array, shape
`(num_objects,)`; cell `k` is row `k`'s manifest.  An unwritten row
reads as empty.  Little-endian:

```text
Per-object manifest
  uint32 num_blocks B_obj

Per block (one chunk's worth of references)
  int64 chunk_coords[sid_ndim]
  uint8 mode
    mode = 0  (single)       int64 fragment_index
    mode = 1  (range)        int64 start, int64 count       # fragments start … start+count-1
    mode = 2  (explicit)     uint32 count, int64 fragment_indices[count]
```

Every index is non-negative.  An empty manifest is four bytes
(`B_obj = 0`).

The row bucket (Zarr chunk) of `manifests` and `object_ids` — 16 384 in
the reference implementation — bounds the read amplification of a
single-object fetch.  It is fixed at array creation, so writers SHOULD
size it from the expected object count, not from the first flush.

### 7.6.5 Dense layout

`dense_manifests_v1` stores manifests as fixed-width integer rows, so
all manifests can be gathered with array operations:

| Array | Type | Contents |
|-------|------|----------|
| `manifest_spans` | `int64`, `(num_objects, 2)` | Row `k` is `(start, count)`: rows `start … start + count - 1` of `manifest_blocks` are row `k`'s manifest, in order |
| `manifest_blocks` | `int64` or `int32`, `(n_blocks, sid_ndim + 1)` | One row per fragment reference: chunk coordinates, then fragment index |
| `object_ids` | `int64`, `(num_objects,)` | As in `vlen_manifests_v2` |

An empty manifest has `count == 0`; its `start` is not read.  Block rows
need not be contiguous or in object order, so a patch MAY append blocks
and rewrite only the span.  For `int32` blocks the group's
`block_dtype` is informational and the array's `data_type`
authoritative; readers widen to `int64`.

### 7.6.6 Choosing a layout

The writer chooses the layout per index; a rewrite keeps the existing
layout.  Root keys ([§8.2](08-metadata.md#82-root-level-metadata)) set
the default for new indexes:

| Root key | Value | Effect |
|----------|-------|--------|
| `manifest_layout` | `"dense"` (absent: vlen) | New indexes are `dense_manifests_v1`, otherwise `vlen_manifests_v2` |
| `manifest_block_dtype` | `"int32"` (absent: `int64`) | New dense indexes use `int32` blocks |

A store that has or declares a dense index lists the `dense_manifests`
capability in `format_capabilities`.

### Identity convention

A store with exactly one spatial chunk MAY set
`object_index_convention = "identity"`: `object_index/` is omitted and
`object_id == fragment_index`.  Multi-chunk stores MUST use
`"standard"` (the default).

## 7.7 Link Attributes

- **Path**: `<level>/link_attributes/<name>/<delta>/<offsets>`, one
  cell per chunk; `link_attributes/<name>/<delta>` is a group mirroring
  `links/<delta>`.
- **Payload**: one row per record of the link cell at the same
  coordinate in the array with the same offsets, in the same order;
  shape `(M_k,)` or `(M_k, C)`.  No framing of its own.
- **Metadata**: family group `{"kind": "link_attribute_family",
  "name", "level_delta", "num_links"}`; array `{"kind":
  "link_attribute", "name", "dtype", "row_shape", "offsets",
  "level_delta"}`.
- **Parity**: every populated attribute cell's row count MUST equal the
  record count of the parallel link cell.
- Optional; absent by default.

## 7.8 Object Attributes

- **Path**: `<level>/object_attributes/<name>`, one dense array per
  attribute, shape `(B,)` or `(B, C)` with `B = num_objects`; rows
  chunked at 65 536.
- **Rows**: row `k` belongs to object row `k` of the level's object
  index ([§7.6](#76-object-index)): id `object_ids[k]`, or `k` under
  `vlen_manifests_v1`.
- **Absence**: a missing value reads as the array's `fill_value` — NaN
  for floats, the dtype minimum for signed integers, the maximum for
  unsigned, the empty string for text.
- **Metadata**: `{"kind": "object_attribute", "name", "dtype",
  "shape", "fill_sentinel_meaning": "absent"}`, optionally
  `channel_names`.

## 7.9 Fragment Attributes

- **Path**: `<level>/fragment_attributes/<name>`, one cell per chunk.
- **Payload**: one row per fragment of the `vertex_fragments` cell at
  the same coordinate; shape `(F_k,)` or `(F_k, C)`.  `F_k = len(cell)
  / (itemsize * ncols)`; a length that is not a whole number of rows is
  an error.
- **Metadata**: `{"kind": "fragment_attribute", "name", "dtype",
  "row_shape"}`, optionally `channel_names` / `channel_dtype`.
- Optional; absent by default.  A common one is `object_id` (`int64`):
  the id of the object whose manifest names each fragment, `-1` when
  none does and `-2` when several do.  It is derived from the
  manifests and not updated when they change.
