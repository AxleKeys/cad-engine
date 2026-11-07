// The check_dimensions comparison — "is the overall size the size that was asked for?" — as ONE
// module with three callers (t31-kitchen, local-engine-plan §6l; admitted to the pack by §8
// decision 7, RULED 2026-09-23):
//
//   • the hosted route   worker/index.js  POST /mcp/model/:id/check-dimensions  (the MCP tool)
//   • the campaign scorer worker/index.js trScoreTrial (Training), through dimensionVerdict ONLY
//   • the local engine   packages/engine/cli.mjs  `axle check-dimensions`
//
// ⭐ WHAT JOINED THE PACK, AND WHAT DID NOT. Decision 7 admits the COMPARISON — arithmetic over a
// bounding box the pack already prints, against a band the tool's own description publishes. The
// STORED BRIEF stays home: the hosted route reads its targets from the request body, and the pack
// reads them from numbers the user typed on the command line. Nothing here reads a brief.
//
// ⚠ This was a function defined INLINE in the worker's fetch handler until 2026-09-24, and
// `worker/` is not a guard S27 scan root, so no guard could see it. It moved here BYTE-FOR-BYTE in
// behaviour: test:kitchen runs the old inline function (read from git at 7a14987c) and this one
// over a grid of inputs and asserts identical output, and scripts/headless/characterize-kitchen-
// routes.mjs drives the old and new worker routes with the same requests and compares responses.
//
// Pure, no imports, erasable TypeScript only: the worker bundles it, the engine loads it by Node's
// native type-stripping, and the exporter erases it to .js for the npm door (D-A1).

/** Measured overall extents, mm. width = X, depth = Y, height = Z. */
                                    
                
                
                 
 

/** Target extents, mm; null/undefined = not asked. */
                                     
                                   
                                   
                                    
 

                           
                                                            
                                                                     

/**
 * ⭐ ONE dimensional verdict, shared by the route and the campaign scorer (and now the pack).
 * Mirrors studio.tsx evaluateBriefCompliance exactly: per-axis pass if the measured extent is
 * within max(5%, 3mm) of the target; overall pass needs at least one checked axis and zero
 * off-axes.
 *
 * ⚠ It is a FUNCTION rather than a comment because the scorer is the second caller and a rule in
 * a comment gets re-learned. A trial scored at a different tolerance from the one its card told
 * the driver to hit would be a number that means nothing, and nothing would report the
 * disagreement.
 *
 * ⭐⭐ `toleranceMm` REPLACES the default band outright — it never tightens one half of it (t25-w3,
 * Notebook `8bcff70a`). A caller asking ±0.5mm and silently getting ±3mm because the floor still
 * applied is the same lie in a smaller font, and it is the lie the argument exists to remove:
 * three cold drivers reported that a bench measuring 945mm passes a 900mm ask, and that on a 6mm
 * axis the 3mm floor lets 3–9mm all read `pass: true`. ⛔ "Exact mode" is simply
 * `tolerance_mm: 0.5` — there is no second spelling of this idea, and adding one would be two names
 * for one band.
 *
 * ⚠⚠ THE DEFAULT MUST NOT MOVE, and that is the whole reason this is an ARGUMENT rather than a
 * retune. The campaign scorer (`POST /mcp/training/run/:id/score`) passes no tolerance; a trial
 * scored at a tolerance different from the one its card told the driver to hit is a number that
 * means nothing. It keeps the band it was written against.
 */
