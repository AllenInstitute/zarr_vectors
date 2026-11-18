# 10. Linking Across Chunks and Levels

## 10.1 Problem Statement

Many objects span several chunks — a skeleton through six chunks, a
streamline across several seams, a mesh with faces straddling one.
Vertex indices are chunk-local, so connectivity across chunks needs its
own structure.  Two cases share one array family,
`links/<delta>/<offsets>/`:

- **Cross-chunk links** at one level (`delta = 0`): endpoints in
  different chunks of the same level.
- **Cross-level links** (`delta ≠ 0`): endpoints at the source level
  paired with endpoints at `source + delta`.

An intra-chunk link is a link whose offsets are all zero
([§10.6](#106-on-disk-layout-the-links-family)).  Because the endpoint
relationship is in the *path*, every link array is an ordinary
chunk-grid array that shards, enumerates and validates like
`vertices`, and no record names a chunk.

## 10.2 Strategy 1: Boundary Deduplication

With `cross_chunk_strategy = "boundary_deduplication"`, vertices on a
seam are duplicated into both chunks and connectivity is recovered by
coordinate matching.  It is the simplest read path but costs one extra
vertex (and fragment entry) per shared point, needs exact coordinate
agreement (float round-trips can break it), and cannot express
cross-level links.

## 10.3 Strategy 2: Explicit Cross-Chunk Links

With `cross_chunk_strategy = "explicit_links"` (the default), each
cross-chunk edge or face is one record in `links/<delta>/<offsets>/`,
in the cell of its **source** chunk; the offsets segment locates the
other endpoints.  Records hold `link_width` chunk-local indices
([§7.5](07-core-arrays.md#75-vertex-links)); per-link attributes, if
any, are in `link_attributes/<name>/<delta>/<offsets>/`, row for row.
It needs no coordinate matching, supports any `link_width`, extends to
cross-level links, and makes "all records leaving chunk A in direction
d" one cell read.

## 10.4 Strategy Selection

`cross_chunk_strategy` is a root key; `"both"` writes both
representations, for readers that may not support explicit links.

| Use case | Strategy |
|----------|----------|
| Skeleton with integer voxel-coordinate vertices | either; deduplication is simplest |
| Streamline or polyline with float vertices | `explicit_links` |
| Mesh with faces across seams | `explicit_links` (`link_width = 3`) |
| Pyramid with cross-level links | `explicit_links` (required) |

## 10.5 Object Index for Cross-Chunk Objects

An object spanning chunks has one manifest entry per fragment it uses,
in any chunk ([§7.6](07-core-arrays.md#76-object-index)).  To
reconstruct it, a reader reads its manifest, decodes each named chunk's
`vertex_fragments` cell to find the object's rows, and, if it needs the
edges between chunks, reads the non-intra arrays under `links/0/` at
those chunks.  Manifests reference vertex fragments only, never edges.

## 10.6 On-Disk Layout: The Links Family

### 10.6.1 Array tree

```
/<level>/links/<delta>/                              # GROUP  — family policy
/<level>/links/<delta>/<offsets>/                    # ARRAY  — one per offsets segment
/<level>/link_attributes/<name>/<delta>/             # GROUP  — mirrors the family
/<level>/link_attributes/<name>/<delta>/<offsets>/   # ARRAY  — mirrors cell-for-cell
```

Each `<offsets>` array is an ordinary per-chunk array
([§7](07-core-arrays.md#per-chunk-array-keys)), optionally sharded
([§11.6](11-compression-and-encoding.md#116-sharding)).  `links/<delta>`
is always a group, never an array.

### 10.6.2 The `<delta>` segment

The signed number of pyramid levels the record spans, written `0`,
`+N` or `-N`; the `+` is kept so listings distinguish it from `0`.

### 10.6.3 The `<offsets>` segment

The positions of the record's *other* endpoints relative to its source
chunk (the cell holding it): `link_width - 1` offsets, each `sid_ndim`
signed integers written like the delta, components joined by `.` and
offsets by `_`.

| Segment | `L` | Meaning |
|---------|-----|---------|
| `0.0.0` | 2 | intra-chunk edge |
| `0.0.+1` | 2 | edge to the neighbour along `+z` |
| `0.0.-1` | 2 | edge to the neighbour along `-z` |
| `0.0.0_0.0.0` | 3 | intra-chunk triangle |
| `0.0.+1_0.+1.0` | 3 | triangle spanning the source, `+z` and `+y` |
| `self` | 1 | no other endpoint |

The source's own offset `o_0 = 0` is not encoded.  Record component
`vi_k` is a row of chunk `src + o_k`.  A reader MUST enforce:

1. the segment has exactly `link_width - 1` offsets, or is `self`;
2. every offset has exactly `sid_ndim` components;
3. the segment is `self` iff `link_width == 1`.

### 10.6.4 Per-cell payload

| Condition | Encoding | Sidecar |
|-----------|----------|---------|
| `delta == 0` and offsets all zero | flat concatenated rows | `link_fragments/<chunk>` |
| otherwise | inline ragged blob: `int64 K`, `int64 offsets[K]`, then the rows | none |

A row is `link_width` integers, or `1 + link_width` with a permutation
index in column 0.  Link fragments need not match vertex fragments
unless the level sets `link_fragments_aligned: true`
([§7.5](07-core-arrays.md#75-vertex-links)).

### 10.6.5 Whether a permutation index is present

`has_perm` is stamped on every array, so readers never infer it:

```python
def links_has_perm(offsets, *, delta, directed, store):
    if is_intra(offsets):     return False   # identity: nothing to canonicalise
    if delta != 0:            return False   # cross-level: source is always endpoint 0
    if store == "duplicate":  return True    # each copy leads with a different endpoint
    return not directed                      # undirected sorts; directed does not
```

Under `store = "canonical"` with `directed = false`, endpoints are
sorted by `(chunk_coords, vertex_index)` and the smallest becomes the
source, so stored offsets are lexicographically positive and `A→B` and
`B→A` share one cell.  `perm_idx`, the Lehmer code of the permutation,
recovers the input order (face winding, edge direction).  Negative
offsets therefore arise only in `directed` families and under
`store = "duplicate"`.

| `directed` | `store` | On disk |
|------------|---------|---------|
| `false` | `canonical` | one cell, canonical-sorted, `perm_idx` present |
| `false` | `duplicate` | one copy per distinct incident chunk, `perm_idx` present |
| `true` | `canonical` | one cell in input order, no `perm_idx` |
| `true` | `duplicate` | one copy per distinct incident chunk, `perm_idx` present |

`"duplicate"` makes any chunk's incidence query one cell read at the
cost of a larger store; `num_physical_records` then exceeds
`num_links`.

### 10.6.6 Metadata

Each node carries a `zarr_vectors` object and registers the convention
with `"zarr_conventions": [{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}]`.
Family group `links/<delta>/`, from a graph store:

```json
{
  "zarr_conventions": [{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}],
  "zarr_vectors": {
    "kind": "links_family",
    "level_delta": 0,
    "link_width": 2,
    "directed": false,
    "store": "canonical",
    "sid_ndim": 3,
    "num_links": 396,
    "num_physical_records": 396
  }
}
```

`num_links` is the logical record count and `num_physical_records` the
stored row count; both are absent until the family is finalized.  Every
offsets array beneath the family decodes against its policy, so a
conflicting re-stamp MUST be rejected.

A `delta = 0` family MAY carry `element`, declaring that each record is
one solid cell of a volume mesh rather than an edge or a polygon face:

| `element` | `link_width` | Vertex order |
|-----------|--------------|--------------|
| `"tetra"` | 4 | `0, 1, 2` a triangle whose right-hand normal points towards `3` |
| `"pyramid"` | 5 | base quad `0`–`3` whose right-hand normal points towards the apex `4` |
| `"wedge"` | 6 | triangle `0, 1, 2` whose right-hand normal points away from triangle `3, 4, 5`; `i` joined to `i + 3` |
| `"hexahedron"` | 8 | quad `0`–`3` whose right-hand normal points towards quad `4`–`7`; `i` joined to `i + 4` |

The orders are VTK's; in them every cell has positive volume.  Absent
(or `null`), a record is an edge (`link_width` 2) or a polygon face
(3 or more), so a store without the field reads as before.

- `element` MUST match `link_width`, and MUST NOT appear on a
  `delta ≠ 0` family: a cell's vertices are all on one pyramid level.
  They may sit in different chunks, like any record's endpoints.
- Vertex order MUST survive storage, as for mesh winding
  ([§12.2](12-geometry-types.md#122-meshes)).
- Writers SHOULD NOT store cells with non-positive signed volume.
- A writer MUST NOT add, change or remove `element` on a family that
  already holds records: that would change what the records mean.
- A reader that does not recognise the value MUST NOT read the records
  as polygon faces.

Offsets array `links/<delta>/<offsets>/` (`nonempty_chunks` and
`chunk_grid_origin` omitted); `offsets` is the parsed path segment:

```json
{
  "kind": "links",
  "dtype": "int64",
  "offsets": [[0, 0, 1]],
  "has_perm": true,
  "link_width": 2,
  "level_delta": 0
}
```

Attribute family group and array:

```json
{ "kind": "link_attribute_family", "name": "weight", "level_delta": 0, "num_links": 396 }
```
```json
{
  "kind": "link_attribute",
  "name": "weight",
  "dtype": "float32",
  "row_shape": [],
  "offsets": [[0, 0, 1]],
  "level_delta": 0
}
```

An attribute cell is always flat: one row per record of the parallel
link cell, in the same order.

### 10.6.7 Enumeration order

Records enumerate in `(offsets segment, cell)` sorted order.  `+`
(`0x2b`) and `-` (`0x2d`) sort before `0` (`0x30`), so the intra-chunk
segment sorts **last**:

```python
sorted(['0.0.0', '0.0.+1', '0.0.-1', '+1.0.0', '-1.0.0'])
# ['+1.0.0', '-1.0.0', '0.0.+1', '0.0.-1', '0.0.0']
```

A writer building a parallel array by iteration order must not assume
intra-chunk records come first.

### 10.6.8 Validation rules

1. Every child of `links/<delta>/` is an array whose name is a valid
   offsets segment for the family's `link_width` and `sid_ndim`
   ([§10.6.3](#1063-the-offsets-segment)).
2. Each array's `has_perm` equals `links_has_perm(...)` for the family
   policy ([§10.6.5](#1065-whether-a-permutation-index-is-present)).
3. Row width is `link_width + (1 if has_perm else 0)`, and a cell's
   byte length is a whole number of rows.
4. Every `vi_k` is below the vertex count of chunk `src + o_k`, which
   exists at the endpoint's level (`owning` for `o_0`, `owning + delta`
   otherwise).
5. The intra array at `delta == 0` has a `link_fragments` cell for
   every cell it populates; no other array has one.
6. Every populated attribute cell has as many rows as the parallel link
   cell has records.
7. When present, `num_links` and `num_physical_records` match the
   stored records; `num_physical_records ≥ num_links`, equal unless
   `store == "duplicate"`.
8. Under `link_fragments_aligned: true`, every intra-chunk record in
   link fragment `k` has its first endpoint in vertex fragment `k` of
   the same chunk, and vice versa.
9. When present, `element` is one of `tetra`, `pyramid`, `wedge`,
   `hexahedron`, its width equals `link_width`, and the family's
   `delta` is 0.

### 10.6.9 Worked examples

`sid_ndim = 3`.  The source chunk is the cell; other endpoints come
from the path.

| Case | Array | Cell | Row | Reads as |
|------|-------|------|-----|----------|
| Intra-chunk edge, `L=2` | `links/0/0.0.0` | `(4,2,7)` | `[5, 2]` | vertices 5 and 2, both in `(4,2,7)` |
| Edge across `+z`, `L=2` | `links/0/0.0.+1` | `(4,2,7)` | `[0, 5, 2]` | `perm_idx=0`; vertex 5 in `(4,2,7)`, vertex 2 in `(4,2,8)` |
| Edge across `-x`, `L=2`, `directed` | `links/0/-1.0.0` | `(4,2,7)` | `[5, 2]` | input order, no `perm_idx` |
| Intra-chunk triangle, `L=3` | `links/0/0.0.0_0.0.0` | `(4,2,7)` | `[5, 3, 7]` | all in `(4,2,7)` |
| Triangle across two seams, `L=3` | `links/0/0.0.+1_0.+1.0` | `(4,2,7)` | `[0, 5, 3, 7]` | 5 in `(4,2,7)`, 3 in `(4,2,8)`, 7 in `(4,3,7)` |
| Parent reference, `L=1` | `links/+1/self` | `(4,2,7)` | `[9]` | vertex 9 of the anchored chunk one level coarser |

### 10.6.10 Reader access patterns

"Which records leave chunk `c` toward `+z`?" is one cell read:

```python
arr  = level["links"]["0"]["0.0.+1"]
zv   = arr.attrs["zarr_vectors"]
o    = zv.get("chunk_grid_origin", (0,) * ndim)
cell = tuple(ci - oi for ci, oi in zip(c, o))
records = decode(arr[cell], link_width=L, has_perm=zv["has_perm"])
```

"Every record incident on `c`" is one cell read per offsets segment
(`list(level["links"]["0"])` names them); under `store = "duplicate"`
it needs only chunk `c`'s cells.

## 10.7 Consistency Guarantees

- **Chunk-local indices.**  No record stores a global vertex id; each
  `vi_k` is local to chunk `src + o_k`.
- **Attribute parity.**  `link_attributes/<name>/<delta>/<offsets>`
  mirrors `links/<delta>/<offsets>`: same segments, cells and row order.
- **Uniform family policy.**  `link_width`, `sid_ndim`, `directed` and
  `store` belong to the whole `<delta>` family; two link widths at one
  level need two deltas.
- **Referential integrity.**  A record naming chunk `src + o_k` requires
  that chunk to exist with at least `vi_k + 1` vertices at the
  endpoint's level; deleting a chunk without the records that reach
  into it leaves the store invalid.
- **Finalize before sharding.**  `num_links` and
  `num_physical_records` must be written before the store is sharded,
  since they can no longer be recovered by listing cell files.

## 10.8 Cross-Pyramid-Level Links — Optional

Records with `delta ≠ 0` connect a chunk at the owning level to chunks
at `owning + delta`.  They are written only when `cross_level_storage`
is `implicit` or `explicit`
([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).

### Offsets are measured in the target level's grid

The offsets are measured from the source chunk re-anchored into the
target level's grid, not from the raw coordinate difference:

```
anchor = floor(c_src * r_src / r_trg)
o      = c_trg - anchor            # decode:  c_trg = anchor + o
```

`r_src` and `r_trg` are the levels' chunk-shape multipliers
([§9.3](09-multi-resolution-support.md#93-spatial-chunk-scaling)).  This
keeps one physical relationship in one array when the coarse level
grows `chunk_shape`.

### Emission rules

- Endpoint 0 is the source at the owning level; endpoints `k > 0` are at
  `owning + delta`.
- Every `delta ≠ 0` array has `has_perm = false`, the inline ragged
  encoding and no `link_fragments`.
- `link_width = 1` uses the `self` segment.
- `"explicit"` storage writes `+N` at the finer level and `-N` at the
  coarser; `"implicit"` writes only `+N`.

### Known limitation

`<delta>` is shared by all of a record's non-source endpoints, so a
record whose endpoints are at different levels (a triangle at `(N, N,
N+1)`) cannot be expressed and must be decomposed.

## 10.9 Links on an Octree Level

On a level with octree chunks ([§6.5](06-spatial-indexing.md#65-octree-chunks))
a neighbour may be coarser than the source, so `links/0/<segment>`
names the other endpoint by offset and depth change:

- A link is filed under its **source leaf** — the deeper endpoint, or
  at equal depth the one with the smaller anchor — in the cell of the
  source's anchor.
- The other endpoint, `Δ ≥ 0` depths coarser, is named by its offset
  `o ∈ {-1, 0, 1}³` from the source's ancestor at that depth:

  ```text
  other = (d - Δ, (i >> Δ) + o_x, (j >> Δ) + o_y, (k >> Δ) + o_z)
  ```

- The segment is `o` written as in [§10.6.3](#1063-the-offsets-segment),
  with `^Δ` appended when `Δ > 0`: `0.0.0` the same leaf, `+1.0.0` the
  same-depth leaf along `+x`, `-1.0.0^1` the leaf along `−x` of the
  source's parent.
- Rows are `(source row, other row)`, each local to its leaf.  A
  balanced level has at most 26 + 26 segments besides `0.0.0`.

Octree links are undirected, `canonical`, width 2, between adjacent
cells, at `delta = 0` only.  A reader without octree support MUST NOT
read such a level; the `octree_chunks` required capability and marker
codec stop it first.
