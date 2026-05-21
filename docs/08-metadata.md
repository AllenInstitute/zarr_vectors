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
4. **Object metadata** — values in `object_attributes/<name>/data`.
5. **Group metadata** — values in `group_attributes/<name>/data`.

The canonical schema is `schema/zarr_vectors.linkml.yaml` in the
zarr-vectors-py package; this chapter mirrors it.

## 8.2 Root-Level Metadata

Root metadata is the `"zarr_vectors"` block on `zarr.json` at the
store root.  NGFF axes live in the sibling `"multiscales"` block (the
RFC 4 / 5 layout); they are **not** duplicated under `"zarr_vectors"`
(this duplication was dropped in 0.5).

| Field                       | Type                                    | Description |
|-----------------------------|-----------------------------------------|-------------|
| `zv_version`                | string (`"X.Y.Z"`)                      | ZV spec version.  Renamed from `format_version` in 0.5 to disambiguate from Zarr v3's `zarr_format` field. |
| `chunk_shape`               | `[float, ...]`                          | Level-0 default chunk shape (one entry per space axis).  Per-level overrides live in `zarr_vectors_level.chunk_shape` (v0.7). |
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
| `"shared_fragments"`     | At least one level stores per-chunk fragments referenced by multiple objects' manifests.  Successor to the pre-0.6 `shared_vertex_groups` token. |
| `"fragment_index"`       | The store uses the v0.6 fragment-index encoding for `vertex_fragments/` and `link_fragments/`.  Mandatory for 0.6+ stores. |
| `"multiscale_links"`     | The store uses the `<delta>` sub-folder layout for `links/`, `cross_chunk_links/`, `link_attributes/`, and `cross_chunk_link_attributes/` and may contain cross-pyramid-level edges.  Absent on stores with `cross_level_storage = "none"` *and* no other `delta ≠ 0` arrays. |
| `"partitioned_cross_chunk_links"` | The store uses the v0.8 sharded cross-chunk-link layout (kN array cells keyed by sorted unique chunks; `9 * link_width` bytes per record; `layout = "sharded_v1"` stamped on every `cross_chunk_links/<delta>/` group).  Coupled with `"multiscale_links"`: any store with a `cross_chunk_links/<delta>/` group MUST carry both tokens.  Stores carrying `"multiscale_links"` without `"partitioned_cross_chunk_links"` are v0.7-era monolithic-blob stores; v0.8 readers fail clearly until the store is migrated ([§10.9](10-cross-chunk-linking.md#109-migration-from-v07)). |

There is no `shared_vertex_groups` token — it was renamed to
`shared_fragments` in 0.6 along with the underlying sharing primitive.

## 8.3 Resolution-Level Metadata

Per-level metadata lives in each level group's
`zarr.json["zarr_vectors_level"]`:

| Field                       | Type                              | Description |
|-----------------------------|-----------------------------------|-------------|
| `level`                     | int ≥ 0                           | Level index (0 = full resolution).                                                                                       |
| `vertex_count`              | int ≥ 0                           | Total vertex rows across all `vertices/<chunk>` blobs at this level.                                                     |
| `arrays_present`            | `list[string]`                    | Subset of canonical array names actually present.                                                                        |
| `bin_shape`                 | `[float, ...] \| null`            | Per-level bin edge lengths.  `null` at level 0 (which inherits `base_bin_shape` from root); required at levels > 0.       |
| `bin_ratio`                 | `[int, ...] \| null`              | Integer fold-change per axis vs level 0.  `(1, 1, …)` at level 0; `(2, 2, 2)` for a 2× coarser bin grid.                  |
| `chunk_shape`               | `[float, ...] \| null`            | **v0.7** per-level chunk-shape override.  When set, each axis must be a positive integer multiple of root `chunk_shape`. |
| `object_sparsity`           | float in `(0, 1]`                 | Fraction of objects retained at this level vs the source level.                                                          |
| `coarsening_method`         | `"per_object" \| "manual" \| "none"` | How this level was generated.                                                                                          |
| `parent_level`              | int \| null                       | Index of the source level (`null` at level 0).                                                                           |
| `chunk_dims`                | `list[string] \| null`            | Names of chunk-key axes (leading axis first).  Non-null when the store was rechunked along a non-spatial axis.            |
| `chunk_attribute_name`      | string \| null                    | Per-vertex attribute used as the leading chunk axis (single-axis attribute chunking).                                    |
| `chunk_attribute_values`    | `list[any] \| null`               | Ordered list mapping leading-axis chunk-coord to attribute value.                                                        |
| `preserves_object_ids`      | bool (default false)              | True when this level inherits the parent's OID space (dropped objects → empty manifest slots).                           |
| `inherited_num_objects`     | int \| null                       | OID-space size inherited from `parent_level` (required when `preserves_object_ids = true`).                              |
| `shared_fragments`          | bool (default false)              | True when per-chunk fragments may be referenced by multiple objects' manifests.  Renamed from `shared_vertex_groups`.    |

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
| `"links"`                          | `<level>/links/<delta>/`                                             |
| `"attribute"`                      | `<level>/vertex_attributes/<name>/`                                  |
| `"link_attribute"`                 | `<level>/link_attributes/<name>/<delta>/`                            |
| `"object_index"`                   | `<level>/object_index/`                                              |
| `"object_attribute"`               | `<level>/object_attributes/<name>/`                                  |
| `"fragment_attribute"`             | `<level>/fragment_attributes/<name>/`                                |
| `"groups"`                         | `<level>/groups/`                                                    |
| `"groupings_attribute"`            | `<level>/group_attributes/<name>/`                                   |
| `"cross_chunk_links"`              | `<level>/cross_chunk_links/<delta>/`                                 |
| `"cross_chunk_link_attribute"`     | `<level>/cross_chunk_link_attributes/<name>/<delta>/`                |

The literal `"groupings_attribute"` discriminator is on-disk legacy
from before the `groupings` → `groups` rename; conceptual usage is
**group attribute** in all current text.

## 8.5 Object-Level Metadata

Per-object data lives in `<level>/object_attributes/<name>/data`,
dense `(B,)` or `(B, C)` arrays keyed by object ID.  The format
imposes no fixed object-attribute schema; common conventions:

- `"name"` — human-readable label per object.
- `"type"` — categorical kind (mesh / skeleton / polyline / …).
- `"centroid"` — `(B, sid_ndim)` per-object summary point.
- `"termination"` — `(B, 2)` for streamline endpoints (channel 0 =
  source, channel 1 = sink region IDs).

Object IDs are dense `0 .. B-1` ints; OID-preserving pyramid levels
may carry empty manifests (objects dropped at this level still own a
row in every `object_attributes/<name>/data` blob).

## 8.6 Group-Level Metadata

Per-group data lives in `<level>/group_attributes/<name>/data`, dense
`(G,)` or `(G, C)` arrays keyed by group ID.  Common conventions:

- `"region_name"` — name per anatomical region group.
- `"tract_name"` — name per fascicle group.
- `"super_type"` — coarser categorical label for hierarchical
  grouping (the format does not require a parent_group pointer
  itself — hierarchy is expressed by attributes, not structure).

## 8.7 Point-Level Metadata

Per-vertex data lives in `<level>/vertex_attributes/<name>/<chunk>`,
row-aligned to `<level>/vertices/<chunk>`.  Multi-channel attributes
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
  alongside the standard NGFF layout.
