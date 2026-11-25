# 6. Spatial Indexing

## 6.1 Spatial Index Definition

A store's spatial index is a regular N-dimensional grid pinned to the
level-0 chunk shape.  It is defined by root `zarr_vectors` keys:

| Key | Meaning |
|-----|---------|
| `axes` | One `{"name", "type", "unit"?}` per axis, in NGFF order `time → channel → custom → space`.  The number of axes is `sid_ndim`; at least two MUST be `"space"`; units are UDUNITS-2 |
| `bounds` | `[min_corner, max_corner]` covering all data.  Root-only; there are no per-level bounds |
| `chunk_shape` | Level-0 chunk extent, one positive float per axis (`sid_ndim` entries), in coordinate units.  The finest chunk grid; every coarser level nests into it |
| `base_bin_shape` | Optional level-0 bin grid.  It MUST divide `chunk_shape` on every axis; absent means one bin per chunk |
| `coordinate_offset` | Optional world position of the stored origin: `world = stored + coordinate_offset` (absent: zeros).  The index is always computed on stored positions |

The coordinate reference system, if any, is the root attribute
`proj:projjson` ([§8.8](08-metadata.md#88-coordinate-reference-system-crs)).

A level may override `chunk_shape` and bins
([§6.6](#66-per-level-chunk-shape)), replace the uniform grid with
octree leaves ([§6.5](#65-octree-chunks)), or add a leading non-spatial
chunk axis ([§6.7](#67-leading-non-spatial-chunk-axes)).

## 6.2 Spatial Chunk Addressing

A chunk coordinate is an integer tuple, one entry per axis,
written dot-separated: `3.7`, `2.1.0`, `<c_0.c_1.…c_{ndim-1}>`.

```text
chunk_coord_i = floor(position_i / chunk_shape_i)
```

Writers compute this in `float64`, so a vertex on a boundary belongs to
the upper chunk.  Coordinates are **absolute** — the lower bound is not
subtracted — so data below the origin has negative chunk coordinates.
Empty chunks are absent from the store and read as "no data here".

### Chunk coordinate → array cell

Each per-chunk array spans the level's chunk grid; the chunk at
absolute coordinate `c` is cell `c - origin`:

```text
origin_i = floor(bounds_min_i / chunk_shape_i)
shape_i  = floor(bounds_max_i / chunk_shape_i) - origin_i + 1
cell_i   = chunk_coord_i - origin_i
```

using the level's `chunk_shape`.  A non-zero origin is stored as the
array's `chunk_grid_origin` key; absent means zero.  Chunk keys in
metadata such as `nonempty_chunks` stay absolute; the cell index is
where the bytes live.  For bounds `[-300, 300]` and `chunk_shape = 200`
the grid has shape `[4, 4, 4]` and origin `[-2, -2, -2]`, and chunk
`-1.-1.1` is stored at `<array>/c/1/1/3`.

At a level with `chunk_shape = r_i × root_chunk_shape_i`, the chunk
covering a level-0 chunk is `coord_0 // r_i`; the grids nest exactly.
Sharding ([§11.6](11-compression-and-encoding.md#116-sharding)) changes
neither keys nor cell indices.

## 6.3 Spatial Query Semantics

A box query `[lo, hi)` resolves to the absolute chunk set

```text
c_i ∈ [floor(lo_i / chunk_shape_i), ceil(hi_i / chunk_shape_i) - 1]
```

intersected with the level's grid.  Readers fetch only chunks that
exist — listed by `nonempty_chunks`, or taken from the store while
presence is deferred ([§7](07-core-arrays.md#per-chunk-array-keys)).

With a bin grid, a reader can narrow further to bins.  Bins, like
chunks, align to the coordinate origin:

```text
bins_per_chunk_i = chunk_shape_i / bin_shape_i
local_i          = floor(position_i / bin_shape_i) - chunk_coord_i * bins_per_chunk_i
```

At level 0 of a point cloud written without object ids, fragment `f`
of a chunk is the bin at `unravel(f, bins_per_chunk)` in C order
([§7.3](07-core-arrays.md#73-vertex-fragments)), so one chunk read can
be subdivided cheaply.

## 6.4 Boundary Conditions

Each vertex is placed in exactly one chunk, `floor(position /
chunk_shape)`.  The root `cross_chunk_strategy` says how connectivity
crosses chunk seams:

| Value | Meaning |
|-------|---------|
| `"explicit_links"` (default) | Each cross-chunk edge or face is a record in `links/0/<offsets>` at a non-zero offsets segment, in its source chunk's cell; endpoint indices are local to their chunks.  No duplication |
| `"boundary_deduplication"` | A vertex on a seam is duplicated into both chunks; readers recover connectivity by coordinate matching |
| `"both"` | Both representations are written |

## 6.5 Octree Chunks

A level MAY replace its uniform chunks with **octree chunks**: grid
cells merged into content-sized leaves, large where data is sparse and
fine where it is dense.  Octree chunks apply to 3-D point clouds and
graphs, and convert to and from uniform chunks without loss.

- **Cell**: one cell of the level's uniform grid, the smallest leaf.
- **Root cube**: `2**D` cells per side from `origin_cell`, `D =
  max_depth`.
- **Leaf**: an aligned cube of `2**(D - d)` cells per side at depth
  `d`, addressed `d/i.j.k`.  Each leaf is one chunk.
- **Anchor**: a leaf's minimum-corner cell; the leaf's data is stored
  at its anchor's key.

### Declaration

The level's `zarr_vectors` object carries `octree_chunks`
([§8.3](08-metadata.md#83-resolution-level-metadata)):

```json
{
  "zarr_vectors": {
    "kind": "level",
    "octree_chunks": {
      "max_depth": 4,
      "origin_cell": [0, 0, 0],
      "target": 500.0,
      "balanced": true,
      "max_leaf_cells": null,
      "shard_shape": null,
      "shard_origin": null,
      "fit_shards": true,
      "weight": "vertices",
      "leaves": 69
    }
  }
}
```

| Key | Meaning |
|-----|---------|
| `max_depth` | `D` |
| `origin_cell` | The root cube's minimum-corner cell |
| `target` | Largest leaf weight asked for; a single heavier cell stays one leaf |
| `balanced` | Whether leaves sharing a face, edge or corner differ by at most one depth |
| `max_leaf_cells` | Widest leaf, in cells per side (a power of two); `null` when uncapped |
| `shard_shape`, `shard_origin` | Shard grid the leaves were fitted to, in cells; `null` when unsharded or not fitted |
| `fit_shards` | `false` when leaves may straddle shards |
| `weight` | What leaves are weighed by: `"vertices"` |
| `leaves` | Number of stored leaves |

During a conversion the object is `{"converting": "to_octree"}` or
`{"converting": "to_uniform"}`; a reader MUST NOT read the level then.

### Layout

| Path | Contents |
|------|----------|
| `<level>/octree_chunks/leaves` | `(N, 5)` `int64`: `depth, i, j, k, weight` per stored leaf |
| `<level>/octree_chunks/cells` | `(C, 6)` `int64`: `i, j, k` (cell), `leaf`, `vertices`, `fragments`, in storage order |
| `vertices`, `vertex_fragments`, `object_index` | As for uniform chunks, keyed by leaf anchors; manifest entries name `(anchor, fragment)` |
| `links/0/<segment>` | Keyed by the source leaf's anchor; see [§10.9](10-cross-chunk-linking.md#109-links-on-an-octree-level) |

A leaf holds its cells' vertices and fragments end to end in Z order;
the cell table records where each cell's run starts.

### Readers without octree support

Such a reader would take each leaf for one cell.  Two mechanisms stop
it:

1. While any level has `octree_chunks`, the root lists the
   `octree_chunks` capability in both `format_capabilities` and
   `required_capabilities`.  A reader that does not implement it MUST
   NOT read such a level.
2. Every per-chunk array of an octree level ends its cell codecs
   (inside any sharding codec) with the marker codec `{"name":
   "zarr_vectors_octree_chunks"}`, which leaves bytes unchanged, so a
   plain Zarr reader fails on an unknown codec instead of misreading.

### Shards and restrictions

On a sharded level a writer SHOULD fit leaves to the `vertices` shard
grid: the root cube starts on a shard boundary and the leaf cap is the
largest power of two dividing every shard side (4 for `[4, 4, 4]`, 2
for `[6, 6, 6]`).  With `fit_shards: false`, shards cannot be read or
written independently.

An octree level has no vertex, fragment or link attributes; its links
are undirected, width 2, `canonical`, between adjacent cells only, and
never to other levels; and it is not attribute-chunked.  Other indexing
strategies are out of scope; they would follow the same pattern of
declaration, required capability and marker codec.

## 6.6 Per-Level Chunk Shape

A level MAY set its own `chunk_shape` in its level object.  It MUST be
a positive integer multiple `r_i` of the root `chunk_shape` on every
axis, and, where the level's bin is not larger than its chunk, a
multiple of the level's bin shape.  A coarse level's bin MAY be larger
than its chunk.  A level without `chunk_shape` uses the root's.

Level 0's bin is the root `base_bin_shape` (or `chunk_shape`).  A
coarser level records `bin_shape` and `bin_ratio` (its bin divided by
the root `base_bin_shape`, per axis, as floats) only in its own level
object; a level recording neither reads as level 0's.  See
[§9.3](09-multi-resolution-support.md#93-spatial-chunk-scaling).

`chunk_shape`, `bin_shape`, `bin_ratio` and `bounds` fix the layout of
written arrays; a writer MUST NOT change them on a populated level.

Larger coarse chunks amortise per-chunk overhead, as voxel-size scaling
does for image pyramids.  Cross-level links re-anchor their offsets
into the target level's grid
([§7.5](07-core-arrays.md#75-vertex-links),
[§10.8](10-cross-chunk-linking.md#108-cross-pyramid-level-links--optional)).

## 6.7 Leading Non-Spatial Chunk Axes

A level MAY add one leading non-spatial axis to its chunk keys
(`b.i.j.k`): every per-chunk array gains a leading axis of length `K`,
origin 0, and object manifests use the extended coordinates.  The
level's `chunk_dims` names the axes, leading axis first; without it the
level is chunked by position only.  Readers MUST check `chunk_dims`
before interpreting chunk keys.  Two uses are defined, mutually
exclusive on a level ([§8.3](08-metadata.md#83-resolution-level-metadata)):

- **Attribute chunking**: a categorical vertex attribute
  (`chunk_attribute_name`) is the leading axis, with one label per bin
  in `chunk_attribute_values`, so a query for one value reads only its
  chunks.  With 4 labels and a 5 × 5 × 5 grid, `vertices` has shape
  `(4, 5, 5, 5)`, and label 2 at `(1, 0, 3)` is `vertices/c/2/1/0/3`.
- **Chunk sources** (composite levels): the leading axis is
  `"source"`; 0 is the level's own cells and each other value is a
  store listed in `chunk_sources`.  A manifest entry `((s, i, j, k),
  f)` with `s >= 1` names fragment `f` of cell `(i, j, k)` in source
  `s`.
