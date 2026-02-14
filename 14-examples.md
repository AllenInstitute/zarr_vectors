# 14. Examples

This section gives concrete store layouts and use-case details for the data model. Directory trees show Zarr group/array structure; chunk keys (e.g. `0.0.0`) follow a spatial chunk grid.

---

## 14.1 Mouse Brain Nuclei: Point Cloud with Multi-Resolution and Regions

**Use case**: Single-cell positions from a cleared mouse brain (e.g. cell nuclei centroids). Each nucleus is an object with a volume attribute. Nuclei are grouped by brain region (cortex, hippocampus, thalamus, etc.). Multi-resolution supports coarse-to-fine visualization.

**Directory structure**:

```
mouse_brain_nuclei.zarr/
├── .zgroup
├── .zattrs                    # spatial_index_dims, chunk_shape, CRS
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray             # XYZ positions, SID chunk-aligned
│   │   ├── 0.0.0
│   │   ├── 0.0.1
│   │   ├── 0.1.0
│   │   └── ...
│   ├── vertex_group_offsets/
│   │   ├── .zarray             # K×2 (link_offset unused); one vertex group per nucleus
│   │   ├── 0.0.0
│   │   └── ...
│   ├── attributes/
│   │   └── volume/
│   │       ├── .zarray         # µm³ per nucleus, SID chunk-aligned
│   │       ├── 0.0.0
│   │       └── ...
│   ├── object_index/
│   │   ├── .zarray             # one object per nucleus; maps object_id → (chunk, vertex_group_index)
│   │   └── 0
│   ├── groupings/              # G groups, one per brain region
│   │   ├── .zarray             # G×ragged: [[n0,n1,...], [n2,n3,...], ...] nucleus indices per region
│   │   └── 0
│   ├── groupings_attributes/
│   │   └── region_name/
│   │       └── .zarray         # G×C: "cortex", "hippocampus", "thalamus", etc.
│   └── .zgroup
├── resolution_1/               # downsampled (e.g. every 2nd nucleus, or spatially decimated)
│   ├── vertices/
│   ├── vertex_group_offsets/
│   ├── attributes/
│   │   └── volume/
│   ├── object_index/
│   ├── groupings/
│   ├── groupings_attributes/
│   └── .zgroup
├── resolution_2/               # further downsampled for coarse preview
│   └── ...
└── metadata.json               # bounds, units (µm), downsampling_factor per level
```

**Notes**:
- **Objects**: one object per nucleus; each vertex group = one nucleus (single point).
- **Object index**: required (multi-chunk); maps object_id → (chunk, vertex_group_index).
- **Vertex attributes**: `volume` (µm³) per nucleus.
- **Groupings**: one group per brain region; each group = list of nucleus (object) indices.
- **Group attributes**: `region_name` (e.g. "cortex", "hippocampus", "thalamus").
- **Multi-resolution**: resolution_0 = full nuclei; resolution_1, resolution_2 = spatially downsampled point clouds for coarse rendering.
- Access: spatial bounding-box → chunk keys → vertices + volume; by region → groupings → object_index → (chunk, vertex_group_index) → vertices; coarse preview → resolution_2.

---

## 14.2 Mesh with Multi-Resolution

**Use case**: Surface mesh of a Drosophila brain compartment (e.g. central complex), triangular mesh, Draco-encoded, two resolution levels.

**Directory structure**:

```
drosophila_central_complex_mesh.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims: [x,y,z], geometry_type: mesh
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray
│   │   ├── 0.0.0               # Draco-compressed vertex positions for chunk (0,0,0)
│   │   └── ...
│   ├── vertex_group_offsets/
│   │   ├── .zarray              # K×2 byte offsets per chunk
│   │   ├── 0.0.0                # [[v_off_0, l_off_0], [v_off_1, l_off_1], ...]
│   │   └── ...
│   ├── links/
│   │   ├── .zarray              # M×3 (triangle faces) per chunk
│   │   ├── 0.0.0
│   │   └── ...
│   ├── object_index/
│   │   ├── .zarray              # one mesh object → (chunk_coords, vertex_group_index) per fragment
│   │   └── 0                    # object 0 manifest: e.g. [(0,0,0,0), (0,0,1,0)]
│   └── .zgroup
├── resolution_1/               # downsampled mesh, larger spatial chunks
│   ├── vertices/
│   ├── vertex_group_offsets/
│   ├── links/
│   ├── object_index/
│   └── .zgroup
└── metadata.json               # downsampling_factor: 2, CRS, units
```

