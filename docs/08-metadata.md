# 8. Metadata

## 8.1 Metadata Structure

A ZV store carries metadata at five levels:

1. **Root metadata** — under `zarr.json["zarr_vectors"]` at the store
   root, plus the NGFF axes / datasets block under
   `zarr.json["multiscales"]`.
2. **Level metadata** — under each level group's
   `zarr.json["zarr_vectors_level"]`.
3. **Array metadata** — under each array's per-array `zarr.json`, with
   a `"zv_array"` discriminator and a small shape/dtype block.
4. **Object metadata** — values in `object_attributes/<name>`.
5. **Group metadata** — values in `group_attributes/<name>`.

The canonical schema is `schema/zarr_vectors.linkml.yaml` in the
zarr-vectors-py package; this chapter mirrors it.

## 8.2 Root-Level Metadata

Root metadata is the `"zarr_vectors"` block on `zarr.json` at the
store root.  NGFF axes live in the sibling `"multiscales"` block (the
RFC 4 / 5 layout); they are **not** duplicated under `"zarr_vectors"`.

| Field                       | Type                                    | Description |
|-----------------------------|-----------------------------------------|-------------|
| `zv_version`                | string (`"X.Y.Z"`)                      | ZV spec version. |
| `chunk_shape`               | `[float, ...]`                          | Level-0 default chunk shape (one entry per space axis).  Per-level overrides live in `zarr_vectors_level.chunk_shape`. |
| `bounds`                    | `[[float, ...], [float, ...]]`          | Global `(min_corner, max_corner)`.  Root-only — no per-level bounds. |
| `geometry_types`            | `list[string]`                          | Subset of `{"point_cloud", "line", "polyline", "streamline", "skeleton", "graph", "mesh"}`. |
| `crs`                       | `dict \| null`                          | OME-Zarr RFC 4 / 5 CRS dict, or `null`. |
| `links_convention`          | `"explicit" \| "implicit_sequential" \| "implicit_sequential_with_branches"` | How intra-chunk links are stored.  Default `"implicit_sequential"`. |
| `object_index_convention`   | `"standard" \| "identity"`              | `"identity"` omits `object_index/` (single-chunk only).  Default `"standard"`. |
| `cross_chunk_strategy`      | `"boundary_deduplication" \| "explicit_links" \| "both"` | How cross-chunk connectivity is expressed.  Default `"explicit_links"`. |
| `reduction_factor`          | int ≥ 2                                 | Multi-resolution threshold (a new level is emitted only when vertex count drops by ≥ this factor).  Default 8. |
| `base_bin_shape`            | `[float, ...] \| null`                  | Level-0 bin edge lengths.  When unset, defaults to `chunk_shape` (one bin per chunk).  `chunk_shape / base_bin_shape` must be integer per axis. |
| `cross_level_depth`         | int (default 1)                         | Max `|delta|` materialized for multiscale-link arrays.  `0` disables, `N` emits ±1…±N, `-1` walks all adjacent level pairs. |
| `cross_level_storage`       | `"none" \| "implicit" \| "explicit"`    | Optionality knob for cross-pyramid-level links ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)).  Default `"explicit"`. |
| `format_capabilities`       | `list[string]`                          | Capability tokens this store uses (see below).  Empty list when omitted. |

NGFF axes (`zarr.json["multiscales"][0]["axes"]`) are a list of
`{"name", "type", "unit"?}` descriptors in NGFF order
(`time → channel → custom → space`).  `sid_ndim` (the number of
spatial index dimensions) is `count(type == "space")`.

### Capability tokens (`format_capabilities`)

Capability tokens advertise optional features the store uses; they
match the `CAP_*` constants in `zarr_vectors.constants`:

| Token                    | Meaning |
|--------------------------|---------|
| `"preserved_object_ids"` | At least one level was written with ID-preserving sparsification (`zarr_vectors_level.preserves_object_ids = true`). |
| `"shared_fragments"`     | At least one level stores per-chunk fragments referenced by multiple objects' manifests. |
| `"fragment_index"`       | The store uses the fragment-index encoding for `vertex_fragments` and `link_fragments`.  Mandatory. |
| `"multiscale_links"`     | The store contains cross-pyramid-level link arrays (`delta ≠ 0`) under `links/<delta>/<offsets>/` and `link_attributes/<name>/<delta>/<offsets>/`.  Absent on stores with `cross_level_storage = "none"` *and* no other `delta ≠ 0` arrays. |

