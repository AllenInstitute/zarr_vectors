# 5. Zarr Store Structure

## 5.1 Root Structure

A Zarr Vectors store is a **Zarr v3 group** at its root.

The canonical file extension is `.zarrvectors`; `.zv` is an accepted
short form.  Nothing in the format reads the extension, and a store
without one is valid.

The on-disk layout (`GROUP` and `ARRAY` mark each node's Zarr node
type; cell files sit at `<array>/c/<i>/<j>/<k>`):

```
<store>/
├── zarr.json                          # root attributes: zarr_conventions,
│                                       #   zarr_vectors {kind: "root", zv_version, axes,
│                                       #     chunk_shape, bounds, geometry_types, ...},
│                                       #   multiscales {layout}, proj:projjson?, ome?
├── 0/                                 # GROUP — full-resolution level (required)
│   ├── zarr.json                      # "zarr_vectors": {kind: "level", level: 0, ...}
│   ├── vertices/                      # ARRAY — vlen-bytes over the chunk grid
│   │   ├── zarr.json                  #   shape = grid_shape, chunks = (1,)*ndim;
│   │   │                              #   kind "vertices", dtype, encoding,
│   │   │                              #   nonempty_chunks, chunk_grid_origin?
│   │   └── c/<i>/<j>/<k>              #   one cell = one spatial chunk's vertex bytes
│   ├── vertex_fragments/              # ARRAY — same grid as vertices
│   │   ├── zarr.json                  #   kind "vertex_fragments"
│   │   └── c/<i>/<j>/<k>              #   fragment-index blob (see §7.3)
│   ├── link_fragments/                # ARRAY — same grid; keyed by CHUNK ALONE
│   │   ├── zarr.json                  #   (no delta, no offsets segment)
│   │   └── c/<i>/<j>/<k>              #   partitions links/0/<all-zero offsets>
│   ├── vertex_attributes/             # GROUP
│   │   └── <name>/                    # ARRAY — kind "vertex_attribute";
│   │       ├── zarr.json              #   row-aligned to vertices
│   │       └── c/<i>/<j>/<k>
│   ├── fragment_attributes/           # GROUP
│   │   └── <name>/                    # ARRAY — kind "fragment_attribute";
│   │       ├── zarr.json              #   row-aligned to vertex_fragments
│   │       └── c/<i>/<j>/<k>
│   ├── links/                         # GROUP
│   │   ├── 0/                         # GROUP — level delta 0; kind "links_family":
│   │   │   │                          #   link_width, sid_ndim, directed, store,
│   │   │   │                          #   num_links, num_physical_records
│   │   │   ├── 0.0.0/                 # ARRAY — kind "links"; offsets all zero
│   │   │   │   ├── zarr.json          #   ⇒ intra-chunk; flat rows + link_fragments
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
│   │       └── 0/                     # GROUP — kind "link_attribute_family";
│   │           │                      #   mirrors links/0/
│   │           ├── 0.0.0/             # ARRAY — kind "link_attribute"; same
│   │           │   ├── zarr.json      #   offsets, cells, row order
│   │           │   └── c/<i>/<j>/<k>
│   │           └── 0.0.+1/
│   │               └── …
│   ├── object_index/                  # GROUP — kind "object_index"; layout (§7.6)
│   │   ├── zarr.json
│   │   ├── manifests/                 # ARRAY — vlen layouts: one blob per object
│   │   ├── object_ids/                # ARRAY — int64 id per row (v2 and dense)
│   │   ├── manifest_spans/            # ARRAY — dense layout: (n_objects, 2)
│   │   └── manifest_blocks/           # ARRAY — dense layout: (n_blocks, sid_ndim+1)
│   ├── object_attributes/             # GROUP
│   │   └── <name>/                    # ARRAY — kind "object_attribute";
│   │       ├── zarr.json              #   dense (B,) or (B, C)
│   │       └── c/<n>[/<m>]
│   ├── groups/                        # ARRAY — kind "groups"; 1-D vlen-bytes, (G,)
│   │   ├── zarr.json                  #   ragged: object ids per group
│   │   └── c/0
│   ├── group_attributes/              # GROUP
│   │   └── <name>/                    # ARRAY — kind "group_attribute";
│   │       ├── zarr.json              #   dense (G,) or (G, C)
│   │       └── c/0[/0]
│   └── octree_chunks/                 # GROUP — only on a level with octree
│       ├── leaves/                    #   chunks (capability "octree_chunks");
│       └── cells/                     #   leaf and cell tables (§6)
├── 1/                                 # optional coarser level
│   ├── zarr.json                      # level object; carries bin_shape, bin_ratio,
│   │                                  #   and may override "chunk_shape"
│   ├── vertices/ …
│   ├── links/
│   │   ├── 0/                         # intra-level records at this level
│   │   │   └── 0.0.0/, 0.0.+1/, …
│   │   └── +1/                        # optional fine→coarse links
│   │       └── …
│   └── …
├── N/
└── parametric/                        # optional GROUP — kind "parametric":
    ├── zarr.json                      #   parametric_types
    ├── objects/                       # ARRAY — kind "parametric_objects":
    │                                  #   type id, then coefficients
    ├── names/                         # ARRAY — kind "parametric_names"
    ├── object_attributes/
    ├── groups/
    └── group_attributes/
```

