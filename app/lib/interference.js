// Part interference — does a pair of parts share SOLID VOLUME?
//
// ⭐ THIS FILE EXISTS BECAUSE THE ANSWER USED TO BE GUESSED FROM BOUNDING BOXES, and that
// one shortcut was wrong in three directions at once (measured 2026-08-08 by cold drivers,
// board row t4-overlap-truth · Notebook 662774fc):
//
//   1. TOO WEAK   — a genuine 18×350×18mm solid-on-solid collision was a warning on a build
//                   that still reported ✅ Build OK.
//   2. TOO NOISY  — a side panel with four 6mm dados fills ~97.5% of its box, cleared the
//                   0.95 "tight box" bar, and a TEXTBOOK DADO JOINT drew the rule's most
//                   confident wording: "parts must share faces, never volume".
//   3. IT STEERED THE DESIGN — a driver notched a shelf around a corner post (correct
//                   cabinetmaking), then DELETED the notch because it was "geometrically
//                   right but undetectable to a bbox-based validator", accepting a 60mm
//                   dead setback. That one propagates into the artifact: the cut list
//                   tabulates the compromised shelf and the customer gets it.
//
// ⛔ The two failures pull against each other, so no threshold moves them both: stricter
// fails every dado-jointed cabinet, looser ships colliding models. ONLY a real intersection
// separates them — a dado shares FACES so the common volume is ~0, a collision has volume.
//
// ⭐ ONE IMPLEMENTATION, THREE CALLERS. app/cadWorker.ts (browser), scripts/headless/
// runner.mjs → services/geometry/server.mjs (the copy an agent actually sees) and
// scripts/headless/sweep.mjs all import THIS file. The rule used to be re-typed in each,
// which is exactly how the browser and the agent came to be able to disagree
// [[feedback_three_registries]]. Both node callers load this .ts by native type-stripping,
// same as app/lib/obb.ts — so keep the syntax erasable (no enums, no namespaces).
//
// ⚠ MEASUREMENT MUST HAPPEN WHILE THE SHAPES ARE ALIVE. cadWorker calls shape.delete()
// right after meshing and the validator only ever receives {name, mesh, obb} — no B-rep.
// So this file is split in two halves on purpose:
//   · measureInterference() — needs OCC and live shapes. Runs inside the build.
//   · analyzeOverlaps()     — pure, runs on meshes, turns verdicts into findings.

                       
                             
                             
                             
                                              
 

/** mm of penetration on ALL THREE axes before a pair is worth measuring. Parts that merely
 *  share a face have ~0 on one axis, so this gate alone drops every butt joint. */
export const OVERLAP_THRESHOLD = 0.1;

/** mm³ of shared solid volume before it is called interference rather than contact.
 *  Coincident faces produce an empty or 2D common (volume 0); this floor absorbs the
 *  tolerance-scale residue of a boolean on faces that are meant to be flush. */
export const INTERFERENCE_VOLUME = 1.0;

/** Fill ratio above which an AABB is treated as the part itself — used ONLY on the fallback
 *  path where no real intersection was measured. ⚠ Deliberately far tighter than the 0.95
 *  this rule used to assert on: a side panel with four 6mm dados fills 0.975 and is NOT a
 *  box. At 0.999 the confident wording is reserved for parts that really are boxes. */
export const EXACT_BOX_FILL = 0.999;

/** The interactive caps. EXPORTED so an acceptance test can plant a defect past the cap and
 *  assert against the shipped number rather than a re-typed 64 — a hard-coded copy would go
 *  green on the day the real cap moved. */
export const DEFAULT_MAX_PAIRS = 64;
export const DEFAULT_BUDGET_MS = 400;

// ── Mesh geometry (pure) ──────────────────────────────────────────────────────

export function aabbOf(vertices                           )              {
  if (!vertices || vertices.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, sizeX: maxX - minX, sizeY: maxY - minY, sizeZ: maxZ - minZ };
}

/** Signed volume of a closed triangle mesh (divergence theorem). Only used to decide how
 *  much to TRUST a bounding box when no real intersection could be measured. */
export function meshVolume(vertices                           , triangles                           )                {
  if (!vertices?.length || !triangles?.length || triangles.length % 3 !== 0) return null;
  let v = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    if (a + 2 >= vertices.length || b + 2 >= vertices.length || c + 2 >= vertices.length) return null;
    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
    const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2];
    const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

