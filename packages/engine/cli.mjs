#!/usr/bin/env node
// The Axle Keys local engine CLI — build a model and get the verdict, offline, in about a
// second (t22-localpack L3).
//
//   axle build   model.js [--json] [--param name=value ...]
//   axle explain model.js [--json] [--param name=value ...]   — its parameters and their ranges
//   axle sweep   model.js [--range name=min:max:step ...] [--score min|max:<term>] [--require passed]
//                         [--where <term><op><n> ...] [--top N] [--json]   — search the space
//   axle verify  <file|glob> [<file|glob> ...] [--param name=value ...] [--json] [--github]
//                         — build many models, exit with the worst code (CI's gate)
//   axle export  model.js --step|--stl [-o out.step] [--param name=value ...]
//   axle check-dimensions model.js --width W [--depth D] [--height H] [--tolerance-mm T] [--json]
//                         — the overall size against numbers you typed (t31-kitchen)
//   axle measure model.js --part-a A [--part-b B] [--json]
//                         — one part's box and solidity, or two parts' gap / flush / overlap
//   axle version
//
// ⚠⚠ THIS FILE MUST NOT STATICALLY IMPORT THE ENGINE, AND THAT IS THE WHOLE REASON THE
// VERSION CHECK BELOW WORKS.
//
// The engine imports TypeScript directly (app/lib/obb.ts and friends) and relies on Node's
// native type-stripping. On an older Node that import fails while the MODULE GRAPH IS BEING
// RESOLVED — before a single line of this file runs. A static
// `import { buildVerdict } from "./checks.mjs"` at the top would therefore make the check
// below unreachable, and the user's first experience of the pack would be a raw
// ERR_UNKNOWN_FILE_EXTENSION thrown from inside a module loader, which reads as "this project
// is broken", not "upgrade Node". Decision §8-2 (ship source, no compile step) makes an old
// Node the single most likely first-run failure, so the refusal has to be the thing that
// actually happens. Hence: check first, `await import()` second.
// [[feedback_legible_refusal]] · [[feedback_refusal_must_be_legible]]

// ── The floor, checked before anything can throw ─────────────────────────────
// 23 is the real technical floor: unflagged TypeScript type-stripping. It is also what
// services/geometry/package.json declares, and that service runs this exact engine in
// production — so the CLI and the deployed copy agree about what they need. We build and
// test on 24.
const MIN_MAJOR = 23;
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_MAJOR) {
  console.error(
    `\naxle: this needs Node ${MIN_MAJOR} or newer — you are on Node ${process.versions.node}.\n\n` +
    `  The engine is shipped as source and imports TypeScript directly, which Node runs\n` +
    `  natively from ${MIN_MAJOR} onward. There is no build step to run; the fix is the Node version.\n\n` +
    `    nvm install 24 && nvm use 24      (or https://nodejs.org — 24 LTS)\n\n` +
    `  Then re-run this command. Nothing else needs to change.\n`,
  );
  process.exit(3);
}

// ── The engine failing to START is not the model failing to BUILD ────────────
// The Node-version refusal above is the legible answer for ONE cause of "cannot run". This
// is the same answer for every other cause that stops the kernel before it is asked — today
// that is an unwritable cache directory (runner.mjs), which a global install under a
// root-owned prefix hits on its first command.
//
// Without this the failure arrives as a raw stack from inside a module loader and inherits
// Node's default exit code of 1 — which verify.EXIT_MEANING defines as "built, errors
// found". The CLI would be telling a customer their geometry is wrong about an engine that
// never ran. Both hooks are registered because a throw out of this file's top-level `await`
// surfaces as a rejection, not an exception, depending on where it originates.
// [[feedback_refusal_must_be_legible]]
const cannotRun = (e) => {
  if (e?.name !== "EngineStartError") {
    // Not ours. Restore Node's default shape, so a real bug still shows its stack trace.
    console.error(e?.stack ?? String(e));
    process.exit(1);
  }
  console.error(`\naxle: ${e.message}`);
  process.exit(3);
};
process.on("uncaughtException", cannotRun);
process.on("unhandledRejection", cannotRun);

const { readFileSync, writeFileSync, watch } = await import("node:fs");
const { basename, extname, resolve, dirname } = await import("node:path");

// The sweep's vocabulary and defaults are typed here rather than imported so `help` and the
// bare `axle sweep` usage can print them BEFORE the engine is imported — the same rule as
// the version check above. sweep.mjs exports the same names; test-engine-sweep asserts the
// two agree, so they cannot drift apart silently.
const VERDICT_TERMS = ["volume", "overall.x", "overall.y", "overall.z", "parts", "problems", "buildMs"];
const DEFAULT_STEPS = 7, DEFAULT_MAX_VARIANTS = 500, DEFAULT_TOP = 10;

// ── Argument parsing ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const cmd = argv[0];

