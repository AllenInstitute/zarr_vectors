# 7. Core Arrays

## 7.1 Vertex Positions Array

- **Name**: `vertices`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Float or integer (specified in metadata)
- **Encoding**: Raw or Draco-compressed (per chunk)
- **Semantics**: 
  - Each ragged element contains vertices for one spatial chunk
  - Vertices are N-dimensional coordinates
  - Spatial locality: all vertices in chunk lie within chunk bounds (with boundary exceptions)

## 7.2 Vertex Attributes Array

- **Name**: `attributes`
- **Dimensions**: `(spatial_index_dims..., channel_dim, ragged_dim)`
- **Data Type**: Specified per channel in metadata
- **Chunking Strategy**: Configurable across channel dimension
- **Semantics**:
  - Attributes aligned with vertex positions
  - Selective channel access enabled by chunking
  - Missing attributes: handling strategy

## 7.3 Object Groupings Array

- **Name**: `groupings`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (offsets) or variable
- **Semantics**:
  - Defines groups of consecutive vertices forming objects
  - Offset format: position indices or byte offsets (for Draco)
  - Enables single range read for object vertices

## 7.4 Vertex Links Array (Optional)

- **Name**: `links`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (vertex indices)
- **Semantics**:
  - Parent-child relationships (skeletons)
  - Face connectivity (meshes)
  - Edge connectivity (graphs)
  - Compression: diff encoding for sequential links

## 7.5 Object Index Array (Optional)

- **Name**: `object_index`
- **Dimensions**: `(object_id_dim, spatial_ref_dim, ragged_dim)`
- **Data Type**: Integer
- **Semantics**:
  - Maps object IDs to spatial locations
  - Enables finding all chunks containing an object
  - Format: `(spatial_chunk_coords, grouping_index)`

## 7.6 Cross-Chunk Links Array (Optional)

- **Name**: `cross_chunk_links`
- **Dimensions**: `(link_count, vertex_ref_dim)`
- **Data Type**: Integer
- **Semantics**:
  - Links vertices across spatial chunks
  - Format: `(spatial_chunk_coords + vertex_offset, ...)`
  - Alternative to boundary deduplication

