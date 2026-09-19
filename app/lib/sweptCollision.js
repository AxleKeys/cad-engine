// Does a MOVING part hit anything, anywhere in its declared range? (t7-sweptcheck)
//
// ⭐⭐ THE GAP THIS FILLS, VERIFIED BEFORE IT WAS WRITTEN (Notebook bdb97023, 2026-09-11).
// Axle could measure whether two parts interpenetrate AT REST and had no instrument that asked
// the other question. Measured on the flagship Base Cabinet (80bb19ac): joint `joint-nt581o1`
// pivots at x=1.5 while the Left Side Panel occupies x 0–19.1, so the hinge axis runs THROUGH
// the panel; the Door is flush against it at 0° and ~6,000,000 mm³ INSIDE it at 90°, all the way
// through a declared 0→100° swing and a saved 95° rig pose. `get_validation_report` returned
// errorCount 0, because every check in the chain was asking about the rest pose — the same
// property that makes a rig bug invisible (app/lib/jointTree.ts, app/lib/jointBounds.ts: A RIG
// IS INVISIBLE AT REST). A joint's min/max was a number an agent typed and nothing contradicted.
//
// ⭐ BOTH HALVES ALREADY EXISTED AND HAD NEVER BEEN INTRODUCED. This file introduces them and
// adds no geometry of its own:
//   · app/lib/jointBounds.ts `poseRig` — forward kinematics at arbitrary joint values, headless,
//     with parent chains and driven pairs, asserted against closed-form answers in
//     scripts/headless/test-jointbounds.mjs.
//   · app/lib/interference.ts `measureWrappedPair` — the REAL OCC boolean intersection VOLUME,
//     which is the only thing that tells a dado (shared faces, ~0 common volume) from a collision
//     (real volume). No bounding-box test can make that distinction; t4-overlap-truth is the
//     record of it being tried.
// The transform handed to OCC is the SAME `Affine` jointBounds computes, as a gp_Trsf — so the
// solid this file intersects sits exactly where the box that module reports says it sits. A
// second forward kinematics here would be the fork guard S27 exists to prevent.
//
// ── What it costs, and where it is therefore allowed to run ──────────────────
// A sweep multiplies the interference problem by the step count, and the joints it needs are
// MODEL DATA (`items.ts` ModelJoint), not something a build can derive from code. So it is
// OPT-IN and OFF by default: `runModel(code, { joints })` / `buildVerdict(code, { joints })`.
// It does NOT run on the browser's interactive build path — a drag that re-poses a rig 60 times
// a second must not pay for booleans. Cost measured on the Base Cabinet is recorded in
// context/handoffs/wt-t7-sweptcheck.md.
//
// ── The three things that keep it from drowning its own finding ─────────────
//  1. A pair is skipped unless SOMETHING CHANGED between the rest pose and this one. Two parts
//     riding the same rigid body never change their relationship, and two parts that both stood
//     still are the REST rule's business, not this one's.
//  2. A pair that ALREADY shares interference volume at rest is excluded outright and stays
//     `part_interference`'s finding. Reporting it again at every sampled angle would bury the
//     new information under the old.
//  3. The volume floor is `INTERFERENCE_VOLUME`, imported rather than re-typed, so the swing and
//     the rest pose call the same amount of shared volume a collision.
//
// ⚠ THE HONEST CEILING, stated because a sampled check that reads as exhaustive is worse than
// none. This samples `steps` poses per joint and sweeps ONE JOINT AT A TIME (every other joint at
// its rest value). It therefore cannot see (a) a strike whose angular window falls entirely
// between two samples, nor (b) a collision that needs two joints open at once. Both are
// deliberate: (a) is bounded by `steps`, which the caller sets, and the FIRST STRIKE it does find
// is then bisected to a much finer angle than the sampling; (b) is combinatorial and would turn a
// check into a job. Say so in any surface that reports this — never "no collision".
//
// ⚠ AND (b) HAS A MIRROR IMAGE THAT IS A FALSE POSITIVE, not a miss: a part whose travel is only
// legal once ANOTHER joint has moved — a pull-out shelf that must come through a door this sweep
// is holding shut — is reported as a strike, correctly by this check's own question and wrongly
// by the workshop's. The honest fix when one shows up is to say which pose it needs, not to
// loosen the floor; the rule's message already names the joint and the value, which is the
// information that argument needs.
//
// ⚠ OCC space throughout (Z up), the frame `ModelJoint.pivot`/`axis` are already in — same
// convention, and for the same reason, as app/lib/jointBounds.ts.

                                          
import {
  poseRig, partTransform, transformedBox, sameAffine,
                                        
} from "./jointBounds.js";
import {
  boxesPenetrate, measureWrappedPair, pairKey, INTERFERENCE_VOLUME,
                              
} from "./interference.js";

/** Poses sampled across each joint's declared min→max, endpoints included.
 *
 *  ⭐ NINE, AND THE NUMBER IS A JUDGEMENT WITH A REASON. Endpoints alone would have caught the
 *  Base Cabinet (its door is inside the panel at every angle) and would miss the commoner fault:
 *  a lid that clears at 0° and at 110° and strikes a shelf at 40°. Nine gives eight intervals —
 *  12.5° on a 100° door swing — and every strike it does find is then bisected, so the sampling
 *  bounds DISCOVERY, not the reported angle. Raise it for a certifying sweep; the cost is linear.
 */
export const DEFAULT_SWEEP_STEPS = 9;