function usage(exitCode = 0) {
  console.log(`
axle — the Axle Keys geometry engine, run locally.

  axle build   <model.js> [options]    build it and print the verdict
  axle explain <model.js> [--json]     what --param accepts: each parameter, its value, its range
  axle sweep   <model.js> [options]    build a whole space of variants and rank them by a measured field
  axle verify  <file|glob> [more...]   build MANY models; exit with the worst code (the CI gate)
  axle watch   <model.js> [options]    rebuild on every save, ~55ms each
  axle repl                            paths on stdin, one JSON verdict per line
  axle export  <model.js> --step|--stl build it and write a CAD file
  axle check-dimensions <model.js> --width W [--depth D] [--height H] [--tolerance-mm T]
                                       is the overall size the size you asked for? (mm)
  axle measure <model.js> --part-a A [--part-b B]
                                       one part: its box and its solid volume against its
                                       blank. Two: per-axis gap / flush / overlap, the nearest
                                       distance, and the MEASURED shared volume
  axle version

Options
  --param name=value    override a parameter before building (repeatable)
  --json                machine-readable output (build and explain)
  -o, --out <file>      output path (export only; defaults beside the input)

Sweep options
  --range name=min:max:step   sweep this parameter (repeatable; cartesian). With no --range,
                              every parameter \`explain\` lists is swept over its declared range
  --steps N                   values per declared range when no --range is given (default ${DEFAULT_STEPS})
  --max-variants N            refuse a sweep larger than this (default ${DEFAULT_MAX_VARIANTS})
  --score min:<term>|max:<term>   rank by a MEASURED field: ${VERDICT_TERMS.join(" · ")},
                              or a swept parameter's name. No --score keeps parameter order
  --require passed            drop variants whose verdict did not pass (an error) BEFORE ranking
  --where <term><op><number>  keep only variants satisfying it; ops <= >= < > == (repeatable)
  --top N                     rows in the text table (default ${DEFAULT_TOP})

Check-dimensions options — the check_dimensions tool's comparison, with its vocabulary
  --width W  --depth D  --height H   target overall size in mm: width = X, depth = Y,
                              height = Z. At least one; each a positive number
  --tolerance-mm T            the band on EVERY axis, in mm, replacing the default outright.
                              Default: ±5% or 3mm per axis, whichever is larger (deliberately
                              loose). A negative or non-numeric T is refused, never replaced
                              by the default. Every answer names the band it applied
  The targets are numbers you type: nothing here reads a stored brief.

Measure options — the measure tool's part_a / part_b
  --part-a A     the part to measure (exact name first, then case-insensitive)
  --part-b B     a second part: the pair's per-axis relation, nearest gap, centre offset and
                 shared_volume — the real intersection the build measured, not a box guess
  Boxes are world-axis bounding boxes (width = X, depth = Y, height = Z), conservative for
  rotated or notched parts; shared_volume is the number to trust.

Verify options
  --github              speak GitHub Actions: an ::error per error, a ::warning per warning or
                        unverified finding, a ::notice per info finding and per model that
                        passed, and the run's table appended to $GITHUB_STEP_SUMMARY when the
                        runner set it
  --json                one record per model, then a final { summary }: models by exit code
                        (clean = 0, withProblems = 1, didNotBuild, cannotRun) and findings by
                        kind (errors · warnings · info · unverified). summary.problems is the
                        same number as errors, kept under its old name for existing readers

What fails a model
  Every finding carries a severity. An error fails the model. A warning flags it and info
  advises; neither fails it. A finding marked unverified — the build could not tell — is
  reported and never fails it. All of them are printed; only an error changes the exit code.
  The findings are the geometry checks plus the static lint axlekeys.com's push verdict
  carries — rules about the code's shape, read without running it: main_missing,
  global_replicad, code_truncated, rotate_no_args, extrude_no_args (errors) and
  params_argument, no_parameters, too_many_parameters, bad_param_range, generic_body_name,
  magic_numbers (warnings). On a model that built, main_missing is dropped and
  code_truncated is a warning, exactly as the push verdict treats them.
  \`sweep\` reports the lint ONCE for the whole sweep (its header, and summary.lint in --json),
  over the model as you handed it in. It is in no variant's problems or passed, so it cannot
  rank, filter or exclude a variant — and a variant can read passed while \`axle build\` fails
  the file for a lint error, which the header then says.

What build prints
  Each part's box, and — from the same functions the push verdict uses — its measured solid
  volume against the rectangular blank it would be cut from, and how many separate solids it
  is when that is more than one. A measured fact, never a gate: it does not change the exit.

Exit codes
  0  built and passed        2  did not build
  1  built, errors found     3  cannot run (see the message)
  explain: 0 parameters listed · 1 the model declares none · 3 cannot run
  sweep:   0 at least one variant ranked · 1 nothing survived the filters · 3 cannot run
  check-dimensions: 0 within the band · 1 off on an axis, or no measurable box
                    2 did not build · 3 cannot run (no target, a refused tolerance, a bad flag)
  measure: 0 measured · 1 the model built no measurable part · 2 did not build
           3 cannot run (no --part-a, or a part name the model does not have — it lists them)
  verify:  the WORST of the above across every model matched — and 3 if a pattern
           matched no files at all, because a run that verified nothing is not a pass

\`sweep\` scores ONLY what the verdict measured. There is no opinion in the ranking: a term is
volume (mm³, sum of parts), an overall dimension, the part count, the problem count (EVERY
finding the geometry checks reported on that variant — errors, warnings, info and unverified;
the model's static lint is reported once for the sweep, not per variant), the build time, or a
swept parameter.
\`--require passed\` reads the same \`passed\` the verdict carries, so it drops a variant with an
error and keeps one that is only warned about; to drop every variant with any finding, add
\`--where problems==0\`. ⚠ That counts unverified findings too, and on a big model those depend
on how busy the machine was, so read what it excluded. Every variant builds in this one
process on one warm kernel (~55ms each after the first), so 100 variants take seconds, not
minutes; \`--json\` prints one record per variant in ranked order, then a final { summary } line.

\`verify\` is the same verdict over a whole repository, on one warm kernel: every matched model
builds, each prints one line, and the process exits with the WORST code any of them produced.
Quote your globs (\`axle verify "models/**/*.js"\`) — the CLI expands them itself, so the same
command means the same thing on every machine. A pattern that matches NOTHING is exit 3, never
a quiet pass: a green run that verified no models is the failure this verb exists to remove.

\`explain\` does not build. A parameter is an annotated const — \`const topSize = 450; // [300:800]\`
— and that annotation is what --param, the sweep and Studio's sliders all read. A numeric
const with no annotation is listed too, marked not adjustable, so the reason --param refuses
a name is on the page rather than in the file.

⏱  A one-shot \`axle build\` spends ~900ms starting Node and the OCC kernel and only
   ~100ms building. \`watch\` and \`repl\` pay that once and then rebuild in ~55ms —
   that, not the one-shot, is the fast loop. Use \`repl\` to drive many builds from
   an agent; use \`watch\` while editing by hand.

The verdict here is the same verdict axlekeys.com gives: the checks and the engine
are one implementation, and \`npm run test:parity\` is what keeps that true.
`);
  process.exit(exitCode);
}

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") usage(0);
if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  console.log(`axle engine ${pkg.version} (node ${process.versions.node})`);
  process.exit(0);
}
const COMMANDS = new Set(["build", "explain", "sweep", "verify", "watch", "repl", "export", "check-dimensions", "measure"]);
if (!COMMANDS.has(cmd)) {
  console.error(`axle: unknown command "${cmd}". Try \`axle help\`.`);
  process.exit(3);
}

// `repl` takes its work from stdin, so it is the one command with no file argument.
const file = cmd === "repl" ? null : argv[1];
if (cmd !== "repl" && (!file || file.startsWith("-"))) {
  if (cmd === "sweep") {
    // Bare `axle sweep` is a question, not a mistake: answer it with the verb's own usage.
    console.error(`
axle sweep <model.js> [--range name=min:max:step ...] [--score min:<term>|max:<term>]
                      [--require passed] [--where <term><op><number> ...] [--top N] [--json]

  Build every variant of a parameter space on one warm kernel and rank them by a MEASURED
  field of the verdict: ${VERDICT_TERMS.join(" · ")}, or a swept parameter.
  With no --range, every parameter \`axle explain\` lists is swept over its declared range in
  --steps values (default ${DEFAULT_STEPS}); a sweep over --max-variants (default ${DEFAULT_MAX_VARIANTS}) is refused.

  e.g.  axle sweep bench.js --range slatPitch=70:170:10 --require passed --score max:slatPitch

  \`axle help\` has the full option list.
`);
    process.exit(3);
  }
  if (cmd === "verify") {
    console.error(`axle: verify needs at least one file or glob — e.g. \`axle verify "models/**/*.js"\`. Quote the pattern: the CLI expands it, so it means the same thing on every machine.`);
    process.exit(3);
  }
  console.error(`axle: ${cmd} needs a model file — e.g. \`axle ${cmd} model.js\`.`);
  process.exit(3);
}

