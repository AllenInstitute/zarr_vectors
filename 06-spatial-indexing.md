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

Per-level overrides (v0.7) are allowed and described in §6.6.

## 6.2 Spatial Chunk Addressing

Chunk coordinates are integer tuples in chunk-grid space, one entry
per space axis.  The Zarr v3 chunk-key encoding is the dot-separated
form:

- 2-D: `<i.j>` (e.g. `3.7`)
- 3-D: `<i.j.k>` (e.g. `2.1.0`)
- N-D: `<c_0.c_1.…c_{ndim-1}>`

Empty chunks (no data) are simply absent from the store — Zarr v3
returns a "fill value" miss; ZV readers treat missing chunks as
"no data here."

Translating between physical position and chunk coordinate:

```text
chunk_coord_i = floor((position_i - bounds_min_i) / chunk_shape_i)
```

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
read can be sub-divided cheaply (see §7.3 and the per-bin fragment
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
  written as a record in `cross_chunk_links/0/data` with
  `(chunk_A, vi_A)` / `(chunk_B, vi_B)` endpoints.  No vertex
  duplication.

A store may also set `cross_chunk_strategy = "both"` and emit both
representations.

## 6.5 Alternative Indexing Strategies

The format currently supports only the regular N-D grid index above.
Future indexing strategies (octree / quadtree, Hilbert-curve
ordering, etc.) are out of scope for this snapshot but would be
expressed by replacing the chunk-key encoding while keeping the
per-chunk byte payloads intact.

## 6.6 Per-Level Chunk Shape (v0.7)

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
format already supports this — see §7.7 and §9.6).
