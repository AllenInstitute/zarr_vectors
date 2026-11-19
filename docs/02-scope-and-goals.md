# 2. Scope and Goals

## 2.1 In Scope

This specification covers Zarr Vectors format **0.10.0**, and the
in-place migration of 0.9.x stores to it
([Appendix J](15-appendices.md#appendix-j-change-log)):

- Point clouds (2-D, 3-D, N-D), meshes, skeletons and graphs,
  streamlines and polylines, tracks through time, and spatial
  transcriptomics (cells and detections)
- Spatial indexing and multi-resolution
- Distributed reads and writes
- The byte layout of every cell, and the rules that span nodes (chunk
  grids, offsets segments, manifests, pyramids)
- How the format uses the Zarr Vectors, multiscales and proj conventions
  ([§2.4](#24-relationship-to-other-standards))
- Optional packing: sharding, dense object indexes, octree chunks

## 2.2 Out of Scope

- Visualization APIs and language bindings (the reference
  implementation is [zarr-vectors-py](https://github.com/AllenInstitute/zarr-vectors-py))
- Compression algorithms (existing standards are referenced)
- The per-node metadata schema, which the Zarr Vectors convention
  defines; this specification says what the fields mean for the cells
- The `octree_sharding` shard format, which its codec specification
  defines

## 2.3 Example Use Cases

### Large-Scale Multiplexed FISH with Transcriptome Wide Gene Imputations

Cells are points with attributes for thousands of genes, grouped by cell
type, and types grouped into super-types through group attributes.
Writers assign cells in each spatial bin to types, then write the groups.
Readers fetch all cells of a type or super-type, or all cells in a
spatial cutout.

### Distributed Multi-Resolution Triangular Meshes

Meshes are divided into spatial chunks and may be Draco-encoded.  A
per-chunk fragment index names the mesh pieces in each chunk, and an
object manifest chains them into whole meshes.  Readers fetch a whole
high-resolution mesh, read enough metadata to build an octree of the
mesh across levels of detail, or stream pieces on demand for viewing.

### Skeleton/Graph Storage for Connectomics

Skeletons are divided into spatial chunks, and new fragments can be
appended to a chunk without rewriting others.  Parent edges are records
in the `links/0/` family (`link_width = 2` when an edge may cross a chunk
seam); under `links_convention = "implicit_sequential_with_branches"`
only branch links are stored.  By default (`explicit_links`) vertices
stay unique and edges across a seam are records at a non-zero offsets
segment; under `cross_chunk_strategy = "boundary_deduplication"`,
boundary vertices are duplicated instead.  Radius and compartment are
per-vertex attributes, and whole skeletons are rebuilt from the chunks.

## 2.4 Relationship to Other Standards

Zarr Vectors builds on these standards and does not redefine them:

- **Zarr v3** is the container; per-chunk arrays use the zarr-extensions
  `bytes` data type and `vlen-bytes` codec.
- **The Zarr Vectors convention** (v0.1.0) is the metadata layer: every
  node's properties live in one attribute, `zarr_vectors`, discriminated
  by `kind`, and every such node registers the convention in
  `zarr_conventions`.  Its JSON Schema is the normative definition of
  each node's metadata; this specification defines the cells and the
  rules that span nodes.  Where the two disagree, this specification
  follows what the reference implementation writes.
- **The multiscales convention** (v0.1) lists the levels in the root's
  `multiscales` block, with no transform.
- **The proj convention** (v0.1) holds the CRS.  Writers record it as
  `proj:projjson`; a reader MAY also accept the convention's
  `proj:code` and `proj:wkt2`.
- **OME-Zarr RFC 8**: the root MAY carry an `ome` collection node; nothing
  depends on it.  The store is not an OME-Zarr image and writes no NGFF
  `multiscales` block.
- **`octree_sharding`** is an optional Zarr v3 sharding codec (legacy name
  `zarr_octree_sharding`, which readers also accept), implemented by the
  `zarr-octree` package.  A reader without it cannot read the arrays that
  use it.

[§1.4.7](01-introduction.md#147-zarr-conventions-the-metadata-layer)
gives the registration entries and links.