const opts = { params: [], json: false, github: false, formats: [], out: null, ranges: [], score: null, require: null, where: [], steps: null, maxVariants: null, top: null, targets: [], dims: {} };
const SWEEP_ONLY = new Set(["--range", "--score", "--require", "--where", "--steps", "--max-variants", "--top"]);
// Same law as SWEEP_ONLY: a flag that belongs to another verb is REFUSED, never ignored. A
// `--github` quietly dropped from `axle build` would leave a CI job with no annotations and
// no way to tell that apart from a clean run.
const VERIFY_ONLY = new Set(["--github"]);
// check_dimensions' vocabulary (t31-kitchen): the MCP tool's width / depth / height / tolerance_mm,
// spelled as flags. Keyed by the flag, valued by the request field app/lib/dimensionCheck.ts reads.
const DIM_FLAGS = new Map([["--width", "width"], ["--depth", "depth"], ["--height", "height"], ["--tolerance-mm", "tolerance_mm"]]);
// measure's vocabulary: the MCP tool's part_a / part_b, spelled as flags.
const MEASURE_FLAGS = new Map([["--part-a", "part_a"], ["--part-b", "part_b"]]);
const flagName = (a) => (a.startsWith("--") && a.includes("=") ? a.slice(0, a.indexOf("=")) : a);
const wantsValue = (flag, i) => {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) { console.error(`axle: ${flag} wants a value. Try \`axle help\`.`); process.exit(3); }
  return v;
};
const wholeNumber = (flag, v, min) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) { console.error(`axle: ${flag} wants a whole number of at least ${min}, got "${v}".`); process.exit(3); }
  return n;
};
for (let i = cmd === "repl" ? 1 : 2; i < argv.length; i++) {
  const a = argv[i];
  if (SWEEP_ONLY.has(a) && cmd !== "sweep") {
    // Refuse rather than ignore: a --range silently dropped from `build` would build ONE
    // variant while the caller believed it had swept.
    console.error(`axle: ${a} belongs to \`axle sweep\`, not \`axle ${cmd}\`. Try \`axle help\`.`);
    process.exit(3);
  }
  if (VERIFY_ONLY.has(a) && cmd !== "verify") {
    console.error(`axle: ${a} belongs to \`axle verify\`, not \`axle ${cmd}\`. Try \`axle help\`.`);
    process.exit(3);
  }
  if (DIM_FLAGS.has(flagName(a))) {
    if (cmd !== "check-dimensions") {
      console.error(`axle: ${flagName(a)} belongs to \`axle check-dimensions\`, not \`axle ${cmd}\`. Try \`axle help\`.`);
      process.exit(3);
    }
    const field = DIM_FLAGS.get(flagName(a));
    const raw = a.includes("=") ? a.slice(a.indexOf("=") + 1) : wantsValue(a, i++);
    if (field in opts.dims) { console.error(`axle: ${flagName(a)} was given twice — give each target once.`); process.exit(3); }
    // A plain decimal becomes a number; anything else stays a STRING, so the tolerance reaches
    // dimensionCheck.ts's refusal as the non-number it is. `Number("")` is 0 and `Number("0x10")`
    // is 16, and a check that quietly read either as a tolerance would be the coercion the route
    // refuses. A target that is not a positive number is refused here: the route drops such an
    // axis as "not asked", but a flag the user typed is never silently ignored.
    const n = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(raw) ? Number(raw) : raw;
    if (field !== "tolerance_mm" && !(typeof n === "number" && n > 0)) {
      console.error(`axle: ${flagName(a)} wants a positive number of millimetres, got "${raw}".`);
      process.exit(3);
    }
    opts.dims[field] = n;
    continue;
  }
  if (MEASURE_FLAGS.has(flagName(a))) {
    if (cmd !== "measure") {
      console.error(`axle: ${flagName(a)} belongs to \`axle measure\`, not \`axle ${cmd}\`. Try \`axle help\`.`);
      process.exit(3);
    }
    const field = MEASURE_FLAGS.get(flagName(a));
    if (field in opts.dims) { console.error(`axle: ${flagName(a)} was given twice — measure takes one part, or one pair.`); process.exit(3); }
    // ⚠ A MISSING NAME IS REFUSED, NEVER FILLED FROM THE NEXT FLAG (review round 1, NIT 11): the first
    // cut read `--part-a --json` as a part named "--json" and then reported it not found. A value
    // that starts with "--" is taken for the next flag; a real part name that starts with "--" is
    // still reachable as `--part-a=--name`. A single leading "-" is an ordinary name.
    const raw = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
    if (!a.includes("=")) {
      if (raw === undefined || raw.startsWith("--")) {
        console.error(`axle: ${flagName(a)} wants a part name${raw === undefined ? "" : `, and the next argument is the flag "${raw}"`}. Give the name after it — \`${flagName(a)} "Side Panel"\`, or \`${flagName(a)}=<name>\` for a name that starts with "--".`);
        process.exit(3);
      }
      i++;
    }
    opts.dims[field] = raw;
    continue;
  }
  if (a === "--json") opts.json = true;
  else if (a === "--github") opts.github = true;
  else if (a === "--step" || a === "--stl") opts.formats.push(a.slice(2));
  else if (a === "-o" || a === "--out") opts.out = argv[++i];
  else if (a === "--param") opts.params.push(argv[++i]);
  else if (a.startsWith("--param=")) opts.params.push(a.slice(8));
  else if (a === "--range") opts.ranges.push(wantsValue(a, i++));
  else if (a.startsWith("--range=")) opts.ranges.push(a.slice(8));
  else if (a === "--score") opts.score = wantsValue(a, i++);
  else if (a.startsWith("--score=")) opts.score = a.slice(8);
  else if (a === "--where") opts.where.push(wantsValue(a, i++));
  else if (a.startsWith("--where=")) opts.where.push(a.slice(8));
  else if (a === "--require") {
    const v = wantsValue(a, i++);
    if (v !== "passed") { console.error(`axle: --require knows only \`passed\` (the verdict's own gate), got "${v}".`); process.exit(3); }
    opts.require = v;
  }
  else if (a === "--steps") opts.steps = wholeNumber(a, wantsValue(a, i++), 1);
  else if (a === "--max-variants") opts.maxVariants = wholeNumber(a, wantsValue(a, i++), 1);
  else if (a === "--top") opts.top = wholeNumber(a, wantsValue(a, i++), 1);
  // `verify` is the one verb that takes MANY positionals. Anything after the first that is
  // not a flag is another file or glob; a leading `-` still falls through to the refusal
  // below, so a mistyped flag is never silently verified as a filename.
  else if (cmd === "verify" && !a.startsWith("-")) opts.targets.push(a);
  else { console.error(`axle: unknown option "${a}". Try \`axle help\`.`); process.exit(3); }
}

// ── The engine, imported only now that the floor is known to hold ────────────
//
// ⭐ initReplicad() memoises the OCC instance for the life of the PROCESS, which is the whole
// reason `watch` and `repl` exist: a one-shot `axle build` spends ~900ms on Node startup and
// OCC init to do ~100ms of work, so it is SLOWER than the ~400ms cloud round trip it was
// meant to beat. Pay that once and every later build costs ~55ms. The fast loop is a
// long-lived process, not a fast command.
const { buildVerdict, gatingProblems } = await import("./checks.mjs");
// ⭐ The verdict every command PRINTS comes from report.mjs: buildVerdict's checks plus the static
// lint the push verdict carries, composed the way the worker composes them (t31-kitchen). The
// warmup below is the one call that stays on buildVerdict, because it prints nothing.
const { reportVerdict } = await import("./report.mjs");
const { parseParams, parsePlainConsts, setParam, exportModel, runModel } = await import("./runner.mjs");

class ModelError extends Error {}

/** Read a model and apply `name=value` overrides. Throws ModelError with a legible message —
 *  callers that must survive bad input (repl, watch) catch it; one-shot commands exit. */
