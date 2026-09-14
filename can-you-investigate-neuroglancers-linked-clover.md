# Plan: align the Zarr Vectors spec with OME-Zarr RFC 8

## Context

`/Users/forrestc/ConnectomeStack/zarr_vectors` is a spec-only repo (docs 01–15, v0.9.0)
describing how to store N-D vector data — point clouds, skeletons, streamlines, meshes,
tracks — on Zarr v3. It already borrows from NGFF, but in a way that has drifted:

- It writes a **bare-root `multiscales` block with `version: "0.4"`**, deliberately *not*
  the `attributes.ome` nesting (`docs/08-metadata.md:199-201`).
- It has no node type. The format discriminator is smuggled into
  `multiscales[0]["metadata"]["format"] = "zarr_vectors"`, and the spec itself calls this
  "the closest thing it has to an RFC-8-style node-type declaration".
- Worst, **`coordinateTransformations` is semantically repurposed**: `scale =
  bin_shape / base_bin_shape`, `translation = bin_shape / 2`, read back as
  `bin_shape = 2 × translation` (`docs/09-multi-resolution-support.md:102-131`). That is
  not the physical scale of the level — vertices are already stored in world coordinates.
  The spec knows this is dangerous and says so: "Nothing in the Zarr Vectors API would
  show the disagreement; any NGFF viewer would render it."
- Everything Zarr Vectors–specific lives in ad-hoc top-level `zarr.json` keys
  (`zarr_vectors`, `zarr_vectors_level`, `zv_array`) with no `must_understand`, no Zarr v3
  `extensions` array, and no registered prefix.

RFC 8 supplies exactly the mechanism this needs: a common **Node** interface (`type`, `id`,
`name`, `attributes`, root-only `version`), a `collection` node type, `Path`/`Reference`
objects for cross-store references, and a `prefix:name` namespacing rule that lets a third
party extend NGFF without an RFC. RFC 5 supplies `coordinateSystems`, a `coordinate` axis
type, and a `coordinates` lookup-table transformation — and RFC 5 explicitly leaves
geometry and points undefined, which is the gap Zarr Vectors fills.

**Outcome:** a single new proposal document in the spec repo that enumerates the node types,
maps every existing metadata key onto RFC 8 / RFC 5 concepts, and fixes the transform
overload — reusing native OME-Zarr concepts wherever they exist.

## Decisions taken (from the user)

| Question | Answer |
|---|---|
| Ambition | **Registered vendor extension** — own prefix, zarr-extensions-style registration. Not an upstream OME RFC. |
| Breakage | **Dual-write during transition** — emit the RFC 8 layout *and* today's keys for one version. |
| Collections | **Both** single-store hierarchy *and* multi-store aggregation via RFC 8 `path` references. |
| Deliverable | **One new proposal doc** in `zarr_vectors/docs/`. No rewrite of chapters 01–15, no JSON Schemas, no implementation changes. |

## Deliverable

One file: **`/Users/forrestc/ConnectomeStack/zarr_vectors/docs/proposals/rfc8-alignment.md`**

Plus a second `toctree` block in `/Users/forrestc/ConnectomeStack/zarr_vectors/docs/index.md`:

```
```{toctree}
:maxdepth: 2
:caption: Proposals

proposals/rfc8-alignment
```
```

Chapters 01–15 stay byte-identical — they are normative for v0.9.0 and this is a proposal.
The doc cross-references them by section anchor (the repo already uses
`[§9.3](09-multi-resolution-support.md#93-spatial-chunk-scaling)` style links).

## Design the document must encode

### 1. Prefix

Recommend **`zv:`**, registered as owned by the Allen Institute.

Flag honestly that RFC 8 says "the prefix identifies the user or organization that
introduces and maintains the extension", which argues for `aibs:`. Recommend `zv:` anyway
for legibility and continuity with the existing `zv_version` / `zv_array` keys, and record
the tradeoff rather than hiding it.

### 2. Node types

The governing principle, taken from RFC 8's own precedent: `labels`, `plate`, `well`,
`acquisition` and `scene` are **attributes on collections, not node types**. So mint a node
type only where a reader needs it to know *how to decode the bytes*; use a prefixed
attribute for anything that is a declaration about content.

