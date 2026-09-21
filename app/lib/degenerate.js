// The ONE zero-extent rule — shared by app/cadWorker.ts and packages/engine/runner.mjs
// for the same reason obb.ts and interference.ts are shared: the browser's build verdict
// and the agent's headless one must not be able to disagree about whether a model is
// geometry at all (t42-kernel §3 F14, §8 K3 P3).
//
// ⭐ WHY THIS EXISTS. On replicad-opencascadejs 1.0.0, `makeBaseBox(60, 40, 0)` and
// `drawRectangle(20,10).sketchOnPlane("XY").extrude(0)` no longer throw — they return a
// Solid, and MEASURING that solid never returns (killed at 150s and again at 45s; in the
// same process a normal box measures in 2ms). A zero-thickness parameter is one slider drag
// from any parametric model and Axle measures volume and area on the hot path, so on that
// kernel a failed build stops being a verdict and becomes a wedged worker: no error, no
// citation, nothing for an agent to act on. Refusing the call BEFORE it reaches OCC is what
// keeps it a citable failure.
//
// ⚠⚠ AND IT IS NOT ONLY A BUMP PREREQUISITE — 0.23.0 HAS ITS OWN SILENT HALF, measured
// 2026-09-08 across 47 route-runs (`probe-degenerate.mjs --survey --raw`). F14 read as though
// today's kernel refuses degenerate geometry loudly. It refuses the TWO routes F14 probed.
// It accepts these, silently, with no error at all:
//     makeCylinder(10, 0)                → Solid, volume 0, area 0, 0 triangles
//     makeCylinder(0, 20)                → Solid, volume 0
//     makeSphere(0)                      → Solid, volume 0
//     drawRectangle(20, 0).…extrude(10)  → Solid, volume 0, 4 triangles
//     makeBaseBox(60, 40, NaN)           → Solid, then EVERY measurement throws
//                                          "Maximum call stack size exceeded"
//     makeCylinder(10, NaN)              → Solid, volume 0, area 314.16 (!), mesh throws
// An invisible zero-volume part flows straight into part volumes, the cut list, soundness
// and the drawings pack — and one route is worse still: cutting a REAL box with that
// zero-thickness solid returns a Compound of volume 0, so the GOOD PART IS ANNIHILATED.
// So this guard fixes a LIVE 0.23 bug; the bump only widens the blast radius from "an
// invisible part" to "a wedged worker".
//
// ⚠ NOT a lint and not advice — it THROWS, inside model execution, so attributeExecError
// attributes it to the line of model code that made the call.

/**
 * The smallest extent that is geometry rather than noise.
 *
 * ⭐ MEASURED, NOT CHOSEN: this is exactly `Precision::Confusion()` as the shipped OCC
 * build reports it, and exactly where the kernel's own behaviour flips —
 * `makeBaseBox(60, 40, z)` and `extrude(z)` BUILD at z = 1e-6 and THROW at z = 1e-7 and
 * below (probe-degenerate.mjs records the sweep). Anything above it is a real, if thin,
 * solid: a 0.1mm box measures 240mm³ correctly, and this guard must never refuse it.
 *
 * ⚠ probe-degenerate.mjs asserts this constant EQUALS the live `Precision::Confusion()`,
 * so a kernel that moves its own tolerance fails a leg instead of silently disagreeing
 * with the guard that was written against it.
 */
export const MIN_EXTENT = 1e-7;

/**
 * Extent-bearing arguments, by api function, in positional order. A trailing `?` means the
 * argument has a replicad default and may legitimately be omitted; every other name is
 * required, and `undefined` there is itself a finding (a renamed parameter const, a typo'd
 * property) that OCC would otherwise turn into a NaN solid.
 *
 * ⚠ Only leading POSITIONAL extents are listed. `drawRoundedRectangle(w, h, r = 0)`'s corner
 * radius and `drawPolysides(radius, sides, sagitta = 0)`'s sagitta are legitimately zero, so
 * they are absent by design, not by oversight.
 */
export const EXTENT_ARGS                           = {
  // 3D primitives
  makeBaseBox: ["xLength", "yLength", "zLength"],
  makeCylinder: ["radius", "height"],
  makeSphere: ["radius"],
  makeEllipsoid: ["aLength", "bLength", "cLength"],
  // 2D profiles — a zero-width rectangle extrudes into a zero-volume "solid" on 0.23 today
  drawRectangle: ["width", "height"],
  drawRoundedRectangle: ["width", "height"],
  drawCircle: ["radius"],
  drawEllipse: ["majorRadius", "minorRadius"],
  sketchRectangle: ["xLength", "yLength"],
  sketchRoundedRectangle: ["width", "height"],
  sketchCircle: ["radius"],
  sketchEllipse: ["xRadius?", "yRadius?"],
};

/** Human-readable form of whatever arrived, for the message. */
const describe = (v         )         => {
  if (typeof v === "number") return Number.isNaN(v) ? "NaN" : String(v);
  if (v === undefined) return "undefined (the argument was never supplied)";
  if (v === null) return "null";
  return `${typeof v} ${JSON.stringify(v)?.slice(0, 40) ?? ""}`.trim();
};

/**
 * Throw unless `value` is a finite number whose magnitude is at least MIN_EXTENT.
 * NEGATIVE IS FINE — `extrude(-10)` and `makeBaseBox(60, 40, -20)` are ordinary, working
 * calls (the latter builds a 48000mm³ box); only the MAGNITUDE is degenerate.
 *
 * @param label how the call appears in model code, e.g. "api.makeCylinder" or ".extrude()"
 */
