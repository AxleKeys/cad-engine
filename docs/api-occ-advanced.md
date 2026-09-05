# Raw OpenCascade / BRep — Advanced API

Load this section ONLY when the design needs geometry replicad's wrapper cannot express:
freeform/curved surfaces, lofts with continuity control, variable-radius fillets,
surface healing, or exact clearance measurement. For boxes, panels, sketches,
standard lofts/sweeps and uniform fillets, stay in the normal replicad API — it is
simpler and far more robust.

Everything in this file is verified against the WASM build shipped in Studio
(`replicad-opencascadejs`, 242 classes). Do not use OCC classes not listed here —
the build is a subset of full OCCT and missing classes are `undefined` at runtime.

---

## First Choice: replicad's Advanced Helpers (no raw OCC needed)

These are available in the `api` object and cover most "beyond boxes" needs:

```js
makeBSplineApproximation(points, { tolerance, smoothing, degMax, degMin })
// [x,y,z] points → smooth Edge (B-spline). Build organic profiles/spines from data.

makeNonPlanarFace(wire)          // closed non-planar wire → filled face (n-sided patch)
loft([wire1, wire2, ...], { ruled: false })   // smooth loft (ruled: true = straight)
genericSweep(wire, spineWire, { frenet, transitionMode: "round" })
makeOffset(face, offset)         // thicken a face into a solid
iterTopo(shape.wrapped, "edge")  // iterate raw sub-topology: "vertex"|"edge"|"wire"|"face"|"shell"|"solid"
cast(topoDSShape)                // raw OCC TopoDS_Shape → replicad shape (THE way back)
getOC()                          // the raw OCC namespace
```

Typical organic pattern with zero raw OCC:
```js
const profiles = heights.map((z, i) => {
  const pts = ringPoints(radii[i], z);           // your parametric point rings
  return assembleWire([makeBSplineApproximation(pts, { tolerance: 0.01 })]);
});
const body = loft(profiles, { ruled: false });
```

---

## Calling Conventions (Embind) — read before writing any raw OCC

1. **Constructor overloads are numbered classes**: `new oc.gp_Pnt_3(x, y, z)`,
   `new oc.BRepBuilderAPI_MakeFace_8(surfHandle, tol)`. The suffix is the 1-based
   position in the overload list. Single-constructor classes have NO suffix:
   `new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6)`.
2. **Method overloads use suffixes too**: `fillet.Add_2(radius, edge)`,
   `analyzer.IsValid_2()`. Unsuffixed methods have one signature.
3. **All arguments are required** — Embind has no default parameters. Pass every arg.
4. **Enums**: `oc.GeomAbs_Shape.GeomAbs_C2`, `oc.ChFi3d_FilletShape.ChFi3d_Rational`.
5. **Handles** (`Handle_Geom_Surface` etc.) wrap reference-counted objects. Dereference
   with `.get()`. To upcast a derived handle:
   `new oc.Handle_Geom_Surface_2(bsplineSurfHandle.get())`.
6. **Every `Build()` / `Perform()` takes a progress range** — always pass
   `new oc.Message_ProgressRange_1()`.
7. **Bridge**: replicad shape → raw: `shape.wrapped`. Raw → replicad: `cast(raw)`.
   After `cast`, the result meshes/renders/booleans like any replicad shape.

## Hard Rules

- **Raw OCC builders run ONCE per execution.** Build a shape once, then `.clone()`
  the replicad-cast result for copies. Re-running a builder throws.
- **WASM memory is not garbage collected.** Wrap intermediates:
  ```js
  const [r, gc] = localGC();
  const builder = r(new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6));
  // ... use it, cast() the final Shape() ...
  gc();   // frees everything registered with r()
  ```
- **Validate before returning** (raw construction can produce invalid solids that
  crash meshing): see Recipe R5.
- Wires fed to OCC must be `.wrapped` (raw `TopoDS_Wire`), not replicad objects.

---

## Recipes (verified against this build)

### R1 — Smooth loft with continuity control
replicad's `loft` exposes only `ruled`. For C2-smooth lofts through many sections:
```js
const oc = getOC();
const [r, gc] = localGC();
const lofter = r(new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6)); // solid, smooth
lofter.SetSmoothing(true);
lofter.SetContinuity(oc.GeomAbs_Shape.GeomAbs_C2);
lofter.SetMaxDegree(8);
lofter.CheckCompatibility(false);
wires.forEach(w => lofter.AddWire(w.wrapped));
lofter.Build(r(new oc.Message_ProgressRange_1()));
const solid = cast(lofter.Shape());
gc();
```
Failure modes: mismatched wire edge counts (keep section point counts identical),
self-intersecting sections, sections diverging too fast.

### R2 — Freeform B-spline surface from a point grid → solid
The true surface-modeling path: heightfields, car-body panels, terrain, shells.
```js
const oc = getOC();
const [r, gc] = localGC();
const rows = 5, cols = 5;
const grid = r(new oc.TColgp_Array2OfPnt_2(1, rows, 1, cols));
for (let i = 1; i <= rows; i++)
  for (let j = 1; j <= cols; j++)
    grid.SetValue(i, j, r(new oc.gp_Pnt_3(x(i,j), y(i,j), z(i,j)))); // your parametric grid

const apprx = r(new oc.GeomAPI_PointsToBSplineSurface_2(
  grid, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1e-3));   // degMin, degMax, continuity, tol
const surfHandle = r(new oc.Handle_Geom_Surface_2(apprx.Surface().get()));

const faceBuilder = r(new oc.BRepBuilderAPI_MakeFace_8(surfHandle, 1e-6));
const face = cast(faceBuilder.Face());
gc();
const panel = makeOffset(face, thickness);   // thicken to a solid (replicad helper)
```
For an interpolating (pass-through-points) surface use
`apprx.Interpolate_1(grid, false)` on a default-constructed `_1` instance instead.

