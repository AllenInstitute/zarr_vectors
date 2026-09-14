<p align="center">
  <img src="docs/_static/zarr-vectors-logo.png" alt="Zarr Vectors" width="240">
</p>

# Aligning Zarr Vectors with OME-Zarr RFC 8 — summary for review

**Status:** proposal, not normative. Nothing in the spec (chapters 01–15) has changed.
**Full document:** [`docs/proposals/rfc8-alignment.md`](docs/proposals/rfc8-alignment.md) (~8,900 words)
**Date:** 2026-09-14 · **Spec baseline:** `zv_version` 0.9.0

---

## What this is

A design proposal for re-seating Zarr Vectors' metadata on **OME-Zarr RFC 8**, the
NGFF extensibility mechanism, and **RFC 5**, its coordinate-systems model.

It is a *proposal document only*. The normative chapters are untouched, no JSON
Schemas were written, and the reference implementation (`zarr-vectors-py`) was not
modified. Those are follow-on work, scoped at the end.

## Why now — the three ways the current NGFF seam has drifted

Zarr Vectors already borrows from OME-Zarr, but through a seam that no longer
holds together:

1. **It writes a bare-root `multiscales` block at NGFF `version "0.4"`**,
   deliberately not the `attributes.ome` nesting that NGFF 0.5+ requires
   (`docs/08-metadata.md` §8.8).

2. **It has no node type.** The "this is a Zarr Vectors store" discriminator is
   stamped at `multiscales[0]["metadata"]["format"] = "zarr_vectors"`. §8.8 is
   candid that this is a workaround, because NGFF reserves the entry's `type`
   field for the downsampling method.

3. **`coordinateTransformations` is semantically repurposed** to carry bin
   geometry (§9.3):

   ```text
   scale       = bin_shape / base_bin_shape
   translation = bin_shape / 2
   ```

   Vertices are already stored in world coordinates, so this is *not* the level's
   physical scale. §9.3 notes the hazard in passing — "any NGFF viewer would
   render it."

RFC 8 supplies exactly what the format has been approximating by hand: a common
**Node** interface (`type`, `id`, `name`, `attributes`, root-only `version`), a
`collection` node type, `Path`/`Reference` objects for cross-document linking, and
a `prefix:name` rule that lets a third party extend NGFF **without** going through
the OME RFC process.

## The headline finding

> **RFC 5 already built the `coordinate` axis type and the `coordinates`
> transformation, and then declared geometry out of scope.**

RFC 5 says explicitly that geometry primitives, points and annotation coordinate
binding are not covered. Yet it defines a `coordinates` transformation as a lookup
that returns a coordinate vector at an input location, backed by an array of shape
`[d1..dN, M]` carrying one axis of `type: "coordinate"` of length `M`.

**That is a vertex table.** The geometry gap in NGFF is much smaller than it
appears, and Zarr Vectors is unusually well placed to close it because its
geometry already lives *in* Zarr arrays rather than beside them (contrast
SpatialData, which puts points and shapes in geoparquet *next to* the NGFF store).

## The transform overload, diagnosed

The two halves of the repurposed transform fail differently, and that matters for
the fix:

| Half | Verdict |
|---|---|
| `scale = bin_shape / base_bin_shape` | **Not a coordinate transformation at all.** A dimensionless coarsening ratio sitting in a slot NGFF defines as world-units-per-index. A viewer that honours it double-scales the level. Also derivable (a ratio of two bin shapes), so it needs no storage anywhere. |
| `translation = bin_shape / 2` | **Correct, in the wrong place.** A half-bin offset is precisely RFC 5's "the voxel center is the origin of the continuous coordinate system" convention — but applied to the *bin grid*, while the slot claims to describe the level's data→world map. |

**The fix is not a new mechanism — it is RFC 5's `input`/`output` naming.** Once
every transformation must declare which coordinate system it starts from and which
it lands in, the current encoding becomes *unwriteable*: there is no pair of
declared systems for which those two compose into a single map. That is also why
§9.3 has to warn that "the two halves of one transform must agree" and derive one
from the other — that constraint was doing by hand the work `input`/`output` does
natively.

