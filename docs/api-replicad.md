# Replicad API Master Reference

---

## Studio File Format

```js
const main = ({ makeBox, makeCylinder, Sketcher, draw, compoundShapes, ... }) => {
  // destructure only what you need from the first argument
  return solid; // or [{ name, shape }] or compoundShapes(parts)
};
```

**Critical:** Destructure directly from the first argument — never `const { makeBox } = replicad`.

---

## Primitive Functions

```js
makeBox([x1,y1,z1], [x2,y2,z2])              // box between two corner points — explicit, unambiguous
makeBaseBox(xLen, yLen, zLen)                  // box by dimensions: X/Y centred at origin, Z sits on Z=0 (spans [0, zLen])
makeCylinder(radius, height)                   // upright cylinder, base at Z=0, centred on X/Y origin
makeCylinder(radius, height, location, dir)    // positioned; location & dir are [x,y,z] Points
makeSphere(radius)                             // sphere centred at origin
makeEllipsoid(aLength, bLength, cLength)       // three independent radii along X/Y/Z
```

**`makeBaseBox` placement:** X and Y are centred (`[-xLen/2, xLen/2]`); Z is NOT centred — it sits on Z=0 (`[0, zLen]`). Use `makeBox` when you need fully explicit corner placement.

---

## Boolean Operations

```js
solid.fuse(other)       // union
solid.cut(tool)         // difference (subtract tool from solid)
solid.intersect(tool)   // intersection
```

---

## Transforms

```js
solid.translate(x, y, z)
solid.translateX(d) / .translateY(d) / .translateZ(d)

// rotate: angleDeg in degrees, second arg is pivot POINT, third is axis DIRECTION
solid.rotate(angleDeg, [pivotX, pivotY, pivotZ], [axisX, axisY, axisZ])
// e.g. 45° around Y axis through origin:
solid.rotate(45, [0, 0, 0], [0, 1, 0])

solid.scale(factor, center?)
solid.mirror("XY" | "XZ" | "YZ", origin?)
```

**Common mistake:** `.rotate(90, [1,0,0])` sets the PIVOT to [1,0,0], not the axis. Always pass both pivot and axis.

---

## Modifications

```js
solid.fillet(radius, edgeFilter?)    // round edges; no filter = all edges
solid.chamfer(size, edgeFilter?)     // chamfer edges

// Hollow a solid — removes the matched face, creates walls of given thickness
solid.shell(thickness, faceFilter?)
// e.g. hollow a box removing the top face:
box.shell(wallThickness, (f) => f.inPlane("XY", boxHeight))

solid.draft(angle, faceFinder, neutralPlane)  // draft angle for moulding
solid.simplify()                               // remove redundant edges after booleans
```

**Warning:** `.shell()` is unreliable when followed by `.cut()` on the same body — can produce degenerate topology. Build hollow bodies from individual wall panels instead. See Lessons file.

---

## EdgeFinder & FaceFinder

Used as filter arguments in `.fillet()`, `.chamfer()`, `.shell()`, `.draft()`.

```js
// EdgeFinder examples
solid.fillet(3, (e) => e.inDirection("Z"))           // all Z-aligned edges
solid.fillet(3, (e) => e.inPlane("XY", 0))           // edges in bottom plane
solid.fillet(3, (e) => e.containsPoint([x,y,z]))      // edge through point
solid.fillet(3, (e) => e.ofLength(25))                // edges of exact length
solid.fillet(3, (e) => e.ofCurveType("LINE"))         // straight edges only
solid.fillet(3, (e) => e.not(f => f.inDirection("Z")))           // all except Z
solid.fillet(3, (e) => e.and([f => f.inPlane("XY",0), f => f.ofLength(l)]))
solid.fillet(3, (e) => e.either([f => f.inDirection("X"), f => f.inDirection("Y")]))

// FaceFinder examples
solid.shell(5, (f) => f.inPlane("XY", height))        // top face
solid.shell(5, (f) => f.inPlane("XZ", 0))             // front face
solid.shell(5, (f) => f.containsPoint([x,y,z]))       // face containing point
solid.shell(5, (f) => f.ofSurfaceType("PLANE"))       // planar faces only
```

### EdgeFinder methods

