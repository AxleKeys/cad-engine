// Solid soundness — is each SOLID actually a solid?
//
// ⭐ THIS FILE EXISTS BECAUSE EVERY OTHER SHIPPED CHECK READS THE TRIANGULATION.
// `empty_mesh`, `degenerate_dimension`, the overlap rule, the bearing rule — all of them look
// at vertices. None of them asks the B-rep whether the thing that produced those vertices is
// closed, positively oriented, or topologically valid. So a solid that OCC itself regards as
// garbage carries a GREEN verdict, because by the time the validator looks, the shape has
// already been flattened into vertices that look perfectly plausible.
//
// ⭐⭐ THAT IS MEASURED, NOT ARGUED. `scripts/headless/probe-solid-soundness.mjs` (t31 S0,
// 2026-08-30, 30 model-code cases) minted SEVEN solids that are physically impossible — a
// SINGLE solid holding more volume than its own bounding box — through ordinary model code
// that any customer's agent can write (`makeBaseBox(100,100,6.35).fillet(5)` is one of them:
// 101,980mm³ out of a 63,500mm³ blank). All seven passed the build verdict green AND passed
// `check_dimensions` exactly. The population was fixed by an arithmetic oracle no candidate
// rule helped choose, so "7 of 7" is a measurement rather than a definition read back
// [[feedback_proxy_metric_manufactures_a_finding]].
//
// ⚠⚠ TWO RULES, NOT ONE, AND THE PROBE IS THE REASON. Anyone shrinking this file back to a
// single volume test should read these numbers first — they are per-rule fire counts over
// those 7, with false positives over 14 legitimate controls and the 118-part mondrian fixture:
//
//   RULE A  non_positive_volume   signed volume, OnlyClosed=false        1 of 7   · 0 · 0
//   RULE B  unclosed_volume       |volClosed|<eps && |volOpen|>eps       6 of 7   · 0 · 0
//   EITHER of the two                                                    7 of 7   · 0 · 0
//
// Neither is redundant, and the run shows it in both directions:
//   · `makeBaseBox(60,60,40).shell(-3, f => f.inPlane("XY", 20))` — the selector matches NO
//     face, `shell()` does not throw, and it returns a solid whose signed volume is NEGATIVE
//     (−199,037) while every other read calls it fine. Only rule A sees it.
//   · in the fillet band the sign is POSITIVE and the CLOSED integral is the one that refuses.
//     Only rule B sees those.
//
// ⛔⛔ THERE WAS A THIRD RULE AND IT IS GONE ON PURPOSE. `invalid_topology`
// (`BRepCheck_Analyzer`) was built here, shipped in the S1 working tree, measured, and removed
// before it ever reached a customer — for a WASM heap leak and a false positive on Axle's own
// font. `solid-soundness-plan.md` still recommends it BY NAME, so the next reader will reach
// for it in good faith. The full removal record, with both numbers and the control that
// settled it, is at the bottom of `checkOneSolid()`. Read it before re-adding anything.
//
// ⚠ KEPT DEPENDENCY-FREE ON PURPOSE, exactly like support.ts and execProfile.ts:
// packages/engine/checks.mjs imports this through Node's native TypeScript type-stripping, so
// it must not reach for anything that needs a bundler, and it must not use non-erasable TS
// (no enums, no namespaces, no parameter properties). The one import below is a sibling in
// app/lib and carries its `.ts` extension for exactly that reason.
//
// ⚠ MEASUREMENT MUST HAPPEN WHILE THE SHAPES ARE ALIVE — the same constraint as
// interference.ts, and for the same reason: this reads the B-rep, and every caller downstream
// of the mesh pass has only meshes. So this file is split the same way:
//   · measureSoundness()  — needs OCC and live shapes. Runs inside the build.
//   · soundnessProblems() — pure. Projects what was measured (or says nobody looked).
//
// ⭐ THE BROWSER TWIN LANDED 2026-09-01 AND THIS FILE IS THE ONLY PLACE EITHER RULE EXISTS.
// `app/cadWorker.ts` calls measureSoundness() on BOTH its paths, inside the same live-shape
// window as the interference sweep and before the `shape.delete()` that ends it, and
// `app/lib/validator.ts` projects the result through soundnessProblems() exactly as
// packages/engine/checks.mjs does. The parity test's ENGINE_ONLY_RULES set is now EMPTY.
//
// ⚠⚠ THE SINGLE-SOLID PATH WAS THE HALF THAT MATTERED, and it was worse than a missing rule:
// it posted `validation: null` and ran NO checks of any kind, while the engine normalizes the
// identical result to `[{ name: "model", shape }]` and runs all of them. So for a one-solid
// model — which is exactly what `makeBaseBox(100,100,6.35).fillet(5)` is — the tab and the
// agent were never looking at comparable verdicts, and Studio showed the PREVIOUS model's
// warnings because setValidationWarnings had one writer and it was in the other branch.
//
// ⚠ GUARD S27 CANNOT SEE cadWorker.ts. Its SCAN_ROOTS cover app/lib, not app/, so nothing
// mechanical stops a future session re-typing a volume test in the worker. The parity test is
// the real fence: it compares engine findings to browser findings on these rule ids now.

