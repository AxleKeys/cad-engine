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
import { sweptProblems } from "../../app/lib/sweptCollision.js";
import { gatingProblems } from "./gate.mjs";

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
 * Severity is also what GATES since S9 (2026-09-23): an `error` fails the model, a `warning`
 * flags it and does not. That law is decided by gatingProblems() (./gate.mjs), in one place.
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

  // ⭐ THE FIRST CHECK IN THIS FILE THAT ASKS ABOUT A POSE THE BUILD NEVER PRODUCED
  // (t7-sweptcheck). Everything above reads the model AS BUILT — joints at rest, always — which
  // is how the Base Cabinet's door swung through its own side panel for twelve authored reels
  // with every instrument green (Notebook bdb97023). The rules are CONSTRUCTED in
  // app/lib/sweptCollision.ts and nowhere else (guard S27); this is the projection, and
  // app/lib/validator.ts projects the identical findings for the browser.
  //
  // ⚠ `res.swept` ABSENT IS SILENCE, not "nobody looked", and that is the ONE place this file's
  // absence rule differs from the soundness one above. The question exists only for a model that
  // declares joints; a model with none can never clear a line saying its joints were not swept.
  // The hole is closed at the door instead — buildVerdict() runs the pass whenever `joints` are
  // supplied — and a sweep that ran but fell short still says so, as `joint_sweep_coverage`.
  for (const f of sweptProblems(res.swept)) {
    problems.push({ rule: f.rule, severity: f.severity, message: f.message, ...(f.unverified ? { unverified: true } : {}) });
  }

  return problems;
}

// ⭐⭐ THE GATE LAW — what `passed` means — LIVES IN ./gate.mjs (moved 2026-09-24, row
// t46-verdict-gate's owed item, carried by t31-kitchen). It is re-exported here unchanged, so
// `gatingProblems` imported from checks.mjs is the same function for every caller that already did
// (the CLI, verify, sweep, report.mjs, the geometry service, test:verify's truth table). It moved
// because the worker's Training summary needs the ONE law and cannot import this file: this file
// imports runner.mjs, which is the kernel. Read gate.mjs for the law and its history.
export { gatingProblems };

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
 * ⭐ AND THE PACK'S COMMANDS CALL IT THROUGH report.mjs (t31-kitchen, 2026-09-24). This is the
 * CHECK door: exactly what the geometry service's /validate returns, which test:parity holds
 * equal over HTTP. The verdict an agent reads on a push is that PLUS the static lint the worker
 * merges in, so `axle build`/`verify`/`sweep`/`watch`/`repl` print reportVerdict(), which is this
 * call plus that lint, composed the worker's way. Static lint is not added here: the service
 * imports this file, its image has no mcp/, and the hosted path would report the lint twice.
 *
 * ⚠ THE SOUNDNESS PASS RIDES THE SAME SWITCH (t31-solidverdict, runner.mjs). `interference`
 * absent ⇒ both run; `{ interference: false }` turns BOTH off unless `soundness` is passed
 * explicitly, and defaultProblems then says out loud that nobody looked at the solids.
 *
 * ⚠⚠ THE SWEPT PASS DOES NOT RIDE IT, AND CANNOT (t7-sweptcheck). Interference and soundness are
 * derivable from the code alone, so tying them to "is this being reported?" is enough. A swept
 * check needs the model's JOINTS, which are model data (`app/lib/items.ts` ModelJoint) and are
 * not in the code — so there is nothing for a default to switch on. Pass `opts.joints` and the
 * sweep runs by construction; omit them and it stays silent rather than guessing a rig.
 */
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
