// The REPORT door — the verdict the local engine PRINTS: the checks, plus the static lint the
// hosted push verdict carries (t31-kitchen, local-engine-plan §6l; static lint admitted to the pack
// by §8 decision 7, RULED 2026-09-23).
//
// ⭐ WHY THIS IS NOT buildVerdict. checks.mjs's buildVerdict() is the CHECK door: exactly what the
// geometry service's /validate returns (runModel with interference, defaultProblems, the gate).
// test:parity holds the two equal over HTTP, and the service imports checks.mjs. Static lint is
// NOT in that response — the worker runs it separately and merges it into the build record
// (worker/index.js serverSideBuild), so putting it into defaultProblems or buildVerdict would
// double-report it on the hosted path. This file is the pack's counterpart of that MERGE. `build`,
// `watch`, `repl` and `verify` print it. `sweep` does NOT: a sweep reports the model's lint once for
// the whole run, never per variant (sweep.mjs sourceLint says why).
//
// ⚠⚠ AND IT MUST NOT BE IMPORTED BY checks.mjs, OR BY ANYTHING THE GEOMETRY SERVICE LOADS. It
// imports mcp/lib/staticLint.js, and services/geometry/Dockerfile copies packages/, app/lib/ and
// scripts/headless/ — not mcp/. A static import of this file from the service's closure would
// boot the image into ERR_MODULE_NOT_FOUND and crash-loop every geometry endpoint; guard S14
// walks that closure and says so.
//
// ⭐ THE LINT HALF IS THE WORKER'S, NOT A SECOND ONE. The rules are lintModelCode's and the
// transform a successful build applies to them (drop `main_missing`, downgrade `code_truncated`)
// is lintForVerdict's, both in mcp/lib/staticLint.js — the functions serverSideBuild calls. The
// order is the worker's too: lint first, then the checks.
//
// ⚠ BUT THE WHOLE VERDICT IS NOT THE HOSTED RECORD, AND THE THREE DIFFERENCES ARE NAMED HERE so
// nobody reads "the same composition" into it (review round 1 corrected an earlier header that did):
//   1. The System-pack warnings stay home. The hosted record appends `packWarnings`
//      (app/lib/packValidators.ts, over the packs bound to the model). A model file binds no pack,
//      and pack content is knowledge-layer content that decision 7 keeps on the platform.
//   2. The worker DROPS `unverified`. Its record maps each check finding to { severity, rule,
//      message } only; this door keeps `unverified: true` on the finding, as buildVerdict does.
//   3. The hosted OK / NOT OK line is NOT gatingProblems. mcp/lib/format.js counts
//      `severity === "error"` over the record's warnings; `passed` here is gatingProblems() over
//      the combined list, which also lets an `unverified` finding through and fails closed on a
//      missing or unknown severity. Today they agree on every finding the checks and the lint emit
//      (every `unverified` finding carries `warning`, every finding carries a severity), which is
//      what test:kitchen LEG B measures; a future `unverified` error would read NOT OK hosted and
//      passed here.
// So a lint ERROR that survives a successful build (`global_replicad`, `rotate_no_args`,
// `extrude_no_args`) fails the model here exactly as it makes the push verdict read "Built, but NOT
// OK" — on today's findings, by two statements of the law that agree, not by one function.
//
// ⚠ THE ONE INPUT THE PACK DOES NOT HAVE: a `param_schema`. The worker hands lintModelCode the
// schema the SAME WRITE carried, when it carried one. It never satisfies a rule and never changes a
// severity — it only rewords `no_parameters` for a caller who supplied rows the code does not
// annotate (staticLint.js explains why counting them would be a lie). A model file has no schema,
// so the pack lints as a push that carried none, which is the common push. runner.mjs parseParams
// is NOT a substitute: it reads the code's own annotations, which lint already reads.

import { buildVerdict, gatingProblems } from "./checks.mjs";
import { lintModelCode, lintForVerdict } from "../../mcp/lib/staticLint.js";

/**
 * Build `code`, check it, lint it, and decide `passed` over all of it.
 *
 * opts — everything buildVerdict takes (interference, joints, …).
 *
 * Returns buildVerdict's result with `problems` = [...lint, ...checks] and, on a build that ran,
 * `passed` recomputed through gatingProblems. A build that did not run keeps `ok: false` and no
 * `passed` (as buildVerdict's does); its `problems` are the lint at full strength, because that is
 * what the hosted record keeps on a failed build and the lint often names why it failed.
 */
export async function reportVerdict(code, opts = {}) {
  const res = await buildVerdict(code, opts);
  const lint = lintForVerdict(lintModelCode(code), { built: res.ok === true });
  const problems = [...lint, ...(res.problems ?? [])];
  if (!res.ok) return { ...res, problems };
  return { ...res, problems, passed: gatingProblems(problems).length === 0 };
}
