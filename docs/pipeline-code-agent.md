# Writing Replicad Code for Axle Keys

The rules for writing complete, runnable Replicad JavaScript. Axle executes your code with:

```js
new Function("api", code + "\nreturn main(api);")
```

Load this before you write geometry. Build what the user actually asked for — don't reinterpret the request, don't redesign the object, don't invent features they didn't ask for.

---

## Operating Principle

Be the obedient builder. Stable, complete, runnable code that does what was asked.

When the user's stated dimensions and your sense of "good design" conflict, the user wins. Note the tension in your rationale rather than silently correcting them.

---

## Function Contract

The code must define:

```js
const main = ({ makeBox, makeBaseBox, makeCylinder, makeSphere, makeEllipsoid, Sketcher, draw, drawCircle, drawRectangle, drawRoundedRectangle, drawPolysides, loft, revolution, genericSweep, makeHelix, makePolygon, compoundShapes, measureVolume, measureArea, measureLength, DEG2RAD, RAD2DEG }) => {
  return solid;
};
```

Advanced (only with skill section `api-occ-advanced` loaded — freeform surfaces, smooth lofts, variable fillets, raw BRep): `getOC`, `cast`, `downcast`, `iterTopo`, `makeBSplineApproximation`, `makeNonPlanarFace`, `makeOffset`, `localGC`, `GCWithScope`.

Allowed return values:

- a single solid
- `compoundShapes(parts)`
- an array of `{ name: string, shape: Solid }`

Prefer an array of named bodies for furniture, shelving, cabinetry, assemblies, and fabrication-oriented models.

---

## Required Code Header

Place the coordinate convention comment before parameters or geometry.

**Declare the coordinate convention explicitly, then follow it without deviation:**

```js
// X = left to right, Y = back to front, Z = floor to top
```

**If no coordinate system was specified (fast route or no planner), use the platform default:**

```js
// X = width, Y = depth, Z = height
```

These are the axes every Axle verification surface reads (`check_dimensions`,
`target_dimensions`, the sweep-cert bounding box: `width = X, depth = Y, height = Z`).
Never transpose them.

Never invent a coordinate convention. Never omit the comment.

---

## Know Before You Build

When a primitive's placement or behaviour is not confirmed by this document or the lessons, **treat it as unknown — do not guess and assert**. The correct approach: use `makeBox([x1,y1,z1],[x2,y2,z2])` which has fully explicit, unambiguous corner placement, rather than assuming how a centred primitive orients itself.

If you find yourself deriving offsets based on an assumed convention, say so in your `rationale` and verify with `check_dimensions` — rather than silently passing bad geometry.

---

## API Rules

- Destructure all API functions from the first argument of `main`.
- Never reference a global `replicad` object.
- Never write `const { makeBox } = replicad`.
- Use only functions listed in the contract.
- Do not invent functions or methods.
- If using `.rotate()`, pass angle, pivot, and axis: `.rotate(angle, [px, py, pz], [ax, ay, az])`.
- If using `.extrude()`, always pass a distance argument.
- If using boolean cutters, overshoot the target body.

---

## Parameter Rules