/** ⭐ Bisections between the last clear sample and the first striking one. Five gets the reported
 *  angle to 1/32 of a sampling interval (0.4° on a 100° swing), and they are paid ONLY on a pair
 *  that is already a finding. "The door hits something" is not actionable; "the Door enters the
 *  Left Side Panel at 0.4° of a 0→100° range" names the defect — the hinge axis is inside the
 *  panel — without anyone opening the model. */
export const DEFAULT_REFINE_STEPS = 5;

/** ⭐ The caps, and they are NOT the interactive ones. `interference.ts` runs inside a build a
 *  human is waiting on (64 pairs / 400 ms); this runs on demand, so it is allowed real time —
 *  and, like its neighbour, it reports what it did not reach rather than going quiet about it
 *  [[feedback_silent_catch_hides_holes]]. A pair-POSE is one boolean: the same two parts at nine
 *  angles is nine of these. */
export const DEFAULT_SWEPT_MAX_PAIRS = 400;
export const DEFAULT_SWEPT_BUDGET_MS = 8_000;

                             
               
                                                                                              
                                                                       
             
                                                                                             
                  
 

                            
                                                                           
                 
                                                                                           
                       
                                                      
                    
                                               
                    
                                                                                            
                                                           
                              
                                                                                               
                                                                                         
                                                                                           
                                                                                             
                                                                                                
                                                                                              
                                                 
 

                               
                                                   
                                                                                                
                                                                                             
                                             
                                
                  
                           
                       
 

// ── Sampling (pure) ──────────────────────────────────────────────────────────

/** The joint values to visit, low→high, endpoints included. A joint with no declared travel
 *  yields its single value: there is nothing to sweep, and returning [] would make the joint
 *  silently invisible to the caller's own counting. */
export function sweepSamples(joint            , steps = DEFAULT_SWEEP_STEPS)           {
  const lo = Math.min(joint.min, joint.max);
  const hi = Math.max(joint.min, joint.max);
  if (!(hi > lo) || !isFinite(lo) || !isFinite(hi)) return [lo];
  const n = Math.max(2, Math.floor(steps) || 2);
  const out           = [];
  for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1));
  return out;
}

const unit = (j            ) => (j.type === "prismatic" ? "mm" : "°");
const fmtVal = (v        ) =>
  v === 0 ? "0" : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2);
const fmtVol = (v        ) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));

// ── Posing (OCC) ─────────────────────────────────────────────────────────────

/** A part placed at one pose: its B-rep and its box, both in the SAME frame. `release` frees the
 *  OCC handles this pose owns; a part that did not move owns none. */
                     
               
                  
                      
 

const NO_RELEASE = () => {};

function aabbOfCorners(min      , max      )       {
  return {
    minX: min[0], maxX: max[0], minY: min[1], maxY: max[1], minZ: min[2], maxZ: max[2],
    sizeX: max[0] - min[0], sizeY: max[1] - min[1], sizeZ: max[2] - min[2],
  };
}

const boxCorners = (bb      )               => [[bb.minX, bb.minY, bb.minZ], [bb.maxX, bb.maxY, bb.maxZ]];

/**
 * Place one part's B-rep at `xf`.
 *
 * ⚠ NOT `shape.rotate()` / `shape.translate()`, and that is not a style choice: replicad's
 * Shape transforms call `this.delete()` on the receiver (node_modules/replicad/dist/replicad.js
 * — `rotate` casts the new shape and then deletes `this`). Calling one on a build's shape would
 * destroy the geometry the rest of the build still needs, and the failure would arrive later, in
 * some other check, as a shape that is suddenly null.
 *
 * ⚠ Copy = FALSE. OCC then places the shape by LOCATION instead of copying the B-rep, which is
 * what makes a sweep affordable at all: a pose costs a handle, not a topology copy. The booleans
 * downstream respect locations.
 *
 * ⚠ The builder is kept alive until `release()`. `BRepBuilderAPI_MakeShape::Shape()` hands back a
 * const reference in OCC, so the shape must not outlive its builder — the same lifetime
 * interference.ts's `commonVolume` keeps around `algo.Shape()`.
 */
function posePart(oc     , wrapped     , bb             , xf                    )            {
  if (!xf || sameAffine(xf, undefined)) return { wrapped, bb, release: NO_RELEASE };
  let trsf      = null;
  let algo      = null;
  try {
    trsf = new oc.gp_Trsf();
    // Row-major, exactly jointBounds' `Affine`: [m0 m1 m2 | t0 ; m3 m4 m5 | t1 ; m6 m7 m8 | t2].
    // The rotation part is a product of Rodrigues rotations, so it is orthonormal and gp_Trsf
    // accepts it; a non-rigid matrix would be refused here rather than silently scaled.
    trsf.SetValues(
      xf.m[0], xf.m[1], xf.m[2], xf.t[0],
      xf.m[3], xf.m[4], xf.m[5], xf.t[1],
      xf.m[6], xf.m[7], xf.m[8], xf.t[2],
    );
    algo = new oc.BRepBuilderAPI_Transform(wrapped, trsf, false);
    const shape = algo.Shape();
    const held = algo;
    const heldTrsf = trsf;
    algo = null;
    trsf = null;
    const [lo, hi] = bb ? boxCorners(bb) : [null, null];
    const posedBox = lo && hi ? transformedBox(xf, lo, hi) : null;
    return {
      wrapped: shape,
      bb: posedBox ? aabbOfCorners(posedBox.min, posedBox.max) : null,
      release: () => {
        try { held?.delete(); } catch { /* already gone */ }
        try { heldTrsf?.delete(); } catch { /* already gone */ }
      },
    };
  } finally {
    try { algo?.delete(); } catch { /* already gone */ }
    try { trsf?.delete(); } catch { /* already gone */ }
  }
}

