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
  Draco-encoded vertex array; the `links/0/<chunk>` companion is
  omitted (faces live inside the Draco blob).
- **Decoding**: requires the Draco runtime; readers that don't link
  Draco see opaque bytes.

## 11.3 Standard Compression Codecs

Default codec pipelines (from
`zarr_vectors.encoding.compression.get_default_compressor`):

| Array                                       | Compressor                | Shuffle           |
|---------------------------------------------|---------------------------|-------------------|
| `vertices`                                  | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `vertex_attributes/<name>`                  | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `vertex_fragments`                          | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `link_fragments`                            | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `links/<delta>`                             | Blosc(Zstd, clevel=5)     | BITSHUFFLE        |
| `object_index`                              | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `object_attributes/<name>`                  | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `groups`                                    | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `group_attributes/<name>`                   | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `cross_chunk_links/<delta>`                 | Blosc(Zstd, clevel=5)     | BYTE-SHUFFLE      |
| `cross_chunk_link_attributes/<name>/<delta>` | Blosc(Zstd, clevel=5)    | BYTE-SHUFFLE      |

`links/<delta>` is the only array whose default uses BITSHUFFLE — the
correlated int64 endpoint indices compress better after bit-level
de-correlation.

The fragment-index payload mixes int64 range tables with uint32 CSR
offsets; BYTE-SHUFFLE decorrelates the heterogeneous payload well.

## 11.4 Compression Strategy

- **When to compress**: every per-chunk byte blob is compressed by
  default.  Writers may opt a specific array out via per-array codec
  configuration.
- **Compression levels**: defaults pick Zstd `clevel=5` as a balance
  between throughput and ratio.  Writers tune as needed.
- **Mixed compression**: each array carries its own codec pipeline
  in its Zarr v3 metadata, so the in-store compressor mix can be
  heterogeneous.

### Fragment-index is NOT a Zarr codec

The fragment-index byte layout (§7.3) and the manifest-block stream
(§7.6) are **project-internal record framings** — they live inside
the raw bytes that the Zarr codec pipeline sees as opaque uint8
input.  The Zarr codec registry has only the standard codecs
(`blosc`, `zstd`, `gzip`, `shuffle`, `bytes`, …); ZV does not
register any custom Zarr codec.

This separation lets a reader peel the codec pipeline (Blosc → raw
bytes) and then run the project-internal fragment-index decoder
without coupling either layer to the other.

## 11.5 Encoding Metadata

Per-array `.zattrs` (under each array group's `zarr.json`) carries:

- `"zv_array"` — discriminator (see §8.4).
- `"dtype"` — canonical numpy dtype string (`"float32"`, `"int64"`,
  …).  Duplicated outside the codec pipeline so a reader can learn
  the dtype without materializing the pipeline.
- `"encoding"` — `"raw"` (default) or `"draco"` (mesh vertices only).
- `"compression_codec"`, `"shape"`, `"channel_names"`,
  `"channel_dtype"` — optional, declared per array kind.

The Zarr v3 codec pipeline (`codecs[]` in the standard `zarr.json`
block) carries the actual codec config; per-array ZV metadata
duplicates only the fields that matter for non-decoding readers.
