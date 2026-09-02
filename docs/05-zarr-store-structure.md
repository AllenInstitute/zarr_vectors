# 5. Zarr Store Structure

## 5.1 Root Structure

A ZV store is a **Zarr v3 group** at its root.  Its on-disk layout
(below — `GROUP` and `ARRAY` mark each node's Zarr node type; cell files
sit under each array's `c/` sub-tree at `c/<i>/<j>/<k>`):

```
<store>/
├── zarr.json                          # root group metadata; carries:
│                                       #   "multiscales": [{"axes":[...], "datasets":[...]}]
│                                       #   "zarr_vectors": { zv_version, chunk_shape,
│                                       #                     bounds, geometry_types,
│                                       #                     conventions, capabilities, ... }
├── 0/                                 # GROUP — full-resolution level (required)
│   ├── zarr.json                      # group metadata; "zarr_vectors_level": {...}
│   ├── vertices/                      # ARRAY — vlen-bytes over the chunk grid
│   │   ├── zarr.json                  #   shape = grid_shape, chunks = (1,)*ndim;
│   │   │                              #   attrs: chunk_grid_origin, nonempty_chunks
│   │   └── c/<i>/<j>/<k>              #   one cell = one spatial chunk's vertex bytes
│   ├── vertex_fragments/              # ARRAY — same grid as vertices
│   │   ├── zarr.json
│   │   └── c/<i>/<j>/<k>              #   fragment-index blob (see §7.3)
│   ├── link_fragments/                # ARRAY — same grid; keyed by CHUNK ALONE
│   │   ├── zarr.json                  #   (no delta, no offsets segment)
│   │   └── c/<i>/<j>/<k>              #   partitions links/0/<all-zero offsets>
│   ├── vertex_attributes/             # GROUP
│   │   └── <name>/                    # ARRAY — row-aligned to vertices
│   │       ├── zarr.json
│   │       └── c/<i>/<j>/<k>
│   ├── fragment_attributes/           # GROUP
│   │   └── <name>/                    # ARRAY — row-aligned to vertex_fragments
│   │       ├── zarr.json
│   │       └── c/<i>/<j>/<k>
│   ├── links/                         # GROUP
│   │   ├── 0/                         # GROUP — level delta 0; zarr.json carries
│   │   │   │                          #   the family policy: link_width, sid_ndim,
│   │   │   │                          #   directed, store, num_links
│   │   │   ├── 0.0.0/                 # ARRAY — offsets all zero ⇒ intra-chunk
│   │   │   │   ├── zarr.json          #   has_perm=false; flat rows + link_fragments
│   │   │   │   └── c/<i>/<j>/<k>      #   cell = the record's SOURCE chunk
│   │   │   ├── 0.0.+1/                # ARRAY — other endpoint one chunk along +z
│   │   │   │   ├── zarr.json          #   inline ragged blob; no sidecar
│   │   │   │   └── c/<i>/<j>/<k>
│   │   │   └── 0.+1.0/                # ARRAY — one per distinct offsets segment
│   │   │       └── …
│   │   └── +1/                        # GROUP — optional cross-level (see §9.6)
│   │       └── …
│   ├── link_attributes/               # GROUP
│   │   └── <name>/                    # GROUP
│   │       └── 0/                     # GROUP — mirrors links/0/
│   │           ├── 0.0.0/             # ARRAY — same offsets, cells, row order
│   │           │   ├── zarr.json
│   │           │   └── c/<i>/<j>/<k>
│   │           └── 0.0.+1/
│   │               └── …
│   ├── object_index/                  # GROUP
│   │   ├── zarr.json                  #   num_objects, num_present, sid_ndim,
│   │   │                              #   layout = "vlen_manifests_v1"
│   │   └── manifests/                 # ARRAY — 1-D vlen-bytes, (num_objects,)
│   │       ├── zarr.json
│   │       └── c/<n>                  #   manifest-block blob per OID (§7.6)
│   ├── object_attributes/             # GROUP
│   │   └── <name>/                    # ARRAY — dense (B,) or (B, C)
│   │       ├── zarr.json
│   │       └── c/<n>[/<m>]
│   ├── groups/                        # ARRAY — 1-D vlen-bytes, (G,)
│   │   ├── zarr.json                  #   ragged: object ids per group
│   │   └── c/0
│   └── group_attributes/              # GROUP
│       └── <name>/                    # ARRAY — dense (G,) or (G, C)
│           ├── zarr.json
│           └── c/0[/0]
├── 1/                                 # optional coarser level
│   ├── zarr.json                      # may override "chunk_shape"
│   ├── vertices/ …
│   ├── links/
│   │   ├── 0/                         # intra-level records at this level
│   │   │   └── 0.0.0/, 0.0.+1/, …
│   │   └── +1/                        # optional fine→coarse links
│   │       └── …
│   └── …
└── N/
```

A link that crosses a chunk boundary is a record in
`links/<delta>/<offsets>/` whose offsets are non-zero; an intra-chunk
link is one whose offsets are all zero.  See
[§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family).


## 5.2 Zarr Version Requirements

- **Required Zarr version**: v3.
- **Per-chunk array layout**: every per-spatial-chunk array —
  `vertices`, `vertex_fragments`, `link_fragments`,
  `links/<delta>/<offsets>`, `vertex_attributes/<name>`,
  `fragment_attributes/<name>`,
  `link_attributes/<name>/<delta>/<offsets>` — is **one** Zarr v3
  vlen-bytes array whose shape is the level's chunk grid.  Inner
  chunks are `(1,)*sid_ndim`, so one Zarr chunk holds exactly one
  spatial chunk's payload and its file lands at `<array>/c/<i>/<j>/<k>`.
  The fill value is the empty byte string, so an empty spatial chunk
  writes no file at all.
- **Grid origin**: a spatial chunk at absolute coord `c` occupies cell
  `c - origin`, where `origin = floor(min_corner / chunk_shape)` from
  the root `bounds`.  The origin is stored as the array's
  `chunk_grid_origin` attribute **only when it is non-zero**; its
  absence means chunk coords are array indices directly.  This is what
  lets data with negative coordinates map onto a 0-indexed array.
- **Presence**: each per-chunk array carries a `nonempty_chunks`
  attribute — the list of its occupied cells as dot-separated chunk
  keys — so a reader enumerates occupied chunks in O(1) rather than by
  listing the store.
- **Sharding**: optional.  A `shard_shape` wraps the cells in Zarr v3's
  native `sharding_indexed` codec; nothing else about the layout
  changes.  There is no ZV-specific shard format.
- **Non-spatial arrays**: `object_index/manifests` and `groups` are 1-D
  vlen-bytes arrays; `object_attributes/<name>` and
  `group_attributes/<name>` are dense numeric arrays.  Each is a single
  Zarr array at its logical path.
- **No ragged-array codec required**: ragged structure inside a cell is
  expressed by the byte-blob layouts documented in
  [§7](07-core-arrays.md); Zarr handles storage and compression, not
  record framing.
- **Codecs used**: **no compressor by default** — cells are written
  through the `vlen-bytes` serializer alone, which keeps the fast
  async-PUT path open.  A `compressor` chosen at store creation fixes
  the pipeline for the life of the store; the `"blosc"` shorthand
  resolves to Blosc(Zstd, BITSHUFFLE, `clevel=5`).  See
  [§11](11-compression-and-encoding.md).

## 5.3 Store Backend Requirements

ZV stores work on any Zarr v3 store implementation:

- **Object stores**: S3, GCS, Azure Blob (via fsspec or
  store-specific adapters).
- **Filesystems**: POSIX, distributed FS, in-memory.
- **Transactional backends**: icechunk and similar enable safe
  concurrent appends to `object_index/` 

Concurrency:

- Writes to different spatial chunks are independent — each chunk's
  cell in `vertices`, `vertex_fragments`, the link arrays, and the
  attribute arrays can be authored without coordination, because each
  cell is its own chunk file.
- The `nonempty_chunks` attribute is array-wide shared state, so
  independent per-cell writers must **not** each update it.  They write
  cells without recording presence and a coordinator derives the
  attribute afterwards in one pass.
- `object_index/manifests` and `groups` are global per-level arrays;
  writers either serialize updates or rely on a transactional backend.
- When a per-chunk array is **sharded**, the shard file — not the cell —
  is the unit of file-level atomicity.  Concurrent writers touching
  cells in different shards are independent; two writers touching the
  same shard must serialize.
- **Ordering**: link record counts must be finalized *before* the store
  is sharded.  Once cells are packed into shards, a shard's inner index
  is no longer derivable from chunk-file names, so a count that was
  going to be derived by listing can no longer be recovered.

Atomicity is per Zarr's storage model (per-blob writes are atomic on
common backends; multi-blob updates are not atomic and must be
serialized when needed).