function loadModel(path, params) {
  let code;
  try {
    code = readFileSync(resolve(path), "utf8");
  } catch (e) {
    // ⚠ A missing file is the second most likely first-run failure. Say which path was tried.
    throw new ModelError(`could not read ${resolve(path)} — ${e?.code === "ENOENT" ? "no such file" : e.message}`);
  }
  const declared = parseParams(code);
  for (const p of params) {
    const eq = p?.indexOf("=") ?? -1;
    if (eq < 1) throw new ModelError(`--param wants name=value, got "${p}"`);
    const name = p.slice(0, eq), value = p.slice(eq + 1);
    if (!declared.some((d) => d.name === name)) {
      // Refuse rather than silently no-op: setParam's regex would simply not match, and the
      // build would succeed with the ORIGINAL value while the user believed it had changed.
      throw new ModelError(
        `this model has no parameter "${name}". ` +
        (declared.length
          ? `It declares: ${declared.map((d) => `${d.name}=${d.value}`).join(", ")}`
          : `It declares no annotated parameters (a parameter is \`const NAME = 10; // [min:max]\`).`),
      );
    }
    if (!Number.isFinite(Number(value))) throw new ModelError(`--param ${name} wants a number, got "${value}"`);
    code = setParam(code, name, Number(value));
  }
  // Re-read AFTER the overrides, so `declared` carries the values the build will actually use.
  // Before this it carried the file's values, and `build --json` reported `params` that
  // disagreed with the geometry it sat beside whenever --param was given.
  return { code, declared: params.length ? parseParams(code) : declared };
}

const fmt = (n) => (n == null ? "  —  " : n.toFixed(1).padStart(7));

/** The compact record `repl` emits — one JSON object per line (NDJSON). Deliberately small:
 *  an agent driving hundreds of builds reads dimensions and problems, not meshes. */
const record = (path, res, wall) => ({
  file: path,
  ok: res.ok,
  ...(res.ok ? {} : { error: res.error }),
  passed: res.ok ? res.passed : false,
  buildMs: res.elapsedMs ?? null,
  wallMs: wall,
  overall: res.overall ? { x: +res.overall.sizeX.toFixed(2), y: +res.overall.sizeY.toFixed(2), z: +res.overall.sizeZ.toFixed(2) } : null,
  // `volume` (mm³, the sum of the parts) is a scoring term of the sweep and rides the repl
  // record too, so the two doors report one shape. null when OCC could not measure a part.
  volume: res.ok && (res.parts ?? []).length && res.parts.every((p) => typeof p.volume === "number" && Number.isFinite(p.volume))
    ? +res.parts.reduce((a, p) => a + p.volume, 0).toFixed(2) : null,
  parts: (res.parts ?? []).map((p) => ({
    name: p.name,
    ...(p.bbox ? { x: +p.bbox.sizeX.toFixed(2), y: +p.bbox.sizeY.toFixed(2), z: +p.bbox.sizeZ.toFixed(2) } : {}),
    ...(typeof p.volume === "number" ? { volume: +p.volume.toFixed(2) } : {}),
  })),
  problems: res.problems ?? [],
});

let code, declared;
// ⚠ `verify` is excluded as well as `repl`: its argument is a PATTERN, not a path, and a
// failure to load one of the models it matches is that model's answer (a row, exit 3) rather
// than the end of the run — see runVerify's loop rule.
if (cmd !== "repl" && cmd !== "verify") {
  try { ({ code, declared } = loadModel(file, opts.params)); }
  catch (e) { console.error(`axle: ${e.message}`); process.exit(3); }
}

// ── explain — what --param accepts, without building ──────────────────────────
//
// The only way to learn a model's parameters used to be opening the file. This prints what the
// same reader `--param` and the sweep use (runner.mjs parseParams — ONE grammar, not a second
// parser here), so an agent can read the ranges before it sweeps anything. The value shown is
// the value a build would use, so `--param` overrides show through — which is also how you
// check an override landed on the name you meant.
//
// ⚠ Numeric consts WITHOUT an annotation are listed as well, with no range: they are the
// reason `--param` refuses a name, and guessing a range for them would be inventing a fact
// the model never declared. The text says how to make one adjustable; the JSON keeps them in
// a separate `unannotated` list so a sweep never mistakes one for a parameter.
//
// Exit codes match build's shape: 0 = listed · 1 = a finding (the model declares no parameter
// at all, so it is a one-off, not a parametric model) · 3 = could not run (already handled
// above, by loadModel). Nothing here touches the OCC kernel.
if (cmd === "explain") {
  const plain = parsePlainConsts(code);
  if (opts.json) {
    // `params` is the SAME array `build --json` carries under the same key, so a script that
    // already reads build's ranges reads these without a second shape.
    console.log(JSON.stringify({ file, params: declared, unannotated: plain }, null, 2));
    process.exit(declared.length ? 0 : 1);
  }
  const range = (p) => {
    const r = `[${p.min}:${p.max}]`;
    if (p.kind === "toggle") return `${r} toggle`;
    if (p.kind === "enum") return `${r} choices: ${p.choices.join("|")}`;
    return r;
  };
  const nameW = Math.max(8, ...declared.map((p) => p.name.length), ...plain.map((p) => p.name.length));
  const valW = Math.max(5, ...[...declared, ...plain].map((p) => String(p.value).length));
  if (!declared.length) {
    console.log(`\n${basename(file)} declares no parameters — nothing here is adjustable, so --param has nothing to accept.`);
    if (plain.length) {
      console.log(`\n  numeric consts with no range annotation:`);
      for (const p of plain) console.log(`   ${p.name.padEnd(nameW)}  ${String(p.value).padStart(valW)}`);
    }
    console.log(`\n  A parameter is an annotated const: \`const width = 800; // [400:1600]\`. Annotate the\n  dimensions a person would actually turn; the ones fixed by the shop or the material stay plain.\n`);
    process.exit(1);
  }
  console.log(`\n${basename(file)} — ${declared.length} parameter(s)\n`);
  for (const p of declared) console.log(`   ${p.name.padEnd(nameW)}  ${String(p.value).padStart(valW)}  ${range(p)}`);
  if (plain.length) {
    console.log(`\n  not adjustable — numeric consts with no \`// [min:max]\` annotation, so --param refuses them:`);
    for (const p of plain) console.log(`   ${p.name.padEnd(nameW)}  ${String(p.value).padStart(valW)}  —`);
  }
  console.log(`\n  Override any parameter with --param name=value; the range is what the model declares, not a limit the CLI enforces.\n`);
  process.exit(0);
}

