# 11. Compression and Encoding

## 11.1 Compression Overview

Every per-chunk array uses the `vlen-bytes` array-to-bytes codec; a
compressor, when one is chosen, follows it and applies to each cell
independently.  Fragment indexes, manifest blocks and link records live
inside the cell payload, so compression is opaque to record framing.
There is no array- or store-level compression: reading one cell costs
nothing for any other.  Sharding ([§11.6](#116-sharding)) changes how
cells are packed into stored objects, not how each cell is encoded.

## 11.2 Draco Encoding

Mesh stores MAY Draco-encode the `vertices` cells of 3-D triangle
meshes.  Each cell then holds one Draco blob with the chunk's positions
and intra-chunk faces; the intra-chunk `links/0/` array is omitted, and
faces that cross chunks stay in `links/`.

- The `vertices` metadata sets `"encoding": "draco"`; `dtype` and the
  axis count describe the decoded positions.
- Positions are quantized relative to the chunk's bounding box, so
  Draco is lossy.  The format does not pin Draco settings.
- Draco is applied by the writer inside the cell, not as a Zarr codec.
  Readers without the Draco runtime see opaque bytes.

## 11.3 Standard Compression Codecs

**The default is no compressor.**  An uncompressed cell keeps the fast
write path and stays range-readable
([§11.6.5](#1165-design-note-byte-range-reads-need-uncompressed-cells)).

A compressor is fixed when an array is created; Zarr cannot change an
existing array's codecs.  Each array declares its own pipeline in its
`zarr.json`, the mix may be heterogeneous, and a reader MUST take each
array's codecs from its own `zarr.json`.

The reference implementation's `compressor` argument applies one choice
to every per-chunk array a call creates (its low-level writers default
to none; its high-level `zarr_vectors.create()` defaults to `zstd`):

| `compressor` | Codecs after `vlen-bytes` |
|--------------|---------------------------|
| `None` (default), `"none"` | none |
| `"zstd"` | `{"name": "zstd", "configuration": {"level": 0, "checksum": false}}` |
| `"blosc"` | `{"name": "blosc", "configuration": {"cname": "zstd", "clevel": 5, "shuffle": "bitshuffle", "typesize": 4, "blocksize": 0}}` |
| a list of codec objects | the list as given |

Codecs by array kind:

| Array | Array-to-bytes | Compressor |
|-------|----------------|------------|
| Per-chunk arrays ([§7](07-core-arrays.md)) | `vlen-bytes` | writer's choice; none by default |
| `object_index/manifests`, `groups` | `vlen-bytes` | writer's choice |
| `object_index/object_ids`, `manifest_spans`, `manifest_blocks` | `bytes` | `zstd` (level 9 in the reference implementation) |
| `object_attributes/<name>`, `group_attributes/<name>` | `bytes` | writer's choice |

Bit-shuffling suits link arrays: their values are chunk-local indices
in `[0, n_vertices_in_chunk)`, so the high bits are zero.

## 11.4 Compression Strategy

Fragment indexes and manifest blocks are Zarr Vectors record framings
inside the bytes the codec pipeline sees; a reader peels the pipeline,
then runs the framing decoder.  The pipeline uses only standard codecs
(`vlen-bytes`, `bytes`, `zstd`, `blosc`, `gzip`, `crc32c`,
`sharding_indexed`, …) plus two optional ones: `octree_sharding`
([§11.6.3](#1163-the-octree_sharding-codec--optional)) and the
`zarr_vectors_octree_chunks` marker on octree levels
([§6.5](06-spatial-indexing.md#65-octree-chunks)), which leaves bytes
unchanged.

`vertex_fragments` and `link_fragments` SHOULD be left uncompressed
even where other arrays are compressed.  Their range table already
stores each run as two numbers, the remaining sparse indices barely
compress, and a box query parses one index per chunk before fetching
any vertex, so decompression latency outweighs the bytes saved.  (The
reference implementation's single `compressor` argument does compress
them; a writer that wants this split sets codecs per array.)  Stores
that must minimise size MAY instead compress at the storage layer.

## 11.5 Encoding Metadata

Each array's `zarr_vectors` object
([§7](07-core-arrays.md), [§8.4](08-metadata.md#84-array-level-metadata))
carries the encoding facts a reader needs outside the codec pipeline:

| Key | Meaning |
|-----|---------|
| `kind` | The array's role |
| `dtype` | Element dtype (`"float32"`, `"int64"`, …); the only source of it, since every per-chunk array's `data_type` is `variable_length_bytes` |
| `encoding` | `"raw"` or `"draco"` on `vertices`; `"fragment_index_v1"` on fragment indexes; `"dictionary"` on a categorical attribute |
| `row_shape` | `[]` or `[C]`; authoritative for column count and MUST NOT be overridden by `channel_names`.  A reader falls back to `len(channel_names)` only when it is absent |
| `shape`, `channel_names`, `channel_dtype` | Optional, per array kind |
| `chunk_grid_origin`, `nonempty_chunks` | Every per-chunk array ([§7](07-core-arrays.md#per-chunk-array-keys)) |

Codec and sharding configuration is only in `zarr.json`'s `codecs`.

## 11.6 Sharding

Sharding packs a block of cells of one per-chunk array into one stored
object (a *shard*) with an index of each cell's byte range, so a reader
can still fetch one cell alone.  It is optional and changes only
packing: chunk keys, cell indices, cell contents and the
`zarr_vectors` metadata (including `nonempty_chunks`) are unchanged.

### 11.6.1 Declaring a shard shape

The root `zarr_vectors` object MAY hold `shard_shape`: cells per shard
on each axis, an integer when every axis agrees or one value per axis.
The unit is cells, so one value holds at every pyramid level.  Absent
means unsharded.

`shard_shape` is a writer default, not a claim about the disk: a
writer creating a per-chunk array — including one created later, on
first write — SHOULD shard it with that shape.  Each array's
`zarr.json` remains the truth, and a reader MUST NOT rely on
`shard_shape`.  That is why it is a field, not a capability.

A writer MAY also shard the object layer (`object_index/` arrays,
`object_attributes/<name>`) along rows with `sharding_indexed`.

### 11.6.2 The `sharding_indexed` codec

The standard packing is Zarr v3's core `sharding_indexed` codec,
readable by any Zarr v3 implementation with sharding support.  The
array's `chunk_grid` chunk shape is the shard shape, and its only codec
is `sharding_indexed` over one-cell inner chunks.  A 5 × 5 × 5 grid
with shard shape 4:

```json
{
  "shape": [5, 5, 5],
  "chunk_grid": {"name": "regular", "configuration": {"chunk_shape": [4, 4, 4]}},
  "codecs": [{
    "name": "sharding_indexed",
    "configuration": {
      "chunk_shape": [1, 1, 1],
      "codecs": [{"name": "vlen-bytes", "configuration": {}}],
      "index_codecs": [{"name": "bytes", "configuration": {"endian": "little"}},
                       {"name": "crc32c"}],
      "index_location": "end"
    }
  }]
}
```

Shards sit at `<level>/vertices/c/<i>/<j>/<k>`, indexed by shard: 8
objects in place of up to 125.  A compressor goes in
`configuration.codecs` after `vlen-bytes`.

### 11.6.3 The `octree_sharding` codec — optional

A store MAY pack sharded per-chunk arrays with **`octree_sharding`**, a
Zarr v3 sharding codec registered in zarr-extensions and implemented by
the `zarr-octree` package.  The array, chunk grid, inner chunk shape
and codecs, key encoding and fill value mean what they mean with
`sharding_indexed`; only the shard bytes differ:

| | `sharding_indexed` | `octree_sharding` |
|-|--------------------|-------------------|
| Inner chunk order | any | Z-order (Morton), contiguous |
| Index rows | one per *possible* inner chunk, 16 bytes | one per *stored* inner chunk: Morton code and length, 6 bytes for shards up to 32³ |
| Grouping | none | runs (e.g. octree leaves near a target size), so a reader fetches a run's wanted cells in one byte range |
| Locating the index | fixed size | 16-byte footer: index size, CRC-32C, magic |

For a sparse shard the saving is large: `sharding_indexed`'s index of a
16³-cell shard is 64 KiB however few cells it holds.  The metadata is
that of `sharding_indexed` less the two index fields, plus a
writer-only `layout`:

```json
{
  "name": "octree_sharding",
  "configuration": {
    "chunk_shape": [1, 1, 1],
    "codecs": [{"name": "vlen-bytes", "configuration": {}}],
    "layout": {"name": "octree", "configuration": {"target": 100000, "unit": "bytes"}}
  }
}
```

The shard format is defined by the codec's specification
(`registry/codecs/octree_sharding/README.md` in the zarr-octree
repository).

- **Names.**  The codec was written as `zarr_octree_sharding` before
  registration.  A reader that supports the codec MUST accept either
  name; writers MUST write `octree_sharding`.
- **Declaration.**  The root `zarr_vectors` object holds
  `octree_sharding` (the codec's writer configuration, `{}` for
  defaults), which requires `shard_shape`, and `format_capabilities`
  lists `octree_sharding`.  Like `shard_shape` it is a writer default;
  each array's `zarr.json` says which codec it uses.
- **Readers without zarr-octree cannot read those arrays.**  A Zarr
  implementation refuses them as an unknown codec, so nothing is
  misread, but the data is unavailable.  Arrays packed with
  `sharding_indexed` or unsharded remain readable.  Producers that need
  the widest readership SHOULD use `sharding_indexed`.

### 11.6.4 Shards and concurrent writers

Writing one cell rewrites its shard.  Writers in different shards are
independent; writers touching the same shard MUST serialize.  A
pipeline SHOULD give each worker whole shards, or write unsharded and
shard once at the end — after presence is rebuilt
([§7](07-core-arrays.md#per-chunk-array-keys)) and link families are
finalized ([§10.7](10-cross-chunk-linking.md#107-consistency-guarantees)).
On an octree level, leaves SHOULD be fitted to the shard grid
([§6.5](06-spatial-indexing.md#65-octree-chunks)).

### 11.6.5 Design note: byte-range reads need uncompressed cells

An uncompressed cell's stored bytes are the `vlen-bytes` header and
then the payload verbatim, so a reader that knows which rows it wants
(a range fragment) can fetch just those bytes, from the cell's object
or from the inner chunk the shard index names.

**Byte-range reads of zstd-compressed cells are not possible.**  A
zstd frame (likewise Blosc or gzip) must be decoded from its start, so
no stored offset corresponds to a given row; the reader fetches and
decodes the whole cell.  Sharding does not help: the shard index
locates a compressed cell, not rows inside it.  This is the main reason
the default has no compressor.  Readers SHOULD range-read only when an
array's pipeline is exactly `vlen-bytes`, directly or as the only inner
codec of a sharding codec over one-cell inner chunks.
