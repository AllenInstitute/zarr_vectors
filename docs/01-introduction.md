# 1. Introduction

## 1.1 Background and Motivation

The increasing scale of scientific and industrial 3D data presents significant challenges for data storage, access, and analysis. Modern applications routinely generate datasets containing millions to trillions of vector objects—point clouds from LiDAR and microscopy, meshes from 3D reconstruction, skeletons from connectomics, and streamlines from tractography. These datasets often require:

- **Distributed storage and access**: Data must be stored in cloud object stores (S3, GCS, Azure Blob) and accessed from distributed computing environments
- **Spatial querying**: Efficient retrieval of data within spatial regions without loading entire datasets
- **Incremental updates**: Ability to add or modify data without regenerating entire files
- **Multi-resolution visualization**: Support for level-of-detail rendering at different scales
- **Rich metadata**: Complex annotations at multiple levels (points, objects, groups)
- **Concurrent access**: Multiple processes or users reading and writing simultaneously

Traditional file formats (LAS, PLY, OBJ, STL) were designed for single-file, single-machine workflows. They lack spatial indexing, multi-resolution support, and distributed write capabilities. While newer formats like 3D Tiles and I3S address visualization needs, they are optimized for streaming and lack the flexibility needed for scientific computing and analysis workflows.

The Zarr Vectors (ZV) format addresses these limitations by providing a cloud-native, spatially-indexed format that supports distributed uncoordinated reads and writes, native multi-resolution representations, fragment- and object-level re-use across resolution levels, and rich metadata—all built on the proven Zarr v3 storage foundation.

## 1.2 Purpose and Goals

The Zarr Vector Format specification defines a standardized, cloud-native format for storing very large N-dimensional vector objects. The format is designed to:

1. **Enable scalable storage**: Support datasets ranging from thousands to trillions of vector objects
2. **Facilitate distributed access**: Enable efficient spatial queries and selective data loading from cloud storage
3. **Support concurrent operations**: Allow multiple processes to read and write data without coordination
4. **Provide multi-resolution support**: Native support for hierarchical level-of-detail representations
5. **Enable rich metadata**: Support arbitrary metadata at point, object, and group levels
6. **Maintain format flexibility**: Support diverse geometry types (point clouds, meshes, skeletons, streamlines) with extensibility for custom types
7. **Ensure interoperability**: Provide clear migration paths from existing formats and compatibility with common tools

The format is designed to be:
- **Cloud-native**: Optimized for object storage backends (S3, GCS, Azure Blob) and filesystems
- **Analysis-friendly**: Supports scientific computing workflows, not just visualization
- **Extensible**: Allows custom geometry types and metadata schemas
- **Efficient**: Enables selective access patterns to minimize data transfer and memory usage

## 1.3 Design Principles

The Zarr Vector Format is built on several core design principles:

### 1.3.1 Cloud-Native Architecture
The format uses Zarr as its underlying storage mechanism, enabling:
- Storage in cloud object stores, distributed filesystems, or local filesystems
- Efficient chunked storage with independent chunk access
- Support for various storage backends through Zarr's abstraction layer

### 1.3.2 Spatial Indexing as First-Class Feature
Spatial organization is fundamental to the format:
- Data is organized by spatial chunks in N-dimensional space
- Spatial queries can be answered by identifying relevant chunks
- Chunk boundaries enable efficient spatial filtering
- Spatial indexing supports both regular grids and (future) hierarchical structures

### 1.3.3 Multi-Resolution Native Support
Multi-resolution is built into the format structure:
- Multiple resolution levels are stored as separate Zarr groups
- Each level can have different spatial chunk sizes
- Downsampling strategies are specified in metadata
- Enables progressive loading and level-of-detail visualization

### 1.3.4 Distributed Uncoordinated Writes
The format supports concurrent write operations:
- Writers can operate on different spatial chunks independently
- No global coordination required for most operations
- Chunk-level atomicity through Zarr's storage model
- Explicit mechanisms for handling cross-chunk objects