/** Every part placed at one rig pose, plus the transform each one got (which is what tells a
 *  part that moved from one that stood still). */
function poseAll(oc     , entries                                      , rig          )   
                                 
                                
                      
  {
  const posed                          = [];
  const xf                            = [];
  for (const e of entries) {
    if (!e?.shape?.wrapped) { posed.push(null); xf.push(undefined); continue; }
    const a = partTransform(rig, e.name);
    xf.push(a);
    posed.push(posePart(oc, e.shape.wrapped, e.bb, a));
  }
  return { posed, xf, release: () => { for (const p of posed) p?.release(); } };
}

// ── The budget (one accountant) ───────────────────────────────────────────────

/**
 * ⭐⭐ EVERY BOOLEAN THIS PASS PAYS FOR IS COUNTED HERE, BEFORE IT IS PAID — which is the
 * difference between a cap and a tally, and the old code was a tally.
 *
 * `maxPairs` was documented as "Hard cap on booleans this sweep will pay for" and bounded
 * nothing. A strike triggered `refineFirstStrike` (5 booleans) and `worstOfRange` (one per
 * sample) UNCONDITIONALLY, and their cost was added to the counter AFTERWARDS — so
 * `{ maxPairs: 2 }` on a one-defect rig ran FIFTEEN, and so did `{ budgetMs: 1 }`. Every finding
 * cost ~14 booleans past the cap, so on a model with N strikes the cap bounded N × 14 rather
 * than the number it names. Measured both ways before and after (lane-A review D6).
 *
 * That was survivable while the only caller was a test file choosing its own numbers. Since
 * t7-sweepdoor this pass runs inside a build that `push_model_code` is WAITING on, with a budget
 * the worker picked precisely so the wait would hold — a cap that can be exceeded by an
 * unbounded factor makes that choice meaningless [[feedback_count_the_invariant_not_the_symptom]].
 */
                       
                   
                   
             
                                      
                   
                                                        
                  
                                                                                
                        
 

function newBudget(opts           )              {
  return {
    maxPairs: opts.maxPairs ?? DEFAULT_SWEPT_MAX_PAIRS,
    budgetMs: opts.budgetMs ?? DEFAULT_SWEPT_BUDGET_MS,
    t0: Date.now(),
    measured: 0,
    skipped: 0,
    reason: null,
  };
}

/** Is there budget left at all? Read before doing work that is not itself a boolean — posing a
 *  rig costs a gp_Trsf and a transform per moving part, and none of that increments `measured`. */
function exhausted(b             )          {
  if (b.measured >= b.maxPairs) {
    if (!b.reason) b.reason = `this sweep hit its ${b.maxPairs}-measurement limit before reaching every pose`;
    return true;
  }
  if (Date.now() - b.t0 > b.budgetMs) {
    if (!b.reason) b.reason = `this sweep spent its ${b.budgetMs}ms budget before reaching every pose`;
    return true;
  }
  return false;
}

/** Authorise ONE boolean, or refuse and record the refusal. Every call site that is about to
 *  call `measureWrappedPair` (directly or through `volumeAt`) goes through this. */
function spend(b             )          {
  if (exhausted(b)) { b.skipped++; return false; }
  b.measured++;
  return true;
}

// ── The measuring half (needs OCC + live shapes) ─────────────────────────────

/**
 * Pose every joint across its declared range and measure what the moving parts share with the
 * parts they pass. Returns the findings directly, the way `measureSoundness` does — including a
 * `joint_sweep_coverage` line when the cap or the clock stopped it short.
 *
 * `entries` is the SAME array, in the same order, that `measureInterference` was handed, so
 * `opts.restVerdicts` (if given) keys straight onto it through `pairKey(i, j)`.
 */
