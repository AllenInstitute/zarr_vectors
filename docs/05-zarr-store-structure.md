# 5. Zarr Store Structure

## 5.1 Root Structure

A ZV store is a **Zarr v3 group** at its root.  Its on-disk layout
(below — chunk keys use the dot-separated dimensional encoding):

```
<store>/
├── zarr.json                          # root group metadata; carries:
│                                       #   "multiscales": [{"axes":[...], "datasets":[...]}]
│                                       #   "zarr_vectors": { zv_version, chunk_shape,
│                                       #                     bounds, geometry_types,
│                                       #                     conventions, capabilities, ... }
├── 0/                                 # full-resolution level (required)
│   ├── zarr.json                      # group metadata; "zarr_vectors_level": {...}
│   ├── vertices/
│   │   ├── zarr.json                  # 1-D uint8 single-chunk-per-coord
│   │   ├── <i.j.k>                    # raw or Draco vertex bytes
│   │   └── …
│   ├── vertex_fragments/
│   │   ├── zarr.json
│   │   ├── <i.j.k>                    # fragment-index blob (see §7.3)
│   │   └── …
│   ├── links/
│   │   ├── 0/                         # delta = 0 (same level)
│   │   │   ├── zarr.json              # carries link_width, num_links
│   │   │   ├── <i.j.k>
│   │   │   └── …
│   │   └── +1/                        # delta = +1 (optional, see §9.6)
│   │       └── …
│   ├── link_fragments/
│   │   ├── zarr.json
│   │   ├── <i.j.k>                    # parallels links/0/<i.j.k>
│   │   └── …
│   ├── vertex_attributes/
│   │   └── <name>/
│   │       ├── zarr.json
│   │       └── <i.j.k>                # row-aligned to vertices/<i.j.k>
│   ├── fragment_attributes/
│   │   └── <name>/
│   │       ├── zarr.json
│   │       └── <i.j.k>                # row-aligned to vertex_fragments/<i.j.k>
│   ├── link_attributes/
│   │   └── <name>/
│   │       └── 0/
│   │           └── <i.j.k>            # row-aligned to links/0/<i.j.k>
│   ├── object_index/
│   │   ├── zarr.json
│   │   └── data                       # manifest-block stream (§7.6)
│   ├── object_attributes/
│   │   └── <name>/
│   │       ├── zarr.json
│   │       └── data
│   ├── groups/
│   │   ├── zarr.json
│   │   └── data                       # ragged CSR per group → object ids
│   ├── group_attributes/
│   │   └── <name>/
│   │       └── data
│   ├── cross_chunk_links/
│   │   └── 0/
│   │       ├── zarr.json              # sid_ndim, level_delta=0, link_width, layout="sharded_v1"
│   │       ├── k1/                    # K-separated sharded vlen-bytes arrays
│   │       ├── k2/                    # (v0.8+); one kK per distinct K that
│   │       └── k3/                    # has records; 1 ≤ K ≤ link_width
│   └── cross_chunk_link_attributes/
│       └── <name>/
│           └── 0/
│               ├── zarr.json          # dtype, name, level_delta, layout="sharded_v1"
│               ├── k1/                # parallel kN attribute arrays
│               ├── k2/                # mirroring the link kN arrays
│               └── k3/
├── 1/                                 # optional coarser level
│   ├── zarr.json                      # may override "chunk_shape" (v0.7)
│   ├── vertices/ …
│   ├── links/
│   │   ├── 0/                         # intra-level edges at this level
│   │   └── +1/                        # optional fine→coarse links
│   ├── cross_chunk_links/
│   │   ├── 0/                         # same kN-array layout per level
│   │   │   ├── k1/, k2/, …
│   │   │   └── zarr.json
│   │   └── +1/                        # optional fine→coarse
│   │       ├── k1/, k2/, …
│   │       └── zarr.json
│   └── …
└── N/
```


## 5.2 Zarr Version Requirements

