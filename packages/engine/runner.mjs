// Headless replicad runner — executes Studio model code in Node, exactly as
// cadWorker does in the browser (same buildApi surface, same new Function call).
// Foundation for: eval harness, parameter range sweeps, and example-library
// verification.
//
// ⭐ THIS IS THE ENGINE, AND IT LIVES HERE ON PURPOSE (t22-localpack L1, 2026-08-10).
// It used to sit at scripts/headless/runner.mjs, which still exists as a one-line
// re-export shim so the 17 scripts that import it kept working. The move is what lets
// services/geometry (and, later, the published local pack) depend on a PACKAGE rather
// than reach across the tree — the local pack must never become a sixth copy of this
// execution path. A shim holds no logic, so unlike a copy it cannot drift.
//
// ⚠ THE app/lib IMPORTS BELOW ARE RELATIVE AND DEPTH-DEPENDENT (../../app/lib/*). They
// resolve because packages/engine sits exactly as deep as scripts/headless did. Anything
// that relocates this file — including the L4 exporter building the published pack — must
// carry app/lib at the same relative depth, or move these imports with it.
//
// ⚠ THIS FILE RUNS NO VALIDATOR — its header claimed "same validator" until 2026-08-08 and
// that was never true (nothing here imports one). The checks an agent sees live in
// services/geometry/server.mjs defaultProblems, layered on top of this result; sweeps use
// scripts/headless/sweep.mjs checkRun. What runModel DOES contribute is the one check that
// cannot be made after the fact: interference, measured while the B-rep shapes are alive
// (opts.interference — see app/lib/interference.ts and board row t4-overlap-truth).
//
// ⚠ opts.interference IS NO LONGER JUST A BOOLEAN. It is an InterferenceSpec: false/absent
// = do not measure, true = the interactive 64-pair/400ms defaults, "exhaustive" = the cap
// lifted (what certify_model asks for), or an explicit MeasureOpts. Existing boolean callers
// are unchanged by construction — resolveMeasureOpts() maps true→{} and false→null — and it
// is the ONE normaliser, shared with cadWorker, so the browser and this runner cannot come
// to disagree about what a spec means (t4-overlap-exhaustive).
//
// The OCC build is loaded BY NAME. occ-js 1.0.0 publishes an exports map with a real
// `require` condition, so there is no conversion step and the engine writes no file at
// runtime — see the block where ensureCjsBuild() used to be for why keeping it would have
// broken engine start rather than merely wasted a copy.

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
// The ONE oriented-bbox implementation, shared with app/cadWorker.ts so the browser
// build and this one can't report different cut dims for the same model (B1b).
import { orientedExtents } from "../../app/lib/obb.js";
// The ONE op-profiler, shared with app/cadWorker.ts for the same reason obb is:
// the browser verdict and the agent's push verdict must not be able to disagree
// about where a build spent itself (t8-7).
import { profileApi, compactProfile } from "../../app/lib/execProfile.js";
// The ONE entity-report shape + version stamp, shared with app/cadWorker.ts for the same
// reason obb is: the browser's build verdict and the agent's headless one must not be able
// to describe the same model's bays differently (t13-workspace P3b, ADR-4).
import { ENTITY_REPORT_VERSION } from "../../app/lib/entityReport.js";
import { createHash } from "node:crypto";
// The ONE overlap rule, shared with app/cadWorker.ts + app/lib/validator.ts for the same
// reason obb is: the browser verdict and the agent's push verdict must not be able to
// disagree about whether two parts are jointed or colliding (t4-overlap-truth).
import { measureInterference, resolveMeasureOpts } from "../../app/lib/interference.js";
// The ONE B-rep soundness rule set (t31-solidverdict). Same seam, same window, same reason as
// interference above: it reads the SHAPES, not the mesh, so it can only run here.
import { measureSoundness } from "../../app/lib/soundness.js";
// The ONE swept-collision rule (t7-sweptcheck). Third module in the same live-shape window, and
// the only one whose input is not in the code: it poses the model's JOINTS across their declared
// ranges and re-measures interference, so it needs `opts.joints` handed to it.
import { measureSweptCollision, sweptFailure } from "../../app/lib/sweptCollision.js";
// The ONE throw-attribution, shared with app/cadWorker.ts for the same reason obb is:
// a build that fails in the browser and the same build failing headlessly must name the
// same line and the same operation (t25-w3).
import { attributeExecError } from "../../app/lib/execError.js";
// The ONE exception decode, shared with app/cadWorker.ts for the same reason obb is: an OCC
// throw is a bare pointer on 0.23 and a WebAssembly.Exception on 1.0.0, and the browser's
// verdict and this one must not turn the same throw into two sentences (§3 F4, §8 K3 P1).
import { occErrorText, ocFrom } from "../../app/lib/occError.js";
// The ONE zero-extent rule, shared with app/cadWorker.ts for the same reason obb is: a
// degenerate call that the browser refuses and this runner builds would be a verdict the
// two surfaces disagree about — and on 1.0.0 the disagreement is a wedged worker (§3 F14).
import { guardExtents, installExtrudeGuard } from "../../app/lib/degenerate.js";

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));