/** How much of its own bounding box a part fills. null = not computable, which must always
 *  read as "unknown", never as "fine". */
export function boxFill(vertices                           , triangles                           )                {
  const bb = aabbOf(vertices);
  if (!bb) return null;
  const boxVol = bb.sizeX * bb.sizeY * bb.sizeZ;
  if (!(boxVol > 0)) return null;
  const vol = meshVolume(vertices, triangles);
  return vol == null ? null : vol / boxVol;
}

export function boxesPenetrate(a      , b      , threshold = OVERLAP_THRESHOLD)                                                {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return dx > threshold && dy > threshold && dz > threshold ? { dx, dy, dz } : null;
}

// ── The verdict a pair earns ─────────────────────────────────────────────────

                         
                                                                   
                                            
                                                                                          
                                       
                                                                                    
                                                                    
                                           

/** Verdicts are keyed by the pair's index in the parts array the BUILD returned, so the
 *  measuring half and the reporting half cannot drift apart on names (duplicate part names
 *  are legal enough to reach this code — checkDuplicateNames flags them separately). */
export function pairKey(i        , j        )         {
  return `${i}:${j}`;
}

// ── The measuring half (needs OCC + live shapes) ─────────────────────────────

                                    
               
                                                                    
             
                  
 

                              
                                                                                      
                                                                                        
                          
                    
                                                                  
                    
                              
 

/** ⭐⭐ EXHAUSTIVE MODE — the same check, with the pair cap taken off.
 *
 *  t4-overlap-truth made a partial check SAY it was partial. It did not make any check
 *  complete, and the model that started it still cannot be checked: 143 penetrating pairs,
 *  64 measured, roof boards overlapping by 32,073mm³ in a pair the walk never reached. A
 *  verdict that names its own blind spot is honest and still blind.
 *
 *  ⭐ maxPairs goes to Infinity, budgetMs stays FINITE, and that asymmetry is the design.
 *  The pair cap is arbitrary — 64 is a number, not a property of any model — so lifting it
 *  costs only time. The clock is not arbitrary: it is the thing standing between a big model
 *  and a job that returns nothing at all. Keeping it means the worst case is a PARTIAL result
 *  that says so (analyzeOverlaps emits interference_coverage naming the budget), which is
 *  strictly better than a timeout, where the caller learns nothing about anything.
 *
 *  ⚠ This budget is per BUILD, and a certifying sweep runs one build per parameter point —
 *  see exhaustiveOptsForPoints below, and scripts/headless/probe-exhaustive-cost.mjs for the
 *  measured cost these numbers were chosen against. Only bbox-penetrating pairs cost a
 *  boolean, so a stacked cabinet pays nearly nothing; tilted members (rafters, sloped boards)
 *  have fat diagonal AABBs and are what actually spend this.
 */
export const EXHAUSTIVE_BUDGET_MS = 20_000;
export const EXHAUSTIVE_OPTS              = { maxPairs: Infinity, budgetMs: EXHAUSTIVE_BUDGET_MS };

/** ⭐⭐ A SWEEP RUNS ONE BUILD PER PARAMETER POINT, so the per-build budget above is the
 *  WRONG unit for it: 59 points × 20s is 20 minutes of clock that a certifying sweep's own
 *  timeout would kill outright, and a job that dies tells the caller nothing about anything.
 *  So the sweep gets a TOTAL, divided evenly across its points.
 *
 *  ⭐ Evenly, not first-come-first-served. Every point is equally part of "every reachable
 *  configuration is clean", and a greedy budget would let the early points spend the late
 *  ones — which is the 64-pair bug again with a different cursor. A point that overruns its
 *  share reports partial coverage for ITSELF and the sweep carries on.
 *
 *  Clamped at both ends: never below the interactive budget (a short sweep must not come out
 *  worse than an ordinary build), never above the single-build one. Measured cost that sets
 *  these numbers: scripts/headless/probe-exhaustive-cost.mjs. */