**Notes**:
- `vertex_group_offsets`: byte ranges for vertices and links per vertex group (Draco per-group).
- `links`: L=3 for triangle faces; layout M×L per chunk.
- Access: read `object_index` for object 0 → list of (chunk, vertex_group_index); use `vertex_group_offsets` for range reads into `vertices` and `links` chunks.

---

## 14.3 Skeleton with Cross-Chunk Objects

**Use case**: Neuronal skeletons (e.g. mouse cortex) in a large volume; each neuron is one object, may span many spatial chunks; parent links for trees.

**Directory structure**:

```
mouse_cortex_skeletons.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims, geometry_type: skeleton, links_convention: "implicit_sequential_with_branches"
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray
│   │   ├── 2.1.0               # chunk (2,1,0): many vertex groups (many neurons)
│   │   ├── 2.1.1
│   │   ├── 3.0.0
│   │   └── ...
│   ├── vertex_group_offsets/
│   │   ├── .zarray              # K×2: [vertex_offset, link_offset] per vertex group
│   │   ├── 2.1.0
│   │   └── ...
│   ├── links/
│   │   ├── .zarray              # M×2 (child, parent): only branch links (parent ≠ child−1); sequential links implicit
│   │   ├── 2.1.0
│   │   └── ...
│   ├── attributes/              # SID chunk-aligned with vertices
│   │   ├── vertex_type/
│   │   │   ├── .zarray          # 0=soma, 1=axon, 2=dendrite per vertex
│   │   │   ├── 2.1.0
│   │   │   ├── 2.1.1
│   │   │   └── ...
│   │   └── radius/
│   │       ├── .zarray          # µm radius per vertex
│   │       ├── 2.1.0
│   │       ├── 2.1.1
│   │       └── ...
│   ├── object_index/
│   │   ├ .zarray                # O objects, ragged (chunk_coords, vertex_group_index)[]
│   │   ├── 0                    # chunk containing object_ids 0..9999
│   │   ├── 1                    # object_ids 10000..19999
│   │   └── ...
│   ├── cross_chunk_links/       # links that cross chunk boundaries
│   │   ├── .zarray              # (link_count, vertex_ref_dim)
│   │   └── 0
│   └── .zgroup
└── metadata.json               # cross_chunk_strategy: explicit_links, CRS
```

**Notes**:
- **Implicit links** (`links_convention: "implicit_sequential_with_branches"`): most skeleton nodes have parent = i−1 (sequential). The `links` array stores **only branch links**—(child, parent) where parent ≠ child−1—plus any links connecting vertex groups. Sequential links are implicit. This dramatically reduces storage (e.g. a 10k-node neuron with 50 branches stores ~50 links instead of ~10k).
- **Vertex attributes**: `vertex_type` (0=soma, 1=axon, 2=dendrite) and `radius` (µm) per skeleton node; aligned to vertices, same chunk grid.
- Object index: e.g. neuron 42 → `[(2,1,0,3), (2,1,0,7), (2,1,1,0)]` (vertex groups in chunks 2.1.0 and 2.1.1).
- Per chunk: `vertex_group_offsets[k]` gives byte range for that vertex group in `vertices` and `links`; client can range-read or decode only those ranges.
- Cross-chunk links: parent in chunk A, child in chunk B → one row in `cross_chunk_links` with (chunk_A + vertex_offset, chunk_B + vertex_offset).

---

## 14.4 2D Polylines with Attributes

**Use case**: Blood vessel centerlines (polylines) in a 2D slice with radius and type per vertex.

**Directory structure**:

```
retina_vessels_2d.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims: [x, y], chunk_shape: [512, 512]
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray
│   │   ├── 0.0                 # XY positions, ragged (many polylines in chunk)
│   │   ├── 0.1
│   │   └── ...
│   ├── vertex_group_offsets/
│   │   ├── .zarray              # K×2
│   │   └── 0.0
│   ├── links/                  # optional: L=1 parent for ordered polyline
│   ├── attributes/
│   │   ├── radius/
│   │   │   ├── .zarray          # (SID..., channel, ragged), chunked
│   │   │   └── 0.0.0            # channel 0 = radius, aligned to vertices
│   │   └── vessel_type/
│   │       ├── .zarray          # e.g. uint8: 0=artery, 1=vein, 2=capillary
│   │       └── 0.0.0
│   ├── object_index/
│   │   ├── .zarray
│   │   └── 0
│   └── .zgroup
└── metadata.json
```

**Notes**:
- One object = one polyline (vessel). Object index maps vessel ID → (chunk, vertex_group_index).
- Attributes: radius and vessel_type aligned to vertices; chunking on channel allows reading only radius or only vessel_type.

---

## 14.5 Time-Series Point Cloud (XYZT)

**Use case**: Tracking spots (e.g. particles or cells) in 3D over time; points are (x, y, z, t).

**Directory structure**:

```
cell_tracks_xyzt.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims: [x, y, z, t], chunk_shape: [128,128,64,16]
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray              # ragged, 4D chunk grid
│   │   ├── 0.0.0.0             # (x,y,z,t) chunk
│   │   ├── 0.0.0.1
│   │   └── ...
│   ├── object_index/            # one object = one track (points at t0..tN)
│   │   ├── .zarray
│   │   └── 0
│   └── .zgroup
└── metadata.json               # time_units: frames, spatial_units: µm
```

**Notes**:
- Chunking in t: e.g. 16 frames per chunk; time-range queries read only the relevant t-chunks.
- Object index: track ID → list of (chunk_coords, vertex_group_index) across (x,y,z,t) chunks.

---

## 14.6 Multiplexed Fish: Gene Measurements and Cell Types

**Use case**: Multiplexed FISH (e.g. MERFISH / seqFISH). Each vertex is a cell centroid; vertex attributes are gene counts (many channels) and cell type; objects are cells; groups are cell-type groups (and optionally super-groups).

**Directory structure**:

```
merfish_celltype.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims, geometry_type
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray              # XY (or XYZ) cell positions, ragged per spatial chunk
│   │   ├── 0.0
│   │   ├── 0.1
│   │   ├── 1.0
│   │   └── ...
│   ├── vertex_group_offsets/   # optional; K×2 if used for range reads
│   ├── object_index/
│   │   ├── .zarray             # one object per cell; maps object_id → (chunk, vertex_group_index)
│   │   └── 0
│   ├── attributes/
│   │   ├── gene_expression/     # channel_dim = num_genes, e.g. 500–20k
│   │   │   ├── .zarray          # (SID..., channel, ragged), chunked by channel
│   │   │   ├── 0.0.0           # genes 0..255 in chunk (0,0)
│   │   │   ├── 0.0.1           # genes 256..511
│   │   │   └── ...
│   │   └── cell_type/
│   │       ├── .zarray          # (SID..., 1, ragged), uint16 or string code
│   │       └── 0.0.0            # cell_type id per vertex
│   ├── groupings/               # G groups (e.g. cell-type clusters)
│   │   ├── .zarray              # G×ragged: list of object indices per group
│   │   └── 0
│   ├── groupings_attributes/
│   │   ├── cell_type_name/
│   │   │   └── .zarray          # G×C: e.g. "glutamatergic", "GABAergic", "ependymal"
│   │   └── super_type/
│   │       └── .zarray          # G×1: super-group (e.g. "neuron", "glia")
│   └── .zgroup
└── metadata.json                # gene names list, cell_type code table, CRS
```