export function measureSweptCollision(
  oc     ,
  entries                                      ,
  joints                                          ,
  opts            = {},
)                 {
  const findings                 = [];
  if (!oc || !entries || entries.length < 2 || !joints?.length) return findings;

  const steps = Math.max(2, Math.floor(opts.steps ?? DEFAULT_SWEEP_STEPS) || DEFAULT_SWEEP_STEPS);
  const refineSteps = Math.max(0, Math.floor(opts.refineSteps ?? DEFAULT_REFINE_STEPS));
  const floor = opts.interferenceVolume ?? INTERFERENCE_VOLUME;
  const budget = newBudget(opts);

  // Joints that were HANDED to this pass and could not be swept. Collected as the sweep walks the
  // rig and reported together at the end — see "The rig itself, reported" below for why absence
  // has to be legible here and must still stay silent when no joints were supplied at all.
  const drivenSkipped               = [];
  const noTravel               = [];

  const rest = poseRig(joints, {});
  const restPose = poseAll(oc, entries, rest);

  try {
    // ── The baseline: which pairs are ALREADY inside each other before anything moves ──
    // Those stay `part_interference`'s finding. ⚠ `restVerdicts` may only stand in for this when
    // the rest pose IS the as-built pose — a joint with a non-zero `default` renders open while
    // the build record reports it shut, and the map would then describe different geometry.
    const restIsAsBuilt = restPose.xf.every((a) => sameAffine(a, undefined));
    const excluded = new Set        ();
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = restPose.posed[i], b = restPose.posed[j];
        if (!a?.bb || !b?.bb) continue;
        if (!boxesPenetrate(a.bb, b.bb)) continue;
        const key = pairKey(i, j);
        // ⚠⚠ AN `unverified` REST VERDICT IS NOT A KNOWN NON-CONTACT, and reading it as one made
        // a real strike DISAPPEAR. `measureInterference` stores
        // `{ kind: "unverified", reason: "this build hit its 64-pair limit …" }` for every pair it
        // skipped at the INTERACTIVE caps (64 pairs / 400 ms — right for a check a human is
        // waiting on). This loop trusted that as "measured, not touching", excluded the pair from
        // the ENTIRE swing without ever measuring it, and then printed the REST pass's reason as
        // its own — so the verdict blamed a limit this pass does not have. Demonstrated: with the
        // rest pass at `maxPairs: 0` a real strike vanished completely while the coverage line
        // talked about a 0-pair limit on intersection tests. This pass has its own budget (400
        // pairs / 8 s, and whatever the caller sets) and now SPENDS it on the pairs the rest pass
        // could not reach [[feedback_count_the_invariant_not_the_symptom]].
        const cached = restIsAsBuilt ? opts.restVerdicts?.get(key) : undefined;
        const known = cached && cached.kind !== "unverified" ? cached : undefined;
        let verdict             ;
        if (known) {
          verdict = known;
        } else if (spend(budget)) {
          verdict = measureWrappedPair(
            oc,
            { name: entries[i] .name, wrapped: a.wrapped },
            { name: entries[j] .name, wrapped: b.wrapped },
            floor,
          );
        } else {
          // Out of budget before the baseline was even established. The pair is excluded — a
          // swing cannot be attributed to the swing when the rest pose was never measured — and
          // `spend` has already recorded which of THIS pass's two limits stopped it.
          excluded.add(key);
          continue;
        }
        // ⚠ `unverified` EXCLUDES TOO, and deliberately: a pair nobody could measure at rest
        // cannot have its swing attributed to the swing. The coverage line below says so — and
        // now the reason it gives is this pass's own measurement failing (a compound past the
        // solid-pair limit, an OCC throw), not another pass's clock.
        if (verdict.kind !== "contact") {
          excluded.add(key);
          if (verdict.kind === "unverified" && !budget.reason) budget.reason = verdict.reason;
        }
      }
    }

    // ── The sweep, one joint at a time ──
    for (const node of rest.tree.order) {
      const joint = node.joint;

      // ⚠⚠ A DRIVEN JOINT IS NOT SWEPT UNDER ITS OWN ID, AND SWEEPING IT WAS A NINE-POSE NO-OP.
      // `driven` composes VALUES: this joint's value is `source × ratio + offset`, and
      // `resolveDrivenTargets` (app/lib/jointTree.ts) applies that inside `poseRig` AFTER the
      // caller's map — so `poseRig(joints, { [joint.id]: value })` had its value overwritten
      // before anything was posed. Every sample produced the identical pose, every pair came back
      // `aStill && bStill`, no boolean ran and nothing said a word. Reproduced: the same joint
      // with `driven` removed reports a real strike; with it, silence (lane-A review D10, which
      // arrived unexecuted and is confirmed here).
      //
      // Skipping is not a loss of coverage, and that is why this is a skip and not a fix to the
      // posing. The travel a driven joint can actually reach is whatever its DRIVER's range maps
      // to, and the driver is swept — `poseRig` moves the driven joint along with it, so its parts
      // are posed and measured under the driver's id. Sweeping its own declared min→max instead
      // would test poses the mechanism cannot reach, which is a FALSE POSITIVE, not extra rigour.
      // What was missing is the sentence, and `drivenSkipped` below is it.
      //
      // ⚠ Only when the source RESOLVES. A `driven.source` naming a joint this rig does not
      // declare keeps its own value (resolveDrivenTargets: "A driven joint whose source is missing
      // keeps its own target"), so it really is swept, and skipping it would create the silence
      // this block exists to remove.
      if (joint.driven?.source && rest.tree.byId.has(joint.driven.source)) {
        drivenSkipped.push(joint);
        continue;
      }

      const samples = sweepSamples(joint, steps);
      // A joint whose min equals its max declares no travel. There is nothing to sweep, and that
      // is a claim the author made about the mechanism — so it is REPORTED rather than passed
      // over in silence, which is how "why did my joint produce nothing?" became unanswerable.
      if (samples.length < 2) { noTravel.push(joint); continue; }

      // ⚠⚠ PER JOINT, NOT PER SWEEP. This set used to be declared OUTSIDE this loop, so the first
      // joint to report a pair suppressed EVERY LATER joint's finding on the same pair, with
      // nothing saying so. Reproduced: part A driven into B by joint 1 and B driven into A by
      // joint 2 yields ONE finding naming joint 1; run joint 2 alone and its finding is real and
      // different. Two joints' declared ranges are two separate claims about the same two parts,
      // and an author who fixes the first is told nothing about the second (lane-A review D5).
      // Its actual job — not re-reporting the same pair at every angle of ONE joint — is
      // unchanged, because that is what the scope it now has covers.
      const reported = new Set        ();

      // Per pair: the last sampled value at which it was still clear, so a strike can be bisected
      // back to where it actually begins rather than reported at the sample that noticed it.
      const lastClear = new Map                ();

      for (const value of samples) {
        // ⚠⚠ THE CLOCK IS READ UNCONDITIONALLY HERE, and the `measured > 0` that used to guard it
        // is the reason this budget could not stop anything. POSING IS REAL OCC WORK — one
        // gp_Trsf and one BRepBuilderAPI_Transform per moving part per sample — and none of it
        // increments `measured`, which counts booleans. So on the common rig, where the movers
        // pass through empty space and `measured` never leaves 0, every joint × every sample ran
        // with the wall clock never consulted: the 400-joint case is 3,600 poses nothing could
        // interrupt. That was survivable while the only caller was a test file; since t7-sweepdoor
        // this pass runs inside a build a `push_model_code` is WAITING on (worker/index.js
        // § serverSideBuild, BUILD_WAIT_MS 8s), and a budget that cannot trip is not a budget
        // [[feedback_silent_catch_hides_holes]].
        // ⭐ AND IT NAMES ITS REASON. This outer skip used to set none, so a run stopped here
        // printed "N were skipped." with no "because" — a refusal that cannot be read is not one
        // [[feedback_refusal_must_be_legible]].
        if (exhausted(budget)) { budget.skipped++; continue; }
        const pose = poseAll(oc, entries, poseRig(joints, { [joint.id]: value }));
        try {
          for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
              const key = pairKey(i, j);
              if (excluded.has(key) || reported.has(key)) continue;
              const a = pose.posed[i], b = pose.posed[j];
              if (!a?.bb || !b?.bb) continue;

              // (1) Nothing moved: this is the rest pose again, and the rest rule owns it.
              const aStill = sameAffine(pose.xf[i], restPose.xf[i]);
              const bStill = sameAffine(pose.xf[j], restPose.xf[j]);
              if (aStill && bStill) continue;
              // (2) Riding the same rigid body, before and after — their relationship cannot
              //     change, so a collision between them is a rest fact, not a swing one.
              if (sameAffine(pose.xf[i], pose.xf[j]) && sameAffine(restPose.xf[i], restPose.xf[j])) continue;
              // (3) The cheap gate, identical to the rest rule's: only boxes that penetrate on
              //     ALL THREE axes are worth a boolean.
              if (!boxesPenetrate(a.bb, b.bb)) { lastClear.set(key, value); continue; }

              if (!spend(budget)) continue;
              const verdict = measureWrappedPair(
                oc,
                { name: entries[i] .name, wrapped: a.wrapped },
                { name: entries[j] .name, wrapped: b.wrapped },
                floor,
              );
              if (verdict.kind === "unverified") {
                if (!budget.reason) budget.reason = verdict.reason;
                continue;
              }
              if (verdict.kind === "contact") { lastClear.set(key, value); continue; }

              // A strike. BRACKET where it begins, then say how deep it gets at the poses this
              // sweep actually visited — neither of which is the same as solving for either.
              const from = lastClear.has(key) ? lastClear.get(key)  : samples[0];
              const bracket = refineSteps > 0 && from !== value
                ? refineFirstStrike(oc, entries, joints, joint, i, j, from, value, floor, refineSteps, budget)
                : { clearSample: from, striking: value };
              const worst = worstOfRange(oc, entries, joints, joint, i, j, samples, value, verdict.volume, floor, budget);
              reported.add(key);
              // ⭐ THE MOVER IS NAMED FIRST, and it is not cosmetic. The pair arrives in the
              // build array's order, so the first run of this file produced "Part 'Left Side
              // Panel' enters 'Door'" — which reverses cause and effect and sends an author to
              // the wrong part. The panel stood still; the door was driven into it. `aStill`
              // already knows which is which [[feedback_refusal_must_be_legible]].
              const mover = aStill ? entries[j] .name : entries[i] .name;
              const struck = aStill ? entries[i] .name : entries[j] .name;
              findings.push(strikeFinding(mover, struck, joint, samples, bracket, worst));
            }
          }
        } finally {
          pose.release();
        }
      }
    }

    if (budget.reason || budget.skipped > 0) {
      // ⚠ "AT LEAST", and the hedge is the honest word rather than a softener. `skipped` counts one
      // for a refused MEASUREMENT and one for a refused POSE, and a refused pose is a whole pose's
      // worth of pairs nobody looked at. The old line called both "pose-pair measurement(s)" and so
      // reported a number smaller than the thing it was describing (lane-A review C3).
      findings.push(coverageFinding(
        `⚠ PARTIAL SWEEP — ${budget.measured} intersection measurement(s) ran and at least ${budget.skipped} were skipped` +
        `${budget.reason ? ` because ${budget.reason}` : ""}. ` +
        `So "no joint collision found" describes the poses that were measured, NOT the whole range. ` +
        `Re-run with a smaller \`steps\`, a larger \`budgetMs\`, or one joint at a time.`,
      ));
    }

    // ── The rig itself, reported (t7-sweepdoor) ─────────────────────────────────────────────
    //
    // ⭐⭐ THE FOUR SILENCES THAT READ AS CLEAN. Everything above answers "what did the sweep
    // find?"; nothing answered "did it have anything to sweep?". A joint naming a part this build
    // never produced moves nothing, so every pair is `aStill && bStill`, no boolean runs, and the
    // verdict is `[]` — which `sweptProblems` and every reader of it call SWEPT AND FOUND NONE.
    // Reproduced for all four (lane-A review D7, D10, plus the tree warnings which the review did
    // not list): `parts: ["Dooor"]` → 0 findings, 0 coverage; `parts: []` → the same, and renaming
    // a part in code is the commonest way a rig goes stale; a DRIVEN joint → nine wasted poses and
    // silence; and `buildJointTree`'s authoring warnings — a duplicate joint id, an unknown
    // parent, a part claimed by two joints — were COMPUTED on every sweep and thrown away, three
    // real warnings reaching no agent anywhere (the browser prints them to a console a headless
    // caller does not have).
    //
    // ⚠ THE ASYMMETRY ON `sweptProblems` IS PRESERVED EXACTLY, and this is where the line is. NO
    // JOINTS SUPPLIED stays silence — a permanent "nobody swept your joints" on a model with none
    // is a line no author can clear, which is how a verdict stops being read. This block only
    // fires when joints WERE supplied and something about them meant they could not be swept, and
    // it is the one absence in this file that is a claim rather than a question nobody asked.
    //
    // ⚠ ONE FINDING PER CLASS, joints NAMED, list capped. Six malformed joints must not become six
    // warnings, or the wall is the new silence.
    const restNames = new Set(entries.map((e) => e?.name).filter(Boolean)            );
    const brokenParts           = [];
    const movesNothing           = [];
    for (const node of rest.tree.order) {
      const j = node.joint;
      const declared = j.parts ?? [];
      if (!declared.length) { movesNothing.push(jointName(j)); continue; }
      const missing = declared.filter((p) => !restNames.has(p));
      if (missing.length === declared.length) {
        brokenParts.push(`${jointName(j)} names ${missing.map((p) => `'${p}'`).join(", ")}`);
      } else if (missing.length) {
        brokenParts.push(`${jointName(j)} names ${missing.map((p) => `'${p}'`).join(", ")} (its other part(s) were swept)`);
      }
    }
    if (brokenParts.length) {
      findings.push(coverageFinding(
        `⚠ NOT SWEPT — ${brokenParts.length} joint(s) name a part this build did not produce, so they moved nothing and the silence above says nothing about them: ` +
        `${cap(brokenParts)}. This build's parts are: ${cap([...restNames].map((n) => `'${n}'`), 12)}. ` +
        `A joint's \`parts\` are BUILD-PART NAMES — renaming a part in code leaves the rig pointing at the old name, and nothing else in the system notices.`,
      ));
    }
    if (movesNothing.length) {
      findings.push(coverageFinding(
        `⚠ NOT SWEPT — ${movesNothing.length} joint(s) declare no parts at all, so there was nothing to move: ${cap(movesNothing)}.`,
      ));
    }
    if (noTravel.length) {
      findings.push(coverageFinding(
        `⚠ NOT SWEPT — ${noTravel.length} joint(s) declare no travel (min = max), so there is no range to sweep: ` +
        `${cap(noTravel.map((j) => `${jointName(j)} at ${fmtVal(j.min)}${unit(j)}`))}.`,
      ));
    }
    if (drivenSkipped.length) {
      findings.push(coverageFinding(
        `${drivenSkipped.length} joint(s) are DRIVEN and were not swept under their own declared range: ` +
        `${cap(drivenSkipped.map((j) => `${jointName(j)} (driven by '${j.driven .source}')`))}. ` +
        `A driven joint's value is computed as \`source × ratio + offset\`, so it cannot take a value its driver does not produce — ` +
        `it MOVES when its driver is swept, and that is where its travel was measured. Sweeping its own min→max would test poses the mechanism cannot reach.`,
      ));
    }
    if (rest.tree.warnings.length) {
      findings.push(coverageFinding(
        `⚠ RIG AUTHORING — this rig was REPAIRED before it could be swept, so the poses measured are not the ones as declared: ` +
        `${cap(rest.tree.warnings, 4)}`,
      ));
    }
  } finally {
    restPose.release();
  }

  return findings;
}