// ⭐ RESOLVED, NOT PATH-JOINED (t22-localpack L1). This block used to compute
// `root = __dir/../..` and join a literal "node_modules/…" onto it — which silently
// encoded "this file is exactly two levels below a checkout that owns node_modules".
// True in the repo, true in the Docker image by careful arrangement, and false the
// moment the engine is published to a customer's disk. Node's own resolver knows where
// its dependencies are; ask it.
// ⚠⚠ BY NAME, AND THE WASM BY ITS OWN NAME (t42 K3). This block used to resolve the deep path
// `replicad-opencascadejs/src/replicad_with_exceptions.js` and derive the wasm from it by string
// surgery. occ-js 1.0.0 breaks BOTH halves, and only one of them breaks loudly:
//   · the deep path is gone AND unexported — ERR_PACKAGE_PATH_NOT_EXPORTED. Loud. Fine.
//   · `OC_JS.replace(/\.js$/, ".wasm")` — SILENT. By-name resolution lands on the `require`
//     condition, `dist/replicad_single.cjs`, and `/\.js$/` does not match `.cjs`, so the
//     "derived" wasm path is the JS path unchanged. No throw; a wasmBinary read of the glue.
//     Measured, not reasoned: scripts/headless/kernel-arms/leg-j-resolve.mjs.
// The package now names the wasm itself, so the pair comes from the exports map rather than
// from a regex, which is what actually keeps them from being a mismatched set.
// ⚠ RESOLVED LAZILY, not at module load. `require.resolve` THROWS when the subpath is not
// published, and at top level that throw escapes as a bare MODULE_NOT_FOUND stack before any
// of this file's error handling exists — so every consumer (test:kernel's legs, evals, the
// server, the CLI) would die with a raw trace naming an internal loader frame. Inside
// initReplicad it becomes the EngineStartError below, which is the difference between exit 3
// "the engine never ran" and exit 1 "your model has problems" [[feedback_refusal_must_be_legible]].
// It matters immediately: between this commit and `npm install` in main, node_modules still
// holds 0.23, which publishes no "./wasm" subpath at all.
const resolveKernel = () => ({
  OC_JS: require.resolve("replicad-opencascadejs"),
  OC_WASM: require.resolve("replicad-opencascadejs/wasm"),
});

// ⚠ replicad CANNOT be reached the same way, and the reason is worth keeping:
//   • Its package.json declares an `exports` map with only "." (and, from 1.0.1, "./types"),
//     so require.resolve("replicad/dist/replicad.cjs") throws ERR_PACKAGE_PATH_NOT_EXPORTED
//     — as does "replicad/package.json". The subpath is unreachable by name.
//   • require.resolve("replicad") DOES resolve, but to dist/replicad.umd.cjs — a
//     DIFFERENT ARTIFACT from the dist/replicad.cjs this runner has always loaded
//     (642,500 bytes vs 600,282, different hash). Switching to it would swap the geometry
//     bundle underneath production while every test still passed. Never do that silently.
// ✅ RE-MEASURED ON 1.0.1 (t42 K3, leg-j-resolve.mjs) — both bullets still hold, so this
// anchor-and-join STAYS. 1.0.1's map is {".": {import: dist/replicad.js, require:
// dist/replicad.umd.cjs}, "./types": …}; the subpath is still unexported and require() still
// lands on the umd build. Do not "simplify" this to a by-name resolve on the strength of the
// bump having tidied the OC side.
// So: anchor on the OC resolve, which lands in the same node_modules tree, and join the
// same relative path as before. This also asserts something real — replicad and its OCC
// build must come from ONE tree; a pair resolved from two is the version drift that makes
// a "parity" claim meaningless.
// ⚠ The depth survived the bump BY COINCIDENCE, not by design: `…/replicad-opencascadejs/
// src/x.js` and `…/replicad-opencascadejs/dist/x.cjs` are both three levels below
// node_modules. Asserted rather than assumed by leg-j-resolve.mjs, so the next layout change
// fails there instead of building paths under the wrong root.
const replicadCjsFrom = (OC_JS) => join(dirname(dirname(dirname(OC_JS))), "replicad", "dist", "replicad.cjs");

/**
 * THE ENGINE CANNOT START error. Typed, because the difference between "this model is
 * broken" and "this engine never ran" is the difference between exit 1/2 and exit 3, and
 * an untyped throw loses it — `verify` classified an engine failure as DID_NOT_BUILD, and
 * a bare `axle build` inherited Node's default uncaught-exception code of 1, which this
 * CLI's own table defines as "built, problems found". Both told a customer their model was
 * at fault when the kernel was never asked.
 */
export class EngineStartError extends Error {
  constructor(message, options) { super(message, options); this.name = "EngineStartError"; }
}

// ⛔⛔ ensureCjsBuild() WAS HERE, AND ON 1.0.0 IT WAS NOT MERELY REDUNDANT — IT WAS BROKEN.
// Deleted 2026-09-12 (t42 K3) with the version pins, and the reason is worth more than the code:
//
// It existed for ONE file. 0.23's occ-js shipped no `exports` map and `main:
// src/replicad_single.js`, and that build was always requireable; the build this runner
// deliberately loaded instead was `src/replicad_with_exceptions.js` — the only one that
// surfaced OCC throws, and the only one ending `export default Module;`. That literal is what
// the transform rewrote. occ-js 1.0.0 deleted the build entirely (F1) and publishes a real
// `require` condition, so there is nothing left to convert.
//
// ⚠⚠ AND CONVERTING IT ANYWAY WOULD HAVE BROKEN ENGINE START, SILENTLY-LOOKING-DELIBERATE.
// `dist/replicad_single.cjs` is a 107-BYTE SHIM whose whole body is
//     module.exports = (...args) => import("./replicad_single.js").then(({default: init}) => init(...args));
// — a RELATIVE import. The transform copies file TEXT into a cache directory, so the copy's
// `./replicad_single.js` would resolve against the cache dir, where nothing of that name
// exists. Measured, not reasoned: relocating the file and calling it gives
// `ERR_MODULE_NOT_FOUND … replicad_single.js` — the copy hunting a sibling that is not
// beside it. The regex would not have matched either, so this would have been a byte copy
// that quietly relocated an import — which is why "it is
// probably unnecessary now" was the wrong question and "what happens if it stays" was the
// right one.
//
// What went with it: the two CACHE_DIRS, the mtime freshness check, and the pid-unique
// write-then-rename. The engine now writes NO file at runtime at all — which is a stronger
// version of the property services/geometry/Dockerfile's USER-drop was built around.
// ⭐ EngineStartError STAYS and gains a better thrower (see initReplicad below). The lesson
// those two shipped incidents bought was never "caches can be unwritable" — it was that an
// engine which never ran must exit 3, and must name ITSELF rather than the customer's model.
// That contract outlives the mechanism, and it now covers the failure that actually happens
// in the field: a kernel that is not installed or cannot load.
let replicad = null;

