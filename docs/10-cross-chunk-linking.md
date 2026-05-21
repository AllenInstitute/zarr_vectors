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
  chunk coord differ for the same physical region.

Both kinds live under `cross_chunk_links/<delta>/` with identical
record structure; the `level_delta` field in the array's `.zattrs`
declares which case applies.

Since **v0.8** the on-disk layout for this array family has been
**partitioned by chunk** rather than stored as a single flat blob —
see [§10.6](#106-on-disk-layout-partitioned-by-sorted-unique-chunks).
The motivation: a `link_width = 2`, `sid_ndim = 3` record under the
v0.7 layout took 64 bytes (each endpoint's chunk coords baked into
the payload) and the whole table lived in one int64 blob per
`<delta>`, so every append rewrote the file and every "what records
connect chunks A and B?" query scanned the whole array.  The
partitioned layout drops the per-record cost to 18 bytes and turns
that query into a single sorted-path lookup.

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

![Toy Example of A 1d graph coarsening](images/multi-scale-coarsening.png)

- **Principle**: each cross-chunk edge or face is written as one
  record under `cross_chunk_links/<delta>/`, filed into a leaf keyed
  by the **sorted unique set of chunks** that record touches (see
  [§10.6](#106-on-disk-layout-partitioned-by-sorted-unique-chunks)).
- **Setting**: `cross_chunk_strategy = "explicit_links"` (the
  default).
- **Record format**: see [§7.7](07-core-arrays.md#77-cross-chunk-links).  Each record carries `link_width`
  `(chunk_index, local_vertex_index)` pairs.  `link_width = 2` is the
  generic edge; `link_width = 3` is a triangle face; `link_width = 1`
  is a single child reference (used by metanode drill-down).  The
  chunk identity of each endpoint is recovered from the leaf path's
  K sorted segments and the endpoint's `chunk_index` into them — no
  chunk coords appear in the record payload.
- **Per-edge attributes** *(optional)*:
  `cross_chunk_link_attributes/<name>/<delta>/<…>/data` — parallel
  leaves with one row per record in the matching link leaf.
- **Advantages**: explicit, no coordinate matching needed, supports
  arbitrary `link_width`, scales to cross-pyramid-level links via
  `delta ≠ 0`, and the partitioned layout makes "all records between
  chunks A and B" an O(1) sorted-path lookup.

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
| Any v0.7+ pyramid with chunk-scale growth                | `explicit_links` (required for cross-pyramid records) |

## 10.5 Object Index for Cross-Chunk Objects

When an object spans chunks, its `object_index/data` manifest carries
one block per chunk it touches.  Each block names one chunk and a
fragment reference (mode-0 / mode-1 / mode-2).  To reconstruct the
object, a reader:

1. Reads the per-object manifest from `object_index/data`.
2. For each block, decodes the named chunk's
   `vertex_fragments/<chunk>` to find which rows of
   `vertices/<chunk>` belong to the object.
3. Optionally walks the per-pair leaves under `cross_chunk_links/0/`
   to recover edges bridging the chunks.

The manifest blocks do NOT themselves carry cross-chunk *edges* —
they carry chunk + fragment references.  Edges across chunk seams
are a separate concern handled by the per-pair leaves in
`cross_chunk_links/0/`.

## 10.6 On-Disk Layout (Partitioned by Sorted Unique Chunks)

*Added in v0.8.*  Cross-chunk records are filed into leaves keyed by
the sorted unique set of chunks each record touches, instead of being
concatenated into a single flat blob.

### 10.6.1 Path shape

```
/<level>/cross_chunk_links/<delta>/<chunk_sorted_0>/<chunk_sorted_1>/.../<chunk_sorted_{K-1}>/data
/<level>/cross_chunk_link_attributes/<name>/<delta>/<chunk_sorted_0>/.../<chunk_sorted_{K-1}>/data
```

- `K` is the number of **distinct** chunks the records in this leaf
  touch.  `1 ≤ K ≤ link_width`.  Path depth under `<delta>` is exactly
  `K`.
- `<chunk_sorted_i>` is the same dot-separated chunk-coord string used
  for `vertices/<chunk_key>` (e.g. `(0, 1, 2)` → `"0.1.2"`).
- The K segments are emitted in **lex order**: `chunk_sorted_0 <
  chunk_sorted_1 < … < chunk_sorted_{K-1}`, where `a < b` is element-
  wise integer-tuple comparison (`a[0] < b[0]`, or equal at index 0
  and `a[1] < b[1]`, etc.).
- Zarr libraries handle the nested path as standard Group hierarchy;
  navigating to a specific pair is `root[level]["cross_chunk_links"]
  [delta_segment][smaller_key][larger_key]`.

### 10.6.2 Per-record encoding

Each leaf is a 1-D `uint8` byte array containing zero or more
**fixed-size records**:

```
record = [ ci_0, ci_1, ..., ci_{L-1},        # L * uint8   (1 byte each)
           vi_0, vi_1, ..., vi_{L-1} ]       # L * int64   (8 bytes each, little-endian)
       = 9 * L bytes per record
```

- `L = link_width`, declared on the `cross_chunk_links/<delta>/`
  group `.zattrs`.
- `ci_i ∈ [0, K-1]` is endpoint `i`'s **chunk-index** — it picks one
  of the K segments listed in the leaf path; that's the chunk
  endpoint `i` lives in.
- `vi_i` is endpoint `i`'s **local vertex index** inside its chunk's
  vertex array.
- The two blocks are concatenated, all `L` chunk-indices first then
  all `L` vertex indices (bulk reads see contiguous int64 `vi`s and
  contiguous uint8 `ci`s).

**Endpoint level convention** (unchanged from prior versions):
endpoint 0 (the row identified by `ci_0`, `vi_0`) lives at the
**owning** resolution level — the level under whose
`cross_chunk_links/<delta>/` it is written.  Endpoints `1..L-1` live
at `owning_level + level_delta`.

**Per-leaf count.** Derivable from leaf byte length:
`num_records = len(leaf_bytes) / (9 * link_width)`.  No level-wide
`num_links` counter is written.

### 10.6.3 Canonicalization rules

Two normalization rules, each chosen to avoid writing the same logical
record under multiple `ci` permutations:

1. **`delta = 0` AND `L = 2` (undirected edge):** Writers MUST emit
   `ci = [0, 1]`.  This collapses the two orientations of an
   undirected cross-chunk edge into one canonical form.
2. **`delta ≠ 0`:** No canonicalization.  Endpoint 0 lives at the
   owning level; endpoints `1..L-1` live at the target level —
   direction is semantically meaningful and the `ci` permutation
   encodes which side each endpoint is on.
3. **`L ≥ 3`:** No canonicalization mandated.  Higher-arity records
   carry geometry semantics (face winding, parent ordering) that the
   spec doesn't presume to standardize.  Geometry writers MAY apply
   their own conventions but the spec's only hard requirement is the
   coverage invariant ([§10.6.4](#1064-validation-rules)).

### 10.6.4 Validation rules

For every `cross_chunk_links/<delta>/<chunk_sorted_0>/.../<chunk_sorted_{K-1}>/data` leaf:

- **Byte-length:** `len(leaf_bytes) % (9 * link_width) == 0`.
- **`ci` range:** every `ci_i ∈ [0, K-1]`.
- **Coverage invariant:** for every record, the set
  `{ci_0, …, ci_{L-1}}` equals `{0, 1, …, K-1}` — every chunk listed
  in the path is referenced by at least one endpoint.  Records that
  don't use every path-listed chunk belong in a strictly-shallower
  leaf.
- **Lex-sorted path:** the K path segments are in strict lex order.
- **Canonical `ci` for delta=0 L=2 leaves:** every record has
  `ci = [0, 1]`.
- **Chunk-coord arity:** every path segment parses to a chunk-coord of
  arity `sid_ndim`.
- **Chunk existence:** for `delta = 0`, every path segment names a
  chunk present in the owning level's chunk grid.  For `delta ≠ 0`,
  segments used only by `ci_0` must exist at the owning level;
  segments used by any `ci_{i > 0}` must exist at level `owning + delta`.
- **Attribute parity:** for every
  `cross_chunk_link_attributes/<name>/<delta>/<…>/data` leaf, record
  count equals the parallel link leaf's record count.
- **Same-chunk warning:** K=1 leaves (`cross_chunk_links/<delta>/<X>/data`)
  are legal but trigger a warning recommending `links/<delta>/<X>`
  for natural intra-chunk edges; reserve K=1 cross-chunk-link leaves
  for special-case bridges (e.g. legacy same-chunk-bridge records
  emitted by some coarsening paths).

Level-3 consistency validation ([§13.1](13-conformance-and-validation.md#131-conformance-levels))
checks these invariants across every `cross_chunk_links/<delta>/`
group present.

### 10.6.5 Worked examples

**L=2, K=2, delta=0 — graph edge between two chunks.**  Edge between
`(0,0,0):5` and `(1,0,0):2`.  Sorted chunks `(0,0,0) < (1,0,0)`:

```
path:    cross_chunk_links/0/0.0.0/1.0.0/data
record:  ci = [0, 1]            # endpoint 0 at smaller, endpoint 1 at larger
         vi = [5, 2]
bytes:   18 per record
```

**L=2, K=2, delta=+1 — cross-level edge.**  Fine vertex at
`(2,3,1):7` parents to coarse metanode at `(1,1,0):3`.  Sorted:
`(1,1,0) < (2,3,1)`:

```
path:    cross_chunk_links/+1/1.1.0/2.3.1/data
record:  ci = [1, 0]            # endpoint 0 (fine) at (2,3,1); endpoint 1 (coarse) at (1,1,0)
         vi = [7, 3]
bytes:   18 per record
```

The sorted path stays canonical for direct lookup; the `ci`
permutation encodes which side is owning vs target.

**L=2, K=1, delta=0 — same-chunk bridge.**  Both endpoints in chunk
`(0,0,0)`:

```
path:    cross_chunk_links/0/0.0.0/data           # K=1, depth-1 path
record:  ci = [0, 0]
         vi = [2, 5]
bytes:   18 per record
```

**L=3, K=2, delta=0 — triangle face, two distinct chunks.**  Triangle
V0→V1→V2 with V0 at `(0,0,0):5`, V1 at `(1,0,0):3`, V2 at `(0,0,0):7`:

```
path:    cross_chunk_links/0/0.0.0/1.0.0/data
record:  ci = [0, 1, 0]         # V0→chunk 0 of path, V1→chunk 1, V2→chunk 0
         vi = [5, 3, 7]
bytes:   27 per record
```

A second triangle with vertices `(1,0,0):4`, `(0,0,0):8`, `(0,0,0):9`
lands in the **same leaf** under a different `ci` permutation:

```
same path
record:  ci = [1, 0, 0]
         vi = [4, 8, 9]
```

Triangles with the same chunk pair but different winding orientations
share storage — there is no permutation fan-out in the directory.

**L=3, K=3, delta=0 — triangle face spanning three chunks.**
V0 at `(0,0,0):2`, V1 at `(1,0,0):4`, V2 at `(0,1,0):5`.  Sorted:
`(0,0,0) < (0,1,0) < (1,0,0)`:

```
path:    cross_chunk_links/0/0.0.0/0.1.0/1.0.0/data
record:  ci = [0, 2, 1]
         vi = [2, 4, 5]
bytes:   27 per record
```

**L=4, K=2, delta=0 — quad face spanning two chunks.**  Vertices
`(0,0,0):2`, `(0,0,0):3`, `(1,0,0):8`, `(1,0,0):7`:

```
path:    cross_chunk_links/0/0.0.0/1.0.0/data
record:  ci = [0, 0, 1, 1]
         vi = [2, 3, 8, 7]
bytes:   36 per record
```

### 10.6.6 Group `.zattrs` schema

Stored on the `cross_chunk_links/<delta>/` group itself:

```jsonc
{
  "zv_array":    "cross_chunk_links",
  "sid_ndim":    3,
  "level_delta": 1,
  "link_width":  2,
  "layout":      "partitioned_v1"
}
```

`layout = "partitioned_v1"` is the on-disk discriminator that signals
"this group uses the K-deep sorted-chunks path layout described
above".  A reader seeing any other value (including a legacy v0.7
store that wrote `cross_chunk_links/<delta>/data` with no `layout`
key) fails with a clear "run the migration helper" error.

Matching attribute group:

```jsonc
{
  "zv_array":    "cross_chunk_link_attribute",
  "name":        "weight",
  "dtype":       "float32",
  "level_delta": 1,
  "shape":       null,        // or [C] for multi-channel
  "layout":      "partitioned_v1"
}
```

`num_links` is no longer at the group level in either schema — per-
leaf counts are derived from leaf byte length.

### 10.6.7 Reader access patterns

**Records between two specific chunks `A` and `B` (any L, K = 2):**

```python
smaller, larger = sorted([A, B])  # lex compare
leaf = level["cross_chunk_links"][delta_segment][smaller_key][larger_key]
records = decode(leaf, link_width=L)
# each record's ci tells you which endpoint is at smaller vs larger
```

One lookup.  No permutation scan.

**Records with all endpoints in chunks `A, B, C` (any L, K = 3):**

```python
c0, c1, c2 = sorted([A, B, C])
leaf = level["cross_chunk_links"][delta_segment][c0_key][c1_key][c2_key]
```

One lookup; record `ci`s permute the three chunks across endpoints
per the writer's winding convention.

**All records involving chunk X:** walk every leaf under
`cross_chunk_links/<delta>/`; X may appear at any segment position.
In practice the caller uses the chunk neighbourhood (chunks spatially
adjacent to X) to bound the search.

**Whole-level scan:** recursively walk `cross_chunk_links/<delta>/`
to find leaves.  Total work is comparable to scanning the legacy
single blob but restartable per leaf and far more cache-friendly: a
reader working in one spatial region sees only the relevant subtrees.

## 10.7 Consistency Guarantees

A writer that emits cross-chunk records is responsible for:

- Every endpoint's chunk coordinates (recovered from the leaf path)
  exist (the chunk has a `vertices/<chunk>` blob at that level).
- Every endpoint's `vi` falls within its chunk's vertex count.
- The `link_width` matches the array's `.zattrs.link_width`.
- The parallel attribute leaf (if emitted) has the same record count
  as the link leaf at the same `(delta, sorted-chunks-path)` — a
  desynchronized write fails loudly at read time.

Level-3 consistency validation ([§13.1](13-conformance-and-validation.md#131-conformance-levels)) checks these invariants
across every `cross_chunk_links/<delta>/` group present.

## 10.8 Cross-Pyramid-Level Cross-Chunk Links — Optional

Cross-pyramid-level cross-chunk links (`cross_chunk_links/<delta>/`
with `delta ≠ 0`) are an **optional feature**, not a baseline schema
requirement.  Whether a store emits them is a writer-side choice
driven by what readers of the store need to do — see [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional) for the
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

Same as [§7.7](07-core-arrays.md#77-cross-chunk-links) and
[§10.6.2](#1062-per-record-encoding): the leaf path lists the K
sorted unique chunks the record touches; the record is `L` chunk-
indices (uint8) followed by `L` local vertex indices (int64).

**Endpoint level convention** (also in [§7.7](07-core-arrays.md#77-cross-chunk-links)): endpoint 0 lives at the
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
coord_fine // chunk_scale_factor`.  The cross-chunk link layout
already supports this because each endpoint's chunk is recovered
from a path segment selected by `ci`, with no assumption that the
owning-side and target-side chunks live in the same grid.  Cross-
spatial-chunk and cross-pyramid-level cases share the same on-disk
shape.

## 10.9 Migration from v0.7

The v0.7 monolithic `cross_chunk_links/<delta>/data` int64 blob (and
its parallel `cross_chunk_link_attributes/<name>/<delta>/data`) is
**not readable** by v0.8 readers.  Stores tagged with the
`multiscale_links` capability but lacking `partitioned_cross_chunk_links`
trigger a fatal error directing the user to run a one-shot in-place
migration utility, which:

1. Reads the legacy blob and decodes each record's endpoints.
2. Groups records by `tuple(sorted(set(endpoint.chunk for endpoint in record)))`.
3. Writes the new K-deep leaves with the chunk-index-plus-vi
   encoding, applying the `delta=0 L=2` `ci = [0, 1]` canonicalization
   along the way.
4. Applies the same regrouping to every parallel attribute blob.
5. Stamps the group `.zattrs` with `layout = "partitioned_v1"` and
   the root `format_capabilities` with `partitioned_cross_chunk_links`.
6. Deletes the legacy `data` blob and bumps `zv_version` to `"0.8.0"`.

The migration is destructive (it removes the old blob after the new
layout is in place); back up the store first if you need a recoverable
snapshot.
