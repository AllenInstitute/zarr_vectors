# 4. Data Model

## 4.1 Hierarchical Organization

A ZV store is a Zarr v3 group tree.  Resolution levels are bare-integer
sub-groups (`0/`, `1/`, …); level `0` is full resolution.  Within each
level, every per-spatial-chunk array is a single Zarr array over the
level's chunk grid, one cell per chunk; the fragment-index,
object-index, and link payloads are project-internal byte layouts
inside those cells.

Below, `<i.j.k>` names the *cell* for one spatial chunk (its file is at
`<array>/c/<i>/<j>/<k>`):

```
Zarr Store Root
├── zarr.json                          # NGFF multiscales + zarr_vectors metadata
├── 0/                                 # full resolution
│   ├── zarr.json                      # level metadata (zarr_vectors_level)
│   ├── vertices/<i.j.k>               # raw positions, one cell per spatial chunk
│   ├── vertex_fragments/<i.j.k>       # fragment index over the vertices cell
│   ├── links/0/0.0.0/<i.j.k>          # intra-chunk link rows (delta=0)
│   ├── links/0/0.0.+1/<i.j.k>         # links reaching the +z neighbour
│   ├── link_fragments/<i.j.k>         # fragment index over links/0/0.0.0 only
│   ├── vertex_attributes/<name>/<i.j.k>
│   ├── fragment_attributes/<name>/<i.j.k>          # optional, parallels vertex_fragments
│   ├── link_attributes/<name>/0/0.0.0/<i.j.k>      # optional, mirrors links
│   ├── object_index/manifests         # one manifest blob per object (B objects)
│   ├── object_attributes/<name>       # dense (B,) or (B, C)
│   ├── groups                         # ragged: G groups → object id lists
│   └── group_attributes/<name>        # dense (G,) or (G, C)
├── 1/                                 # coarser level (optional)
│   ├── zarr.json                      # may override chunk_shape
│   ├── vertices/<i.j.k> …
│   ├── links/0/<offsets>/<i.j.k>      # intra-level edges at this level
│   ├── links/+1/<offsets>/<i.j.k>     # optional: fine→coarse pyramid edges
│   │                                   #   (only when cross_level_storage != "none")
│   └── …
└── N/
```

`links/<delta>` and `link_attributes/<name>/<delta>` are **groups**;
their children are one array per distinct relative-offset segment.  A
link that crosses a chunk boundary is a record whose offsets are
non-zero; an intra-chunk link is one whose offsets are all zero.


Each level carries:

- **Required** at level 0: at least `vertices/`.  Other arrays are
  optional per geometry type (see [§12](12-geometry-types.md)) and per writer choice.
- **Optional, schema-defined**: `vertex_fragments`, `link_fragments`,
  `links/`, `vertex_attributes/`, `fragment_attributes/`,
  `link_attributes/`, `object_index/`, `object_attributes/`, `groups`,
  `group_attributes/`.
- **Per-level overrides**: each level may set its own `bin_shape`
  (coarser bins for pyramid levels), `chunk_shape` (coarser
  levels may use larger chunks), and a `parent_level` pointer.

## 4.2 Spatial Index Model

The spatial index is an N-dimensional regular grid.  Its parameters
live in `RootMetadata`:

- **Axes** (`multiscales[0].axes`, NGFF / OME-Zarr RFC 4): a list of
  axis descriptors (`name`, `type` ∈ {`"space"`, `"time"`, `"channel"`,
  custom}, optional UDUNITS-2 `unit`).  NGFF prescribes axis order
  `time → channel → custom → space`.  Number of space axes is
  `sid_ndim`, the number of *spatial index* dimensions.
- **Chunk grid**: a level-0 default `chunk_shape` (positive float per
  axis).  Pyramid levels may override `chunk_shape` provided
  the override is a positive integer multiple of the root along every
  axis — the level-0 chunk grid is the finest, and every coarser
  level nests cleanly within it.  Cross-level chunk-coord translation
  is integer division by the per-axis multiplier.
- **Bin grid** (optional): a `base_bin_shape` finer than `chunk_shape`
  partitioning each chunk into a regular grid of bins.  When unset,
  one bin per chunk.  `chunk_shape / bin_shape` must be a non-negative
  integer per axis.
- **Bounds**: `(min_corner, max_corner)` — the global extent
  containing all data.  Bounds are root-only; there are no per-level
  bounds.
- **CRS**: optional dict following OME-Zarr RFC 4 / 5 conventions.

## 4.3 Vertex Model

Each chunk's `vertices/<i.j.k>` is a flat byte blob holding one row
per vertex in chunk-local order.  The on-disk dtype and encoding
(`raw` or `draco`) come from per-array `.zattrs`.

A chunk's vertices are partitioned into **fragments** by the
sibling `vertex_fragments/<i.j.k>` index.  Each fragment is one of:

- a contiguous **range** `[start, start+count)` of row indices into
  `vertices/<i.j.k>`, or
- an explicit **list** of row indices, allowing two fragments to
  re-use the same underlying vertex rows.

