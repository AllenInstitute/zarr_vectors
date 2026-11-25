"""Generate convention/schema.json from convention/zarr_vectors.linkml.yaml.

Usage::

    python convention/build.py            # regenerate schema.json
    python convention/build.py --check    # exit 1 if schema.json is stale
    python convention/build.py --compare ../zarr-vectors/schema.json
                                          # exit 1 if the published copy differs

The LinkML file is the only source.  This script runs LinkML's JSON Schema
generator (``include_null=False``) and then makes four mechanical changes:

1. Each class's ``json_schema`` annotation (named JSON Schema fragments,
   for constraints LinkML cannot express) is appended to that class's
   ``allOf``, in order.
2. A property whose slot is annotated ``nullable: true`` also accepts
   JSON ``null``.
3. The document root becomes ``{"$ref": "#/$defs/ZarrNode"}`` instead of a
   copy of that class, so an annotation applies once.
4. ``$schema`` becomes Draft 2020-12 (the generator emits 2019-09; the
   output uses no keyword whose meaning differs), the generator's
   non-keyword fields are dropped, and every subschema using type-specific
   keywords declares its ``type``, so Ajv's strict mode compiles it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "zarr_vectors.linkml.yaml"
OUT = HERE / "schema.json"
ANNOTATION = "json_schema"


_KEYWORD_TYPES = {
    "object": {"properties", "required", "patternProperties", "additionalProperties",
               "propertyNames", "minProperties", "maxProperties", "dependentRequired"},
    "array": {"items", "prefixItems", "contains", "minItems", "maxItems", "uniqueItems",
              "minContains", "maxContains"},
    "string": {"pattern", "minLength", "maxLength", "format"},
    "number": {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"},
}
_SCHEMA_MAPS = ("properties", "patternProperties", "$defs")
_SCHEMA_LISTS = ("allOf", "anyOf", "oneOf", "prefixItems")
_SCHEMA_ONE = ("items", "contains", "not", "if", "then", "else", "propertyNames",
               "additionalProperties")


def _declare_types(node) -> None:
    """Give every subschema that uses type-specific keywords an explicit `type`.

    Ajv's strict mode (strictTypes) requires it.  A keyword of one type only
    ever constrains values of that type, so this changes what validates only
    where a value of another type would have slipped past the keyword; the
    examples and the comparison against real stores check it changes nothing.
    """
    if not isinstance(node, dict):
        return
    if "type" not in node and "$ref" not in node:
        implied = [t for t, kws in _KEYWORD_TYPES.items() if kws & set(node)]
        if len(implied) == 1:
            node["type"] = implied[0]
    for key in _SCHEMA_MAPS:
        for sub in (node.get(key) or {}).values():
            _declare_types(sub)
    for key in _SCHEMA_LISTS:
        for sub in node.get(key) or []:
            _declare_types(sub)
    for key in _SCHEMA_ONE:
        _declare_types(node.get(key))


def _nullable(prop: dict) -> dict:
    """Let a generated property also accept JSON null."""
    t = prop.get("type")
    if isinstance(t, str) and not ({"$ref", "anyOf", "oneOf", "const", "enum"} & set(prop)):
        return {**prop, "type": [t, "null"]}
    if isinstance(t, list) and not ({"$ref", "anyOf", "oneOf", "const", "enum"} & set(prop)):
        return {**prop, "type": t if "null" in t else [*t, "null"]}
    return {"anyOf": [prop, {"type": "null"}]}


def _fragments(view):
    import yaml

    raw = yaml.safe_load(SOURCE.read_text(encoding="utf-8"))
    out = {}
    for name, cls in (raw.get("classes") or {}).items():
        ann = ((cls or {}).get("annotations") or {}).get(ANNOTATION)
        if ann is None:
            continue
        frags = ann.get("value") if isinstance(ann, dict) else None
        if not isinstance(frags, dict) or not all(isinstance(f, dict) for f in frags.values()):
            raise SystemExit(f"{name}: annotation {ANNOTATION!r} must map names to JSON Schema objects")
        if name not in view.all_classes():
            raise SystemExit(f"annotation on unknown class {name!r}")
        out[name] = list(frags.values())
    return out


def build() -> str:
    from linkml.generators.jsonschemagen import JsonSchemaGenerator
    from linkml_runtime import SchemaView

    view = SchemaView(str(SOURCE))
    gen = JsonSchemaGenerator(
        str(SOURCE),
        top_class="ZarrNode",
        include_range_class_descendants=True,
        include_null=False,
    )
    generated = json.loads(gen.serialize())
    defs = generated["$defs"]

    for cls in view.all_classes():
        props = defs.get(cls, {}).get("properties", {})
        for slot_name, prop in props.items():
            ann = view.induced_slot(slot_name, cls).annotations or {}
            if "nullable" in ann and str(ann["nullable"].value).lower() == "true":
                props[slot_name] = _nullable(prop)

    # A `linkml:Any` class comes out as a union of every JSON type, which
    # Ajv's strict mode refuses; the empty schema means the same.
    for cls in view.all_classes().values():
        if cls.class_uri == "linkml:Any" and cls.name in defs:
            defs[cls.name] = {"description": " ".join((cls.description or "").split())}

    for name, frags in _fragments(view).items():
        target = defs[name]
        all_of = target.setdefault("allOf", [])
        all_of.extend(frags)

    schema = view.schema
    doc = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": schema.id,
        "title": schema.title,
        "description": " ".join(schema.description.split()),
        "$ref": "#/$defs/ZarrNode",
        "$defs": defs,
    }
    # Drop empty descriptions the generator emits for undocumented elements.
    def tidy(node):
        if isinstance(node, dict):
            if node.get("description") == "":
                del node["description"]
            for v in node.values():
                tidy(v)
        elif isinstance(node, list):
            for v in node:
                tidy(v)

    tidy(doc)
    _declare_types(doc)
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if schema.json is stale")
    ap.add_argument("--compare", metavar="PATH",
                    help="fail unless the JSON at PATH (e.g. the convention repository's "
                         "schema.json) equals the generated schema, ignoring formatting")
    args = ap.parse_args()
    text = build()
    if args.compare:
        other = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        if other != json.loads(text):
            print(f"{args.compare} differs from the generated schema", file=sys.stderr)
            return 1
        print(f"{args.compare} matches the generated schema")
        return 0
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT.name} is stale: run python convention/build.py", file=sys.stderr)
            return 1
        print(f"{OUT.name} is up to date")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
