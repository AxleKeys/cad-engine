// Part connectivity: is each PART still one piece?
//
// ⭐ WHY THIS EXISTS. A part is a name and a shape, and until this file no check asked how many
// SOLIDS that shape holds. Every other rule reads either the mesh or one solid at a time, so a
// part that has fallen into loose pieces meshes, measures and certifies green. The cold-agent brief
// of 2026-09-15 is the case: a cube with a centred sphere cut out of it is one solid at openness 0.6
// and eight loose corners at 0.8 (evals/fixtures/split-at-corner.js), and certify_model passed it.
// A dado deep enough to reach the panel's far face does the same to a real cabinet:
// evals/fixtures/dado-joint.js at thickness=min,dadoDepth=max cuts Side left and Side right into
// 5 solids each.
//
// WHAT IT OWNS.
//   - countPieces: the solid count of ONE live shape, through the one TopAbs_SOLID walk
//     (app/lib/interference.ts forEachSolid), plus the smallest piece's volume only when asked.
//     Every door reports the count as a fact: packages/engine/runner.mjs, app/cadWorker.ts, the
//     server build record, and mcp/lib/solidity.js piecesTag/piecesLine print it.
//   - splitFindings: the `part_splits` finding. Guard S27 gives this file the id; nothing else may
//     construct it. Only certify_model's sweep (scripts/headless/sweep.mjs) calls it, because it
//     compares a count with the code as saved, and a single build has nothing to compare against.
//
// ⚠⚠ ITS LIMITS, MEASURED (design probes over 129 real models and the 10 goldens, 2026-09-15).
//   - REFERENCE AND BLIND SPOT. The build of the code as saved is the reference, so a part that is
//     already in pieces as saved is never gated: the same dice saved at openness 0.8
//     (evals/fixtures/split-as-saved.js, 8 solids) certifies. The build verdict lists such a part.
//   - FALSE POSITIVE: a grouped part whose member count defaults to 1. `slatCount = 1; // [1:8]`
//     returning one compound fails at slatCount=max (slats 1 → 8 solids).
//   - FALSE POSITIVE: a toggle that adds a separate member to one part. `withPull = 0; // [0:1]`
//     fails at withPull=max (door 1 → 2 solids, the added piece 0.37% of the door's volume).
//   - NAME BLIND SPOT. Parts are matched by name and occurrence, so a part whose name embeds a
//     parameter value is never compared: b9c7f898 has 33 parts at defaults and 91 distinct part
//     names across its sweep points.
//   - PREVALENCE of both false-positive shapes in the real corpus: 0 of 129 models.
//   - PAIRING BY NAME (round three's review, 2026-09-15). Parts are grouped by name. Where a name has
//     as many parts at a point as in the code as saved, they pair by position. Where the count
//     differs, a position no longer names the same part: pairing by name plus position failed a model
//     where nothing split, because dropping an optional one-solid "Hardware" hinge at withHinge=min
//     moved a six-screw "Hardware" compound into the hinge's slot (1 → 6). So a name whose count
//     changes is compared only when EVERY part of that name is one solid as saved, and then each of
//     its parts above one solid at the point fails ("Every part named 'X' is one solid in the code
//     as saved"). A loop that grows at a corner and splits there is still caught (a notched shelf
//     loop, shelfCount [2:5], fails at all-max for all five shelves). A name with a several-solid part
//     as saved is skipped when its count changes. What it still gets wrong:
//       - a several-solid part inserted at a corner under a one-solid part's name fails
//         (saved [S: 1 solid], the corner [S: 3 solids, S: 1 solid]);
//       - so does a toggle that adds such a part (saved [Hardware: 1], withScrews=max [Hardware: 1,
//         Hardware: 6]), beside the toggle above that adds a member inside one part (door 1 → 2).
//   - VOLUME READS ARE BY NAME. `pieceVolumes` (savedSingleNames) holds names, so at every later point
//     each part of such a name that holds 2 to PIECE_VOLUME_CAP solids is weighed, split or not: the
//     six-screw "Hardware" group costs 6 reads a point. The extra cost is not only at failing points.
// scripts/headless/test-part-splits.mjs pins all of these as documented behaviour.
//
// ⚠ NO DUST FLOOR. The count is the raw walk. A solid with |v| <= VOL_EPS already fails as
// non_positive_volume (app/lib/soundness.ts), so a floor here would be a second, unmeasured threshold.
//
// ⚠ Dependency-free and erasable TypeScript only, like soundness.ts: the geometry service and the
// public engine load it through Node's type stripping, and the browser worker through Vite.

import { forEachSolid } from "./interference.js";
import { signedVolume } from "./soundness.js";

/** Above this many solids a part's pieces are counted but not weighed. A sweep weighs a part at a later
 *  point only when its NAME has a part of one solid as saved (savedSingleNames) and it holds 2 to 64
 *  solids there, so one weighed part costs at most 64 reads (the slowest single read measured 2.85 ms).
 *  That is not only a part that split: a several-solid part sharing such a name is weighed at every
 *  later point (see VOLUME READS ARE BY NAME above). */
