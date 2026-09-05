# Verified Examples — Curved & Organic Forms

Complete, runner-verified models (full parameter sweep at all extremes). The lesson
of this file: curved forms come from **revolved profiles** and **lofts through
sections** — not from boolean-carving boxes.

## The route (the Build Loop for this class)

The vision-heavy class — a build verdict cannot judge the fairness of a curve. Take
smaller steps and allow **one look per loft or sweep**; use a wireframe screenshot for
section sanity, and this is the class where `capture_turntable` genuinely earns its
cost. Probes still come first for anything dimensional.

---

## Hollow Vase — revolve the wall cross-section

Demonstrates: hollow body WITHOUT `.shell()` (revolve the wall's closed
cross-section: outer curve up, across the rim, inner curve back down). Spline
tangents pinned vertical at both ends of every segment — unpinned splines
self-intersect at extreme height/radius ratios.

**Take smaller passes here, and look more often than you would elsewhere.** A build
verdict can tell you a revolve succeeded; it cannot tell you the curve is fair, so
this is the one class where a screenshot per loft or sweep earns its cost. Push the
profile, prove the envelope with `check_dimensions`, then look before adding the
next feature — a self-intersecting spline builds clean and reads wrong only to an
eye. A wireframe shot is the cheapest way to sanity-check a section.

```js
// X = width, Y = depth, Z = height
const height = 180; // [100:300]
const baseRadius = 40; // [25:60]
const neckRadius = 20; // [12:35]
const rimRadius = 30; // [15:45]
const wall = 3; // [2:6]

const main = ({ Sketcher }) => {
  const neckZ = height * 0.75;
  const innerNeck = Math.max(neckRadius - wall, 4);
  const innerBase = Math.max(baseRadius - wall, 6);
  const profile = new Sketcher("XZ", 0)
    .movePointerTo([baseRadius, 0])
    .smoothSplineTo([neckRadius, neckZ], { startTangent: [0, 1], endTangent: [0, 1] })
    .smoothSplineTo([rimRadius, height], { startTangent: [0, 1], endTangent: [0, 1] })
    .hLine(-wall)
    .smoothSplineTo([innerNeck, neckZ], { startTangent: [0, -1], endTangent: [0, -1] })
    .smoothSplineTo([innerBase, wall], { startTangent: [0, -1], endTangent: [0, -1] })
    .lineTo([0, wall])
    .vLineTo(0)
    .close();
  return profile.revolve([0, 0, 1]);
};
```

Key moves: the profile is a CLOSED wall section so the result is watertight and
printable; `Math.max(... , 4)` guards keep the inner wall off the axis at every
parameter combination; **always pin both spline tangents** in revolve profiles.

---

## Pendant Lampshade — smooth loft through circular sections

Demonstrates: `makeCircle` → `assembleWire` → `loft` with `ruled: false` for a
smooth (not faceted) transition. Add more rings for more profile control.

```js
// X = width, Y = depth, Z = height
const height = 200; // [120:350]
const topRadius = 50; // [30:80]
const waistRadius = 70; // [40:110]
const bottomRadius = 90; // [50:140]

const main = ({ makeCircle, assembleWire, loft }) => {
  const ring = (r, z) => assembleWire([makeCircle(r, [0, 0, z], [0, 0, 1])]);
  const sections = [
    ring(bottomRadius, 0),
    ring(waistRadius, height * 0.5),
    ring(topRadius, height),
  ];
  return loft(sections, { ruled: false });
};
```

Key moves: every section is a closed wire on its own Z plane; section point counts
stay compatible automatically because they are all circles. For non-circular lofts,
keep the same vertex count in every section.

---

## When to use what

| Form | Tool |
|---|---|
| Surface of revolution (vase, knob, bowl, leg) | `Sketcher` profile → `.revolve()` |
| Smooth transition between cross-sections | `loft([...wires], { ruled: false })` |
| Profile swept along a path (handle, rail) | `genericSweep(profileWire, spineWire)` |
| Organic profile from data points | `makeBSplineApproximation(points)` → wire |
| Freeform surface / variable fillets / C2 lofts | load skill section `api-occ-advanced` |
