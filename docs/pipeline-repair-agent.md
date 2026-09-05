# Repairing a Failed Build

Load this when the build verdict reports a failure. It is how to fix blocking errors in Replicad JavaScript without wrecking a model that was mostly right.

---

## Operating Principle

Be the smallest safe fix.

Read the exact error from the build verdict (its code lint often names the real cause behind a cryptic runtime error), fix **only the broken operation**, and push again. Do not redesign the model, do not add features, and do not rewrite working code for style. A repair that quietly changes the design is a worse failure than the build error.

If the design itself is unbuildable — not just miscoded — stop patching and say so (see *When Patching Is The Wrong Answer*).

---

## What Repair Is For

It is for:

- fixing blocking syntax / runtime / API errors
- preserving working code, parameters, and annotations
- deciding whether a repair is even possible
- recording a lesson so the failure doesn't recur

It is **not** for:

- improving design quality
- changing what the user asked for
- adding features
- reworking the parameter schema, unless an error forces it

Preserve the user's parameter names and ranges exactly (`get_parameters`) — renaming one silently destroys their saved values.

---

## Repair Priority

Fix in this order:

1. malformed code — syntax errors, unterminated strings
2. missing or malformed `main`
3. wrong API destructuring
4. global `replicad` references
5. undefined variables
6. missing return
7. invalid Replicad API calls
8. wrong method signatures
9. missing extrude distance
10. wrong rotate signature
11. failed booleans from cutter depth/position
12. shell/cut instability
13. hardcoded dimension warnings — only if the fix is safe

---

## Non-Negotiable Rules

- Fix only what the build actually flagged (the push verdict / `get_validation_report`).
- Preserve working geometry.
- Preserve what the user asked for.
- Preserve all existing parameter constants unless the error requires a change.
- Preserve range annotations.
- Preserve the coordinate convention comment.
- Preserve named body structure when possible.
- Do not rename variables unless required.
- Do not convert units.
- Do not add features.
- Do not invent unavailable Replicad methods.
- Do not hide remaining blocking errors.

---

## Common Fixes

### Wrong destructuring
Move API functions into the first argument of `main`.

Correct:

```js
const main = ({ makeBox }) => {
  return makeBox([0, 0, 0], [10, 10, 10]);
};
```

Wrong:

```js
const main = (replicad) => {
  const { makeBox } = replicad;
};
```

### Wrong rotate signature
Use:

```js
shape.rotate(angle, [0, 0, 0], [0, 1, 0])
```

### Missing extrude distance
Add the distance from the strategy, schema, or nearest existing derived dimension.

### Undefined variable
Declare it before first use and bind it to the closest existing parameter or derived dimension.

### Missing return
Return a solid, `compoundShapes(parts)`, or an array of `{ name, shape }`.

### Invented method
Replace it only if a clear equivalent exists in the allowed API. If no safe replacement exists, tell the user the approach won't work and propose one that will.

### Cutter does not penetrate
OCC throws `"This object has been deleted"` when a boolean cut fails because the cutter does not extend clearly beyond both faces.

**Rule: all cutters must extend at least 1mm beyond each face they cut through.**

```js
// wrong — cutter flush with body faces
const cutter = makeCylinder(r, totalHeight); // flush top and bottom

// correct — overshoots by 1mm each side
const cutter = makeCylinder(r, totalHeight + 2 * overshoot)
  .translate([cx, cy, -overshoot]);
```

Apply this to every boolean cut: holes, slots, pockets, cutouts.

### Sequential boolean cuts on stacked geometry
Cutting one cutter through multiple separate bodies one at a time is fragile. Fuse the stack first, then cut once.

```js
// fragile
const panels = positions.map(z => makeBox(...).translateZ(z));
const result = panels.map(p => p.cut(cutter)); // any one can fail

// reliable
const stack = panels.reduce((a, b) => a.fuse(b));
const result = stack.cut(cutter); // cutter must still overshoot
```

### Shell/cut instability
If shelling or cuts after shelling caused the failure, replace the hollow body with individual wall panels when practical. If that would change the whole approach, stop and rethink it with the user rather than patching around it.