| `type` | Zarr node | Represents | Key fields |
|---|---|---|---|
| `collection` *(native)* | store root group | the store | `nodes` (levels), `attributes.scene`, `attributes.zv:vectors` |
| `collection` *(native)* | level group `0/`, `1/`… | a resolution level | `nodes` (arrays/families), `attributes.zv:level` |
| `collection` *(native)* | aggregator group or standalone JSON | several stores / stores + images | `nodes` with `path` refs |
| `zv:vertices` | `<level>/vertices` array | the vertex table | `dtype`, `encoding`, `chunkGridOrigin?`, `nonemptyChunks?` |
| `zv:fragmentIndex` | `vertex_fragments`, `link_fragments` arrays | fragment-index blobs | `encoding: "fragment_index_v1"`, `domain: "vertex"\|"link"` |
| `zv:linkFamily` | `links/<delta>` group | one link family's policy | `levelDelta`, `linkWidth`, `directed`, `store`, `sidNdim`, counts |
| `zv:links` | `links/<delta>/<offsets>` array | link records | `dtype`, `offsets`, `hasPerm`, `linkWidth`, `levelDelta` |
| `zv:objectIndex` | `object_index` group | the manifest container | `numObjects`, `numPresent`, `sidNdim`, `layout` |
| `zv:objectManifests` | `object_index/manifests` array | manifest blobs | `layout: "vlen_manifests_v1"` |
| `zv:groups` | `groups` array | object groupings | `numGroups`, `groupRanges?` |
| `zv:attributeTable` | any attribute array | attributes at any granularity | **`domain`**: `vertex \| fragment \| link \| object \| group`, plus `name`, `dtype`, `rowShape`, `channelNames?` |

**Deliberately *not* node types**, and the doc must say why:

- **Geometry type.** Stays an attribute (`zv:vectors.geometry`). Geometry describes how to
  *interpret records*, not what a container *is* — the same reason `labels` is an attribute.
  A store may legitimately mix geometry types (`docs/12-geometry-types.md`), and the
  topology parameters that actually matter (`link_width`, `directed`, `links_convention`,
  `encoding`) already live on the link family and the vertices array.
- **Level.** A level is a `collection`, not a new type. It is emphatically **not** RFC 8
  `singlescale`, which means one Zarr array and constrains its transforms to
  `scale` / `sequence(scale, translation)`. A vector level is a group of many arrays.
- **Store root.** A `collection`, not a `zv:vectorset`. RFC 8's `multiscale` is tempting
  (it requires `coordinateSystems`, which we want) but its children are specified as
  `singlescale`, and ours cannot be. Flag this as the one place RFC 8 is genuinely
  insufficient: **there is no "multiscale whose levels are not single arrays"**. That is the
  question to take to the OME community.

The five separate attribute discriminators — `attribute`, `link_attribute`,
`object_attribute`, `fragment_attribute`, `groupings_attribute` — collapse into one
`zv:attributeTable` with a `domain` field. This also retires the `groupings_attribute`
spelling wart (normative today despite the array being named `group_attributes`,
`docs/08-metadata.md:143-147`). 13 discriminators → 8 node types.

### 3. Concept mapping

A table covering **every** key, with a verdict of *native reuse / `zv:` attribute / node
type field / dropped as derivable*:

- All 13 root `zarr_vectors` keys. Notably: `crs` and axis descriptors → native RFC 5
  `coordinateSystems` under the native `scene` attribute; `bounds` → stays a `zv:` attribute
  (RFC 5 has no extent concept); `format_capabilities` → stays, and gains a token for the
  RFC 8 block.
- All 14 level `zarr_vectors_level` keys. `chunk_shape` → becomes the chunk-grid coordinate
  system (below); `chunk_dims` / `chunk_attribute_*` → see §5.
- All 13 `zv_array` values → the node-type table above.

### 4. The coordinateTransformations fix

The core of the proposal. Under the native `scene` attribute on the root collection, declare
real RFC 5 coordinate systems:

| Coordinate system | Axes | Transformation to `world` | Genuinely a transform? |
|---|---|---|---|
| `world` | today's `multiscales[0].axes`, UDUNITS-2 units | — (it is the target) | — |
| `<level>/chunkGrid` | one `type: "array"`, `discrete: true` axis per space axis | `sequence(scale(chunk_shape), translation(chunk_grid_origin × chunk_shape))` | **Yes.** This is where per-level `chunk_shape` belongs. |
| `<level>/binGrid` | ditto | `sequence(scale(bin_shape), translation(bin_shape / 2))` | **Yes** — and this is where `translation = bin_shape/2` legitimately lives. It is the bin-centre convention, matching RFC 5's "voxel centre is the origin of the continuous coordinate system". |
| `<level>/vertices` | `[{name: "row", type: "array", discrete: true}, {name: "component", type: "coordinate"}]` | `{"type": "coordinates", "path": "<level>/vertices"}` | **Yes.** |

