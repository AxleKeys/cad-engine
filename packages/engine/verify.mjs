// `axle verify` — the engine as the compiler, CI as the verdict (t22-ci).
//
//   axle verify "models/**/*.js" [--param name=value ...] [--json] [--github]
//
// One command over MANY models, one warm kernel, one exit code: the WORST across every model
// it built. That is the whole shape of a CI gate — a repository of model code either compiles
// clean or it does not, and the answer has to be a number a runner can read.
//
// This module owns everything about a verify run EXCEPT the verdict and the model loading:
// which files the patterns name, the per-model row, the aggregation, and (from --github) the
// annotations and the step-summary table. `buildVerdict` gives the verdict; cli.mjs's
// loadModel is passed IN rather than copied here, because --param's grammar and its refusals
// are one implementation or they are two.
//
// ⚠ S27 — THIS FILE CONSTRUCTS NO RULE. It reads `problems` as checks.mjs reported them and
// splits them with checks.mjs's OWN gatingProblems(), so "which findings gate" is decided in
// the one place that decides it for the browser, the service and the sweep. An annotation that
// called an `unverified` hedge an error would be this file inventing a verdict.
//
// ⭐⭐ A PATTERN THAT MATCHES NOTHING IS A REFUSAL, NEVER AN EMPTY PASS. A CI job that is green
// because its glob went stale is worse than no CI at all: it reports "every model is clean"
// about a repository nobody checked. expandTargets() returns what matched nothing, and the CLI
// exits 3 on it, naming the pattern and the directory it looked from.

import { buildVerdict, gatingProblems } from "./checks.mjs";
import { globSync, statSync } from "node:fs";
import path from "node:path";

/** ⭐ THE EXIT CONTRACT — the same four codes `axle build` gives, aggregated. The GitHub
 *  Action is a thin wrapper around these numbers and nothing else, so they are the API. */
export const EXIT = Object.freeze({
  CLEAN: 0,           // every model built and passed
  PROBLEMS: 1,        // at least one model built with a gating problem
  DID_NOT_BUILD: 2,   // at least one model threw
  CANNOT_RUN: 3,      // at least one model could not be read, or named a --param it does not declare
});

/** What each code means, in the words the CLI prints. Keyed by the code so the text output,
 *  the --json summary and the step summary cannot disagree about what a 2 means. */
export const EXIT_MEANING = Object.freeze({
  0: "clean",
  1: "built, problems found",
  2: "did not build",
  3: "cannot run",
});

/** Severity order IS exit-code order, so the worst run is the numeric max. */
export const worstExit = (rows) => rows.reduce((w, r) => Math.max(w, r.exit), EXIT.CLEAN);

const posix = (p) => p.replace(/\\/g, "/");
const GLOBBY = /[*?[\]{}]/;

/**
 * Patterns to the files to verify, in pattern order, de-duplicated, sorted within a pattern.
 *
 * Every argument is treated as a glob (Node's own `fs.globSync`), so one quoted pattern
 * behaves identically on a Windows box and an Ubuntu runner — the shell is not asked to expand
 * anything, which is why the generated Action runs `set -f` before the command. A plain path
 * with no metacharacter is a glob that matches exactly itself.
 *
 * Returns { files, empty } — `empty` lists the patterns that matched nothing, which the caller
 * MUST treat as a refusal (see the header). Directories are never returned: a glob that hits a
 * folder would otherwise be handed to readFileSync as a model.
 */
export function expandTargets(patterns, { cwd = process.cwd() } = {}) {
  const files = [], empty = [], seen = new Set();
  for (const raw of patterns) {
    const pattern = posix(String(raw));
    let hits = [];
    try {
      hits = globSync(pattern, { cwd })
        .map(posix)
        .filter((f) => { try { return statSync(path.resolve(cwd, f)).isFile(); } catch { return false; } })
        .sort();
    } catch { hits = []; }
    // A literal path that does not exist lands here as "matched nothing", which is the answer
    // we want: the pattern named a file the run cannot verify, and silence about it is the
    // failure mode this whole verb exists to remove.
    if (!hits.length) { empty.push({ pattern, glob: GLOBBY.test(pattern) }); continue; }
    for (const h of hits) {
      const key = path.resolve(cwd, h);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(h);
    }
  }
  return { files, empty };
}