**Semantics**:
- **Vertices**: one vertex per cell; position = centroid (x, y) or (x, y, z).
- **Objects**: one object per cell (single-vertex “object”); Object index maps object_id → (chunk, vertex_group_index); required for multi-chunk stores.
- **Vertex attributes**:  
  - `gene_expression`: many channels (genes); chunking by channel allows reading a subset of genes.  
  - `cell_type`: single channel (cell type ID or code).
- **Groupings**: group g = set of object (cell) indices; e.g. group 0 = all cells of type “glutamatergic”, group 1 = “GABAergic”.
- **Group attributes**: `cell_type_name`, `super_type` (super-groups) for each group.

**Access patterns**:
- All cells in a spatial cutout: bounding box → chunk keys → read `vertices` (+ optional `vertex_group_offsets`).
- All cells of one type: read `groupings` → object indices for that group → object_index → (chunk, vertex_group_index) → read vertices (and optionally attributes) for those groups.
- One gene or a subset of genes: read only the `gene_expression` chunks for the desired channel range.
- Super-type (e.g. all neurons): use `groupings_attributes/super_type` to select groups, then same as “all cells of one type”.

---

## 14.7 Individual Gene Detections in mFISH (Spots → Cells)

**Use case**: Raw multiplexed FISH (mFISH) where each vertex is an individual transcript detection (spot). Spots are agglomerated—e.g. by segmentation or clustering—into objects that represent cells. Many spots (vertices) per cell (object).

**Directory structure**:

```
mfish_spots_cells.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims: [x, y, z], geometry_type: point_cloud
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray              # XYZ position of each transcript spot, SID chunk-aligned
│   │   ├── 0.0.0               # chunk (0,0,0)
│   │   ├── 0.0.1
│   │   ├── 0.1.0
│   │   ├── 0.1.1
│   │   ├── 1.0.0
│   │   └── ...
│   ├── vertex_group_offsets/   # same chunk grid as vertices
│   │   ├── .zarray              # K×2: [vertex_offset, link_offset] per vertex group
│   │   ├── 0.0.0
│   │   ├── 0.0.1
│   │   ├── 0.1.0
│   │   ├── 0.1.1
│   │   ├── 1.0.0
│   │   └── ...
│   ├── attributes/             # same SID chunk grid as vertices (channel dim may add more)
│   │   ├── gene_id/
│   │   │   ├── .zarray          # which gene (0..num_genes-1) per spot, SID chunk-aligned
│   │   │   ├── 0.0.0
│   │   │   ├── 0.0.1
│   │   │   ├── 0.1.0
│   │   │   ├── 0.1.1
│   │   │   └── ...
│   │   ├── intensity/
│   │   │   ├── .zarray          # fluorescence intensity per spot
│   │   │   ├── 0.0.0
│   │   │   ├── 0.0.1
│   │   │   ├── 0.1.0
│   │   │   └── ...
│   │   └── round/
│   │       ├── .zarray          # imaging round (0..num_rounds-1) in which spot was detected
│   │       ├── 0.0.0
│   │       ├── 0.0.1
│   │       ├── 0.1.0
│   │       └── ...
│   ├── object_index/
│   │   ├── .zarray              # one object per cell; each cell = multiple (chunk, vertex_group_index)
│   │   └── 0
│   ├── object_attributes/
│   │   ├── cell_type/
│   │   │   └── .zarray          # O×1: cell type id per object (cell)
│   │   └── centroid/
│   │       └── .zarray          # O×3: computed centroid (x,y,z) per cell
│   ├── groupings/               # optional: cells grouped by type
│   │   └── .zarray
│   └── .zgroup
└── metadata.json                # gene_id → name mapping, CRS, units
```

**Semantics**:
- **Vertices**: one vertex per transcript spot; position = (x, y, z) of detection.
- **Objects**: one object per cell; each cell comprises many spots (vertices) across one or more vertex groups.
- **Vertex attributes**: `gene_id` (which transcript), `intensity` (per-spot signal), `round` (imaging round in which the spot was detected, for multi-round FISH).
- **Object attributes**: `cell_type`, `centroid` (or other per-cell summaries).
- **Object index**: cell_id → `[(chunk, vertex_group_index), ...]`; a cell may span multiple vertex groups (e.g. when it crosses chunk boundaries) or occupy one vertex group within a chunk.

