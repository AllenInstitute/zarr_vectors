# 6. Spatial Indexing

## 6.1 Spatial Index Definition

- **Dimensions**: Number and names of spatial dimensions
- **Coordinate System**: Reference system specification
- **Bounds**: Global bounding box
- **Chunk Size**: Size of each spatial chunk
- **Chunk Grid**: Regular grid specification

## 6.2 Spatial Chunk Addressing

- **Chunk Coordinates:**
  - For 2D: `(chunk_x, chunk_y)`
  - For 3D: `(chunk_x, chunk_y, chunk_z)`
  - For N-D: `(chunk_dim0, chunk_dim1, ..., chunk_dimN)`
- **Chunk Key Encoding**: How chunks are named in Zarr store
- **Empty Chunks**: Handling of chunks with no data

## 6.3 Spatial Query Semantics

- **Bounding Box Queries**: Which chunks intersect a bounding box
- **Point Queries**: Which chunk contains a point
- **Range Queries**: Efficient access patterns

## 6.4 Boundary Conditions

- **Chunk Boundaries**: How boundaries are defined
- **Vertex Placement**: Rules for vertices on boundaries
- **Deduplication**: Handling duplicate vertices at boundaries
- **Cross-Chunk Objects**: Objects spanning boundaries

## 6.5 Alternative Indexing Strategies

- **Hierarchical Indexing**: Octree/quadtree (future extension)
- **Hilbert Curve**: Space-filling curve indexing (future extension)
- **Custom Indexing**: Extensibility mechanism