export function dimensionVerdict(measured                   , requested                    , toleranceMm                = null) {
  const TOL = 0.05, FLOOR_MM = 3;
  const explicit = typeof toleranceMm === "number" && Number.isFinite(toleranceMm) && toleranceMm >= 0;
  const allow = explicit ? () => toleranceMm           : (want        ) => Math.max(want * TOL, FLOOR_MM);
  const offAxes                                      = [];
  let checked = 0;
  for (const axis of ["width", "depth", "height"]         ) {
    const want = requested[axis];
    if (want === null || want === undefined) continue;
    checked++;
    if (Math.abs(measured[axis] - want) > allow(want)) offAxes.push(axis);
  }
  // The band that was ACTUALLY APPLIED, in the response and in both messages. `pass` means nothing
  // without it — that was half the reported defect, drivers having learned to read `measured` and
  // ignore the boolean.
  const band                = explicit
    ? { mode: "explicit", tolerance_mm: toleranceMm          , rule: `±${toleranceMm}mm on every axis` }
    : { mode: "default", pct: TOL, floor_mm: FLOOR_MM, rule: `±${TOL * 100}% or ${FLOOR_MM}mm per axis, whichever is larger` };
  return { pass: checked > 0 && offAxes.length === 0, checked, offAxes, TOL, FLOOR_MM, band };
}

/**
 * Read a check_dimensions request — `{ width?, depth?, height?, tolerance_mm? }` in mm — into the
 * targets and the tolerance, or a refusal. The route's body and the CLI's flags both come through
 * here, so "what counts as a target" and "what tolerance is refused" are decided once.
 *
 * Targets: a positive number is a target; anything else on an axis means that axis was not asked
 * (the route's rule since it shipped). At least one target is required.
 *
 * ⚠ The tolerance is VALIDATED, NEVER COERCED. A check that quietly substitutes its own tolerance
 * for the one it was asked for is precisely the defect the argument removes, so nonsense is a
 * refusal rather than a silent fall back to the default band — a verdict measured at a tolerance
 * you did not ask for is worse than no verdict [[feedback_refusal_must_be_legible]].
 *
 * The two refusal sentences are the route's 400 bodies, verbatim.
 */
export function readDimensionRequest(body     ) 
                                                                 
                      {
  const num = (x         ) => (typeof x === "number" && x > 0 ? x : null);
  const requested = { width: num(body.width), depth: num(body.depth), height: num(body.height) };
  if (requested.width === null && requested.depth === null && requested.height === null) {
    return { error: "Pass at least one positive target dimension (width, depth, and/or height) in mm." };
  }
  let toleranceMm                = null;
  if (body.tolerance_mm !== undefined && body.tolerance_mm !== null) {
    if (typeof body.tolerance_mm !== "number" || !Number.isFinite(body.tolerance_mm) || body.tolerance_mm < 0) {
      return {
        error: "tolerance_mm must be a non-negative number of millimetres (e.g. 0.5 for a tight fit). Nothing was measured. This is refused rather than falling back to the default 5%-or-3mm band, because a pass/fail computed at a tolerance you did not ask for reads exactly like one you did.",
      };
    }
    toleranceMm = body.tolerance_mm;
  }
  return { requested, toleranceMm };
}

/**
 * The comparison as the check_dimensions tool REPORTS it: the verdict, the measured size (to
 * 0.01mm), the band that was applied, and one sentence. The route answers
 * `{ ok: true, built: true, ...dimensionReport(...) }`; `axle check-dimensions --json` prints the
 * same object. ⚠ BOTH messages name the band that was applied. "Built what was asked" read as
 * exact confirmation to three drivers who were being told something much weaker.
 */
export function dimensionReport(measured                   , requested                    , toleranceMm               ) {
  const { pass, checked, offAxes, band } = dimensionVerdict(measured, requested, toleranceMm);
  const round = (n        ) => Math.round(n * 100) / 100;
  return {
    pass,
    checked,
    offAxes,
    requested,
    measured: { width: round(measured.width), depth: round(measured.depth), height: round(measured.height) },
    tolerance: band,
    units: "mm"         ,
    message: pass
      ? `Built what was asked — overall size within ${band.rule} on ${checked} axis/axes.` +
        (band.mode === "default" ? " That band is deliberately loose; pass tolerance_mm for a tighter check." : "")
      : `Off on ${offAxes.join(", ")} (axis convention width=X, depth=Y, height=Z; tolerance applied: ${band.rule}).`,
  };
}