// ── sweep — search the space, scored by what was measured ─────────────────────
//
// The agent stops drawing one design and asks the whole range at once: every variant builds
// in THIS process on the kernel the first one paid for (the `repl` discipline — one OCC init,
// then ~55ms a variant), and the ranking reads ONLY measured fields of the verdict. The
// planning, the vocabulary and the ranking live in sweep.mjs; this block is the I/O.
//
// stdout is the answer (a table, or NDJSON in ranked order then `{ summary }`); stderr is the
// plan and the progress, so `--json` stays parseable line by line.
if (cmd === "sweep") {
  const sweep = await import("./sweep.mjs");
  const say = (s) => console.error(s);

  let plan, score = null, where = [];
  try {
    plan = sweep.planSweep(declared, {
      ranges: opts.ranges.map(sweep.parseRange),
      steps: opts.steps ?? undefined,
      maxVariants: opts.maxVariants ?? undefined,
    });
    if (opts.score) score = sweep.parseScore(opts.score, plan.ranges);
    where = opts.where.map((w) => sweep.parseWhere(w, plan.ranges));
  } catch (e) {
    if (!(e instanceof sweep.SweepError)) throw e;
    console.error(`axle: ${e.message}`);
    process.exit(3);
  }

  const shape = plan.ranges.map((r) => `${r.name}×${r.values.length}`).join(" · ");
  say(`sweep: ${basename(file)} — ${plan.count} variant(s) (${shape}), one warm kernel`);
  for (const n of plan.notes) say(`  note: ${n}`);

  const t0 = Date.now();
  const rows = await sweep.runSweep(file, code, plan, {
    onVariant: (row, i, n) => {
      if (!opts.json && (i === 0 || (i + 1) % 25 === 0 || i + 1 === n)) say(`  ${i + 1}/${n} built · ${Date.now() - t0}ms`);
    },
  });
  const wall = Date.now() - t0;
  const { ranked, excluded, rankedNotPassed } = sweep.rankVariants(rows, { requirePassed: opts.require === "passed", where, score });

  const didNotBuild = rows.filter((r) => !r.ok).length;
  const passedCount = rows.filter((r) => r.passed).length;
  const tally = (why) => excluded.filter((r) => (why === "where" ? r.excluded.startsWith("where:") : r.excluded === why)).length;
  const winner = ranked[0] ?? null;
  // ⭐ The model's static lint, ONCE (sweep.mjs sourceLint): the model as handed in, never a
  // variant, and never inside a variant's `problems` or `passed`, so it cannot rank, filter or
  // exclude anything. It is stated in the header and in `summary.lint` so it is not silently lost.
  const lint = sweep.sourceLint(code, rows);
  const summary = {
    file,
    ranges: plan.ranges.map((r) => ({ name: r.name, min: r.min, max: r.max, step: r.step, values: r.values.length, source: r.source })),
    variants: rows.length,
    built: rows.length - didNotBuild,
    didNotBuild,
    passed: passedCount,
    require: opts.require,
    where: opts.where,
    score: score ? `${score.dir}:${score.term}` : null,
    ranked: ranked.length,
    excluded: { didNotBuild: tally("did_not_build"), notPassed: tally("not_passed"), where: tally("where") },
    rankedNotPassed,
    winner: winner ? { params: winner.params, score: winner.score, passed: winner.passed, paramLine: sweep.paramLine(winner, opts.params) } : null,
    // Reported once for the sweep, not per variant: `findings` in the push verdict's shape, plus
    // the error and warning counts. `errors > 0` means `axle build` fails this file whatever the
    // variants' `passed` say, because a variant's `passed` is the geometry's alone.
    lint: { source: "the model as handed to the sweep, before any --range value", ...lint },
    wallMs: wall,
  };

  if (opts.json) {
    for (const r of [...ranked, ...excluded]) console.log(JSON.stringify(r));
    console.log(JSON.stringify({ summary }));
    process.exit(ranked.length ? 0 : 1);
  }

  // ── the ranked table ──
  const top = opts.top ?? DEFAULT_TOP;
  const names = plan.ranges.map((r) => r.name);
  const num = (v) => (v == null ? "—" : typeof v === "number" ? String(+v.toFixed(2)) : String(v));
  const dims = (r) => (r.overall ? `${r.overall.x.toFixed(1)} × ${r.overall.y.toFixed(1)} × ${r.overall.z.toFixed(1)}` : "—");
  const cols = [
    { h: "#", v: (r) => String(r.rank), right: true },
    ...names.map((n) => ({ h: n, v: (r) => num(r.params[n]), right: true })),
    ...(score && !names.includes(score.term) ? [{ h: score.term, v: (r) => num(r.score), right: true }] : []),
    { h: "passed", v: (r) => (r.ok ? (r.passed ? "✓" : "✗") : "did not build") },
    { h: "problems", v: (r) => (r.ok ? String(r.problems.length) : "—"), right: true },
    { h: "overall (mm)", v: dims },
    { h: "volume (mm³)", v: (r) => num(r.volume), right: true },
  ];
  const shown = ranked.slice(0, top);
  const widths = cols.map((c) => Math.max(c.h.length, ...shown.map((r) => c.v(r).length)));
  const line = (cells) => "   " + cells.map((s, i) => (cols[i].right ? s.padStart(widths[i]) : s.padEnd(widths[i]))).join("  ");

  const filters = [opts.require ? "--require passed" : null, ...opts.where.map((w) => `--where ${w}`)].filter(Boolean);
  console.log(`\n${basename(file)} — ${rows.length} variant(s) swept in ${wall}ms · ${rows.length - didNotBuild} built · ${passedCount} passed` +
    (filters.length ? ` · ${excluded.length} excluded by ${filters.join(" ")}` : "") +
    ` · ${ranked.length} ranked${score ? ` by ${score.dir}:${score.term}` : " in parameter order"}\n`);
  if (!lint.findings.length) {
    console.log(`  static lint: none (the model as handed in, checked once for the sweep).\n`);
  } else {
    console.log(`  static lint: the model as handed in, reported ONCE for the sweep. It is in no variant's`);
    console.log(`  problems or passed, so it does not rank, filter or exclude a variant:`);
    for (const p of lint.findings) console.log(`   [${p.severity}] ${p.rule}: ${p.message}`);
    if (lint.errors) console.log(`  ⚠ ${lint.errors} lint error(s): \`axle build\` fails this file and a push reads NOT OK, whichever variant you pick.`);
    console.log("");
  }

  if (!ranked.length) {
    console.log(`  nothing survived the filters — ${didNotBuild} did not build, ${tally("not_passed")} did not pass, ${tally("where")} missed a --where.\n`);
  } else {
    console.log(line(cols.map((c) => c.h)));
    for (const r of shown) console.log(line(cols.map((c) => c.v(r))));
    if (ranked.length > shown.length) console.log(`   … ${ranked.length - shown.length} more (--top ${ranked.length} shows them all)`);
    console.log(`\n  winner   ${sweep.paramLine(winner, opts.params)}`);
  }
  if (rankedNotPassed) {
    console.log(`\n  ⚠ ${rankedNotPassed} of the ${ranked.length} ranked variant(s) did NOT pass their checks — the ranking is over failing designs. Add --require passed to exclude them.`);
  }
  if (excluded.length) {
    // The excluded rows carry the finding a sweep is often FOR — the first clearance where the
    // drawer strikes its opening — so name them, with the rule the checks reported, verbatim.
    // ⚠ A not-passed row names only the ERRORS (gatingProblems): since S9 a warning riding on
    // the same variant did not exclude it, and listing it here would say it had. A row a
    // --where dropped names every finding it carries, because `--where problems==0` is how a
    // sweep refuses a WARNING (the slat bench's end slats leaving the rails), and the rule is
    // the thing the reader came for.
    const rules = (list) => {
      const counts = new Map();
      for (const p of list) counts.set(p.rule, (counts.get(p.rule) ?? 0) + 1);
      return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
    };
    console.log(`\n  excluded (${excluded.length}):`);
    for (const r of excluded.slice(0, top)) {
      const why = !r.ok ? `did not build — ${r.error}`
        : r.excluded === "not_passed" ? `not passed: ${rules(gatingProblems(r.problems))}`
        : `missed ${r.excluded.slice(6)}${r.problems.length ? ` — ${rules(r.problems)}` : ""}`;
      console.log(`   ${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(" ")}  ${why}`);
    }
    if (excluded.length > top) console.log(`   … ${excluded.length - top} more`);
  }
  console.log("");
  process.exit(ranked.length ? 0 : 1);
}

