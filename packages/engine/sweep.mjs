// The sweep — the agent stops drawing one design and searches a space (t22-sweep).
//
//   axle sweep model.js --range slatPitch=70:170:10 --require passed --score max:slatPitch
//
// This module owns everything about a sweep EXCEPT the verdict: which variants exist and in
// what order, which of them are admitted to the ranking, and how they are ranked. The verdict
// itself comes from checks.mjs — one warm kernel, one `buildVerdict` per variant — and this
// file reads it, never re-derives it.
//
// ⭐⭐ THE SCORING VOCABULARY IS CLOSED, AND EVERY TERM IS A MEASURED FIELD OF THE VERDICT.
// No model opinion, no LLM, no heuristic invented here — the Rig's no-LLM-judge law
// (context/archive/code-mode-rig-plan.md). A term is one of VERDICT_TERMS below, or the name
// of a swept parameter (an INPUT the sweep itself chose, so it is exact by construction).
// Asking for anything else is refused with the list, because a scoring term that is not
// measured is an opinion wearing a number [[feedback_proxy_metric_manufactures_a_finding]].
//
// ⚠ S27 — THIS FILE CONSTRUCTS NO RULE. `problems` is read as the owner modules report it
// (checks.mjs → app/lib/interference.ts, support.ts, soundness.ts); `passed` is read as
// gatingProblems() decided it. A sweep that filtered on its own idea of "passed" would be a
// second check surface, and two surfaces is the failure t22-localpack L2 undid.
//
// ⚠ ONE WARM KERNEL. runSweep() builds every variant in THIS process through buildVerdict,
// so OCC initialises once and each later variant costs ~55ms (local-engine-plan §6d). A
// sweep that spawned Node per variant would cost ~1s each and be SLOWER than the cloud loop
// the pack exists to beat; scripts/headless/test-engine-sweep.mjs asserts the ratio.
//
// ⭐ DETERMINISTIC ORDERING. Variants are enumerated in cartesian order — the first range is
// the slowest-varying — so their index IS "parameter order, then value". Ranking is a stable
// sort on the score with that index as the tiebreak, so the same sweep twice gives the same
// order, and the `--json` lines are byte-identical minus the `*Ms` fields.

import { buildVerdict } from "./checks.mjs";
import { setParam } from "./runner.mjs";

/** The closed vocabulary — every entry names a field the verdict MEASURED. */
export const VERDICT_TERMS = Object.freeze({
  "volume":    "sum of part volumes, mm³ (minimise material)",
  "overall.x": "overall bounding box along X, mm",
  "overall.y": "overall bounding box along Y, mm",
  "overall.z": "overall bounding box along Z, mm",
  "parts":     "number of parts the model returned",
  "problems":  "number of problems the checks reported",
  "buildMs":   "kernel time for the build, ms",
});

export const DEFAULT_STEPS = 7;
export const DEFAULT_MAX_VARIANTS = 500;
export const DEFAULT_TOP = 10;

export class SweepError extends Error {}

/** Fold binary noise out of a computed range value so `70 + 3 × 0.1` prints as 70.3. */
const snap = (n) => +n.toFixed(6);

// ── Ranges ────────────────────────────────────────────────────────────────────

/** `name=min:max:step` → { name, min, max, step }. Refuses anything else, legibly. */
export function parseRange(spec) {
  const m = String(spec ?? "").match(/^([A-Za-z_$][\w$]*)=(-?[\d.]+):(-?[\d.]+):(-?[\d.]+)$/);
  if (!m) throw new SweepError(`--range wants name=min:max:step (e.g. --range slatPitch=70:120:10), got "${spec}"`);
  const [, name, a, b, c] = m;
  const min = Number(a), max = Number(b), step = Number(c);
  if (![min, max, step].every(Number.isFinite)) throw new SweepError(`--range ${name}: min, max and step must be numbers, got "${spec}"`);
  if (step <= 0) throw new SweepError(`--range ${name}: step must be positive, got ${step}`);
  if (max < min) throw new SweepError(`--range ${name}: max (${max}) is below min (${min})`);
  return { name, min, max, step };
}