/** One model's row — the `sweep`/`repl` record shape (so the doors report one shape), plus
 *  this model's OWN exit code. `cannotRun` marks a failure BEFORE the kernel was asked: an
 *  unreadable file or a --param the model does not declare is exit 3, not exit 2, and that is
 *  the difference between "your model is broken" and "your command is". */
export function verifyRow(file, res, wall, { cannotRun = false } = {}) {
  const volumes = (res.parts ?? []).map((p) => p.volume);
  const volume = res.ok && volumes.length && volumes.every((v) => typeof v === "number" && Number.isFinite(v))
    ? +volumes.reduce((a, b) => a + b, 0).toFixed(2)
    : null;
  const row = {
    file: posix(file),
    ok: res.ok,
    ...(res.ok ? {} : { error: res.error }),
    ...(cannotRun ? { cannotRun: true } : {}),
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
  row.exit = cannotRun ? EXIT.CANNOT_RUN : !res.ok ? EXIT.DID_NOT_BUILD : row.passed ? EXIT.CLEAN : EXIT.PROBLEMS;
  return row;
}

/**
 * Build every model in THIS process, on the kernel the first one paid for — the `repl` and
 * `sweep` discipline. `load(file)` is cli.mjs's loadModel (it applies --param and throws a
 * legible ModelError); anything it throws is that model's answer, never the end of the run.
 *
 * ⚠ THE LOOP MUST SURVIVE A BAD MODEL. A CI run that stopped at the first broken file would
 * report one problem per push and hide the other nine — the reviewer needs every annotation
 * from one run, not a queue of them across ten pushes.
 */
export async function runVerify(files, { load, buildOpts, onModel } = {}) {
  const rows = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const t = Date.now();
    let row;
    try {
      const { code } = load(file);
      let res;
      try { res = await buildVerdict(code, buildOpts); }
      catch (e) {
        // ⚠ AN ENGINE THAT NEVER STARTED IS NOT A MODEL THAT DID NOT BUILD. This catch used
        // to flatten every throw into { ok: false }, which verifyRow maps to DID_NOT_BUILD
        // (exit 2) — so a read-only install reported every model in the glob as broken and
        // the CI annotation blamed the customer's geometry. `cannotRun` is defined three
        // lines up as "a failure BEFORE the kernel was asked", which is exactly this.
        if (e?.name === "EngineStartError") throw e;   // to the outer catch → cannotRun, exit 3
        res = { ok: false, error: e?.message ?? String(e), parts: [], problems: [] };
      }
      row = verifyRow(file, res, Date.now() - t);
    } catch (e) {
      row = verifyRow(file, { ok: false, error: e?.message ?? String(e), parts: [], problems: [] }, Date.now() - t, { cannotRun: true });
    }
    rows.push(row);
    onModel?.(row, i, files.length);
  }
  return rows;
}

/** The counts every output form prints, derived once from the rows. */
export function tally(rows) {
  const by = (code) => rows.filter((r) => r.exit === code).length;
  return {
    files: rows.length,
    clean: by(EXIT.CLEAN),
    withProblems: by(EXIT.PROBLEMS),
    didNotBuild: by(EXIT.DID_NOT_BUILD),
    cannotRun: by(EXIT.CANNOT_RUN),
    problems: rows.reduce((n, r) => n + gatingProblems(r.problems).length, 0),
    unverified: rows.reduce((n, r) => n + (r.problems.length - gatingProblems(r.problems).length), 0),
  };
}