export function checkExtent(label        , argName        , value         , optional = false)       {
  if (value === undefined && optional) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${label}: ${argName} is ${describe(value)} — that is not a dimension. `
      + `Check the arithmetic that produced it (a divide by zero, a parameter const that was `
      + `renamed, or a value that never became a number); OCC would build a shape from it and `
      + `then fail on every measurement.`);
  }
  if (Math.abs(value) < MIN_EXTENT) {
    throw new Error(
      `${label}: ${argName} is ${value} — zero-extent geometry is not a solid. Every dimension `
      + `must be at least ${MIN_EXTENT} (the kernel's own tolerance, Precision::Confusion). `
      + `This is almost always a parameter that reached 0: clamp it, or make the feature `
      + `conditional so the part is omitted rather than built flat.`);
  }
}

/**
 * Wrap one buildApi entry so its extent arguments are checked before OCC sees them.
 * Used as `makeBaseBox: guardExtents("makeBaseBox", r.makeBaseBox),` in BOTH buildApi
 * mirrors — the key stays a literal, so scripts/lib/apiKeys.mjs still harvests it and the
 * API-contract guard still holds the two mirrors together.
 *
 * ⚠ Throws at WIRING time on an unknown name or a non-function, rather than returning the
 * function unguarded: a guard that quietly declines to guard is the failure mode this whole
 * tier exists to catch [[feedback_guard_disables_itself]].
 */
export function guardExtents                                   (name        , fn   )    {
  const spec = EXTENT_ARGS[name];
  if (!spec) throw new Error(`guardExtents("${name}"): no extent-argument list in EXTENT_ARGS — add one or drop the wrapper.`);
  if (typeof fn !== "function") throw new Error(`guardExtents("${name}"): replicad does not export a function by that name (got ${typeof fn}).`);
  const checks = spec.map((s) => (s.endsWith("?") ? { arg: s.slice(0, -1), optional: true } : { arg: s, optional: false }));
  const label = `api.${name}`;
  const guarded = function (               ...args       ) {
    for (let i = 0; i < checks.length; i++) checkExtent(label, checks[i].arg, args[i], checks[i].optional);
    return fn.apply(this, args);
  };
  return guarded                ;
}

/** Marker so a second init cannot double-wrap a prototype. */
const INSTALLED = Symbol.for("axle.degenerateGuard.extrude");
/** Where the unguarded method is parked, so the probe can characterise the bare kernel. */
const ORIGINAL = Symbol.for("axle.degenerateGuard.extrudeOriginal");
const SKETCH_CLASSES = ["Sketch", "CompoundSketch"];

/**
 * Guard the extrusion distance on replicad's sketch classes, once per process.
 *
 * ⚠ THIS PATCHES A LIBRARY PROTOTYPE, and it is deliberate: `extrude` is a METHOD, so it
 * never passes through buildApi, and `thickness → .extrude(thickness)` is the single most
 * common shape in real model code — exactly the slider F14 describes. `Sketches.extrude`
 * delegates to `Sketch.extrude` per member, so the two classes patched here cover every
 * route a model can reach (sketchOnPlane, the Sketcher, the sketchX shortcuts).
 *
 * Idempotent, and LOUD if replicad's shape changes: a missing class or a missing method
 * throws here rather than leaving the process silently unguarded.
 */
export function installExtrudeGuard(replicad     )       {
  for (const cls of SKETCH_CLASSES) {
    const proto = replicad?.[cls]?.prototype;
    if (!proto || typeof proto.extrude !== "function") {
      throw new Error(`installExtrudeGuard: replicad.${cls}.prototype.extrude is not a function — the zero-extent guard cannot be installed, and F14 says an unguarded extrude(0) is a hang, not an error.`);
    }
    if (proto[INSTALLED]) continue;
    const original = proto.extrude;
    proto[ORIGINAL] = original;
    proto.extrude = function (               extrusionDistance         , ...rest           ) {
      checkExtent(".extrude()", "extrusionDistance", extrusionDistance);
      return original.call(this, extrusionDistance, ...rest);
    };
    proto[INSTALLED] = true;
  }
}

/** Is the extrude guard on the classes right now? The probe asserts this rather than assuming it. */
export function isExtrudeGuardInstalled(replicad     )          {
  return SKETCH_CLASSES.every((cls) => replicad?.[cls]?.prototype?.[INSTALLED] === true);
}

/**
 * ⚠⚠ PUT THE KERNEL BACK THE WAY IT WAS — for `probe-degenerate.mjs --raw` ONLY.
 *
 * This exists because the guard would otherwise make its own subject unobservable: once
 * `extrude(0)` is refused in JS, nobody can ever measure again what THE KERNEL does with it,
 * and measuring exactly that on 1.0.x is K2's job. A survey that cannot reach the bare kernel
 * would be a survey of the guard [[feedback_validate_the_instrument]].
 *
 * Never call it from a build path. It is deliberately not wired anywhere but the probe, the
 * probe never calls it in gate mode, and the gate asserts `isExtrudeGuardInstalled` — so an
 * unguarded process cannot pass itself off as a guarded one.
 */
export function uninstallExtrudeGuard(replicad     )       {
  for (const cls of SKETCH_CLASSES) {
    const proto = replicad?.[cls]?.prototype;
    if (!proto?.[INSTALLED]) continue;
    if (typeof proto[ORIGINAL] !== "function") throw new Error(`uninstallExtrudeGuard: replicad.${cls} is marked guarded but parked no original — refusing to leave it in a third state.`);
    proto.extrude = proto[ORIGINAL];
    delete proto[INSTALLED];
    delete proto[ORIGINAL];
  }
}