| Method | Notes |
|---|---|
| `.inDirection("X"\|"Y"\|"Z")` | Edges aligned to axis |
| `.inPlane(name, origin?)` | Edges lying in a named plane |
| `.parallelTo(plane)` | Edges parallel to plane |
| `.atDistance(dist, point)` | Edges at exact distance from point |
| `.withinDistance(dist, point)` | Edges within radius of point |
| `.containsPoint(point)` | Edge passes through point |
| `.ofLength(length)` | Edges of exact length |
| `.ofCurveType(type)` | `"LINE"`, `"CIRCLE"`, `"ELLIPSE"`, etc. |
| `.inBox(c1, c2)` | Within bounding box |
| `.when(fn)` | Custom boolean predicate |
| `.not(finderFn)` | Invert a filter |
| `.and([...finderFns])` | All filters must match |
| `.either([...finderFns])` | Any filter must match |

### FaceFinder methods

| Method | Notes |
|---|---|
| `.inPlane(name, origin?)` | Faces contained in plane |
| `.parallelTo(plane)` | Faces parallel to plane |
| `.ofSurfaceType(type)` | `"PLANE"`, `"CYLINDRE"`, etc. |
| `.atAngleWith(dir, angle?)` | Faces at angle to a direction |
| `.atDistance(dist, point?)` | Faces at distance from point |
| `.withinDistance(dist, point?)` | Faces within radius |
| `.containsPoint(point)` | Face contains point |
| `.inBox(c1, c2)` | Within bounding box |
| `.when(fn)` | Custom boolean predicate |
| `.not(finderFn)` | Invert a filter |
| `.and([...finderFns])` | All filters must match |
| `.either([...finderFns])` | Any filter must match |

---

## Sketcher — 2D Profiles

The right tool for any non-rectangular cross-section: arches, gables, L-profiles, wedges, etc.

```js
// Plane + offset along perpendicular axis:
new Sketcher("YZ", xPosition)   // draws in YZ plane; extrude goes in +X
new Sketcher("XZ", yPosition)   // draws in XZ plane; extrude goes in +Y
new Sketcher("XY", zPosition)   // draws in XY plane; extrude goes in +Z
new Sketcher(planeObject)        // also accepts a Plane object
```

### Drawing methods (all return `this`)

```js
.movePointerTo([a, b])           // move without drawing (local sketch-plane coords)
.lineTo([a, b])                  // line to absolute point
.line(da, db)                    // line by relative delta
.hLine(distance) / .hLineTo(x)
.vLine(distance) / .vLineTo(z)
.polarLine(distance, angle)
.tangentLine(distance)

// Arcs
.sagittaArcTo([x, z], sagitta)          // sagitta = bulge above chord midpoint
.threePointsArcTo([endX, endZ], [midX, midZ])
.tangentArcTo([x, z])
.bulgeArcTo([x, z], bulge)
.hSagittaArc(xDist, sagitta)
.vSagittaArc(yDist, sagitta)
.hBulgeArc(xDist, bulge)
.vBulgeArc(yDist, bulge)

// Ellipse arcs
.ellipseTo([x, z], hRadius, vRadius, rotation, longAxis, sweep)
.halfEllipseTo([x, z], verticalRadius, sweep)

// Curves
.quadraticBezierCurveTo([x, z], [ctrlX, ctrlZ])
.cubicBezierCurveTo([x, z], [ctrl1X, ctrl1Z], [ctrl2X, ctrl2Z])
.bezierCurveTo([x, z], controlPoints)    // generic, multiple control points
.smoothSplineTo([x, z], { startTangent?, endTangent? })

// Corner treatment (apply before next segment)
.customCorner(radius)              // fillet at upcoming corner
.customCorner(radius, "chamfer")

// Completion
.close()             // close with straight line → Sketch
.done()              // end without closing → Sketch
.closeWithMirror()   // close by mirroring (useful for symmetric profiles)
```

### Sketch → Solid

```js
sketch.extrude(distance)
sketch.revolve(axis?, { angle?, origin? }?)
// e.g. revolve a profile around the Z axis for a full revolution:
// new Sketcher("XZ", 0).movePointerTo([r, 0]).lineTo([r, h]).lineTo([0, h]).close().revolve()
// e.g. partial revolution (180°):
// sketch.revolve([0,0,1], { angle: 180, origin: [0,0,0] })
sketch.loftWith([otherSketch], loftConfig?)
sketch.sweepSketch(sketchOnPlane, sweepConfig?)
sketch.face()   // → Face (closed sketch only)
```

---

## Drawing API (2D)

