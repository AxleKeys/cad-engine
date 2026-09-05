// The check surface — the deterministic problems an agent actually reads.
//
// ⭐ THIS IS THE HALF THE ENGINE SHIPPED WITHOUT (t22-localpack L2, 2026-08-10).
// runner.mjs runs no validator; it says so in its own header. Until now the checks lived in
// services/geometry/server.mjs, layered on top of the result — which meant the engine could
// be handed to anyone and would return a confident CLEAN verdict for models the server
// rejects. A fast local loop that is wrong is worse than a slow one that is right, and it
// surfaces as support load rather than as a bug. So the checks live beside runModel now, and
// the pack cannot be shipped without them.
//
// ⚠ THIS IS NOT A NEW IMPLEMENTATION. Every rule here either moved verbatim from server.mjs
// or delegates to the module that already owned it (app/lib/interference.ts for overlap,
// app/lib/support.ts for bearing). If this file ever starts to disagree with the browser
// about the same model, the design is wrong — see scripts/headless/test-engine-parity.mjs,
// which fails a run on exactly that.

import { runModel } from "./runner.mjs";
import { analyzeOverlaps } from "../../app/lib/interference.js";
import { findUnsupportedParts } from "../../app/lib/support.js";
import { soundnessProblems } from "../../app/lib/soundness.js";

const DEGENERATE = 0.01;

/**
 * The default deterministic checks over a runModel result.
 *
 * ⚠ EVERY PROBLEM CARRIES A `severity`, and that is a fix, not decoration. The overlap
 * findings always had one and the rest did not, so `validate_draft` returned an array where
 * `too_many_parameters` was tagged and `unsupported_part` was bare — two cold drivers
 * independently reported being unable to tell which finding had flipped `passed`, and the
 * SAME model came back tagged `[warning]` from `promote_draft`, which reads the browser
 * validator's copy. Severities here match app/lib/validator.ts for the same rule ids, which
 * is the whole point of the shared modules below.
 *
 * Severity informs the reader; what GATES is decided by gatingProblems() below, in one place.
 */
export function defaultProblems(res) {
  const problems = [];
  if (!res.parts.length) {
    problems.push({ rule: "empty_parts_array", severity: "error", message: "model returned no parts" });
  }
  for (const p of res.parts) {
    if (!p.vertexCount) {
      problems.push({ rule: "empty_mesh", severity: "error", message: `part '${p.name}' has no geometry` });
      continue;
    }
    for (const [axis, size] of [["X", p.bbox.sizeX], ["Y", p.bbox.sizeY], ["Z", p.bbox.sizeZ]]) {
      if (size < DEGENERATE) {
        problems.push({ rule: "degenerate_dimension", severity: "error", message: `part '${p.name}' near-zero on ${axis}` });
      }
    }
  }

  // ⭐ THE OVERLAP RULE IS NOT RE-TYPED HERE. It used to be a hand-kept mirror of
  // app/lib/validator.ts, and this copy is the one an agent actually reads — so the two
  // could disagree and the browser would look fixed while every agent saw the old rule
  // [[feedback_three_registries]]. Both call app/lib/interference.ts, and the verdicts come
  // from a REAL intersection measured inside the build (runModel opts.interference), not
  // from bounding boxes. Board row t4-overlap-truth.
  //
  // ⚠ `res.interference` MISSING is not the same as "nothing found": analyzeOverlaps then
  // hedges every finding and says out loud that it could not measure. buildVerdict() below
  // exists so that no reporting path can reach here without it.
  for (const f of analyzeOverlaps(
    res.parts.map((p) => ({ name: p.name, vertices: p.mesh?.vertices, triangles: p.mesh?.triangles })),
    res.interference,
  )) {
    // `unverified` rides through: it is what lets a caller separate "there is a defect" from
    // "I ran out of budget to look" without pattern-matching prose. See gatingProblems below.
    problems.push({ rule: f.rule, severity: f.severity, message: f.message, ...(f.unverified ? { unverified: true } : {}) });
  }

  // ⭐ NOR IS THE BEARING RULE. It was a hand-kept mirror of validator.ts checkUnsupportedParts
  // until L2; both now call app/lib/support.ts. The known false-positive class (parts carried
  // by their ENDS or FACE rather than from below) is documented there.
  const boxes = res.parts
    .filter((p) => p.bbox && p.vertexCount)
    .map((p) => ({ name: p.name, bb: p.bbox }));
  for (const f of findUnsupportedParts(boxes)) {
    problems.push({ rule: f.rule, severity: f.severity, message: f.message });
  }

  // ⭐ THE FIRST CHECK IN THIS FILE THAT DOES NOT READ THE MESH (t31-solidverdict).
  // Everything above reads the triangulation, which is why a SINGLE solid holding more volume
  // than its own bounding box passes green and passes check_dimensions exactly — measured on
  // 7 model-code cases in scripts/headless/probe-solid-soundness.mjs. The rules are
  // CONSTRUCTED in app/lib/soundness.ts and nowhere else (guard S27); this is the projection.
  //
  // ⚠ `res.soundness` MISSING is not "nothing found" — unlike overlap there is no mesh-level
  // fallback that could hedge, because a mesh cannot answer either of the two questions. So
  // soundnessProblems() turns absence into one `unverified` line saying nobody looked.
  for (const f of soundnessProblems(res.soundness)) {
    problems.push({ rule: f.rule, severity: f.severity, message: f.message, ...(f.unverified ? { unverified: true } : {}) });
  }

  return problems;
}

