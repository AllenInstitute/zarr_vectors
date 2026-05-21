# 12. Geometry Types

## 12.1 Point Clouds

- **Structure**: unstructured vertices (no links).
- **Required arrays**: `vertices/`.  Optional companions:
  `vertex_fragments/` (mandatory for multi-fragment chunks),
  `vertex_attributes/<name>/`, `object_index/data` (when objects
  exist, e.g. nuclei centroids), `groups/data` (region partitions).
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
    raw float positions; `links/0/<chunk>` carries face records
    (`link_width = 3` for triangles); `link_fragments/<chunk>`
    partitions faces by vertex fragment.
- **Cross-chunk faces**: faces with vertices in distinct chunks live
  in `cross_chunk_links/0/k2` or `cross_chunk_links/0/k3` with
  `link_width = 3` (replacing the dropped `cross_chunk_faces/` array
  from pre-0.5).
- **Multi-Resolution**: edge-collapse decimation or per-object
  metavertex aggregation; v0.7 chunk-scale growth keeps coarse-level
  chunk counts tractable.

## 12.3 Skeletons

- **Structure**: graph of vertices and parent edges (tree).
- **Required arrays**: `vertices/`, `vertex_fragments/`.  Most
  skeletons additionally carry `links/0/` (parent edges,
  `link_width = 1`).
- **`links_convention`**:
  - `"explicit"` — every parent edge materialised in
    `links/0/<chunk>`.
  - `"implicit_sequential_with_branches"` *(recommended)* —
    sequential parents (`parent_of(i) = i - 1`) implicit; the
    `links/0/<chunk>` array stores only branch links and any links
    that cross fragment boundaries.  Dramatically reduces storage
    (e.g. a 10k-vertex neuron with 50 branches stores ~50 link rows).
- **Per-vertex attributes**: `radius`, `vertex_type` (soma / axon /
  dendrite), and so on — one row per vertex.
- **Cross-chunk parents**: parent in chunk A, child in chunk B →
  one record in the `cross_chunk_links/0/k2` cell at coord
  `(min(A,B)-origin) ⧺ (max(A,B)-origin)` with endpoints
  `((A, parent_vi), (B, child_vi))` (the `ci` permutation encodes
  parent vs child).
- **Multi-Resolution**: path simplification (Douglas-Peucker) keeps
  branch points and reduces straight-segment density.

## 12.4 Streamlines / Polylines

- **Structure**: ordered sequence of connected points.
- **Required arrays**: `vertices/`, `vertex_fragments/` (one
  fragment per streamline segment within each chunk).  No `links/`
  array.
- **`links_convention`**: `"implicit_sequential"` — within a
  fragment, vertex `i` connects to `i + 1`.
- **Cross-chunk continuation**: `cross_chunk_links/0/k2` cells with
  `link_width = 2` records connect a segment's last vertex in chunk
  A to the next segment's first vertex in chunk B.
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
