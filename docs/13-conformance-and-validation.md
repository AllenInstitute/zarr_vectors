# 13. Conformance and Validation

## 13.1 Conformance Levels

A **conforming writer** produces stores that pass every rule in
[§13.2](#132-validation-rules).  A **conforming reader** applies the
reader rules in §13.2 (version, `kind`, object-index layout,
capabilities) before it interprets any cell.

Validation runs at one of five cumulative levels: level N runs the
checks of levels 1 to N.  The reference validator is
`zarr_vectors.validate.validate(store, level=N)`.

| Level | Name | Checks | Reads |
|-------|------|--------|-------|
| 1 | Structural | Store opens; root has a `zarr_vectors` object (warning without an `ome` node); level groups and their `vertices/` exist; per-chunk arrays share one grid rank | metadata |
| 2 | Metadata | Root and level field values: version, axes, `chunk_shape`, `bounds`, bins, enumerations, per-level `chunk_shape` nesting; presence deferral (warning); octree capability lists (warning) | metadata |
| 3 | Consistency | Cells decode; `vertex_count`, `fragments_tile` and `link_fragments_aligned` hold; manifests and links name chunks and fragments that exist; dense-index arrays are well formed; octree leaf and cell tables match the stored chunks | every cell |
| 4 | Geometry conventions | `links_convention` allowed for each geometry type; mesh `link_width ≥ 3`; no links in a pure point cloud (warning) | metadata |
| 5 | Pyramid | Levels numbered `0 … n-1`; vertex counts do not grow; `bin_ratio` volume does not shrink; `object_sparsity` in `(0, 1]` | metadata |

The result lists passed checks, warnings and errors.  A warning does
not make a store non-conforming.

## 13.2 Validation Rules

**Version** ([§8.12](08-metadata.md#812-version-rules)).  `zv_version`
is on the root object.  A 0.10.0 reader MUST refuse:

- a 0.9.x or older store, recognisable by a root `zarr_vectors` object
  with no `kind`.  The refusal SHOULD name the in-place migration
  ([Appendix J](15-appendices.md#appendix-j-change-log));
- a store whose `zv_version` has a newer minor version than the reader's
  (for example `0.11.0`);
- a root `zarr_vectors` object whose `kind` is not `"root"`.

**Registration**
([§8.9](08-metadata.md#89-convention-registration-zarr_conventions)).
Every node that carries a `zarr_vectors` attribute
MUST list the Zarr Vectors convention in `zarr_conventions`: the full
entry on the root, at least `{"uuid": "66268a61-7833-4995-bbcb-233bb417dae5"}`
elsewhere.  The root MUST also register the multiscales convention
(uuid `d35379db-88df-4056-af3a-620245f8e347`) and, when it has
`proj:projjson`, the proj convention (uuid
`f17cb550-5864-4468-aeb7-f3180cfb622f`).  The `multiscales` block
lists exactly the level groups, with no transform
([§8.10](08-metadata.md#810-multiscales)); an `ome` node, if present,
follows [§8.11](08-metadata.md#811-ome-zarr-rfc-8-node-ome).

**`kind`.**  Every `zarr_vectors` object has a `kind`.  A reader SHOULD
reject a node whose `kind` it does not recognise, and MUST NOT interpret
it as a known kind.  The 0.10.0 values:

| Node | `kind` |
|------|--------|
| Store root | `root` |
| `<level>/` | `level` |
| `<level>/vertices`, `vertex_fragments`, `link_fragments` | `vertices`, `vertex_fragments`, `link_fragments` |
| `<level>/links/<delta>` and its `<offsets>` arrays | `links_family`, `links` |
| `<level>/vertex_attributes/<name>`, `fragment_attributes/<name>` | `vertex_attribute`, `fragment_attribute` |
| `<level>/link_attributes/<name>/<delta>` and its arrays | `link_attribute_family`, `link_attribute` |
| `<level>/object_index` | `object_index` |
| `<level>/object_attributes/<name>` | `object_attribute` |
| `<level>/groups`, `group_attributes/<name>` | `groups`, `group_attribute` |
| `parametric/`, `parametric/objects`, `parametric/names` | `parametric`, `parametric_objects`, `parametric_names` |

The arrays inside `object_index/` carry no `zarr_vectors` attribute;
their group describes them.

**Object-index layout.**  `object_index`'s `layout` is
`vlen_manifests_v1`, `vlen_manifests_v2` or `dense_manifests_v1`.  A
reader MUST reject a store with any other value, or with none once the
index holds manifests, rather than read it on a best-effort basis:
guessing at an unknown layout yields plausible wrong answers instead of
an error.

**Capabilities.**  An unknown `format_capabilities` token is a validator
finding, not grounds for a reader to fail; the reader treats the feature
as absent ([Appendix H](15-appendices.md#appendix-h-extensibility)).  A
reader SHOULD refuse a store whose `required_capabilities` lists a token
it does not support, and MUST NOT read an octree-chunked level unless it
supports `octree_chunks`.

Within each validation level, a representative sample of the checks:

- **Structural**: every name under a `links/<delta>/` or
  `link_attributes/<name>/<delta>/` group parses as a valid offsets
  segment for the family's `link_width` and `sid_ndim`;
  `chunk_grid_origin`, where present, has `sid_ndim` entries; every
  `nonempty_chunks` key has the array's rank.
- **Metadata**: `zv_version` at least `0.10.0`; at least two `space` axes
  with unique axis names; `chunk_shape`, `bounds` and `base_bin_shape`
  have `sid_ndim` entries, and `chunk_shape` is an integer multiple of
  `base_bin_shape`; `links_convention`, `object_index_convention`,
  `cross_chunk_strategy`, `cross_level_storage`, `manifest_layout` and
  `manifest_block_dtype` are in their enumerations; `octree_sharding`
  appears only with `shard_shape`.
- **Consistency**: every `vertex_fragments` cell decodes to a
  `FragmentIndex` whose ranges land within the rows of the `vertices`
  cell at the same coordinate; manifest blocks reference fragments that
  exist; `nonempty_chunks` agrees with the cells present.  For every
  populated link cell: row width is `link_width + (1 if has_perm else 0)`
  and the byte length is an exact multiple of one row; `has_perm` equals
  what the family policy implies
  ([§10.6.5](10-cross-chunk-linking.md#1065-whether-a-permutation-index-is-present));
  every `vi_k` is within the vertex count of chunk `src + o_k`, and that
  chunk exists at the endpoint's level.  Only the all-zero offsets array
  at `delta = 0` has `link_fragments`, with a cell for every cell it
  populates.  Each `link_attributes/<name>/<delta>/<offsets>` cell has
  as many rows as the matching link cell has records.  A dense index has
  `manifest_spans`, `manifest_blocks` and `object_ids` and no
  `manifests`, and no span reaches past `manifest_blocks`.
- **Conformance**: geometry rules — e.g. `mesh` requires
  `links_convention == "explicit"`; `streamline` requires
  `implicit_sequential`.
- **Multi-resolution**: per-level `chunk_shape` (if set) is a positive
  integer multiple of root; per-level `bin_shape` divides per-level
  `chunk_shape`; `preserves_object_ids` levels carry
  `inherited_num_objects`.

## 13.3 Validation Tools

- **Convention JSON Schema**: the
  [Zarr Vectors convention](https://github.com/AllenInstitute/zarr-vectors-convention)
  publishes a JSON Schema (draft 2020-12) at
  `https://raw.githubusercontent.com/AllenInstitute/zarr-vectors-convention/refs/tags/v0.1.0/schema.json`,
  the `schema_url` of the root's registration.  Validate each `zarr.json`
  that carries a `zarr_vectors` attribute against it, with any JSON
  Schema validator (the convention repository ships
  `node validate.js schema.json <zarr.json>`).  The schema checks one
  node at a time — `kind`, required fields, types, enumerations and the
  registration — and is the normative definition of node metadata.
  Rules that span nodes (chunk grids, offsets lengths, the `multiscales`
  layout against the level groups, `parent_level` chains) need the
  validator below.
- **Reference validator**: `zarr_vectors.validate.validate(store,
  level=N)` returns a `ValidationResult` with `passed`, `warnings` and
  `errors` lists.  It does not check `zarr_conventions` registrations or
  the `multiscales` block; use the JSON Schema for those.
- **LinkML schema**: secondary.  zarr-vectors-py keeps a LinkML model
  (`schema/zarr_vectors.linkml.yaml`) of the same metadata; where it and
  the convention's `schema.json` disagree, `schema.json` wins
  ([Appendix A](15-appendices.md#appendix-a-json-schema-definitions)).

## 13.4 Compatibility

- **Format versions**: 0.10.0 changes only where metadata lives; cell
  payloads are those of 0.9.4.  A 0.9.x reader cannot read a 0.10.0
  store, and a 0.10.0 reader refuses a 0.9.x store.  A 0.9.x store
  migrates in place, rewriting only `zarr.json` files, with
  `zarr_vectors.building.migrate_metadata_0_10(path)`, which rewrites
  the root last so an interrupted run can be rerun
  ([Appendix J](15-appendices.md#appendix-j-change-log)).
- **Zarr** — only Zarr v3 is supported.  Per-chunk arrays need the
  `bytes` data type and `vlen-bytes` codec extensions; arrays sharded
  with `octree_sharding` need that codec.
- **Zarr conventions** — tools that know the multiscales convention can
  list the levels; tools that know the proj convention can read the CRS.
- **OME-Zarr** — the store is not an OME-Zarr image and has no NGFF
  `multiscales` block, so NGFF image viewers do not open it.  An OME
  collection can name it through its RFC 8 `ome` node.
- **TRX** — when `sid_ndim` collapses to 1 and the store has a single
  spatial chunk, the layout aligns conceptually with TRX (positions
  + offsets + per-vertex / per-streamline / per-group data); see
  [§14.8](14-examples.md#148-simple-dti-small-volume-trx-aligned).
  Converters live in `zarr-vectors-tools`.