Four tokens are defined.  Because a cross-chunk link is just a link
with a non-zero offsets segment, `"multiscale_links"` says nothing
about chunk-spanning records — only about level-spanning ones.

The set is **open**: a reader that meets a token it does not recognize
either treats that feature as absent or declines to open the store
([Appendix H](15-appendices.md#appendix-h-extensibility)); what it MUST
NOT do is assume the feature is present.

## 8.3 Resolution-Level Metadata

Per-level metadata lives in each level group's
`zarr.json["zarr_vectors_level"]`:

| Field                       | Type                              | Description |
|-----------------------------|-----------------------------------|-------------|
| `level`                     | int ≥ 0                           | Level index (0 = full resolution).                                                                                       |
| `vertex_count`              | int ≥ 0                           | Total vertex rows across all `vertices` cells at this level.                                                             |
| `arrays_present`            | `list[string]`                    | Subset of the canonical **family** names actually present — `"vertex_attributes"`, never `"vertex_attributes/<name>"`.   |
| `fragments_tile`            | bool (default false)              | True when every chunk's vertex fragment index tiles its buffer exactly, letting a bulk read skip `vertex_fragments`.  Cleared by any write to `vertices` or `vertex_fragments`. |
| `chunk_shape`               | `[float, ...] \| null`            | Per-level chunk-shape override.  When set, each axis must be a positive integer multiple of root `chunk_shape`. |
| `object_sparsity`           | float in `(0, 1]`                 | Fraction of objects retained at this level vs the source level.                                                          |
| `coarsening_method`         | `"per_object" \| "manual" \| "none"` | How this level was generated.                                                                                          |
| `parent_level`              | int \| null                       | Index of the source level (`null` at level 0).                                                                           |
| `chunk_dims`                | `list[string] \| null`            | Names of chunk-key axes (leading axis first).  Non-null when the store was rechunked along a non-spatial axis.            |
| `chunk_attribute_name`      | string \| null                    | Per-vertex attribute used as the leading chunk axis (single-axis attribute chunking).                                    |
| `chunk_attribute_values`    | `list[any] \| null`               | Ordered list mapping leading-axis chunk-coord to attribute value.                                                        |
| `preserves_object_ids`      | bool (default false)              | True when this level inherits the parent's OID space (dropped objects → empty manifest slots).                           |
| `inherited_num_objects`     | int \| null                       | OID-space size inherited from `parent_level` (required when `preserves_object_ids = true`).                              |
| `shared_fragments`          | bool (default false)              | True when per-chunk fragments may be referenced by multiple objects' manifests.                                          |

**`bin_shape` and `bin_ratio` are derived, not stored.**  They are
properties of the level, but they are written *once*, into the NGFF
per-level coordinate transform, and read back from it:
`bin_ratio` is the transform's `scale` and `bin_shape` is twice its
`translation` (see [§9.3](09-multi-resolution-support.md#93-spatial-chunk-scaling)).
A writer MUST NOT also place them in `zarr_vectors_level`, because two
copies of one fact drift — and the drift is silent, since each copy
looks reasonable on its own.  For the same reason `chunk_shape` and
`bounds` are not writable through the level-metadata path.

Cross-level invariants (enforced by
`validate_level_chunk_shape_against_root`):

- A per-level `chunk_shape` must be a positive integer multiple of
  root `chunk_shape` along every axis (nested chunk grids — coarser
  levels always nest cleanly into the level-0 grid).
- A per-level `chunk_shape` must be an integer multiple of the
  per-level `bin_shape` along every axis (bins still tile chunks
  cleanly at every level).

## 8.4 Array-Level Metadata

Every array group's `zarr.json` carries a small ZV-specific block:

```json5
{
  // Zarr v3 standard fields (shape, dtype, chunk_grid, codecs) live alongside.
  "zv_array": "vertices",          // discriminator
  "dtype": "float32",              // duplicated to avoid materializing the
                                   // codec pipeline just to learn the dtype
  "shape": [],                     // optional, when not derivable
  "encoding": "raw"                // for vertices arrays only
}
```

Recognized `zv_array` discriminator values (one per array kind):

| Discriminator                      | Array                                                                |
|------------------------------------|----------------------------------------------------------------------|
| `"vertices"`                       | `<level>/vertices/`                                                  |
| `"vertex_fragments"`               | `<level>/vertex_fragments/`                                          |
| `"link_fragments"`                 | `<level>/link_fragments/`                                            |
| `"links_family"`                   | `<level>/links/<delta>/` — the family **group**                       |
| `"links"`                          | `<level>/links/<delta>/<offsets>/`                                   |
| `"attribute"`                      | `<level>/vertex_attributes/<name>/`                                  |
| `"link_attribute_family"`          | `<level>/link_attributes/<name>/<delta>/` — the family **group**      |
| `"link_attribute"`                 | `<level>/link_attributes/<name>/<delta>/<offsets>/`                  |
| `"object_index"`                   | `<level>/object_index/` — the group holding `manifests`               |
| `"object_attribute"`               | `<level>/object_attributes/<name>`                                   |
| `"fragment_attribute"`             | `<level>/fragment_attributes/<name>/`                                |
| `"groups"`                         | `<level>/groups`                                                     |
| `"groupings_attribute"`            | `<level>/group_attributes/<name>`                                    |

The discriminator for `group_attributes/<name>` is the literal
`"groupings_attribute"`; that spelling is normative even though the
array group is named `group_attributes`.  Prose calls it a **group
attribute**.

## 8.5 Object-Level Metadata

Per-object data lives in `<level>/object_attributes/<name>`,
dense `(B,)` or `(B, C)` arrays keyed by object ID.  The format
imposes no fixed object-attribute schema; common conventions:

- `"name"` — human-readable label per object.
- `"type"` — categorical kind (mesh / skeleton / polyline / …).
- `"centroid"` — `(B, sid_ndim)` per-object summary point.
- `"termination"` — `(B, 2)` for streamline endpoints (channel 0 =
  source, channel 1 = sink region IDs).

Object IDs are dense `0 .. B-1` ints; OID-preserving pyramid levels
may carry empty manifests (objects dropped at this level still own a
row in every `object_attributes/<name>` array).

## 8.6 Group-Level Metadata

Per-group data lives in `<level>/group_attributes/<name>`, dense
`(G,)` or `(G, C)` arrays keyed by group ID.  Common conventions:

- `"region_name"` — name per anatomical region group.
- `"tract_name"` — name per fascicle group.
- `"super_type"` — coarser categorical label for hierarchical
  grouping (the format does not require a parent_group pointer
  itself — hierarchy is expressed by attributes, not structure).

## 8.7 Point-Level Metadata

Per-vertex data lives in the `<level>/vertex_attributes/<name>` cell
for a chunk, row-aligned to the `<level>/vertices` cell at the same
coordinate.  Multi-channel attributes
use `(N_k, C)` shape; channel labels live in the per-array
`.zattrs.channel_names`.  Channel chunking — splitting a single
attribute into multiple per-channel arrays — is a writer-side
decision (e.g. one chunk per gene-block for spatial transcriptomics).

## 8.8 Coordinate Reference System (CRS)

The optional `crs` field on root metadata follows OME-Zarr RFC 4 / 5:

- A `crs` dict identifies the coordinate reference system (EPSG code,
  WKT, or transform pipeline).
- Per-axis units are carried on the NGFF axis descriptors as UDUNITS-2
  names; the format does not stamp placeholder units.
- Coordinate transforms (scale, translation) per level live in
  `zarr.json["multiscales"][0]["datasets"][i]["coordinateTransformations"]`
  alongside the standard NGFF layout.  They are also the **only**
  storage for a level's `bin_ratio` and `bin_shape`; see
  [§9.3](09-multi-resolution-support.md#93-spatial-chunk-scaling).

The `multiscales` block itself is NGFF **version `"0.4"`** — the
bare-root form, not the `attributes.ome` nesting.  NGFF reserves the
entry's `type` field for the downsampling method, so the ZV
discriminator is stamped one level down as
`multiscales[0]["metadata"]["format"] = "zarr_vectors"` rather than
overloading `type`.