```js
drawRectangle(width, height)           // → Drawing
drawCircle(radius)                     // → Drawing
drawRoundedRectangle(w, h, r)         // → Drawing
drawPolysides(radius, sides)           // → Drawing (regular polygon)
draw(initialPoint?)                    // → DrawingPen (chain same methods as Sketcher)

// Drawing → 3D
drawing.sketchOnPlane("XY" | "XZ" | "YZ", origin?)   // → Sketch
```

---

## Orthographic Projection (3D → 2D drawings)

Projects a solid to a 2D `Drawing` using OpenCascade's exact hidden-line removal.
This is how technical / shop drawings are produced.

```js
drawProjection(shape, "front")   // → { visible: Drawing, hidden: Drawing }
// planes: "front" | "back" | "top" | "bottom" | "left" | "right"  (first-angle)

// Custom viewpoint
const camera = new ProjectionCamera([100, 100, 100]).lookAt(shape);
drawProjection(shape, camera);

lookFromPlane("front")                          // → ProjectionCamera
makeProjectedEdges(shape, camera, withHidden?)  // → { visible: Edge[], hidden: Edge[] }
```

`visible` and `hidden` are ordinary `Drawing`s — compose a sheet with the normal 2D
algebra (`translate` / `scale` / `fuse`), then emit one `toSVG()`.

```js
const { visible } = drawProjection(shape, "front");
const sheet = visible.scale(0.25).translate(120, 80)
  .fuse(drawProjection(shape, "top").visible.scale(0.25).translate(120, 200));
sheet.toSVG(5);   // → SVG string
```

Notes:
- Project the **compound** (`compoundShapes(parts)`) to draw a whole assembly.
- Cost is ~10–30 ms per view — cheap enough to regenerate on a parameter change.
- `hidden` contains retraced duplicate segments; dedup before rendering as dashed.
- `.clone()` the shape before projecting if you still need it afterwards.

---

## Compound & Multi-Shape

```js
// Combine shapes into one compound — no boolean merge, keeps parts separate
compoundShapes([shape1, shape2, shape3])   // → Compound
makeCompound([shape1, shape2, shape3])     // → Compound

// Compound takes the same calls as a Solid: fuse/cut, translate/rotate/scale,
// fillet/chamfer/shell, mesh/blobSTEP/blobSTL
```

**Reach for a compound instead of a fuse chain when members only need to LOOK
adjacent** — a lattice, a slat screen, spindles, battens. Booleans are the
expensive part of a build (on one real model, `fuse` was 73% of the whole exec);
compounding the same 10 members instead of fusing them was 3.4× faster with an
identical bounding box. Costs: `measureVolume` double-counts overlaps, and STEP
carries the members as separate solids inside that part. Bounding boxes and cut
dimensions are unaffected. Use a real fuse when the result must be one
manufactured body.

⚠ **`.intersect()` on a compound silently uses only ONE of its solids.** It does
not throw — it returns a plausible shape with the wrong extents (measured: 48
vertices instead of 432, and one axis clipped by 40%). Clip each member first:

```js
// ✅ clip each, THEN compound
makeCompound(members.map(m => m.intersect(clipBox())))
// ❌ compound, then clip — fast and WRONG
makeCompound(members).intersect(clipBox())
```

---

## Advanced Extrusion & Sweep

```js
// Loft between wires
loft([wire1, wire2, wire3], { ruled?: boolean, startPoint?: Point, endPoint?: Point })
// → Shape3D

// Sweep profile along a path
sketch.sweepSketch(sketchOnPlane, {
  frenet?: boolean,
  auxiliarySpine?: Edge | Wire,
  transitionMode?: "right" | "transformed" | "round",
  withContact?: boolean,
})

// Twisted extrusion
twistExtrude(wire, angleDegrees, center, normal, profileShape?)
```

---

## Wire & Curve Constructors

```js
makeHelix(pitch, height, radius, center?, dir?, lefthand?)   // → Wire
makePolygon(points)           // → Face (planar polygon from Point array)
makeLine(point1, point2)      // → Edge
makeCircle(radius, center?, normal?)
makeEllipse(rMaj, rMin, center?, normal?)
makeEllipseArc(rMaj, rMin, startAngle, endAngle, center?, normal?)
makeBezierCurve(points)
makeThreePointArc(start, mid, end)
makeTangentArc(start, startTangent, end)
```

---

## Sketch Shortcuts

```js
sketchCircle(radius, plane?, origin?)
sketchRectangle(width, height, plane?, origin?)
sketchPolysides(radius, sides, plane?, origin?)
sketchRoundedRectangle(w, h, r, plane?, origin?)
sketchEllipse(rx, ry, plane?, origin?)
sketchHelix(pitch, radius, height, plane?, origin?)
```