/** The values a range enumerates: min, min+step, … while ≤ max (a hair of tolerance so
 *  `0:1:0.1` lands on 1). Never empty — min is always the first value. */
export function expandRange({ min, max, step }) {
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => snap(min + i * step));
}

/** With no --range, sweep every declared parameter over its own [min:max]: a toggle is
 *  both states, an enum is every choice, a number is `steps` evenly spaced values. The
 *  range the model declared is read, never invented — an unannotated const has no range
 *  and is not here (runner.mjs parsePlainConsts keeps it out of `declared`). */
export function defaultRanges(declared, steps = DEFAULT_STEPS) {
  if (!Number.isInteger(steps) || steps < 1) throw new SweepError(`--steps wants a whole number of at least 1, got ${steps}`);
  return declared.map((p) => {
    if (p.kind === "toggle") return { name: p.name, min: 0, max: 1, step: 1, values: [0, 1], source: "toggle" };
    if (p.kind === "enum") {
      const n = Math.max(1, p.choices?.length ?? 1);
      return { name: p.name, min: 0, max: n - 1, step: 1, values: Array.from({ length: n }, (_, i) => i), source: "enum" };
    }
    if (steps === 1 || p.max === p.min) return { name: p.name, min: p.min, max: p.max, step: 0, values: [p.min], source: "declared" };
    const step = (p.max - p.min) / (steps - 1);
    return {
      name: p.name, min: p.min, max: p.max, step: snap(step),
      values: Array.from({ length: steps }, (_, i) => snap(p.min + i * step)),
      source: "declared",
    };
  });
}

/** Product of the value counts — computed BEFORE anything builds, so the ceiling can refuse. */
export const variantCount = (ranges) => ranges.reduce((n, r) => n * r.values.length, 1);

/** Cartesian expansion, first range slowest. Index order is the sweep's tiebreak order. */
export function cartesian(ranges) {
  let rows = [{}];
  for (const r of ranges) {
    const next = [];
    for (const row of rows) for (const v of r.values) next.push({ ...row, [r.name]: v });
    rows = next;
  }
  return rows;
}

/**
 * Assemble the plan from the CLI's words and the model's declared parameters.
 *   opts.ranges: parsed --range specs (may be empty → every declared parameter)
 *   opts.steps · opts.maxVariants
 * Returns { ranges, variants, count, notes } or throws SweepError. Nothing here builds.
 */
export function planSweep(declared, opts = {}) {
  const steps = opts.steps ?? DEFAULT_STEPS;
  const maxVariants = opts.maxVariants ?? DEFAULT_MAX_VARIANTS;
  const notes = [];
  let ranges;
  if (opts.ranges?.length) {
    const seen = new Set();
    ranges = opts.ranges.map((r) => {
      const d = declared.find((p) => p.name === r.name);
      if (!d) {
        // Refuse, do not no-op: setParam's regex would not match and every variant would
        // build the ORIGINAL value while the table claimed it had moved.
        throw new SweepError(
          `this model has no parameter "${r.name}". ` +
          (declared.length
            ? `It declares: ${declared.map((p) => `${p.name}=${p.value} [${p.min}:${p.max}]`).join(", ")}`
            : `It declares no annotated parameters (a parameter is \`const NAME = 10; // [min:max]\`).`),
        );
      }
      if (seen.has(r.name)) throw new SweepError(`--range ${r.name} was given twice`);
      seen.add(r.name);
      if (r.min < d.min || r.max > d.max) {
        notes.push(`${r.name} ${r.min}:${r.max} reaches outside the declared [${d.min}:${d.max}] — allowed; the range is what the model declares, not a limit the CLI enforces.`);
      }
      return { ...r, values: expandRange(r), source: "range" };
    });
  } else {
    if (!declared.length) throw new SweepError(`this model declares no parameters, so there is nothing to sweep. A parameter is \`const width = 800; // [400:1600]\`.`);
    ranges = defaultRanges(declared, steps);
  }
  const count = variantCount(ranges);
  if (count > maxVariants) {
    throw new SweepError(
      `${count} variants (${ranges.map((r) => `${r.name}×${r.values.length}`).join(" · ")}) is over the ceiling of ${maxVariants}. ` +
      `Narrow a --range, lower --steps, or raise --max-variants ${count} if you mean it — at ~55ms a variant that is about ${Math.ceil(count * 0.055)}s of building.`,
    );
  }
  return { ranges, variants: cartesian(ranges), count, notes };
}

