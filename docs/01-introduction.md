# 1. Introduction

This document specifies Zarr Vectors format **0.10.0**.  Its metadata
layer is the registered
[Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors)
v0.1.0 ([§1.4.7](#147-zarr-conventions-the-metadata-layer)); this
document defines the byte layouts inside the cells.  Sections 1–14
describe 0.10.0 only; earlier versions are in
[Appendix J](15-appendices.md#appendix-j-change-log).

## 1.1 Background and Motivation

Point clouds from LiDAR and microscopy, meshes from 3D reconstruction,
skeletons from connectomics and streamlines from tractography now reach
millions to trillions of objects.  Such data must live in cloud object
stores, answer spatial queries without loading everything, accept
incremental and concurrent writes, offer levels of detail, and carry
annotations on points, objects and groups.

Single-file formats (LAS, PLY, OBJ, STL) have no spatial index,
multi-resolution or distributed writes.  3D Tiles and I3S target
streaming visualization rather than analysis.  Zarr Vectors is a
cloud-native, spatially indexed format on Zarr v3 with uncoordinated
writes, native pyramids, and fragment re-use across objects and levels.

## 1.2 Purpose and Goals

The format is designed to:

1. Scale from thousands to trillions of vector objects
2. Answer spatial queries and load selectively from cloud storage
3. Let processes read and write without coordination
4. Provide level-of-detail pyramids
5. Carry metadata at point, object and group level
6. Cover point clouds, meshes, skeletons, graphs and streamlines, with custom types
7. Interoperate with existing formats and tools

## 1.3 Design Principles

### 1.3.1 Cloud-Native Architecture
Zarr v3 is the storage layer, so a store can live in a cloud object
store, a distributed filesystem or a local directory, and each chunk is
read independently.

### 1.3.2 Spatial Indexing as First-Class Feature
Data is organized into chunks of an N-dimensional grid, so a spatial
query reads only the chunks it touches.  A level may optionally use
octree chunks sized by content.

### 1.3.3 Multi-Resolution Native Support
Each resolution level is a Zarr group with its own bins and,
optionally, larger chunks.  The coarsening method is recorded in
metadata.

### 1.3.4 Distributed Uncoordinated Writes
Writers of different chunks need no coordination: every chunk is its own
cell and fragment numbering is chunk-local.  Objects that span chunks
are handled by explicit links and manifests.

### 1.3.5 Rich Metadata at Multiple Levels
Attributes attach to vertices, fragments, links, objects and groups;
store-wide properties (axes, CRS, levels, geometry types) sit on the
root.

### 1.3.6 Efficient Selective Access Patterns
A reader can restrict a read by bounding box, attribute channel, object
or resolution level.

### 1.3.7 Geometry Type Flexibility
Point clouds, meshes, skeletons, graphs and streamlines share one
storage model; custom types extend it through metadata.

## 1.4 Relationship to Other Formats

### 1.4.1 TRX Format (Tractography)
[TRX](https://github.com/tee-ar-ex/trx-spec) is the conceptual
foundation: its offsets inspired the fragment index, and its per-vertex,
per-streamline and per-group data map onto attribute arrays.  A
single-chunk store closely aligns with TRX
([§14.8](14-examples.md#148-simple-dti-small-volume-trx-aligned)).

### 1.4.2 OME-Zarr
Zarr Vectors adapts OME-Zarr's pyramid model to vector data.  Axes are
`{name, type, unit}` descriptors with UDUNITS-2 units, as in NGFF RFC 4,
but live in the root `zarr_vectors.axes`.  Where OME-Zarr grows a
pyramid by enlarging voxels, Zarr Vectors lets a level override
`chunk_shape`, nested in the level-0 grid.

A Zarr Vectors store is **not** an OME-Zarr image and writes no NGFF
`multiscales` block: NGFF's `datasets` must name image arrays and its
axes allow only 2–3 space dimensions.  The root MAY carry an `ome`
object that is an OME-Zarr RFC 8 `collection` node (one `zv:level` node
per level and a `scene` with a `world` coordinate system), so an OME
collection can name the store by path.  It restates fields of
`zarr_vectors`, which stay authoritative, and no reader may depend on
it.

### 1.4.3 Zarr Specification
Zarr v3 stores the bytes; Zarr Vectors frames the records inside them.
Each per-chunk quantity is one array of the variable-length `bytes`
data type (`vlen-bytes` codec) with one cell per spatial chunk.  Both
are Zarr v3 extensions, which a Zarr implementation must support to open
the arrays.  Each node's format metadata is one attribute,
`zarr_vectors`, whose `kind` says what the node is.  Arrays may be
sharded with `sharding_indexed` or the optional `octree_sharding` codec.

### 1.4.4 Precomputed Mesh and Annotation Formats
The Neuroglancer precomputed mesh format shaped the multi-resolution,
spatially chunked, Draco-compressed mesh design.  The
[precomputed annotation format](https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/annotations.md)
covers points, lines, boxes and ellipsoids with properties and
relationships; Zarr Vectors expresses them with `geometry_types`,
attributes and groups, but coarsens per object rather than by random
subsampling.  See Appendix K for the field-by-field mapping.

### 1.4.5 Traditional Formats (LAS, PLY, OBJ, STL)
Vertices, faces, edges and attributes map directly onto Zarr Vectors
arrays, so these formats convert in both directions.

### 1.4.6 Visualization Formats (3D Tiles, I3S)
These optimize web streaming; Zarr Vectors optimizes analysis.  Both
use spatial indexing and multi-resolution, and Zarr Vectors data can be
converted to them.

### 1.4.7 Zarr Conventions: the Metadata Layer

Zarr Vectors is a file format that uses Zarr v3 as its container, in two
layers:

- **Metadata**: the
  [Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors)
  (uuid `66268a61-7833-4995-bbcb-233bb417dae5`, v0.1.0, covering format
  0.10.0), under the
  [Zarr Conventions specification](https://github.com/zarr-conventions/zarr-conventions-spec).
  Each node's properties live in one attribute, `zarr_vectors`, with a
  required `kind`, and every such node registers the convention in
  `zarr_conventions`.  The convention's JSON Schema checks each node
  ([§13.3](13-conformance-and-validation.md#133-validation-tools)).
- **Cells**: this specification — the byte layouts inside each cell and
  the rules that span nodes.

| Standard | Where | Role |
|----------|-------|------|
| [Zarr v3](https://zarr-specs.readthedocs.io/en/latest/v3/core/index.html) | every node | Container |
| zarr-extensions [`bytes`](https://github.com/zarr-developers/zarr-extensions/tree/main/data-types/bytes) and [`vlen-bytes`](https://github.com/zarr-developers/zarr-extensions/tree/main/codecs/vlen-bytes) | per-chunk arrays, `groups`, vlen manifests | One byte blob per cell |
| [Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors) v0.1.0 | every node with `zarr_vectors` | All format metadata |
| [multiscales convention](https://github.com/zarr-conventions/multiscales) v0.1 (uuid `d35379db-88df-4056-af3a-620245f8e347`) | root | `multiscales: {"layout": [{"asset": "0"}, …]}` lists the levels |
| [proj convention](https://github.com/zarr-conventions/proj) v0.1 (uuid `f17cb550-5864-4468-aeb7-f3180cfb622f`) | root, with a CRS | `proj:projjson`, a PROJJSON object |
| OME-Zarr RFC 8 | root, optional | `ome` collection node |
| [`octree_sharding`](https://github.com/Andrew-Keenlyside/zarr-octree) codec | per array, optional | Sparse-index sharding; legacy name `zarr_octree_sharding` |

The root registers the Zarr Vectors convention with its full entry
(`schema_url`, `spec_url`, `uuid`, `name`, `description`), plus the
multiscales convention and, with a CRS, the proj convention.  Every
other node registers the short form `{"uuid": "66268a61-…"}`.

`multiscales` carries no `transform`: every level stores vertices in
level-0 coordinates.  A coarse level's `bin_shape` and `bin_ratio` live
only in its own `zarr_vectors` object.

`octree_sharding` is implemented by the `zarr-octree` package.  A store
chooses it per array; a reader without it cannot read those arrays but
can read the rest of the store.

## 1.5 Key Features

1. **Spatial chunking** for spatial queries, with optional octree chunks
2. **Fragment-indexed chunks**: a compact per-chunk index partitions vertices and links into fragments that objects and levels can re-use
3. **Selective attribute access** through per-attribute arrays with a channel dimension
4. **Objects and groups**: object identity is kept across pyramid levels; groups partition objects without imposing a hierarchy
5. **Cross-chunk linking** through explicit link arrays
6. **Multi-resolution pyramids** with optional cross-level links and per-level `chunk_shape`
7. **Distributed writes** with chunk-local fragment numbering
8. **Compression and packing**: any Zarr codec, Draco for meshes, sharding (`sharding_indexed` or `octree_sharding`), dense object indexes
9. **Registered metadata**, checkable against the convention's JSON Schema
10. **Extensibility**: custom geometry types, attributes and capability tokens

## 1.6 Target Audiences

Implementers of readers and writers, application developers, data
scientists working with vector data, infrastructure engineers, and
those comparing Zarr Vectors with other formats.

## 1.7 Document Structure

- **Sections 1–4**: introduction, scope, terminology, data model
- **Sections 5–8**: store structure, spatial indexing, arrays, metadata
- **Sections 9–12**: multi-resolution, cross-chunk linking, compression, geometry types
- **Section 13**: conformance and validation
- **Section 14**: examples
- **Section 15**: appendices, including the change log

For a quick start read Sections 1, 2, 4 and 14; to implement, read 1–8,
13 and the relevant appendices.

## 1.8 Conventions

Normative text states requirements for conformance; informative text
explains.  MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in
RFC 2119.  Code is pseudocode or Python; metadata examples are JSON.
