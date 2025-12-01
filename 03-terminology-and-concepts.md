# 3. Terminology and Concepts

## 3.1 Core Terms

- **Spatial Index**: N-dimensional coordinate system for organizing data (may include time)
- **Spatial Chunk**: A region in spatial index space containing vector data
- **Vertex**: A point in N-dimensional space with associated data
- **Vertex Group**: A set of vertices contained within a spatial chunk that are decoded in a from a contiguous set of bytes
- **Object**: A collection of vertices forming a geometric entity (mesh, polyline, etc.) that spans all spatial chunks
- **Group**: A collection of objects with shared metadata
- **Ragged Array**: Variable-length arrays within spatial chunks
- **Channel Dimension**: Dimension for attribute metadata on vertices, objects, or groups (e.g., gene expression channels, streamline source and target region, cell-type name)

## 3.2 Geometry Terms

- **Point Cloud**: Unstructured collection of points
- **Mesh**: Connected vertices forming surfaces or volumes
- **Skeleton**: Graph structure representing topology
- **Streamline/Polyline**: Ordered sequence of connected points
- **Path**: A connected sequence within a skeleton

## 3.3 Storage Terms

- **Zarr Store**: The underlying Zarr storage (filesystem, object store, etc.)
- **Zarr Array**: A multi-dimensional array in Zarr format
- **Chunk**: Zarr's unit of storage (may differ from spatial chunk)
- **Metadata**: Structured information about data organization

## 3.4 Indexing Terms

- **Spatial Index Chunk**: A region in spatial index space
- **Object Index**: Index mapping object IDs to spatial locations
- **Cross-Chunk Link**: Connection between objects in different spatial chunks
- **Resolution Level**: A level in the multi-resolution hierarchy