---

## Measurement

```js
measureArea(shape)
measureVolume(shape)
measureLength(shape)
measureDistanceBetween(a, b)
```

---

## BoundingBox

Returned by `solid.boundingBox`. Useful for positioning parts relative to each other.

```js
const bb = solid.boundingBox
bb.bounds    // [minCorner, maxCorner] as [x,y,z] Points
bb.center    // center point [x,y,z]
bb.width     // x extent
bb.height    // z extent
bb.depth     // y extent

// Common pattern: position a part flush to another
const top = body.boundingBox.bounds[1][2]   // max Z of body
shelf.translateZ(top)
```

---

## Mating Anchors — `api.anchor()`

Declares a named point + direction other models can mate to in an assembly. Costs no
geometry; it just records a handle. Model-local OCC coords (z up), same frame as the
shapes you return.

```js
api.anchor("hingeAxis", {
  origin: [width - 30, 0, height / 2],  // the point mates coincide on
  axis:   [0, 0, 1],                    // the mate direction (a pin/hole axis)
  up:     [1, 0, 0],                    // OPTIONAL — fixes roll about `axis`
  connector: "shelfPin",                // OPTIONAL — a System connector type
})
```

**Write anchors as expressions over your parameters, not as literals.** They are
recomputed on every build, so `width - 30` follows `width`; a hard-coded `570` is
correct once and silently wrong at every other size.

- `axis` points **outward** from the part. Two mating anchors then meet head-on,
  which is what the `concentric` mate assumes.
- Omit `up` unless the part has a genuine "this way up" — without it the mate uses
  the shortest rotation and the user dials clocking in with the constraint's `roll`.
- Anchors are a **build output**, never stored on the model. Rename one in code and
  any constraint using the old name reports `Unknown anchor "…"` and names what the
  model does declare.
- A duplicate name overwrites: last declaration wins.

Constraints reference these as `anchor:<name>` (bbox faces stay `bbox:±x|±y|±z`).
`concentric` aligns the two axes, coincides the origins, then separates them by the
mate's value; `parallel` aligns direction only; `offset` is bbox-faces-only.

---

## Named entities — `api.entity()`

Declares a named **region** of the model that a person can select and act on — a bay in a
shelving unit, a zone on a panel, a family of repeated parts. Costs no geometry; it records
a box and a meaning, with the exact numbers your code just used to lay that region out.

```js
const main = (api) => {
  // …the code already computes this box to place the bay's panels…
  api.entity("bay_third_left", {
    kind:  "bay",                          // "bay" | "zone" | "family"
    label: "Third bay, left",              // OPTIONAL
    min:   [x0, y0, z0],                   // model-local OCC corners (z up)
    max:   [x0 + bayW, depth, z0 + bayH],
  });
};
```

**Write the corners as the same expressions the geometry uses, not as literals.** They are
recomputed on every build, so a bay follows `overallWidth`; a hard-coded box is correct at
one size and silently wrong at every other one.

- The model's interaction manifest (`data.workspace`) gives an entity its label and says
  which interactions apply to it. It **never stores coordinates** — declaring `bounds` on a
  manifest entity is refused, and the error points here. Meaning in the manifest, geometry
  from the build.
- Entities are a **build output**, never stored on the model. Stop declaring one and any
  manifest entity of that id reports as unreported, naming this call.
- Ids must match the manifest's `entities[].id` exactly. Use a durable id
  (`bay_third_left`), never a part display name — renaming a part must not orphan a bay.
- `max` below `min` on any axis throws: an inverted box is a selection target nobody can hit.
- A duplicate id overwrites: last declaration wins.

Declaring entities is worthwhile when the model has repeated regions a person will want to
act on one at a time. A model with no manifest does not need them.

---

## Export

```js
// Single solid
solid.blobSTEP()
solid.blobSTL({ tolerance: 0.1 })
solid.mesh({ tolerance: 0.1, angularTolerance: 0.5 })   // → triangle mesh for Three.js
solid.meshEdges(options?)
solid.serialize()

// Named multi-part STEP assembly
exportSTEP(
  [{ shape: body, name: "body" }, { shape: lid, name: "lid" }],
  { modelUnit: "MM" }
)  // → Blob
```

---

## Import — stored geometry (`api.importSTEP`)

A model can import a STEP file attached to it as an **asset**, by name:

```js
const main = (api) => api.importSTEP("hull.step");
```

The result is an ordinary shape — booleans, transforms and `api.anchor()` all work on it,
so imported geometry composes with authored geometry:

```js
const main = (api) => {
  const hull = api.importSTEP("hull.step");
  const bore = api.makeCylinder(8, 100).translate([0, 0, -50]);
  return hull.cut(bore);
};
```

- The argument is the asset's **name** as attached to the model — a plain string, not a
  URL or a file path.
- **Synchronous**, like every other api call. `main` never needs to be `async`.
- A name with no asset behind it **throws**, and the error lists what is attached. It
  never returns an empty shape.
- Imported B-rep carries no parameters of its own; the parametric part is the code you
  write around it.

---

## Memory Management (important in WASM workers)

Replicad wraps OpenCascade objects on the WASM heap — they are not garbage collected by JS.

```js
shape.delete()   // free WASM memory when a shape is no longer needed

// Auto-cleanup within a scope
const gc = GCWithScope();
const tempShape = gc(makeBox([0,0,0], [10,10,10]));

// Manual scope
const [r, c] = localGC();
const s = r(makeBox([0,0,0], [10,10,10]));
c();  // deletes s
```

---

## Constants & Types

```js
DEG2RAD   // Math.PI / 180
RAD2DEG   // 180 / Math.PI

// Point types
type Point   = [number, number, number]   // 3D
type Point2D = [number, number]           // 2D
```

---

## PlaneName Values

```
"XY" | "YZ" | "XZ" | "ZX" | "YX" | "ZY"
"front" | "back" | "left" | "right" | "top" | "bottom"
```

## CurveType Values (for EdgeFinder.ofCurveType)

```
"LINE" | "CIRCLE" | "ELLIPSE" | "HYPERBOLA" | "PARABOLA"
"BEZIER_CURVE" | "BSPLINE_CURVE" | "OFFSET_CURVE" | "OTHER_CURVE"
```

## SurfaceType Values (for FaceFinder.ofSurfaceType)

```
"PLANE" | "CYLINDRE" | "CONE" | "SPHERE" | "TORUS"
"BEZIER_SURFACE" | "BSPLINE_SURFACE" | "REVOLUTION_SURFACE"
"EXTRUSION_SURFACE" | "OFFSET_SURFACE" | "OTHER_SURFACE"
```

Note: `"CYLINDRE"` — correct spelling in the API (not `"CYLINDER"`).

---

## Also Available (full runtime surface)

Less-common functions also exposed in the `api` object:

```js
// Solids & faces
makeSolid(facesOrShells)        // assemble faces/shells into a solid
makeFace(wire)                  // planar face from a closed wire
makeVertex(point)
makeCompound(shapes)            // like compoundShapes
addHolesInFace(face, holeWires)
weldShellsAndFaces(shells)

// 2D drawing extras
drawEllipse(rx, ry)
drawSingleCircle(r)
drawText(text, { fontFamily?, fontSize? })     // requires a loaded font
drawParametricFunction(fn, { pointsCount? })   // fn: t → [x, y]
drawPointsInterpolation(points2D)              // smooth curve through 2D points
drawFaceOutline(face)
sketchFaceOffset(face, offset)
sketchText(text, options?)

// Planes
makePlane(planeName?, origin?)
makePlaneFromFace(face)
createNamedPlane(planeName, origin?)

// Extrusion extra
complexExtrude(wire, center, normal, profileFn?)

// 2D booleans (Drawings)
fuse2D(a, b) / cut2D(a, b) / intersect2D(a, b)

// Utilities
deserializeShape(buffer)
isShape3D(x) / isWire(x)
shapeType(topoShape)            // raw TopoDS_Shape → type enum
getSingleFace(finderFn, shape)
```

---

## Coordinate System — Replicad → Three.js

Replicad uses OpenCASCADE Z-up convention. Three.js uses Y-up. The mesh data from `.mesh()` must be remapped when building `BufferGeometry`:

| Replicad / OCC | Three.js |
|---|---|
| X | X (unchanged) |
| Z | Y (OCC up → Three.js up) |
| Y | −Z (flipped to preserve winding) |

```ts
out[i]     =  src[i];      // X → X
out[i + 1] =  src[i + 2];  // Z → Y
out[i + 2] = -src[i + 1];  // Y → -Z
```

Apply the same transform to normals. This is already handled in the cadWorker — do not re-apply it in model code.