## 5.4 Naming Conventions

Canonical array names — these match `ALL_ARRAY_NAMES` in the
implementation (`zarr_vectors.constants`):

| Name                            | Description |
|---------------------------------|-------------|
| `vertices`                      | vertex byte blobs, one cell per spatial chunk                |
| `vertex_fragments`              | fragment index over `vertices`, cell-for-cell                |
| `link_fragments`                | fragment index over the intra-chunk link array at delta 0; keyed by **chunk alone** |
| `links`                         | connectivity family — per-(delta, offsets, chunk) link records |
| `vertex_attributes`             | per-(name, chunk) attribute blobs, row-aligned to vertices   |
| `fragment_attributes`           | per-(name, chunk) attribute blobs, row-aligned to vertex_fragments |
| `link_attributes`               | per-(name, delta, offsets, chunk) attribute blobs mirroring `links` |
| `object_index`                  | group holding `manifests`, one manifest-block blob per object ([§7.6](07-core-arrays.md#76-object-index)) |
| `object_attributes`             | per-(name) dense object-row arrays                           |
| `groups`                        | ragged array — object ids per group                          |
| `group_attributes`              | per-(name) dense group-row arrays                            |

Two of these are **groups, not arrays**: `links/<delta>` and
`link_attributes/<name>/<delta>` each hold one array per distinct
relative-offset segment and carry the family-wide policy in their own
`zarr.json`.  `object_index` is likewise a group, holding the single
`manifests` array.

Resolution level groups are named as bare integers (`0/`, `1/`, …,
`N/`), matching OME-Zarr image-pyramid level naming.

Metadata is carried under Zarr v3's standard `zarr.json` files; ZV
extends each `zarr.json` with a namespaced sub-object:

- root: `zarr.json["zarr_vectors"]` for ZV fields and
  `zarr.json["multiscales"]` for NGFF axes (RFC 4) + per-level
  datasets entry,
- per-level group: `zarr.json["zarr_vectors_level"]`,
- per-array group: `zarr.json["zv_array"]` discriminator plus a small
  shape/dtype block.
