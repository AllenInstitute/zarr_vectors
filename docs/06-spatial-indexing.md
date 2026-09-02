# 6. Spatial Indexing

## 6.1 Spatial Index Definition

A ZV store's spatial index is a regular N-dimensional grid pinned to
the level-0 chunk shape:

- **Axes**: declared in NGFF style under `zarr.json["multiscales"][0].axes`.
  The number of axes with `type == "space"` is `sid_ndim`.  NGFF
  prescribes axis order `time → channel → custom → space`.
- **Bounds**: a root-only `(min_corner, max_corner)` covering all
  data.  There are no per-level bounds.
- **Level-0 chunk shape**: `RootMetadata.chunk_shape` — one positive
  float per space axis.  This is the **finest** chunk grid in the
  store; every coarser level nests cleanly into it.
- **Optional bin grid**: a `base_bin_shape` finer than `chunk_shape`
  partitioning each chunk into a regular grid of bins.  Required to
  be an integer divisor of `chunk_shape` along every axis.  When
  unset, one bin per chunk.
- **Reference system**: optional OME-Zarr RFC 4 / 5 `crs` dict, with
  per-axis UDUNITS-2 units on the NGFF axes.

Per-level overrides are allowed and described in [§6.6](#66-per-level-chunk-shape).

## 6.2 Spatial Chunk Addressing

Chunk coordinates are integer tuples in chunk-grid space, one entry
per space axis, written in the dot-separated form:

- 2-D: `<i.j>` (e.g. `3.7`)
- 3-D: `<i.j.k>` (e.g. `2.1.0`)
- N-D: `<c_0.c_1.…c_{ndim-1}>`

Empty chunks (no data) are simply absent from the store — Zarr v3
returns a "fill value" miss; ZV readers treat missing chunks as
"no data here."

Translating between physical position and chunk coordinate:

```text
chunk_coord_i = floor(position_i / chunk_shape_i)
```

Note that this is **absolute** — the store's lower bound is not
subtracted — so a store whose data extends below the origin has
negative chunk coordinates, and that is well-defined rather than an
error.

### Chunk coordinate → array cell

A chunk coordinate is not directly an index into a per-chunk array.
Each such array is one array over the level's chunk grid, and the
chunk at absolute coord `c` occupies

```text
cell_i   = chunk_coord_i - origin_i
origin_i = floor(bounds_min_i / chunk_shape_i)
```

The origin is stored as the array's `chunk_grid_origin` attribute
**only when it is non-zero**; its absence means the two are the same
number.  Keeping the offset in the array rather than in the coordinate
is what lets negative-coordinate data map onto a 0-indexed Zarr array
without renumbering anything.  The dot-separated chunk key remains the
*absolute* coordinate — it is how a chunk is named in metadata such as
`nonempty_chunks` — while the cell index is where its bytes live.

At a coarser pyramid level with `chunk_shape_level = r_i × root_chunk_shape_i`,
a level-N chunk coord and a level-0 chunk coord at the same
physical position are related by integer division: `coord_level =
coord_0 // r_i`.  This is what makes per-level chunk-shape overrides
safe: the grids nest exactly.

## 6.3 Spatial Query Semantics

A bounding-box query `(lo, hi)` resolves to a chunk set:

```text
chunks = {(c_0, …, c_{ndim-1})
          : c_i ∈ [floor((lo_i - bounds_min_i)/chunk_shape_i),
                   ceil ((hi_i - bounds_min_i)/chunk_shape_i) - 1]}
```

Readers fetch only the chunks that exist within this set.  When the
store has a bin grid (`base_bin_shape != null`), per-chunk filtering
can narrow further to individual bins using the fragment-index
boundaries — point clouds use the bin layout so that a single chunk
read can be sub-divided cheaply (see [§7.3](07-core-arrays.md#73-vertex-fragments) and the per-bin fragment
mapping in `zarr_vectors.spatial.chunking`).

Point-in-volume queries reduce to one chunk lookup followed by a
fragment-level intersection.

## 6.4 Boundary Conditions

A vertex's chunk is determined by `floor(position / chunk_shape)`.
Writers place each vertex in exactly one chunk; cross-chunk
connectivity is then expressed by one of two strategies:

- **Boundary deduplication** (`cross_chunk_strategy =
  "boundary_deduplication"`): a vertex right on a chunk seam is
  duplicated into both adjacent chunks, allowing readers to recover
  connectivity by coordinate matching.  Simpler, costs one extra
  vertex per shared boundary point.
- **Explicit cross-chunk links** (`cross_chunk_strategy =
  "explicit_links"`, the default): each cross-chunk edge or face is
  written as a record in `links/0/<offsets>` at a non-zero offsets
  segment, in the cell of its source chunk.  Each endpoint's chunk is
  recovered from that cell plus the offsets, and its vertex index is
  local to that chunk.  No vertex duplication.

A store may also set `cross_chunk_strategy = "both"` and emit both
representations.

## 6.5 Alternative Indexing Strategies

The format currently supports only the regular N-D grid index above.
Future indexing strategies (octree / quadtree, Hilbert-curve
ordering, etc.) are out of scope for this snapshot but would be
expressed by replacing the chunk-key encoding while keeping the
per-chunk byte payloads intact.

## 6.6 Per-Level Chunk Shape

`RootMetadata.chunk_shape` defines the **level-0** grid.  Each pyramid
level may carry its own `chunk_shape` in
`zarr_vectors_level.chunk_shape`, subject to:

1. **Positive integer multiple of root** along every axis — the level
   `chunk_shape` axes are `r_i × root_chunk_shape_i` for some
   positive integer `r_i`.
2. **Per-axis divisibility by the level's `bin_shape`** — bins still
   tile chunks cleanly at the level's resolution.

The per-axis multipliers `r_i` are exposed by
`chunk_scale_factor(root_meta, level_meta)` and are computed lazily
at read time.  Writers that don't grow chunks across levels leave
`zarr_vectors_level.chunk_shape` unset; the level inherits root
unchanged.

This mechanism plays the same role for vector pyramids that voxel-size
scaling plays for OME-Zarr image pyramids: coarser levels can
amortise the per-chunk overhead by holding bigger physical regions.
The cost: when `r_i > 1`, a level-N chunk physically covers a region
spanning multiple level-(N-1) chunks, so cross-pyramid-level link
arrays carry both endpoints' chunk coords explicitly (the record
format already supports this — see [§7.5](07-core-arrays.md#75-vertex-links) and [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).