**Access patterns**:
- All spots in a spatial cutout: bounding box → chunk keys → read `vertices` (and attributes).
- All spots belonging to one cell: object_index[cell_id] → (chunk, vertex_group_index) list → use `vertex_group_offsets` to range-read vertices and attributes for those groups.
- All cells of one type: read `object_attributes/cell_type`, filter object IDs → then fetch spots for those cells via object_index.
- Spots for a single gene: read `attributes/gene_id`, filter by gene (or chunk by gene if structured that way).
- Spots from a specific imaging round: read `attributes/round`, filter by round (e.g. for QC or round-specific analysis).

---

## 14.8 Simple DTI: Small Volume (TRX-Aligned)

**Use case**: Small DTI tractography dataset (e.g. single subject, cropped region) where spatial chunking is unnecessary. The store collapses to a single spatial bin; the layout closely aligns with the [TRX format](https://tee-ar-ex.github.io/trx-python/stable/trx_specifications.html) to simplify conversion and interoperability.

**TRX alignment** (mapping to zarr_vectors):

| TRX | zarr_vectors |
|-----|--------------|
| `positions` (NB_VERTICES×3) | `vertices` (single chunk) |
| `offsets` (streamline start indices) | `groupings` or `vertex_group_offsets` (position indices) |
| `dpv` (data_per_vertex) | `attributes` (fa, color) |
| `dps` (data_per_streamline) | `object_attributes` (algo, clusters_QB, commit_weights) |
| `groups` (AF_L.uint32, etc.) | `groupings` (ragged list of object indices per tract) |
| `dpg` (data_per_group) | `groupings_attributes` (mean_fa, volume, shuffle_colors) |
| `header.json` | `.zattrs` / `metadata.json` (VOXEL_TO_RASMM, DIMENSIONS) |

**Directory structure**:

```
dti_small.trx.zarr/
├── .zgroup
├── .zattrs                     # VOXEL_TO_RASMM, DIMENSIONS, NB_STREAMLINES, NB_VERTICES, CRS, object_index_convention: "identity", links_convention: "implicit_sequential"
├── resolution_0/
│   ├── vertices/
│   │   ├── .zarray              # (NB_VERTICES, 3) float16, single chunk
│   │   └── 0                   # all positions in one chunk (no spatial subdivision)
│   ├── groupings/
│   │   ├── .zarray              # TRX offsets: [0, n0, n0+n1, ...] = start index per streamline
│   │   └── 0
│   ├── attributes/              # dpv
│   │   ├── fa/
│   │   │   └── 0
│   │   └── color/
│   │       └── 0               # (NB_VERTICES, 3) uint8, or color_x, color_y, color_z
│   ├── object_attributes/       # dps
│   │   ├── algo/
│   │   │   └── 0
│   │   ├── clusters_QB/
│   │   │   └── 0
│   │   └── commit_weights/
│   │       └── 0
│   ├── groupings/               # TRX groups: tract = list of streamline (object) indices
│   │   ├── .zarray              # G×ragged: [[s0,s1,...], [s2,s3,...], ...] per tract
│   │   └── 0
│   └── groupings_attributes/    # dpg: tract_name maps to TRX group folder names (AF_L, AF_R, etc.)
│       ├── tract_name/
│       │   └── 0
│       ├── mean_fa/
│       │   └── 0               # G×1
│       ├── shuffle_colors/
│       │   └── 0               # G×3
│       └── volume/
│           └── 0               # G×1 uint32
└── metadata.json
```

**Notes**:
- **Single chunk**: SID collapses to one bin; `vertices` and `groupings` have a single chunk key (`0` or `0.0.0`).
- **No vertex_group_offsets** (optional): TRX uses position-index offsets; `groupings` holds `[0, n0, n0+n1, ...]` so streamline k spans vertices `[offsets[k], offsets[k+1])`.
- **Implicit links** (`links_convention: "implicit_sequential"`): streamlines are ordered point sequences; within each vertex group, vertex i connects to i+1. No branching → the `links` array is **omitted** entirely.
- **Object index**: implicit (`object_index_convention: "identity"`)—**single-chunk only**; object_id = vertex_group_index; array omitted.
- Per §1 and HUMAN_TEXT_DESIGN: when spatial indexing is collapsed to a single dimension, the format closely aligns with TRX.

---

## 14.9 DTI Streamlines: Large Volume with Chunking and Segment Reuse

**Use case**: Diffusion tensor imaging (DTI) tractography streamlines from a large brain volume. Each streamline is an ordered sequence of 3D points (no explicit links—connectivity is implicit by vertex order). Streamlines are grouped into tracts (e.g. arcuate fasciculus, corticospinal tract). Tracts have names and attributes. The format supports **segment reuse**: streamline segments within a chunk are stored once and can be referenced by multiple objects; the object_index builds full streamlines from ordered (chunk, vertex_group_index) references; cross_chunk_links connect segments across chunk boundaries. Multiple resolution levels store downsampled streamlines (fewer points per streamline at lower resolution).

**Directory structure**:

```
dti_tracts.zarr/
├── .zgroup
├── .zattrs                     # spatial_index_dims, geometry_type: streamline, links_convention: "implicit_sequential"
├── resolution_0/               # full resolution (dense points along each streamline)
│   ├── vertices/
│   │   ├── .zarray              # XYZ positions, SID chunk-aligned
│   │   ├── 0.0.0
│   │   ├── 0.0.1
│   │   ├── 0.1.0
│   │   └── ...
│   ├── vertex_group_offsets/    # K×1 or K×2 (link_offset unused for streamlines)
│   │   ├── .zarray              # byte offsets per streamline vertex group
│   │   ├── 0.0.0
│   │   ├── 0.0.1
│   │   └── ...
│   ├── object_index/
│   │   ├── .zarray              # one object per streamline; may span chunks
│   │   └── 0
│   ├── object_attributes/       # O×C: per-streamline metadata
│   │   └── termination/
│   │       └── .zarray          # O×2: channel 0 = source, channel 1 = sink (region id/name)
│   ├── groupings/               # G tracts, each = list of streamline (object) indices
│   │   ├── .zarray              # G×ragged: [[s0,s1,...], [s2,s3,...], ...]
│   │   └── 0
│   ├── groupings_attributes/
│   │   └── tract_name/
│   │       └── .zarray          # G×C: "arcuate_fasciculus", "corticospinal", etc.
│   ├── cross_chunk_links/
│   │   ├── .zarray              # (link_count, vertex_ref_dim): (chunk_coords + vertex_offset) pairs
│   │   └── 0                   # links from segment end in chunk A to segment start in chunk B
│   └── .zgroup
├── resolution_1/               # downsampled: fewer points per streamline
│   ├── vertices/
│   ├── vertex_group_offsets/
│   ├── object_index/
│   ├── object_attributes/
│   ├── groupings/               # same tract membership (object ids preserved)
│   ├── groupings_attributes/
│   ├── cross_chunk_links/
│   └── .zgroup
├── resolution_2/               # further downsampled for coarse visualization
│   ├── vertices/
│   ├── vertex_group_offsets/
│   ├── object_index/
│   ├── object_attributes/
│   ├── groupings/
│   ├── groupings_attributes/
│   ├── cross_chunk_links/
│   └── .zgroup
└── metadata.json               # downsampling_factor per level, CRS, voxel size (mm)
```

**Semantics**:
- **Vertices**: ordered points along streamline segments; each vertex group = one segment within a spatial chunk. Segments are stored once per chunk and can be **reused** by multiple objects.
- **Objects**: one object per full streamline (tract). An object is defined by an ordered list of `(chunk, vertex_group_index)` references. The same `(chunk, vertex_group_index)` can appear in multiple objects—streamlines that share a path through a chunk reference the same segment, avoiding duplication.
- **Object index**: each object’s manifest is an ordered sequence of `(chunk, vertex_group_index)`; concatenating these segments (in order) gives the full streamline. Objects span the volume by chaining segments across chunks.
- **cross_chunk_links**: explicit links from segment end in chunk A to segment start in chunk B. Format: `(chunk_coords_A + vertex_offset, chunk_coords_B + vertex_offset)`. Enables traversal of the full path when reconstructing an object from its segments. Multiple objects may share the same cross-chunk link when they follow the same path across a boundary.
- **Implicit links** (`links_convention: "implicit_sequential"`): within a segment, connectivity is implicit (point i connects to i+1). No links array; cross_chunk_links handles between-segment connectivity.
- **Groupings**: tract g = set of streamline (object) indices; e.g. group 0 = arcuate fasciculus streamlines.
- **Object attributes**: `termination` — O×2 array (channel 0 = source, channel 1 = sink); region id/name for each streamline’s endpoints; enables connectivity queries (e.g. "streamlines from A to B") without loading geometry.
- **Group attributes**: `tract_name`.
- **Multi-resolution**: resolution_0 = full points; resolution_1, resolution_2 = progressively fewer points per streamline (point reduction along paths). Object index and groupings preserve streamline/tract identity across levels.

**Access patterns**:
- All streamlines in a spatial cutout: bounding box → chunk keys → read `vertices` via `vertex_group_offsets`.
- All streamlines in a tract: read `groupings` → object indices for tract g → `object_index` → (chunk, vertex_group_index) list → read vertices.
- Tract by name: read `groupings_attributes/tract_name`, find g with matching name → same as above.
- Connectivity query (streamlines A→B): read `object_attributes/termination` → filter object IDs where channel 0 (source)=A and channel 1 (sink)=B → fetch vertices for those streamlines via `object_index`.
- Coarse preview: read `resolution_2` vertices for fast rendering; drill down to `resolution_0` for detail.
- Full object reconstruction: object_index[obj_id] → ordered (chunk, vertex_group_index) list → read vertices for each segment via vertex_group_offsets → use cross_chunk_links to connect segments across chunk boundaries.

---

## 14.10 Large-Scale Distributed Write

**Use case**: Concurrent writers append skeleton fragments to the same store (e.g. many workers tracing neurons in different tiles).

**Considerations** (no separate directory tree; same layout as 14.3):

- Chunk keys are assigned by spatial chunk; writers writing different chunks avoid conflict.
- Object index: append-only per object; writers may write different object_index chunks (chunked by object_id) or coordinate via external locking.
- `vertex_group_offsets`: each spatial chunk is written by one writer (or coordinated); K×2 updated when appending vertex groups.
- Metadata: atomicity of `.zarray` / `.zattrs` updates as per Zarr and backend (e.g. conditional writes on object stores).

---

## Summary

| Example              | SID    | Objects        | Links | Vertex attributes     | Groupings      |
|----------------------|--------|----------------|-------|------------------------|----------------|
| 14.1 Mouse nuclei    | XYZ    | nuclei         | —     | volume                 | region_name    |
| 14.2 Mesh            | XYZ    | mesh fragments | L=3   | —                      | —              |
| 14.3 Skeletons       | XYZ    | neurons        | L=1/2 | vertex_type, radius     | —              |
| 14.4 Polylines       | XY     | vessels        | opt.  | radius, vessel_type    | —              |
| 14.5 Tracks          | XYZT   | tracks         | —     | —                      | —              |
| 14.6 Multiplexed fish| XY     | cells          | —     | gene_expression, cell_type | cell_type_name, super_type |
| 14.7 mFISH spots→cells | XYZ  | cells (many spots each) | — | gene_id, intensity, round | — |
| 14.8 Simple DTI (TRX)  | —    | streamlines     | —     | fa, color (obj: algo, clusters) | mean_fa, volume |
| 14.9 DTI streamlines   | XYZ  | streamlines     | —     | — (obj: termination) | tract_name |
| 14.10 Distributed write | —   | (same as 14.3) | —     | —                      | —              |