/** Initialize OCC + replicad once per process. Returns the replicad module. */
export async function initReplicad() {
  if (replicad) return replicad;
  // ⭐ THE EXIT-3 CONTRACT, MOVED TO WHERE IT NOW BELONGS (t42 K3). EngineStartError used to be
  // thrown only by ensureCjsBuild's "no cache directory was writable". With the shim gone, the
  // engine writes no file at all, so that failure cannot happen — but the CONTRACT it protected
  // still must: an engine that never ran exits 3 and names ITSELF, never the customer's model.
  // `packages/engine/cli.mjs` and `verify.mjs` both branch on this name.
  // ⚠ Wrapped around LOADING and STARTING the kernel, which is the failure that actually
  // happens in the field — a missing, unresolvable or unloadable install. Untyped, that throw
  // inherited Node's default exit 1, which `verify.EXIT_MEANING` defines as "built, problems
  // found": telling a customer their geometry was wrong about a kernel that was never asked.
  let opencascade, r, oc;
  try {
    const { OC_JS, OC_WASM } = resolveKernel();
    const mod = require(OC_JS);
    opencascade = mod?.default ?? mod;
    r = require(replicadCjsFrom(OC_JS));
    oc = await opencascade({
      wasmBinary: readFileSync(OC_WASM),
      locateFile: () => OC_WASM,
    });
  } catch (e) {
    // ⚠ Node appends "Require stack:\n- <internal path>" to MODULE_NOT_FOUND, and it is the one
    // part of the cause a customer must not be shown: it names a file inside the engine, which
    // is precisely the "blame something the reader cannot act on" this whole path exists to
    // avoid. The `cause` keeps the full original for anyone debugging.
    const why = String(e?.message ?? e).split(/\n\s*Require stack:/)[0].trim();
    throw new EngineStartError(
      "the geometry kernel could not be started.\n\n" +
      `  ${why}\n\n` +
      "  This is an ENGINE problem, not a problem with your model — nothing was built, so\n" +
      "  nothing about your geometry has been judged. Usual causes: a partial or corrupted\n" +
      "  install, a kernel version this engine was not built against, or a tree where\n" +
      "  replicad-opencascadejs cannot be resolved.\n\n" +
      "    npm install @axle-keys/cad-engine        (reinstall)\n",
      { cause: e },
    );
  }
  r.setOC(oc);
  await loadDrawingFont(r);
  // Zero-extent guard on `.extrude()` — a METHOD, so it never passes through buildApi and
  // has to be installed on the class once (§3 F14; app/lib/degenerate.ts explains why a
  // prototype patch is the right shape here). Mirrored in app/cadWorker.ts's init.
  installExtrudeGuard(r);
  replicad = r;
  return r;
}

/** K14 (PK3) — give `api.drawText` / `api.sketchText` something to draw with.
 *
 *  ⚠ These two have been on the API surface, in `apiSurface.js`, in the skill pack and in
 *  BOTH buildApi mirrors since the beginning — and they could not work. replicad keeps a
 *  module-level FONT_REGISTER that starts EMPTY; `textBlueprints` looks the family up, gets
 *  `undefined`, warns "please load it first", falls back to the default — which is also
 *  undefined — and then throws inside opentype. So a model that called `api.drawText("A")`
 *  got a TypeError from a function the docs told it to call. Loading the bundled face at
 *  init is the whole fix, and it registers as BOTH "Inter" and the default family.
 *
 *  Non-fatal on purpose: a missing font must not stop every model in the process from
 *  building. It is logged, and `drawText` then fails exactly as loudly as it does today. */
/** ⭐ EXPORTED for the kernel-arms legs (t42 K3). A leg that loads a kernel WITHOUT initReplicad
 *  has to reproduce everything init does, or it measures a differently-set-up engine: skipping
 *  this made `drawText` throw `Cannot read properties of undefined (reading 'getPath')`, which
 *  read as a guard hole on 1.0.0 and was an instrument gap [[feedback_validate_the_instrument]]. */
export async function loadDrawingFont(r) {
  try {
    const p = new URL("../../app/lib/fonts/Inter.ttf", import.meta.url);
    const b = readFileSync(p);
    await r.loadFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "Inter");
  } catch (e) {
    console.warn(`[engine] the bundled drafting face did not load (${e?.message ?? e}) — api.drawText/sketchText will throw`);
  }
}

const MESH_OPTS = { tolerance: 0.1, angularTolerance: 0.5 };

/** Mirror of cadWorker's declareAnchor — kept outside buildApi's object literal for
 *  the same reason (check-api-contract derives the API surface from that literal). */
