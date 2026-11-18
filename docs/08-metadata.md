# 8. Metadata

## 8.1 Metadata Structure

Zarr Vectors metadata is published as the
[Zarr Vectors convention](https://github.com/AllenInstitute/zarr-vectors-convention)
v0.1.0, which covers format `0.10.0`.  It says what each node is and
how to interpret its cells; the byte layouts inside the cells are
defined in [§7](07-core-arrays.md).

All metadata lives in the `attributes` of the Zarr v3 `zarr.json`
documents.  Every node's Zarr Vectors properties are held in **one**
attribute, `zarr_vectors`, whose required `kind` field names the node:

| `kind` | Node | Fields |
|--------|------|--------|
| `root` | store root (group) | [§8.2](#82-root-level-metadata) |
| `level` | `<level>/` (group) | [§8.3](#83-resolution-level-metadata) |
| `vertices`, `vertex_fragments`, `link_fragments`, `links`, `vertex_attribute`, `fragment_attribute`, `link_attribute`, `groups`, `object_attribute`, `group_attribute` | arrays of a level | [§8.4](#84-array-level-metadata) |
| `links_family`, `link_attribute_family`, `object_index` | family groups of a level | [§8.4](#84-array-level-metadata) |
| `parametric`, `parametric_objects`, `parametric_names` | `parametric/` and its arrays | [§8.4](#parametric-objects) |

Every node with a `zarr_vectors` attribute also carries
`zarr_conventions` ([§8.9](#89-convention-registration-zarr_conventions)).
The root also carries `multiscales` ([§8.10](#810-multiscales)),
`proj:projjson` when the store has a CRS
([§8.8](#88-coordinate-reference-system-crs)), optionally `ome`
([§8.11](#811-ome-zarr-rfc-8-node-ome)), and optionally
`user_metadata`, which holds application metadata, one namespace per
application, and which the format neither reads nor validates.

- Writers MUST NOT place Zarr Vectors fields outside the node's
  `zarr_vectors` object, nor application keys inside it.  Other
  conventions MAY add prefixed keys (`proj:` …).
- Readers SHOULD ignore `zarr_vectors` fields they do not recognise.
  A `null` field means the same as an absent one.
- A writer that rewrites a node MUST keep attributes that belong to
  other conventions or to applications.

The normative JSON Schema is the convention's `schema.json`
(Appendix A).  Per-object, per-group and per-vertex *data* are arrays,
described in [§8.5](#85-object-level-metadata) to
[§8.7](#87-point-level-metadata).

## 8.2 Root-Level Metadata

Root metadata is the root's `zarr_vectors` object, `kind: "root"`.
The root attributes of a three-level streamline pyramid
(`chunk_shape` 200, `bin_shape` 50, two ×2 coarsenings), with the
registrations and the `ome` node abridged (see §8.9 and §8.11):

```javascript
{
  "zarr_conventions": [
    {"uuid": "66268a61-7833-4995-bbcb-233bb417dae5", "name": "zarr_vectors", ...},
    {"uuid": "d35379db-88df-4056-af3a-620245f8e347", "name": "multiscales", ...}
  ],
  "zarr_vectors": {
    "kind": "root",
    "zv_version": "0.10.0",
    "axes": [
      {"name": "x", "type": "space"},
      {"name": "y", "type": "space"},
      {"name": "z", "type": "space"}
    ],
    "format_capabilities": ["preserved_object_ids", "shared_fragments", "multiscale_links"],
    "chunk_shape": [200.0, 200.0, 200.0],
    "bounds": [[0.0, 0.0, 0.0], [400.0, 400.0, 400.0]],
    "geometry_types": ["streamline"],
    "base_bin_shape": [50.0, 50.0, 50.0],
    "links_convention": "implicit_sequential", "object_index_convention": "standard",
    "cross_chunk_strategy": "explicit_links", "cross_level_depth": 1,
    "cross_level_storage": "explicit"
  },
  "multiscales": {"layout": [{"asset": "0"}, {"asset": "1"}, {"asset": "2"}]},
  "ome": {"version": "0.6", "type": "collection", "name": "streamline_pyr", ...}
}
```

**Required fields:**

| Field            | Type                           | Description |
|------------------|--------------------------------|-------------|
| `kind`           | `"root"`                       | Node discriminator. |
| `zv_version`     | string (`"X.Y.Z"`)             | Format version of the writer, `"0.10.0"` ([§8.12](#812-version-rules)). |
| `axes`           | `list[object]`                 | One `{name, type, unit?}` per coordinate axis ([Axes](#axes)). |
| `chunk_shape`    | `[float, ...]`                 | Level-0 chunk edge lengths, one positive entry per axis.  Per-level overrides live in the level object's `chunk_shape`. |
| `bounds`         | `[[float, ...], [float, ...]]` | Global `[min_corner, max_corner]` containing all data, one entry per axis.  Root-only — no per-level bounds. |
| `geometry_types` | `list[string]`                 | Geometries present; empty in a store that holds no data yet.  Canonical values: `point_cloud`, `line`, `polyline`, `streamline`, `skeleton`, `graph`, `mesh` (see [Appendix H](15-appendices.md#appendix-h-extensibility) for others). |

**Optional fields** (a reader uses the default when absent):

| Field                     | Type                                    | Default | Description |
|---------------------------|-----------------------------------------|---------|-------------|
| `format_capabilities`     | `list[string]`                          | `[]`    | Capability tokens the store uses ([Capability tokens](#capability-tokens-format_capabilities)).  The reference writer always writes it. |
| `required_capabilities`   | `list[string]`                          | `[]`    | Capability tokens a reader MUST implement to read the store correctly ([Capability tokens](#capability-tokens-format_capabilities)).  Written only when non-empty. |
| `base_bin_shape`          | `[float, ...]`                          | `chunk_shape` | Level-0 bin edge lengths.  `chunk_shape / base_bin_shape` MUST be an integer per axis. |
| `links_convention`        | `"explicit" \| "implicit_sequential" \| "implicit_sequential_with_branches"` | `"implicit_sequential"` | How intra-chunk links are stored. |
| `object_index_convention` | `"standard" \| "identity"`              | `"standard"` | `"identity"` omits `object_index/` and is allowed only in a store with exactly one spatial chunk. |
| `cross_chunk_strategy`    | `"boundary_deduplication" \| "explicit_links" \| "both"` | `"explicit_links"` | How cross-chunk connectivity is expressed. |
| `reduction_factor`        | int ≥ 2                                 | `8`     | Multi-resolution threshold: a new level is emitted only when the vertex count drops by at least this factor. |
| `cross_level_depth`       | int ≥ −1                                | `1`     | Largest `|delta|` materialized for multiscale-link arrays.  `0` disables, `N` emits ±1…±N, `-1` walks all adjacent level pairs. |
| `cross_level_storage`     | `"none" \| "implicit" \| "explicit"`    | `"explicit"` | Optionality knob for cross-pyramid-level links ([§9.6](09-multi-resolution-support.md#96-multiscale-link-arrays--optional)). |
| `attribute_specs`         | object                                  | absent  | Declared attributes by scope ([`attribute_specs`](#attribute_specs)). |
| `shard_shape`             | int ≥ 1 \| `[int, ...]`                 | unsharded | Writer default for packing per-chunk arrays ([Writer defaults](#writer-defaults-shard_shape-octree_sharding-manifest_layout)). |
| `octree_sharding`         | object                                  | absent (`sharding_indexed`) | Writer default: configuration of the `octree_sharding` codec.  Requires `shard_shape`. |
| `manifest_layout`         | `"vlen" \| "dense"`                     | `"vlen"` | Writer default for new object indexes.  Written only as `"dense"`. |
| `manifest_block_dtype`    | `"int64" \| "int32"`                    | `"int64"` | Element type of `manifest_blocks` in new dense object indexes.  Written only as `"int32"`. |
| `coordinate_offset`       | `[float, ...]`                          | zeros   | Stored-to-world offset per axis ([`coordinate_offset`](#coordinate_offset)). |

There is no `crs` field: a CRS is the root attribute `proj:projjson`
([§8.8](#88-coordinate-reference-system-crs)).

Cross-field rules:

- `chunk_shape`, `base_bin_shape`, both `bounds` corners,
  `coordinate_offset`, and every level's `bin_shape` and `bin_ratio`
  MUST have `sid_ndim` entries (one per axis).
- `octree_sharding` MUST NOT be present without `shard_shape`.
- Every token in `required_capabilities` MUST also appear in
  `format_capabilities`.

### Axes

`axes` is a list of `{"name", "type", "unit"?}` descriptors in the order
`time → channel → custom → space`.  `type` is one of `"space"`,
`"time"`, `"channel"` or `"custom"`.  Axis names MUST be unique, and a
store MUST have at least two `space` axes.  `sid_ndim` — the number of
spatial index dimensions, and the rank of every per-chunk array — is
the number of axes of every type (an `x, y, z, t` store has 4).

`unit` is a UDUNITS-2 name (`"micrometer"`, `"second"`, …).  Writers
MUST NOT stamp placeholder units; an unknown unit is omitted.  The
descriptor shape is OME-Zarr RFC 4's.

### `attribute_specs`

`attribute_specs` records what a store declares its attributes to be,
by scope:

```json
"attribute_specs": {
  "vertex": {"intensity": {"dtype": "float32", "unit": "microvolt"}},
  "object": {"label": {"dtype": "int32", "categorical": true}}
}
```

| Key | Meaning |
|-----|---------|
| scope | `"vertex"`, `"object"` or `"link"`.  Readers SHOULD also accept `"fragment"` and `"group"`, which the convention schema admits. |
| `<name>.dtype` | Element type, a NumPy dtype name.  Required. |
| `<name>.channels` | Number of channels; omitted when 1. |
| `<name>.categorical` | `true` for a dictionary-encoded attribute; omitted otherwise. |
| `<name>.unit` | UDUNITS-2 unit name, when given. |
| `<name>.description` | Free text, when given. |

A declaration does not promise that the array exists; the array
appears when data is written.  Absent means undeclared.  A writer also
stamps `unit` and `description` into the attribute array's own
`zarr_vectors` object, which is the truth about that array.

### Writer defaults: `shard_shape`, `octree_sharding`, `manifest_layout`

These fields say how **new** arrays are written, so that every path
that allocates one — including a worker creating an array on its first
write — makes the same choice.  They are not claims about what is on
disk: each array's own codecs and each object index's own `layout` are
the truth.  A reader that ignores them reads the store correctly.

| Field | Meaning |
|-------|---------|
| `shard_shape` | Cells (not coordinate units) per shard: an integer for every axis, or one per spatial axis (one more on a level with a leading non-spatial axis, [§6.7](06-spatial-indexing.md#67-leading-non-spatial-chunk-axes)).  Absent ⇒ one storage object per non-empty cell. |
| `octree_sharding` | The store is *marked octree*: sharded per-chunk arrays use the `octree_sharding` codec (Appendix D) instead of `sharding_indexed`.  The value is the codec's configuration other than `chunk_shape` and `codecs` (its `layout`), `{}` for defaults.  Requires `shard_shape`; comes with the `octree_sharding` token. |
| `manifest_layout` | `"dense"`: new object indexes use `dense_manifests_v1` ([§7.6](07-core-arrays.md#76-object-index)); comes with the `dense_manifests` token.  Absent ⇒ vlen.  `manifest_block_dtype: "int32"` narrows new `manifest_blocks`. |

### `coordinate_offset`

`coordinate_offset` is the world position of the stored coordinate
origin, one value per axis:

```
world position = stored position + coordinate_offset
```

It lets a writer align the chunk grid with a source grid.  Absent
means zero.  All other coordinates in the store (`bounds`, vertex
positions, …) are in the stored frame.

### Capability tokens (`format_capabilities`)

Capability tokens advertise optional features the store uses:

| Token                    | Meaning | Added when |
|--------------------------|---------|------------|
| `"preserved_object_ids"` | At least one level was written with ID-preserving sparsification (level `preserves_object_ids = true`): a dropped object keeps its id as an empty manifest slot. | A level preserves object IDs. |
| `"shared_fragments"`     | At least one level stores per-chunk fragments that more than one object's manifest references. | A level shares fragments. |
| `"multiscale_links"`     | The store contains cross-pyramid-level link arrays (`delta ≠ 0`) under `links/<delta>/<offsets>/` and `link_attributes/<name>/<delta>/<offsets>/`. | Cross-level links are written. |
| `"dense_manifests"`      | At least one object index uses (or will be written in) the `dense_manifests_v1` layout. | `manifest_layout` is `"dense"`, or a dense index is written. |
| `"octree_sharding"`      | Sharded per-chunk arrays use the `octree_sharding` codec instead of `sharding_indexed`; reading or writing them needs that codec. | `octree_sharding` is set. |
| `"octree_chunks"`        | A level stores one cell per octree leaf rather than per uniform chunk ([§6.5](06-spatial-indexing.md#65-octree-chunks)).  A reader without this capability MUST NOT read such a level. | A level has an `octree_chunks` block, including mid-conversion.  Also listed in `required_capabilities`. |
| `"fragment_index"`       | `vertex_fragments` and `link_fragments` use the v1 fragment-index layout. | **Reserved, not written.**  Every store uses that encoding and each sidecar array declares it (`encoding: "fragment_index_v1"`); readers MUST NOT require the token. |

`multiscale_links` says nothing about chunk-spanning links, which
are ordinary `delta = 0` arrays.

The set is **open**: a reader that meets a token it does not recognize
in `format_capabilities` either treats that feature as absent or
declines to open the store
([Appendix H](15-appendices.md#appendix-h-extensibility)); what it MUST
NOT do is assume the feature is present.

A reader that does not implement a token in `required_capabilities`
SHOULD refuse to open the store, and MUST NOT read the parts of it
that depend on the token.  `octree_chunks` is currently the only such
token; writers remove it (and an emptied list) when no level has octree
chunks.  A reader that skips the check is still stopped by the
`zarr_vectors_octree_chunks` marker codec (Appendix D).

## 8.3 Resolution-Level Metadata

Per-level metadata is the level group's `zarr_vectors` object,
`kind: "level"`.  Level 1 of the pyramid in [§8.2](#82-root-level-metadata):

```json
{
  "zarr_conventions": [{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}],
  "zarr_vectors": {
    "kind": "level", "level": 1, "object_sparsity": 0.5, "vertex_count": 15,
    "coarsening_method": "per_object", "parent_level": 0,
    "arrays_present": ["links", "object_index", "vertex_fragments", "vertices"],
    "preserves_object_ids": true, "inherited_num_objects": 20, "shared_fragments": true,
    "bin_ratio": [2.0, 2.0, 2.0], "bin_shape": [100.0, 100.0, 100.0]
  }
}
```

Level 0 of the same store has `"level": 0`, `"object_sparsity": 1.0`,
`"coarsening_method": "none"`, `"parent_level": null`,
`"fragments_tile": true` and no bin fields.

| Field                       | Type                              | Description |
|-----------------------------|-----------------------------------|-------------|
| `kind`                      | `"level"`                         | Node discriminator.  Required. |
| `level`                     | int ≥ 0                           | Level index (0 = full resolution).  Required; MUST equal the group name. |
| `vertex_count`              | int ≥ 0                           | Total vertex rows across all `vertices` cells at this level. |
| `arrays_present`            | `list[string]`                    | Subset of the canonical **family** names actually present — `"vertex_attributes"`, never `"vertex_attributes/<name>"`. |
| `object_sparsity`           | float in `(0, 1]`                 | Fraction of the parent level's objects kept at this level.  `1.0` at level 0. |
| `coarsening_method`         | `"per_object" \| "manual" \| "none"` | How this level was generated.  `"none"` at level 0. |
| `parent_level`              | int \| null                       | Index of the source level; `null` at level 0, required above it. |
| `bin_shape`                 | `[float, ...]`                    | Above level 0: this level's bin edge lengths.  Absent at level 0. |
| `bin_ratio`                 | `[float, ...]`                    | Above level 0: `bin_shape / base_bin_shape` per axis — relative to **level 0**, not to the parent — as a float that MUST NOT be rounded.  Every entry ≥ 1.  Absent at level 0. |
| `chunk_shape`               | `[float, ...]`                    | Per-level chunk-shape override.  Each axis must be a positive integer multiple of root `chunk_shape`. |
| `fragments_tile`            | `true`                            | Every chunk's vertex fragment index tiles its buffer exactly, letting a bulk read skip `vertex_fragments`.  Any write to `vertices` or `vertex_fragments` MUST remove it.  Absent means unknown. |
| `link_fragments_aligned`    | `true`                            | Link fragment `k` of each intra-chunk link cell holds exactly the records whose first endpoint is in vertex fragment `k`.  Any write to the arrays it describes MUST remove it.  Absent means unknown. |
| `chunk_dims`                | `list[string]`                    | Names of chunk-key axes (leading axis first), when the level is chunked along a non-spatial axis ([§6.7](06-spatial-indexing.md#67-leading-non-spatial-chunk-axes)). |
| `chunk_attribute_name`      | string                            | Per-vertex attribute used as the leading chunk axis. |
| `chunk_attribute_values`    | `list[any]`                       | Ordered list mapping leading-axis chunk coordinate to attribute value. |
| `chunk_sources`             | `list[object]`                    | The stores each value of a leading `source` axis reads from ([§6.7](06-spatial-indexing.md#67-leading-non-spatial-chunk-axes)). |
| `preserves_object_ids`      | `true`                            | This level inherits the parent's object-ID space (dropped objects → empty manifest slots).  MUST NOT be set at level 0. |
| `inherited_num_objects`     | int ≥ 0                           | Size of the object-ID space inherited from `parent_level`.  Required when `preserves_object_ids` is true. |
| `shared_fragments`          | `true`                            | Per-chunk fragments at this level may be referenced by several objects' manifests. |
| `octree_chunks`             | object                            | The level has octree chunks ([§6.5](06-spatial-indexing.md#65-octree-chunks)).  Requires the `octree_chunks` capability. |
| `presence`                  | `"deferred"`                      | Build-time only ([Deferred presence](#deferred-presence)). |

`bounds` MUST NOT appear in a level object; it is root-only.

A coarse level's bin geometry is stored in its level object and
nowhere else; the `multiscales` block carries none
([§8.10](#810-multiscales)).  Level 0's bin is the root
`base_bin_shape` (or `chunk_shape`).  A coarse level that records
neither reads as level 0's.  See
[§9.3](09-multi-resolution-support.md#93-spatial-chunk-scaling).
`bin_ratio`, `bin_shape`, `chunk_shape` and the root `bounds` fix the
layout of arrays already written; a writer MUST NOT change them on a
level that holds data.

Cross-level invariants:

- A per-level `chunk_shape` must be a positive integer multiple of the
  root `chunk_shape`, and an integer multiple of the level's
  `bin_shape`, along every axis.
- Each coarse level's `parent_level` names an existing level, the chain
  reaches level 0 without cycles, and `bin_ratio` equals
  `bin_shape / base_bin_shape`.

### Deferred presence

`presence: "deferred"` is set only while uncoordinated workers are
writing a level.  The level's per-chunk arrays MAY then lack
`nonempty_chunks` ([§7](07-core-arrays.md#per-chunk-array-keys)), and a
reader MUST take presence from the store (by listing or reading cells)
and MUST NOT treat such an array as empty.  A coordinator ends the
state by writing every array's `nonempty_chunks` and then removing
`presence`, so a finished store never carries it; a validator SHOULD
warn when it does.

## 8.4 Array-Level Metadata

Every array and family group carries its properties in its
`zarr_vectors` object with an array `kind` (examples in
[§7](07-core-arrays.md#array-metadata)).  Fields Zarr already records
(`shape`, `chunk_grid`, `codecs`) stay in the standard places.  `dtype`
is the element type of the rows *inside* a cell; the cells are byte
strings, so a reader MUST take the element type from `dtype`, not from
the array's Zarr `data_type`.

Recognized array kinds, with their fields (each array's fields are
specified in [§7](07-core-arrays.md)):

| `kind`                     | Node                                                                | Required fields | Optional fields |
|----------------------------|---------------------------------------------------------------------|-----------------|-----------------|
| `"vertices"`               | `<level>/vertices/`                                                  | `dtype`, `encoding` (`"raw"` \| `"draco"`) | `shape`, `compression_codec` |
| `"vertex_fragments"`       | `<level>/vertex_fragments/`                                          | `encoding` = `"fragment_index_v1"` | — |
| `"link_fragments"`         | `<level>/link_fragments/`                                            | `encoding` = `"fragment_index_v1"` | — |
| `"links_family"`           | `<level>/links/<delta>/` — **group**                                 | `level_delta`, `link_width`, `directed`, `store` (`"canonical"` \| `"duplicate"`) | `sid_ndim`, `num_links`, `num_physical_records` |
| `"links"`                  | `<level>/links/<delta>/<offsets>/`                                   | `dtype`, `offsets`, `has_perm`, `link_width`, `level_delta` | — |
| `"vertex_attribute"`       | `<level>/vertex_attributes/<name>/`                                  | `name`, `dtype`, `row_shape` | `channel_names`, `channel_dtype`, `unit`, `description`, `encoding` = `"dictionary"` with `categories`, `ordered`, `_FillValue` |
| `"fragment_attribute"`     | `<level>/fragment_attributes/<name>/`                                | `name`, `dtype`, `row_shape` | `channel_names`, `channel_dtype` |
| `"link_attribute_family"`  | `<level>/link_attributes/<name>/<delta>/` — **group**                | `name`, `level_delta` | `num_links` |
| `"link_attribute"`         | `<level>/link_attributes/<name>/<delta>/<offsets>/`                  | `name`, `dtype`, `row_shape`, `offsets`, `level_delta` | `channel_names` |
| `"object_index"`           | `<level>/object_index/` — **group**                                  | `layout`, `num_objects`, `sid_ndim` once it holds manifests | `num_present`, `object_ids_sorted`, `block_dtype` (dense, `"int32"` only) |
| `"object_attribute"`       | `<level>/object_attributes/<name>`                                   | `name`, `dtype` | `shape`, `channel_names`, `fill_sentinel_meaning` = `"absent"` |
| `"groups"`                 | `<level>/groups`                                                     | `num_groups` | `group_ranges` |
| `"group_attribute"`        | `<level>/group_attributes/<name>`                                    | `name`, `dtype` | `shape`, `channel_names` |

Every per-chunk kind (`vertices`, `vertex_fragments`,
`link_fragments`, `links`, `vertex_attribute`, `fragment_attribute`,
`link_attribute`) also carries `nonempty_chunks` and, when non-zero,
`chunk_grid_origin` ([§7](07-core-arrays.md#per-chunk-array-keys)); no
other kind may carry them.  The arrays inside `object_index/`
(`manifests`, `object_ids`, `manifest_spans`, `manifest_blocks`) carry
no `zarr_vectors` attribute: their parent group describes them.  The
plain container groups (`vertex_attributes/`, `links/`,
`link_attributes/<name>/`, …) carry none either.

Kind spellings are normative.  A reader SHOULD reject a node whose
`kind` it does not recognise, and MUST NOT interpret it as any kind it
does recognise.

### Parametric objects

The optional root-level `parametric/` group carries
`kind: "parametric"` and the type table:

```json
"zarr_vectors": {
  "kind": "parametric",
  "parametric_types": {
    "0": {"name": "plane", "coefficients": ["A", "B", "C", "D"]},
    "1": {"name": "line", "coefficients": ["x0", "y0", "z0", "dx", "dy", "dz"]},
    "2": {"name": "sphere", "coefficients": ["cx", "cy", "cz", "r"]}
  }
}
```

Types `0`–`2` are built in; a writer MAY add further type ids.

Its arrays carry `kind: "parametric_objects"` (`parametric/objects`;
fields `num_objects`, `max_row_length`, `dtype`) and
`kind: "parametric_names"` (`parametric/names`; field `num_objects`).

## 8.5 Object-Level Metadata

Per-object data lives in `<level>/object_attributes/<name>`, dense
`(B,)` or `(B, C)` arrays aligned to the object rows of the level's
object index.  There is no fixed schema; common names:

- `"name"` — human-readable label per object.
- `"type"` — categorical kind (mesh / skeleton / polyline / …).
- `"centroid"` — `(B, sid_ndim)` per-object summary point.
- `"termination"` — `(B, 2)` for streamline endpoints (channel 0 =
  source, channel 1 = sink region IDs).

On an OID-preserving level, an object dropped at that level keeps its
row (with an empty manifest) in every `object_attributes/<name>`
array ([§7.6](07-core-arrays.md#76-object-index)).

## 8.6 Group-Level Metadata

Per-group data lives in `<level>/group_attributes/<name>`, dense
`(G,)` or `(G, C)` arrays keyed by group ID.  Common names:

- `"region_name"` — name per anatomical region group.
- `"tract_name"` — name per fascicle group.
- `"super_type"` — coarser label for hierarchical grouping (hierarchy
  is expressed by attributes, not structure).

## 8.7 Point-Level Metadata

Per-vertex data lives in the `<level>/vertex_attributes/<name>` cell
for a chunk, row-aligned to the `vertices` cell at the same
coordinate.  The column count is the array's `row_shape`; channel
labels are its `channel_names`.  Splitting one attribute into several
per-channel arrays is a writer's choice.  Vertex, object and link
attributes MAY be declared in the root `attribute_specs`
([§8.2](#attribute_specs)).

## 8.8 Coordinate Reference System (CRS)

A store's CRS is a PROJJSON object in the root attribute
`proj:projjson`, defined by the
[proj convention](https://github.com/zarr-conventions/proj) v0.1:

```javascript
"proj:projjson": {"type": "ProjectedCRS", "name": "WGS 84 / UTM zone 33N", ...}
```

- A store with a CRS MUST register the proj convention on the root
  ([§8.9](#89-convention-registration-zarr_conventions)); a store
  without one has neither.
- Writers write `proj:projjson` only.  A reader MAY also accept the
  proj convention's `proj:code` and `proj:wkt2`.
- The CRS applies to world positions (stored position plus
  `coordinate_offset`).  Axis units are on the root's `axes`.
- There is no per-level transform ([§8.10](#810-multiscales)).

## 8.9 Convention Registration (`zarr_conventions`)

Every node that carries a `zarr_vectors` attribute MUST list the Zarr
Vectors convention in its `zarr_conventions` attribute, as the
[Zarr Conventions specification](https://github.com/zarr-conventions/zarr-conventions-spec)
requires.  On the root the entry is the full one:

```json
{
  "schema_url": "https://raw.githubusercontent.com/AllenInstitute/zarr-vectors-convention/refs/tags/v0.1.0/schema.json",
  "spec_url": "https://github.com/AllenInstitute/zarr-vectors-convention/blob/v0.1.0/README.md",
  "uuid": "66268a61-7833-4995-bbcb-233bb417dae5",
  "name": "zarr_vectors",
  "description": "Spatially chunked, multi-resolution N-dimensional vector data (point clouds, meshes, skeletons, streamlines, graphs)"
}
```

On every other node writers write the short form
`{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}`.

The root also registers:

| Convention | UUID | When |
|------------|------|------|
| [multiscales](https://github.com/zarr-conventions/multiscales) v0.1 | `d35379db-88df-4056-af3a-620245f8e347` | Always (the root carries a `multiscales` block) |
| [proj](https://github.com/zarr-conventions/proj) v0.1 | `f17cb550-5864-4468-aeb7-f3180cfb622f` | When the store has a CRS (`proj:projjson`) |

Writers write these as full entries (`schema_url`, `spec_url`,
`uuid`, `name`, `description`).  A writer MUST keep entries for other
conventions and replaces its own rather than duplicating it.  Readers
identify an entry by its `uuid`.

## 8.10 Multiscales

The root's `multiscales` attribute is the
[multiscales convention](https://github.com/zarr-conventions/multiscales/blob/v0.1/README.md)
v0.1 block, with one `layout` entry per level in ascending order:

```json
"multiscales": {"layout": [{"asset": "0"}, {"asset": "1"}, {"asset": "2"}]}
```

- `asset` is the level group's name.  Level `"0"` MUST be present, and
  the assets MUST match the level groups one to one.
- Vertex positions are in level-0 coordinates at every level, so no
  transform relates the levels.  Writers SHOULD NOT write a
  `transform`; if present it MUST be the identity.
- The block carries no bin geometry ([§8.3](#83-resolution-level-metadata)).
- `derived_from` MAY be present; if so it MUST equal the level's
  `parent_level`.  A writer keeps other keys already in an entry.

A Zarr Vectors store is not an OME-Zarr image and carries no OME-NGFF
`multiscales` list.

## 8.11 OME-Zarr RFC 8 Node (`ome`)

The root MAY carry an `ome` attribute, an
[OME-Zarr RFC 8](https://ngff.openmicroscopy.org/rfc/8/) `collection`
node, so that an OME collection elsewhere can name the store by path:

```json
"ome": {
  "version": "0.6",
  "type": "collection",
  "name": "streamline_pyr",
  "attributes": {
    "scene": {
      "coordinateSystems": [{
        "id": "world", "name": "world",
        "axes": [{"name": "x", "type": "space"}, {"name": "y", "type": "space"},
                 {"name": "z", "type": "space"}]
      }],
      "coordinateTransformations": []
    }
  },
  "nodes": [{"type": "zv:level", "name": "0"}, {"type": "zv:level", "name": "1"},
            {"type": "zv:level", "name": "2"}]
}
```

`name` defaults to the store's directory name without extension.
`nodes` holds one `zv:level` leaf per level; writers keep other entries
when refreshing the list.  The `world` system restates the root's
`axes`.  The node only restates authoritative fields: readers MUST NOT
depend on it, a store without it is valid (a validator SHOULD warn),
and it can be added in place without rewriting data.

## 8.12 Version Rules

The root's `zv_version` is the **format version**, covering the
metadata layout and the cell layouts.  It is independent of the
convention version (the `v0.1.0` tag in the registration URLs).
Convention 0.1.0 covers format `0.10.0`.

A 0.10.0 reader:

1. MUST refuse a store whose root `zarr_vectors` object has no `kind`
   (one written before 0.10.0).  For a 0.9.x store the refusal SHOULD
   name the in-place metadata migration
   ([Appendix J](15-appendices.md#migration)).
2. MUST refuse a root whose `kind` is not `"root"`.
3. MUST refuse a store whose `zv_version` has a newer major or minor
   version than its own (`0.11.0`, `1.0.0`, …).  A newer patch version
   of the same minor (`0.10.1`) is readable.
4. MUST treat a malformed `zv_version` (not `X.Y` or `X.Y.Z` integers),
   or a version older than `0.10.0` on a root that has `kind: "root"`,
   as invalid metadata.
5. MUST NOT interpret cells of a format version it does not support.

A reader MUST reject a store it cannot identify rather than read it on
a best-effort basis
([§13.2](13-conformance-and-validation.md#132-validation-rules)).

A 0.9.x store migrates in place by rewriting its `zarr.json`
documents; older stores must be rewritten from source
([Appendix J](15-appendices.md#migration)).