const jointName = (j            ) => `'${j.label || j.id}'`;

/** Join a list for a message, saying how many were left out rather than trailing off. */
function cap(items                   , limit = 6)         {
  if (items.length <= limit) return items.join("; ");
  return `${items.slice(0, limit).join("; ")}; and ${items.length - limit} more`;
}

/**
 * ⭐⭐ THE ONE CONSTRUCTOR OF `joint_sweep_coverage`, and it is exported for one caller only.
 *
 * `packages/engine/runner.mjs` catches a throw from this pass and used to leave `swept = null`,
 * which `sweptProblems` reports as SILENCE — the same encoding as "no joints were supplied". So a
 * sweep that CRASHED was indistinguishable from one nobody asked for, the `sweptMs` timing was
 * dropped along with it, and the only trace was a `console.warn` an MCP caller never sees
 * [[feedback_silent_catch_hides_holes]]. Interference and soundness both leave a visible degraded
 * state on throw; this pass was the one that did not.
 *
 * The runner now calls this and returns `[sweptFailure(reason)]`, so the throw arrives in the
 * verdict as a warning. It comes from HERE rather than being typed there because these two rule
 * ids are constructed in this module and nowhere else — guard S27 enforces exactly that, and a
 * `rule:` literal in the runner would break it [[feedback_three_registries]].
 *
 * ⚠ `unverified`, always: a crashed pass is not evidence of a defect, so it must report without
 * gating (`gatingProblems`, packages/engine/checks.mjs).
 */