The corrected model declares five coordinate systems per store, all hub-connected
to `world`:

| System | To `world` | Genuinely a transform? |
|---|---|---|
| `world` | — (the hub) | — |
| `<N>/chunkGrid` | `sequence[mapAxis, translation([o+0.5]), scale([chunk_shape])]` | **Yes** — and it was never written before |
| `<N>/binGrid` | `sequence[mapAxis, translation([0.5,…]), scale([bin_shape])]` | **Yes** — was written, into the wrong slot |
| `<N>/vertexTable` | `zv:chunkedCoordinates` → `<N>/vertexSpace` → `world` | **Yes**, but needs an extension (see Q4) |
| `<N>/objects` | none, unless a centroid array exists | **No** — an index space |

`chunk_shape` and `bin_shape` now appear literally as `scale`s, with units.
`chunk_grid_origin` is absorbed into the `translation`, so the "stored only when
non-zero" special case disappears. `mapAxis` carries the permutation between
chunk-key order and NGFF world-axis order — which resolves two long-standing
inconsistencies without reordering anything on disk.

## Node types: 7 new strings

The governing rule, proposed as normative:

> **`type` answers "what IS this node." `attributes` carry parameters of a node
> whose kind is already known.** Mint a node type when a reader must dispatch on
> it to decode a byte correctly, or when the node has a payload contract
> validatable in isolation. Do not mint a type for a fact that is a *reference* or
> a *parameter*.

This follows RFC 8's own precedent, where `labels`, `plate`, `well`, `acquisition`
and `scene` are **attributes on collections, not node types**.

**Reused natively:** `collection` for the store root, levels, link families, the
object index and seven container groups; `singlescale` for every per-spatial-chunk
array; the native `scene` attribute for coordinate systems.

**New:**

| `type` | Why it has to exist |
|---|---|
| `zv:table` | All three RFC 8 node types presuppose a coordinate system. But `object_index/manifests` is indexed by object ID, and **an object ID has no position** — the object's fragments do. `zv:table` is an array node with no coordinate system. Supporting evidence: **SpatialData hit the same wall from the opposite direction** and forbids coordinate systems on tables outright. Two independent designs blocking on the same thing is good evidence OME's vocabulary is missing an "array without geometry" node. |
| `zv:points`, `zv:polylines`, `zv:tree`, `zv:graph`, `zv:mesh`, `zv:shapes` | Six geometry types as **inline** nodes — declarative views naming their vertex source, connectivity and attribute columns by Reference. RFC 8's `nodes[]` accepts inline Node objects, so **this changes nothing on disk.** Six independently validatable schemas rather than one union of six incompatible shapes. |

The five separate attribute discriminators (`attribute`, `link_attribute`,
`object_attribute`, `fragment_attribute`, `groupings_attribute`) collapse into one
kind plus a required `domain` field and an `alignedTo` Reference — they differed
only in which axis the column indexes. **This is the decision most likely to be
argued and is flagged as such in the document.**

Net effect: root keys 13 → 4, level keys 14 → 5, `format_capabilities` disappears
entirely, and 13 array discriminators become 9 kinds — while seven container
groups and one array that carry *no* discriminator today finally get one.

## Two real bugs found, not just tidying

These are defects in the current spec, independent of RFC 8:

- **`link_width = 4` is ambiguous.** §12.2 lists quad *and* tetrahedral meshes
  under it, with no way to tell them apart. A `cellType` field on the geometry
  node resolves it and makes the check bidirectional and mechanical.

- **`data_type: "variable_length_bytes"` is not a registered Zarr v3 name.**
  Verified against the `zarr-extensions` registry: it is data type **`bytes`** with
  codec **`vlen-bytes`**; `variable_length_bytes` is a zarr-python alias. **A
  validator checking against the actual registry would reject every documented
  example in the spec today.**

## All nine inconsistencies, with verdicts

The first five were known; four surfaced during this work.