- **Required Zarr version**: v3.
- **Per-array layout**: every ZV array (vertices, fragments, links,
  attributes, object_index, groups, cross-chunk links, …) is a
  **1-D `uint8`, single-chunk-per-coord** array — a project-internal
  byte layout wrapped in a Zarr group.  The internal layouts (fragment
  index, manifest-block stream, link payloads) are documented in [§7](07-core-arrays.md);
  Zarr handles compression and storage, not record framing.
- **No ragged-array codec required**: ragged structure is expressed by
  the byte-blob layouts above, not by Zarr v3's variable-length-chunk
  feature.
- **Codecs used**: Blosc + Zstd (`clevel=5`, `shuffle=1`/BYTE for
  positions / attributes / fragment-index / object_index;
  `shuffle=2`/BITSHUFFLE for `links`).  See [§11](11-compression-and-encoding.md) and the
  `zarr_vectors.encoding.compression` map.

## 5.3 Store Backend Requirements

ZV stores work on any Zarr v3 store implementation:

- **Object stores**: S3, GCS, Azure Blob (via fsspec or
  store-specific adapters).
- **Filesystems**: POSIX, distributed FS, in-memory.
- **Transactional backends**: icechunk and similar enable safe
  concurrent appends to `object_index/` 

Concurrency:

- Writes to different spatial chunks are independent — each chunk's
  `vertices/<i.j.k>`, `vertex_fragments/<i.j.k>`, link payloads, and
  attribute blobs can be authored without coordination.
- `object_index/data` and `groups/data` are global per-level arrays;
  writers either serialize updates or rely on a transactional backend.
- `cross_chunk_links/<delta>/kK` arrays are sharded vlen-bytes
  arrays; concurrent writers touching cells in **different outer
  shards** are independent and need no coordination.  Two writers
  writing to the same outer shard must serialize (the shard is the
  unit of file-level atomicity).

Atomicity is per Zarr's storage model (per-blob writes are atomic on
common backends; multi-blob updates are not atomic and must be
serialized when needed).

## 5.4 Naming Conventions

Canonical array names — these match `ALL_ARRAY_NAMES` in the
implementation (`zarr_vectors.constants`):

| Name                            | Description |
|---------------------------------|-------------|
| `vertices`                      | per-chunk vertex byte blobs                                  |
| `vertex_fragments`              | per-chunk fragment index over `vertices/<chunk>`             |
| `link_fragments`                | per-chunk fragment index over `links/0/<chunk>` (delta=0 only) |
| `links`                         | per-(delta, chunk) link byte blobs                           |
| `vertex_attributes`             | per-(name, chunk) attribute blobs, row-aligned to vertices   |
| `fragment_attributes`           | per-(name, chunk) attribute blobs, row-aligned to vertex_fragments |
| `link_attributes`               | per-(name, delta, chunk) attribute blobs                     |
| `object_index`                  | flat manifest-block stream ([§7.6](07-core-arrays.md#76-object-index))                            |
| `object_attributes`             | per-(name) dense object-row arrays                           |
| `groups`                        | flat ragged CSR — object ids per group                       |
| `group_attributes`              | per-(name) dense group-row arrays                            |
| `cross_chunk_links`             | per-delta records spanning chunk boundaries                  |
| `cross_chunk_link_attributes`   | per-(name, delta) attribute blobs parallel to CCL records    |

Resolution level groups are named as bare integers (`0/`, `1/`, …,
`N/`).  The legacy `resolution_0/` / `resolution_1/` prefix was
dropped in 0.4.1 to align with OME-Zarr image-pyramid level naming.

Metadata is carried under Zarr v3's standard `zarr.json` files; ZV
extends each `zarr.json` with a namespaced sub-object:

- root: `zarr.json["zarr_vectors"]` for ZV fields and
  `zarr.json["multiscales"]` for NGFF axes (RFC 4) + per-level
  datasets entry,
- per-level group: `zarr.json["zarr_vectors_level"]`,
- per-array group: `zarr.json["zv_array"]` discriminator plus a small
  shape/dtype block.