/**
 * ⭐⭐ THE REPORTING DOOR — build a model AND check it, in one call that cannot forget the
 * measurement its own verdict depends on.
 *
 * runModel's `opts.interference` defaults OFF, deliberately: it costs a boolean per suspect
 * pair and a sweep running hundreds of points should not pay for it. But that default is a
 * trap for exactly this file's audience — call `runModel(code)` and hand the result to
 * `defaultProblems`, and the overlap verdict silently degrades to the bounding-box guess
 * that t4-overlap-truth exists to retire. The degradation is visible in the message, but
 * only to someone who knows to look.
 *
 * So: anything that reports to a human or an agent calls THIS, and gets the flag by
 * construction. Pass `{ interference: false }` to opt out — explicitly, in the caller, where
 * the choice is legible.
 *
 * ⚠ THE SOUNDNESS PASS RIDES THE SAME SWITCH (t31-solidverdict, runner.mjs). `interference`
 * absent ⇒ both run; `{ interference: false }` turns BOTH off unless `soundness` is passed
 * explicitly, and defaultProblems then says out loud that nobody looked at the solids.
 */
/**
 * ⭐⭐ THE ONE PLACE THAT DECIDES WHAT `passed` MEANS (HK ruling 2026-08-10, plan §8c).
 *
 * A finding marked `unverified` is the build saying "I could not tell" — the 400ms
 * interference budget ran out before it reached that pair. It is reported, because silence
 * about an unmeasured pair would be worse. It does NOT gate, because "I could not tell" is
 * not "there is a defect", and letting it gate made `passed` a function of machine load: a
 * correctly dado-jointed cabinet failed validation intermittently and passed on retry.
 *
 * ⚠ Every writer of `passed` must go through this. A second `problems.length === 0` anywhere
 * re-introduces the bug for that caller only — which is the hardest kind to find, because the
 * two doors disagree only when the machine is busy.
 */
export const gatingProblems = (problems) => (problems ?? []).filter((p) => !p.unverified);

export async function buildVerdict(code, opts = {}) {
  // ⚠ `!== false` WOULD FLATTEN AN InterferenceSpec TO `true`. opts.interference is no
  // longer a boolean — "exhaustive" and an explicit MeasureOpts are both legal, and both are
  // truthy, so the old coercion would have quietly handed runModel the 64-pair defaults a
  // caller was explicitly trying to escape. Absent still means ON, which is the whole point
  // of this door; everything else passes through untouched (t4-overlap-exhaustive).
  const res = await runModel(code, { ...opts, interference: opts.interference === undefined ? true : opts.interference });
  if (!res.ok) return { ...res, problems: [] };
  const problems = defaultProblems(res);
  return { ...res, problems, passed: gatingProblems(problems).length === 0 };
}
