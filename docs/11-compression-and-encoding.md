# 11. Compression and Encoding

## 11.1 Compression Overview

ZV applies **per-chunk compression** via Zarr v3's codec pipeline on
each single-chunk `uint8` blob.  All format-level structure
(fragment-index, manifest blocks, link records) lives *inside* the
compressed payload; compression is opaque to record framing.

There is no array-level or store-level compression — each chunk
compresses independently, and a reader fetching one chunk pays no
cost for any other chunk.

## 11.2 Draco Encoding

Mesh stores may opt into Draco for the vertex+face co-encoding:

- **Use cases**: triangle / tetrahedral meshes; per-chunk Draco blobs
  hold both positions and face connectivity.
- **Configuration**: per-writer compression level and quantization
  (the format does not pin specific Draco settings).
- **Per-array flag**: `vertices/.zattrs.encoding = "draco"` marks a
  Draco-encoded vertex array; the `links/0/` companion is
  omitted (faces live inside the Draco blob).
- **Decoding**: requires the Draco runtime; readers that don't link
  Draco see opaque bytes.

## 11.3 Standard Compression Codecs

**The default is no compressor at all.**  A per-chunk array is created
with the `vlen-bytes` serializer and an empty compressor list, which
keeps the fast asynchronous-PUT write path open; the table below is the
*recommended* pipeline a writer selects explicitly, not what an
unconfigured store gets.

A `compressor` chosen when the store is created fixes the codec
pipeline for the life of that array — Zarr cannot change a codec on an
existing array — so the choice is made once, up front.  The `"blosc"`
shorthand resolves to Blosc(Zstd, BITSHUFFLE, `clevel=5`).

Recommended pipelines by array:

| Array                                        | Dtype                                                                | Compressor                                                          | Shuffle      |
|----------------------------------------------|----------------------------------------------------------------------|---------------------------------------------------------------------|--------------|
| `vertices`                                   | user-declared (float or integer; see [§7.1](07-core-arrays.md#71-vertex-positions)) | Blosc(Zstd, clevel=5)                                 | BYTE-SHUFFLE |
| `vertex_attributes/<name>`                   | user-declared                                                         | Blosc(Zstd, clevel=5)                                               | BYTE-SHUFFLE |
| `fragment_attributes/<name>`                 | user-declared                                                         | Blosc(Zstd, clevel=5)                                               | BYTE-SHUFFLE |
| `vertex_fragments`                           | opaque bytes ([§7.3](07-core-arrays.md#73-vertex-fragments))         | none — opaque bytes (see [§11.4](#114-compression-strategy))        | —            |
| `link_fragments`                             | opaque bytes ([§7.5](07-core-arrays.md#75-vertex-links))             | none — opaque bytes (see [§11.4](#114-compression-strategy))        | —            |
| `links/<delta>/<offsets>`                    | user-declared integer (width chosen to fit `n_vertices_in_chunk`; see [§7.5](07-core-arrays.md#75-vertex-links)) | Blosc(Zstd, clevel=5)                       | BITSHUFFLE   |
| `link_attributes/<name>/<delta>/<offsets>`   | user-declared                                                         | Blosc(Zstd, clevel=5)                                               | BYTE-SHUFFLE |
| `object_index/manifests`                     | vlen-bytes (opaque manifest blob — [§7.6](07-core-arrays.md#76-object-index)) | Blosc(Zstd, clevel=5)                                       | BYTE-SHUFFLE |
| `object_attributes/<name>`                   | user-declared                                                         | Blosc(Zstd, clevel=5)                                               | BYTE-SHUFFLE |
| `groups`                                     | vlen-bytes (per-group `int64` id lists)                               | Blosc(Zstd, clevel=5)                                               | BYTE-SHUFFLE |
| `group_attributes/<name>`                    | user-declared                                                         | Blosc(Zstd, clevel=5)                                               | BYTE-SHUFFLE |

**Why BITSHUFFLE for the link arrays** — every link row is
`link_width` **chunk-local** vertex indices, whose range is
`[0, n_vertices_in_chunk)`.  The high-order bits are zero and the
low-order bits are correlated, so bit-level de-correlation is the right
pre-pass for Zstd.

Before 0.9 this table needed a second row and a caveat: cross-chunk
records baked each endpoint's chunk coordinates into the payload, and
that high-entropy component made BYTE-SHUFFLE the better fit for them.
The merged links family removed the distinction — a record no longer
names a chunk, so every link row is now the low-entropy chunk-local
kind and takes the same treatment.

`vertex_fragments` and `link_fragments` bypass the Zarr codec pipeline
entirely: their chunks are project-internal record framings (see
[§7.3](07-core-arrays.md#73-vertex-fragments)) and are written as opaque
bytes via the `FsGroup.write_bytes` path.  See
[§11.4](#114-compression-strategy) for why the framing stands on its own
without an outer compressor.

## 11.4 Compression Strategy

- **When to compress**: every per-chunk byte blob is compressed by
  default.  Writers may opt a specific array out via per-array codec
  configuration.
- **Compression levels**: defaults pick Zstd `clevel=5` as a balance
  between throughput and ratio.  Writers tune as needed.
- **Mixed compression**: each array carries its own codec pipeline
  in its Zarr v3 metadata, so the in-store compressor mix can be
  heterogeneous.

### Fragment-index framing vs. the Zarr codec pipeline

The fragment-index byte layout
([§7.3](07-core-arrays.md#73-vertex-fragments)) and the manifest-block
stream ([§7.6](07-core-arrays.md#76-object-index)) are
**project-internal record framings**.  They live *inside* the raw
bytes the Zarr codec pipeline sees as opaque uint8 input.  The Zarr
codec registry has only the standard codecs (`blosc`, `zstd`, `gzip`,
`shuffle`, `bytes`, …); ZV does not register any custom Zarr codec.
This separation lets a reader peel the codec pipeline (where one is
applied) and then run the project-internal decoder without coupling
either layer to the other.

For `vertex_fragments` and `link_fragments` specifically, the default
goes one step further: **no outer codec is applied at all**.  The
chunks are written as opaque bytes and the §11.3 codec table lists
them as "none".  This is a deliberate format-level choice, not an
oversight, and rests on four observations:

- **Structural framing already compresses.**  The bitmap-discriminated
  range table + CSR explicit layout
  ([§7.3.1](07-core-arrays.md#731-design-rationale)) is itself a
  tight structural compression scheme: the bitmap declares "this
  fragment is a contiguous run" with one bit, and the range table
  carries the run's two parameters (`start`, `count`) regardless of
  the run's length.  A general-purpose codec on top of that has
  little redundancy left to remove.
- **Near-incompressible payload.**  After the bitmap factors out the
  run-length structure, what remains is sparse `int64` row indices
  (range starts, CSR explicit indices) drawn from a per-chunk address
  space.  Their entropy is close to the byte-level entropy bound for
  the typical case; Blosc+Zstd shrink them only marginally.
- **Decompression on the read-amplification path.**  A bbox query in
  a region overlapping *N* chunks must parse *N* fragment-index blobs
  before any vertex byte is fetched.  Even a fast outer codec adds
  fixed per-blob latency that scales with *N*.  For typical fragment
  counts (tens to low hundreds per chunk → 100 B to a few KB) the
  latency saved by skipping decompression dominates the bytes saved
  by applying it.
- **Format predictability.**  Keeping fragment-index blobs as raw
  bytes makes the on-disk layout byte-identical to what
  `decode_fragments` parses in memory.  A reader can map the blob
  directly into a zero-copy view without an intermediate
  decompression buffer.

Stores that must minimise on-disk size MAY wrap the kvstore in an
outer compression layer (e.g. content-addressed-blob with a Zstd
codec at the object-store gateway).  The fragment-index format is
independent of that choice — readers parse the raw blob once any
outer wrapper has been peeled.

## 11.5 Encoding Metadata

Per-array `.zattrs` (under each array group's `zarr.json`) carries:

- `"zv_array"` — discriminator (see [§8.4](08-metadata.md#84-array-level-metadata)).
- `"dtype"` — canonical numpy dtype string (`"float32"`, `"int64"`,
  …).  Duplicated outside the codec pipeline so a reader can learn
  the dtype without materializing the pipeline.
- `"encoding"` — `"raw"` (default) or `"draco"` (mesh vertices only).
- `"row_shape"` — `[]` for a scalar attribute, `[C]` for a
  multi-channel one.  It is the authority on column count; a reader
  MUST NOT infer width from `channel_names`, which are labels and may
  be absent from a genuinely multi-column attribute.
- `"compression_codec"`, `"shape"`, `"channel_names"`,
  `"channel_dtype"` — optional, declared per array kind.
- `"chunk_grid_origin"`, `"nonempty_chunks"` — on every per-chunk
  array; see [§5.2](05-zarr-store-structure.md#52-zarr-version-requirements).

The Zarr v3 codec pipeline (`codecs[]` in the standard `zarr.json`
block) carries the actual codec config; per-array ZV metadata
duplicates only the fields that matter for non-decoding readers.
