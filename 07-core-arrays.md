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

## 7.3 Vertex Group Offsets Array (Optional)

- **Name**: `vertex_group_offsets`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (byte offsets)
- **Layout**: Per spatial chunk, K × 2 array where K = number of vertex groups. Row k is `[vertex_offset, link_offset]`:
  - `vertex_offset`: byte offset of vertex group k in the corresponding `vertices` chunk
  - `link_offset`: byte offset of vertex group k's links in the corresponding `links` chunk
- **Semantics**:
  - Enables direct extraction of vertices and links for a subset of vertex groups given vertex group indices from the object index
  - End of group k's data: use offsets from row k+1 (or chunk end for last group)
  - Supports range reads when storage backend allows partial chunk reads (e.g., HTTP Range on object stores)
  - Required when using variable-length encoding (e.g., Draco) or when efficient object-level reads are desired

## 7.4 Groupings Array

- **Name**: `groupings`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (offsets) or variable
- **Semantics**:
  - Defines groups of consecutive vertices forming objects
  - Offset format: position indices or byte offsets (for Draco)
  - Enables single range read for object vertices

## 7.5 Vertex Links Array (Optional)

- **Name**: `links`
- **Dimensions**: `(spatial_index_dims..., ragged_dim)`
- **Data Type**: Integer (vertex indices)
- **Semantics**:
  - Parent-child relationships (skeletons)
  - Face connectivity (meshes)
  - Edge connectivity (graphs)
  - Compression: diff encoding for sequential links

## 7.6 Object Index Array (Optional)

- **Name**: `object_index`
- **Dimensions**: `(object_id_dim, spatial_ref_dim, ragged_dim)`
- **Data Type**: Integer
- **Semantics**:
  - Maps object IDs to spatial locations
  - Enables finding all chunks containing an object
  - Format: `(spatial_chunk_coords, vertex_group_index)` (or grouping_index)
  - When `vertex_group_offsets` is present: use vertex_group_index to look up row k; offsets[k] gives `[vertex_offset, link_offset]` for direct extraction of that object's vertices and links from the chunk

## 7.7 Cross-Chunk Links Array (Optional)

- **Name**: `cross_chunk_links`
- **Dimensions**: `(link_count, vertex_ref_dim)`
- **Data Type**: Integer
- **Semantics**:
  - Links vertices across spatial chunks
  - Format: `(spatial_chunk_coords + vertex_offset, ...)`
  - Alternative to boundary deduplication






