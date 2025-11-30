# 12. Geometry Types

## 12.1 Point Clouds

- **Structure**: Unstructured vertices
- **Attributes**: Per-point data
- **Spatial Indexing**: Direct spatial chunking
- **Multi-Resolution**: Spatial downsampling

## 12.2 Meshes

- **Types**: Triangular, quad, tetrahedral, etc.
- **Storage**: 
  - Option 1: Draco-encoded (positions + connectivity)
  - Option 2: Separate positions + face arrays
- **Links Array**: Face connectivity (if not Draco)
- **Multi-Resolution**: Mesh simplification

## 12.3 Skeletons

- **Structure**: Graph of vertices and edges
- **Storage**: 
  - Vertex positions
  - Parent links (tree structure)
  - Branch handling
- **Compression**: Diff encoding for sequential parents
- **Multi-Resolution**: Path simplification

## 12.4 Streamlines/Polylines

- **Structure**: Ordered sequences of points
- **Storage**: Consecutive vertices in groupings
- **Object Groupings**: One polyline per grouping entry
- **Multi-Resolution**: Point reduction along paths

## 12.5 Custom Geometries

- **Extensibility**: Metadata-driven geometry types
- **Custom Links**: User-defined connectivity
- **Validation**: Geometry-specific validation rules