function declareAnchor(collect, name, spec) {
  if (!name || typeof name !== "string") throw new Error("api.anchor(name, spec): name must be a non-empty string");
  if (!spec || !Array.isArray(spec.origin) || spec.origin.length !== 3 || spec.origin.some(n => !Number.isFinite(n)))
    throw new Error(`api.anchor("${name}"): origin must be [x, y, z] finite numbers`);
  if (!Array.isArray(spec.axis) || spec.axis.length !== 3 || spec.axis.some(n => !Number.isFinite(n)))
    throw new Error(`api.anchor("${name}"): axis must be [x, y, z] finite numbers`);
  if (Math.hypot(...spec.axis) < 1e-9)
    throw new Error(`api.anchor("${name}"): axis has zero length — it must point somewhere`);
  if (spec.up && Math.hypot(...spec.up) < 1e-9)
    throw new Error(`api.anchor("${name}"): up has zero length — omit it instead`);
  collect?.({ name, origin: spec.origin, axis: spec.axis, ...(spec.up ? { up: spec.up } : {}), ...(spec.connector ? { connector: spec.connector } : {}) });
}

/** Mirror of cadWorker's declareEntity (t13-workspace P3b) — outside buildApi's literal for
 *  the same reason declareAnchor is. Keep the two error strings in step: an agent that hits
 *  this headlessly and then hits it in the tab must not be told two different things. */
function declareEntity(collect, id, spec) {
  if (!id || typeof id !== "string") throw new Error("api.entity(id, spec): id must be a non-empty string");
  if (!spec || typeof spec !== "object") throw new Error(`api.entity("${id}"): the second argument must be { kind, label, min, max }`);
  if (spec.kind !== "bay" && spec.kind !== "zone" && spec.kind !== "family")
    throw new Error(`api.entity("${id}"): kind must be "bay", "zone" or "family" — got ${JSON.stringify(spec.kind)}`);
  for (const k of ["min", "max"]) {
    const v = spec[k];
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(n)))
      throw new Error(`api.entity("${id}"): ${k} must be [x, y, z] finite numbers`);
  }
  const axes = ["x", "y", "z"];
  for (let i = 0; i < 3; i++) {
    if (spec.max[i] < spec.min[i])
      throw new Error(`api.entity("${id}"): max ${axes[i]} (${spec.max[i]}) is below min ${axes[i]} (${spec.min[i]}) — the corners are swapped, and an inverted box cannot be drawn or clicked`);
  }
  if (spec.label !== undefined && typeof spec.label !== "string")
    throw new Error(`api.entity("${id}"): label must be a string when given`);
  collect?.({ id, kind: spec.kind, ...(spec.label ? { label: spec.label } : {}), min: spec.min, max: spec.max });
}

/** Synchronous STEP → Shape. Mirror of app/cadWorker.ts importSTEPSync — replicad's
 *  own importSTEP is async only for `await blob.arrayBuffer()`; with the bytes already
 *  in hand the rest is synchronous OCC, which is what lets model code stay synchronous
 *  at every exec site. Keep the two in step. */
