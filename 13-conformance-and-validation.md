# 13. Conformance and Validation

## 13.1 Conformance Levels

- **Level 1**: Basic structure (required arrays, metadata)
- **Level 2**: Spatial indexing
- **Level 3**: Multi-resolution
- **Level 4**: Cross-chunk linking
- **Level 5**: All optional features

## 13.2 Validation Rules

- **Structural Validation**: Zarr store structure
- **Metadata Validation**: Schema compliance
- **Data Validation**: 
  - Spatial bounds checking
  - Object consistency
  - Link validity
- **Cross-Chunk Validation**: Link consistency

## 13.3 Validation Tools

- Reference validator implementation
- Validation API
- Error reporting format

## 13.4 Compatibility

- **TRX Compatibility**: When spatial index collapses to 1D
- **OME-Zarr Compatibility**: Shared principles
- **Zarr Compatibility**: Zarr version requirements