export function sweptFailure(reason        )                 {
  return [coverageFinding(
    `⚠ THE SWEPT-COLLISION PASS FAILED — this verdict says NOTHING about what this model's joints reach: ${reason}. ` +
    `Every other check here measured the model AS BUILT, which is joints at rest, so a moving part that strikes something ` +
    `mid-range would be invisible to all of them. Treat the joints as UNCHECKED, not as clear.`,
  )];
}

function coverageFinding(message        )               {
  return { rule: "joint_sweep_coverage", severity: "warning", unverified: true, message };
}

/**
 * Where the first strike is, as two SOUND facts rather than one unsound number.
 *  · `striking`  — a value at which the pair really was measured inside each other. An UPPER bound
 *                  on first contact.
 *  · `clearSample` — the highest SAMPLE the sweep measured clear below it. A LOWER bound, and it
 *                  comes from the sampling grid rather than from the bisection, for the reason on
 *                  `refineFirstStrike`.
 */
                                                                 

/**
 * Bisect (clear, striking] to tighten the UPPER bound on first contact. Every boolean goes through
 * `spend`, so refinement can no longer overrun the cap — it stops early rather than paying past it.
 *
 * ⚠⚠ IT TIGHTENS ONE END ONLY, AND RETURNING A SINGLE NUMBER WAS FALSE PRECISION. Bisection assumes
 * contact is MONOTONE in the joint value — clear below some angle, striking above it — and a
 * two-pronged obstacle breaks that flat. MEASURED on a 2 mm door hinged at the origin against one
 * fused obstacle whose true contact windows are [25.0°, 27.2°] and [32.1°, 36.3°] (0.1° scan), with
 * the 9-sample grid at 0, 11.25, 22.5, 33.75 …: sample 22.5 is clear, 33.75 strikes, and every
 * midpoint of (22.5, 33.75] lands in the GAP between the two windows — so the search walks past the
 * first one and converged on 32.3° for a first contact of 25.0°. 7.3° wrong, stated to one decimal.
 * At 33 samples the same code on the same model said 25.0°: the number moved with the grid, which
 * the module header specifically claimed it would not.
 *
 * ⚠ SO THE LOWER BOUND IS `clear` AS PASSED IN — the last SAMPLE found clear — and NOT the `lo` this
 * loop converges to. `lo` is only "clear under the monotone assumption", and a bracket built from it
 * would have read "between 32.0° and 32.3°" for a contact at 25.0°: tighter-looking, still wrong,
 * and now wrong with an air of precision. The sample IS sound: nothing struck at any pose at or
 * below it.
 *
 * ⚠ And not even that is proof nothing happens below: a contact window narrower than the sampling
 * interval is invisible to this pass at any refinement. That ceiling belongs to `steps`, and
 * `strikeFinding` says so where an author reads it.
 */
