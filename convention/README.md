# Zarr Vectors convention: schema source

This folder holds the machine-readable definition of the
[Zarr Vectors convention](https://github.com/Andrew-Keenlyside/zarr-vectors)
v0.1.0, the metadata of Zarr Vectors format 0.10.0. The convention itself
(its README, examples and the published `schema.json` that `schema_url`
names) lives in
[Andrew-Keenlyside/zarr-vectors](https://github.com/Andrew-Keenlyside/zarr-vectors).
The LinkML model lives here, next to the format spec, and the published
schema is generated from it.

| File | What it is |
| --- | --- |
| `zarr_vectors.linkml.yaml` | **The source.** A [LinkML](https://linkml.io) model of one node's `zarr.json`. Edit this. |
| `schema.json` | The JSON Schema (Draft 2020-12) generated from the model. **Generated**; never edit it by hand. It is copied to the convention repository on release. |
| `build.py` | Regenerates `schema.json`; `--check` fails if it is stale; `--compare PATH` fails if the published copy differs. |
| `test_schema.py` | Runs `build.py --check`, checks `schema.json` against the meta-schema, and runs the examples. |
| `examples/` | Nodes that must validate. |
| `examples/invalid/` | Nodes that must be rejected, one broken rule each. |

## Editing

```sh
pip install -r convention/requirements.txt
# edit convention/zarr_vectors.linkml.yaml
python convention/build.py
python convention/test_schema.py
```

Commit the LinkML change and the regenerated `schema.json` together; CI
fails if they disagree. For a new rule, add an invalid example that
breaks only that rule.

## How the model is laid out

- `ZarrNode` is the whole `zarr.json`. It constrains `node_type`,
  `data_type` and `codecs` only where a kind needs it. Every other Zarr
  field is allowed.
- `NodeAttributes` holds `zarr_conventions`, `zarr_vectors` and, on the
  root, `multiscales`. Other keys, including other conventions'
  `proj:projjson` and `user_metadata`, are allowed.
- `ZarrVectorsBlock` is abstract. Each kind is a subclass that fixes `kind`
  with `equals_string`, so `zarr_vectors` must match exactly one subclass,
  and an unknown kind matches none. The subclasses are open: unknown fields
  are allowed, as the convention requires.
- Cross-field rules are LinkML `rules`. They become `if`/`then` clauses in
  the JSON Schema.

## What LinkML cannot express

LinkML 1.12's JSON Schema generator has no way to say these, so each one is
written as JSON Schema in a `json_schema` annotation on its class. The
annotation holds named fragments under `value`, which keeps the file valid
for `linkml-lint` and the other LinkML generators. `build.py` appends the
fragments to the class's `allOf`, in order. The generated Pydantic models
do not enforce these fragments. These are all of them:

| Class | Constraint | Missing LinkML feature |
| --- | --- | --- |
| `ZarrNode` | a vlen kind's codecs include `vlen-bytes`, directly or inside a sharding codec | "array contains an object matching X" |
| `ZarrNode` | the root registers the multiscales convention | same |
| `NodeAttributes` | exactly one Zarr Vectors registration, and any entry claiming its uuid or name matches in full | same, plus `maxContains` and a conditionally closed object |
| `Multiscales` | the layout includes level `"0"` | "array contains an object matching X" |
| `RootMetadata` | at least one `space` axis; chunk and bin sizes `> 0` | same; exclusive bounds |
| `LevelMetadata` | `preserves_object_ids: true` needs `inherited_num_objects`; level 0 has null or absent bins and parent and preserves no ids; sizes `> 0` | boolean equality in rules; "null or absent"; exclusive bounds |
| `GroupsMetadata` | `group_ranges` maps ids to `[start, stop]` pairs | a map whose values are not objects |

Optional fields do not accept `null`, except where a `slot_usage` annotates
the field `nullable: true` (eight level fields that writers set to `null`).

### Generator quirks the source works around

- **Forbidding several fields in one rule.** A rule that forbids several
  slots (`value_presence: ABSENT`) is emitted as "not all of them together".
  The source therefore gives each forbidden slot its own rule.
- **`range` in a postcondition** is dropped. The source spells value sets
  with `equals_string_in` instead.
- **Ajv strict mode.** The generator emits Draft 2019-09, a catch-all type
  as a union of every JSON type, and subschemas without an explicit `type`.
  `build.py` sets Draft 2020-12, emits `{}` for the catch-all, and declares
  the type each subschema's keywords imply, so that Ajv's strict mode
  compiles the result.

## Verification

When the LinkML replaced the hand-written schema, the two were compared on
23,904 documents: the 55 examples, nodes written by zarr-vectors-py
(points with a pyramid, a sharded graph, a mesh, polylines, parametric
objects), and mutations of each one. The mutations removed each field, set
it to each of 20 values of every JSON type, added forbidden fields, changed
`kind`, `node_type`, `data_type` and `zarr_format`, broke the convention
entries, and rewrote the multiscales layout. The two schemas accepted and
rejected exactly the same documents. The generated schema also compiles
under Ajv 8 in strict mode.

## Publishing to the convention repository

The convention's `schema_url` and `spec_url` name
[Andrew-Keenlyside/zarr-vectors](https://github.com/Andrew-Keenlyside/zarr-vectors)
at tag `v0.1.0`:

- `https://raw.githubusercontent.com/Andrew-Keenlyside/zarr-vectors/refs/tags/v0.1.0/schema.json`
- `https://github.com/Andrew-Keenlyside/zarr-vectors/blob/v0.1.0/README.md`

They appear in `zarr_vectors.linkml.yaml` as the schema `id` and in
`ZarrVectorsConventionMetadata`. The `examples/` here are the same files as
the convention repository's `examples/`.

To publish a change, with both repositories checked out side by side:

```sh
python convention/build.py
cp convention/schema.json ../zarr-vectors/schema.json
cp -r convention/examples/. ../zarr-vectors/examples/
(cd ../zarr-vectors && npx prettier --write schema.json && npm test)
python convention/build.py --compare ../zarr-vectors/schema.json
```

Prettier reformats the copy, so the convention repository's `schema.json`
differs from this one in whitespace only; `--compare` checks that. Once a
convention tag is cut, the schema at that tag never changes: a change to the
model that changes what validates needs a new convention version, a new tag,
and new URLs in the model.