import { forEachSolid } from "./interference.js";

/** mm³ around zero that counts as zero.
 *
 *  ⚠⚠ THIS EPSILON IS NOT DECORATION, AND THE PLAN SAID IT WAS. `solid-soundness-plan.md` §3
 *  used to argue the volume rule needed no tolerance — *"negative is inverted, zero is
 *  degenerate, the sign is the verdict"*. MEASURED by S0's own positive control: a
 *  deliberately zero-volume solid (two coincident shells of opposite sense, enclosing nothing)
 *  reads **+1.27e-11** — strictly POSITIVE. A bare `<= 0` never sees it, and the probe's first
 *  gate missed that for a run because the gate tested `|v| < 1e-9` while the rule tested
 *  `v <= 0`. The sign is still the verdict and there is still no BAND to mis-tune, but zero
 *  needs a neighbourhood. 1e-6 mm³ is ~5 orders above the observed noise and smaller than any
 *  feature any real model has (a 1µm cube is 1e-9 mm³). */
export const VOL_EPS = 1e-6;

/** The caps. EXPORTED so an acceptance test asserts against the shipped numbers rather than
 *  re-typed copies — a hard-coded 512 in a test goes green on the day the real cap moves.
 *
 *  ⭐ AS SHIPPED, on the largest fixture in the repo (scripts/headless/fixtures/mondrian-p3b.js,
 *  118 parts / 118 solids; 2026-08-30, Node v24.14.0, medians of 5–9 warmed reps):
 *
 *    the pass, self-timed (runner's `timings.soundnessMs`)   55–64 ms   = 0.47 ms/part
 *    the same pass WITH the removed analyzer rule           ~273 ms     = 2.31 ms/part
 *
 *  So dropping rule C took ~77% of the cost out with it. Both figures reproduce the original
 *  S1 measurement (56ms for the volume reads, 271ms for the analyzer) on a different day.
 *
 *  ⚠ THE ADDED COST IS SMALLER THAN THIS FIXTURE'S OWN NOISE, so it has to be measured PAIRED
 *  or not at all: an unpaired median-of-5 comparison reported soundness making the build 65 ms
 *  FASTER, because run-to-run spread on a 118-part build is ±90 ms. Interleaved arms, 9 pairs:
 *  the median per-pair difference is **+52 ms**, which agrees with the pass's own 55 ms clock.
 *  Quote the self-timed number; never quote a difference of two independent medians here.
 *
 *  A pathological single part is far worse than this fixture's average: the INVALID fillet(5)
 *  plate has cost 39.8–74.4ms for its two volume reads ALONE across probe runs (the wider
 *  figure is S1's, the narrower one 2026-08-30 — quote the probe, not this comment). So the
 *  BUDGET is what actually bounds a bad model, and the solid cap is the ceiling on a compound
 *  nobody predicted. The 2000ms budget sits ~32× above the largest fixture's measured cost, so
 *  nothing in the repo trips the cap and a pathological model stops loudly instead of hanging.
 *
 *  ⚠ THE BUDGET IS CHECKED BETWEEN SOLIDS, so one slow solid overruns it — a sweep point with
 *  a 444ms share was measured at 737ms. It bounds the work, it does not preempt it. That is the
 *  same property `measureInterference`'s budget has, and the alternative (abandoning a read
 *  mid-integral) is not available through this API.
 *
 *  Both caps DEGRADE LOUDLY — whatever was not reached is reported with a count, never
 *  dropped [[feedback_degrade_dont_remove]]. */
