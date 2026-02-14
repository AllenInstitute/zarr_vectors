# 4. Data Model

## 4.1 Hierarchical Organization

```
Zarr Store Root
├── Root Metadata
│   ├── Defines Spatial Index Dimensions (SID) [XY, XYZ, XYZT, etc]]
├── Resolution Level 0 (full resolution)
│   ├── Vertex Positions Array
|   |   ├── SID shaped zarr with chunk_scheme CS, chunk = ragged array of N SID dimension points or meshes, written as sequences of K vertex groups. Chunk encoding can be represented by different codecs.  For, example vertex group could be compressed as a draco point cloud or mesh.
|   ├── Vertex Group Offsets Array (if relevant)
|   |   ├── SID shaped zarr with chunk_scheme CS, chunk = K x 2 ragged array of byte offsets. Each row [vertex_offset, link_offset] gives the start byte offset for that vertex group in the corresponding vertex positions chunk and vertex links chunk. Enables range reads to extract vertices and links for a subset of vertex groups without reading the full chunk.
│   ├── Vertex Links Array (if relevant)
|   |   ├── SID shaped zarr with chunk_scheme CS, chunk = ragged array of M x L array of links (L=1 for skeleton/streamline parents, L=3 for triangle faces, L=4 for tetrahedral meshes)
│   ├── Vertex Attributes Arrays (optional)
|   |   ├── attribute1 SID + C shaped zarr with chunk scheme CS + (something for C), chunk is ragged array of N x C chunk size array of attribute data 
|   |   ├── attribute2 SID + C shaped zarr, with chunk scheme CS + (something for C) chunk is ragged array of N x C chunk size array of second set of attribute data
|   |   ├── ...
│   ├── Object Index Array
|   |   ├── O x ragged array of multiples of len(SID)+1 zarr array. Each entry references manifest of SID chunk + vertex group index of items that should be included for this object.  For example in an XYZ SID,[ [[1,1,1,1], [1,1,1,2]], [[1,1,1,3] , [1,1,2,1], [1,1,2,2] ], would indicate that there are 2 objects. The first has 2 vertex groups, involving the first two vertex groups of chunk 1,1,1.  The second is composed of three vertex groups, the 3rd group of chunk 1,1,1 and the first two vertex groups of chunk 1,1,2. 
│   ├── Object Attributes Arrays (optional)
|   |   ├── attribute1: O x C shaped zarr array of object level attributes
|   |   ├── attribute2: O x C shaped zarr array of object level attributes
|   |   ├── ...
│   ├── Object Groupings Array (optional)
|   |   ├── G x ragged array of Object indices that belong to a group. i.e. [[0,1], [1,2], [3,4,5]]  group 0 has objects 0 and 1, group 1 has objects 1 and 2, group 2 has objects 3,4,5. 
│   ├── Groupings Attribute arrays
|   |   ├── attribute1: G x C shapped zarr array of group level attributes
|   |   ├── ...
│   └── Metadata
├── Resolution Level 1 (downsampled)
│   └── [Same structure]
└── Resolution Level N
```

## 4.2 Spatial Index Model

- **Dimensions**: N spatial dimensions (X, Y, Z, T, ...)
- **Coordinate System**: Specified in metadata (CRS, units, origin)
- **Chunking Strategy**: Regular grid (extensible to hierarchical)
- **Chunk Size**: Configurable per dimension
- **Boundary Handling**: Specified in metadata

## 4.3 Vertex Model

- **Position**: N-dimensional coordinates (same as spatial index)
- **Attributes**: Arbitrary number of attribute channels
- **Object Membership**: Vertex belongs to zero or more objects
- **Links**: Connections to other vertices (for graphs/meshes)

## 4.4 Object Model

- **Definition**: Collection of vertices forming a geometric entity
- **Storage**: Consecutive vertices in arrays
- **Metadata**: Object-level attributes
- **Cross-Chunk Objects**: Objects spanning multiple spatial chunks

## 4.5 Group Model

- **Definition**: Collection of objects with shared properties
- **Metadata**: Group-level attributes
- **Hierarchy**: Groups may contain sub-groups






