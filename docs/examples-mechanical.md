# Verified Examples — Mechanical & Printable Parts

Complete, runner-verified models (full parameter sweep at all extremes). The lessons
of this file: boolean ORDER (fuse solids first, cut last, finish last), cutters that
overshoot, clearance as a named parameter, edge finishing.

## The route (the Build Loop for this class)

Profile-first (sketch → extrude) → hole patterns → fillets/chamfers LAST. Verify with
`check_dimensions` and `measure` on hole/feature positions; when a look is needed,
**orthographic front/side shots beat iso** for this class — faces and hole patterns
read exactly, not in perspective.

---

## Electronics Enclosure — hollowed body + lipped lid

Demonstrates: hollowing with an overshooting cavity cutter (NOT `.shell()`),
directional cylinder holes through a wall, a lid lip sized from the cavity minus a
named clearance.

**Build it in passes, and put the fillets last.** Push the outer body at its stated
size and prove it with `check_dimensions`; then the cavity; then the holes; then
edge finishing. Read the build verdict between passes — a boolean that consumed the
wrong solid shows up as a changed part count immediately, whereas the same mistake
found after filleting is a rewrite. For this class an **orthographic front or side**
shot reads hole patterns exactly where an iso view will not.

```js
// X = width, Y = depth, Z = height
const width = 120; // [60:200]
const depth = 80; // [50:150]
const height = 40; // [25:80]
const wall = 2.5; // [1.5:5]
const holeDiameter = 8; // [4:12]

const main = ({ makeBaseBox, makeCylinder }) => {
  const overshoot = 1;
  const cavityW = width - 2 * wall;
  const cavityD = depth - 2 * wall;

  const outer = makeBaseBox(width, depth, height);
  const cavity = makeBaseBox(cavityW, cavityD, height - wall + overshoot)
    .translateZ(wall);
  let body = outer.cut(cavity);

  const holeZ = Math.min(height / 2, wall + holeDiameter / 2 + 1);
  const holeY = depth / 4;
  for (const y of [holeY, -holeY]) {
    const hole = makeCylinder(
      holeDiameter / 2,
      wall + 2 * overshoot,
      [width / 2 - wall - overshoot, y, holeZ],
      [1, 0, 0]
    );
    body = body.cut(hole);
  }

  const lidThickness = wall;
  const clearance = 0.4;
  const lipHeight = Math.min(5, height / 4);
  const plate = makeBaseBox(width, depth, lidThickness);
  const lip = makeBaseBox(cavityW - 2 * clearance, cavityD - 2 * clearance, lipHeight)
    .translateZ(-lipHeight);
  const lid = plate.fuse(lip).translateZ(height + 10 + lipHeight);

  return [
    { name: "Body", shape: body },
    { name: "Lid", shape: lid },
  ];
};
```

Key moves: `makeCylinder(r, h, location, direction)` drills through a wall along X;
every cutter overshoots both faces by a named `overshoot`; mating parts get a named
`clearance` (0.2–0.5mm for FDM printing); the lid is displayed offset above the body.

---

## L-Bracket — fuse → cut → finish, with an EdgeFinder chamfer

Demonstrates: the canonical operation order (fuse solids FIRST, cut holes SECOND,
fillet/chamfer LAST), and edge selection with finders.

```js
// X = width, Y = depth, Z = height
const bracketWidth = 50; // [30:90]
const legA = 80; // [50:150]   horizontal reach, along Y (depth)
const legB = 60; // [40:120]   vertical leg, along Z
const thickness = 5; // [3:10]
const holeDiameter = 6; // [4:10]

const main = ({ makeBaseBox, makeCylinder }) => {
  const overshoot = 1;

  const base = makeBaseBox(bracketWidth, legA, thickness);
  const upright = makeBaseBox(bracketWidth, thickness, legB)
    .translate(0, -legA / 2 + thickness / 2, 0);
  let bracket = base.fuse(upright);

  const holeR = holeDiameter / 2;
  const insetA = Math.max(legA * 0.15, holeR + 2);
  const xOff = bracketWidth / 4;
  const baseHole = (x, y) =>
    makeCylinder(holeR, thickness + 2 * overshoot, [x, y, -overshoot], [0, 0, 1]);
  const uprightHole = (x, z) =>
    makeCylinder(holeR, thickness + 2 * overshoot, [x, -legA / 2 - overshoot, z], [0, 1, 0]);

  bracket = bracket
    .cut(baseHole(xOff, legA / 2 - insetA))
    .cut(baseHole(-xOff, legA / 2 - insetA))
    .cut(uprightHole(xOff, legB - Math.max(legB * 0.15, holeR + 2)))
    .cut(uprightHole(-xOff, legB - Math.max(legB * 0.15, holeR + 2)));

  const ch = Math.min(1.5, thickness / 3);
  bracket = bracket.chamfer(ch, (e) =>
    e.either([
      (f) => f.inPlane("YZ", bracketWidth / 2),
      (f) => f.inPlane("YZ", -bracketWidth / 2),
    ]).ofCurveType("LINE")
  );

  return [{ name: "Bracket", shape: bracket }];
};
```

Key moves: hole insets are guarded (`Math.max(..., holeR + 2)`) so holes never break
out of an edge at parameter extremes; the chamfer size derives from thickness
(`Math.min(1.5, thickness / 3)`) so finishing never exceeds the material — **chamfer
is far more robust than fillet in OCC; prefer it when either would do.**