export const DEFAULT_MAX_SOLIDS = 512;
export const DEFAULT_SOUNDNESS_BUDGET_MS = 2000;

/** ⭐⭐ A SWEEP RUNS ONE BUILD PER PARAMETER POINT, so the per-build budget above is the WRONG
 *  UNIT for it — the identical mistake `exhaustiveOptsForPoints` exists to fix for
 *  interference, and the S1 build walked straight into it: sweepModel handed every point the
 *  full 2000ms, so a 603-point sweep could have spent 20 minutes on soundness alone against a
 *  /sweep route whose ceiling is 300s (480s exhaustive — services/geometry/server.mjs:621).
 *  A check that silently blows its caller's clock turns a slow-but-correct certification into
 *  a dead job, which teaches the caller nothing about anything.
 *
 *  So the sweep gets a TOTAL, divided EVENLY — evenly for the same reason interference is:
 *  every point is equally part of "every reachable configuration is clean", and a greedy
 *  budget lets the early points spend the late ones' share. A point that overruns its share
 *  reports partial coverage for ITSELF (the soundness_coverage line) and the sweep carries on.
 *
 *  ⭐ THE FLOOR IS CHOSEN SO THE TOTAL ACTUALLY HOLDS, which is where the interference
 *  precedent is loose: its floor of 400ms × 603 points is 241s against a stated 180s total.
 *  20,000 / 25 = 800, so for any sweep up to 800 points the shares sum to ≤ 20s exactly, and
 *  beyond that it grows linearly and slowly. 20s is 6.7% of the ordinary /sweep ceiling and
 *  4.2% of the exhaustive one, so no ceiling has to move to admit this pass.
 *
 *  ⚠ 25ms is deliberately below what a big model needs — the 118-part mondrian fixture's full
 *  pass measures 62ms — so a sweep of a very large model at very many points WILL report
 *  partial coverage per point. That is the intended failure: loud and partial, never silent
 *  and whole [[feedback_degrade_dont_remove]]. */
export const SWEEP_SOUNDNESS_BUDGET_MS = 20_000;
export function soundnessOptsForPoints(pointCount        )                {
  const share = Math.floor(SWEEP_SOUNDNESS_BUDGET_MS / Math.max(1, pointCount || 1));
  return { budgetMs: Math.min(DEFAULT_SOUNDNESS_BUDGET_MS, Math.max(25, share)) };
}

/** A part as the build holds it, while its B-rep is still alive. `shape` is the replicad
 *  wrapper; only `.wrapped` (the raw TopoDS_Shape) is ever touched here. */
                                 
               
                                   
 

                                
                                                                             
                     
                                                                                      
    
                                                                                        
                                                                                          
                                                                                              
                    
 

                                   
                                                                         
                                                                                             
                                                                                            
                                                                                            
                                                                                               
                                                                                              
                                                               
    
                                                                               
                                                                                            
                                                                                          
                                                                                            
                                                                                          
                                                                                           
                                                                    
                                
                  
                                                                                      
                                                                                                          
                       
 

// ── The two reads. Each returns {ran} rather than a value it could not take. ───────────────

/** ⚠ OCC throws a BARE NUMBER (an exception pointer) rather than an Error on some inputs — a
 *  null shape handed to BRepCheck_Analyzer was the one this was measured on — so `e.message`
 *  is `undefined` and a naive catch reports nothing at all. Measured in S0 LEG 1. The analyzer
 *  is gone from this file (see checkOneSolid) and the hazard is not: it is a property of the
 *  embind glue, not of that one call. */