### 1.3.5 Rich Metadata at Multiple Levels
Metadata can be attached at various granularities:
- **Point-level**: Attributes per vertex (e.g., gene expression, color, intensity)
- **Object-level**: Properties of geometric entities (e.g., mesh material, streamline properties)
- **Group-level**: Collections of objects (e.g., cell types, anatomical regions)
- **Format-level**: Global properties (coordinate systems, resolution levels, geometry types)

### 1.3.6 Efficient Selective Access Patterns
The format enables targeted data retrieval:
- Spatial queries: Load only chunks intersecting a bounding box
- Attribute queries: Load only specific attribute channels
- Object queries: Load only vertices belonging to specific objects
- Multi-resolution queries: Load appropriate resolution level for the task

### 1.3.7 Geometry Type Flexibility
The format supports diverse geometry types with a unified storage model:
- Point clouds: Unstructured collections of points
- Meshes: Connected surfaces or volumes (triangular, quad, tetrahedral)
- Skeletons: Graph structures representing topology
- Streamlines/Polylines: Ordered sequences of connected points
- Custom types: Extensible through metadata

## 1.4 Relationship to Other Formats

The Zarr Vector Format builds upon and extends concepts from several existing formats:

### 1.4.1 TRX Format (Tractography)
The TRX format (https://github.com/tee-ar-ex/trx-spec) provides the conceptual foundation:
- **Path offsets**: TRX's efficient storage of variable-length streamlines inspired the per-chunk fragment-index encoding
- **Channel dimension**: TRX's approach to storing vertex attributes with a channel dimension is adopted
- **Metadata model**: TRX's flexible metadata structure influenced the multi-level metadata design
- **Compatibility**: When spatial indexing is collapsed to a single dimension, ZV closely aligns with TRX

### 1.4.2 OME-Zarr
OME-Zarr's multi-resolution approach is adapted for vector data:
- **Multi-resolution structure**: OME-Zarr's pyramid approach is extended to vector geometries
- **Zarr backend**: Both formats leverage Zarr's chunked storage
- **Metadata standards**: OME-Zarr's metadata conventions (RFC 4, RFC 5) are followed for coordinate reference systems
- **Extension model**: OME-Zarr's extensibility model influenced the design
- **Pyramid chunk-size growth**: OME-Zarr scales image pyramids by shrinking voxel size at coarser levels (so the same chunk count covers a larger physical region).  ZV has no voxel concept, so it instead lets each pyramid level override `chunk_shape` directly (v0.7+); coarser levels can use larger chunks while staying nested in the level-0 grid.

### 1.4.3 Zarr Specification
Zarr provides the storage foundation:
- **Chunked arrays**: Zarr's efficient chunked storage enables spatial indexing
- **Ragged objects**: per-chunk byte payloads (vertices, fragment-index, links, manifests) carry their own record framing inside the cells of Zarr v3 vlen-bytes arrays — Zarr stores the bytes, ZV frames the records
- **Store abstraction**: Zarr's store interface enables cloud-native storage
- **Metadata**: Zarr v3's `zarr.json` files carry format metadata under namespaced keys (`zarr_vectors`, `zarr_vectors_level`, `zv_array`)

### 1.4.4 Precomputed Mesh and Annotation Formats
The Neuroglancer precomputed mesh format influenced multi-resolution mesh design:
- **Multi-resolution meshes**: Similar approach to storing meshes at multiple levels of detail
- **Spatial chunking**: Concept of dividing meshes into spatial regions
- **Draco compression**: Use of Draco for mesh compression

The companion [precomputed annotation format](https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/annotations.md) covers points, lines, axis-aligned bounding boxes, and ellipsoids with per-annotation properties and per-segment relationships.  ZV expresses the same primitives via `geometry_types` + per-vertex / per-object attributes + groups; coarsening differs (per-object aggregation vs random-subsample-with-limit).  See Appendix L for the field-by-field mapping.

### 1.4.5 Traditional Formats (LAS, PLY, OBJ, STL)
While ZV addresses limitations of traditional formats, it maintains conceptual compatibility:
- **Geometry representation**: Standard concepts (vertices, faces, edges) are preserved
- **Attribute storage**: Traditional attribute concepts map to ZV's attribute arrays
- **Migration paths**: Clear conversion strategies from traditional formats

### 1.4.6 Visualization Formats (3D Tiles, I3S)
ZV complements visualization-focused formats:
- **Different goals**: 3D Tiles/I3S optimize for web streaming; ZV optimizes for analysis
- **Shared concepts**: Spatial indexing and multi-resolution are common themes
- **Interoperability**: ZV data can be converted to visualization formats when needed

## 1.5 Key Features

The Zarr Vector Format provides several key features that distinguish it from existing formats:

1. **Spatial Chunking**: Data is organized into spatial chunks, enabling efficient spatial queries
2. **Fragment-Indexed Chunks**: Variable-length per-chunk structures (vertices, links, attributes) are partitioned by a compact byte-level fragment index that supports vertex / link / fragment re-use within and across objects
3. **Selective Attribute Access**: Attributes are stored with a channel dimension, enabling loading of specific attributes
4. **Object Groups**: Object identity is preserved across pyramid levels; group-level metadata partitions objects (cell types, brain regions, tracts, …) without imposing a hierarchy
5. **Cross-Chunk Linking**: Explicit cross-chunk link arrays handle objects that span multiple spatial chunks
6. **Multi-Resolution Pyramids**: Per-object pyramids with optional cross-pyramid-level link arrays for fragment-level LOD selection, plus per-level `chunk_shape` overrides for scalable coarse levels
7. **Distributed Writes**: Uncoordinated writes to different spatial chunks enable parallel processing; chunk-local fragment numbering removes the need for global coordination
8. **Flexible Compression**: Support for various compression codecs, including Draco for geometry
9. **Rich Metadata**: NGFF-compatible metadata at multiple levels with a LinkML schema
10. **Extensibility**: Support for custom geometry types, custom attributes, and writer-side capability tokens

## 1.6 Target Audiences

This specification is intended for:

- **Format Implementers**: Developers creating libraries and tools to read/write ZV files
- **Application Developers**: Developers building applications that work with large-scale vector data
- **Data Scientists**: Researchers and analysts working with point clouds, meshes, and related data
- **Infrastructure Engineers**: Engineers designing storage and compute systems for 3D data
- **Format Evaluators**: Those considering ZV for their use cases and comparing it to alternatives

## 1.7 Document Structure

This specification is organized as follows:

- **Sections 1-4**: Introduction, scope, terminology, and data model—essential reading for understanding the format
- **Sections 5-8**: Core technical specifications—Zarr store structure, spatial indexing, arrays, and metadata
- **Sections 9-12**: Advanced features—multi-resolution, cross-chunk linking, compression, and geometry types
- **Section 13**: Conformance and validation—requirements for compliant implementations
- **Section 14**: Examples—practical examples demonstrating format usage
- **Section 15**: Appendices—reference material, schemas, algorithms, and migration guides

**Reading Paths:**
- **Quick Start**: Read Sections 1, 2, 4, and 14 (examples)
- **Implementation**: Read Sections 1-8, 13, and relevant appendices
- **Advanced Usage**: Read all sections, focusing on 9-12 for specific features
- **Migration**: Read Sections 1-4, then Appendix G (Migration Guide)

## 1.8 Conventions

Throughout this specification:
- **Normative text**: Requirements that must be followed for conformance
- **Informative text**: Explanatory material, examples, and recommendations
- **Code examples**: Provided in pseudocode or Python-like syntax
- **Metadata examples**: Provided in JSON format
- **References**: Links to external specifications and resources