export const EXHAUSTIVE_SWEEP_BUDGET_MS = 180_000;
export function exhaustiveOptsForPoints(pointCount        )              {
  const share = Math.floor(EXHAUSTIVE_SWEEP_BUDGET_MS / Math.max(1, pointCount || 1));
  return { maxPairs: Infinity, budgetMs: Math.min(EXHAUSTIVE_BUDGET_MS, Math.max(DEFAULT_BUDGET_MS, share)) };
}

/** What a CALLER may ask for. `false`/absent = do not measure; `true` = the interactive
 *  defaults; `"exhaustive"` = EXHAUSTIVE_OPTS; an object = exactly those knobs.
 *
 *  ⭐ `"exhaustive"` IS A TOKEN, NOT A NUMBER, because this spec crosses two JSON hops
 *  (worker → geometry service → sweep) and `Infinity` does not survive JSON.stringify — it
 *  serializes to `null`, which resolveMeasureOpts would then read as "no cap given, use 64".
 *  A caller that shipped the numbers would silently get back the exact default it was trying
 *  to escape. Sending a word keeps the numbers in this file, which is also the only place any
 *  of the three registries should be able to state them [[feedback_three_registries]]. */
                                                                                       

/** → the opts to measure with, or null for "do not measure at all". One normaliser, so the
 *  browser worker and the headless runner cannot disagree about what a spec means. */
export function resolveMeasureOpts(spec                  )                     {
  if (spec === false || spec == null) return null;
  if (spec === true) return {};
  if (spec === "exhaustive") return { ...EXHAUSTIVE_OPTS };
  if (typeof spec === "object") return spec;
  return {};   // an unrecognised truthy value measures with the defaults rather than skipping
}

/** ⚠ Most parts arrive as a COMPOUND WRAPPING ONE SOLID, not as a bare Solid — that is what
 *  any .cut()/.fuse() hands back. So "is it a compound?" is the wrong question and refusing
 *  compounds outright refuses every dado panel (measured: the first run of this file's proof
 *  did exactly that). The right question is how many SOLIDS it contains, which is also the
 *  answer to api-replicad.md:279 — a boolean against a MULTI-solid compound silently uses
 *  one of them, so those get exploded and summed instead of trusted whole. */
function countSolids(oc     , wrapped     )         {
  try { return forEachSolid(oc, wrapped, () => {}); }
  catch { /* an uncountable shape reports 0 and is refused below, never assumed empty */ }
  return 0;
}

/**
 * ⭐ THE ONE TopAbs_SOLID WALK. Exported because `app/lib/soundness.ts` needs the identical
 * traversal, and a second copy of it is exactly the duplication guard S27 exists to stop —
 * two walks drift, and then the overlap rule and the soundness rule disagree about how many
 * solids a part has while both look right in isolation [[feedback_three_registries]].
 *
 * `visit` returns `false` to stop early (that is how soundness.ts honours its cap). The return
 * value is the number of solids `visit` was CALLED on — the part's true solid count when
 * nothing stopped it, and one MORE than the number of solids actually processed when a visitor
 * declines. Callers that cap must therefore keep their own tally of what they measured rather
 * than reading this number, which is what soundness.ts does.
 *
 * ⚠ `Current()` is a reference that MOVES on `Next()`. It is handed to `visit` to be consumed
 * IMMEDIATELY and must never be held across an iteration boundary or collected into an array.
 * It is not `delete()`d either — it is the explorer's own handle, and the explorer is freed in
 * the `finally` below.
 *
 * ⚠ This throws where the old private countSolids swallowed: a caller that cannot look must be
 * able to tell that apart from a shape with no solids. countSolids above keeps its historical
 * catch-to-zero so its own callers are unchanged; soundness.ts reports the failure instead.
 */
