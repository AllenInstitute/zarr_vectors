# 12. Geometry Types

A store lists its geometries in the root object's `geometry_types`.  No
geometry has root fields of its own; they differ in `links_convention`
and in which arrays and link families a level carries.  The snippets are
`zarr_vectors` objects written by the reference implementation, cut
where marked `...` (fields: [§8](08-metadata.md#81-metadata-structure)).

## 12.1 Point Clouds

- **Arrays**: `vertices/`; optionally `vertex_fragments/` (required for
  multi-fragment chunks), `vertex_attributes/<name>/`, `object_index/`
  (when points are objects, e.g. nuclei) and `groups`.
- **`links_convention`**: irrelevant, and may be omitted (default
  `"implicit_sequential"`).  No `links/0/` family; a pyramid's
  `links/+1/` and `links/-1/` may still appear.
- **Spatial indexing**: per-bin fragments let a reader slice to single
  bins ([§6.3](06-spatial-indexing.md#63-spatial-query-semantics)).  A
  3-D level may use octree chunks.
- **Multi-resolution**: each surviving object becomes one centroid
  metavertex per coarse bin.

```javascript
{"kind": "root", "geometry_types": ["point_cloud"],
 "chunk_shape": [200.0, 200.0, 200.0], "base_bin_shape": [50.0, 50.0, 50.0], ...}
```

## 12.2 Meshes

- **Faces**: `link_width = 3` for triangles, 4 for quads, and so on;
  `links_convention = "explicit"`.
- **Volume cells**: a volume mesh stores one solid cell per record and
  declares it with the family's `element` (`tetra`, `pyramid`, `wedge`,
  `hexahedron`; [§10.6.6](10-cross-chunk-linking.md#1066-metadata)), so a
  4-wide record is a tetrahedron rather than a quad.  Several types
  share a family as `element: "mixed"`, padded to the widest.  Its
  boundary surface is the cell faces that belong to one cell only.
- **Raw** (`vertices` `encoding: "raw"`): positions in `vertices/`; faces
  inside a chunk in `links/0/0.0.0_0.0.0/`, partitioned by
  `link_fragments/`.
- **Draco** (`encoding: "draco"`): each `vertices` cell is one Draco
  bitstream holding positions and intra-chunk faces; there is no
  `links/0/0.0.0_0.0.0/`.
- **Cross-chunk faces**: records at a non-zero offsets segment, two
  offsets joined by `_` — `0.0.+1_0.0.+1` straddles the `+z` seam,
  `0.0.+1_0.+1.0` spans three chunks.
- **Winding** MUST survive: either `directed = true` (no sort, no
  permutation index) or an undirected canonical family whose non-intra
  records carry `perm_idx`
  ([§10.6.5](10-cross-chunk-linking.md#1065-whether-a-permutation-index-is-present)).
- **Multi-resolution**: decimation or per-object metavertices, with
  chunk-scale growth at coarse levels.  A raw level may set
  `link_fragments_aligned: true` when link fragment `k` holds exactly the
  faces whose first vertex is in vertex fragment `k`.
- **Volume pyramids**: a coarse level of a volume mesh has its own
  cells; fine cells are not carried down, since a fine cell is far
  smaller than a coarse bin.  Two ways to make them:
  - *On the bin lattice* (`coarsening_method: "per_object"`): for each
    object, every 2 × 2 × 2 block of bins the object fills becomes one
    `hexahedron` (from hexahedra) or six `tetra` (from other elements)
    joining those bins' metavertices.  Each metavertex on the coarse
    boundary moves to the centroid of the fine boundary vertices in its
    bin, which keeps faces of the volume in place (edges and corners
    round off by up to a bin).  A move that would invert a cell is
    undone; cells still inverted are dropped.  The volume is filled
    without gaps.
  - *Decimated elsewhere* (`coarsening_method: "manual"`): any valid
    mesh of the same objects, written as the level.  Its `parent_level`,
    `bin_shape` and `bin_ratio` are recorded as for a built level, and
    `links/±delta` MAY link each parent vertex to the nearest vertex of
    the same object.

  Either way the levels are joined by object ids and cross-level vertex
  links ([§10.8](10-cross-chunk-linking.md#108-cross-pyramid-level-links--optional)),
  not by cells: a cell's vertices are all on one level.
- **Surface pyramids** (`per_object`): vertex clustering.  Each face is
  re-pointed at its vertices' bin metavertices; faces left with a
  repeated metavertex collapse, and faces over the same metavertices are
  kept once.
- **Per-face and per-cell attributes** come down with them: a coarse
  face takes the fine faces that clustered onto it, a coarse cell the
  fine cells whose centroid lies in its block.  Floating-point values
  are averaged, weighted by area or volume; integer and boolean values
  take the value with the most area or volume.

```javascript
{"kind": "links_family", "level_delta": 0, "link_width": 3, "directed": false,
 "store": "canonical", "sid_ndim": 3, "num_links": 800, "num_physical_records": 800}
```

A tetrahedral volume mesh:

```javascript
{"kind": "links_family", "level_delta": 0, "link_width": 4, "directed": false,
 "store": "canonical", "sid_ndim": 3, "element": "tetra",
 "num_links": 162, "num_physical_records": 162}
```

## 12.3 Skeletons

- **Arrays**: `vertices/`, `vertex_fragments/`, and usually a `links/0/`
  family of parent edges; per-vertex `radius`, `vertex_type` and so on.
- **`link_width = 2`**, not 1.  `link_width = 1` writes the `self`
  segment, a bare reference with no offsets, so it cannot name a second
  chunk; it suits a cross-level parent pointer (`delta ≠ 0`).  A parent
  edge that may cross a chunk boundary needs both endpoints located.
- **Parent→child order** MUST survive: `directed = true` stores it
  verbatim; an undirected canonical family adds `perm_idx` to each
  cross-chunk record.
- **`links_convention`**: `"explicit"` writes every parent edge;
  `"implicit_sequential_with_branches"` *(recommended)* makes
  `parent_of(i) = i - 1` implicit, so `links/0/0.0.0` holds only branch
  links and links across fragment boundaries (~50 rows for a 10k-vertex
  neuron with 50 branches).  Edges that leave a chunk are always written.
- **Cross-chunk parent**: parent in chunk A, child one step along `+z` →
  one record `(parent_vi, child_vi)` in the `links/0/0.0.+1` cell at A.
- **Multi-resolution**: path simplification keeping branch points.

A skeleton written whole has an undirected family with `perm_idx` on its
cross-chunk arrays; one streamed chunk by chunk has `"directed": true`:

```javascript
{"kind": "root", "geometry_types": ["skeleton"],
 "links_convention": "implicit_sequential_with_branches", ...}
{"kind": "links", "dtype": "int64", "offsets": [[0, 0, 1]], "has_perm": true,
 "link_width": 2, "level_delta": 0, "nonempty_chunks": [...]}
```

## 12.4 Streamlines / Polylines

- **Arrays**: `vertices/`, `vertex_fragments/` (one fragment per segment
  per chunk).  No intra-chunk link array.  `line` is the two-vertex case;
  `polyline` and `streamline` share one layout.
- **`links_convention`**: `"implicit_sequential"` — vertex `i` connects
  to `i + 1` within a fragment.
- **Cross-chunk continuation**: a `link_width = 2` record in
  `links/0/<offsets>`, in chunk A's cell, joins a segment's last vertex in
  A to the next segment's first vertex.  Order MUST survive, as for
  skeletons.  A store whose streamlines each sit in one chunk has no
  `links/` group.
- **Objects**: one per streamline; mode-2 manifest blocks chain shared
  segments (`shared_fragments`), mode 0 / 1 otherwise.
- **Multi-resolution**: fewer points per streamline at coarser levels.

```javascript
{"kind": "root", "geometry_types": ["streamline"], "links_convention": "implicit_sequential",
 "cross_level_storage": "implicit",
 "format_capabilities": ["preserved_object_ids", "shared_fragments", "multiscale_links"], ...}
```

## 12.5 Custom Geometries

Writers may add a non-canonical entry to `geometry_types`; readers
should treat unknown types as raw vertex and link arrays.  A custom
geometry uses the existing node kinds
([§3.7](03-terminology-and-concepts.md#37-metadata-terms)), since a
reader SHOULD reject a `kind` it does not recognise.  Any `link_width`
and record semantics are allowed.  Level-4 checks
([§13.1](13-conformance-and-validation.md#131-conformance-levels)) apply
only to the canonical types.