// ── verify — many models, one kernel, the worst code (t22-ci) ─────────────────
//
// The engine is the compiler and this is the gate: a repository of model code either builds
// clean or it does not, and CI needs that as a NUMBER. Every matched model builds in this one
// process (the `repl`/`sweep` discipline — one OCC init, ~55ms a model after the first), each
// prints one line, and the exit is the WORST code any of them produced.
//
// ⭐⭐ THE LOGIC IS HERE, NOT IN THE ACTION. The generated GitHub Action is `npx … verify …`
// and nothing else: no bash that re-derives a verdict, no second place where "clean" is
// decided. Anything the Action would need to know how to do is a flag on this verb instead.
//
// ⚠ A PATTERN THAT MATCHED NOTHING STOPS THE RUN (exit 3). A stale glob otherwise produces a
// green job that verified zero models — which reads exactly like "every model is clean".
if (cmd === "verify") {
  const verify = await import("./verify.mjs");
  // ⚠ Both write to stdout — the annotations because that is the only stream GitHub reads
  // workflow commands from, the records because that is where a verdict goes. Interleaved,
  // neither is parseable and the NDJSON silently stops being NDJSON. Refuse instead of
  // picking one for the caller.
  if (opts.json && opts.github) {
    console.error(`axle: --json and --github both write to stdout — the annotations would break the NDJSON. Run one or the other (the workflow command annotations are the machine-readable form in Actions).`);
    process.exit(3);
  }
  const patterns = [file, ...opts.targets];
  const { files, empty } = verify.expandTargets(patterns);
  if (empty.length) {
    console.error(
      `\naxle: nothing to verify — ${empty.length} of ${patterns.length} pattern(s) matched no files:\n` +
      empty.map((e) => `    ${e.pattern}${e.glob ? "" : "   (a literal path — no such file)"}`).join("\n") +
      `\n\n  looked from ${process.cwd()}\n` +
      `  A pattern that matches nothing would otherwise be a green run that verified nothing,\n` +
      `  which reads exactly like "every model is clean". So it is a refusal, not an empty pass.\n`,
    );
    // ⚠ And say it in the runner's language too. On Actions a stderr line is just log text —
    // this is the one failure whose whole danger is that nobody notices it, so it gets the
    // annotation that puts it on top of the run summary.
    if (opts.github) {
      console.log(`::error title=nothing to verify::${verify.escData(`${empty.map((e) => e.pattern).join(", ")} matched no files under ${process.cwd()} — a run that verified nothing is not a pass.`)}`);
    }
    process.exit(3);
  }

  const t0 = Date.now();
  const rows = await verify.runVerify(files, {
    load: (f) => loadModel(f, opts.params),
    onModel: !opts.json && files.length > 1
      // Progress on stderr, so --json stays parseable line by line and a long CI run is not
      // silent while it works. The verdict lines themselves are printed after, in file order.
      ? (row, i, n) => console.error(`  ${i + 1}/${n}  ${verify.mark(row)} ${row.file}`)
      : undefined,
  });
  const wall = Date.now() - t0;
  const worst = verify.worstExit(rows);
  const counts = verify.tally(rows);

  if (opts.json) {
    for (const r of rows) console.log(JSON.stringify(r));
    console.log(JSON.stringify({ summary: { patterns, ...counts, exit: worst, meaning: verify.EXIT_MEANING[worst], wallMs: wall } }));
    process.exit(worst);
  }

  const w = Math.max(...rows.map((r) => r.file.length));
  console.log(`\n${rows.length} model(s) verified in ${wall}ms — one warm kernel\n`);
  for (const r of rows) {
    console.log(`   ${verify.mark(r)}  ${r.file.padEnd(w)}  ${verify.verdictLine(r)}`);
    // The problems verbatim, with the rule ids exactly as checks.mjs reported them (S27).
    for (const p of r.problems) console.log(`        ${p.unverified ? "[unverified]" : `[${p.severity ?? "?"}]`} ${p.rule}: ${p.message}`);
    // …and the same finding in the runner's language, beside the line it belongs to, so the
    // log and the annotations can never tell different stories about one model.
    if (opts.github) for (const line of verify.annotations(r)) console.log(line);
  }
  console.log(`\n   ${verify.tallyLine(counts)}`);
  console.log(`\n   exit ${worst} — ${verify.EXIT_MEANING[worst]}\n`);

  // The job summary — the page a reviewer actually opens on the Actions tab. APPENDED, because
  // the file belongs to the whole job and clobbering another step's summary is a loss nobody
  // notices until the one time they wanted both. A write that fails is SAID, never swallowed:
  // a silent catch here would mean a summary that is quietly missing on every run
  // [[feedback_silent_catch_hides_holes]].
  if (opts.github && process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, verify.summaryMarkdown(rows, { wallMs: wall, version }), "utf8");
    } catch (e) {
      console.log(`::warning title=step summary::axle verify could not write $GITHUB_STEP_SUMMARY (${e.message}) — the verdict above still stands, and the exit code is unaffected.`);
    }
  }
  process.exit(worst);
}

// ── repl — the agent's door ───────────────────────────────────────────────────
//
// One line in: `<path> [name=value ...]`. One JSON object out. OCC stays warm, so after the
// first build each line costs ~55ms instead of ~1s.
//
// ⚠ THE LOOP MUST SURVIVE BAD INPUT. A missing file, an unknown parameter or a model that
// throws are all ANSWERS here, not crashes — an agent piping a hundred paths must not lose
// the session (and its warm kernel) to the one typo in the middle.
if (cmd === "repl") {
  const { createInterface } = await import("node:readline");
  // Readiness is announced, because a caller writing to a cold pipe otherwise cannot tell
  // "still starting OCC" from "hung".
  const t0 = Date.now();
  await buildVerdict("const main = (api) => [{ name: 'warmup', shape: api.makeBaseBox(1, 1, 1) }];");
  console.log(JSON.stringify({ ready: true, warmupMs: Date.now() - t0, node: process.versions.node }));

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (raw === "quit" || raw === "exit") break;
    const [path, ...pairs] = raw.split(/\s+/);
    const t = Date.now();
    try {
      const { code: src } = loadModel(path, pairs.map((p) => `${p}`));
      const res = await reportVerdict(src);
      console.log(JSON.stringify(record(path, res, Date.now() - t)));
    } catch (e) {
      console.log(JSON.stringify({ file: path, ok: false, passed: false, error: e.message, wallMs: Date.now() - t, problems: [] }));
    }
  }
  process.exit(0);
}

// ── watch — the human's door ──────────────────────────────────────────────────
//
// ⚠ Watches the DIRECTORY, not the file. Editors save atomically (write a temp file, then
// rename over the target), which destroys the inode a file watch is bound to — so a direct
// fs.watch(file) fires once and then goes silent forever, which looks exactly like "nothing
// changed" [[feedback_silent_catch_hides_holes]].
if (cmd === "watch") {
  const target = resolve(file);
  let building = false, again = false;

  const once = async () => {
    if (building) { again = true; return; }
    building = true;
    try {
      const { code: src } = loadModel(file, opts.params);
      const t = Date.now();
      const res = await reportVerdict(src);
      const wall = Date.now() - t;
      const stamp = new Date().toTimeString().slice(0, 8);
      if (!res.ok) {
        console.log(`\n[${stamp}] ✗ did not build — ${res.error}`);
      } else {
        const o = res.overall;
        const dims = o ? `${o.sizeX.toFixed(1)} × ${o.sizeY.toFixed(1)} × ${o.sizeZ.toFixed(1)}mm` : "—";
        console.log(`\n[${stamp}] ${res.passed ? "✓" : "⚠"} ${wall}ms · ${res.parts.length} part(s) · ${dims}`);
        for (const p of res.problems) console.log(`         [${p.severity ?? "?"}] ${p.rule}: ${p.message}`);
      }
    } catch (e) {
      console.log(`\n[${new Date().toTimeString().slice(0, 8)}] ✗ ${e.message}`);
    } finally {
      building = false;
      if (again) { again = false; await once(); }
    }
  };

  console.log(`axle: watching ${basename(target)} — first build pays for the OCC kernel, the rest are warm. Ctrl-C to stop.`);
  await once();

  let debounce = null;
  watch(dirname(target), (_event, name) => {
    if (name && basename(name) !== basename(target)) return;
    clearTimeout(debounce);
    // Saves land as several events; one rebuild per settled change.
    debounce = setTimeout(() => { once(); }, 60);
  });
  // Hold the process open; the watcher is the only thing keeping the loop alive.
  await new Promise(() => {});
}

