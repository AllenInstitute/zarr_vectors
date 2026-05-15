# 13. Conformance and Validation

## 13.1 Conformance Levels

Validation is cumulative — level N implies levels 1..N-1 pass first.
The reference implementation lives in `zarr_vectors.validate.*`; each
level corresponds to one submodule.

| Level | Submodule          | Checks                                                                                          |
|-------|--------------------|-------------------------------------------------------------------------------------------------|
| 1     | `structure.py`     | Required filesystem layout: `zarr.json` parses, level groups exist, per-array groups are wired. |
| 2     | `metadata.py`      | Root and per-level metadata schema (LinkML); conventions / capability tokens are recognized.   |
| 3     | `consistency.py`   | Cross-array internal consistency: VG counts ≤ bins-per-chunk, manifests reference live chunks/fragments, cross-chunk links land in existing chunks, per-level vertex counts agree with `arrays_present`. |
| 4     | `conformance.py`   | Convention compliance: `links_convention` matches geometry, bin-bounds spot checks for point clouds, per-geometry link-width invariants.                                                              |
| 5     | `conformance.py`   | Multi-resolution coherence across the pyramid: nested `chunk_shape`, `bin_ratio` consistency, OID-preservation invariants, `cross_level_storage`-driven array presence.                                |

The unified entry point is `zarr_vectors.validate.validate(path,
level=N)`; the result is a `ValidationResult` carrying passes,
warnings, and errors per check.

## 13.2 Validation Rules

Within each level, the implementation runs a fixed battery of checks.
A representative (non-exhaustive) sample:

- **Structural**: every present array group has a `zarr.json` with a
  recognized `"zv_array"` discriminator; chunk keys are valid
  N-tuples of non-negative integers; the manifest blob `object_index/
  data` decodes without truncation.
- **Metadata**: `zv_version >= "0.7.0"`; `chunk_shape` length matches
  `sid_ndim`; `links_convention`, `object_index_convention`,
  `cross_chunk_strategy`, `cross_level_storage` are in the canonical
  enumerations; `format_capabilities` tokens are recognized
  (`fragment_index`, `shared_fragments`, `preserved_object_ids`,
  `multiscale_links`).
- **Consistency**: every per-chunk `vertex_fragments/<chunk>` decodes
  to a `FragmentIndex` whose ranges land within `vertices/<chunk>`
  row bounds; manifest blocks reference fragments that exist; CCL
  records reference chunks present at the relevant level.
- **Conformance**: geometry-specific rules from
  `GEOMETRY_LINK_REQ` — e.g. `mesh` requires
  `links_convention == "explicit"`; `streamline` requires
  `implicit_sequential`.
- **Multi-resolution**: per-level `chunk_shape` (if set) is a
  positive integer multiple of root; per-level `bin_shape` divides
  per-level `chunk_shape`; `preserves_object_ids` levels carry
  `inherited_num_objects`.

## 13.3 Validation Tools

- **Reference validator**: `zarr_vectors.validate.validate(store,
  level=N)` returns a `ValidationResult` with `passed`, `warnings`,
  and `errors` lists.
- **LinkML schema**: the authoritative metadata schema is
  `schema/zarr_vectors.linkml.yaml` in the zarr-vectors-py package.
  External tools may generate JSON Schema / Pydantic / SQLAlchemy
  artifacts from it.
- **Error reporting**: each result entry is a single-line string
  identifying the level prefix (`resolution_<n>:`), the array or
  chunk involved, and the failure mode.

## 13.4 Compatibility

- **OME-Zarr** — ZV reuses NGFF axes (RFC 4) and coordinate
  transformations (RFC 5); a level group's `zarr.json` carries the
  same `multiscales` block an OME-Zarr image pyramid would, so
  generic NGFF tools can at least enumerate the levels and read
  units.
- **Zarr** — only Zarr v3 is supported.  Earlier ZV versions
  (pre-0.4) targeted Zarr v2; those stores are not readable by
  current implementations.
- **TRX** — when `sid_ndim` collapses to 1 and the store has a single
  spatial chunk, the layout aligns conceptually with TRX (positions
  + offsets + per-vertex / per-streamline / per-group data); see
  [§14.8](14-examples.md#148-simple-dti-small-volume-trx-aligned) for the TRX-aligned example.  ZV does not ship a TRX
  reader/writer; converters live in `zarr-vectors-tools`.
