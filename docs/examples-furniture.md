# Verified Examples — Furniture & Panel Construction

Complete, runner-verified models. Every example builds cleanly and survives its full
parameter sweep (all slider extremes and pairwise corners). Imitate the *structure*:
named parameters with ranges, derived dimensions, parts that butt against adjacent
faces (never overlap), descriptive body names.

## The route (the Build Loop for this class)

Massing (the envelope at target dims) → structure (shells and partitions as named
parts) → joinery/features → refinement + proof. **Probes dominate this class — `measure`
is king**: flush/gap/engagement between panel pairs answers almost everything, and looks
are rare. Verify each pass with the verdict and `measure`; screenshot only when
proportions or support need an eye. `certify_model` across the ranges closes it.

---

## Bookshelf — sides + spanning panels + shelf loop

Demonstrates: count parameter driving a loop, panels derived from the sides' inner
faces, even spacing math that survives every count/height combination.

**Reach this in passes.** Push the envelope first (one box at the overall size) and
prove it with `check_dimensions`; then the sides and spanning panels; then the shelf
loop and any joinery. Read the build verdict between passes — it prints every part's
size and position — and `measure` a shelf against a side to confirm they share a face
rather than overlap. A derivation error in the spacing math shows up at the pass that
introduced it, instead of as a mystery once the whole model exists.

```js
// X = width, Y = depth, Z = height
const width = 800; // [400:1600]
const height = 1200; // [600:2000]
const depth = 300; // [200:450]
const thickness = 18; // [12:30]
const shelfCount = 3; // [1:6]

const main = ({ makeBaseBox }) => {
  const innerWidth = width - 2 * thickness;
  const innerHeight = height - 2 * thickness;
  const sideX = width / 2 - thickness / 2;

  const leftSide = makeBaseBox(thickness, depth, height).translate(-sideX, 0, 0);
  const rightSide = makeBaseBox(thickness, depth, height).translate(sideX, 0, 0);
  const bottom = makeBaseBox(innerWidth, depth, thickness);
  const top = makeBaseBox(innerWidth, depth, thickness).translateZ(height - thickness);

  const parts = [
    { name: "Left Side", shape: leftSide },
    { name: "Right Side", shape: rightSide },
    { name: "Bottom Panel", shape: bottom },
    { name: "Top Panel", shape: top },
  ];

  const gap = innerHeight / (shelfCount + 1);
  for (let i = 1; i <= shelfCount; i++) {
    const shelfZ = thickness + gap * i - thickness / 2;
    parts.push({ name: `Shelf ${i}`, shape: makeBaseBox(innerWidth, depth, thickness).translateZ(shelfZ) });
  }
  return parts;
};
```

Key moves: shelves span `innerWidth` so they SHARE FACES with the sides (never
overlap); the spacing formula divides `innerHeight` so shelves can never collide
with top/bottom at any parameter combination.

⚠ **`shelfCount` is SHELVES, and N shelves make N+1 openings.** A brief almost always
counts openings ("three openings", "two cubbies"), so copying this example with
`shelfCount = 3` for a three-opening ask silently yields FOUR. Read the ask, then set
`shelfCount = openings - 1` — or parameterise on `openings` directly and derive the shelf
count from it, which keeps the slider labelled the way the user thinks. (Found by a cold
driver doing exactly this, 2026-08-08.)

---

## Side Table — legs terminate at the top's underside

Demonstrates: the derive-from-faces rule. The legs' height is `height - topThickness`
— computed from the top's bottom face, never guessed.

```js
// X = width, Y = depth, Z = height
const topSize = 450; // [300:800]
const topThickness = 25; // [15:40]
const height = 500; // [350:700]
const legSize = 40; // [25:60]
const legInset = 20; // [10:50]

const main = ({ makeBaseBox }) => {
  const legHeight = height - topThickness;          // legs stop at top's underside
  const legCenter = topSize / 2 - legInset - legSize / 2;

  const top = makeBaseBox(topSize, topSize, topThickness).translateZ(legHeight);

  const parts = [{ name: "Top", shape: top }];
  const corners = [
    [legCenter, legCenter], [legCenter, -legCenter],
    [-legCenter, legCenter], [-legCenter, -legCenter],
  ];
  corners.forEach(([x, y], i) => {
    parts.push({ name: `Leg ${i + 1}`, shape: makeBaseBox(legSize, legSize, legHeight).translate(x, y, 0) });
  });
  return parts;
};
```

---

## Garden Shed Module — toggle + style choices (topology switching)

Demonstrates: the toggle and choices parameter grammar. Every branch must produce
valid geometry — sweeps test all of them.

```js
// X = width, Y = depth, Z = height
const size = 300; // [200:600]
const includeBack = 1; // [0:1] toggle
const roofStyle = 0; // [0:2] choices: gable|flat|shed

const main = ({ makeBaseBox, Sketcher }) => {
  const t = 15;
  const parts = [{ name: "Base", shape: makeBaseBox(size, size, t) }];

  if (includeBack !== 0) {
    // the back wall faces +Y (toward the wall), so it is thin in Y
    parts.push({ name: "Back Panel", shape: makeBaseBox(size, t, size).translate(0, size / 2 - t / 2, t) });
  }

  const roofZ = t + size;
  // the front elevation is the XZ plane; the roof extrudes back through +Y (depth)
  if (roofStyle === 0) {
    const gable = new Sketcher("XZ", -size / 2)
      .movePointerTo([-size / 2, roofZ]).lineTo([0, roofZ + 80]).lineTo([size / 2, roofZ]).close()
      .extrude(size);
    parts.push({ name: "Roof", shape: gable });
  } else if (roofStyle === 1) {
    parts.push({ name: "Roof", shape: makeBaseBox(size, size, t).translateZ(roofZ) });
  } else {
    const shed = new Sketcher("XZ", -size / 2)
      .movePointerTo([-size / 2, roofZ]).lineTo([-size / 2, roofZ + 60]).lineTo([size / 2, roofZ]).close()
      .extrude(size);
    parts.push({ name: "Roof", shape: shed });
  }
  return parts;
};
```

Key moves: toggles are numeric 0/1 with `// [0:1] toggle`; style choices are an
index const with `// [0:2] choices: a|b|c`; required parts (Base) are unconditional,
only optional parts live inside guards.
