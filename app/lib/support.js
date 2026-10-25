// The ONE "is this part standing on anything?" rule.
//
// Extracted 2026-08-10 (t22-localpack L2) from app/lib/validator.ts, which had it as
// `checkUnsupportedParts`, while services/geometry/server.mjs carried a RE-TYPED copy in
// `defaultProblems`. Two writers of one fact drift — and these two already had: the browser
// said "Part 'X' sits at…" with a severity and a lesson candidate, the agent-facing copy said
// "'X' sits at…" with neither. Same rule, same model, two different answers depending on who
// asked. Same reason obb.ts / interference.ts / execProfile.ts are shared modules.
// [[feedback_three_registries]]
//
// ⚠ KEPT DEPENDENCY-FREE ON PURPOSE, exactly like execProfile.ts: packages/engine/checks.mjs
// imports this through Node's native TypeScript type-stripping, so it must not reach for
// anything that needs a bundler, and it must not use non-erasable TS (no enums, no
// namespaces, no parameter properties).
//
// It takes BOXES, not meshes, because its two callers arrive with different things in hand —
// the browser has meshed vertices, the headless runner has bounding boxes already measured
// during the build. Neither should have to fake the other's shape to ask the same question.

                          
               
                                                                                             
  

                              
                           
                      
                  
                          
  

// Conservative by construction, because a false "this is floating" is worse than silence —
// the part_overlap precedent is the standard here:
//   · a Z only counts as a floor DATUM when MIN_LEVEL_PARTS parts share a bottom there. One
//     part alone at some height is a hanging thing (a rail, a beam, a sliding door), not a line.
//   · the level must have an actual floor — some other part's TOP must land on it. No floor,
//     no claim: a model that simply floats everything is not this rule's business.
//   · a part is flagged only when its footprint misses EVERY floor part. Partial overhang
//     (a deck nosing, a cantilevered step) is deliberate and stays silent. Tightening this to
//     full containment would be more thorough and would fire on legitimate overhangs.
export const GROUND_TOL = 0.5;      // at or below this, the part rests on the ground
export const LEVEL_TOL = 0.5;       // bottoms within this share a level
export const MIN_LEVEL_PARTS = 3;   // fewer than this sharing a Z is coincidence, not a datum
export const FOOTPRINT_TOL = 0.5;   // mm of XY overlap before it counts as bearing

/**
 * ⚠⚠ KNOWN FALSE-POSITIVE CLASS — recorded here rather than in a plan doc, because this is
 * the file anyone tempted to "improve" the rule will open. Cold drivers in the rig archive
 * (evals/test-rig/runs/2026-08-09-campaign-buildloop-shape-classes, 2026-08-10-draftspitch-*)
 * hit this repeatedly and independently: the rule knows only about BEARING FROM BELOW, so it
 * fires on standard cabinetmaking where a part is carried by its ENDS or its FACE —
 * a top stretcher held by the side panels, a rail housed into an end panel, a nailer
 * face-screwed to a back panel, a face-frame rail overhanging a toe-kick recess (which is
 * what a toe kick IS). One driver reported nine such findings on one legitimate cabinet.
 * The rule is not wrong about what it measures; it is silent about what it cannot see, and
 * it does not say so. Widening it (edge/face attachment, e.g. reusing the interference
 * contact pairs which already know which parts touch) is a REAL improvement and a real
 * decision — it is deliberately NOT part of the extraction that shared this code, because
 * changing behaviour and changing ownership in one move makes both unreviewable.
 */
export function findUnsupportedParts(boxes              )                   {
  if (boxes.length < MIN_LEVEL_PARTS) return [];

  const levels = new Map                      ();
  for (const b of boxes) {
    if (b.bb.minZ <= GROUND_TOL) continue; // on the ground — supported by definition
    const key = Math.round(b.bb.minZ / LEVEL_TOL) * LEVEL_TOL;
    const list = levels.get(key);
    if (list) list.push(b); else levels.set(key, [b]);
  }

  const findings                   = [];
  for (const [level, atLevel] of levels) {
    if (atLevel.length < MIN_LEVEL_PARTS) continue;
    const floors = boxes.filter(f => Math.abs(f.bb.maxZ - level) <= LEVEL_TOL);
    if (!floors.length) continue; // nothing forms a floor here — cannot judge, so say nothing
    for (const p of atLevel) {
      const bearing = floors.some(f =>
        f !== p &&
        Math.min(f.bb.maxX, p.bb.maxX) - Math.max(f.bb.minX, p.bb.minX) > FOOTPRINT_TOL &&
        Math.min(f.bb.maxY, p.bb.maxY) - Math.max(f.bb.minY, p.bb.minY) > FOOTPRINT_TOL);
      if (!bearing) {
        findings.push({
          rule: "unsupported_part",
          severity: "warning",
          message:
            `Part '${p.name}' sits at z=${level.toFixed(1)}mm with nothing beneath it — ` +
            `${floors.length} part(s) form a floor at that level and its footprint overlaps none of them.`,
          lessonCandidate:
            `Part '${p.name}' was placed on the floor line but its X/Y footprint falls outside every part forming that floor — ` +
            `when a floor is assembled from repeated boards, derive its span and its starting origin from the SAME reference, or span it with one box.`,
        });
      }
    }
  }
  return findings;
}