### R3 — Variable-radius fillet
replicad's `.fillet()` is constant-radius only. Raw gives evolving radii:
```js
const oc = getOC();
const [r, gc] = localGC();
const mf = r(new oc.BRepFilletAPI_MakeFillet(
  solid.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational));
for (const e of iterTopo(solid.wrapped, "edge")) {
  // select edges by your own test (e.g. via BRep_Tool / bounding), then:
  mf.Add_3(rStart, rEnd, e);     // radius evolves linearly rStart → rEnd along edge
  // or mf.Add_2(radius, e)      — constant (same as replicad)
  // or mf.Add_5(uAndRArray, e)  — full (param, radius) profile, TColgp_Array1OfPnt2d
}
mf.Build(r(new oc.Message_ProgressRange_1()));
if (!mf.IsDone()) throw new Error("Variable fillet failed — reduce radii");
const result = cast(mf.Shape());
gc();
```
Safe-radius rule still applies: max radius < half the smallest adjacent wall.

### R4 — Sew faces into a closed solid
For solids assembled from independently built faces (R2 panels, filled patches):
```js
const oc = getOC();
const [r, gc] = localGC();
const sewer = r(new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false));
faces.forEach(f => sewer.Add(f.wrapped));
sewer.Perform(r(new oc.Message_ProgressRange_1()));
const sewn = cast(sewer.SewedShape());          // → Shell if faces close up
const fixer = r(new oc.ShapeFix_Solid_1());
const solid = cast(fixer.SolidFromShell(sewn.wrapped));
gc();
```
Faces must share boundaries within tolerance, or you get an open shell —
check with R5 before returning.

### R5 — Validity check & exact clearance (use after any raw construction)
```js
const oc = getOC();
const [r, gc] = localGC();
const check = r(new oc.BRepCheck_Analyzer(solid.wrapped, true, false));
if (!check.IsValid_2()) throw new Error("Invalid BRep — do not return this solid");

// Exact min distance between two parts (clearance/interference verification):
const dist = r(new oc.BRepExtrema_DistShapeShape());
dist.LoadS1(partA.wrapped); dist.LoadS2(partB.wrapped);
dist.Perform(r(new oc.Message_ProgressRange_1()));
const clearance = dist.Value();   // 0 = touching/intersecting
gc();
```

### R6 — Heal geometry after heavy booleans
Many sequential booleans fragment faces and slow everything downstream:
```js
const oc = getOC();
const [r, gc] = localGC();
const unify = r(new oc.ShapeUpgrade_UnifySameDomain_2(shape.wrapped, true, true, false));
unify.Build();
const healed = cast(unify.Shape());
gc();
```
(replicad's `.simplify()` wraps this — prefer it; use raw only to control tolerances
via `SetLinearTolerance` / `SetAngularTolerance` before `Build()`.)

---

## Available Class Map (what else is in this build)

| Area | Classes |
|---|---|
| Curves from data | `GeomAPI_PointsToBSpline`, `GeomAPI_Interpolate`, `Geom_BezierCurve`, `Geom_BSplineCurve` |
| Surfaces | `Geom_BSplineSurface`, `GeomAPI_PointsToBSplineSurface`, `Geom_CylindricalSurface`, `Geom_ConicalSurface`, `Geom_SphericalSurface`, `GeomAPI_ProjectPointOnSurf` |
| Topology build | `BRepBuilderAPI_MakeEdge/Wire/Face/Shell/Solid/Vertex`, `BRepBuilderAPI_Sewing`, `BRepBuilderAPI_Transform` |
| Sweeps/offsets | `BRepOffsetAPI_ThruSections`, `MakePipeShell` (+`Law_Linear/S/Interpol/Composite` evolution laws), `MakePipe`, `MakeThickSolid`, `MakeOffsetShape`, `MakeFilling`, `DraftAngle` |
| Features | `BRepFeat_MakeDPrism` (drafted pockets/bosses), `BRepFilletAPI_MakeFillet/MakeChamfer` |
| Healing/checks | `ShapeFix_Wire/Face/Solid/EdgeConnect`, `ShapeUpgrade_UnifySameDomain`, `BRepCheck_Analyzer` |
| Measurement | `BRepExtrema_DistShapeShape`, `BRepGProp`+`GProp_GProps` (mass properties), `Bnd_Box`/`Bnd_OBB` |
| Foundations | `gp_Pnt/Dir/Vec/Ax1/Ax2/Ax3/Pln/Trsf`, `TColgp_Array1OfPnt/Array2OfPnt`, `TopExp_Explorer`, `TopoDS_*` |

NOT in this build (do not attempt): `BRepPrimAPI_MakeCone`, `GeomFill_*`,
`BRepOffsetAPI_MakeEvolved`, `ChFi2d_*`, anything XDE beyond STEP read/write.

---

## When Raw OCC Is the Wrong Answer

- Plate/panel furniture, enclosures, brackets → normal replicad, always.
- A single curved profile → `Sketcher` with arcs/beziers, extrude or revolve.
- A standard loft or sweep → replicad `loft` / `genericSweep`.
- Uniform fillets/chamfers → replicad `.fillet()` / `.chamfer()` with finders.
- If a raw recipe fails twice, do not iterate blindly — replan the geometry strategy
  with simpler primitives and note the limitation.