const errText = (e     )         =>
  typeof e === "number" ? `OCC exception pointer ${e}` : String(e?.message ?? e);

                                                                          

/**
 * Signed volume of ONE solid, in mm³.
 *
 * ⚠⚠ TWO ARGUMENTS OF THIS CALL ARE TRAPS AND BOTH FAIL OPEN.
 *
 * Arg 5 `UseTriangulation` MUST be false: true MUTATES the shared TShape, and our shapes are
 * shared across the measure and mesh passes of the same build (plan §4e trap 3).
 *
 * Arg 3 `OnlyClosed` is the FIFTH trap and it fails open in BOTH directions. The repo's only
 * precedent — `app/lib/interference.ts`'s commonVolume — passes it `false`, correctly, for the
 * question THAT file asks. Copy it verbatim into a soundness rule and the rule fires on 1 of 7
 * reachable garbage solids. But flipping it to `true` is NOT the fix: on those same solids
 * `VolumeProperties_1` then returns EXACTLY integer 0 — the accumulator's untouched initial
 * value, because OCC declined to integrate the shell at all — while a genuinely zero-volume
 * solid returns +1.8e-12 under that same flag. So `0` under `OnlyClosed=true` is a
 * COULD-NOT-MEASURE SENTINEL WEARING A MEASUREMENT'S CLOTHES. Hence two separately named
 * rules below, never one with a flag.
 *
 * ⚠ ALSO NOT COPIED FROM THAT PRECEDENT: its `Math.abs()`. The sign IS the measurement here —
 * an inverted solid is exactly what rule A exists to find, and abs() erases it.
 */
function signedVolume(oc     , solid     , onlyClosed         )       {
  let props      = null;
  try {
    if (!solid || solid.IsNull?.()) return { ran: false, reason: "the solid handle was null" };
    props = new oc.GProp_GProps_1();
    // (S, VProps, OnlyClosed, SkipShared, UseTriangulation)
    oc.BRepGProp.VolumeProperties_1(solid, props, !!onlyClosed, false, false);
    const value = props.Mass();
    if (!Number.isFinite(value)) return { ran: false, reason: "the volume integral returned a non-finite value" };
    return { ran: true, value };
  } catch (e) {
    return { ran: false, reason: errText(e) };
  } finally {
    try { props?.delete(); } catch { /* already gone */ }
  }
}

// ── Findings ──────────────────────────────────────────────────────────────────

const fmt = (v        ) => {
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a === 0) return "0";
  if (a < 1e-4) return v.toExponential(2);
  return v.toFixed(4);
};

/** `solid 2 of 5 of part 'shelf'` — or just the part when it holds one solid, because "solid 1
 *  of 1" reads like there is somewhere else to look. */
const where = (name        , i        , n        ) =>
  n > 1 ? `solid ${i + 1} of ${n} in part '${name}'` : `part '${name}'`;

/**
 * Read every solid of every part and return the findings it earned. Needs live B-rep shapes.
 *
 * Returns a PLAIN ARRAY, and that is load-bearing rather than a style choice: `runModel`'s
 * `interference` field is a `Map`, and `services/geometry/server.mjs` has to strip it by name
 * before any response is serialized because `JSON.stringify` renders a Map as `{}` — a field
 * that reads as an empty ANSWER instead of an absent one. A new Map-shaped field would
 * silently reproduce that, with no strip standing over it.
 */