Two findings the document should lead with:

- **RFC 5's `coordinates` transformation is a vertex table.** It is defined as a lookup that
  reads a coordinate vector at an input location, backed by an array of shape
  `[d1..dN, M]` with one axis of `type: "coordinate"` of length M. A vertices array of
  `[n_rows, sid_ndim]` is precisely that, with N=1. This is exact native reuse for the thing
  RFC 5 claims not to cover.
- **The existing numbers were right; they were attached to the wrong coordinate system.**
  `bin_shape/2` is a real bin-centre offset. The bug was declaring it as the level's
  array→world transform, when vertices are already in world units and that transform is
  `identity`. Nothing about the bin grid needed to be invented — only re-homed.

Also state the honest limitation: ZV `vertices` is a **vlen-bytes array over the chunk
grid**, not a dense `[n_rows, sid_ndim]` array, so it does not literally satisfy RFC 5's
shape requirement for `coordinates`. Offer two resolutions and recommend the first:
(a) define `zv:coordinates` as a prefixed `CoordinateTransformation.type` that understands
the per-chunk blob layout — RFC 8 names `CoordinateTransformation.type` as an extension
point, so this is legal; (b) ask OME to permit ragged backing for `coordinates`.

Verify the RFC 5 connected-graph requirement holds: `chunkGrid`, `binGrid` and `vertices`
each have an edge to `world`, per level.

### 5. Chunk-key order vs NGFF axis order

One mechanism resolves two of the known inconsistencies. NGFF requires axes declared
`time → channel → custom → space`; the implementation's default is `x, y, z, w`
(`zarr-vectors-py/zarr_vectors/constants.py:166`), and `docs/14-examples.md:361-366` has an
XYZT example that declares `t` first but puts it **last** in the chunk key.

Proposal: declare `coordinateSystems.axes` in NGFF order always, and make the chunk-key
order explicit and separate in `zv:level.chunkAxes` (a rename of the existing `chunk_dims`,
which already does exactly this job for the non-spatial case). Axis declaration order and
chunk-key order become independent, and both examples become conformant.

### 6. Collections, for both uses

- **Single store:** root `collection` → level `collection`s → array nodes, all inline via
  `nodes`.
- **Aggregation:** a parent `collection` whose `nodes` use `path` references —
  `{"type": "collection", "name": "cell_001", "path": {"type": "zarr", "path": "./cell_001.zarrvectors"}}`.
  Serves the distributed-write case in `docs/14-examples.md`, and standalone-JSON form for a
  manifest that lives outside any store.
- **Lead the doc with the motivating example**: one collection holding an OME-Zarr *image*
  multiscale plus a Zarr Vectors *skeleton* store, co-registered through a shared `world`
  coordinate system. This is the payoff of alignment and is not expressible today.

### 7. Dual-write and versioning

- Emit **both** the `attributes.ome` RFC 8 node block and today's bare-root `multiscales` +
  `zarr_vectors` keys.
- Name the RFC 8 block **authoritative** and the bare-root block a **derived mirror written
  by a single writer** — RFC 8 explicitly warns that it "introduces the possibility for
  redundant metadata... that can go out of sync", so the proposal must assign precedence
  rather than leave it open. (The zarr-extensions attribute-registration process requires
  documenting precedence rules anyway.)
- Add a `format_capabilities` token (e.g. `ome_rfc8`) so a reader can detect the new block
  without probing.
- `zv_version` **0.10.0** — additive, so no hard break, despite the project's usual
  hard-break-only policy. A later **1.0.0** drops the mirror and the repurposed transform.
- Set the NGFF `version` to `"0.5"` in the new block, which also settles the code-says-0.4 /
  docs-say-0.5 disagreement.

### 8. Recommendations on the five known inconsistencies

The doc closes with these, each with a verdict:

1. `bin_shape` / `bin_ratio` written into `zarr_vectors_level` by
   `zarr-vectors-py/zarr_vectors/core/metadata.py:657-688`, which `docs/08-metadata.md:90-98`
   forbids → **the prohibition should be deleted**. It only existed because the transform was
   the sole home for bin geometry. With a real `binGrid` coordinate system, `binShape` becomes
   a legitimate first-class level key and the implementation stops being in violation.
2. Axis order `x,y,z,w` vs OME order → fixed by §5.
3. NGFF `"0.4"` in code vs `"0.5"` in
   `zarr-vectors-py/docs/spec/comparisons/ome_zarr.md` → settled by §7.
4. Undocumented `parametric` family (`parametric_objects` / `parametric_names`, in
   `zarr-vectors-py/zarr_vectors/types/parametric.py`) → must be either documented as a node
   type or removed; call it out as unresolved rather than silently mapping it.
5. XYZT chunk-order tension (`docs/14-examples.md:361-366`) → fixed by §5.

### 9. Registration appendix

What a `zarr-extensions`-style directory would contain, mirroring
`/Users/forrestc/ConnectomeStack/zarr-extensions/README.md:44-66` (attributes register under
`attributes/<top-level-key>/`): `README.md` (MUST), `schema.json` (SHOULD, draft 2020-12,
`prettier`-formatted), and `examples/`. Note the local `codecs/nanovdb/` extension as the
section-order template. Since the user chose "proposal doc only", this is an appendix
describing the future deliverable, not the deliverable itself.

## Verification

This is a documentation change, so verification is build + link + example correctness:

1. **Sphinx builds clean.** `cd /Users/forrestc/ConnectomeStack/zarr_vectors/docs && pip
   install -r requirements.txt && sphinx-build -W -b html . _build/html` — `-W` turns the
   toctree/xref warnings that a new page most often causes into failures.
2. **Every cross-reference resolves.** The new doc links into chapters 01–15 by anchor;
   `-W` catches a bad anchor.
3. **Every JSON example parses.** Extract fenced ```json blocks and `python -m json.tool`
   each one. The doc will contain complete `zarr.json` examples for the store root, a level
   group, `vertices`, `links/<delta>/<offsets>` and `object_index`; a JSON typo in a spec is
   the defect most likely to be copied into an implementation.
4. **Examples are RFC-8-legal by inspection against a checklist** written into the doc:
   root node carries `version`, non-root nodes do not; every node has a `name`; names unique
   within their collection; `nodes` XOR `path`; every non-core identifier prefixed.
5. **Key inventory is complete.** Diff the mapping table's left column against the key lists
   in `docs/08-metadata.md:26-40` (13 root keys), `:73-88` (14 level keys) and `:125-141`
   (13 `zv_array` values) — every key appears exactly once with a verdict.
6. **Connected-graph check.** For the worked example, confirm each declared coordinate
   system has a transformation path to `world`, per RFC 5.

## Assumptions to re-check against the RFC text while drafting

These are load-bearing for the node-type table and were taken from a single reading of
RFC 8 (a follow-up fetch to confirm them was blocked by network policy). Each needs a quote
from https://ngff.openmicroscopy.org/rfc/8/ before the doc asserts it:

1. **A `collection`'s `nodes` may hold arbitrarily-typed (including prefixed) nodes.** The
   whole node-type table depends on this. RFC 8 does say node `type` is an extension point
   and that collections group "other data types (\"nodes\")", but confirm there is no
   closed list.
2. **A node may live in a Zarr *array*'s `zarr.json`, not only a group's.** `zv:vertices`,
   `zv:links`, `zv:attributeTable` etc. are arrays. RFC 8's `singlescale` represents one
   Zarr array, which implies yes — confirm explicitly.
3. **`scene` is allowed on an arbitrary collection**, not only on some specific kind. The
   plan puts `coordinateSystems` there on the store root.
4. **`multiscale`'s children are specified as `singlescale`.** This is the basis for the
   claim that a vector pyramid cannot be a `multiscale` and must be a `collection`. If RFC 8
   is looser than that, reconsider using `multiscale` for the store root and drop the
   "RFC 8 is insufficient" claim.
5. **Reader behaviour for *unprefixed* unknown keys.** RFC 8 states prefixed unknowns SHOULD
   be treated as opaque; confirm whether anything is said about unprefixed unknowns, since
   that governs how safe the dual-write mirror is.

If (4) turns out to be loose, the root-node choice changes and §2 and §6 need revising; the
rest of the design is unaffected.
