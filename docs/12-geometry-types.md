# 12. Geometry Types

## 12.1 Point Clouds

- **Structure**: unstructured vertices (no links).
- **Required arrays**: `vertices/`.  Optional companions:
  `vertex_fragments/` (mandatory for multi-fragment chunks),
  `vertex_attributes/<name>/`, `object_index/manifests` (when objects
  exist, e.g. nuclei centroids), `groups` (region partitions).
- **`links_convention`**: typically `"implicit_sequential"` —
  point clouds have no edges; the `links/` array group is absent.
- **Spatial Indexing**: direct spatial chunking; per-chunk
  fragmentation lets readers slice to single bins without decoding
  the whole chunk (see [§6.3](06-spatial-indexing.md#63-spatial-query-semantics)).
- **Multi-Resolution**: per-object coarsening reduces each surviving
  object's vertices to a single coarse-bin centroid metavertex per
  level.

## 12.2 Meshes

- **Types**: triangular (`link_width = 3`), quad, tetrahedral
  (`link_width = 4`), etc.
- **Storage options**:
  - **Option 1 — Draco-encoded**: `vertices/<chunk>.encoding =
    "draco"`; positions and faces co-encoded inside the Draco blob.
    `links/0/` is omitted.
  - **Option 2 — Separate positions + faces**: `vertices/<chunk>`
    raw float positions; the all-zero offsets array
    `links/0/0.0.0_0.0.0/<chunk>` carries face records
    (`link_width = 3` for triangles); `link_fragments/<chunk>`
    partitions faces by vertex fragment.
- **Cross-chunk faces**: faces with vertices in distinct chunks are
  records in the same family at a non-zero offsets segment — e.g.
  `links/0/0.0.+1_0.0.+1` for a face straddling the `+z` seam, or
  `links/0/0.0.+1_0.+1.0` for one spanning three chunks.  A face
  carries `link_width - 1 = 2` offsets joined by `_`, so a mesh's
  offsets segments are twice as long as an edge's.  (This replaced the
  dropped `cross_chunk_faces/` array in 0.5 and the separate
  cross-chunk family in 0.9.)
- **Winding order**: set `directed = true` on the family when face
  vertex order carries orientation, so no canonical sort is applied
  and no permutation index is stored.
- **Multi-Resolution**: edge-collapse decimation or per-object
  metavertex aggregation; v0.7 chunk-scale growth keeps coarse-level
  chunk counts tractable.

## 12.3 Skeletons

- **Structure**: graph of vertices and parent edges (tree).
- **Required arrays**: `vertices/`, `vertex_fragments/`.  Most
  skeletons additionally carry a `links/0/` family for parent edges.
- **`link_width` — pick 2, not 1.**  `link_width = 1` writes to the
  `self` segment and encodes a *bare* reference: one vertex index, with
  no offsets and therefore no way to name a second chunk.  It suits a
  cross-*level* parent pointer (`delta ≠ 0`), where the target chunk is
  the re-anchored source.  A parent edge that may cross a chunk
  boundary at the same level needs both endpoints located, so it needs
  `link_width = 2` with `directed = true` — parent→child order is data
  and must not be canonically sorted away.
- **`links_convention`**:
  - `"explicit"` — every parent edge materialised in the `links/0/`
    family.
  - `"implicit_sequential_with_branches"` *(recommended)* —
    sequential parents (`parent_of(i) = i - 1`) implicit; the
    intra-chunk array `links/0/0.0.0` stores only branch links and any
    links that cross fragment boundaries.  Dramatically reduces storage
    (e.g. a 10k-vertex neuron with 50 branches stores ~50 link rows).
    The convention governs only the intra-chunk array; edges that leave
    a chunk are always explicit.
- **Per-vertex attributes**: `radius`, `vertex_type` (soma / axon /
  dendrite), and so on — one row per vertex.
- **Cross-chunk parents**: parent in chunk A, child in the adjacent
  chunk one step along `+z` → one `link_width = 2` record in the
  `links/0/0.0.+1` cell at A, holding `(parent_vi, child_vi)`.  With
  `directed = true` the order is preserved verbatim and no permutation
  index is stored.
- **Multi-Resolution**: path simplification (Douglas-Peucker) keeps
  branch points and reduces straight-segment density.

## 12.4 Streamlines / Polylines

- **Structure**: ordered sequence of connected points.
- **Required arrays**: `vertices/`, `vertex_fragments/` (one
  fragment per streamline segment within each chunk).  No `links/`
  array.
- **`links_convention`**: `"implicit_sequential"` — within a
  fragment, vertex `i` connects to `i + 1`.
- **Cross-chunk continuation**: a `link_width = 2` record in the
  `links/0/<offsets>` array for the appropriate direction, written to
  chunk A's cell, connects a segment's last vertex in chunk A to the
  next segment's first vertex in the neighbouring chunk.  Set
  `directed = true` so the along-path order survives.
- **Object identity**: one object per full streamline; its
  manifest chains segments across chunks via mode-2 (explicit)
  manifest blocks if segments are shared across streamlines
  (`shared_fragments`), or mode-0 / mode-1 otherwise.
- **Multi-Resolution**: point reduction along paths; pyramid levels
  carry fewer vertices per streamline.

## 12.5 Custom Geometries

- **Extensibility**: writers may add a non-canonical entry to
  `geometry_types` — readers should treat unknown types as raw
  vertex + link arrays and skip conformance checks for that type.
- **Custom links**: arbitrary `link_width` and arbitrary record
  semantics are supported by the underlying record format.
- **Validation**: level-4 conformance checks ([§13.1](13-conformance-and-validation.md#131-conformance-levels)) apply only to
  the canonical geometry-type set; custom types bypass them.