// ── Terms: scoring and constraints ────────────────────────────────────────────

/** Every term this sweep may name: the closed verdict vocabulary plus the swept parameters. */
export const termsFor = (ranges) => [...Object.keys(VERDICT_TERMS), ...ranges.map((r) => r.name)];

function assertTerm(term, ranges, flag) {
  const terms = termsFor(ranges);
  if (!terms.includes(term)) {
    throw new SweepError(
      `${flag} does not know "${term}". The vocabulary is closed — every term is a measured field of the verdict or a swept parameter: ` +
      `${Object.keys(VERDICT_TERMS).join(", ")}${ranges.length ? `, and the swept parameter(s) ${ranges.map((r) => r.name).join(", ")}` : ""}.`,
    );
  }
  return term;
}

/** `min:<term>` | `max:<term>` → { dir, term }. */
export function parseScore(spec, ranges = []) {
  const m = String(spec ?? "").match(/^(min|max):(.+)$/);
  if (!m) throw new SweepError(`--score wants min:<term> or max:<term> (e.g. --score min:volume), got "${spec}"`);
  return { dir: m[1], term: assertTerm(m[2], ranges, "--score") };
}

const OPS = {
  "<=": (a, b) => a <= b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "<":  (a, b) => a < b,
  ">":  (a, b) => a > b,
};

/** `overall.x<=800` → { term, op, value }. Two-character operators are matched first. */
export function parseWhere(spec, ranges = []) {
  const m = String(spec ?? "").match(/^([\w.$]+)\s*(<=|>=|==|<|>)\s*(-?[\d.]+)$/);
  if (!m) throw new SweepError(`--where wants <term><op><number> with op one of <= >= < > == (e.g. --where overall.x<=800), got "${spec}"`);
  const value = Number(m[3]);
  if (!Number.isFinite(value)) throw new SweepError(`--where ${m[1]}: "${m[3]}" is not a number`);
  return { term: assertTerm(m[1], ranges, "--where"), op: m[2], value };
}

/** Read one term off a sweep row. `null` when the verdict could not measure it — a build
 *  that failed has no overall, no volume; a compound whose volume OCC refused has none. */
export function termValue(row, term) {
  if (term in row.params) return row.params[term];
  switch (term) {
    case "volume": return row.volume ?? null;
    case "overall.x": return row.overall?.x ?? null;
    case "overall.y": return row.overall?.y ?? null;
    case "overall.z": return row.overall?.z ?? null;
    case "parts": return row.ok ? row.parts.length : null;
    case "problems": return row.ok ? row.problems.length : null;
    case "buildMs": return row.buildMs ?? null;
    default: return null;
  }
}

/** A constraint over a null is NOT satisfied — "could not measure" never passes a filter. */
export const satisfies = (row, where) => {
  const v = termValue(row, where.term);
  return v != null && OPS[where.op](v, where.value);
};

// ── The sweep row (the repl record shape + params + score) ────────────────────

/** The per-variant record: the `repl` NDJSON shape (cli.mjs `record`) plus `params`, the
 *  measured `volume`, and later `score` and `rank`. Kept small on purpose — an agent reading
 *  hundreds of these wants dimensions and problems, not meshes. */
