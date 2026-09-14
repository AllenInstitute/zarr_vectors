Done. The proposal is at docs/proposals/rfc8-alignment.md (~8,900 words), added to index.md under a new "Proposals" toctree. Chapters 01–15 are untouched.

Verification
check	result
sphinx-build -W (warnings as errors)	build succeeded
JSON examples parse	10/10
RFC 8 legality (25 nodes, 9 documents)	no violations — version on roots only, every node named, names unique per collection, nodes XOR path
Prefix discipline	clean — no unprefixed non-core identifiers
Key inventory	39/39 (13 root + 13 level + 13 zv_array) each with a verdict
-W earned its place: it caught 7 bad anchors, one of which was a real error — I'd had §8.3 (Resolution-Level) and §8.4 (Array-Level) swapped, and had cited §8.6 for a note that's in §8.4.

The core of the proposal
RFC 5 already built the coordinate axis type and the coordinates transformation, then declared geometry out of scope. A coordinates transformation is defined as a lookup returning a coordinate vector at an input location, backed by an array of shape [d1..dN, M] with an axis of type: "coordinate". That is a vertex table. The NGFF geometry gap is smaller than it looks.

The transform overload, diagnosed. The two halves fail differently. scale = bin_shape/base_bin_shape is a dimensionless coarsening ratio in a slot NGFF defines as world-units-per-index — a viewer honouring it double-scales the level. But translation = bin_shape/2 is correct: it's RFC 5's cell-centre convention, attached to the wrong coordinate system. The fix isn't a new mechanism, it's RFC 5's input/output naming, which makes the old encoding unwriteable.

Node types: 7 new strings. Containers reuse native collection; per-chunk arrays reuse native singlescale with scale:[1,1,1] → chunkGrid. New: zv:table (arrays with no coordinate system — all three RFC 8 types presuppose one, and SpatialData independently forbids coordinate systems on tables, which is strong evidence OME's vocabulary is missing this node), plus six geometry types as inline nodes — declarative views over arrays by Reference, so geometry becomes first-class with zero on-disk change.

Root keys 13 → 4; level keys 14 → 5; format_capabilities disappears entirely.

Two real bugs found, not just tidying
link_width = 4 is ambiguous — §12.2 lists quad and tetrahedral meshes under it with no way to distinguish them. cellType fixes it and makes the check bidirectional.
data_type: "variable_length_bytes" is not a registered Zarr v3 name. I verified against the local zarr-extensions checkout: it's data type bytes + codec vlen-bytes. A validator against the actual registry would reject every documented example today. That's inconsistency 7 of 9 (I found 4 more beyond your 5, including three spellings for one entity, and object_index/manifests carrying no discriminator despite §13.1 requiring one).
One thing I'd push back on
You chose dual-write, and §9.2 delivers it — but argues against it for the bare-root multiscales block specifically, because that block isn't redundant, it's false. Keeping it preserves the one artefact that can make a reader silently wrong, and no generic tool reads it usefully today (non-standard discriminator slot, NGFF 0.4, not under attributes.ome). Both independent design reviews concluded: drop it. My recommendation is dual-write zarr_vectors/zarr_vectors_level and drop multiscales, with zv:companionImage as the honest substitute for the interop it was meant to provide. Your call — the section presents both and I've implemented what you asked.

Also flagged: 10 open questions for OME, three of which (Q1, Q2, Q3) genuinely block the design, each with an interim workaround so nothing stalls on an answer.