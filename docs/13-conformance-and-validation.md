# 13. Conformance and Validation

## 13.1 Conformance Levels

Validation is cumulative — level N implies levels 1..N-1 pass first.
The reference implementation lives in `zarr_vectors.validate.*`; each
level corresponds to one submodule.

| Level | Submodule          | Checks                                                                                          |
|-------|--------------------|-------------------------------------------------------------------------------------------------|
| 1     | `structure.py`     | Required filesystem layout: `zarr.json` parses, level groups exist, per-array groups are wired. |
| 2     | `metadata.py`      | Root and per-level metadata schema (LinkML); conventions / capability tokens are recognized.   |
| 3     | `consistency.py`   | Cross-array internal consistency: fragment counts ≤ bins-per-chunk, manifests reference live chunks/fragments, every link array's name parses as a valid offsets segment, every `vi_k` addresses an existing vertex in chunk `src + o_k`, per-cell attribute parity holds, per-level vertex counts agree with `arrays_present`. |
| 4     | `conformance.py`   | Convention compliance: `links_convention` matches geometry, bin-bounds spot checks for point clouds, per-geometry link-width invariants.                                                              |
| 5     | `conformance.py`   | Multi-resolution coherence across the pyramid: nested `chunk_shape`, `bin_ratio` consistency, OID-preservation invariants, `cross_level_storage`-driven array presence.                                |

The unified entry point is `zarr_vectors.validate.validate(path,
level=N)`; the result is a `ValidationResult` carrying passes,
warnings, and errors per check.

## 13.2 Validation Rules

Within each level, the implementation runs a fixed battery of checks.
A representative (non-exhaustive) sample:

- **Structural**: every present array or group has a `zarr.json` with
  a recognized `"zv_array"` discriminator; every name under a
  `links/<delta>/` or `link_attributes/<name>/<delta>/` group parses
  as a valid offsets segment for the family's `link_width` and
  `sid_ndim`; `chunk_grid_origin`, where present, has `sid_ndim`
  entries; `object_index/manifests` decodes without truncation.
- **Metadata**: `zv_version >= "0.9.0"`; `chunk_shape` length matches
  `sid_ndim`; `links_convention`, `object_index_convention`,
  `cross_chunk_strategy`, `cross_level_storage` are in the canonical
  enumerations; `format_capabilities` tokens are recognized
  (`fragment_index`, `shared_fragments`, `preserved_object_ids`,
  `multiscale_links`) — an unrecognized token is a *validator* finding,
  not grounds for a reader to fail, since the token set is open
  ([Appendix H](15-appendices.md#appendix-h-extensibility)).
  `object_index`'s `layout` equals `"vlen_manifests_v1"`; **any other
  value MUST cause the store to be rejected outright** rather than read
  on a best-effort basis.  An unrecognized container discriminator
  means the store was written to a contract this document does not
  describe, and guessing at it yields plausible wrong answers instead
  of an error.
- **Consistency**: every `vertex_fragments` cell decodes to a
  `FragmentIndex` whose ranges land within the row bounds of the
  `vertices` cell at the same coordinate; manifest blocks reference
  fragments that exist; `nonempty_chunks` agrees with the cells
  actually present.  For every populated link cell: row width is
  `link_width + (1 if has_perm else 0)` and the byte length is an
  exact multiple of one row; `has_perm` equals what the family policy
  implies ([§10.6.5](10-cross-chunk-linking.md#1065-whether-a-permutation-index-is-present));
  every `vi_k` is within the vertex count of chunk `src + o_k`, and
  that chunk exists at the endpoint's level.  The all-zero offsets
  array at `delta = 0` has a `link_fragments` cell for every cell it
  populates, and no other array has one.  For every parallel
  `link_attributes/<name>/<delta>/<offsets>` cell at the matching
  coordinate, row count equals the link cell's record count.
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
  identifying the level (`<n>:`), the array or
  chunk involved, and the failure mode.

## 13.4 Compatibility

- **OME-Zarr** — Zarr Vectors reuses NGFF axes (RFC 4) and coordinate
  transformations (RFC 5); a level group's `zarr.json` carries the
  same `multiscales` block an OME-Zarr image pyramid would, so
  generic NGFF tools can at least enumerate the levels and read
  units.
- **Zarr** — only Zarr v3 is supported.
- **TRX** — when `sid_ndim` collapses to 1 and the store has a single
  spatial chunk, the layout aligns conceptually with TRX (positions
  + offsets + per-vertex / per-streamline / per-group data); see
  [§14.8](14-examples.md#148-simple-dti-small-volume-trx-aligned) for the TRX-aligned example.  Zarr Vectors does not ship a TRX
  reader/writer; converters live in `zarr-vectors-tools`.