export function forEachSolid(
  oc     ,
  wrapped     ,
  visit                                               ,
)         {
  let n = 0;
  let exp      = null;
  try {
    exp = new oc.TopExp_Explorer_2(wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (exp.More()) {
      const carryOn = visit(exp.Current(), n);
      n++;
      if (carryOn === false) break;
      exp.Next();
    }
  } finally { try { exp?.delete(); } catch { /* already gone */ } }
  return n;
}

/** Sum of common volumes over every solid-vs-solid sub-pair. ⚠ Each explorer's Current() is
 *  a reference that moves on Next(), so it is consumed IMMEDIATELY and never collected. */
function solidwiseCommonVolume(oc     , aw     , bw     )         {
  const ta = oc.TopAbs_ShapeEnum;
  let total = 0;
  let ea      = null;
  try {
    ea = new oc.TopExp_Explorer_2(aw, ta.TopAbs_SOLID, ta.TopAbs_SHAPE);
    while (ea.More()) {
      const sa = ea.Current();
      let eb      = null;
      try {
        eb = new oc.TopExp_Explorer_2(bw, ta.TopAbs_SOLID, ta.TopAbs_SHAPE);
        while (eb.More()) {
          total += commonVolume(oc, sa, eb.Current());
          eb.Next();
        }
      } finally { try { eb?.delete(); } catch { /* already gone */ } }
      ea.Next();
    }
  } finally { try { ea?.delete(); } catch { /* already gone */ } }
  return total;
}

/** Common (intersection) volume of two live shapes, in mm³.
 *
 *  ⚠ Deliberately NOT replicad's shape.intersect(): that wrapper runs SimplifyResult and
 *  then THROWS "Could not intersect as a 3d shape" whenever the common is empty or a bare
 *  face — which is precisely the dado case we need to read as ZERO, not as an error. The
 *  raw BRepAlgoAPI_Common gives the same boolean without the lossy re-interpretation, and
 *  VolumeProperties on a non-closed result is 0 by definition. */
function commonVolume(oc     , aw     , bw     )         {
  let progress      = null, algo      = null, props      = null;
  try {
    progress = new oc.Message_ProgressRange_1();
    algo = new oc.BRepAlgoAPI_Common_3(aw, bw, progress);
    algo.Build(progress);
    if (typeof algo.IsDone === "function" && !algo.IsDone()) {
      throw new Error("OCC did not complete the common-volume boolean");
    }
    const shp = algo.Shape();
    if (typeof shp?.IsNull === "function" && shp.IsNull()) return 0;
    props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shp, props, false, false, false);
    return Math.abs(props.Mass());
  } finally {
    try { props?.delete(); } catch { /* already gone */ }
    try { algo?.delete(); } catch { /* already gone */ }
    try { progress?.delete(); } catch { /* already gone */ }
  }
}

/** A pair of multi-solid parts costs nA × nB booleans. Past this it is refused OUT LOUD
 *  rather than measured slowly or answered from one arbitrary solid. */
const MAX_SUB_PAIRS = 24;

function measurePair(oc     , a                   , b                   , floor        )              {
  const counts           = [];
  for (const side of [a, b]) {
    const wrapped = side.shape?.wrapped;
    if (!wrapped) return { kind: "unverified", reason: `part '${side.name}' did not expose a B-rep shape to measure` };
    const n = countSolids(oc, wrapped);
    if (n === 0) {
      return { kind: "unverified", reason: `part '${side.name}' contains no closed solid, so it has no volume to share (a shell or a surface)` };
    }
    counts.push(n);
  }
  if (counts[0] * counts[1] > MAX_SUB_PAIRS) {
    return {
      kind: "unverified",
      reason: `these parts are compounds of ${counts[0]} and ${counts[1]} solids — ${counts[0] * counts[1]} solid-to-solid intersections, past this build's ${MAX_SUB_PAIRS} limit for one pair`,
    };
  }
  try {
    const volume = solidwiseCommonVolume(oc, a.shape.wrapped, b.shape.wrapped);
    if (!Number.isFinite(volume)) return { kind: "unverified", reason: "the common-volume boolean returned a non-finite volume" };
    return volume > floor ? { kind: "interference", volume } : { kind: "contact", volume };
  } catch (err     ) {
    const msg = typeof err === "number" ? `OCC exception pointer ${err}` : (err?.message ?? String(err));
    return { kind: "unverified", reason: `the common-volume boolean failed (${msg})` };
  }
}

/**
 * Measure the real shared volume of every pair whose bounding boxes already penetrate.
 * Returns verdicts keyed by pairKey(i, j) over the SAME array the build returned.
 *
 * Only bbox-tripping pairs are measured, so a well-built model pays for nothing: the
 * expensive half runs exactly where the old rule used to guess.
 */