function importSTEPSync(r, bytes) {
  const oc = r.getOC();
  const [track, gc] = r.localGC();
  const fileName = `axle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  oc.FS.writeFile(`/${fileName}`, view);
  try {
    const reader = track(new oc.STEPControl_Reader());
    if (!reader.ReadFile(fileName)) throw new Error("OCC could not parse the file as STEP");
    reader.TransferRoots(track(new oc.Message_ProgressRange()));
    return r.cast(track(reader.OneShape()));
  } finally {
    try { oc.FS.unlink(`/${fileName}`); } catch { /* already gone */ }
    gc();
  }
}

/** Mirror of cadWorker's buildApi() — keep in sync (checked by check-api-contract).
 *  `collect` receives api.anchor() declarations, same contract as the worker.
 *  `assets` is name → bytes for model code that imports stored geometry (t9-step).
 *  `collectEntity` receives api.entity() declarations — APPENDED, not slotted beside
 *  `collect`, because several probe scripts call `buildApi(r)` / `buildApi(r, collect)`
 *  positionally and an inserted parameter would have shifted `assets` under them. */
export function buildApi(r, collect, assets, collectEntity) {
  return {
    // Primitives — the extent-bearing ones go through guardExtents (§3 F14 / K3 P3).
    // ⚠ Keep the KEYS literal: scripts/lib/apiKeys.mjs harvests them to hold this mirror
    // and cadWorker's together, and it reads text, not runtime values.
    makeBox: r.makeBox, makeCylinder: guardExtents("makeCylinder", r.makeCylinder),
    makeSphere: guardExtents("makeSphere", r.makeSphere),
    makeEllipsoid: guardExtents("makeEllipsoid", r.makeEllipsoid),
    makeSolid: r.makeSolid, makeBaseBox: guardExtents("makeBaseBox", r.makeBaseBox),
    // Sketcher
    Sketcher: r.Sketcher,
    // Drawing / 2D
    draw: r.draw, drawCircle: guardExtents("drawCircle", r.drawCircle),
    drawEllipse: guardExtents("drawEllipse", r.drawEllipse),
    drawRectangle: guardExtents("drawRectangle", r.drawRectangle),
    drawRoundedRectangle: guardExtents("drawRoundedRectangle", r.drawRoundedRectangle),
    drawPolysides: r.drawPolysides, drawSingleCircle: r.drawSingleCircle,
    drawText: r.drawText, drawParametricFunction: r.drawParametricFunction,
    drawPointsInterpolation: r.drawPointsInterpolation, drawFaceOutline: r.drawFaceOutline,
    // Sketch shortcuts
    sketchCircle: guardExtents("sketchCircle", r.sketchCircle),
    sketchRectangle: guardExtents("sketchRectangle", r.sketchRectangle),
    sketchPolysides: r.sketchPolysides,
    sketchRoundedRectangle: guardExtents("sketchRoundedRectangle", r.sketchRoundedRectangle),
    sketchEllipse: guardExtents("sketchEllipse", r.sketchEllipse), sketchHelix: r.sketchHelix,
    sketchFaceOffset: r.sketchFaceOffset, sketchText: r.sketchText,
    // Compound / multi-part
    compoundShapes: r.compoundShapes, makeCompound: r.makeCompound,
    // Wire / face / geometry constructors
    makeHelix: r.makeHelix, makePolygon: r.makePolygon, makeOffset: r.makeOffset,
    makeLine: r.makeLine, makeFace: r.makeFace, makeVertex: r.makeVertex,
    makeCircle: r.makeCircle, makeEllipse: r.makeEllipse, makeEllipseArc: r.makeEllipseArc,
    makeBezierCurve: r.makeBezierCurve, makeThreePointArc: r.makeThreePointArc,
    makeTangentArc: r.makeTangentArc,
    assembleWire: r.assembleWire, addHolesInFace: r.addHolesInFace,
    weldShellsAndFaces: r.weldShellsAndFaces,
    // Plane helpers
    makePlane: r.makePlane, makePlaneFromFace: r.makePlaneFromFace,
    createNamedPlane: r.createNamedPlane,
    // Advanced extrusion / sweep
    loft: r.loft, revolution: r.revolution, genericSweep: r.genericSweep,
    twistExtrude: r.twistExtrude, complexExtrude: r.complexExtrude,
    // Measurement
    measureVolume: r.measureVolume, measureArea: r.measureArea,
    measureLength: r.measureLength, measureDistanceBetween: r.measureDistanceBetween,
    // 2D booleans
    fuse2D: r.fuse2D, cut2D: r.cut2D, intersect2D: r.intersect2D,
    // Orthographic projection (OCC exact HLR) — { visible, hidden } Drawings
    drawProjection: r.drawProjection, makeProjectedEdges: r.makeProjectedEdges,
    ProjectionCamera: r.ProjectionCamera, lookFromPlane: r.lookFromPlane,
    // Serialization
    deserializeShape: r.deserializeShape,
    // Type guards
    isShape3D: r.isShape3D, isWire: r.isWire,
    // Raw OCC access + bridge
    getOC: () => r.getOC(),
    cast: r.cast, downcast: r.downcast, shapeType: r.shapeType, iterTopo: r.iterTopo,
    // Advanced curve/surface helpers
    makeBSplineApproximation: r.makeBSplineApproximation,
    makeNonPlanarFace: r.makeNonPlanarFace, getSingleFace: r.getSingleFace,
    // WASM memory scopes
    localGC: r.localGC, GCWithScope: r.GCWithScope,
    // Named mating anchor (see cadWorker.ts for the full contract + rationale)
    anchor: declareAnchor.bind(null, collect),
    // Named spatial entity — a bay/zone/family the manifest can point interactions at.
    // Build-reported bounds, never stored (ADR-4); see cadWorker.ts for the full contract.
    entity: declareEntity.bind(null, collectEntity),
    // Imported B-rep geometry by asset name (t9-step) — bytes resolved before main()
    // runs, so this is synchronous like every other api call. Throws on an unbound
    // name rather than returning nothing: an empty shape would surface later as a
    // blank drawing or a zero-part export.
    importSTEP: (name) => {
      if (typeof name !== "string" || !name)
        throw new Error('api.importSTEP(name): name must be the asset\'s name, e.g. api.importSTEP("hull.step")');
      const bytes = assets?.[name];
      if (!bytes) {
        const known = Object.keys(assets ?? {});
        // ⚠ The empty-map sentence describes the BINDING this build was handed, never a file
        // store — the engine cannot see one. It used to say "This model has no attached
        // files.", which was FALSE the moment someone had uploaded a file and not bound it
        // (Notebook fe81f7ff). The literal is mirrored by NO_BINDING_SENTENCE in
        // mcp/lib/stepBinding.js, where the worker recognises it and adds what the file
        // store actually holds; test:stepbinding pins the two equal.
        throw new Error(`api.importSTEP("${name}"): no asset by that name is bound to this model.`
          + (known.length ? ` Bound: ${known.map(k => `"${k}"`).join(", ")}.` : " No geometry asset is bound to this model — an uploaded or attached file is not a build input until it is bound as a geometry asset."));
      }
      try {
        return importSTEPSync(r, bytes);
      } catch (err) {
        // OCC's own failure text names neither the file nor the operation.
        throw new Error(`api.importSTEP("${name}"): could not read this file as STEP — ${err?.message ?? String(err)}`);
      }
    },
    // Constants
    DEG2RAD: Math.PI / 180, RAD2DEG: 180 / Math.PI,
  };
}

function bbox(vertices) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, sizeX: maxX - minX, sizeY: maxY - minY, sizeZ: maxZ - minZ };
}

/**
 * Execute model code exactly as cadWorker does. Returns:
 * { ok, error?, parts: [{ name, bbox, obb, volume, vertexCount }], overall, elapsedMs }
 * Shapes are meshed and deleted — safe to call repeatedly (sweeps).
 *
 * opts.edges: also attach mesh.edgeLines (flat segment-endpoint pairs from
 * shape.meshEdges — the exact cadWorker call, app/cadWorker.ts:76-84) so the
 * widget viewer can draw the CAD edge overlay. Default OFF — sweeps/validate
 * don't pay for edges they never read.
 *
 * opts.interference: measure the REAL shared volume of every pair whose bounding boxes
 * penetrate, while the shapes are still alive, and return it as `interference` (a Map keyed
 * by pairKey(i, j)). Default OFF because it costs a boolean per suspect pair — but any
 * caller that reports overlaps to a human or an agent MUST pass it, or the report degrades
 * to the bounding-box guess this whole exercise exists to retire.
 *
 * opts.joints: the model's `ModelJoint[]`. Supplying them turns on the SWEPT-COLLISION pass —
 * every joint posed across its declared min→max, with the real intersection volume re-measured
 * at each step (`swept`, and `opts.swept` for its knobs). Absent ⇒ no sweep, and the verdict
 * says nothing about what the rig reaches. It is the one input here that does not come from
 * `code`: joints are model data, so no default can supply them.
 */
export async function runModel(code, opts = {}) {
  const r = await initReplicad();
  const oc = r.getOC();
  const t0 = Date.now();
  // Visible to the catch below — the profiler is the only thing that knows which
  // operation an OCC pointer-throw came out of (t25-w3).
  let profRef = null;
  try {
    // Named anchors are a build output — this is the headless discovery path an
    // agent uses to find out what a model offers to mate against.
    const anchorMap = new Map();
    // Same for named entities — this is the headless discovery path for "what can be
    // selected and acted on in this model", and it must agree with the tab's answer.
    const entityMap = new Map();
    const rawApi = buildApi(r, a => anchorMap.set(a.name, a), opts.assets, e => entityMap.set(e.id, e));
    // t8-7: the op-level split of exec. On by default because this IS the agent's
    // only window into build cost — the browser console is not available to a
    // headless push. `opts.profile: false` opts out. ⚠ restore() runs in a finally
    // and BEFORE meshing, or mesh/meshEdges land in the exec profile and every
    // share is quoted against the wrong denominator.
    const prof = opts.profile === false ? null : profileApi(rawApi);
    profRef = prof;
    const api = prof ? prof.api : rawApi;
    const tExec0 = Date.now();
    let result;
    try {
      const execFn = new Function("api", `${code}\nreturn main(api);`);
      result = execFn(api);
    } finally {
      prof?.restore();
    }
    const execMs = Date.now() - tExec0;
    const ops = compactProfile(prof?.report());
    if (!result) return { ok: false, error: "main() returned nothing", parts: [], anchors: [], elapsedMs: Date.now() - t0 };

    const namedParts = Array.isArray(result)
      ? result
      : [{ name: "model", shape: result }];

    const tMesh0 = Date.now();
    const parts = namedParts.map(({ name, shape }) => {
      const mesh = shape.mesh(MESH_OPTS);
      if (opts.edges) {
        try { mesh.edgeLines = shape.meshEdges(MESH_OPTS)?.lines ?? []; }
        catch { mesh.edgeLines = []; /* edges are decoration — never fail the build for them */ }
      }
      let volume = null;
      try { volume = r.measureVolume(shape); } catch { /* compounds can fail */ }
      const bb = mesh.vertices?.length ? bbox(mesh.vertices) : null;
      // The oriented blank (t14-sweep B1b) — must be taken while the shape is still
      // alive, and AFTER mesh() so AddOBB reuses that triangulation. Mirrors
      // cadWorker's call site exactly; both go through app/lib/obb.ts.
      const ob = bb
        ? orientedExtents(oc, shape.wrapped, { w: bb.sizeX, d: bb.sizeY, h: bb.sizeZ })
        : null;
      return { name, bbox: bb, obb: ob, volume, vertexCount: (mesh.vertices?.length ?? 0) / 3, mesh };
    });
    const meshMs = Date.now() - tMesh0;

    // ⚠ Must run while `namedParts` still holds live shapes. runModel never deletes them
    // (they die with the process / the GC), but a caller that measures LATER has only the
    // meshes — which is exactly how the overlap rule ended up comparing boxes.
    const tInt0 = Date.now();
    let interference = null;
    const interferenceOpts = resolveMeasureOpts(opts.interference);
    if (interferenceOpts) {
      try {
        interference = measureInterference(oc, namedParts.map(({ name, shape }, i) => ({
          name, shape, bb: parts[i]?.bbox ?? null,
        })), interferenceOpts);
      } catch (e) {
        // No map ⇒ every overlap finding hedges and says it could not measure. Never a
        // silent pass: the degraded state is visible in the message the agent reads.
        console.warn(`[runner] interference sweep failed — overlap findings fall back to bounding boxes: ${e?.message ?? e}`);
      }
    }
    const interferenceMs = Date.now() - tInt0;

    // ⚠ SAME WINDOW, SAME REASON as the interference pass above — this reads the B-rep, and
    // every caller downstream of the mesh pass has only meshes. It is the first check in this
    // engine that asks whether each SOLID is actually a solid; everything else reads the
    // triangulation, which is how a single solid holding more volume than its own bounding box
    // has been passing green (scripts/headless/probe-solid-soundness.mjs, 7 of 7).
    //
    // ⭐ IT RIDES `opts.interference`'s SWITCH BY DEFAULT, and that is deliberate. Both passes
    // answer the same question — "is this build being REPORTED to a human or an agent?" — so
    // tying them means no reporting caller can forget to ask for one of the two: the geometry
    // service's /validate route and buildVerdict() both get it by construction, with no edit.
    // `opts.soundness` overrides in either direction when a caller genuinely wants one and not
    // the other — the escape hatch is named rather than implied [[feedback_degrade_dont_remove]].
    //
    // ⚠⚠ RIDING THE SWITCH IS NOT ENOUGH FOR A MULTI-POINT CALLER, and the S1 build proved it.
    // The default hands EVERY point the full per-build budget, so a sweep pays it N times over.
    // scripts/headless/sweep.mjs therefore passes `soundness` EXPLICITLY, from
    // `soundnessOptsForPoints()` — the same shape as `exhaustiveOptsForPoints`. Any new caller
    // that builds the same code many times must do the same, or it silently blows its own clock.
    const tSnd0 = Date.now();
    let soundness = null;
    const soundnessSpec = opts.soundness === undefined ? (interferenceOpts ? true : false) : opts.soundness;
    const soundnessOpts = soundnessSpec === false || soundnessSpec == null
      ? null
      : (soundnessSpec === true ? {} : soundnessSpec);
    if (soundnessOpts) {
      try {
        soundness = measureSoundness(oc, namedParts.map(({ name, shape }) => ({ name, shape })), soundnessOpts);
      } catch (e) {
        // Left null ⇒ soundnessProblems() reports "no soundness check ran on this build"
        // rather than silence. A verdict that could not look must never read as a clean one.
        console.warn(`[runner] soundness pass failed — the verdict will say it could not check the solids: ${e?.message ?? e}`);
      }
    }
    const soundnessMs = Date.now() - tSnd0;

    // ⭐⭐ THE SWEPT PASS (t7-sweptcheck) — the same window again, and the first check that asks
    // about a pose this build never produced. Everything above measures the model AS BUILT, which
    // is joints-at-rest, always; a rig is INVISIBLE AT REST (app/lib/jointTree.ts), so the Base
    // Cabinet's door swung through its own side panel through a declared 0–100° range with every
    // instrument green (Notebook bdb97023). This poses each joint across its range and re-measures
    // the real intersection volume at each step.
    //
    // ⚠ IT DOES NOT RIDE `opts.interference`'s SWITCH, and that is not an oversight. Interference
    // and soundness are derivable from the CODE, so a default can decide for them. Joints are
    // MODEL DATA — nothing in `code` mentions them — so there is nothing to default to: a caller
    // that has the rig passes `opts.joints`, and one that does not gets silence rather than a
    // guess. `opts.swept` tunes it (steps / budgetMs / maxPairs); `false` turns it off with the
    // joints still in hand.
    //
    // ⚠ AND IT IS NOT ON THE INTERACTIVE PATH. app/cadWorker.ts does not call this: a sweep is the
    // interference cost multiplied by the step count, and a slider drag must not pay it.
    const tSwp0 = Date.now();
    let swept = null;
    const sweptOpts = opts.swept === false || opts.swept == null ? (opts.swept === false ? null : {}) : (opts.swept === true ? {} : opts.swept);
    if (Array.isArray(opts.joints) && opts.joints.length && sweptOpts) {
      try {
        swept = measureSweptCollision(
          oc,
          namedParts.map(({ name, shape }, i) => ({ name, shape, bb: parts[i]?.bbox ?? null })),
          opts.joints,
          // The rest verdicts the interference pass just produced, keyed over THIS SAME array —
          // so the baseline ("which pairs are already inside each other before anything moves")
          // costs nothing when it has already been paid for.
          { ...sweptOpts, restVerdicts: interference },
        );
      } catch (e) {
        // ⚠⚠ NOT LEFT NULL ANY MORE, AND THAT USED TO READ AS CLEAN (t7-sweepdoor).
        // `null` is this pass's encoding for "no joints were supplied" — sweptProblems() turns it
        // into SILENCE, deliberately, because most models have no rig. A THROW was writing the
        // same value, so a sweep that crashed was indistinguishable from one nobody asked for: it
        // dropped `sweptMs` with it (the `swept ?` in `timings` below), left zero findings, and
        // its only trace was this console.warn — which an MCP caller, whose whole point is that
        // there is no browser console, never sees. Interference and soundness both leave a VISIBLE
        // degraded state on throw; this was the one pass that did not
        // [[feedback_silent_catch_hides_holes]].
        // Now the throw becomes a finding, so it travels to every reader of the verdict through
        // the machinery that was already there. `sweptFailure` lives in app/lib/sweptCollision.ts
        // because that module CONSTRUCTS both rule ids and nothing else may (guard S27) — a
        // `rule:` literal here would trip it, and rightly.
        swept = sweptFailure(String(e?.message ?? e));
        console.warn(`[runner] swept-collision pass failed — this verdict says nothing about what the joints reach: ${e?.message ?? e}`);
      }
    }
    const sweptMs = Date.now() - tSwp0;

    const withGeom = parts.filter(p => p.bbox);
    const overall = withGeom.length ? {
      minX: Math.min(...withGeom.map(p => p.bbox.minX)), maxX: Math.max(...withGeom.map(p => p.bbox.maxX)),
      minY: Math.min(...withGeom.map(p => p.bbox.minY)), maxY: Math.max(...withGeom.map(p => p.bbox.maxY)),
      minZ: Math.min(...withGeom.map(p => p.bbox.minZ)), maxZ: Math.max(...withGeom.map(p => p.bbox.maxZ)),
    } : null;
    if (overall) {
      overall.sizeX = overall.maxX - overall.minX;
      overall.sizeY = overall.maxY - overall.minY;
      overall.sizeZ = overall.maxZ - overall.minZ;
    }

    return {
      ok: true, parts, overall, anchors: [...anchorMap.values()], elapsedMs: Date.now() - t0,
      // Stamped even when empty — [] is "this code declares none", absent is "nobody looked".
      entityReport: { v: ENTITY_REPORT_VERSION, codeHash: createHash("sha256").update(code).digest("hex"), entities: [...entityMap.values()] },
      // A Map — in-process only. ⚠ services/geometry/server.mjs strips it before any
      // response is serialized (JSON.stringify would render a Map as `{}`).
      interference,
      // ⚠ A PLAIN ARRAY, and that is load-bearing rather than a style choice — see the Map
      // warning three lines up. `[]` means the pass ran and found nothing; `null` means nobody
      // looked, and soundnessProblems() says so out loud rather than reading as clean.
      soundness,
      // ⚠ A PLAIN ARRAY OR `null`, for the same serialization reason as `soundness` — and here
      // `null` means the sweep did not run (no joints were supplied, or it threw), which
      // sweptProblems() reports as SILENCE rather than as a hole. That asymmetry is argued in
      // full on sweptProblems; it is the one absence in this file that is not a claim.
      swept,
      // Mirrors the cadWorker message's `timings` field for field, so the two
      // build verdicts an agent can receive describe cost the same way.
      timings: { execMs, meshMs, ...(interferenceOpts ? { interferenceMs } : {}), ...(soundnessOpts ? { soundnessMs } : {}), ...(swept ? { sweptMs } : {}), ...(ops ? { ops } : {}) },
    };
  } catch (e) {
    // Decoded through the ONE helper rather than inline, so this verdict and cadWorker's
    // cannot describe the same OCC throw differently — and so the 1.0.0 value type is
    // handled in one place instead of six (app/lib/occError.ts, §3 F4, §8 K3 P1).
    const msg = occErrorText(e, ocFrom(r));
    // ⭐ t25-w3: say WHERE. `Cannot read properties of undefined (reading 0)` with no line,
    // no operation and a verdict telling the agent to "fix ONLY the broken operation" is
    // an instruction that cannot be followed — the reporting driver rewrote its placement
    // logic wholesale. Appends only; the message prefix stays byte-identical so the learned
    // -rule citations that match on it keep matching (app/lib/execError.ts).
    // ⚠ `profRef` is captured OUTSIDE the try, because the throw can happen before or after
    // `prof` is assigned and a `let` declared in the try body is not in scope here.
    return {
      ok: false,
      error: attributeExecError(msg, e, code, profRef?.failedOp?.() ?? null),
      parts: [], anchors: [], elapsedMs: Date.now() - t0,
    };
  }
}

/**
 * Execute model code and serialize the result to a CAD interchange format.
 * format: "step" (named multi-part assembly) | "stl" (single mesh, parts compounded).
 * Returns a Buffer.
 */
export async function exportModel(code, format = "step") {
  const r = await initReplicad();
  const api = buildApi(r);
  const execFn = new Function("api", `${code}\nreturn main(api);`);
  const result = execFn(api);
  if (!result) throw new Error("main() returned nothing");
  const named = Array.isArray(result) ? result : [{ name: "model", shape: result }];

  let blob;
  if (format === "step") {
    blob = await r.exportSTEP(
      named.map(({ shape, name }) => ({ shape, name: name ?? "part" })),
      { modelUnit: "MM" }
    );
  } else if (format === "stl") {
    const shape = named.length === 1 ? named[0].shape : r.compoundShapes(named.map(p => p.shape));
    blob = shape.blobSTL({ tolerance: 0.05, angularTolerance: 0.3 });
  } else {
    throw new Error(`Unsupported format: ${format} (use "step" or "stl")`);
  }
  return Buffer.from(await blob.arrayBuffer());
}

/** Parse `const name = value; // [min:max]` annotations (same grammar as Studio).
 * Also recognizes `[0:1] toggle` and `[0:N] choices: a|b|c` — values stay numeric
 * (toggle 0/1, enum index), so sweeps exercise every topology branch automatically. */
export function parseParams(code) {
  const params = [];
  const re = /const\s+(\w+)\s*=\s*(-?[\d.]+)\s*;?\s*\/\/[^\[\n]*\[(-?[\d.]+):(-?[\d.]+)\]([^\n]*)/g;
  let m;
  while ((m = re.exec(code))) {
    const p = { name: m[1], value: parseFloat(m[2]), min: parseFloat(m[3]), max: parseFloat(m[4]) };
    const tail = m[5] ?? "";
    const choices = tail.match(/choices:\s*([\w][\w \-|]*)/);
    if (choices) { p.kind = "enum"; p.choices = choices[1].split("|").map(s => s.trim()).filter(Boolean); }
    else if (/\btoggle\b/.test(tail)) p.kind = "toggle";
    params.push(p);
  }
  return params;
}

/** The COMPLEMENT of parseParams: numeric consts that carry NO `// [min:max]` annotation.
 *
 * `axle explain` prints these beside the parameters so the answer to "why won't --param take
 * railLength?" is on the page instead of in the file: the const exists, it is a number, and
 * nothing declared a range for it. It sits HERE, beside parseParams, so the const grammar has
 * one home — a second reader of `const NAME = 10;` in cli.mjs would drift from this one the
 * day the annotation grammar grows. Same scope rule as parseParams (anywhere in the code, not
 * only top level), so what this lists and what --param refuses are the same set. */
export function parsePlainConsts(code) {
  const annotated = new Set(parseParams(code).map((p) => p.name));
  const out = [];
  const re = /const\s+(\w+)\s*=\s*(-?[\d.]+)\s*;?[ \t]*(?:\/\/[^\n]*)?(?=\r?\n|$)/g;
  let m;
  while ((m = re.exec(code))) {
    if (!annotated.has(m[1])) out.push({ name: m[1], value: parseFloat(m[2]) });
  }
  return out;
}

/** Rewrite a parameter literal in code (same mechanism as Studio's slider). */
export function setParam(code, name, value) {
  return code.replace(new RegExp(`(const\\s+${name}\\s*=\\s*)-?[\\d.]+`), `$1${value}`);
}