// ── check-dimensions — the overall size against numbers you typed (t31-kitchen) ─
//
// ⭐ THE MCP TOOL'S COMPARISON, NOT A SECOND ONE. The targets and the tolerance go through
// app/lib/dimensionCheck.ts readDimensionRequest, the reader the hosted route uses, so "at least one
// target" and "a nonsense tolerance is refused, never replaced by the default" are decided once; the
// answer is dimensionReport, the object the route returns (`{ ok, built, ...report }`), band and
// sentence included. local-engine-plan §8 decision 7 admits the COMPARISON: the route reads its
// targets from the request, this reads them from the command line, and neither reads a stored
// brief — that stays on the platform.
//
// The build is a plain runModel: the route reads only `built` and `overall` from /validate, and
// neither depends on the interference or soundness passes, so this does not pay for them.
if (cmd === "check-dimensions") {
  const { readDimensionRequest, dimensionReport } = await import("../../app/lib/dimensionCheck.js");
  const request = readDimensionRequest(opts.dims);
  if ("error" in request) {
    console.error(`axle: ${request.error}${Object.keys(opts.dims).some((k) => k !== "tolerance_mm") ? "" : " e.g. `axle check-dimensions model.js --width 900 --height 750`"}`);
    process.exit(3);
  }
  const { requested, toleranceMm } = request;
  const res = await runModel(code);
  if (!res.ok) {
    if (opts.json) console.log(JSON.stringify({ file, ok: false, built: false, buildError: res.error ?? "Model did not build", requested }, null, 2));
    else console.error(`\n✗ ${basename(file)} did not build, so nothing was measured\n\n  ${res.error}\n`);
    process.exit(2);
  }
  const o = res.overall;
  if (!o || typeof o.sizeX !== "number") {
    if (opts.json) console.log(JSON.stringify({ file, ok: false, built: true, error: "Build produced no measurable bounding box", requested }, null, 2));
    else console.log(`\n✗ ${basename(file)} built, but produced no measurable bounding box — there is no overall size to compare.\n`);
    process.exit(1);
  }
  const report = dimensionReport({ width: o.sizeX, depth: o.sizeY, height: o.sizeZ }, requested, toleranceMm);
  if (opts.json) {
    console.log(JSON.stringify({ file, ok: true, built: true, ...report }, null, 2));
    process.exit(report.pass ? 0 : 1);
  }
  const axisOf = { width: "X", depth: "Y", height: "Z" };
  console.log(`\n${report.pass ? "✓" : "✗"} ${basename(file)} — ${report.pass ? "within the band" : `off on ${report.offAxes.join(", ")}`}\n`);
  for (const axis of ["width", "depth", "height"]) {
    const want = requested[axis];
    const got = report.measured[axis].toFixed(2).padStart(9);
    if (want == null) console.log(`   ${axis.padEnd(6)} (${axisOf[axis]})   measured ${got}   not asked`);
    else console.log(`   ${axis.padEnd(6)} (${axisOf[axis]})   measured ${got}   asked ${String(want).padStart(9)}   ${report.offAxes.includes(axis) ? "✗ off" : "✓"}`);
  }
  console.log(`\n   tolerance applied: ${report.tolerance.rule}`);
  console.log(`\n  ${report.message}\n`);
  process.exit(report.pass ? 0 : 1);
}

// ── measure — one part, or the relation between two (t31-kitchen) ────────────
//
// ⭐ THE MCP TOOL'S COMPUTATION, NOT A SECOND ONE. app/lib/partMeasure.ts measureParts is what the
// hosted route calls: the per-part box, the per-axis gap / flush / overlap, the nearest distance,
// the centre offset, the shared-volume summary and the solidity sentence (mcp/lib/solidity.js,
// handed in, as the route hands it in). The JSON printed is the route's body.
//
// ⚠ WHAT THE PACK HAS, SAID PLAINLY. The route reads a /validate answer: `parts` (box, oriented
// blank, volume, solids) and `interference`, the per-pair verdicts by name. Here the build is this
// process's own runModel with the interference pass ON — the same measureInterference, at the same
// default caps (64 suspect pairs, a 400ms budget) the service's /validate uses — flattened by the
// same app/lib/interference.ts interferencePairs. The soundness pass is skipped: measure reads no
// soundness finding. One deliberate difference: when the interference pass itself failed,
// `res.interference` is null and this passes null on, so `shared_volume` says "could not report"
// (null) — where /validate, whose projection turns a missing Map into [], would read "no_contact".
if (cmd === "measure") {
  // The route's reader (app/lib/partMeasure.ts readMeasureRequest): part_a required, names trimmed.
  // Its refusal names MCP tools, so the CLI adds its own way to find the names.
  const { measureParts, readMeasureRequest } = await import("../../app/lib/partMeasure.js");
  const measureRequest = readMeasureRequest(opts.dims);
  if ("error" in measureRequest) {
    console.error(`axle: measure needs --part-a <part name>. ${measureRequest.error} Here, \`axle build ${basename(file)}\` lists the model's parts.`);
    process.exit(3);
  }
  const { partA, partB } = measureRequest;
  const { interferencePairs } = await import("../../app/lib/interference.js");
  const { solidity } = await import("../../mcp/lib/solidity.js");
  const res = await runModel(code, { interference: true, soundness: false });
  if (!res.ok) {
    if (opts.json) console.log(JSON.stringify({ file, ok: false, built: false, buildError: res.error ?? "Model did not build" }, null, 2));
    else console.error(`\n✗ ${basename(file)} did not build, so nothing was measured\n\n  ${res.error}\n`);
    process.exit(2);
  }
  const answer = measureParts({ parts: res.parts, interference: res.interference ? interferencePairs(res) : null }, partA, partB, solidity);
  if (opts.json) {
    console.log(JSON.stringify({ file, ...answer.body }, null, 2));
    process.exit(answer.status === 200 ? 0 : answer.status === 404 ? 3 : 1);
  }
  if (answer.status !== 200) {
    const names = answer.body.available_parts;
    console.error(`axle: ${answer.body.error}${Array.isArray(names) ? ` — ${basename(file)} has: ${names.map((n) => JSON.stringify(n)).join(", ")}` : ""}`);
    process.exit(answer.status === 404 ? 3 : 1);
  }
  const b = answer.body;
  const box = (p) => `${p.size.w} × ${p.size.d} × ${p.size.h} mm, from [${p.min.join(", ")}] to [${p.max.join(", ")}]${Number.isInteger(p.solids) && p.solids > 1 ? ` · ${p.solids} separate solids` : ""}`;
  if (b.mode === "single") {
    console.log(`\n${b.part.name}  ${box(b.part)}\n\n  ${b.summary}\n`);
    process.exit(0);
  }
  console.log(`\n${b.part_a.name} ↔ ${b.part_b.name}\n`);
  for (const [axis, word] of [["x", "X / width"], ["y", "Y / depth"], ["z", "Z / height"]]) {
    const r = b.axes[axis];
    console.log(`   ${word.padEnd(11)} ${r.relation}${r.relation === "flush" ? "" : ` ${r.mm}mm`}`);
  }
  const sv = b.shared_volume;
  console.log(`\n   nearest gap      ${b.nearest_distance_mm}mm`);
  console.log(`   centre offset    ${b.center_offset_mm.x}, ${b.center_offset_mm.y}, ${b.center_offset_mm.z} (${b.center_offset_mm.distance}mm)`);
  console.log(`   shared volume    ${sv == null ? "not reported by this build" : `${sv.verdict}${sv.volume_mm3 != null ? `, ${sv.volume_mm3}mm³` : ""}${sv.reason ? ` — ${sv.reason}` : ""}`}`);
  console.log(`\n   ${b.part_a.name.padEnd(18)} ${box(b.part_a)}`);
  console.log(`   ${b.part_b.name.padEnd(18)} ${box(b.part_b)}`);
  console.log(`\n  ${b.summary}\n`);
  process.exit(0);
}