/** The rules a list of problems names, counted — `part_interference ×2, unsupported_part`. */
export function ruleSummary(list) {
  const counts = new Map();
  for (const p of list ?? []) counts.set(p.rule, (counts.get(p.rule) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
}

/** A model's one-line verdict, shared by the text report and the step-summary table. */
export function verdictLine(row) {
  if (row.cannotRun) return `cannot run — ${row.error}`;
  if (!row.ok) return `did not build — ${row.error}`;
  const gating = gatingProblems(row.problems);
  const hedged = row.problems.length - gating.length;
  if (!row.problems.length) return `${row.parts.length} part(s) · no problems`;
  if (!gating.length) return `${row.parts.length} part(s) · no problems · ${hedged} unverified (${ruleSummary(row.problems)})`;
  return `${row.parts.length} part(s) · ${gating.length} problem(s): ${ruleSummary(gating)}${hedged ? ` · ${hedged} unverified` : ""}`;
}

export const dims = (row) => (row.overall ? `${row.overall.x.toFixed(1)} × ${row.overall.y.toFixed(1)} × ${row.overall.z.toFixed(1)} mm` : "—");

/** The mark in front of a row: clean, built-with-problems, or could not be built/run. */
export const mark = (row) => (row.exit === EXIT.CLEAN ? "✓" : row.exit === EXIT.PROBLEMS ? "✗" : "⛔");

// ── --github: the run, said in the runner's own language ──────────────────────
//
// GitHub Actions reads workflow commands from a step's STDOUT and turns them into annotations
// pinned to a file in the diff — which is the whole point of running the engine in CI: the
// reviewer sees "this shelf and this side share 32,400mm³" on the line of the pull request
// that caused it, not buried in a log nobody opens.
//
// ⚠ ESCAPING IS NOT OPTIONAL AND IT IS ASYMMETRIC. In the message, `%`, CR and LF must be
// percent-encoded or a multi-line problem silently truncates to its first line; inside a
// property, `:` and `,` must be encoded too or a message containing either ENDS THE PROPERTY
// LIST and the annotation lands on the wrong file — or on none. Both are exactly the quiet
// half-output this repo keeps paying for, so both are tested.
export const escData = (s) => String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
export const escProp = (s) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

const command = (kind, props, message) =>
  `::${kind} ${Object.entries(props).map(([k, v]) => `${k}=${escProp(v)}`).join(",")}::${escData(message)}`;

/**
 * The workflow commands for one model.
 *
 * ⭐ THE SEVERITY MAPPING IS THE VERDICT'S, NOT A NEW OPINION. A gating problem is `::error`;
 * an `unverified` finding — the build saying "I could not tell", which does NOT fail the model
 * (§8c: a hedge reports, it does not gate) — is `::warning`. Calling a hedge an error would
 * make CI look red about a thing the exit code deliberately let pass, and reviewers learn to
 * ignore an annotation that lies about severity faster than they learn anything else.
 *
 * A clean model gets one `::notice`, so a green run is VISIBLE. That matters more than it
 * looks: an all-clean job with no output is indistinguishable from a job whose glob matched
 * nothing (which is why that case is a refusal upstream) — this is the second telling.
 */
export function annotations(row) {
  if (row.cannotRun) return [command("error", { file: row.file, title: "cannot run" }, row.error)];
  if (!row.ok) return [command("error", { file: row.file, title: "did not build" }, row.error)];
  if (!row.problems.length) {
    return [command("notice", { file: row.file, title: "clean" }, `${row.parts.length} part(s) · ${dims(row)} · no problems`)];
  }
  const out = row.problems.map((p) =>
    command(p.unverified ? "warning" : "error", { file: row.file, title: p.rule }, p.unverified ? `${p.message} (unverified — this does not fail the model)` : p.message));
  // A model whose only findings are hedges still PASSED, and the notice is what says so.
  if (!gatingProblems(row.problems).length) {
    out.push(command("notice", { file: row.file, title: "clean" }, `${row.parts.length} part(s) · ${dims(row)} · no gating problems`));
  }
  return out;
}

/** The Markdown appended to GITHUB_STEP_SUMMARY — one table, model · parts · overall ·
 *  verdict, and the run's exit code spelled out underneath. Appended, never written over:
 *  a step summary belongs to the whole job, and clobbering another step's is a data loss
 *  nobody notices until the one time they needed both. */
export function summaryMarkdown(rows, { wallMs, version } = {}) {
  const counts = tally(rows);
  const worst = worstExit(rows);
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const lines = [
    `### axle verify — ${counts.files} model(s), exit ${worst} (${EXIT_MEANING[worst]})`,
    "",
    "| Model | Parts | Overall (mm) | Verdict |",
    "|---|---:|---|---|",
    ...rows.map((r) => `| \`${cell(r.file)}\` | ${r.ok ? r.parts.length : "—"} | ${cell(dims(r))} | ${mark(r)} ${cell(verdictLine(r))} |`),
    "",
    `${counts.clean} clean · ${counts.withProblems} with problems · ${counts.didNotBuild} did not build · ${counts.cannotRun} could not run` +
      (counts.unverified ? ` · ${counts.unverified} unverified finding(s), which do not gate` : "") +
      (wallMs == null ? "" : ` · ${wallMs}ms on one warm kernel`),
    "",
    `Built by the [Axle Keys](https://axlekeys.com) engine${version ? ` \`${version}\`` : ""} — the same verdict axlekeys.com gives.`,
    "",
  ];
  return lines.join("\n");
}
