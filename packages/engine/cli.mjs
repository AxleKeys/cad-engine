#!/usr/bin/env node
// The Axle Keys local engine CLI — build a model and get the verdict, offline, in about a
// second (t22-localpack L3).
//
//   axle build   model.js [--json] [--param name=value ...]
//   axle explain model.js [--json] [--param name=value ...]   — its parameters and their ranges
//   axle sweep   model.js [--range name=min:max:step ...] [--score min|max:<term>] [--require passed]
//                         [--where <term><op><n> ...] [--top N] [--json]   — search the space
//   axle export  model.js --step|--stl [-o out.step] [--param name=value ...]
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
  axle watch   <model.js> [options]    rebuild on every save, ~55ms each
  axle repl                            paths on stdin, one JSON verdict per line
  axle export  <model.js> --step|--stl build it and write a CAD file
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
  --require passed            drop variants whose verdict did not pass BEFORE ranking
  --where <term><op><number>  keep only variants satisfying it; ops <= >= < > == (repeatable)
  --top N                     rows in the text table (default ${DEFAULT_TOP})

Exit codes
  0  built, no problems      2  did not build
  1  built, problems found   3  cannot run (see the message)
  explain: 0 parameters listed · 1 the model declares none · 3 cannot run
  sweep:   0 at least one variant ranked · 1 nothing survived the filters · 3 cannot run

\`sweep\` scores ONLY what the verdict measured. There is no opinion in the ranking: a term is
volume (mm³, sum of parts), an overall dimension, the part count, the problem count, the
build time, or a swept parameter. \`--require passed\` reads the same \`passed\` the verdict
carries. Every variant builds in this one process on one warm kernel (~55ms each after the
first), so 100 variants take seconds, not minutes; \`--json\` prints one record per variant in
ranked order, then a final { summary } line.

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
const COMMANDS = new Set(["build", "explain", "sweep", "watch", "repl", "export"]);
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
  console.error(`axle: ${cmd} needs a model file — e.g. \`axle ${cmd} model.js\`.`);
  process.exit(3);
}

const opts = { params: [], json: false, formats: [], out: null, ranges: [], score: null, require: null, where: [], steps: null, maxVariants: null, top: null };
const SWEEP_ONLY = new Set(["--range", "--score", "--require", "--where", "--steps", "--max-variants", "--top"]);
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
  if (a === "--json") opts.json = true;
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
  else { console.error(`axle: unknown option "${a}". Try \`axle help\`.`); process.exit(3); }
}

// ── The engine, imported only now that the floor is known to hold ────────────
//
// ⭐ initReplicad() memoises the OCC instance for the life of the PROCESS, which is the whole
// reason `watch` and `repl` exist: a one-shot `axle build` spends ~900ms on Node startup and
// OCC init to do ~100ms of work, so it is SLOWER than the ~400ms cloud round trip it was
// meant to beat. Pay that once and every later build costs ~55ms. The fast loop is a
// long-lived process, not a fast command.
const { buildVerdict } = await import("./checks.mjs");
const { parseParams, parsePlainConsts, setParam, exportModel } = await import("./runner.mjs");

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
if (cmd !== "repl") {
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
    // The excluded rows carry the finding a sweep is often FOR — the first pitch where the
    // slats leave the rails — so name them, with the rule the checks reported, verbatim.
    const rules = (r) => {
      const counts = new Map();
      for (const p of r.problems) counts.set(p.rule, (counts.get(p.rule) ?? 0) + 1);
      return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
    };
    console.log(`\n  excluded (${excluded.length}):`);
    for (const r of excluded.slice(0, top)) {
      const why = !r.ok ? `did not build — ${r.error}` : r.excluded === "not_passed" ? `not passed: ${rules(r) || "unverified only"}` : `missed ${r.excluded.slice(6)}`;
      console.log(`   ${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(" ")}  ${why}`);
    }
    if (excluded.length > top) console.log(`   … ${excluded.length - top} more`);
  }
  console.log("");
  process.exit(ranked.length ? 0 : 1);
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
      const res = await buildVerdict(src);
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
      const res = await buildVerdict(src);
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

// ── build ─────────────────────────────────────────────────────────────────────

if (cmd === "build") {
  const t0 = Date.now();
  const res = await buildVerdict(code);
  const wall = Date.now() - t0;

  if (opts.json) {
    console.log(JSON.stringify({
      ok: res.ok,
      error: res.error ?? null,
      passed: res.ok ? res.passed : false,
      elapsedMs: res.elapsedMs,
      wallMs: wall,
      overall: res.overall ?? null,
      parts: (res.parts ?? []).map((p) => ({ name: p.name, bbox: p.bbox, volume: p.volume })),
      problems: res.problems ?? [],
      params: declared,
    }, null, 2));
    process.exit(res.ok ? (res.passed ? 0 : 1) : 2);
  }

  if (!res.ok) {
    console.error(`\n✗ ${basename(file)} did not build\n\n  ${res.error}\n`);
    process.exit(2);
  }

  const o = res.overall;
  console.log(`\n✓ built in ${wall}ms — ${res.parts.length} part(s)`);
  if (o) console.log(`  overall  ${fmt(o.sizeX)} × ${fmt(o.sizeY)} × ${fmt(o.sizeZ)} mm`);
  console.log("");
  for (const p of res.parts) {
    console.log(`   ${p.name.padEnd(18)} ${fmt(p.bbox?.sizeX)} × ${fmt(p.bbox?.sizeY)} × ${fmt(p.bbox?.sizeZ)}`);
  }

  if (!res.problems.length) {
    console.log(`\n  no problems.\n`);
  } else {
    console.log(`\n  ${res.problems.length} problem(s):`);
    for (const p of res.problems) console.log(`   [${p.severity ?? "?"}] ${p.rule}: ${p.message}`);
    console.log("");
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
