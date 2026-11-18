# 4. Data Model

## 4.1 Hierarchical Organization

A store is a Zarr v3 group tree.  Resolution levels are bare-integer
groups (`0/`, `1/`, …); level `0` is full resolution.  Within a level,
each per-chunk quantity is one Zarr array over the level's chunk grid,
one cell per chunk, and the fragment-index, object-index and link
payloads are byte layouts inside those cells.  Every node with a Zarr
Vectors role carries a `zarr_vectors` attribute whose `kind` names the
role, and registers the convention in `zarr_conventions`
([§3.7](03-terminology-and-concepts.md#37-metadata-terms)).

`<i.j.k>` below names the cell of one spatial chunk (file
`<array>/c/<i>/<j>/<k>`):

```
Zarr Store Root
├── zarr.json                          # zarr_vectors (kind "root"), zarr_conventions,
│                                      #   multiscales, ome, optional proj:projjson
├── 0/                                 # full resolution
│   ├── zarr.json                      # zarr_vectors (kind "level")
│   ├── vertices/<i.j.k>               # positions, one cell per spatial chunk
│   ├── vertex_fragments/<i.j.k>       # fragment index over the vertices cell
│   ├── links/0/0.0.0/<i.j.k>          # intra-chunk link rows (delta=0)
│   ├── links/0/0.0.+1/<i.j.k>         # links reaching the +z neighbour
│   ├── link_fragments/<i.j.k>         # fragment index over links/0/0.0.0 only
│   ├── vertex_attributes/<name>/<i.j.k>
│   ├── fragment_attributes/<name>/<i.j.k>          # optional, parallels vertex_fragments
│   ├── link_attributes/<name>/0/0.0.0/<i.j.k>      # optional, mirrors links
│   ├── object_index/                  # manifests (+ object_ids), or the dense
│   │                                  #   manifest_spans + manifest_blocks + object_ids
│   ├── object_attributes/<name>       # (B,) or (B, C)
│   ├── groups                         # ragged: G groups → object id lists
│   └── group_attributes/<name>        # (G,) or (G, C)
├── 1/                                 # coarser level (optional)
│   ├── zarr.json                      # bin_shape, bin_ratio, optional chunk_shape
│   ├── vertices/<i.j.k> …
│   ├── links/0/<offsets>/<i.j.k>      # intra-level edges at this level
│   ├── links/+1/<offsets>/<i.j.k>     # optional fine→coarse edges
│   └── …                              #   (cross_level_storage != "none")
└── N/
```

`links/<delta>` and `link_attributes/<name>/<delta>` are groups with one
array per offsets segment.  A record with non-zero offsets crosses a
chunk boundary; one with all-zero offsets stays inside its chunk.

Level 0 requires `vertices/`.  Every other array is optional, by
geometry type ([§12](12-geometry-types.md)) and writer choice.  A level
may set its own `bin_shape` and `bin_ratio`, `chunk_shape` and
`parent_level`, all in its `zarr_vectors` object.  The root's
`multiscales` block, `{"layout": [{"asset": "0"}, …]}`, lists the level
groups and carries no transform, since every level stores vertices in
level-0 coordinates.

## 4.2 Spatial Index Model

The spatial index is an N-dimensional regular grid, described by the
root `zarr_vectors` object:

- **Axes** (`axes`): `{name, type, unit?}` descriptors, `type` ∈
  {`space`, `time`, `channel`, `custom`}, `unit` a UDUNITS-2 name, in
  the order `time → channel → custom → space` (as in NGFF RFC 4).  At
  least two axes are `space`.  `sid_ndim`, the number of spatial-index
  dimensions, counts axes of every type.
- **Chunk grid**: `chunk_shape`, a positive number per axis, at level 0.
  A level's override MUST be a positive integer multiple of it on every
  axis, so coarser grids nest in the level-0 grid; chunk coordinates
  translate between levels by integer division.
- **Bin grid** (optional): `base_bin_shape` partitions each chunk into
  bins; `chunk_shape / base_bin_shape` MUST be an integer per axis.
  Unset means one bin per chunk.
- **Bounds**: `[min_corner, max_corner]`, the extent containing all
  data.  Root-only.
- **CRS** (optional): the root attribute `proj:projjson`, a PROJJSON
  object, from the proj convention
  ([§8.8](08-metadata.md#88-coordinate-reference-system-crs)).

A level may instead use **octree chunks**, aligned cubes of `2^k` cells
per side sized by vertex count, declared by its `octree_chunks` object
and convertible to and from the uniform grid without loss
([§3.4](03-terminology-and-concepts.md#34-indexing-terms)).

## 4.3 Vertex Model

Each `vertices/<i.j.k>` cell is a byte blob with one row per vertex in
chunk-local order.  Its element type and encoding (`raw` or `draco`) are
the `dtype` and `encoding` fields of the array's `zarr_vectors` object.

The sibling `vertex_fragments/<i.j.k>` partitions the rows into
**fragments**, each a contiguous range `[start, start+count)` or an
explicit list of rows (so fragments may share rows).  Its byte layout is
in [§7.3](07-core-arrays.md#73-vertex-fragments).  A fragment is the
unit of coarsening (mapped to a parent metavertex through `links/+1/`),
of object membership, and of re-use across objects.

Per-vertex attributes (`vertex_attributes/<name>/<i.j.k>`) are byte
blobs row-aligned to the `vertices` cell.

## 4.4 Object Model

An object (a mesh, streamline, cell, neuron) may span many fragments
across many chunks.  The level's `object_index/` group maps object IDs
to manifests; its `layout` field selects the arrays:

| `layout` | Arrays | Row `k` holds |
|----------|--------|---------------|
| `vlen_manifests_v1` | `manifests` | object `k` |
| `vlen_manifests_v2` | `manifests`, `object_ids` | object `object_ids[k]` |
| `dense_manifests_v1` | `manifest_spans`, `manifest_blocks`, `object_ids` | object `object_ids[k]` |

A reader MUST reject any other `layout` rather than guess at it.

In the vlen layouts each `manifests` cell is a list of *manifest
blocks*, each a chunk's coordinates plus a fragment reference:

| Mode | Tag | Payload | Use when |
|------|-----|---------|----------|
| 0 (single) | `uint8 0` | `int64 fragment_index` | exactly one fragment in this chunk |
| 1 (range) | `uint8 1` | `int64 start, int64 count` | a contiguous run of fragments |
| 2 (explicit) | `uint8 2` | `uint32 count`, `int64 fragment_indices[count]` | arbitrary non-contiguous fragments |

In the dense layout, row `k` of `manifest_spans` is `(start, count)`,
naming rows of `manifest_blocks`, each a chunk's coordinates and one
fragment index.

Fragment references are **chunk-local**: they index
`vertex_fragments/<chunk>` only, so chunks are written without
coordinating fragment numbering.  A fragment may belong to several
objects; the store then advertises `shared_fragments`
([§8.2](08-metadata.md#82-root-level-metadata)).  An empty manifest
(`B = 0`, or `count = 0`) is an object dropped at this level;
ID-preserving pyramids leave the hole rather than renumber.

### Cross-chunk objects

An object spanning chunks has one manifest block per chunk.  A reader
takes each block's fragments to find the object's rows, then reads the
non-zero-offset arrays under `links/0/` at those chunks for edges that
cross a boundary
([§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)).

### Identity convention

In a store with exactly one spatial chunk, `object_index_convention =
"identity"` omits `object_index/`, and `object_id == fragment_index`.
Multi-chunk stores MUST use `"standard"`.

## 4.5 Group Model

A group is a named collection of objects with no spatial extent (cell
type, brain region, tract).  Row `gid` of the ragged `groups` array
lists the group's object IDs; `group_attributes/<name>` holds per-group
data, shape `(G,)` or `(G, C)`.  Hierarchy is expressed through group
attributes (`super_type`, a parent group id); the format imposes no tree.

## 4.6 Link Model

Each level has zero or more `links/<delta>/` groups, `<delta>` being
the level difference between a record's source endpoint and the others.
Each holds one array per `<offsets>` segment, which says where the other
endpoints sit relative to the source chunk.

- `delta = 0`: same-level edges.  The all-zero offsets array
  (`links/0/0.0.0` in 3-D) holds intra-chunk records, row-aligned to
  `link_fragments`, which partitions them in the fragment-index format.
  Every other offsets array uses an inline self-describing blob and no
  sidecar ([§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)).
- `delta ≠ 0`: cross-level edges (optional,
  [§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)),
  all in the inline encoding without `link_fragments`.

A record holds `link_width` endpoints: 2 for an edge, 3 for a triangle,
1 for a bare parent reference (metanode drill-down).  `link_width` is in
the family group's `zarr_vectors` object (`kind: "links_family"`) and is
the same for every array beneath it.

Endpoint 0 is the **source**, at the owning level L in the chunk whose
cell holds the record; endpoint `k > 0` is at level `L + delta` in chunk
`source + o_k`.  Records store only chunk-local vertex indices, never a
chunk or a global vertex ID.

Under `implicit_sequential` (streamlines, polylines) the intra-chunk
array is not written: vertex `i` connects to `i + 1` within a fragment,
and only links that leave a chunk are stored.
`implicit_sequential_with_branches` stores only branch links in it
([§7.5](07-core-arrays.md#75-vertex-links),
[§12.3](12-geometry-types.md#123-skeletons)–[§12.4](12-geometry-types.md#124-streamlines--polylines)).

`link_attributes/<name>/<delta>/<offsets>/<i.j.k>` holds one row per
record of the matching link cell, in the same order; the attribute
family mirrors the link family array for array and cell for cell.

Only the all-zero offsets array at `delta = 0` has a `link_fragments`
companion.  Because that companion is keyed by chunk alone, only one
array in the store may write it.