| # | Issue | Verdict |
|---|---|---|
| 1 | The implementation writes `bin_shape`/`bin_ratio` into `zarr_vectors_level`, which §8.3 forbids — and they are the *first two keys written*, so every store on disk violates the docs | **The spec was right; remove the field, don't enforce the ban.** With a real `binGrid` coordinate system the field exists nowhere and cannot be misplaced |
| 2 | Default axis order is `x,y,z,w` — reverse of the OME image convention — while a comparison doc claims otherwise | **Keep `x,y,z` and fix the doc.** A vertex row is a coordinate tuple, not a voxel index; x-first is universal for point data. Declare `world` in NGFF order, `chunkGrid` in chunk-key order, and make the relation an explicit `mapAxis` |
| 3 | Code writes NGFF `"0.4"`; a comparison doc claims `"0.5"` | Both become obsolete — one constant on the root node |
| 4 | Undocumented `parametric` family (root-level, resolution-independent, with its own plane/line/sphere type registry) | **Document it as the sixth geometry, `zv:shapes`.** Not cruft — it is legitimately level-free, and its existing type registry is already the right design |
| 5 | §14.5 declares `t` first per NGFF order but lists it **last** in chunk coordinates | Fixed structurally by `mapAxis`; the contradiction becomes inexpressible |
| 6 | `vertices_<geometry_type>` arrays exist in the implementation for composite stores, undocumented | Document as the interim mixed-geometry layout; retire in 1.0.0 for per-geometry subgroups |
| 7 | `variable_length_bytes` vs the registered `bytes` + `vlen-bytes` | Correct the prose in four chapters |
| 8 | Three spellings for one entity: docs `groups`, LinkML `groupings`, directory `group_attributes`, discriminator `groupings_attribute` | Collapse to **object set**. "Group" must not name a non-Zarr-group concept in a format where every node is a Zarr group or array |
| 9 | `object_index/manifests` carries no discriminator, contradicting §13.1's rule that every node has a recognised one | Fixed by construction — RFC 8 requires `type` and `name` on every node |

A **genuine layout blocker** is also surfaced: the link path is
`links/<delta>/<offsets>/` with `linkWidth` on the `<delta>` group, so two
geometries at one level with different widths (mesh faces = 3, skeleton edges = 2)
**collide on `links/0/`**. Mixed-geometry stores cannot be expressed today. The
proposal restricts mixing in 0.10.0 and adds a `links/<family>/` segment in 1.0.0.

## Decisions already taken

| Question | Decision |
|---|---|
| Ambition | **Registered vendor extension** — own prefix (`zv`), registered in an OME-registry / `zarr-extensions`-style directory. Not an upstream OME RFC |
| Breakage | **Dual-write during transition** — emit the RFC 8 layout *and* today's keys for one version |
| Collections | **Both** — single-store hierarchy *and* multi-store aggregation via RFC 8 `path` references |
| Deliverable | **This proposal document only** — no chapter rewrites, no schemas, no implementation changes |

### One recommendation that runs against a decision — please weigh in

Dual-write is right for `zarr_vectors` and `zarr_vectors_level`, which are *true*
statements that merely move. It is a weaker call for the bare-root `multiscales`
block, because **that block is not redundant — it is false.** Its `scale` is a
dimensionless ratio in a slot NGFF defines as world-units-per-index. Keeping it
does not protect any reader; it preserves the one artefact that can make a reader
silently wrong. And no generic tool reads it usefully today: its discriminator is
in a non-standard slot, its NGFF version is `"0.4"`, and it is deliberately not
under `attributes.ome`.

Two independent design reviews reached the same conclusion: drop it. My
recommendation is to dual-write the two attribute blocks and **drop the bare-root
`multiscales`**, replacing the interop it was meant to provide with an optional
`zv:companionImage` Reference to a real OME-Zarr image store.

**The document implements dual-write as asked and presents both cases (§9.2).**
This is the single point where collaborator input would change the outcome most.

## What alignment buys — the motivating example

One collection holding an OME-Zarr image pyramid and Zarr Vectors stores,
co-registered through a shared `world` coordinate system. **Not expressible
today:**