export function measureSoundness(
  oc     ,
  entries                                          ,
  opts                = {},
)                     {
  const findings                     = [];
  if (!oc || !entries?.length) return findings;

  const maxSolids = opts.maxSolids ?? DEFAULT_MAX_SOLIDS;
  const budgetMs = opts.budgetMs ?? DEFAULT_SOUNDNESS_BUDGET_MS;
  const t0 = Date.now();

  let total = 0;      // solids this build contains
  let measured = 0;   // solids actually read
  let capReason                = null;

  for (const entry of entries) {
    if (!entry) continue;
    const wrapped = entry.shape?.wrapped;
    if (!wrapped) {
      findings.push({
        rule: "soundness_coverage",
        severity: "warning",
        unverified: true,
        message: `Part '${entry.name}' did not expose a B-rep shape, so nothing about its solids could be checked.`,
      });
      continue;
    }

    // Counted first, with a walk that takes no measurements, so the coverage line below can
    // name a real denominator rather than "the ones I got to". The explorer walk is free next
    // to a volume integral (0.47 ms/part for BOTH integrals; the walk does not register).
    let n = 0;
    try {
      n = forEachSolid(oc, wrapped, () => {});
    } catch (e) {
      findings.push({
        rule: "soundness_coverage",
        severity: "warning",
        unverified: true,
        message: `Part '${entry.name}' could not be explored for solids (${errText(e)}), so it was not checked.`,
      });
      continue;
    }
    if (n === 0) {
      // The same condition, and deliberately the same sentence, that interference.ts reports
      // for a part with no closed solid — a shell or a surface. It is not called a defect
      // here: nothing was measured, so nothing may be claimed.
      findings.push({
        rule: "soundness_coverage",
        severity: "warning",
        unverified: true,
        message: `Part '${entry.name}' contains no closed solid (a shell or a surface), so it has no volume or orientation to check.`,
      });
      continue;
    }
    total += n;

    try {
      forEachSolid(oc, wrapped, (solid     , i        ) => {
        if (measured >= maxSolids) {
          if (!capReason) capReason = `this build hit its ${maxSolids}-solid limit on soundness checks`;
          return false;
        }
        if (measured > 0 && Date.now() - t0 > budgetMs) {
          if (!capReason) capReason = `this build spent its ${budgetMs}ms soundness budget`;
          return false;
        }
        measured++;
        checkOneSolid(oc, solid, entry.name, i, n, findings);
        return true;
      });
    } catch (e) {
      findings.push({
        rule: "soundness_coverage",
        severity: "warning",
        unverified: true,
        message: `Part '${entry.name}' stopped mid-check (${errText(e)}); ${measured} solid(s) had been read across this build at that point.`,
      });
    }
  }

  // ⚠ THE COVERAGE LINE IS THE WHOLE OF "DEGRADE LOUDLY". Without it, a capped run's silence
  // reads as a statement about the model when it is a statement about the first N solids —
  // the exact failure `interference_coverage` was added to fix after a 95-part shed shipped
  // green with 32,073mm³ of overlapping roof boards. `unverified: true` so it reports and
  // never gates: partial coverage is not a defect.
  if (total > measured) {
    findings.push({
      rule: "soundness_coverage",
      severity: "warning",
      unverified: true,
      message:
        `⚠ PARTIAL CHECK — read ${measured} of ${total} solids for soundness; ${total - measured} went unchecked` +
        `${capReason ? ` because ${capReason}` : ""}. ` +
        `So "no unsound solid found" describes those ${measured} solids, NOT the whole model.`,
    });
  }
  return findings;
}

