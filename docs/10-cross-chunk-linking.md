# 10. Cross-Chunk Linking

## 10.1 Problem Statement

Many objects span more than one spatial chunk — a neuron skeleton
that runs through six chunks, a streamline whose path crosses
several boundaries, a mesh with triangle faces straddling a seam.
Within a chunk, vertex indices are chunk-local and have no global
meaning; some additional structure must carry connectivity across
chunk boundaries.

This chapter covers **two distinct cross-chunk concepts** that the
schema treats uniformly under one array family:

- **Cross-spatial-chunk links** at one resolution level
  (`delta = 0`).  Endpoints in two different chunks at the SAME
  pyramid level — the classic "two chunks of one skeleton, with an
  edge linking them."
- **Cross-pyramid-level links** between resolution levels
  (`delta ≠ 0`).  Endpoints at the source level paired with endpoints
  at `source + delta`.  When the coarse level also grows
  `chunk_shape` (v0.7), the source-side chunk coord and target-side
  chunk coord differ for the same physical region — the format
  handles this by carrying both endpoints' chunk coords explicitly
  in every record.

Both kinds live at `cross_chunk_links/<delta>/data` with identical
record structure; the `level_delta` field in the array's `.zattrs`
declares which case applies.

## 10.2 Strategy 1: Boundary Deduplication

- **Principle**: vertices on chunk boundaries are duplicated into
  both adjacent chunks.  Connectivity is implicit by coordinate
  matching at read time.
- **Setting**: `cross_chunk_strategy = "boundary_deduplication"`.
- **Cost**: one extra vertex row per shared boundary point (and one
  extra fragment entry).
- **Advantages**: simplest read path — readers don't need to consult
  any cross-chunk index.
- **Disadvantages**: requires precise coordinate alignment; floating-
  point round-trips can de-align "shared" points; doesn't scale to
  cross-pyramid-level cases.

## 10.3 Strategy 2: Explicit Cross-Chunk Links

- **Principle**: each cross-chunk edge or face is written as one
  record in `cross_chunk_links/0/data`.
- **Setting**: `cross_chunk_strategy = "explicit_links"` (the
  default).
- **Record format**: see §7.7.  Each record carries `link_width`
  endpoints, each endpoint a `(chunk_coords, local_vertex_index)`
  pair.  `link_width = 2` is the generic edge; `link_width = 3` is
  a triangle face; `link_width = 1` is a single child reference
  (used by metanode drill-down).
- **Per-edge attributes** *(optional)*:
  `cross_chunk_link_attributes/<name>/0/data` — one row per record.
- **Advantages**: explicit, no coordinate matching needed, supports
  arbitrary `link_width`, and (via `delta ≠ 0`) extends naturally to
  cross-pyramid-level links.

## 10.4 Strategy Selection

Stores set `cross_chunk_strategy` in root metadata; the default is
`"explicit_links"`.  The third option, `"both"`, emits both
representations — useful for stores whose readers may not all support
explicit cross-chunk links.

Picking guidance:

| Use case                                                 | Strategy                |
|----------------------------------------------------------|-------------------------|
| Skeleton with strict integer voxel-coordinate vertices   | either; deduplication is simplest |
| Streamline / polyline with float vertices                | `explicit_links`        |
| Mesh with shared rim triangles                           | `explicit_links` (link_width=3) |
| Any v0.7 pyramid with chunk-scale growth                 | `explicit_links` (required for cross-pyramid records) |

## 10.5 Object Index for Cross-Chunk Objects

When an object spans chunks, its `object_index/data` manifest carries
one block per chunk it touches.  Each block names one chunk and a
fragment reference (mode-0 / mode-1 / mode-2).  To reconstruct the
object, a reader:

1. Reads the per-object manifest from `object_index/data`.
2. For each block, decodes the named chunk's
   `vertex_fragments/<chunk>` to find which rows of
   `vertices/<chunk>` belong to the object.
3. Optionally walks `cross_chunk_links/0/data` to recover edges
   bridging the chunks.

The manifest blocks do NOT themselves carry cross-chunk *edges* —
they carry chunk + fragment references.  Edges across chunk seams
are a separate concern handled by `cross_chunk_links/0/data`.

## 10.6 Consistency Guarantees

A writer that emits cross-chunk records is responsible for:

- Every endpoint's chunk coordinates exist (the chunk has a
  `vertices/<chunk>` blob at that level).
- Every endpoint's `local_vertex_index` falls within the chunk's
  vertex count.
- The `link_width` matches the array's `.zattrs.link_width`.
- The parallel attribute array (if emitted) has the same row count
  as the link array — a desynchronized write fails loudly at read
  time.

Level-3 consistency validation (§13.1) checks these invariants
across `cross_chunk_links/<delta>/data` for every delta present.

## 10.7 Cross-Pyramid-Level Cross-Chunk Links — Optional

Cross-pyramid-level cross-chunk links (`cross_chunk_links/<delta>/data`
with `delta ≠ 0`) are an **optional feature**, not a baseline schema
requirement.  Whether a store emits them is a writer-side choice
driven by what readers of the store need to do — see §9.6 for the
overall framing of multiscale link arrays.

These records exist only when the writer chose
`cross_level_storage ∈ {"implicit", "explicit"}` *and* the relevant
endpoints end up in different chunks at the differing pyramid level
(which happens both when objects naturally span chunks at the coarse
level *and*, more often, when the coarse level grows `chunk_shape`
under v0.7 so the source-side chunk and the target-side chunk are
necessarily different).

Pyramids that opt out (`cross_level_storage = "none"`) never emit
these records and pay no storage cost — but they cannot be drilled
across levels.  Readers seeing `format_capabilities` without
`multiscale_links` must treat each coarse level as an independent
simplification.

### Record format

Same as §7.7: `link_width` endpoints, each endpoint a
`(int64 chunk_coords[sid_ndim], int64 local_vertex_index)`.

**Endpoint level convention** (also in §7.7): endpoint 0 lives at the
*owning* resolution level L (the level under whose group the array
resides); endpoints `k > 0` live at level `L + delta`.  When
`delta > 0`, the owning level is the finer side and the records map
fine → coarse; when `delta < 0`, the owning level is the coarser
side and the records map coarse → fine.

For `link_width = 1` (metanode drill-down records), the single
endpoint is at level `L + delta` and is paired with an implicit
source defined by the owning fragment (the record stores only the
target reference).

### Emission rules

The pyramid builder consults two root-metadata knobs:

- **`cross_level_storage`** ∈ `{"none", "implicit", "explicit"}`:
  - `"none"` — no `<delta> ≠ 0` records emitted at all.
  - `"implicit"` — only `+N` direction emitted (at the finer level).
    Reader inversion from coarse → fine is computed at read time.
  - `"explicit"` (default) — both `+N` and `-N` emitted.  Both
    directions queryable at read time.
- **`cross_level_depth`** — max `|delta|` materialised.  `1`
  emits ±1; `N` emits ±1, ±2, …, ±N (composed step-by-step during
  pyramid build); `0` disables; `-1` walks all adjacent level pairs.

### Interaction with v0.7 chunk-scale growth

When the coarser level grows `chunk_shape` (per-level
`zarr_vectors_level.chunk_shape` is a positive integer multiple of
root), a fine-level chunk's parent metavertex naturally lives in a
*different* chunk coord at the coarse level — `coord_coarse =
coord_fine // chunk_scale_factor`.  The cross-chunk link record
already supports this because each endpoint carries its own chunk
coords inline.  Cross-spatial-chunk and cross-pyramid-level cases
collapse into one record shape.
