# 8. Metadata

## 8.1 Metadata Structure

- **Zarr Standard Metadata**: `.zattrs`, `.zgroup`
- **Format-Specific Metadata**: Custom JSON structure
- **Schema Validation**: JSON Schema specification

## 8.2 Root-Level Metadata

- Format version
- Spatial index definition
- Coordinate system information
- Resolution levels
- Geometry types supported
- Compression methods used

## 8.3 Resolution Level Metadata

- Resolution level identifier
- Downsampling factor
- Spatial chunk configuration
- Array configurations
- Compression settings
- **object_index_convention** (optional): When `"identity"`, the `object_index` array is omitted. **Only valid when there is a single spatial chunk.** Object IDs equal vertex group indices (object_id = vertex_group_index). Use for single-chunk stores (e.g. TRX-aligned DTI, small point clouds). When multiple spatial chunks exist, `object_index` is required.
- **links_convention** (optional): When `"implicit_sequential"`, connectivity within a vertex group is implicit (vertex i → vertex i+1). The `links` array may be omitted if there is no branching (e.g. streamlines, polylines). When `"implicit_sequential_with_branches"`, sequential links (parent = i−1) within a vertex group are implicit; the `links` array stores only branch links (parent ≠ i−1) and links connecting vertex groups. Reduces storage for skeletons where most nodes are sequential.

## 8.4 Array-Level Metadata

- Data types
- Dimensions and shapes
- Chunking strategy
- Compression codec and parameters
- Encoding method (raw, Draco, etc.)

## 8.5 Object-Level Metadata

- Object properties
- Object type (mesh, skeleton, polyline, etc.)
- Object identifiers
- Custom attributes

## 8.6 Group-Level Metadata

- Group properties
- Group hierarchy
- Shared attributes

## 8.7 Point-Level Metadata

- Stored in attributes array
- Channel definitions
- Attribute schemas

## 8.8 Coordinate Reference System (CRS)

- follows RFC 4 and 5 of ome-zarr