A cross-chunk link is a record in `links/<delta>/<offsets>/` with
non-zero offsets; an intra-chunk link has all-zero offsets
([§10.6](10-cross-chunk-linking.md#106-on-disk-layout-the-links-family)).

## 5.2 Zarr Version Requirements

- **Required Zarr version**: v3.
- **Per-chunk array layout**: every per-spatial-chunk array —
  `vertices`, `vertex_fragments`, `link_fragments`,
  `links/<delta>/<offsets>`, `vertex_attributes/<name>`,
  `fragment_attributes/<name>`,
  `link_attributes/<name>/<delta>/<offsets>` — is **one** Zarr v3
  vlen-bytes array whose shape is the level's chunk grid, with inner
  chunks of `(1,)*sid_ndim`: one cell per spatial chunk, at
  `<array>/c/<i>/<j>/<k>`.  The fill value is the empty byte string,
  so an empty chunk writes no file.
- **Grid origin**: the chunk at absolute coord `c` occupies cell
  `c - origin`, with `origin = floor(min_corner / chunk_shape)` from
  the root `bounds`.  The origin is stored as `chunk_grid_origin` in
  the array's `zarr_vectors` object only when non-zero; absent means
  chunk coords are array indices.
- **Presence**: each per-chunk array's `zarr_vectors.nonempty_chunks`
  lists its occupied cells as dot-separated absolute chunk keys
  (`"0.0.1"`, `"-1.-1.-1"`), so a reader enumerates them without
  listing the store.  It is absent only while the level's presence is
  deferred ([§8.3](08-metadata.md#deferred-presence)); a reader MUST
  then take presence from the store instead of treating the array as
  empty.
- **Sharding**: optional.  The root's `shard_shape`
  ([§8.2](08-metadata.md#82-root-level-metadata)) is the writer
  default in cells per shard; each array's own `zarr.json` says how it
  is packed.  Sharded arrays use Zarr v3's `sharding_indexed` codec, or,
  on a store whose root sets `octree_sharding`, the registered
  `octree_sharding` codec (Appendix D): same keys, cells and inner
  codecs, with a sparse Z-ordered shard index.  A reader without that
  codec cannot read those arrays (Zarr refuses an unknown codec).
- **Octree chunks**: optional, per level
  ([§6.5](06-spatial-indexing.md#65-octree-chunks)).  Such a level
  stores one cell per octree leaf, and its per-chunk arrays end their
  cell codecs with the pass-through marker codec
  `zarr_vectors_octree_chunks`, so an unaware Zarr reader stops instead
  of misreading leaves as uniform cells.
- **Non-spatial arrays**: `object_index/manifests` and `groups` are 1-D
  vlen-bytes arrays; `object_index/object_ids`, `manifest_spans` and
  `manifest_blocks` are dense integer arrays
  ([§7.6](07-core-arrays.md#76-object-index));
  `object_attributes/<name>` and `group_attributes/<name>` are dense
  numeric arrays.  Each is a single Zarr array at its logical path.
- **No ragged-array codec**: ragged structure inside a cell is the
  byte layout of [§7](07-core-arrays.md); Zarr does storage and
  compression, not record framing.
- **Codecs**: no compressor by default — cells go through the
  `vlen-bytes` serializer alone.  A `compressor` chosen at store
  creation fixes the pipeline for the life of the store; `"blosc"`
  means Blosc(Zstd, BITSHUFFLE, `clevel=5`).  See
  [§11](11-compression-and-encoding.md).

## 5.3 Store Backend Requirements

Zarr Vectors stores work on any Zarr v3 store implementation:

- **Object stores**: S3, GCS, Azure Blob (via fsspec or
  store-specific adapters).
- **Filesystems**: POSIX, distributed FS, in-memory.
- **Transactional backends**: icechunk and similar enable safe
  concurrent appends to `object_index/`.

Concurrency:

- Writes to different spatial chunks are independent: each cell is its
  own chunk file.
- `nonempty_chunks` is array-wide shared state, so independent
  per-cell writers MUST NOT each update it.  Their level declares
  `presence: "deferred"`, and a coordinator derives every array's
  `nonempty_chunks` afterwards and removes the declaration
  ([§8.3](08-metadata.md#deferred-presence)).
- `object_index/` arrays and `groups` are per-level shared arrays;
  writers serialize updates or use a transactional backend.
- In a sharded array the shard, not the cell, is the unit of
  atomicity: writers touching the same shard must serialize.
- Link record counts must be finalized *before* the store is sharded,
  because a shard's contents can no longer be counted from chunk-file
  names.

Per-blob writes are atomic on common backends; multi-blob updates are
not and must be serialized when needed.

## 5.4 Naming Conventions

Canonical array names:

| Name                            | Description |
|---------------------------------|-------------|
| `vertices`                      | vertex byte blobs, one cell per spatial chunk                |
| `vertex_fragments`              | fragment index over `vertices`, cell-for-cell                |
| `link_fragments`                | fragment index over the intra-chunk link array at delta 0; keyed by **chunk alone** |
| `links`                         | connectivity family — per-(delta, offsets, chunk) link records |
| `vertex_attributes`             | per-(name, chunk) attribute blobs, row-aligned to vertices   |
| `fragment_attributes`           | per-(name, chunk) attribute blobs, row-aligned to vertex_fragments |
| `link_attributes`               | per-(name, delta, offsets, chunk) attribute blobs mirroring `links` |
| `object_index`                  | group holding the object manifests in the layout its `layout` field names — `manifests` (+ `object_ids`), or `manifest_spans` + `manifest_blocks` + `object_ids` ([§7.6](07-core-arrays.md#76-object-index)) |
| `object_attributes`             | per-(name) dense object-row arrays                           |
| `groups`                        | ragged array — object ids per group                          |
| `group_attributes`              | per-(name) dense group-row arrays                            |

`links/<delta>`, `link_attributes/<name>/<delta>` and `object_index`
are **groups**: the first two hold one array per offsets segment and
carry the family policy, `object_index` holds the arrays of its
manifest layout.  A level with octree chunks also has an
`octree_chunks/` group (`leaves`, `cells`), and a store with
parametric objects has a root-level `parametric/` group.

Resolution level groups are named as bare integers (`0/`, `1/`, …,
`N/`), matching OME-Zarr image-pyramid level naming.

Every node with Zarr Vectors metadata — the root, each level, each
array and family group, `object_index/` and `parametric/` — keeps it in
**one** attribute of its `zarr.json`, `zarr_vectors`, whose `kind` names
the node (`root`, `level`, `parametric`, or an array kind), and
registers the convention in `zarr_conventions`.  Plain container groups
and the arrays inside `object_index/` carry neither.  The root also
carries `multiscales`, and optionally `proj:projjson`, `ome` and
`user_metadata` (application metadata, never inside `zarr_vectors`).
See [§8](08-metadata.md).