function refineFirstStrike(
  oc     ,
  entries                                      ,
  joints                                          ,
  joint            ,
  i        ,
  j        ,
  clear        ,
  striking        ,
  floor        ,
  iterations        ,
  budget             ,
)                {
  let lo = clear, hi = striking;
  for (let k = 0; k < iterations; k++) {
    if (!spend(budget)) break;
    const mid = (lo + hi) / 2;
    const v = volumeAt(oc, entries, joints, joint, i, j, mid, floor);
    if (v != null && v > floor) hi = mid; else lo = mid;
  }
  return { clearSample: clear, striking: hi };
}

/** The deepest intrusion AT THE SAMPLED POSES — see the `sampled` field, and `strikeFinding`,
 *  for why the distinction is stated in the message rather than glossed. */
                                                                                         

/**
 * Revisit the sample grid and keep the deepest intrusion found.
 *
 * ⚠⚠ THIS IS A MAXIMUM OVER THE GRID, NOT THE MAXIMUM, and the difference is a factor of three on
 * the model this whole tier was filed against. Measured on evals/fixtures/hinged-cabinet.js with
 * the live Base Cabinet's real hinge, sweeping 0→100° in 2.5° steps: the shared volume climbs
 * slowly, SPIKES to 6,022,346mm³ at exactly 90°, and falls back to 672,806mm³ by 100°. 90° is not
 * on the 9-sample grid (0, 12.5, … 87.5, 100), so the best grid point is 87.5° at 1,995,342mm³ —
 * 3.02× under the truth, at the wrong angle, and the curve's shape means no endpoint heuristic
 * would find the peak either. Calling that "deepest" is a number an author was asked to act on
 * that the pass cannot support [[feedback_count_the_invariant_not_the_symptom]].
 *
 * A true maximum needs a search this pass has no budget for, so the honest fix is the word: it is
 * the deepest of N SAMPLED poses, `strikeFinding` says exactly that, and `sampled`/`complete`
 * carry how much of the grid was actually visited once the cap can stop it.
 */
function worstOfRange(
  oc     ,
  entries                                      ,
  joints                                          ,
  joint            ,
  i        ,
  j        ,
  samples          ,
  knownValue        ,
  knownVolume        ,
  floor        ,
  budget             ,
)            {
  // Seeded with the pose that produced the finding, so a budget that stops this search dead still
  // leaves the message a measured volume rather than a placeholder.
  let bestValue = knownValue;
  let bestVolume = knownVolume;
  let sampled = 1;
  let complete = true;
  for (const value of samples) {
    if (value === knownValue) continue;
    if (!spend(budget)) { complete = false; break; }
    const v = volumeAt(oc, entries, joints, joint, i, j, value, floor);
    sampled++;
    if (v != null && v > bestVolume) { bestVolume = v; bestValue = value; }
  }
  return { value: bestValue, volume: bestVolume, sampled, complete };
}

