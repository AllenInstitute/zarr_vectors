# Proposal: Align Zarr Vectors with OME-Zarr RFC 8

:::{note}
**Status:** proposal, not normative.  Targets `zv_version` 0.10.0 (additive)
and 1.0.0 (structural).  Chapters [01](../01-introduction.md)–[15](../15-appendices.md)
remain normative for 0.9.0 and are unchanged by this document.
:::

## 1. Summary

Zarr Vectors already borrows from OME-Zarr, but through a seam that has drifted
in three ways:

1. It writes a **bare-root `multiscales` block at NGFF `version "0.4"`**,
   deliberately not the `attributes.ome` nesting
   ([§8.8](../08-metadata.md#88-coordinate-reference-system-crs)).
2. It has **no node type.**  The format discriminator is stamped at
   `multiscales[0]["metadata"]["format"] = "zarr_vectors"`, which §8.8 itself
   describes as a workaround for NGFF reserving `type` for the downsampling
   method.
3. Most seriously, **`coordinateTransformations` is semantically repurposed**
   ([§9.3](../09-multi-resolution-support.md#93-spatial-chunk-scaling)) to carry
   bin geometry: `scale = bin_shape / base_bin_shape`,
   `translation = bin_shape / 2`.  Vertices are already stored in world
   coordinates, so this is not the level's physical scale.  §9.3 notes the
   hazard in passing — "any NGFF viewer would render it."

**OME-Zarr RFC 8** supplies precisely the mechanism the format has been
approximating: a common **Node** interface (`type`, `id`, `name`, `attributes`,
root-only `version`), a `collection` node type, `Path` and `Reference` objects
for cross-document linking, and a `prefix:name` rule that lets a third party
extend NGFF without going through the RFC process.  **RFC 5** supplies
`coordinateSystems`, an axis type `coordinate`, and a `coordinates` lookup-table
transformation.

The central finding of this proposal:

> **RFC 5 already built the `coordinate` axis type and the `coordinates`
> transformation, and then declined to say what they were for.**  RFC 5 states
> that geometry primitives, points and annotation coordinate binding are out of
> scope — yet a `coordinates` transformation is defined as a lookup that reads a
> coordinate vector at an input location, backed by an array of shape
> `[d1..dN, M]` with one axis of `type: "coordinate"` of length `M`.  That is a
> vertex table.  The geometry gap in NGFF is smaller than it appears, and Zarr
> Vectors is unusually well placed to close it because its geometry already
> lives *in* Zarr arrays rather than beside them.

### 1.1 The motivating example

What alignment buys, concretely, and what cannot be expressed today: **one
collection holding an OME-Zarr image pyramid and a Zarr Vectors skeleton store,
co-registered through a shared `world` coordinate system.**

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

A viewer resolves three stores, discovers that all three declare space axes in
micrometres, and can place them in one scene.  Today each of these is an
independent store with no standard way to say they belong together or share a
frame.

## 2. Namespace and prefix

**Recommendation: the prefix is `zv`.**

| Candidate | Verdict | Reasoning |
|---|---|---|
| **`zv`** | **chosen** | Continuous with the already-frozen on-disk spellings `zv_version`, `zv_array`, `.zv`, so the migration reads as a punctuation change rather than a new vocabulary.  Short, which matters when the prefix appears in every `zarr.json` in a store that may hold tens of thousands of them. |
| `aibs` / `alleninstitute` | rejected | RFC 8 says the prefix "identifies the user or organization that introduces and maintains the extension", which argues for it.  But institutional prefixes encourage forking-by-institution and would need renaming the first time a second institution co-maintains the spec.  Institutional identity belongs in the registry entry's maintainer list, not in every store. |
| `ome` | unavailable | RFC 8 reserves `ome:` for official extensions not yet in core.  Self-assigning it would be a spec violation. |

The tradeoff is recorded rather than hidden: `zv` names the *format project*, not
the organisation, which is a mild departure from RFC 8's stated intent.  If the
registry objects to two-letter prefixes as collision-prone, fall back to `zvec`,
not the long form.

**Forward path.**  State now, in the spec, that if Zarr Vectors is ever adopted
through the OME RFC process the prefix migrates `zv:` → `ome:vectors:` →
unprefixed, and that **each step is a major `zv_version` bump with no shim**,
consistent with the policy in
[Appendix J](../15-appendices.md#appendix-j-change-log).  Saying so up front is
what makes `zv:` safe to adopt today.

### 2.1 What gets registered where

| Registry | Entry |
|---|---|
| OME extension registry (GitHub, `ome` org) | The prefix `zv`: authority, contact, spec URL, the list of `zv:` node types, the `zv:` `CoordinateTransformation.type` values, the `zv:` attribute keys, and the versioning policy above. |
| `zarr-developers/zarr-extensions`, `attributes/zarr_vectors/` | A **tombstone** README: "this top-level attribute key was used by Zarr Vectors ≤ 0.9; from 1.0.0 all Zarr Vectors metadata lives under the `ome` attribute key per OME-Zarr RFC 8."  Worth filing precisely because 0.9 stores exist and the key needs a discoverable meaning. |
| `zarr-extensions/codecs/`, `data-types/` | **Nothing.**  Zarr Vectors registers no codec and no data type ([§11.4](../11-compression-and-encoding.md)).  Draco stays *inside* the vlen-bytes payload, described by `zv:vertices.encoding`.  Promoting it to a Zarr codec would change the array's logical dtype from bytes to `[N,3] float32` — a much larger redesign, and out of scope here. |

Note a real simplification: after this change Zarr Vectors writes **only** under
the `ome` attribute key, so it inherits OME's own attribute registration and
stops needing one of its own.

## 3. Node types

### 3.1 The governing rule

Proposed as normative:

> **`type` answers "what IS this node."  `attributes` carry parameters of a node
> whose kind is already known.**  Mint a node type when (a) a reader must
> dispatch on it to decode a byte correctly, or (b) the node has a payload
> contract that can be validated in isolation.  Do not mint a type for a fact
> that is a *reference* or a *parameter*.

RFC 8's own specialisations — `labels`, `plate`, `well`, `acquisition`, `scene` —
are **attributes on collections, not node types**, and that precedent is followed
here wherever a node really is just a container.

The current spec errs in both directions, which is worth naming because the fix
is not simply "add types":

- It **underclassifies structure.**  Seven container groups carry no
  discriminator at all — `vertex_attributes/`, `fragment_attributes/`,
  `object_attributes/`, `group_attributes/`, `links/`, `link_attributes/`,
  `link_attributes/<name>/` — and so does `object_index/manifests`, which is an
  array with no `zv_array` value despite
  [§13.1](../13-conformance-and-validation.md#131-conformance-levels) requiring
  every node to have a recognised one.
- It **overclassifies parameters.**  Five of the thirteen `zv_array` values
  (`attribute`, `link_attribute`, `object_attribute`, `fragment_attribute`,
  `groupings_attribute`) differ only in *which axis the column indexes*.

### 3.2 The table

`G` = Zarr group, `A` = Zarr array, `V` = inline/virtual node declared in a
parent's `nodes[]` with no `zarr.json` of its own.

| `type` | Node | Represents | Required (beyond the common Node fields) |
|---|---|---|---|
| `collection` *(native)* | G, store root | the store | `version`, `nodes`, `attributes["zv:vectors"]`, `attributes.scene` |
| `collection` *(native)* | G, `<N>/` | a resolution level | `nodes`, `attributes["zv:level"]` |
| `collection` *(native)* | G, `links/<delta>/` | a link family | `nodes`, `attributes["zv:linkFamily"]` |
| `collection` *(native)* | G, `object_index/` | the object ID space | `nodes`, `attributes["zv:objectIndex"]` |
| `collection` *(native)* | G, the 7 container groups above | pure containers | `nodes` |
| `collection` *(native)* | G or standalone JSON | multi-store aggregate | `nodes` with `path` refs, `attributes["zv:aggregate"]` |
| `singlescale` *(native)* | A, every per-spatial-chunk array | one array over the chunk grid | `attributes.coordinateTransformations`, `attributes["zv:array"]` |
| **`zv:table`** | A, `object_index/manifests`, `groups`, `object_attributes/<n>`, `group_attributes/<n>` | an array with **no** coordinate system | `attributes["zv:array"]` |
| **`zv:points`** | V | point-cloud geometry | `vertices` (Reference) |
| **`zv:polylines`** | V | streamline / polyline / line | `vertices`, `chains{convention, continuations[]}` |
| **`zv:tree`** | V | skeleton | `vertices`, `edges{convention, families[]}` |
| **`zv:graph`** | V | general graph | `vertices`, `edges{families[]}` |
| **`zv:mesh`** | V | mesh | `vertices`, `cells{cellType, families[]}` |
| **`zv:shapes`** | V or G | parametric objects | `shapeTypes[]`, `coefficients` (Reference) |

Seven new type strings.  Everything structural reuses `collection` or
`singlescale`.

### 3.3 Why `zv:table` must exist

All three RFC 8 node types presuppose a coordinate system: `multiscale`
*requires* `coordinateSystems`; `singlescale` *MUST* have
`coordinateTransformations` restricted to `scale` or
`sequence(scale, translation)`; `collection` holds nodes, not array data.

But `object_index/manifests` is a `(num_objects,)` array indexed by a dense
object ID, and `groups` is `(G,)` indexed by group ID.  **An object ID has no
position** — the object's fragments do.  Three options:

1. Declare them `singlescale` with `"scale": [1.0]`.  Legal by the letter, but it
   asserts a coordinate system for an index space that has none, and then either
   violates RFC 5's connected-graph rule or forces a fake edge to `world`.
2. Give them no `attributes.ome`.  Then they cannot appear in their parent's
   `nodes`, and the node tree has holes exactly where the store's tables are.
3. Mint `zv:table`: an array node with no coordinate systems and no
   transformations.

Option 3, and the supporting evidence is strong: **SpatialData reached the same
conclusion from the opposite direction**, forbidding coordinate systems on tables
outright.  Two independent designs hitting the same wall is good evidence that
OME-Zarr's core vocabulary is missing an "array without geometry" node.  See
[Q3](#12-open-questions-for-the-ome-community).

One genuine exception, worth using: when a store carries
`object_attributes/centroid` of shape `(B, sid_ndim)`, the object-ID space *is*
connectable to `world` — by RFC 5's native `coordinates` transformation, whose
`path` points at an array of shape `[d1..dN, M]`.  That is exactly a centroid
array.  So: *a store carrying a per-object coordinate summary MAY declare an
`objects` coordinate system and connect it with a native `coordinates`
transformation; `zv:table` nodes never declare one themselves.*

### 3.4 Deliberately not node types

| Entity | Modelled as | Why |
|---|---|---|
| **The store** | `zv:vectors` attribute on a `collection` | The `plate` precedent exactly: `plate` is not a node type, it is an attribute telling you how to read a collection's children.  This also *retires* the workaround §8.8 apologises for — the discriminator no longer competes with NGFF's `type`. |
| **Resolution level** | `zv:level` attribute on a `collection` | The `well` precedent.  A named container of nodes with per-container metadata is the definition of a collection. |
| **Link family** | `zv:linkFamily` attribute on a `collection` | `acquisition` is the precedent for shared policy over sibling nodes.  `linkWidth` / `directed` / `store` govern every array beneath and are deliberately not repeated per array. |
| **Object index** | `zv:objectIndex` attribute on a `collection` | It is a group holding one array ([§5.1](../05-zarr-store-structure.md)). |
| **Attribute families** | plain `collection` | The `labels` precedent verbatim: `labels` is an attribute on a collection whose children are the label images.  `vertex_attributes/` is `labels` for vertices. |
| **Fragment, bin, cell, spatial chunk** | not nodes | Indices into a payload, below the granularity of a Zarr node.  A fragment is sixteen bytes of a blob.  They stay as byte layouts plus coordinate systems (§5). |
| **Vertex, link, object, group** | not nodes | Rows, not nodes. |

### 3.5 Judgement calls, stated as such

- **The five attribute discriminators collapse to one `zv:array.kind` plus a
  required `domain` field** (`vertex | fragment | link | object | group`) and a
  required `alignedTo` Reference.  They differ only in which axis the column
  indexes, and `alignedTo` states that explicitly and machine-checkably.  Three
  or five separate types would encode one fact twice — once in the type name,
  once in the reference — which is the redundancy RFC 8 warns desyncs.  `domain`
  stays required so a tree walk still gets a one-glance answer without
  dereferencing.  **This is the decision most likely to be argued.**
- **`vertex_fragments` and `link_fragments` collapse** to one `kind:
  "fragmentIndex"` with an `of` Reference.  Same blob format, same grid,
  different partitioned target.
- **Six geometry types rather than one `zv:geometry` with a `topology` field.**
  Six give six independently validatable schemas, which is the point; a single
  type would make one schema the union of six incompatible shapes (`zv:mesh`
  requires `cellType`, `zv:polylines` requires `chains.convention`, `zv:points`
  forbids both).  The cost: `line` and `polyline` from the current
  `geometry_types` enum collapse into `zv:polylines`, and `streamline` becomes
  `zv:polylines` plus a provenance hint.  That is a **correction** — streamline
  vs polyline is a provenance distinction, not a topological one.
- **`zv:objectIndex` as a collection-with-attribute rather than its own type** is
  thin: its only child now carries the same `layout`.  It is kept as a
  `collection` because the *object axis* has to be declared at some scope and the
  group is the right one.

## 4. Concept mapping

### 4.1 Root `zarr_vectors` keys ([§8.2](../08-metadata.md#82-root-level-metadata))

| 0.9 key | Disposition | New home |
|---|---|---|
| `zv_version` | prefixed | `zv:vectors.specVersion`.  Distinct from RFC 8 `version`, which is the *NGFF* version — two versions, both required, different names. |
| `chunk_shape` | **native reuse** | The `scale` of the level-0 `chunkGrid → world` transformation. |
| `bounds` | prefixed | `zv:vectors.bounds` = `{coordinateSystem, min, max}`.  RFC 5 has no extent concept ([Q5](#12-open-questions-for-the-ome-community)).  Naming the coordinate system is new and necessary — today it is implicitly world with nothing saying so. |
| `geometry_types` | **dropped as derivable** | = the set of geometry node types present, now per level and per geometry rather than one flat store-wide list. |
| `crs` | native + escape hatch | Axes and units are RFC 5 native; a real EPSG/WKT CRS has no RFC 5 slot, so `zv:vectors.crs` survives as an opaque pass-through ([Q7](#12-open-questions-for-the-ome-community)). |
| `links_convention` | **moved to the geometry node** | `zv:tree.edges.convention`, `zv:polylines.chains.convention`.  Never a store-wide fact. |
| `object_index_convention` | **dropped as derivable** | `"identity"` ≡ no `object_index/` node present. |
| `cross_chunk_strategy` | **moved to the geometry node** | `zv:*.crossChunk`. |
| `reduction_factor` | demoted to advisory | `zv:vectors.attributes["zv:pyramidHint"]`.  A writer policy, derivable from per-level `vertexCount` ratios; no reader decision depends on it. |
| `base_bin_shape` | **native reuse** | The `scale` of the level-0 `binGrid → world` transformation.  "Unset ⇒ one bin per chunk" becomes "no `binGrid` declared ⇒ one bin per chunk". |
| `cross_level_depth` | **dropped as derivable** | = `max |levelDelta|` over the link families present. |
| `cross_level_storage` | **dropped as derivable** | `"none"` ≡ no family with `levelDelta ≠ 0`; `implicit`/`explicit` collapse to whether the arrays are there. |
| `format_capabilities` | **dropped entirely** | `fragment_index` was mandatory (no information).  `shared_fragments` → `zv:array.sharing`.  `preserved_object_ids` → `zv:objectIndex.oidSpace`.  `multiscale_links` → derivable.  **This is a significant legibility gain**: an open token list that a reader "must either treat as absent or refuse to open" ([§8.2](../08-metadata.md#82-root-level-metadata)) is a coin flip, whereas an unrecognised prefixed node type has RFC-8-defined behaviour. |
| *(derived)* `sid_ndim` | **native** | `len(coordinateSystems["<N>/chunkGrid"].axes)`.  Stops being "count axes of type space", which was always a lossy proxy — see inconsistency 5. |
| `multiscales[0].metadata.format` | **dropped** | Replaced by `zv:vectors` on the root collection.  The single biggest win. |

Root keys: 13 → 4 substantive, plus two advisory attributes.

### 4.2 Level `zarr_vectors_level` keys ([§8.3](../08-metadata.md#83-resolution-level-metadata))

| 0.9 key | Disposition | New home |
|---|---|---|
| `level` | dropped as derivable | RFC 8 `name` and position in the parent's `nodes[]`.  Keep as `zv:level.index` **only** because level groups are opened standalone ([§9.1](../09-multi-resolution-support.md)); precedence: the root's `nodes` order is normative and disagreement is a validation error. |
| `vertex_count` | prefixed | `zv:level.vertexCount`.  Not cheaply derivable. |
| `arrays_present` | **dropped, replaced by native** | RFC 8 `nodes` *is* this list, and a better one — it names paths and types, not just family names. |
| `fragments_tile` | **moved** | `zv:array.tiles` on the `vertex_fragments` array.  It is a claim about that index, not the level, and this also fixes invalidation: the flag now lives on the array whose writes clear it. |
| `chunk_shape` (override) | **native reuse** | This level's `chunkGrid → world` `scale`.  The "positive integer multiple of root" rule becomes a relation between two declared scales. |
| `object_sparsity`, `coarsening_method` | prefixed | `zv:level.coarsening.{objectSparsity, method}`. |
| `parent_level` | **native Reference** | `zv:level.parent` = `{"id": "level-0"}`.  Resolvable and validatable, not a bare int. |
| `chunk_dims` | **dropped, native** | The `axes[].name` list of that level's `chunkGrid`, in chunk-key order. |
| `chunk_attribute_name` | native + prefixed | A non-space axis on `chunkGrid` whose `name` is the attribute name, with `attributes["zv:fromVertexAttribute"]` naming the source column. |
| `chunk_attribute_values` | native + prefixed | `attributes["zv:categories"]` on that axis.  Both become properties of the axis they describe, and the axis gets `discrete: true` for free ([Q6](#12-open-questions-for-the-ome-community)). |
| `preserves_object_ids` | **moved** | `zv:objectIndex.oidSpace.inheritedFrom` (a Reference); presence ≡ the old boolean. |
| `inherited_num_objects` | **moved** | `zv:objectIndex.oidSpace.size`. |
| `shared_fragments` | **moved** | `zv:array.sharing = "multiOwner"` on the fragment index. |
| `bin_shape` *(forbidden but written)* | **native reuse** | This level's `binGrid → world` `scale`.  **Inconsistency 1 dissolves**: the field exists nowhere, so it cannot be written into a slot the docs forbid. |
| `bin_ratio` *(forbidden but written)* | **dropped as derivable** | Level `binGrid` scale ÷ level-0 `binGrid` scale. |

Level keys: 14 (+2 written illegally) → 5.

### 4.3 All 13 `zv_array` values ([§8.4](../08-metadata.md#84-array-level-metadata))

| 0.9 `zv_array` | Node `type` | `zv:array.kind` | Notes |
|---|---|---|---|
| `vertices` | `singlescale` | `vertices` | `dtype` → `rowDataType` (a legitimate duplicate: the Zarr data type is `bytes`, the *row* dtype is not recoverable).  `sid_ndim` → `rowWidth`.  `chunk_grid_origin` absorbed into the chunk-grid `translation`, so the "stored only when non-zero" special case vanishes. |
| `vertex_fragments` | `singlescale` | `fragmentIndex` + `of` → `vertices` | |
| `link_fragments` | `singlescale` | `fragmentIndex` + `of` → `links/0/<all-zero>` | Merged with the above; `of` carries the difference.  "No other array may have a `link_fragments` cell" becomes "at most one fragment index per `of` target". |
| `links_family` | `collection` | — (`zv:linkFamily`) | `sid_ndim` **dropped** (= rank of the chunk grid). |
| `links` | `singlescale` | `links` | `offsets` becomes structured (`[[0,0,1]]`) instead of re-parsed from the `0.0.+1_0.+1.0` path name.  The path name stays — it is the addressing scheme — but validation no longer requires string parsing.  `linkWidth` / `levelDelta` **dropped**: inherited from the family, which MUST NOT be restated. |
| `attribute` | `singlescale` | `chunkedAttribute` `domain:"vertex"` | **Renamed.**  A bare `"attribute"` is uninformative once every kind is in one enum. |
| `link_attribute_family` | `collection` | — | Type **dropped**.  It carried only `name` (→ RFC 8 `name`), `level_delta` (inherited) and `num_links` (must equal the mirrored family — pure redundancy).  Gains `attributes["zv:mirrors"]`, a Reference to `links/<delta>/`.  A node type carrying no unique information does not deserve one. |
| `link_attribute` | `singlescale` | `chunkedAttribute` `domain:"link"` | `offsets`, `levelDelta`, `linkWidth` dropped — derived from `alignedTo`. |
| `object_index` | `collection` | — (`zv:objectIndex`) | `sid_ndim` dropped.  Declares the `objects` discrete axis. |
| *(none today)* | **`zv:table`** | `objectManifests` | **A new 14th value, fixing a real hole.**  `manifests` carries no discriminator today (attrs sit on the group, [§7.6](../07-core-arrays.md)), contradicting §13.1's rule that every node has a recognised one.  RFC 8 fixes it by construction: every node needs `type` and `name`. |
| `object_attribute` | `zv:table` | `denseAttribute` `domain:"object"` | `shape` dropped — Zarr `shape` is authoritative for dense arrays; the duplicate existed only because vlen arrays need it. |
| `fragment_attribute` | `singlescale` | `chunkedAttribute` `domain:"fragment"` | `alignedTo` → `vertex_fragments`. |
| `groups` | `zv:table` | `objectSets` | **Rename the concept.**  `groups` collides catastrophically with "Zarr group" in a design where every node is a group or an array — the spec already has to write "the array group named `groups`".  Path `groups` → `object_sets`, `group_attributes/` → `object_sets_attributes/`.  Also fixes inconsistency 8. |
| `groupings_attribute` | `zv:table` | `denseAttribute` `domain:"objectSet"` | The normative-but-wrong spelling ([§8.4](../08-metadata.md#84-array-level-metadata)) is deleted rather than migrated. |
| `shard_shape` | **dropped as derivable** | | Already visible in the Zarr v3 `codecs` pipeline as `sharding_indexed`, and Zarr's copy is authoritative. |
| `parametric_objects` / `parametric_names` | `zv:table` | `shapeCoefficients` / `shapeNames` | Undocumented today; see inconsistency 4. |

13 discriminators → 9 kinds, with 7 previously untyped container groups and one
untyped array gaining types.

## 5. Fixing the coordinateTransformations overload

### 5.1 Diagnosis

Current state ([§9.3](../09-multi-resolution-support.md#93-spatial-chunk-scaling)):

```text
write:   scale       = bin_shape / base_bin_shape
         translation = bin_shape / 2
read:    bin_ratio   = scale
         bin_shape   = 2 x translation
```

emitted as a bare `[{"type":"scale",...},{"type":"translation",...}]` list with
**no `input` and no `output`**.  The two halves fail differently:

- **`scale` is not a coordinate transformation at all.**  It is a dimensionless
  coarsening ratio between two *index* spaces.  Vertices at every level are
  already in world coordinates, so a Zarr Vectors level's data→world map is the
  **identity**.  Writing a non-identity `scale` into a
  `multiscales[].datasets[].coordinateTransformations` slot tells every NGFF
  reader "multiply this level's data by 2 to get world coordinates", which is
  false, and would silently double-scale any viewer that honoured it.  §9.3
  argues *for* the overload on the grounds that "any NGFF viewer would render
  it" — but what it renders is wrong.  The quantity is also derivable (a ratio of
  two bin shapes), so it needs no storage anywhere.
- **`translation = bin_shape / 2` is a real transformation in the wrong slot.**  A
  half-bin offset is exactly what relates a discrete bin-*index* space to world
  under RFC 5's "the pixel/voxel center is the origin of the continuous
  coordinate system" convention.  The *fact* is right and load-bearing; it was
  attached to the level's data instead of to the bin grid.

**The fix is not a new mechanism — it is RFC 5's `input`/`output` naming.**  Once
every transformation must declare which coordinate system it starts from and
which it lands in, the 0.9 encoding becomes unwriteable: there is no pair of
declared systems for which those two compose into one map.  That is also why §9.3
has to warn that "the two halves of one transform must agree" and derive one from
the other to keep them honest — the constraint was doing the work that
`input`/`output` does natively.

### 5.2 The coordinate systems

| Coordinate system | Axes | Transformation to `world` | Genuinely a transform? |
|---|---|---|---|
| `world` | today's `multiscales[0].axes`, UDUNITS-2 units, NGFF order | — (the hub) | — |
| `<N>/chunkGrid` | one `type:"array"`, `discrete:true` axis per chunk-key axis | `sequence[ mapAxis, translation([o+0.5]), scale([chunk_shape]) ]` | **Yes** — and it was never written. |
| `<N>/binGrid` | ditto | `sequence[ mapAxis, translation([0.5,…]), scale([bin_shape]) ]` | **Yes** — was written, into the wrong slot. |
| `<N>/vertexTable` | `[{name:"vertex", type:"array", discrete:true}, {name:"component", type:"coordinate"}]` | `zv:chunkedCoordinates` → `<N>/vertexSpace` → `world` | **Yes**, but not expressible in core RFC 5 (§5.4). |
| `<N>/objects`, `<N>/objectSets` | one discrete axis | none, unless a centroid array exists (§3.3) | **No** — index spaces. |

Three points worth drawing out.

**The `component` axis is a textbook RFC 5 `coordinate` axis.**  RFC 5 requires
exactly such an axis for its `coordinates` transformation.  A Zarr Vectors
`vertices` array is a `coordinates` source — which is the alignment finding in
§1.

**`chunk_shape` and `bin_shape` appear literally as `scale`s, with units at
last**, and `chunk_grid_origin` is absorbed into the `translation`.  The `+0.5` is
RFC 5's centre convention applied to the chunk as the cell: cell `c` spans world
`[(c+o)·cs, (c+o+1)·cs)`, centre at `(c+o+0.5)·cs`.

**Chunk *corners* must be derived explicitly.**  Zarr Vectors addresses chunks
with `floor(position / chunk_shape)` ([§6.2](../06-spatial-indexing.md#62-spatial-chunk-addressing)),
which is corner-based, while RFC 5 is centre-based.  `corner = centre −
chunk_shape/2`.  This must be stated normatively, because a half-chunk
disagreement between an RFC 5 reader and a Zarr Vectors reader is a silent,
plausible-looking error — exactly the failure class this spec is written to avoid
([Q9](#12-open-questions-for-the-ome-community)).

**`mapAxis` carries the permutation** between chunk-key order and NGFF world-axis
order.  This one native transformation type resolves inconsistencies 2 and 5
without reordering anything on disk.

### 5.3 The graph stays connected

```text
                             ┌──── mapAxis ────┐
  /0/vertexTable ──zv:chunkedCoordinates──▶ /0/vertexSpace ──identity──▶ world
  /0/chunkGrid   ──sequence(mapAxis, translation, scale)────────────────▶ world
  /0/binGrid     ──sequence(mapAxis, translation, scale)────────────────▶ world
  /1/chunkGrid   ──sequence(…)──────────────────────────────────────────▶ world
  /1/binGrid     ──sequence(…)──────────────────────────────────────────▶ world
```

`world` is the hub; every spatial system reaches it in one hop; `scale` and
`translation` are analytically invertible, so the graph is traversable in both
directions.

Two consequences to state normatively:

1. **Per-chunk arrays do not restate the geometry.**  RFC 8 requires a
   `singlescale` node to *have* `coordinateTransformations`, so each per-chunk
   array carries the minimal honest one —
   `{"type":"scale", "scale":[1,1,1], "input":"<self>", "output":"<N>/chunkGrid"}`,
   meaning "my indices *are* chunk-grid indices".  Chunk shape and origin exist
   in exactly one place, honouring the no-two-copies rule of
   [§8.3](../08-metadata.md#83-resolution-level-metadata) ([Q10](#12-open-questions-for-the-ome-community)).
2. **The `<N>/vertexSpace` hop is not redundant.**
   [§7.1](../07-core-arrays.md#71-vertex-positions) permits integer vertex dtypes for
   voxel-indexed positions, Draco-quantized stores and fixed-precision data — for
   which the stored numbers are **not** world coordinates, and 0.9 has nowhere to
   say so.  The hop is `identity` in the common float case and a real
   `sequence(scale, translation)` in the quantized case.  This is new capability,
   not ceremony.

### 5.4 Where RFC 5 is genuinely insufficient

**RFC 5's `coordinates` assumes a plain dense `[d1..dN, M]` numeric array.**  A
Zarr Vectors `vertices` array is a vlen-bytes array over the chunk grid whose
cells hold `N_k × sid_ndim` rows, optionally Draco-encoded.  Semantically
identical; physically not readable by an RFC-5-literal implementation.  Interim
solution — legal today, because RFC 8 names
`CoordinateTransformation.type` as an extension point:

```json
{"type": "zv:chunkedCoordinates",
 "input": "/0/vertexTable", "output": "/0/vertexSpace",
 "path": "vertices", "coordinateAxis": "component",
 "fragmentIndex": "vertex_fragments",
 "order": "chunkRasterMajor"}
```

The `vertex` axis is the **global** vertex index over the level (length =
`vertexCount`), with enumeration order fixed by `order` — raster order over
nonempty chunks, then row order within each cell.  Making it global rather than
per-cell is what lets `vertex_attributes/<name>` be described as a column over
the same axis, so the whole level becomes table-like and legible.

The ask ([Q4](#12-open-questions-for-the-ome-community)): `coordinates` should
accept an optional encoding indirection, so ragged, chunked, Draco- and
parquet-backed coordinate sources can all *be* `coordinates`.  Without it, RFC
5's `coordinates` transformation is unusable by every real point-cloud store —
which is probably why nobody has used it.

## 6. Geometry as first-class nodes

### 6.1 The structural insight

RFC 8's `nodes[]` accepts **Node objects inline**, not only References, and an
inline node needs no Zarr group.  That is the whole design: a geometry node is a
**declarative view** naming its vertex source, connectivity sources and
attribute columns by Reference.  Geometry becomes first-class and machine-readable
**without changing the on-disk layout at all.**

### 6.2 Topology and the `link_width` mapping

| Node | `linkWidth` | Semantics | Required |
|---|---|---|---|
| `zv:points` | — | none | `vertices` |
| `zv:polylines` | 2, `directed: true` | chains; `convention: "implicit_sequential"` means row *i* → *i+1* within a fragment, and the width-2 families hold only cross-chunk continuations | `vertices`, `chains{convention, continuations[]}` |
| `zv:tree` | 2 `directed: true`, or 1 at `levelDelta ≠ 0` | parent→child edges; `convention ∈ {explicit, implicit_sequential_with_branches}` | `vertices`, `edges{convention, families[]}` |
| `zv:graph` | 2 | arbitrary edges | `vertices`, `edges{families[]}` |
| `zv:mesh` | 3 or 4 | simplices; `cellType ∈ {triangle, quad, tetrahedron, polygon}` | `vertices`, `cells{cellType, families[]}` |
| `zv:shapes` | — | algebraic, no vertices | `shapeTypes[]`, `coefficients` |

Two **real bugs** in the current model get fixed, not merely tidied.

**`link_width` alone is ambiguous.**
[§12.2](../12-geometry-types.md#122-meshes) lists both quad and tetrahedral
meshes under `link_width = 4` and has no way to tell them apart.  `cellType`
resolves it, and the check becomes bidirectional and mechanical: `triangle ⇒
linkWidth == 3`; `quad | tetrahedron ⇒ linkWidth == 4`.

**`link_width: 1` is a documented trap.**
[§12.3](../12-geometry-types.md#123-skeletons) spends a paragraph warning writers
off it because it cannot name a second chunk.  As a node type that becomes a
*schema* rule: `zv:tree.edges.families[]` MUST reference families with
`linkWidth == 2` when `levelDelta == 0`; `linkWidth == 1` is permitted only at
`levelDelta ≠ 0`.  Prose warning → machine check.

### 6.3 Attribute attachment

```text
zv:tree
  vertices          → Reference(/0/vertices)
  fragments         → Reference(/0/vertex_fragments)
  vertexAttributes  → [Reference(/0/vertex_attributes/radius),
                       Reference(/0/vertex_attributes/vertex_type)]
  edges.families    → [Reference(/0/links/0)]
  edgeAttributes    → [Reference(/0/link_attributes/weight/0)]
  objects           → Reference(/0/object_index)
  objectAttributes  → [Reference(/0/object_attributes/name)]
  objectSets        → Reference(/0/object_sets)
```

Each referenced array independently declares its own `domain` and `alignedTo`, so
the binding is stated from two directions and is cross-checkable.  That is the
*good* kind of redundancy — a validator catches disagreement.  RFC 8's warning is
about redundancy no validator inspects.

The four attribute domains land on four declared discrete axes, so "which axis
does this column index" is answerable from JSON with no payload reads.  Today it
is answerable only by knowing the directory conventions.

### 6.4 `geometry_types` goes; mixing is legitimate

As a flat store-wide list, `geometry_types` cannot say *which* arrays are the
mesh and which the skeleton, cannot vary per level, and cannot carry the
per-geometry conventions that are currently — wrongly — store-wide root keys.  Its
only remaining function is to warn that conformance checks are relaxed
([Appendix H](../15-appendices.md#appendix-h-extensibility)), which an
unrecognised prefixed node type does better and with RFC-8-defined semantics.

**Mixing is real and already half-implemented**: `vertices_<geometry_type>` exists
in the reference implementation for composite stores, undocumented (inconsistency
6).  The canonical case — nuclei centroids plus cell-membrane meshes plus neurite
skeletons over one volume, sharing one chunk grid and one `world` — becomes three
inline geometry nodes in one level.

But mixing exposes **a genuine layout blocker worth naming now.**  The link path
is `links/<delta>/<offsets>/` and `linkWidth` lives on the `<delta>` group, so two
geometries at one level with different widths (mesh faces = 3, skeleton edges = 2)
**collide on `links/0/`**.  There is no way to express that today.

- **0.10.0:** permit mixing only when at most one link family exists per
  `levelDelta`.  Document the restriction as a layout limitation, not a design
  choice.
- **1.0.0:** insert a family segment — `links/<family>/<delta>/<offsets>/` — and
  promote each geometry to a real group, `<N>/<geometry>/{vertices,
  vertex_fragments, links/, …}`, retiring the `vertices_<geom>` name-suffix trick,
  which has nowhere to put per-geometry fragments, links or attributes.

## 7. Collections

### 7.1 Single store

```text
<store>.zarrvectors/            collection   + zv:vectors + scene   [root: carries version]
├── 0/                          collection   + zv:level
│   ├── (inline)                zv:points | zv:polylines | zv:tree | zv:graph | zv:mesh
│   ├── vertices/               singlescale  + zv:array{kind:"vertices"}
│   ├── vertex_fragments/       singlescale  + zv:array{kind:"fragmentIndex"}
│   ├── vertex_attributes/      collection
│   │   └── radius/             singlescale  + zv:array{kind:"chunkedAttribute", domain:"vertex"}
│   ├── links/                  collection
│   │   └── 0/                  collection   + zv:linkFamily
│   │       ├── 0.0.0/          singlescale  + zv:array{kind:"links"}
│   │       └── 0.0.+1/         singlescale  + zv:array{kind:"links"}
│   ├── object_index/           collection   + zv:objectIndex
│   │   └── manifests           zv:table     + zv:array{kind:"objectManifests"}
│   ├── object_attributes/      collection
│   │   └── centroid            zv:table     + zv:array{kind:"denseAttribute", domain:"object"}
│   └── object_sets             zv:table     + zv:array{kind:"objectSets"}
├── 1/ …                        collection   + zv:level
└── parametric/                 zv:shapes                            (level-free)
```

Three deliberate choices:

- **The root has `nodes`, never `path`**, and each child collection is referenced
  as `{"type":"collection","name":"0","id":"level-0","path":{"type":"zarr","path":"./0"}}`,
  so each group's metadata stays in its own `zarr.json` and the
  independent-per-level-read property of [§9.1](../09-multi-resolution-support.md)
  is preserved.
- **`world` is declared once**, in the native `scene` attribute on the root
  collection.  Per-level systems are declared on each level.
- **`zv:shapes` may hang directly off the root**, bypassing levels, because
  parametric objects are resolution-independent.  This finally gives the
  undocumented `parametric/` group a legitimate home: it is not an orphan, it is a
  level-free geometry.

### 7.2 Aggregation

A standalone JSON file with a top-level `ome` key, referencing stores by `Path`:

```json
{"ome": {
  "version": "0.5",
  "type": "collection",
  "id": "cohort",
  "name": "mouse_cortex_tracing_2026",
  "attributes": {"zv:aggregate": {"union": "disjointChunks",
                                  "coordinateSystem": "world"}},
  "nodes": [
    {"type": "collection", "name": "tile_000", "id": "tile-000",
     "path": {"type": "zarr", "path": "s3://bucket/tiles/000.zarrvectors"}},
    {"type": "collection", "name": "tile_001", "id": "tile-001",
     "path": {"type": "zarr", "path": "s3://bucket/tiles/001.zarrvectors"}}]}}
```

This is the right answer for the distributed-write case in
[§14.10](../14-examples.md): each worker writes an independent, valid store — no
shared `nonempty_chunks` contention, which is the stated pain point — and the
coordinator publishes a manifest instead of rewriting metadata.
`zv:aggregate.union ∈ {disjointChunks, overlapping, independent}` tells a reader
whether it may treat the union as one logical store.

Two problems to surface honestly:

- RFC 8 scopes `id` uniqueness "within the document".  Across a `path`-referenced
  aggregation there are many documents, so a cross-document Reference needs a
  stated scoping rule ([Q8](#12-open-questions-for-the-ome-community)).
- RFC 8 says non-root nodes MUST NOT differ in `version`.  Aggregating stores
  written at different OME-Zarr versions therefore has no legal encoding, since
  each referenced store is its own root.

## 8. JSON examples

Values follow [§14.1](../14-examples.md) — 3-D nuclei, `chunk_shape =
[200,200,200]`, `base_bin_shape = [50,50,50]`, `bounds = [[0,0,0],
[1000,1000,1000]]`.

### 8.1 Store root — `<store>/zarr.json`

```json
{
  "zarr_format": 3,
  "node_type": "group",
  "attributes": {
    "ome": {
      "version": "0.5",
      "type": "collection",
      "id": "mouse-brain-nuclei",
      "name": "mouse_brain_nuclei",
      "attributes": {
        "scene": {
          "coordinateSystems": [
            {
              "name": "world",
              "axes": [
                { "name": "z", "type": "space", "unit": "micrometer" },
                { "name": "y", "type": "space", "unit": "micrometer" },
                { "name": "x", "type": "space", "unit": "micrometer" }
              ]
            }
          ]
        },
        "zv:vectors": {
          "specVersion": "0.10.0",
          "bounds": {
            "coordinateSystem": "world",
            "min": [0.0, 0.0, 0.0],
            "max": [1000.0, 1000.0, 1000.0]
          }
        },
        "zv:pyramidHint": { "reductionFactor": 8 }
      },
      "nodes": [
        {
          "type": "collection",
          "id": "level-0",
          "name": "0",
          "path": { "type": "zarr", "path": "./0" }
        },
        {
          "type": "collection",
          "id": "level-1",
          "name": "1",
          "path": { "type": "zarr", "path": "./1" }
        }
      ]
    }
  }
}
```

### 8.2 Level group — `<store>/0/zarr.json`

```json
{
  "zarr_format": 3,
  "node_type": "group",
  "attributes": {
    "ome": {
      "type": "collection",
      "id": "level-0",
      "name": "0",
      "attributes": {
        "zv:level": {
          "index": 0,
          "vertexCount": 812443,
          "coarsening": { "method": "none", "objectSparsity": 1.0 }
        },
        "scene": {
          "coordinateSystems": [
            {
              "name": "/0/chunkGrid",
              "axes": [
                { "name": "ci", "type": "array", "discrete": true },
                { "name": "cj", "type": "array", "discrete": true },
                { "name": "ck", "type": "array", "discrete": true }
              ]
            },
            {
              "name": "/0/binGrid",
              "axes": [
                { "name": "bi", "type": "array", "discrete": true },
                { "name": "bj", "type": "array", "discrete": true },
                { "name": "bk", "type": "array", "discrete": true }
              ]
            },
            {
              "name": "/0/vertexTable",
              "axes": [
                { "name": "vertex", "type": "array", "discrete": true },
                { "name": "component", "type": "coordinate" }
              ]
            },
            {
              "name": "/0/vertexSpace",
              "axes": [
                { "name": "z", "type": "space", "unit": "micrometer" },
                { "name": "y", "type": "space", "unit": "micrometer" },
                { "name": "x", "type": "space", "unit": "micrometer" }
              ]
            },
            {
              "name": "/0/objects",
              "axes": [{ "name": "object", "type": "array", "discrete": true }]
            }
          ],
          "coordinateTransformations": [
            {
              "name": "chunkGrid-to-world",
              "type": "sequence",
              "input": "/0/chunkGrid",
              "output": "world",
              "transformations": [
                { "type": "mapAxis", "mapAxis": { "z": "ck", "y": "cj", "x": "ci" } },
                { "type": "translation", "translation": [0.5, 0.5, 0.5] },
                { "type": "scale", "scale": [200.0, 200.0, 200.0] }
              ]
            },
            {
              "name": "binGrid-to-world",
              "type": "sequence",
              "input": "/0/binGrid",
              "output": "world",
              "transformations": [
                { "type": "mapAxis", "mapAxis": { "z": "bk", "y": "bj", "x": "bi" } },
                { "type": "translation", "translation": [0.5, 0.5, 0.5] },
                { "type": "scale", "scale": [50.0, 50.0, 50.0] }
              ]
            },
            {
              "name": "vertexTable-to-vertexSpace",
              "type": "zv:chunkedCoordinates",
              "input": "/0/vertexTable",
              "output": "/0/vertexSpace",
              "path": "vertices",
              "fragmentIndex": "vertex_fragments",
              "coordinateAxis": "component",
              "order": "chunkRasterMajor"
            },
            {
              "name": "vertexSpace-to-world",
              "type": "identity",
              "input": "/0/vertexSpace",
              "output": "world"
            }
          ]
        }
      },
      "nodes": [
        {
          "type": "zv:points",
          "id": "nuclei",
          "name": "nuclei",
          "vertices": { "id": "level-0-vertices" },
          "fragments": { "id": "level-0-vertex-fragments" },
          "vertexAttributes": [{ "id": "level-0-va-volume" }],
          "objects": { "id": "level-0-object-index" },
          "objectSets": { "id": "level-0-object-sets" }
        },
        {
          "type": "singlescale",
          "id": "level-0-vertices",
          "name": "vertices",
          "path": { "type": "zarr", "path": "./vertices" }
        },
        {
          "type": "singlescale",
          "id": "level-0-vertex-fragments",
          "name": "vertex_fragments",
          "path": { "type": "zarr", "path": "./vertex_fragments" }
        },
        {
          "type": "collection",
          "id": "level-0-vertex-attributes",
          "name": "vertex_attributes",
          "path": { "type": "zarr", "path": "./vertex_attributes" }
        },
        {
          "type": "collection",
          "id": "level-0-object-index",
          "name": "object_index",
          "path": { "type": "zarr", "path": "./object_index" }
        },
        {
          "type": "zv:table",
          "id": "level-0-object-sets",
          "name": "object_sets",
          "path": { "type": "zarr", "path": "./object_sets" }
        }
      ]
    }
  }
}
```

No `version` (non-root nodes MUST NOT carry it); no `chunk_shape`,
`bin_shape`, `bin_ratio`, `arrays_present`, `chunk_dims` or `sid_ndim` — all now
derivable from the declared systems.

### 8.3 `vertices` array — `<store>/0/vertices/zarr.json`

```json
{
  "zarr_format": 3,
  "node_type": "array",
  "shape": [5, 5, 5],
  "data_type": "bytes",
  "chunk_grid": { "name": "regular", "configuration": { "chunk_shape": [1, 1, 1] } },
  "chunk_key_encoding": { "name": "default", "configuration": { "separator": "/" } },
  "fill_value": "",
  "codecs": [{ "name": "vlen-bytes" }],
  "attributes": {
    "ome": {
      "type": "singlescale",
      "id": "level-0-vertices",
      "name": "vertices",
      "attributes": {
        "coordinateTransformations": [
          {
            "type": "scale",
            "scale": [1.0, 1.0, 1.0],
            "input": "/0/vertices",
            "output": "/0/chunkGrid"
          }
        ],
        "zv:array": {
          "kind": "vertices",
          "rowDataType": "float32",
          "rowWidth": 3,
          "encoding": "raw",
          "indexSpace": "/0/chunkGrid",
          "coordinateSystem": "/0/vertexTable",
          "nonemptyChunks": ["0.0.0", "0.0.1", "1.2.3"]
        }
      }
    }
  }
}
```

Note `"data_type": "bytes"` with codec `"vlen-bytes"` — the registered Zarr v3
spellings.  See inconsistency 7.

### 8.4 A link family and one of its arrays

`<store>/0/links/0/zarr.json`:

```json
{
  "zarr_format": 3,
  "node_type": "group",
  "attributes": {
    "ome": {
      "type": "collection",
      "id": "level-0-links-d0",
      "name": "0",
      "attributes": {
        "zv:linkFamily": {
          "levelDelta": 0,
          "linkWidth": 2,
          "directed": true,
          "store": "canonical",
          "numLinks": 41902,
          "numPhysicalRecords": 41902,
          "indexSpace": "/0/chunkGrid"
        }
      },
      "nodes": [
        {
          "type": "singlescale",
          "id": "level-0-links-d0-self",
          "name": "0.0.0",
          "path": { "type": "zarr", "path": "./0.0.0" }
        },
        {
          "type": "singlescale",
          "id": "level-0-links-d0-zp1",
          "name": "0.0.+1",
          "path": { "type": "zarr", "path": "./0.0.+1" }
        }
      ]
    }
  }
}
```

`<store>/0/links/0/0.0.+1/zarr.json`:

```json
{
  "zarr_format": 3,
  "node_type": "array",
  "shape": [5, 5, 5],
  "data_type": "bytes",
  "chunk_grid": { "name": "regular", "configuration": { "chunk_shape": [1, 1, 1] } },
  "chunk_key_encoding": { "name": "default", "configuration": { "separator": "/" } },
  "fill_value": "",
  "codecs": [{ "name": "vlen-bytes" }],
  "attributes": {
    "ome": {
      "type": "singlescale",
      "id": "level-0-links-d0-zp1",
      "name": "0.0.+1",
      "attributes": {
        "coordinateTransformations": [
          {
            "type": "scale",
            "scale": [1.0, 1.0, 1.0],
            "input": "/0/links/0/0.0.+1",
            "output": "/0/chunkGrid"
          }
        ],
        "zv:array": {
          "kind": "links",
          "rowDataType": "int32",
          "offsets": [[0, 0, 1]],
          "hasPerm": false,
          "numRecords": 1884,
          "indexSpace": "/0/chunkGrid"
        }
      }
    }
  }
}
```

`linkWidth` and `levelDelta` are deliberately absent — inherited from the family.
`hasPerm: false` is now a *derivable, checkable* consequence of `directed: true`
with `store: "canonical"`, rather than a rule buried in
[§10.6](../10-cross-chunk-linking.md).

### 8.5 `object_index` and `manifests`

`<store>/0/object_index/zarr.json`:

```json
{
  "zarr_format": 3,
  "node_type": "group",
  "attributes": {
    "ome": {
      "type": "collection",
      "id": "level-0-object-index",
      "name": "object_index",
      "attributes": {
        "zv:objectIndex": {
          "numObjects": 48211,
          "numPresent": 48211,
          "layout": "vlen_manifests_v1",
          "axis": "/0/objects",
          "indexSpace": "/0/chunkGrid"
        }
      },
      "nodes": [
        {
          "type": "zv:table",
          "id": "level-0-manifests",
          "name": "manifests",
          "path": { "type": "zarr", "path": "./manifests" }
        }
      ]
    }
  }
}
```

`<store>/0/object_index/manifests/zarr.json` — the array that carries **no
discriminator at all** today:

```json
{
  "zarr_format": 3,
  "node_type": "array",
  "shape": [48211],
  "data_type": "bytes",
  "chunk_grid": { "name": "regular", "configuration": { "chunk_shape": [65536] } },
  "chunk_key_encoding": { "name": "default", "configuration": { "separator": "/" } },
  "fill_value": "",
  "codecs": [{ "name": "vlen-bytes" }],
  "attributes": {
    "ome": {
      "type": "zv:table",
      "id": "level-0-manifests",
      "name": "manifests",
      "attributes": {
        "zv:array": {
          "kind": "objectManifests",
          "layout": "vlen_manifests_v1",
          "numObjects": 48211,
          "axis": "/0/objects"
        }
      }
    }
  }
}
```

`sid_ndim` is gone from both: it is `len(coordinateSystems["/0/chunkGrid"].axes)`,
and the manifest decoder reads it from there.  One fact, one place.

## 9. Dual-write, precedence and versioning

### 9.1 The transition

Per the decision taken for this proposal, 0.10.0 **dual-writes**: it emits the
`attributes.ome` RFC 8 node block *and* today's bare-root `multiscales` plus
`zarr_vectors` / `zarr_vectors_level` / `zv_array` keys.

The RFC 8 block is **authoritative**; the 0.9 keys are a **derived mirror,
emitted by a single writer**.  RFC 8 warns explicitly that it "introduces the
possibility for redundant metadata… that can go out of sync", so the proposal
must assign precedence rather than leave it open.  A reader that understands both
MUST prefer the `ome` block; disagreement is a validation error, not a fallback.

Detection: add the capability token `ome_rfc8` to `format_capabilities` in the
mirror, so a 0.9-era reader can tell the new block is present without probing.

### 9.2 The case for dropping the mirror instead — read this before relying on it

Dual-write is the right call for `zarr_vectors` and `zarr_vectors_level`, which
are *true* statements that merely move.  It is a weaker call for the bare-root
`multiscales` block, and the reason is worth stating plainly because it changes
the premise of the decision:

**The bare-root `multiscales` block is not redundant — it is false.**  Its
`scale` is a dimensionless coarsening ratio sitting in a slot that NGFF defines
as world-units-per-index (§5.1).  Keeping it does not protect a reader; it
preserves the one artefact that can make a reader silently wrong.  A generic NGFF
viewer that honours it double-scales the level.  A viewer that ignores it loses
nothing, because the block's discriminator is in a non-standard slot
(`metadata.format`), its NGFF version is `"0.4"`, and it is deliberately not
under `attributes.ome` — so no generic tool reads it usefully today.

Two independent design reviews reached the same conclusion: drop it.  The
counter-argument for keeping it is interoperability with existing readers, but
the only readers of that block are Zarr Vectors' own, and they will be updated in
the same release.

**Recommendation for 0.10.0:** dual-write `zarr_vectors` and
`zarr_vectors_level`, and **drop the bare-root `multiscales` block** rather than
mirroring it.  If it must be retained, mark it deprecated in the same commit and
set its `datasets[].coordinateTransformations` to `identity` — which is the true
level→world map — accepting that `bin_shape` and `bin_ratio` then have no mirror
home and must be read from the `ome` block.  Do not carry the repurposed values
forward.

A better substitute for the interop the block was meant to provide: an optional
`attributes["zv:companionImage"]` Reference with a `Path` to a real OME-Zarr image
store (§1.1).  That is a true statement; the `multiscales` block was not.

### 9.3 Precedence rules

Required by the `zarr-extensions` attribute-registration process, and worth
stating once, normatively:

| Fact | Authority | Subordinate copy |
|---|---|---|
| level → world geometry | the `chunkGrid` / `binGrid` transformations | `zv:level` carries none |
| `linkWidth`, `levelDelta`, `directed`, `store` | `zv:linkFamily` on the family group | a `zv:array` on a member array MUST NOT restate them |
| chunk-grid origin | the integer `zv:array.chunkGridOrigin` | the transformation `translation`, which MUST satisfy `translation == (origin + 0.5) * chunkShape`; integers win, because floats round |
| level ordering | the root's `nodes` order | `zv:level.index` |
| all metadata | the `ome` block | the 0.9 mirror keys |
| shard shape | the Zarr v3 `codecs` pipeline | no `zv:` copy |

### 9.4 Version numbers

- **`zv_version` 0.10.0** — additive, metadata-only.  Every payload byte, array
  path and chunk key is unchanged; only `zarr.json` documents are rewritten.
- **`zv_version` 1.0.0** — structural, batched into one break: the
  `links/<family>/` segment, geometry promoted to real groups, `groups` →
  `object_sets`, and the mirror dropped.
- **NGFF `version`** — one constant, set to the OME-Zarr version that ships RFC 8.
  Written once on the root node.  This settles the code-says-`"0.4"` /
  docs-say-`"0.5"` disagreement (inconsistency 3) by making both obsolete.

**On migration.**  [Appendix J](../15-appendices.md#appendix-j-change-log) states
flatly that there is no in-place migration utility between any two versions and
stores must be rewritten from source.  That policy should be broken **exactly
once, here.**  It exists because past bumps changed payload formats; 0.10.0
changes none.  A migrator walks the store, reads `zarr_vectors` /
`zarr_vectors_level` / `zv_array`, and emits `ome` nodes — and every input it
needs is already on disk, including (usefully) the `bin_shape` that the
implementation writes into `zarr_vectors_level` in violation of §8.4.  Honouring
the blanket rule here would be cargo-culting it past its reason.

Sequence it: the migrator reads `bin_shape`/`bin_ratio` → 0.10.0 writers stop
emitting them → 0.11.0 removes the reader.

## 10. Recommendations on known inconsistencies

| # | Issue | Recommendation |
|---|---|---|
| **1** | The implementation writes `bin_shape`/`bin_ratio` into `zarr_vectors_level`, which [§8.3](../08-metadata.md#83-resolution-level-metadata) forbids.  They are the *first two keys* written, so every store on disk violates the docs. | **The spec was right; the fix is to remove the field, not to enforce the ban.**  Delete the slots from the LinkML `LevelMetadata` class and the dataclass; the only home becomes the `binGrid → world` `scale`, and `bin_ratio` becomes derived.  A field that does not exist cannot be written to a forbidden slot. |
| **2** | The implementation's default axis order is `x, y, z, w` — the reverse of the OME image convention — while a comparison doc claims it follows OME order. | **Keep `x, y, z` as the component order and fix the doc.**  A vertex row is a coordinate tuple, not a voxel index; x-first is universal for point data (TRX, PLY, OBJ, GeoJSON, Draco).  OME's `t,c,z,y,x` exists because it is fastest-varying-last for *image arrays*, which does not apply.  What changes: declare `world` axes in NGFF order, declare `chunkGrid` axes in chunk-key order, and make the relation an explicit `mapAxis`.  Post-change the question is moot — order is declared per coordinate system, never conventional. |
| **3** | Code writes NGFF `"0.4"`; a comparison doc claims `"0.5"`. | Both become obsolete; one `OME_ZARR_VERSION` constant on the root node (§9.4). |
| **4** | The undocumented `parametric` family — a root-level, resolution-independent group with its own type registry (plane, line, sphere + coefficient schemas). | **Document it as the sixth geometry, `zv:shapes`.**  It is not cruft: algebraic shapes are what Neuroglancer annotation layers and OME ROIs need; it is legitimately level-free, which is why it sits at the store root; and its existing `type id → name + coefficient schema` registry is already the right design and becomes `zv:shapes.shapeTypes[]` almost verbatim.  Removing it would be worse — the code writes it, so an undocumented `zv_array` value in the wild will trip the mandated reject-on-unknown-discriminator rule in someone else's reader. |
| **5** | [§14.5](../14-examples.md) declares `t` first per NGFF order but lists it **last** in chunk coordinates. | **Fixed structurally.**  `world` axes `[t, z, y, x]`, `/0/chunkGrid` axes `[ci, cj, ck, ct]`, and an explicit `mapAxis` between them.  The contradiction becomes inexpressible.  Also drop the derive-`sid_ndim`-from-`type=="space"` rule: with `t` in the chunk grid it was always wrong. |
| **6** *(new)* | `vertices_<geometry_type>` arrays exist in the reference implementation for composite stores, undocumented. | Document as the interim mixed-geometry layout in 0.10.0 — one `zv:vertices` node per geometry, referenced by its own geometry node — then retire in 1.0.0 in favour of per-geometry subgroups (§6.4).  The suffix trick has nowhere to put per-geometry fragments, links or attributes. |
| **7** *(new)* | The spec's prose and examples use `variable_length_bytes` as the Zarr data type.  The **registered** Zarr v3 names are data type **`bytes`** with codec **`vlen-bytes`** (verified against `zarr-extensions/data-types/bytes/` and `codecs/vlen-bytes/`); `variable_length_bytes` is a zarr-python alias. | Correct the prose in [§5](../05-zarr-store-structure.md), [§8](../08-metadata.md), [§11](../11-compression-and-encoding.md) and [Appendix D](../15-appendices.md).  A reader validating against the actual registry would currently reject every documented example. |
| **8** *(new)* | Three spellings for one entity: docs say `groups`, LinkML says `groupings`, the directory is `group_attributes`, the discriminator is `groupings_attribute`. | Collapse to **object set**: path `object_sets`, `object_sets_attributes/`, kinds `objectSets` and `denseAttribute domain:"objectSet"`.  "Group" must not name a non-Zarr-group concept in a format where every node is a Zarr group or array.  Structural, so 1.0.0. |
| **9** *(new)* | `object_index/manifests` carries no `zv_array` discriminator — attributes sit on the parent group — contradicting [§13.1](../13-conformance-and-validation.md#131-conformance-levels), which requires every node to have a recognised one. | Fixed by construction: RFC 8 requires `type` and `name` on every node.  Add `kind: "objectManifests"` (§8.5). |

## 11. Validation

The five conformance levels of
[§13.1](../13-conformance-and-validation.md#131-conformance-levels) survive
intact; the checks get sharper, and several move *down* a level — cheaper, earlier
failure.

| Level | Gains | Loses |
|---|---|---|
| **1** structure | Every node has `attributes.ome` with a recognised `type`; containment is legal per §7.1; `nodes[]` entries resolve.  **New coverage**: the 7 untyped container groups and `manifests` currently escape all structural checks. | — |
| **2** metadata | Per-node-type JSON Schema.  RFC 5 graph checks: every declared system is reachable from `world`; every `input`/`output` names a declared system; names unique.  RFC 8 checks: `version` on root only; `nodes` XOR `path`; `name` unique within a collection; `id` unique per document. | `format_capabilities` token recognition (the field is gone); `arrays_present` agreement (subsumed by level 1). |
| **3** consistency | `denseAttribute.shape[0] == axis length`; `chunkedAttribute.alignedTo` row parity; `links.offsets` matches its path name — the name grammar becomes a *cross-check* between two representations rather than the only representation. | — |
| **4** conformance | Geometry rules become schema rules: `cellType` ↔ `linkWidth` (quad vs tetra now distinguishable); `zv:tree` forbids `linkWidth == 1` at `levelDelta == 0`.  **Most of level 4 moves into level 2 as pure schema**, which matters because these are the checks most often skipped. | — |
| **5** pyramid | Transformation arithmetic: level-N `chunkGrid` scale ÷ level-0 = positive integer per axis; chunk scale ÷ bin scale = integer; `parent` References form a tree. | `bin_ratio` consistency (derived, cannot disagree); `cross_level_storage`-driven array presence (derived). |

LinkML at `zarr-vectors-py/schema/zarr_vectors.linkml.yaml` stays the source of
truth and the JSON Schemas are generated, never hand-written.  The refactor is
mechanical, because the file already uses the right pattern —
`slot_usage: {zv_array: {equals_string: vertices}}` is a discriminated union in
all but name.

## 12. Open questions for the OME community

Stated plainly, because three of these block the design and this proposal picks
an answer that could turn out to be wrong.  Each has an interim workaround, so
nothing is blocked on an answer.

| | Question | Why it matters here | Assumed answer |
|---|---|---|---|
| **Q1** | May a `nodes[]` entry whose `type` is not `collection` carry a `Path`?  Must `nodes` be exhaustive? | **Blocking.**  If `path` is collection-only, a level cannot list its arrays without inlining full array metadata into the parent — reintroducing the duplication RFC 8 warns about. | Yes; `nodes` need not be exhaustive. |
| **Q2** | `singlescale` restricts `coordinateTransformations` to `scale` or `sequence(scale, translation)`.  Where does a node put other RFC 5 edges (`coordinates`, `displacements`, `byDimension`)? | **Blocking.**  Forces the level's free-standing edges under a prefixed `scene` sibling — legal, but exactly the "prefixed key extending an unprefixed key" case that should eventually be core. | On the enclosing collection's `scene` attribute. |
| **Q3** | Is there, or will there be, a node type for an **array with no coordinate system**? | The only new structural type this proposal mints.  `ome:table` or unprefixed `array` would let us delete `zv:table`.  SpatialData hit the same wall (§3.3). | No; mint `zv:table`, alias it later. |
| **Q4** | Can RFC 5 `coordinates` gain an **encoding indirection**, so ragged, chunked, Draco- and parquet-backed coordinate sources qualify? | Without it, `coordinates` is unusable by every real point-cloud store, which is probably why it is unused.  Two sentences of amendment, large reach. | No; mint `zv:chunkedCoordinates`. |
| **Q5** | Is there a core home for a node's **extent / bounding box**? | `bounds` is load-bearing in Zarr Vectors (grid origin, query resolution) and has no OME home. | No; `zv:vectors.bounds`. |
| **Q6** | How are **categorical labels for a discrete axis** expressed? | Non-spatial chunk axes (the gene-block case in [§14.6](../14-examples.md)) have no native encoding. | No; `zv:categories` on the axis. |
| **Q7** | Is a real **CRS** (EPSG / WKT / PROJ) in RFC 5's scope? | [§8.8](../08-metadata.md#88-coordinate-reference-system-crs) promises an "RFC 4/5 CRS dict" that RFC 5 does not define.  GeoZarr needs this too; it should be specified once, jointly. | Out of scope; `zv:vectors.crs` as an opaque pass-through. |
| **Q8** | How is `id` uniqueness scoped across `path`-referenced external documents?  And how can an aggregation reference stores at **different `version`s**, given non-root nodes MUST NOT differ? | Blocks multi-store aggregation (§7.2). | Document-scoped; external references always carry `path`; version heterogeneity is currently unrepresentable. |
| **Q9** | Does the **pixel-centre origin convention** extend to non-image discrete grids such as a chunk grid? | A half-chunk disagreement between an RFC 5 reader and `floor(position / chunk_shape)` is a silent, plausible-looking error. | Yes; corners derived and documented (§5.2). |
| **Q10** | May `arrayCoordinateSystem` be a **name reference** to a system declared elsewhere, rather than an inline definition? | A level has 30+ arrays sharing one index space.  Redefining it per array is 30 copies of one fact. | Yes; interim `zv:array.indexSpace` carries a name reference. |

Beyond the ten: RFC 8's `Path.type` and `CoordinateTransformation.type` extension
points, combined with `collection` nesting, turn out to be *almost* enough to fill
the geometry gap RFC 5 declares out of scope.  The only two things missing are a
coordinate-system-free array node and a place to hang free-standing
transformation edges — both small additions, and both worth proposing as `ome:`
extensions rather than leaving every vector-data format to invent its own prefix
for them.

## 13. Appendix — what a registration directory would contain

Not part of this proposal's deliverable; recorded so the shape is agreed.
Mirrors the `zarr-extensions` house style, where an attribute registers under
`attributes/<top-level-key>/` and a per-extension directory carries `README.md`
(MUST), `schema.json` (SHOULD, `$schema` draft 2020-12, `npx prettier -w`), and
`sample_data/` or `examples/`.  The local `codecs/nanovdb/` extension is the
section-order template.

```text
extensions/zv/
├── README.md                     # authority, contact, spec URL, versioning policy
├── node-types.md                 # the 7 zv: node types, one section each
├── transformations.md            # zv:chunkedCoordinates
├── attribute-keys.md             # zv:vectors, zv:level, zv:array, zv:linkFamily,
│                                 #   zv:objectIndex, zv:aggregate, zv:categories,
│                                 #   zv:mirrors, zv:pyramidHint, zv:companionImage,
│                                 #   zv:fromVertexAttribute
├── schemas/                      # generated from LinkML; CI-diffed against it
│   ├── zv-vectors.schema.json … zv-shapes.schema.json
│   └── any-node.schema.json      # oneOf over all, discriminated on `type`
├── examples/                     # the five documents of §8, verbatim
└── sample_data/
    └── tiny_points.zarrvectors/  # 2 levels, 2 chunks, 1 vertex attribute,
                                  #   1 object attribute, object sets, object index
```

`README.md` section order: extension name and prefix → node types introduced →
transformation types introduced → attribute keys and their placement → required
and optional fields per key → coordinate systems and the connectivity requirement
→ **inheritance and precedence rules** (mandatory for a registered attribute;
§9.3) → payload formats referenced but not defined here (`fragment_index_v1`,
`vlen_manifests_v1`) → interaction with other extensions (`multiscale`, `labels`,
`scene`, `plate`, sharding) → reader pass-through → examples → interoperability
and compatibility (the NGFF 0.4 bare-root tombstone; the SpatialData comparison)
→ reference implementation → change log → current maintainers.