export function measureInterference(oc     , entries                                             , opts              = {})                           {
  const out = new Map                     ();
  if (!oc || !entries || entries.length < 2) return out;
  const maxPairs = opts.maxPairs ?? DEFAULT_MAX_PAIRS;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const floor = opts.interferenceVolume ?? INTERFERENCE_VOLUME;
  const t0 = Date.now();
  let measured = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (!a?.bb || !b?.bb || !a.shape || !b.shape) continue;
      if (!boxesPenetrate(a.bb, b.bb)) continue;
      const key = pairKey(i, j);
      if (measured >= maxPairs) {
        out.set(key, { kind: "unverified", reason: `this build hit its ${maxPairs}-pair limit on intersection tests before reaching this pair` });
        continue;
      }
      if (measured > 0 && Date.now() - t0 > budgetMs) {
        out.set(key, { kind: "unverified", reason: `this build spent its ${budgetMs}ms intersection-test budget before reaching this pair` });
        continue;
      }
      measured++;
      out.set(key, measurePair(oc, a, b, floor));
    }
  }
  return out;
}

// ── The reporting half (pure — runs on meshes) ───────────────────────────────

                              
               
                                      
                                       
 

                                 
                          
               
                                
                  
                           
                                                                                         
                                    
    
                                                                                            
                                                                                             
                                                                                              
                                                                                          
                                                                                       
    
                                                                                             
                                                                                        
                                                                                              
                                                                                     
                                                                    
                       
 

const fmtVol = (v        ) => (v >= 1000 ? `${Math.round(v).toLocaleString("en-US")}` : v.toFixed(2));

/**
 * Turn each bbox-penetrating pair into the finding it has EARNED:
 *
 *   measured, volume > floor  → `part_interference`, severity ERROR. The parts really are
 *                               inside each other. This is the claim that used to be made
 *                               from a bounding box and is now made from a boolean.
 *   measured, volume ~ 0      → SILENCE. Shared faces are a joint, not a defect. This is
 *                               the dado, the notch, the cope and the scribe — the whole
 *                               class the old rule taxed.
 *   not measured              → `part_overlap`, severity warning, hedged, and it SAYS why
 *                               it could not measure. No lessonCandidate: a check that
 *                               cannot tell a joint from a collision must not teach.
 *
 * `verdicts` absent entirely (a build that could not measure at all, e.g. a replayed or
 * cached result) falls back to the graded bounding-box wording — but only calls it exact
 * when both parts really are boxes (EXACT_BOX_FILL), which the 0.95 bar did not.
 */