The fragment index is a single byte blob; its layout (header + range
bitmap + range table + CSR explicit list) is documented in [§7.3](07-core-arrays.md#73-vertex-fragments).

A *fragment* is the unit of:

- pyramid coarsening (each fragment maps to a parent metavertex via
  `links/+1/`),
- object membership (manifest blocks reference fragments by chunk-local
  index),
- and (when shared) re-use across multiple objects.

Per-vertex attributes (`vertex_attributes/<name>/<i.j.k>`) are
parallel byte blobs row-aligned to `vertices/<i.j.k>`.


## 4.4 Object Model

An object is a logical entity (a mesh, a streamline, a cell, a neuron
skeleton, …) whose vertices may live in many fragments across many
chunks.

The `object_index/manifests` array holds one manifest blob per object,
at row `object_id`.  Each manifest is a list of *manifest blocks* tagged
with the chunk those fragments live in.  Each block carries the chunk
coordinates plus a fragment reference in one of three modes:

| Mode | Tag | Payload | Use when |
|------|-----|---------|----------|
| 0 (single) | `uint8 0` | `int64 fragment_index` | exactly one fragment in this chunk |
| 1 (range) | `uint8 1` | `int64 start, int64 count` | a contiguous run of fragments |
| 2 (explicit) | `uint8 2` | `uint32 count`, `int64 fragment_indices[count]` | arbitrary non-contiguous fragments |

All fragment references are **chunk-local** — they index into
`vertex_fragments/<chunk_coords>` only, never across chunks.  Writers
can author chunks independently without coordinating fragment
numbering with any other chunk.

Fragments may be referenced by more than one object.  When this is in
use, the store advertises the `shared_fragments` capability token (see
[§8.2](08-metadata.md#82-root-level-metadata)).

An empty manifest serializes as `B = 0` and represents an object that
was dropped at this level (ID-preserving pyramids leave a hole rather
than re-numbering).

### Cross-chunk objects

When an object spans chunks, its manifest carries one block per chunk.
Object reconstruction reads each block's `vertex_fragments/<chunk>`
entries to discover which rows of `vertices/<chunk>` belong to the
object, then optionally reads the non-zero-offset arrays under
`links/0/` at those chunks to recover edges crossing the chunk boundary
(see [§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)).

### Identity convention

When the store has exactly one spatial chunk, `object_index_convention =
"identity"` lets the writer omit `object_index/` entirely; `object_id ==
fragment_index`.  Multi-chunk stores must use the explicit standard
convention.

## 4.5 Group Model

A *group* is a named collection of objects.  Groups live in the ragged
`groups` array (row `gid` is that group's list of object IDs) with
optional per-group attributes in the dense `group_attributes/<name>`
array (shape `(G,)` or `(G, C)`).

Groups have no spatial extent — they describe arbitrary partitions of
the object set (cell types, brain regions, fascicle bundles, tract
names, …).  Group hierarchy is encoded via group-level attributes
(`super_type`, parent group id, …); the format does not impose a
tree.

## 4.6 Link Model

Links connect vertices.  Each level has zero or more `links/<delta>/`
**groups**, where `<delta>` is the *pyramid-level delta* between the
source endpoint and the others.  Each such group holds one array per
distinct `<offsets>` segment — where the other endpoints sit relative
to the record's source chunk.  Whether a record stays inside a chunk
or crosses a seam is expressed by that segment.

- `delta = 0` — same-level edges.  The all-zero offsets array
  (`links/0/0.0.0` in a 3-D store) holds intra-chunk records as a flat
  byte payload row-aligned to `link_fragments`, which carries the
  per-fragment partition in the same fragment-index format as
  `vertex_fragments`.  Every non-zero offsets array holds records that
  cross a boundary, using an inline self-describing blob and no
  sidecar ([§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)).
- `delta ≠ 0` — cross-pyramid-level edges (optional, see [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
  Every array under a non-zero delta uses the inline encoding and has
  no `link_fragments` companion, whatever its offsets.

Each link record holds `link_width` endpoints; `link_width = 2`
encodes a generic edge, `link_width = 3` encodes a mesh face,
`link_width = 1` encodes a single parent reference (used by metanode
drill-down).  The `link_width` is carried on the `links/<delta>/`
family group's `.zattrs`, and is uniform across every offsets array
beneath it.

Endpoint convention: endpoint 0 is the **source**, living at the
*owning* level L in the chunk whose cell holds the record; endpoints
`k > 0` live at `L + delta`, in chunk `source + o_k`.  Only the
chunk-local vertex index is stored — no record names a chunk, and no
record stores a global vertex ID.

When the geometry is purely sequential (streamlines, polylines), the
`links_convention` field on the root metadata lets writers skip
materializing `links/` entirely.  The `implicit_sequential` and
`implicit_sequential_with_branches` conventions are documented in
[§7.5](07-core-arrays.md#75-vertex-links) and [§12.3](12-geometry-types.md#123-skeletons)–[§12.4](12-geometry-types.md#124-streamlines--polylines).

Per-link attributes are optional companion arrays:

- `link_attributes/<name>/<delta>/<offsets>/<i.j.k>` — one row per
  link record in the parallel `links/<delta>/<offsets>` cell, in the
  same order.  The attribute family mirrors the link family exactly:
  same offsets segments, same cells, same row order.

The `link_fragments` companion exists only for the all-zero offsets
array at `delta = 0`; everywhere else the inline blob already
partitions the records.  Because it is keyed by chunk alone, exactly
one array in the store may write it.