---

## Diagnosis Checklist

When geometry is wrong or empty, check in this order:

1. Is the coordinate convention declared and consistent throughout?
2. Is the main elevation drawn in the correct Sketcher plane?
3. Is extrusion going through the intended depth axis?
4. Are openings actual voids, not just outlines?
5. Are roof or cap profiles in the same coordinate system as the body?
6. Does every cutter fully penetrate both faces of the wall it cuts?
7. Is `.shell()` followed by `.cut()`? Replace with individual wall panels.
8. Is a failed boolean producing a null/empty shape silently?

---

## Render Validation Errors

### `"geometry has no vertices"`

Shape created without error but mesh is empty. Causes:

**Degenerate dimensions** — one axis is zero or near-zero:
```js
const innerW = width - 2 * thickness; // collapses to 0 if width == 2*thickness
const shelf = makeBox([0, 0, 0], [depth, innerW, thickness]); // empty mesh
```
Fix: add a guard — `if (innerW <= 0) throw new Error("...")`.

**Coordinate range collapse** — both corners identical on one axis:
```js
const top = makeBox([0, 0, H], [D, W, H]); // z1 == z2 — degenerate
```

**Boolean over-subtracted** — cutter fully encloses the body:
```js
const result = base.cut(cutter); // empty if cutter contains entire base
```
Fix: check that cutters never fully enclose the body being cut.

### `"part 'X' produced no geometry"`

A specific named part is empty. Diagnose as above for that part. Most common cause: a panel or shelf whose derived position is outside the valid range. Throw an explicit error rather than silently skipping — silently skipping leaves an empty part in the array.

### `"code returned an empty parts array"`

`main()` returned `[]`. Causes:
- A conditional guard prevented any parts from being pushed
- Required parts (sides, base, top) were inside an optional guard

Fix: required parts must be built unconditionally. Only optional parts (shelves, drawers) should be inside count guards.

---

## When Patching Is The Wrong Answer

Stop patching and rethink the approach when:

- the design depends on Replicad operations that don't exist
- fixing it would mean redesigning the object anyway
- booleans cannot be made stable across the parameter range
- repeated attempts fail for the same root cause
- the model needs a different part structure, not a patch

When you hit one of these, **tell the user in plain language** what is wrong and what you propose instead. Do not fake success by pushing code that builds but isn't the thing they asked for.

---

## Attempt Discipline

Two focused attempts, then stop and think.

- **First attempt** — the smallest repair likely to build.
- **Second attempt** — fix the remaining blocking error only if the cause is now clear.
- **Still failing?** Stop. Repeating a failed fix burns the user's time and your credibility. Say what you've tried, what the error actually says, and what you'd change about the approach.

Between attempts, `search_knowledge` on the error text — someone may have already solved it.

---

## Always Record The Lesson

After every repair, call `record_lesson` with one sentence: what was wrong and how you fixed it, written as a rule for a future code generator.

Example lessons:

- "Cutter must extend at least 1mm beyond both faces of the body being cut — flush cutters fail silently."
- "Do not use .shell() when subsequent .cut() operations are needed — build hollow bodies from individual wall panels."
- "Sequential boolean cuts on stacked geometry are unreliable — fuse the stack first, then cut once."

If repair was impossible, write the lesson as a warning about what to avoid in future generation.

This is the write half of Axle's learning loop. Your fix, recorded, prevents the same failure for every future session — including other people's. Skipping it throws the knowledge away.

---

## Pushing The Repair

`push_model_code({ model_id, code, param_schema, rationale })` — the `rationale` should say what broke and why this fix is correct.

The repair push returns its own verdict — read it. Never assume a repair worked.

---

## Final Self-Check

Before you push, verify:

- Did I fix only what was actually broken?
- Did I preserve what the user asked for?
- Did I preserve working code?
- Did I preserve parameters and range annotations?
- Did I avoid redesigning the object?
- Did I avoid invented methods?
- Should I be rethinking the approach instead of patching?
- Did I `record_lesson`?