export function analyzeOverlaps(parts               , verdicts                                  )                   {
  const findings                   = [];
  // ⭐⭐ COVERAGE. measureInterference stops at maxPairs/budgetMs and marks the rest
  // `unverified`, which is honest per pair — but the VERDICT never said how much of the
  // model it had looked at, so "no interference found" read as a statement about the model
  // when it was a statement about the first 64 pairs. Measured: a 95-part shed had ~140
  // penetrating pairs, shipped GREEN, and its roof boards overlapped each other by
  // 32,073mm³. Counted here because this is the one place that already walks every pair and
  // already holds the verdicts — a second walk elsewhere would be a second writer of one
  // fact. See t4-overlap-truth.
  let penetrating = 0;
  let measured = 0;
  let capReason                = null;
  const boxes = parts.map((p) => (p?.vertices?.length ? aabbOf(p.vertices) : null));
  const fillCache = new Map                       ();
  const fillOf = (i        ) => {
    if (!fillCache.has(i)) fillCache.set(i, boxFill(parts[i]?.vertices, parts[i]?.triangles));
    return fillCache.get(i) ;
  };

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!a || !b) continue;
      const pen = boxesPenetrate(a, b);
      if (!pen) continue;
      const nameA = parts[i].name, nameB = parts[j].name;
      const depth = `${pen.dx.toFixed(1)}×${pen.dy.toFixed(1)}×${pen.dz.toFixed(1)}mm`;
      const verdict = verdicts?.get(pairKey(i, j));

      // Counted BEFORE the contact branch returns — a clean joint is the commonest
      // outcome of a real measurement, and omitting it would understate coverage badly.
      penetrating++;
      if (verdict?.kind === "contact" || verdict?.kind === "interference") measured++;
      else if (verdict?.kind === "unverified" && !capReason) capReason = verdict.reason;

      if (verdict?.kind === "contact") continue;              // a joint. Nothing to report.

      if (verdict?.kind === "interference") {
        findings.push({
          index: [i, j],
          rule: "part_interference",
          severity: "error",
          message:
            `Parts '${nameA}' and '${nameB}' occupy ${fmtVol(verdict.volume)}mm³ of the SAME solid volume ` +
            `(measured intersection, not a bounding-box guess; boxes penetrate ${depth}). ` +
            `Parts must share faces, never volume — cut the pocket/dado out of one of them, or move the other.`,
          lessonCandidate:
            `Parts '${nameA}' and '${nameB}' intersect by ${fmtVol(verdict.volume)}mm³ of real volume — derive each part's boundary from the adjacent part's face position ` +
            `(e.g. start at seatH + seatThick, not seatH), or cut the receiving part so the joint shares faces instead of volume.`,
        });
        continue;
      }

      // ── Not measured. Say exactly that, and why. ──
      const fa = fillOf(i), fb = fillOf(j);
      const fills = `${[fa, fb].map((f) => (f == null ? "?" : `${Math.round(f * 1000) / 10}%`)).join(" / ")}`;
      if (verdict?.kind === "unverified") {
        findings.push({
          index: [i, j],
          rule: "part_overlap",
          severity: "warning",
          unverified: true,   // measured nothing — reports, never gates (§8c)
          message:
            `Parts '${nameA}' and '${nameB}' have bounding boxes that penetrate by ${depth}, and the real intersection could NOT be measured: ` +
            `${verdict.reason}. They fill ${fills} of their boxes. This may be a joint (shared faces) or a collision — this build cannot tell which.`,
        });
        continue;
      }

      // No verdict at all: nothing measured intersections on this path.
      const bothBoxes = fa != null && fb != null && fa >= EXACT_BOX_FILL && fb >= EXACT_BOX_FILL;
      findings.push(bothBoxes
        ? {
            index: [i, j],
            rule: "part_overlap",
            severity: "warning",
            message:
              `Parts '${nameA}' and '${nameB}' overlap by ${depth}. Both are true boxes (${fills} of their bounding boxes), ` +
              `so the boxes ARE the parts and this is shared volume — parts must share faces, never volume. ` +
              `(No intersection was measured on this build path; the claim rests on the boxes.)`,
            lessonCandidate:
              `Parts '${nameA}' and '${nameB}' occupy shared volume — derive each part's boundary from the adjacent part's face position (e.g. start at seatH + seatThick, not seatH).`,
          }
        : {
            index: [i, j],
            rule: "part_overlap",
            severity: "warning",
            unverified: true,   // "may be clearance, not contact" — reports, never gates (§8c)
            message:
              `Parts '${nameA}' and '${nameB}' have bounding boxes that penetrate by ${depth}, and no real intersection was measured on this build path. ` +
              `They fill ${fills} of their boxes, so at least one is not box-shaped — an angled or notched part's box is much larger than the part, ` +
              `and this may be clearance, not contact.`,
          });
    }
  }

  // ⚠ MARKED `unverified` DELIBERATELY. Partial coverage is not a defect, and `passed` is
  // false for ANY problem lacking this flag regardless of severity — so without it every
  // model above the cap would start failing validation, which is a worse lie than the one
  // this fixes. It reports; it never gates. Emitted only when the check actually fell
  // short, so a fully-measured model stays silent and the line means something when it
  // appears. `index` is [-1,-1] because this is a statement about the BUILD, not a pair;
  // neither caller reads it (validator.ts and checks.mjs both map rule/severity/message).
  if (penetrating > measured) {
    const missed = penetrating - measured;
    findings.unshift({
      index: [-1, -1],
      rule: "interference_coverage",
      severity: "warning",
      unverified: true,
      message:
        `⚠ PARTIAL CHECK — measured ${measured} of ${penetrating} bounding-box-overlapping pairs; ${missed} went unchecked` +
        `${capReason ? ` because ${capReason.replace(/ before reaching this pair$/, "")}` : ""}. ` +
        `So "no interference found" describes those ${measured} pairs, NOT the whole model. ` +
        `Re-check the unmeasured pairs before treating this build as clean — filter to the part families named in the ` +
        `part_overlap warnings below and measure them separately.`,
    });
  }
  return findings;
}