export const PIECE_VOLUME_CAP = 64;

                             
                                                                                                 
                        
                                                                                                 
                                                                       
                            
 

/**
 * Count the solids of one live shape. Needs the B-rep, so it runs in the same window as the
 * interference and soundness passes, before the shape is deleted.
 *
 * `volumes` is off by default and every per-build caller leaves it off: push, /validate, /execute,
 * drawings and Studio pay the walk alone. The sweep turns it on per part name (runner.mjs
 * opts.pieceVolumes) so a split it reports can say how small the smallest piece is.
 */
export function countPieces(oc     , wrapped     , opts                        = {})             {
  let n        ;
  try {
    n = forEachSolid(oc, wrapped, () => {});
  } catch {
    return { solids: null };
  }
  if (n <= 1 || !opts.volumes || n > PIECE_VOLUME_CAP) return { solids: n };
  let smallest = Infinity;
  try {
    forEachSolid(oc, wrapped, (solid     ) => {
      // Consumed at once and never stored: Current() moves on Next() (forEachSolid's warning).
      const read = signedVolume(oc, solid, false);
      if (read.ran) smallest = Math.min(smallest, Math.abs(read.value));
    });
  } catch {
    /* a walk that fails part-way keeps the reads that ran */
  }
  return Number.isFinite(smallest) ? { solids: n, smallestSolidMm3: smallest } : { solids: n };
}

                               
                      
                    
                  
 

/** A part as a sweep point reports it: runner.mjs parts[] reduced to what this file reads. */
                            
               
                         
                            
 

/** The part names that have an occurrence of exactly one solid. The sweep hands these to every
 *  later point as `pieceVolumes`. It holds NAMES, so a several-solid part that shares one is weighed
 *  too, at every later point, whether or not it split (VOLUME READS ARE BY NAME, above). */
export function savedSingleNames(parts                                                        )              {
  const out = new Set        ();
  for (const p of parts ?? []) if (p && p.solids === 1) out.add(p.name);
  return out;
}

/** Each name's parts, in the order the model returned them. A null entry is skipped. A Map, so a part
 *  named `__proto__` or `constructor` is a name like any other. */
function byName(parts                                                        )                           {
  const out = new Map                     ();
  for (const p of parts ?? []) {
    if (!p) continue;
    const list = out.get(p.name);
    if (list) list.push(p);
    else out.set(p.name, [p]);
  }
  return out;
}

const isSplit = (n         )              => typeof n === "number" && Number.isInteger(n) && n > 1;

const fmt = (v        )         => {
  if (!Number.isFinite(v)) return String(v);
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 1) return String(Math.round(v * 100) / 100);
  if (v === 0) return "0";
  return v.toPrecision(2);
};

/**
 * One finding per part that is one solid in the code as saved and more than one at this point.
 * Pure. Parts are grouped by name (PAIRING BY NAME in the header):
 *   - a name with as many parts here as saved pairs them by position;
 *   - a name whose count changed is compared only when every part of it is one solid as saved, and
 *     then each of its parts here above one solid is a finding;
 *   - a name missing on either side, a name with a several-solid or uncounted part as saved whose
 *     count changed, and a null or 0 count are skipped: this compares counts, and a part it cannot
 *     pair or a count it does not have is not a split.
 *
 * The message states the counts, the smallest piece when it was weighed, and the reference. It
 * carries no recipe: why a part split is the model's business, and the count is the verdict.
 */
export function splitFindings(
  saved                                                        ,
  run                                                        ,
  label        ,
)                 {
  const now = byName(run);
  const out                 = [];
  const REFERENCE = "This check compares each part's solid count with the code as saved.";
  const smallest = (mm3                    )         => (mm3 != null ? ` (the smallest ${fmt(mm3)} mm³)` : "");
  const finding = (message        )               => ({ rule: "part_splits", severity: "error", message });
  for (const [name, was] of byName(saved)) {
    const is = now.get(name) ?? [];
    if (was.length === is.length) {
      was.forEach((s, i) => {
        const r = is[i];
        if (s.solids !== 1 || !isSplit(r?.solids)) return;
        out.push(finding(`Part '${name}' is one solid in the code as saved and ${r.solids} separate solids at ${label}${smallest(r.smallestSolidMm3)}. ${REFERENCE}`));
      });
      continue;
    }
    // The count changed, so a position no longer names the same part.
    if (!is.length || !was.every((s) => s.solids === 1)) continue;
    const savedCount = `${was.length} part${was.length === 1 ? "" : "s"}`;
    const which = is.length === 1 ? "the one" : `one of the ${is.length}`;
    for (const r of is) {
      if (!isSplit(r.solids)) continue;
      out.push(finding(`Every part named '${name}' is one solid in the code as saved (${savedCount}), and ${which} at ${label} is ${r.solids} separate solids${smallest(r.smallestSolidMm3)}. ${REFERENCE}`));
    }
  }
  return out;
}