export function sweepRow(file, params, res, wall) {
  const volumes = (res.parts ?? []).map((p) => p.volume);
  const volume = res.ok && volumes.length && volumes.every((v) => typeof v === "number" && Number.isFinite(v))
    ? +volumes.reduce((a, b) => a + b, 0).toFixed(2)
    : null;
  return {
    file,
    params,
    ok: res.ok,
    ...(res.ok ? {} : { error: res.error }),
    passed: res.ok ? res.passed : false,
    buildMs: res.elapsedMs ?? null,
    wallMs: wall,
    overall: res.overall ? { x: +res.overall.sizeX.toFixed(2), y: +res.overall.sizeY.toFixed(2), z: +res.overall.sizeZ.toFixed(2) } : null,
    volume,
    parts: (res.parts ?? []).map((p) => ({
      name: p.name,
      ...(p.bbox ? { x: +p.bbox.sizeX.toFixed(2), y: +p.bbox.sizeY.toFixed(2), z: +p.bbox.sizeZ.toFixed(2) } : {}),
      ...(typeof p.volume === "number" ? { volume: +p.volume.toFixed(2) } : {}),
    })),
    problems: res.problems ?? [],
  };
}

// ── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Admit, score and rank. Mutates each row: `score` (the term's value, or null), `rank`
 * (1-based among the admitted, null otherwise) and `excluded` (why, when it is).
 *   opts.requirePassed — drop rows whose verdict `passed` is false BEFORE ranking
 *   opts.where — every constraint must hold
 *   opts.score — { dir, term } or null (then the cartesian order stands)
 * Returns { ranked, excluded, rankedNotPassed } — the last is the count of ranked rows whose
 * verdict did not pass, which the output MUST say out loud when it is non-zero.
 */
export function rankVariants(rows, opts = {}) {
  const where = opts.where ?? [];
  const ranked = [], excluded = [];
  rows.forEach((row, index) => {
    row.index = index;
    row.score = opts.score ? termValue(row, opts.score.term) : null;
    row.rank = null;
    if (opts.requirePassed && !row.passed) { row.excluded = row.ok ? "not_passed" : "did_not_build"; excluded.push(row); return; }
    const miss = where.find((w) => !satisfies(row, w));
    if (miss) { row.excluded = `where:${miss.term}${miss.op}${miss.value}`; excluded.push(row); return; }
    delete row.excluded;
    ranked.push(row);
  });
  if (opts.score) {
    const sign = opts.score.dir === "max" ? -1 : 1;
    ranked.sort((a, b) => {
      // Nulls (could not measure) sink to the bottom whatever the direction.
      if (a.score == null && b.score == null) return a.index - b.index;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return a.score !== b.score ? sign * (a.score - b.score) : a.index - b.index;
    });
  }
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return { ranked, excluded, rankedNotPassed: ranked.filter((r) => !r.passed).length };
}

// ── The loop — one process, one kernel ────────────────────────────────────────

/**
 * Build every variant in cartesian order, in THIS process. `code` already carries any fixed
 * `--param` overrides; each variant rewrites only its swept parameters on top.
 *   onVariant(row, i, count) — progress, optional.
 * A variant that throws is an ANSWER (a row with ok:false), never the end of the sweep — an
 * agent searching a space must not lose the warm kernel to the one corner that fails.
 */
export async function runSweep(file, code, plan, { onVariant, buildOpts } = {}) {
  const rows = [];
  for (let i = 0; i < plan.variants.length; i++) {
    const params = plan.variants[i];
    let src = code;
    for (const [name, value] of Object.entries(params)) src = setParam(src, name, value);
    const t = Date.now();
    let res;
    try { res = await buildVerdict(src, buildOpts); }
    catch (e) { res = { ok: false, error: e?.message ?? String(e), parts: [], problems: [] }; }
    const row = sweepRow(file, params, res, Date.now() - t);
    rows.push(row);
    onVariant?.(row, i, plan.variants.length);
  }
  return rows;
}

/** The `--param` line that reproduces a row, fixed overrides first, then the swept values. */
export const paramLine = (row, fixed = []) =>
  [...fixed.filter((f) => !(f.split("=")[0] in row.params)), ...Object.entries(row.params).map(([k, v]) => `${k}=${v}`)]
    .map((p) => `--param ${p}`).join(" ");