```json
{"ome": {
  "version": "0.5",
  "type": "collection",
  "name": "minnie65_cell_864691135307555142",
  "nodes": [
    {"type": "multiscale", "name": "em",
     "path": {"type": "zarr", "path": "./em.ome.zarr"}},
    {"type": "collection", "name": "skeleton",
     "path": {"type": "zarr", "path": "./skeleton.zarrvectors"}},
    {"type": "collection", "name": "synapses",
     "path": {"type": "zarr", "path": "./synapses.zarrvectors"}}]}}
```

A viewer resolves three stores, sees all three declare space axes in micrometres,
and can place them in one scene.

The same machinery serves the distributed-write case in §14.10: each worker writes
an independent, valid store — no shared `nonempty_chunks` contention, which is the
stated pain point — and the coordinator publishes a manifest instead of rewriting
metadata.

## Ten open questions for the OME community

Three genuinely block the design; each has an interim workaround, so nothing
stalls on an answer. The blocking ones:

- **Q1 — May a `nodes[]` entry whose `type` is not `collection` carry a `Path`?**
  If `path` is collection-only, a level cannot list its arrays without inlining
  full array metadata into the parent, reintroducing exactly the duplication RFC 8
  warns about.
- **Q2 — `singlescale` restricts `coordinateTransformations` to `scale` or
  `sequence(scale, translation)`. Where do other RFC 5 edges go?** Forces
  free-standing edges under a prefixed sibling — legal, but the case that should
  eventually be core.
- **Q3 — Is there a node type for an array with *no* coordinate system?**
  `ome:table` or unprefixed `array` would let us delete `zv:table`.

The remaining seven (Q4–Q10) cover an encoding indirection for `coordinates`, a
core home for a bounding box, categorical labels on a discrete axis, real CRS
scope, `id` scoping across referenced documents, the pixel-centre convention on
non-image grids, and whether `arrayCoordinateSystem` may be a name reference.

Worth putting to OME directly: RFC 8's extension points plus `collection` nesting
turn out to be **almost** enough to fill the geometry gap RFC 5 declares out of
scope. The only two things missing are a coordinate-system-free array node and a
place to hang free-standing transformation edges — both small, and both better
proposed as `ome:` extensions than left for every vector format to reinvent.

## Verification performed

| Check | Result |
|---|---|
| `sphinx-build -W` (warnings as errors) | **build succeeded** |
| JSON examples parse | 10/10 |
| RFC 8 legality — 25 nodes across 9 documents | no violations (`version` on roots only; every node named; names unique per collection; `nodes` XOR `path`) |
| Prefix discipline | clean — no unprefixed non-core identifiers |
| Key inventory | 39/39 (13 root + 13 level + 13 `zv_array`) each with an explicit verdict |

`-W` earned its place: it caught seven bad anchors, **one of which was a real
error** — §8.3 (Resolution-Level) and §8.4 (Array-Level) had been transposed.

To reproduce:

```bash
cd docs
python3 -m venv /tmp/zvdocs && /tmp/zvdocs/bin/pip install -r requirements.txt
/tmp/zvdocs/bin/sphinx-build -W -b html . /tmp/zv_build
```

## What is deliberately *not* done

- Chapters 01–15 are unchanged. The proposal lists which would change and how,
  but does not touch them.
- No JSON Schemas. The proposal specifies the per-node-type schema layout and how
  it maps onto the five existing conformance levels and the LinkML source of
  truth, as an appendix.
- No implementation changes. `zarr-vectors-py` still writes 0.9.0 metadata.
- No registry PR. The proposal's final appendix describes the directory contents
  so the shape can be agreed first.

## Suggested review order

1. **§1 and §5** of the proposal — the headline finding and the transform fix.
   These carry the argument.
2. **§9.2** — the dual-write recommendation that runs against the stated decision.
3. **§3.5** — the judgement calls, especially collapsing the five attribute
   discriminators into one kind plus `domain`.
4. **§10** — the nine inconsistencies, four of which are new.
5. **§12** — the ten questions for OME, if you have standing in that community.

## One housekeeping note

Two scratch files sit at the repo root and are probably not meant to be shared:
`can-you-investigate-neuroglancers-linked-clover.md` (an implementation plan) and
`endprompt.md` (a pasted chat reply). Worth removing or moving under
`docs/design_artifacts/` before this goes out.
