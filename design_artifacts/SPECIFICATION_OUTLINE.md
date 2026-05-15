# Zarr Vector Format Specification Outline

## Document Information
- **Title:** Zarr Vector Format (ZVF) Specification
- **Version:** 0.1 (Draft)
- **Status:** Working Draft
- **Date:** [Current Date]
- **Authors:** [To be filled]
- **License:** [To be determined]

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Scope and Goals](#2-scope-and-goals)
3. [Terminology and Concepts](#3-terminology-and-concepts)
4. [Data Model](#4-data-model)
5. [Zarr Store Structure](#5-zarr-store-structure)
6. [Spatial Indexing](#6-spatial-indexing)
7. [Core Arrays](#7-core-arrays)
8. [Metadata](#8-metadata)
9. [Multi-Resolution Support](#9-multi-resolution-support)
10. [Cross-Chunk Linking](#10-cross-chunk-linking)
11. [Compression and Encoding](#11-compression-and-encoding)
12. [Geometry Types](#12-geometry-types)
13. [Conformance and Validation](#13-conformance-and-validation)
14. [Examples](#14-examples)
15. [Appendices](#15-appendices)

---

## 1. Introduction

### 1.1 Background and Motivation

The increasing scale of scientific and industrial 3D data presents significant challenges for data storage, access, and analysis. Modern applications routinely generate datasets containing millions to trillions of vector objects—point clouds from LiDAR and microscopy, meshes from 3D reconstruction, skeletons from connectomics, and streamlines from tractography. These datasets often require:

- **Distributed storage and access**: Data must be stored in cloud object stores (S3, GCS, Azure Blob) and accessed from distributed computing environments
- **Spatial querying**: Efficient retrieval of data within spatial regions without loading entire datasets
- **Incremental updates**: Ability to add or modify data without regenerating entire files
- **Multi-resolution visualization**: Support for level-of-detail rendering at different scales
- **Rich metadata**: Complex annotations at multiple levels (points, objects, groups)
- **Concurrent access**: Multiple processes or users reading and writing simultaneously

Traditional file formats (LAS, PLY, OBJ, STL) were designed for single-file, single-machine workflows. They lack spatial indexing, multi-resolution support, and distributed write capabilities. While newer formats like 3D Tiles and I3S address visualization needs, they are optimized for streaming and lack the flexibility needed for scientific computing and analysis workflows.

The Zarr Vector Format (ZVF) addresses these limitations by providing a cloud-native, spatially-indexed format that supports distributed uncoordinated reads and writes, native multi-resolution representations, and rich metadata—all built on the proven Zarr storage foundation.

### 1.2 Purpose and Goals

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

### 1.3 Design Principles

The Zarr Vector Format is built on several core design principles:

#### 1.3.1 Cloud-Native Architecture
The format uses Zarr as its underlying storage mechanism, enabling:
- Storage in cloud object stores, distributed filesystems, or local filesystems
- Efficient chunked storage with independent chunk access
- Support for various storage backends through Zarr's abstraction layer

#### 1.3.2 Spatial Indexing as First-Class Feature
Spatial organization is fundamental to the format:
- Data is organized by spatial chunks in N-dimensional space
- Spatial queries can be answered by identifying relevant chunks
- Chunk boundaries enable efficient spatial filtering
- Spatial indexing supports both regular grids and (future) hierarchical structures

#### 1.3.3 Multi-Resolution Native Support
Multi-resolution is built into the format structure:
- Multiple resolution levels are stored as separate Zarr groups
- Each level can have different spatial chunk sizes
- Downsampling strategies are specified in metadata
- Enables progressive loading and level-of-detail visualization

#### 1.3.4 Distributed Uncoordinated Writes
The format supports concurrent write operations:
- Writers can operate on different spatial chunks independently
- No global coordination required for most operations
- Chunk-level atomicity through Zarr's storage model
- Explicit mechanisms for handling cross-chunk objects

#### 1.3.5 Rich Metadata at Multiple Levels
Metadata can be attached at various granularities:
- **Point-level**: Attributes per vertex (e.g., gene expression, color, intensity)
- **Object-level**: Properties of geometric entities (e.g., mesh material, streamline properties)
- **Group-level**: Collections of objects (e.g., cell types, anatomical regions)
- **Format-level**: Global properties (coordinate systems, resolution levels, geometry types)

#### 1.3.6 Efficient Selective Access Patterns
The format enables targeted data retrieval:
- Spatial queries: Load only chunks intersecting a bounding box
- Attribute queries: Load only specific attribute channels
- Object queries: Load only vertices belonging to specific objects
- Multi-resolution queries: Load appropriate resolution level for the task

#### 1.3.7 Geometry Type Flexibility
The format supports diverse geometry types with a unified storage model:
- Point clouds: Unstructured collections of points
- Meshes: Connected surfaces or volumes (triangular, quad, tetrahedral)
- Skeletons: Graph structures representing topology
- Streamlines/Polylines: Ordered sequences of connected points
- Custom types: Extensible through metadata

### 1.4 Relationship to Other Formats

The Zarr Vector Format builds upon and extends concepts from several existing formats:

#### 1.4.1 TRX Format (Tractography)
The TRX format (https://github.com/tee-ar-ex/trx-spec) provides the conceptual foundation:
- **Path offsets**: TRX's efficient storage of variable-length streamlines inspired the object groupings array
- **Channel dimension**: TRX's approach to storing vertex attributes with a channel dimension is adopted
- **Metadata model**: TRX's flexible metadata structure influenced the multi-level metadata design
- **Compatibility**: When spatial indexing is collapsed to a single dimension, ZVF closely aligns with TRX

#### 1.4.2 OME-Zarr
OME-Zarr's multi-resolution approach is adapted for vector data:
- **Multi-resolution structure**: OME-Zarr's pyramid approach is extended to vector geometries
- **Zarr backend**: Both formats leverage Zarr's chunked storage
- **Metadata standards**: OME-Zarr's metadata conventions (RFC 4, RFC 5) are followed for coordinate reference systems
- **Extension model**: OME-Zarr's extensibility model influenced the design

#### 1.4.3 Zarr Specification
Zarr provides the storage foundation:
- **Chunked arrays**: Zarr's efficient chunked storage enables spatial indexing
- **Ragged arrays**: Zarr v3's support for variable-length chunks enables efficient storage of variable-length objects
- **Store abstraction**: Zarr's store interface enables cloud-native storage
- **Metadata**: Zarr's `.zattrs` and `.zgroup` files are used for format metadata

#### 1.4.4 Precomputed Mesh Format
The Neuroglancer precomputed mesh format influenced multi-resolution mesh design:
- **Multi-resolution meshes**: Similar approach to storing meshes at multiple levels of detail
- **Spatial chunking**: Concept of dividing meshes into spatial regions
- **Draco compression**: Use of Draco for mesh compression

#### 1.4.5 Traditional Formats (LAS, PLY, OBJ, STL)
While ZVF addresses limitations of traditional formats, it maintains conceptual compatibility:
- **Geometry representation**: Standard concepts (vertices, faces, edges) are preserved
- **Attribute storage**: Traditional attribute concepts map to ZVF's attribute arrays
- **Migration paths**: Clear conversion strategies from traditional formats

#### 1.4.6 Visualization Formats (3D Tiles, I3S)
ZVF complements visualization-focused formats:
- **Different goals**: 3D Tiles/I3S optimize for web streaming; ZVF optimizes for analysis
- **Shared concepts**: Spatial indexing and multi-resolution are common themes
- **Interoperability**: ZVF data can be converted to visualization formats when needed

### 1.5 Key Features

The Zarr Vector Format provides several key features that distinguish it from existing formats:

1. **Spatial Chunking**: Data is organized into spatial chunks, enabling efficient spatial queries
2. **Ragged Arrays**: Variable-length objects (streamlines, polylines) are stored efficiently using ragged arrays
3. **Selective Attribute Access**: Attributes are stored with a channel dimension, enabling loading of specific attributes
4. **Object Groupings**: Consecutive storage of object vertices enables efficient object-level access
5. **Cross-Chunk Linking**: Mechanisms for handling objects that span multiple spatial chunks
6. **Multi-Resolution Pyramids**: Native support for hierarchical level-of-detail representations
7. **Distributed Writes**: Uncoordinated writes to different spatial chunks enable parallel processing
8. **Flexible Compression**: Support for various compression codecs, including Draco for geometry
9. **Rich Metadata**: JSON-based metadata at multiple levels with schema validation
10. **Extensibility**: Support for custom geometry types and metadata schemas

### 1.6 Target Audiences

This specification is intended for:

- **Format Implementers**: Developers creating libraries and tools to read/write ZVF files
- **Application Developers**: Developers building applications that work with large-scale vector data
- **Data Scientists**: Researchers and analysts working with point clouds, meshes, and related data
- **Infrastructure Engineers**: Engineers designing storage and compute systems for 3D data
- **Format Evaluators**: Those considering ZVF for their use cases and comparing it to alternatives

### 1.7 Document Structure

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

### 1.8 Conventions

Throughout this specification:
- **Normative text**: Requirements that must be followed for conformance
- **Informative text**: Explanatory material, examples, and recommendations
- **Code examples**: Provided in pseudocode or Python-like syntax
- **Metadata examples**: Provided in JSON format
- **References**: Links to external specifications and resources

---

## 2. Scope and Goals

### 2.1 In Scope
- Point clouds (2D, 3D, N-dimensional)
- Meshes (triangular, quad, tetrahedral, etc.)
- Skeletons and graphs
- Streamlines and polylines
- Tracks through time
- Spatial transcriptomics (cells and detection points) 
- Arbitrary N-dimensional vector data
- Spatial indexing and multi-resolution
- Distributed read/write operations
- Rich metadata support

### 2.2 Out of Scope
- Specific visualization APIs
- Compression algorithm specifications (references existing standards)

### 2.3 Example Use Cases
- Large-scale multiplexed FISH with transcriptome wide gene imputations
    * Organizing point clouds via cell-types
    * Having genome wide transcriptome measurements per cell
    * Walk through write sequence, including linking point clouds within a spatial bin to a cell type
      as well as writing all groups across spatial bins
    * Illustrate using groups to link cell-types into super-groups 
    * Illustrating reading all cells that belong to a type
    * Illustrate reading all cells that belong to a super-type
    * Illustrating reading all cells in a spatial cutout
- Distributed multi-resolution triangular meshes
    * Organizing meshes into spatially divided sections
    * Writing meshes as a sequence of draco compressed byte streams
    * Illustration of writing a manifest ragged array to specify all mesh fragments in a mesh
    * Illustrating reading all the components of a high resolution mesh
    * Illustration of reading sufficient metadata to build an oct-tree representation of a mesh across all levels od detail to facilitate multi res visualization with reeads of the mesh data on demand
- Skeleton/graph storage for connectomics
    * breaking skeletons into spatial buckets, repeating vertices at border
    * appending vertices and path offsets
    * adding parent indices
    * adding vertex properties (radius, compartment)
    * reconstructing entire skeleton


---

## 3. Terminology and Concepts

### 3.1 Core Terms
- **Spatial Index**: N-dimensional coordinate system for organizing data (may include time)
- **Spatial Chunk**: A region in spatial index space containing vector data
- **Vertex**: A point in N-dimensional space with associated data
- **Object**: A collection of vertices forming a geometric entity (mesh, polyline, etc.)
- **Group**: A collection of objects with shared metadata
- **Ragged Array**: Variable-length arrays within spatial chunks
- **Channel Dimension**: Dimension for vertex attributes (e.g., gene expression channels)

### 3.2 Geometry Terms
- **Point Cloud**: Unstructured collection of points
- **Mesh**: Connected vertices forming surfaces or volumes
- **Skeleton**: Graph structure representing topology
- **Streamline/Polyline**: Ordered sequence of connected points
- **Path**: A connected sequence within a skeleton

### 3.3 Storage Terms
- **Zarr Store**: The underlying Zarr storage (filesystem, object store, etc.)
- **Zarr Array**: A multi-dimensional array in Zarr format
- **Chunk**: Zarr's unit of storage (may differ from spatial chunk)
- **Metadata**: Structured information about data organization

### 3.4 Indexing Terms
- **Spatial Index Chunk**: A region in spatial index space
- **Object Index**: Index mapping object IDs to spatial locations
- **Cross-Chunk Link**: Connection between objects in different spatial chunks
- **Resolution Level**: A level in the multi-resolution hierarchy

---

## 4. Data Model

### 4.1 Hierarchical Organization
```
Zarr Store Root
├── Resolution Level 0 (full resolution)
│   ├── Spatial Index Structure
│   ├── Vertex Positions Array
│   ├── Vertex Attributes Array
│   ├── Object Groupings Array
│   ├── Vertex Links Array (optional)
│   ├── Object Index Array (optional)
│   └── Metadata
├── Resolution Level 1 (downsampled)
│   └── [Same structure]
├── Resolution Level N
└── Root Metadata
```

### 4.2 Spatial Index Model
- **Dimensions**: N spatial dimensions (X, Y, Z, T, ...)
- **Coordinate System**: Specified in metadata (CRS, units, origin)
- **Chunking Strategy**: Regular grid (extensible to hierarchical)
- **Chunk Size**: Configurable per dimension
- **Boundary Handling**: Specified in metadata

### 4.3 Vertex Model
- **Position**: N-dimensional coordinates (same as spatial index)
- **Attributes**: Arbitrary number of attribute channels
- **Object Membership**: Vertex belongs to zero or more objects
- **Links**: Connections to other vertices (for graphs/meshes)

### 4.4 Object Model
- **Definition**: Collection of vertices forming a geometric entity
- **Storage**: Consecutive vertices in arrays
- **Metadata**: Object-level attributes
- **Cross-Chunk Objects**: Objects spanning multiple spatial chunks

### 4.5 Group Model
- **Definition**: Collection of objects with shared properties
- **Metadata**: Group-level attributes
- **Hierarchy**: Groups may contain sub-groups

---

## 5. Zarr Store Structure

### 5.1 Root Structure
- Zarr group at root
- Required metadata files
- Resolution level groups
- Optional extension groups

### 5.2 Zarr Version Requirements
- Minimum Zarr version: [TBD - likely v3]
- Required Zarr features:
  - Ragged array support
  - Variable-length chunks
  - [Other requirements]

### 5.3 Store Backend Requirements
- Support for object stores (S3, GCS, Azure Blob)
- Support for filesystem storage
- Concurrent access semantics
- Atomicity considerations

### 5.4 Naming Conventions
- Array names: `vertices`, `attributes`, `groupings`, `links`, `object_index`
- Resolution level names: `resolution_0`, `resolution_1`, etc.
- Metadata file: `.zattrs`, `.zgroup` (Zarr standard)
- Custom metadata: `metadata.json` or similar

---

## 6. Spatial Indexing

### 6.1 Spatial Index Definition
- **Dimensions**: Number and names of spatial dimensions
- **Coordinate System**: Reference system specification
- **Bounds**: Global bounding box
- **Chunk Size**: Size of each spatial chunk
- **Chunk Grid**: Regular grid specification

### 6.2 Spatial Chunk Addressing
- **Chunk Coordinates:**
  - For 2D: `(chunk_x, chunk_y)`
  - For 3D: `(chunk_x, chunk_y, chunk_z)`
  - For N-D: `(chunk_dim0, chunk_dim1, ..., chunk_dimN)`
- **Chunk Key Encoding**: How chunks are named in Zarr store
- **Empty Chunks**: Handling of chunks with no data

### 6.3 Spatial Query Semantics
- **Bounding Box Queries**: Which chunks intersect a bounding box
- **Point Queries**: Which chunk contains a point
- **Range Queries**: Efficient access patterns

### 6.4 Boundary Conditions
- **Chunk Boundaries**: How boundaries are defined
- **Vertex Placement**: Rules for vertices on boundaries
- **Deduplication**: Handling duplicate vertices at boundaries
- **Cross-Chunk Objects**: Objects spanning boundaries

### 6.5 Alternative Indexing Strategies
- **Hierarchical Indexing**: Octree/quadtree (future extension)
- **Hilbert Curve**: Space-filling curve indexing (future extension)
- **Custom Indexing**: Extensibility mechanism

---

## 7. Core Arrays

### 7.1 Vertex Positions Array
- **Name**: `vertices`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Float or integer (specified in metadata)
- **Encoding**: Raw or Draco-compressed (per chunk)
- **Semantics**: 
  - Each ragged element contains vertices for one spatial chunk
  - Vertices are N-dimensional coordinates
  - Spatial locality: all vertices in chunk lie within chunk bounds (with boundary exceptions)

### 7.2 Vertex Attributes Array
- **Name**: `attributes`
- **Dimensions**: `(spatial_index_dims..., channel_dim, ragged_dim)`
- **Data Type**: Specified per channel in metadata
- **Chunking Strategy**: Configurable across channel dimension
- **Semantics**:
  - Attributes aligned with vertex positions
  - Selective channel access enabled by chunking
  - Missing attributes: handling strategy

### 7.3 Object Groupings Array
- **Name**: `groupings`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (offsets) or variable
- **Semantics**:
  - Defines groups of consecutive vertices forming objects
  - Offset format: position indices or byte offsets (for Draco)
  - Enables single range read for object vertices

### 7.4 Vertex Links Array (Optional)
- **Name**: `links`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (vertex indices)
- **Semantics**:
  - Parent-child relationships (skeletons)
  - Face connectivity (meshes)
  - Edge connectivity (graphs)
  - Compression: diff encoding for sequential links

### 7.5 Object Index Array (Optional)
- **Name**: `object_index`
- **Dimensions**: `(object_id_dim, spatial_ref_dim, ragged_dim)`
- **Data Type**: Integer
- **Semantics**:
  - Maps object IDs to spatial locations
  - Enables finding all chunks containing an object
  - Format: `(spatial_chunk_coords, grouping_index)`

### 7.6 Cross-Chunk Links Array (Optional)
- **Name**: `cross_chunk_links`
- **Dimensions**: `(link_count, vertex_ref_dim)`
- **Data Type**: Integer
- **Semantics**:
  - Links vertices across spatial chunks
  - Format: `(spatial_chunk_coords + vertex_offset, ...)`
  - Alternative to boundary deduplication

---

## 8. Metadata

### 8.1 Metadata Structure
- **Zarr Standard Metadata**: `.zattrs`, `.zgroup`
- **Format-Specific Metadata**: Custom JSON structure
- **Schema Validation**: JSON Schema specification

### 8.2 Root-Level Metadata
- Format version
- Spatial index definition
- Coordinate system information
- Resolution levels
- Geometry types supported
- Compression methods used

### 8.3 Resolution Level Metadata
- Resolution level identifier
- Downsampling factor
- Spatial chunk configuration
- Array configurations
- Compression settings

### 8.4 Array-Level Metadata
- Data types
- Dimensions and shapes
- Chunking strategy
- Compression codec and parameters
- Encoding method (raw, Draco, etc.)

### 8.5 Object-Level Metadata
- Object properties
- Object type (mesh, skeleton, polyline, etc.)
- Object identifiers
- Custom attributes

### 8.6 Group-Level Metadata
- Group properties
- Group hierarchy
- Shared attributes

### 8.7 Point-Level Metadata
- Stored in attributes array
- Channel definitions
- Attribute schemas

### 8.8 Coordinate Reference System (CRS)
- follows RFC 4 and 5 of ome-zarr

---

## 9. Multi-Resolution Support

### 9.1 Resolution Level Structure
- **Level 0**: Full resolution (original data)
- **Level N**: Progressively downsampled
- **Level Organization**: Separate Zarr groups per level
- **Level Metadata**: Downsampling factors and methods

### 9.2 Downsampling Strategies
- **Point Clouds**: 
  - Spatial downsampling (grid-based, random, etc.)
  - Feature-preserving methods
- **Meshes**: 
  - Mesh simplification algorithms
  - Quality metrics
- **Skeletons**: 
  - Path simplification
  - Topology preservation
- **Streamlines**: 
  - Point reduction along paths
  - Curvature-based simplification

### 9.3 Spatial Chunk Scaling
- Larger spatial chunks at lower resolutions
- Chunk size scaling factors
- Boundary alignment across levels

### 9.4 Level-of-Detail (LOD) Selection
- Criteria for level selection
- Automatic LOD selection algorithms
- Manual level specification

### 9.5 Consistency Across Levels
- Maintaining object identity across levels
- Metadata consistency
- Cross-level references

---

## 10. Cross-Chunk Linking

### 10.1 Problem Statement
- Objects spanning multiple spatial chunks
- Maintaining connectivity across boundaries
- Efficient querying of distributed objects

### 10.2 Strategy 1: Boundary Deduplication
- **Principle**: Vertices on chunk boundaries are explicitly placed
- **Deduplication**: Same vertex appears in adjacent chunks
- **Linking**: Implicit via coordinate matching
- **Advantages**: Simple, efficient for many cases
- **Disadvantages**: Requires precise coordinate alignment, potential inconsistencies

### 10.3 Strategy 2: Explicit Cross-Chunk Links
- **Principle**: Separate array storing inter-chunk connections
- **Format**: `(chunk_coords + vertex_offset, chunk_coords + vertex_offset)`
- **Advantages**: Explicit, no coordinate matching needed
- **Disadvantages**: Additional storage, query complexity

### 10.4 Strategy Selection
- Metadata specifies which strategy is used
- May use both strategies (deduplication + explicit links)
- Use case guidance

### 10.5 Object Index for Cross-Chunk Objects
- Object index array tracks all chunks containing an object
- Efficient object reconstruction
- Query patterns

### 10.6 Consistency Guarantees
- Maintaining link consistency during writes
- Handling concurrent modifications
- Validation requirements

---

## 11. Compression and Encoding

### 11.1 Compression Overview
- Per-chunk compression
- Format-level vs. array-level compression
- Lossless vs. lossy compression

### 11.2 Draco Encoding
- **Use Cases**: Vertex positions, mesh connectivity
- **Configuration**: Compression level, quantization
- **Metadata**: Encoding parameters
- **Decoding**: Requirements for analysis operations

### 11.3 Standard Compression Codecs
- **Zarr Codecs**: Blosc, Zstd, Gzip, etc.
- **Application**: Attributes, offsets, links
- **Configuration**: Codec parameters

### 11.4 Compression Strategy
- **When to Compress**: Per-array, per-chunk decisions
- **Compression Levels**: Quality vs. size tradeoffs
- **Mixed Compression**: Different codecs for different arrays

### 11.5 Encoding Metadata
- Compression codec identification
- Codec parameters
- Decompression requirements
- Performance considerations

---

## 12. Geometry Types

### 12.1 Point Clouds
- **Structure**: Unstructured vertices
- **Attributes**: Per-point data
- **Spatial Indexing**: Direct spatial chunking
- **Multi-Resolution**: Spatial downsampling

### 12.2 Meshes
- **Types**: Triangular, quad, tetrahedral, etc.
- **Storage**: 
  - Option 1: Draco-encoded (positions + connectivity)
  - Option 2: Separate positions + face arrays
- **Links Array**: Face connectivity (if not Draco)
- **Multi-Resolution**: Mesh simplification

### 12.3 Skeletons
- **Structure**: Graph of vertices and edges
- **Storage**: 
  - Vertex positions
  - Parent links (tree structure)
  - Branch handling
- **Compression**: Diff encoding for sequential parents
- **Multi-Resolution**: Path simplification

### 12.4 Streamlines/Polylines
- **Structure**: Ordered sequences of points
- **Storage**: Consecutive vertices in groupings
- **Object Groupings**: One polyline per grouping entry
- **Multi-Resolution**: Point reduction along paths

### 12.5 Custom Geometries
- **Extensibility**: Metadata-driven geometry types
- **Custom Links**: User-defined connectivity
- **Validation**: Geometry-specific validation rules

---

## 13. Conformance and Validation

### 13.1 Conformance Levels
- **Level 1**: Basic structure (required arrays, metadata)
- **Level 2**: Spatial indexing
- **Level 3**: Multi-resolution
- **Level 4**: Cross-chunk linking
- **Level 5**: All optional features

### 13.2 Validation Rules
- **Structural Validation**: Zarr store structure
- **Metadata Validation**: Schema compliance
- **Data Validation**: 
  - Spatial bounds checking
  - Object consistency
  - Link validity
- **Cross-Chunk Validation**: Link consistency

### 13.3 Validation Tools
- Reference validator implementation
- Validation API
- Error reporting format

### 13.4 Compatibility
- **TRX Compatibility**: When spatial index collapses to 1D
- **OME-Zarr Compatibility**: Shared principles
- **Zarr Compatibility**: Zarr version requirements

---

## 14. Examples

### 14.1 Simple 3D Point Cloud
- Structure
- Metadata
- Access patterns
- Code examples

### 14.2 Mesh with Multi-Resolution
- Full resolution mesh
- Downsampled levels
- Draco encoding
- Access patterns

### 14.3 Skeleton with Cross-Chunk Objects
- Skeleton structure
- Parent links
- Cross-chunk linking
- Object index usage

### 14.4 2D Polylines with Attributes
- Polyline structure
- Attribute channels
- Spatial indexing
- Selective attribute access

### 14.5 Time-Series Point Cloud (XYZT)
- 4D spatial index
- Temporal chunking
- Access patterns

### 14.6 Large-Scale Distributed Write
- Concurrent write scenario
- Chunk allocation
- Consistency handling

---

## 15. Appendices

### Appendix A: JSON Schema Definitions
- Metadata schema
- Array configuration schema
- Geometry type schemas

### Appendix B: Zarr Implementation Details
- Zarr version requirements
- Ragged array encoding
- Chunking strategies
- Store backend considerations

### Appendix C: Coordinate Reference Systems
- CRS specification format
- Common CRS definitions
- Transformation handling

### Appendix D: Compression Codec Reference
- Supported codecs
- Codec parameters
- Performance characteristics

### Appendix E: Downsampling Algorithms
- Point cloud downsampling
- Mesh simplification
- Skeleton simplification
- Algorithm references

### Appendix F: Query Patterns
- Common query types
- Performance considerations
- Implementation examples

### Appendix G: Migration Guide
- From TRX format
- From LAS/LAZ
- From PLY/OBJ
- From other formats

### Appendix H: Performance Considerations
- Chunk size selection
- Chunking strategy optimization
- Compression tradeoffs
- Access pattern optimization

### Appendix I: Extensibility
- Custom geometry types
- Custom metadata
- Extension points
- Version evolution

### Appendix J: References
- TRX specification
- Zarr specification
- OME-Zarr specification
- Related formats and standards
- Academic references

### Appendix K: Change Log
- Version history
- Breaking changes
- Deprecations

---

## Notes for Specification Development

### Priority Sections (MVP)
1. Sections 1-4: Core concepts and data model
2. Section 5: Zarr store structure
3. Section 6: Spatial indexing (basic)
4. Section 7: Core arrays (vertices, attributes, groupings)
5. Section 8: Metadata (basic structure)
6. Section 13: Conformance (Level 1)

### Secondary Priority
- Section 9: Multi-resolution (can start simple)
- Section 11: Compression (basic codecs first)
- Section 12: Geometry types (point clouds, meshes first)

### Advanced Features
- Section 10: Cross-chunk linking (complex, can be v1.1)
- Section 7.4-7.6: Optional arrays
- Advanced compression (Draco)

### Implementation Considerations
- Start with regular spatial grid (not hierarchical)
- Support both raw and compressed data
- Make cross-chunk linking optional initially
- Provide clear migration path from TRX