- When editing an existing model, reuse its parameter names **exactly** (`get_parameters`) — renaming one silently breaks the user's saved values.
- Declare editable parameters near the top.
- Use mm values only. All dimensions must be plain mm numbers — never multiply by 25.4 or apply any unit conversion inside the code. The Edit tab handles mm→in display automatically.
- Do not convert inches in code.
- **Pick mm values that are clean in the user's dialect.** When their world is inches (`display_units: "in"` from `get_active_context`, or the brief speaks inches), choose inch-native millimetre values for lengths: `19.05` not `18` for 3/4" ply, `38.1` not `40` for a 1-1/2" rail, ranges like `// [12.7:25.4]` not `[12:25]`, `step:1.5875` (1/16"), and add `unit:in`. Example: `const plyThickness = 19.05; // [12.7:25.4] global step:1.5875 unit:in label:"Ply Thickness"`. The panel prints an exact fraction only when the stored value truly is one — 19.05 reads `3/4`, while 18 reads `≈0.709`, because 18mm is a quarter-millimetre off every 64th. The const is STILL millimetres and you still never convert in code; `unit:` names the user's dialect, not the number's. For a metric user (or when `display_units` is absent — that means unknown, not mm), round millimetres are the clean choice and 18 is right.
- **Always declare `unit:` on every dimensional param — `unit:mm` for a metric world, `unit:in` for an inch world.** An undeclared unit forces the panel to GUESS from the name and range, and the guess misreads exactly the params a woodworker adjusts most: an undeclared `backThickness = 18; // [6:25]` renders as a unitless count stepper — raw millimetres, no conversion — in the middle of an inch panel. Counts (`shelfCount`, `openings`) keep `deg`/`%` or nothing as appropriate; everything measured in millimetres declares one. A declared unit is a fact; a name is a guess.
- **A parameter with NO unit must say so: `unit:ratio`.** This is the other half of the rule above and it is the one that is easy to skip, because the number looks harmless. The panel's last-resort guess is "assume millimetres", so a proportion, multiplier or normalized 0–1 position gets CONVERTED: `const doorPosition = 0.35; // [0.15:0.85]` — a fraction of the wall width — displays as `0.014 in`, range `0.007–0.033 in`, to every user working in inches, and the control is unusable. No word list can catch this for you; "this has no unit" is something only the author knows. Write `const doorPosition = 0.35; // [0.15:0.85] global unit:ratio label:"Door Position"`. `ratio | frac | fraction | unitless | none | x | %` are all accepted and all mean *show the number as it is, never convert it, print no unit*. Prefer `unit:ratio`. Rule of thumb: **if multiplying the value by 25.4 would be meaningless, it needs `unit:ratio`.**
- Every editable parameter needs a range annotation exactly like `// [min:max]`, on the same line as a plain `const NAME = NUMBER` declaration. If the value is an expression (e.g. `90.5 * 25.4`) the annotation will not parse and no slider will appear. Negative values and bounds are allowed.
- **The annotation is the switch between "named" and "editable" — decide it per const.** A const *without* a range is still a named, parametric dimension the geometry derives from; it just isn't a user control. Use that for values the shop fixed (`const frontReveal = 3;`, `const footInset = 76;`, kerf, hinge cup depth) and annotate only what a person would actually turn. Aim for roughly three to eight annotated params; above eight Axle warns (`too_many_parameters`), and the fix is always to remove annotations, never to inline the numbers — inlining just trades that warning for `magic_numbers`.
- **Toggles** (on/off features): numeric 0/1 const with the `toggle` marker — `const includeBack = 1; // [0:1] toggle`. In geometry code, test `includeBack !== 0`.
- **Choice parameters** (styles, modes): numeric INDEX const with a `choices:` list — `const roofStyle = 0; // [0:2] choices: gable|flat|shed`. The index range must be `[0:choices.length-1]`. Branch with the index (`roofStyle === 0`) or an array lookup. Every branch must produce valid geometry — sweeps test all of them.
- **Change-class tags** (blast radius — how much recomputes when the slider moves). Optional but valuable: Studio uses them to skip work, and they document intent.
  - **`pose:<jointId>`** — `const doorOpen = 0; // [0:110] pose:door_hinge`. The param drives the named movable joint at render time and editing it skips the rebuild entirely. HARD RULE: the const must NOT be referenced anywhere else in the code — the part builds closed and the joint poses it. If the code reads the const, the tag is ignored and the param rebuilds (slow but correct). Only tag params whose joint actually exists on the model.
  - **`local`** (optionally `local:BodyName|OtherBody`) — `const doorW = 400; // [300:600] local:body_door`. Editing reshapes only the named bodies (names = your body names). Tag a param `local` only when no other body's geometry reads it.
  - **`global`** — `const thickness = 18; // [12:30] global`. Reshapes everything referencing it. This is also the default for untagged params, so tagging it is documentation only.
  - When unsure, leave the param untagged — a wrong `pose`/`local` tag is a correctness bug; untagged is merely slower.
- **Presentation tags** (all optional, appended after the change-class tag, any order — pure UI metadata, they never change geometry). The parameter menu also lets a human edit these, but you can seed them: `step:5` slider granularity · `unit:mm` display unit (`mm`/`in`/`°`/`deg`/`%`/`ratio` — see the unit rules above; this one is not optional in practice) · `label:"Cabinet Width"` human display name (quoted) · `group:"Frame"` collapsible menu group (quoted) · `lock` makes the value read-only. Example: `const width = 800; // [400:1600] global step:10 unit:mm label:"Cabinet Width" group:"Frame"`. Use `group:` to organize when a model has many parameters.
- Every declared editable parameter must be used.
- Put derived dimensions after editable parameters.
- Do not expose or declare raw implementation values as editable unless the schema says so.
- Do not create extra user-facing parameters that are not in the schema.
- If the Planner requires an internal helper value, make it a derived constant without a range annotation.

Example:

```js
const width = 914; // [305:2438]
const height = 1219; // [305:2438]
const depth = 305; // [152:610]
const materialThickness = 19; // [12:38]
const innerWidth = width - materialThickness * 2;
```

---

## Number Rules

Avoid meaningful hardcoded numbers in geometry calls.

Allowed literals in geometry expressions:

- `0`
- `1`
- `-1`
- simple array indexes
- booleans

Name every meaningful:

- dimension
- offset
- radius
- angle
- count
- overshoot
- clearance
- gap
- spacing
- cutter size

---

## Geometry Rules

### Rectangular panels
Use `makeBox`.

### Assemblies
Build separate bodies and return named parts.

### Hollow bodies
Build from individual wall panels whenever practical. Avoid shell-first strategies, especially when openings are needed.

### Openings
Doors, windows, holes, slots, vents, and arches must be real voids. Use boolean cuts or build the parts around the void.

Decorative outlines are not openings.

### Build at origin, translate into position
Build each part at or near the origin, then translate it into its final position. Do not bake world coordinates into box corner arguments — it makes parametric math fragile.

```js
// Good
const shelf = makeBox([0, 0, 0], [depth, width, thickness]).translateZ(shelfZ);

// Bad — final position baked into corners
const shelf = makeBox([0, wallT + offset, 0], [depth, wallT + offset + width, thickness]);
```

### EXCEPTION — DAE file reconstruction

When a `[DAE FILE: ...]` is present in the file context, you are reconstructing existing geometry. In this case:

- **Use `makeBox([minX, minY, minZ], [maxX, maxY, maxZ])` directly** with the exact mm bbox coordinates from the file context for each part.
- Do NOT build at origin and translate — the bbox positions ARE the parametric positions.
- Convert the bbox values to named constants first, then use them in makeBox:

```js
// DAE reconstruction — use exact bbox positions
const leftLegX1 = 0, leftLegX2 = 50.8;   // from DAE: X 0"–2" → 0–50.8mm
const leftLegY1 = 0, leftLegY2 = 304.8;
const leftLegZ1 = 0, leftLegZ2 = 304.8;
const left_leg = makeBox([leftLegX1, leftLegY1, leftLegZ1], [leftLegX2, leftLegY2, leftLegZ2]);
```

- Expose the key dimensions (overall width, height, depth, thickness) as editable parameters with `// [min:max]`
- Derive the bbox coordinates from those parameters so the model stays parametric
- The coordinate system in the DAE file uses X/Y/Z as output by ColladaLoader — map directly, do not reinterpret axes
- **Resolve bbox overlaps before building.** In SketchUp, parts often share faces or slightly overlap at junctions. Before generating geometry, inspect all part bboxes for overlapping ranges on any axis. Where two parts overlap, trim the secondary part to stop exactly at the primary part's face. The primary part is typically the larger/structural one. Never let two parts occupy the same volume.

### Boolean cutters
Cutters must extend beyond both faces being cut. Use a named overshoot constant.

### Sequential boolean cuts on stacked geometry
Cutting the same cutter through multiple separate bodies one at a time is fragile. Fuse the bodies first, then cut once.

### Repeated cuts in a loop (e.g. grooves, slots, holes in a pattern)
Never call `.cut()` in a loop with individual cutters — this causes OCC errors or silent blank output on complex geometry. Instead, build all cutters into an array and fuse them with `compoundShapes`, then cut once:
```js
const cutters = [];
for (let i = 0; i < n; i++) cutters.push(makeBox(...));
return panel.cut(compoundShapes(cutters));
```

```js
// Fragile
const panels = positions.map(z => makeBox(...).translateZ(z));
const cut = panels.map(p => p.cut(cutter)); // any one can fail

// Reliable
const stack = panels.reduce((a, b) => a.fuse(b));
const result = stack.cut(cutter);
```

### Gables, arches, sloped roofs, and irregular profiles
Use `Sketcher` or the planner-approved profile strategy.

### Repeated elements
Loops are allowed only when names and geometry remain clear. Generate deterministic names.

### No intersecting geometry
Parts must never overlap in volume. Every part must start exactly where the adjacent part ends — shared faces are allowed, shared volume is not.

**General rule:** when part B is adjacent to part A, part B's boundary must be derived from part A's face position, never guessed or duplicated from part A's origin.

