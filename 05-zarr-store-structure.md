# 5. Zarr Store Structure

## 5.1 Root Structure

- Zarr group at root
- Required metadata files
- Resolution level groups
- Optional extension groups

## 5.2 Zarr Version Requirements

- Minimum Zarr version: [TBD - likely v3]
- Required Zarr features:
  - Ragged array support
  - Variable-length chunks
  - [Other requirements]

## 5.3 Store Backend Requirements

- Support for object stores (S3, GCS, Azure Blob)
- Support for filesystem storage
- Concurrent access semantics
- Atomicity considerations

## 5.4 Naming Conventions

- Array names: `vertices`, `attributes`, `groupings`, `links`, `object_index`
- Resolution level names: `resolution_0`, `resolution_1`, etc.
- Metadata file: `.zattrs`, `.zgroup` (Zarr standard)
- Custom metadata: `metadata.json` or similar