/** One pair, one joint value, one boolean. `null` when it could not be measured. */
function volumeAt(
  oc     ,
  entries                                      ,
  joints                                          ,
  joint            ,
  i        ,
  j        ,
  value        ,
  floor        ,
)                {
  const rig = poseRig(joints, { [joint.id]: value });
  const a = entries[i], b = entries[j];
  if (!a?.shape?.wrapped || !b?.shape?.wrapped) return null;
  const pa = posePart(oc, a.shape.wrapped, a.bb, partTransform(rig, a.name));
  const pb = posePart(oc, b.shape.wrapped, b.bb, partTransform(rig, b.name));
  try {
    if (!pa.bb || !pb.bb || !boxesPenetrate(pa.bb, pb.bb)) return 0;
    const verdict = measureWrappedPair(oc, { name: a.name, wrapped: pa.wrapped }, { name: b.name, wrapped: pb.wrapped }, floor);
    return verdict.kind === "unverified" ? null : verdict.volume;
  } finally {
    pa.release();
    pb.release();
  }
}

/**
 * ⚠⚠ EVERY NUMBER IN THIS MESSAGE IS A BRACKET OR A SAMPLE, AND IT NOW SAYS SO.
 *
 * This finding is an `error`: it gates `passed` and it asks an author to change a pivot or a range
 * on the strength of the figures in it. Two of them could not carry that weight. `at 32.0°` was the
 * output of a bisection that assumes monotone contact, and moved 8.6° when the sampling grid was
 * densified; `deepest at 87.5° … 1,995,342mm³` was the best of nine grid points on a curve whose
 * real peak is 6,022,346mm³ at 90°, three times deeper and not on the grid (both measured — see
 * `refineFirstStrike` and `worstOfRange`). False precision in a gating finding is worse than a
 * wider true statement, because it sends an author to verify a number instead of a mechanism.
 *
 * So: the entry is an INTERVAL, the depth is named as the deepest POSE SAMPLED, and the sampling
 * ceiling is stated where it is read rather than only in this file's header.
 *
 * ⭐ AND THE THIRD CAUSE IS LISTED. The header documents a false-positive mirror — travel that is
 * only legal once ANOTHER joint has moved, which this pass cannot see because it holds every other
 * joint at rest — and the message offered two causes and never that one, so the author with the
 * pull-out shelf had no way to recognise their own case (lane-A review C2).
 */
function strikeFinding(
  nameA        ,
  nameB        ,
  joint            ,
  samples          ,
  bracket               ,
  worst           ,
)               {
  const u = unit(joint);
  const lo = samples[0], hi = samples[samples.length - 1];
  const verb = joint.type === "prismatic" ? "travel" : "swing";
  return {
    rule: "joint_collision",
    severity: "error",
    message:
      `Part '${nameA}' is INSIDE '${nameB}' by ${fmtVal(bracket.striking)}${u} of joint '${joint.label || joint.id}' ` +
      `(declared range ${fmtVal(lo)}→${fmtVal(hi)}${u}), and the last pose this sweep measured CLEAR was ` +
      `${fmtVal(bracket.clearSample)}${u}; the deepest of the ${worst.sampled} pose(s) it measured is ` +
      `${fmtVal(worst.value)}${u}, where they share ${fmtVol(worst.volume)}mm³ of the SAME solid volume ` +
      `(measured intersection, not a bounding-box guess)` +
      `${worst.complete ? "" : " — and this sweep ran out of budget before revisiting the rest of the range, so even that is a floor"}. ` +
      `⚠ Those are BOUNDS, not solutions: contact begins somewhere above the clear pose and at or below the figure given, ` +
      `the true deepest intrusion can be larger and fall between samples, and a contact window narrower than the sampling ` +
      `is invisible to this pass entirely — raise \`steps\` to tighten all three. ` +
      `They are CLEAR at rest, so no rest-pose check can see this — the ${verb} is what puts them inside each other. ` +
      `Either the ${joint.type === "prismatic" ? "travel" : "pivot or axis"} is wrong, the declared range reaches further than ` +
      `the mechanism can, or this ${verb} is only legal after another joint moves — this pass holds every other joint at rest, ` +
      `so a part that has to come through an opening something else makes is reported here and is not a defect.`,
    lessonCandidate:
      `Joint '${joint.label || joint.id}' sweeps part '${nameA}' into '${nameB}' by ${fmtVal(bracket.striking)}${u} of its declared ` +
      `${fmtVal(lo)}→${fmtVal(hi)}${u} range. Place a revolute pivot on the FACE the two parts actually hinge about — read the ` +
      `neighbour's bounding box first — never inside the neighbour's body, and set min/max to the travel the mechanism ` +
      `really has. A joint's range is a geometric claim, not a number to type.`,
  };
}

// ── The reporting half (pure) ────────────────────────────────────────────────

/**
 * Project what `measureSweptCollision` returned into the problem list. The same adapter shape
 * `soundnessProblems` has, and both callers (app/lib/validator.ts, packages/engine/checks.mjs)
 * go through it so the browser and the agent cannot describe one model two ways.
 *
 * ⚠⚠ ABSENCE IS SILENCE HERE, AND THAT IS THE ONE PLACE THIS FILE DIVERGES FROM ITS NEIGHBOURS.
 * `soundnessProblems(null)` says "nobody looked", because every model has solids and the question
 * always applies. This question only exists for a model that DECLARES JOINTS: most do not, and a
 * permanent "nobody swept the joints" line on a model with nothing to sweep is a line no author
 * can ever clear, which is how a verdict stops being read [[feedback_refusal_must_be_legible]].
 * The hole that leaves — a jointed model built without its joints — is closed at the DOOR
 * instead: `buildVerdict()` runs the pass by construction whenever `joints` are supplied, and a
 * partial sweep still says so above. `[]` means swept-and-found-none.
 */
export function sweptProblems(findings                        )                 {
  return Array.isArray(findings) ? findings : [];
}
