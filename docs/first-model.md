# First model — the short path for a simple part

The rules one simple part needs, excerpted verbatim from api-replicad, pipeline-code-agent and MasterSkill. Load those sections for anything more.

## The file

```js
const main = ({ makeBox, makeCylinder, Sketcher, draw, compoundShapes, ... }) => {
  // destructure only what you need from the first argument
  return solid; // or [{ name, shape }] or compoundShapes(parts)
};
```

**Critical:** Destructure directly from the first argument — never `const { makeBox } = replicad`.

The code must define:

```js
const main = (api) => {
  return solid;
};
```

`api` is the **only** argument. Destructure from it exactly what this model uses — that is the
whole contract. Never reach for a global `replicad` object.

Allowed return values:

- a single solid
- `compoundShapes(parts)`
- an array of `{ name: string, shape: Solid }`

A bare solid returned from main is the part named `model`; return `[{ name, shape }]` to name it. measure takes that name as part_a.

## Primitives

```js
makeBox([x1,y1,z1], [x2,y2,z2])              // box between two corner points — explicit, unambiguous
makeBaseBox(xLen, yLen, zLen)                  // box by dimensions: X/Y centred at origin, Z sits on Z=0 (spans [0, zLen])
makeCylinder(radius, height)                   // upright cylinder, base at Z=0, centred on X/Y origin
makeCylinder(radius, height, location, dir)    // positioned; location & dir are [x,y,z] Points
makeSphere(radius)                             // sphere centred at origin
makeEllipsoid(aLength, bLength, cLength)       // three independent radii along X/Y/Z
```

**`makeBaseBox` placement:** X and Y are centred (`[-xLen/2, xLen/2]`); Z is NOT centred — it sits on Z=0 (`[0, zLen]`). Use `makeBox` when you need fully explicit corner placement.

## Cut, join, place

```js
solid.fuse(other)       // union
solid.cut(tool)         // difference (subtract tool from solid)
solid.intersect(tool)   // intersection
```

```js
solid.translate(x, y, z)
solid.translateX(d) / .translateY(d) / .translateZ(d)
```

## Parameters

- Every dimensional const declares its unit (`unit:mm`, or `unit:in` for an inch user); a proportion declares `unit:ratio`, or the panel converts it as millimetres.
- Every editable parameter needs a range annotation exactly like `// [min:max]`, on the same line as a plain `const NAME = NUMBER;` declaration; the semicolon is required, and tags go after the range: `const opening = 0.6; // [0.2:0.9] unit:ratio`. If the value is an expression (e.g. `90.5 * 25.4`) the annotation will not parse and no slider will appear. Negative values and bounds are allowed.

certify_model tests the ends of the ranges: each parameter at its min and max, all at min and all at max, and each pair at opposite ends. A corner fails on an error, an empty or flat part, parts sharing volume, an unsound solid, or a part that is one solid as saved and falls into pieces there. Values in between are not built.

## Build, then check

**Never treat the absence of a verdict as success.** If the write reports the build as *pending* (`buildPending`), or returns no verdict at all, the outcome is **unknown** — call `get_validation_report` in a few seconds, until its status is ok or error and it is not stale; never push again to find out. Unknown is never "fine".

1. **The inline build verdict** — free; it came back with the push. Read it.
2. **Structured probes** — `check_dimensions` · `measure` on TWO parts (flush/gap/overlap
   per axis, plus the real shared volume) · `measure` on ONE part (its exact solid volume
   against the blank it is cut from — the only way to confirm a dado, notch, bore or
   pocket actually landed, since a box is identical either way) · the part names in the
   verdict. Near-free, exact, no vision needed.
   ⚠ measure's volume proves material was removed, not where: a cut that stays inside the solid leaves a hidden void with the outside unchanged, and check_dimensions and measure both pass it. Nor does it say how thick what remains is.
3. **ONE `capture_screenshot` (iso or fit)** — for what only an eye catches: a floating
   part, an unsupported span, proportions that read wrong. With no Studio tab open there is
   usually no picture to take: give the user the model's `studio_url` for a visual check.

Editing instead? Read get_model_code first: its Base: value is base_content_hash, and parameter names stay exactly as they are.