// ── build ─────────────────────────────────────────────────────────────────────

if (cmd === "build") {
  // ⭐ SOLIDITY — the measured fact the push verdict prints under every part (t31-kitchen, local-
  // engine-plan §6l, admitted by §8 decision 7). The sentences are mcp/lib/solidity.js's, the SAME
  // functions mcp/lib/format.js formatBuild calls for the hosted verdict, over the same per-part
  // fields (`volume`, the oriented blank `obb`, `bbox`, `solids`) runModel already returns. Nothing
  // here words a verdict of its own; it only lays the functions' output out the way formatBuild
  // does: the per-part tag after the part's line, then the model-wide lines once.
  // ⚠ A MEASURED FACT, NEVER A GATE — the module says so at its "must not become a gate" branch,
  // and nothing below reads it into `passed` or the exit code.
  const { solidity, solidTag, solidityLine, piecesLine } = await import("../../mcp/lib/solidity.js");
  const t0 = Date.now();
  const res = await reportVerdict(code);
  const wall = Date.now() - t0;
  // The model-wide lines count the parts the HOSTED record keeps: serverSideBuild writes
  // `geometry.parts` from the parts with a bounding box only, so a part with an empty mesh is in
  // neither tally there. Counting it here made piecesLine's "N of M part(s)" disagree (review
  // round 1, NIT 7). The per-part lines still list every part the build returned.
  const measuredParts = (res.parts ?? []).filter((p) => p.bbox);

  if (opts.json) {
    console.log(JSON.stringify({
      ok: res.ok,
      error: res.error ?? null,
      passed: res.ok ? res.passed : false,
      elapsedMs: res.elapsedMs,
      wallMs: wall,
      overall: res.overall ?? null,
      // `solid` is solidity()'s whole verdict for the part (the object `measure` returns under the
      // same key); `solids` is how many separate solids the part is. Both are null, never absent,
      // when the build could not say — the three-outcome rule solidity.js is written around.
      parts: (res.parts ?? []).map((p) => ({
        name: p.name, bbox: p.bbox, volume: p.volume,
        solids: Number.isInteger(p.solids) ? p.solids : null,
        solid: solidity(p, p.name),
      })),
      // The two model-wide sentences the push verdict prints under its part list, or null when it
      // prints nothing (no part carries a volume · no part is several solids).
      solidityLine: res.ok ? solidityLine(measuredParts) : null,
      piecesLine: res.ok ? piecesLine(measuredParts) : null,
      problems: res.problems ?? [],
      params: declared,
    }, null, 2));
    process.exit(res.ok ? (res.passed ? 0 : 1) : 2);
  }

  if (!res.ok) {
    console.error(`\n✗ ${basename(file)} did not build\n\n  ${res.error}\n`);
    // Static lint rides a failed build at full strength, as it does on the hosted record, because
    // it often NAMES the cause behind a cryptic runtime error (formatBuild's "Code lint:" block).
    if (res.problems?.length) {
      console.error(`  Code lint:`);
      for (const p of res.problems) console.error(`   [${p.severity ?? "?"}] ${p.rule}: ${p.message}`);
      console.error("");
    }
    process.exit(2);
  }

  const o = res.overall;
  console.log(`\n✓ built in ${wall}ms — ${res.parts.length} part(s)`);
  if (o) console.log(`  overall  ${fmt(o.sizeX)} × ${fmt(o.sizeY)} × ${fmt(o.sizeZ)} mm`);
  console.log("");
  // The per-part clause is solidity.js solidTag — the function formatBuild lays the push verdict's
  // part lines out with, not a copy of it.
  for (const p of res.parts) {
    console.log(`   ${p.name.padEnd(18)} ${fmt(p.bbox?.sizeX)} × ${fmt(p.bbox?.sizeY)} × ${fmt(p.bbox?.sizeZ)}${solidTag(p)}`);
  }
  const solidSummary = solidityLine(measuredParts);
  const piecesSummary = piecesLine(measuredParts);
  if (solidSummary || piecesSummary) console.log("");
  if (solidSummary) console.log(`  ${solidSummary}`);
  if (piecesSummary) console.log(`  ${piecesSummary}`);

  if (!res.problems.length) {
    console.log(`\n  no problems.\n`);
  } else {
    console.log(`\n  ${res.problems.length} problem(s):`);
    for (const p of res.problems) console.log(`   [${p.severity ?? "?"}] ${p.rule}: ${p.message}`);
    // ⭐ The exit code is decided by severity (S9, checks.mjs gatingProblems), so say which way
    // it went: a list of [warning] lines that exits 0 reads like a bug unless the line says so.
    const errors = gatingProblems(res.problems).length;
    console.log(errors
      ? `\n  not passed — ${errors} error(s). An error fails the model.\n`
      : `\n  passed — no errors. A warning flags the model; it does not fail it.\n`);
  }
  process.exit(res.passed ? 0 : 1);
}

// ── export ────────────────────────────────────────────────────────────────────

if (!opts.formats.length) {
  console.error(`axle: export needs a format — --step or --stl.`);
  process.exit(3);
}
if (opts.out && opts.formats.length > 1) {
  console.error(`axle: -o names one file, but two formats were asked for. Run them separately.`);
  process.exit(3);
}

// ⚠ Export builds the model too, so it can fail the same way a build can — and an export that
// writes a file for a model that did not build would be the worst possible silence.
for (const format of opts.formats) {
  let bytes;
  const t0 = Date.now();
  try {
    bytes = await exportModel(code, format);
  } catch (e) {
    console.error(`\n✗ ${basename(file)} did not build, so nothing was exported\n\n  ${e?.message ?? e}\n`);
    process.exit(2);
  }
  const out = opts.out ?? `${basename(file, extname(file))}.${format}`;
  writeFileSync(out, bytes);
  console.log(`✓ ${out} — ${(bytes.length / 1024).toFixed(1)} KB in ${Date.now() - t0}ms`);
}
process.exit(0);