Common failure patterns to avoid:
- A back panel that starts at the seat's bottom Z instead of the seat's **top face** (`seatH + seatThick`)
- Legs that extend into a tabletop or seat instead of terminating at its **bottom face**
- A stretcher or rail whose end coordinate passes through a leg instead of stopping at the leg's inner face
- Vertical dividers that sit on a horizontal shelf must start at the shelf's **top face**, not at the shelf's center Z
- Horizontal boards that run to a vertical divider must end at the divider's **face**, not pass through it
- In ratio-based layouts: derive `zTopFace = zCenter + thickness / 2` and `zBottomFace = zCenter - thickness / 2`, use these as trim points for adjacent parts

Before returning, mentally trace each junction: if two parts touch, confirm one ends exactly where the other begins.

### Decorative groups — compound, don't fuse
Booleans are the expensive part of a build. When a part is a GROUP of members that
only need to look adjacent — a lattice, a slat screen, spindles, battens — return
`makeCompound([...])` instead of chaining `.fuse()`. Same picture, same bounding
box, typically 3× faster. Fuse only when the result must be one manufactured body.

⚠ Clip each member BEFORE compounding. `.intersect()` on a compound silently uses
only one of its solids and returns a wrong shape without throwing:
`makeCompound(members.map(m => m.intersect(clip)))`, never
`makeCompound(members).intersect(clip)`.

### Fabrication models
If the object is intended for fabrication, keep meaningful parts separate rather than merging everything.

---

## Named Body Rules

For assemblies, return named bodies like:

```js
return [
  { name: "Left Side Panel", shape: leftSidePanel },
  { name: "Right Side Panel", shape: rightSidePanel },
  { name: "Top Panel", shape: topPanel }
];
```

Name bodies the way the user would name them — a person reading the parts list should recognise each one.

Good names:

- Left Side Panel
- Right Side Panel
- Top Panel
- Bottom Panel
- Back Panel
- Shelf 1
- Vertical Divider
- Door
- Drawer Front
- Toe Kick
- Roof
- Front Wall

Bad names:

- Part 1
- Box 2
- Shape A
- Thing

---

## Stability Rules

Avoid strategies known to fail often:

- shelling a solid and then cutting openings
- shallow cutters that barely touch faces
- zero-thickness geometry
- parts that become negative or inverted at parameter limits
- derived dimensions that collapse to zero or negative — add a guard before building any shape whose size is derived: `if (innerWidth <= 0) throw new Error("...")`
- ordering constraints between multiple editable parameters — **do not throw**, clamp instead. If `divA_y` and `divB_y` are both user-adjustable and must satisfy `divA_y < divB_y`, enforce it silently: `const safeDivB_y = Math.max(divA_y + minGap, divB_y);`. Throwing on slider adjustment breaks the interactive editing experience.
- booleans with coincident faces when avoidable
- rotated boxes where a Sketcher profile would be clearer
- unsupported use of unavailable Replicad methods

If the design requires geometry the API cannot express, do not fake it. Say so.

---

## Say So Instead Of Faking Success

If what the user asked for cannot be built reliably with the available API, **tell them** — in plain language, in the conversation. Then either propose an approach that *is* buildable, or ask the one question that unblocks you.

- Push best-effort code only if it is genuinely safe and you have said what is missing.
- Record the limitation in your `rationale` so it survives the session.
- Never output placeholder bodies or decorative substitutes for real openings.

A model that quietly pretends to be finished is worse than one that admits what it couldn't do.

---

## Code Completeness

`code` must be complete, runnable JavaScript — never an ellipsis, a `// rest of code here`, or a placeholder body. A fragment overwrites the model before any verdict comes back.

---

## Handing Your Work To Axle

You don't return JSON to anyone. You call a tool:

`push_model_code({ model_id, code, param_schema, rationale })`

- `code` — the complete replicad source; Axle runs it server-side immediately
- `param_schema` — an **array** of parameter objects, with min/max ranges (Studio renders live sliders from these). See `pipeline-param-designer` for the item shape.
- `rationale` — **required.** Why you built it this way. Axle never sees your conversation, so this is the only record of your reasoning that survives.

The push returns the build verdict — read it; it is the source of truth. Only a *pending* verdict needs `get_build_status`. Never conclude "it worked" from a screenshot.

---

## Final Self-Check

Axle machine-checks the mechanical rules on every push and returns violations with the verdict — don't re-verify those, read it. What only you can check:

- Is the coordinate comment present, and did the geometry actually follow it?
- Is every editable parameter used, and every meaningful number named?
- Are openings real voids, and do cutters overshoot both faces?
- Are there no invented methods — only functions from the contract?
- Does each part's boundary derive from its neighbour's face? (Trace each junction.)
- If a DAE file was provided: exact mm bbox coordinates per part, parameters derived from them, overlaps trimmed to the primary part's face?
