// The GATE LAW — the one function that decides what `passed` means — in a module with NO imports.
//
// ⭐ WHY IT IS ITS OWN FILE (2026-09-24; row t46-verdict-gate's owed item, carried by t31-kitchen).
// gatingProblems lived in checks.mjs, which imports runner.mjs and through it replicad and the OCC
// WASM. The worker's Training campaign summary needed the same law — it was hand-typing the OLD one
// (`!p.unverified`), so a trial whose only findings were warnings still counted as a problem trial —
// and the worker cannot import checks.mjs without bundling the kernel. So the law moved here, pure,
// and checks.mjs RE-EXPORTS it: `gatingProblems` from checks.mjs is this function for every caller
// that already imported it there (the CLI, verify, sweep, the geometry service, test:verify's truth
// table), and the worker imports it from here.

/**
 * ⭐⭐ THE ONE PLACE THAT DECIDES WHAT `passed` MEANS (HK rulings 2026-08-10, local-engine-plan
 * §8c, and 2026-09-23, axle-language-plan §9 S9).
 *
 * A model passes when no finding has severity `error` without being `unverified`:
 *
 *   error       no usable object — it did not build right (an open solid, an empty mesh, two
 *               parts in one volume). It FAILS the model.
 *   warning     the object is usable and flagged (`unsupported_part`). Reported; never fails.
 *   info        advice. Reported; never fails.
 *   unverified  "I could not tell", at ANY severity. Reported; never fails.
 *
 * ⚠ THE WARNING HALF IS THE 2026-09-23 CHANGE (t46-verdict-gate). Until then this filtered on
 * `!unverified` alone, so a warning failed `passed` here — and so `validate_draft` and
 * `axle verify`'s exit code — while Studio (app/lib/validator.ts, `passed = !hasErrors`) and the
 * push verdict agents read (mcp/lib/format.js, NOT OK counts `severity === "error"`) failed a
 * model on errors only. A model whose only finding was `unsupported_part` read OK on push and
 * failed `axle verify`. A rule that must fail a model is raised to `error` in its OWNER module,
 * never special-cased here or at a reader.
 *
 * The unverified half (§8c): the 400ms interference budget running out before it reaches a pair
 * is "I could not tell", not "there is a defect". It is reported, because silence about an
 * unmeasured pair would be worse, and it does not gate, because letting it gate made `passed` a
 * function of machine load: a correctly dado-jointed cabinet failed intermittently and passed on
 * retry.
 *
 * ⚠ IT FAILS CLOSED ON A SEVERITY IT DOES NOT KNOW. Only `warning` and `info` are let through, so
 * a finding with no severity, or one spelled `warn` (the drawing lint's spelling, until its room
 * adopts S9), still gates. Every finding defaultProblems emits carries error or warning
 * (test:parity asserts it), so this changes nothing today; it means a malformed finding fails
 * loudly instead of passing quietly.
 *
 * ⚠ Every writer of `passed` must go through this. A second `problems.length === 0` anywhere
 * re-introduces the old law for that caller only — which is the hardest kind to find, because
 * the two doors disagree only on a model whose findings are all warnings or hedges. The same holds
 * for any COUNT of failing findings: worker/index.js's campaign summary (`problemTrials`,
 * `problemRules`) reads this function for exactly that reason.
 *
 * ⚠⚠ ONE DELIBERATE SECOND STATEMENT OF THIS LAW EXISTS, AND IT MUST CHANGE WITH IT:
 * `checkVerdict` in scripts/lib/engineVerdictOracle.mjs, the oracle the public repo's `npm test`
 * judges the CLI with. It restates the law instead of importing this function so the shipped test
 * cannot grade the engine with its own answer key. It is not a writer of `passed`; it checks one.
 * scripts/headless/test-engine-verify.mjs (g) runs a severity × unverified truth table through
 * both and fails on any cell where they disagree — WHEN `npm run test:verify` RUNS. ⚠ Nothing runs
 * it for you: no guard, CI job, export or publish step calls it. Change the law here and run it.
 *
 * ⚠ THE JSDoc TYPES ON THE FUNCTION ARE LOAD-BEARING, not decoration (added 2026-09-27, row
 * t46-verdict-respell). This file is now in tsconfig.cloudflare.json's file list, because
 * `app/lib/assemblyVerdict.ts` and `app/lib/assemblyContract.ts` import this function rather
 * than restating the law — and a browser-delivered module under `checkJs` + `strict` cannot
 * import an untyped parameter. The LAW is untouched; only its types are written down.
 */
const NON_GATING_SEVERITIES = new Set(["warning", "info"]);

/**
 * @template {{ severity?: string, unverified?: boolean }} T
 * @param {readonly T[] | null | undefined} problems every finding the run reported
 * @returns {T[]} the ones that FAIL the model — empty means `passed`
 */
export const gatingProblems = (problems) =>
  (problems ?? []).filter((p) => !p.unverified && !NON_GATING_SEVERITIES.has(p.severity ?? ""));