function checkOneSolid(
  oc     ,
  solid     ,
  name        ,
  i        ,
  n        ,
  out                    ,
)       {
  const at = where(name, i, n);
  const volOpen = signedVolume(oc, solid, false);
  const volClosed = signedVolume(oc, solid, true);

  // ── RULE A — the signed volume, read the way a volume is meant to be read. ──
  if (!volOpen.ran) {
    out.push({
      rule: "non_positive_volume",
      severity: "warning",
      unverified: true,
      message: `The signed volume of ${at} could not be measured (${volOpen.reason}), so this build cannot say whether that solid is correctly oriented.`,
    });
  } else if (volOpen.value <= VOL_EPS) {
    const kind = volOpen.value < -VOL_EPS
      ? `NEGATIVE, i.e. the solid is inside-out — its faces point into the material instead of out of it`
      : `effectively zero (|v| < ${VOL_EPS}mm³), i.e. the solid encloses nothing`;
    out.push({
      rule: "non_positive_volume",
      severity: "error",
      message:
        `${at} has a signed volume of ${fmt(volOpen.value)}mm³ — ${kind}. ` +
        `It still meshes and still measures like a real part, which is why no mesh-level check can see it. ` +
        `The usual cause is an operation whose selector matched no face and which did not refuse: ` +
        `\`shell(-3, f => f.inPlane("XY", 20))\` on a box spanning z 0..40 returns exactly this. ` +
        `Fix the operation that produced the solid — an inverted solid renders as a hole in the world and exports as garbage.`,
    });
  }

  // ── RULE B — OCC declines to integrate a CLOSED volume while the open read succeeds. ──
  //
  // ⚠⚠ THIS RULE MUST NEVER SAY "DEGENERATE". The number it keys on is not a small volume,
  // it is exactly integer 0 — the untouched accumulator of an integral OCC refused to run.
  // Calling that "degenerate" would report a solid measuring 1.6× its own blank as
  // near-empty: the right alarm with the wrong cause, which is precisely the fault this tier
  // caught `mcp/lib/solidity.js` committing on these same parts — it asserted they were
  // COMPOUNDS whose members overlap, on a fill it could see but a solid count it never had.
  // Fixed there in the same commit as this file's rule-C removal: it now describes the
  // measurement (a volume larger than its own blank) and names no cause it cannot support.
  if (!volClosed.ran) {
    out.push({
      rule: "unclosed_volume",
      severity: "warning",
      unverified: true,
      message: `The closed-shell volume of ${at} could not be measured (${volClosed.reason}), so this build cannot say whether that solid's shell is closed.`,
    });
  } else if (
    volOpen.ran &&
    Math.abs(volClosed.value) < VOL_EPS &&
    Math.abs(volOpen.value) > VOL_EPS
  ) {
    out.push({
      rule: "unclosed_volume",
      severity: "error",
      message:
        `${at} has an OPEN OR INCONSISTENT SHELL: OCC integrates ${fmt(volOpen.value)}mm³ over its faces but declines to integrate any closed volume for it at all. ` +
        `A closed solid returns the same number both ways. ` +
        `This is the shape of the fillet/chamfer band — \`makeBaseBox(100,100,6.35).fillet(5)\` builds, meshes, passes dimension checks, ` +
        `and reports 101,980mm³ out of a 63,500mm³ blank. Reduce the radius (below half the stock thickness), ` +
        `or split the operation so each face is rounded against geometry that can carry it.`,
    });
  }

  // ── RULE C — REMOVED. There is no third rule, and this is the record of why. ──────────────
  //
  // ⛔⛔ DO NOT PUT `invalid_topology` (BRepCheck_Analyzer) BACK. `solid-soundness-plan.md` §4a
  // measured the symbol as BOUND and §5 S1 specifies the rule by name, so this is exactly the
  // shape of thing a later session re-adds in good faith, believing it is finishing the plan.
  // It WAS built, it did ship in the S1 working tree, and it was killed by two production
  // defects with zero measured value beside them. All numbers 2026-08-30, Node v24.14.0.
  //
  // (a) IT LEAKS WASM HEAP — ~53–60 KB PER CONSTRUCTOR CALL, LINEAR, NO PLATEAU.
  //     2,000 passes over ONE `makeBaseBox` grew the heap +103.6 MB; 10,000 took it
  //     20.2 MB → 640.5 MB.
  //     ⭐⭐ THE DISCRIMINATING CONTROL, because "then dispose of it properly" is the first
  //     thing anyone tries: 4,000 calls WITH the `try/finally` `delete()` and 4,000 WITHOUT it
  //     grew BYTE-IDENTICALLY. The disposal reclaims nothing, so no tightening of it is a fix.
  //     It is the CONSTRUCTOR — a construct-only loop that never calls `IsValid_2()` leaks the
  //     same, and `geomControls:false` does not help. The other reads here are clean over the
  //     same 2,000 passes: the GProp volume integrals 0.0 MB, the explorer walk 0.0 MB.
  //     ⚠ WASM linear memory NEVER SHRINKS, and services/geometry caches its OCC module at
  //     module scope (packages/engine/runner.mjs:102) on a 512mb Fly VM
  //     (services/geometry/fly.toml). So this is not per-request garbage, it is a permanent
  //     staircase: **6.7 MB per build** of the 118-part mondrian fixture, measured directly and
  //     with `delete()` being called on every analyzer. One certifying sweep of that fixture —
  //     603 points × 118 solids = 71,154 calls, ~4.2 GB — could never have completed at all.
  //     ⭐ The removal is measured too, on the same instrument: 2,000 passes over one box that
  //     grew the heap +103.6 MB now grow it +0.0 MB, and 10,000 passes hold flat at 16.0 MB.
  //
  // (b) IT FAILS ON AXLE'S OWN FONT, ON ORDINARY GEOMETRY THE USER CANNOT ESCAPE.
  //     `api.sketchText(ch, { fontSize: 20 }).extrude(4)` through the shipped door, all 36
  //     alphanumerics: 11 GATED with `invalid_topology` — A G M N P R V W X Y Z.
  //     `sketchText("AXLE").extrude(4)` reported `passed=false`. ⭐ Rules A and B are SILENT on
  //     every one of them, so the analyzer was the whole gate, not a second opinion on one.
  //     `app/lib/fonts/Inter.ttf` is the ONLY face and `loadDrawingFont` (runner.mjs:132) loads
  //     it unconditionally — there is nothing to switch to, so it was a false positive with no
  //     user-side workaround, on the drawing/engraving path.
  //
  // (c) AND IT ADDED NOTHING. Across every case measured it never fired ALONE — rules A and B
  //     together are 7 of 7 on the impossible set — while being the expensive read at
  //     2.30 ms/part against 0.47 ms/part for both volume integrals together.
  //
  // What it could uniquely have spoken to — self-intersection, a bad curve-on-surface — is a
  // class the S0 set does not contain, so keeping it was a judgement about unsampled classes.
  // (a) and (b) are measurements. The measurements win, and a check that cannot say WHY it
  // refuses (`BRepCheck_Status` has ZERO occurrences in replicad_single.d.ts) is a poor thing
  // to gate a customer's build on even when it is right.
  //
  // ⚠ `scripts/headless/probe-solid-soundness.mjs` KEEPS its analyzer reads and must NOT be
  // "cleaned up" to match this file. It is a hand-run instrument, not a hot path, and its
  // evidence is the only reason any of the above is known. If a future WASM build binds the
  // status codes, the case to revisit starts by DISPROVING (a) with a fresh heap measurement —
  // never by reading the plan doc and re-typing the rule.
}

/**
 * The pure half: project what `measureSoundness` returned into the problem list.
 *
 * ⚠ `null`/`undefined` IS NOT "NOTHING FOUND". It means no soundness pass ran on this build,
 * and unlike the overlap rule there is no mesh-level fallback that could hedge — a mesh cannot
 * answer either of these two questions. So absence is reported as absence
 * [[feedback_silent_catch_hides_holes]]. In practice this is a tripwire, not a common path:
 * both callers of `defaultProblems` run the pass, and so does app/cadWorker.ts on both of its
 * paths for any build that is not a coarse drag preview. `[]` means looked-and-found-none.
 */
export function soundnessProblems(findings                            )                     {
  if (Array.isArray(findings)) return findings;
  return [{
    rule: "soundness_coverage",
    severity: "warning",
    unverified: true,
    message:
      `No B-rep soundness check ran on this build, so this verdict says nothing about whether each solid encloses a ` +
      `positive volume or is a closed shell — only that the code executed and the mesh is sane. ` +
      `Server-side, build through buildVerdict() (or pass \`soundness: true\` to runModel) to have it measured; ` +
      `in the browser this line means the worker's pass threw, which it logs.`,
  }];
}
