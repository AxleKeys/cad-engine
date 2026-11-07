// Static lint for pushed model code — Class B of verdicts-not-recipes (t1-verdicts P2).
//
// These are the Non-Negotiables and Final Self-Check items the skill pack TEACHES as
// prose: rules about the SHAPE of the code that Axle can decide on the artifact
// itself. Running them at push time and returning violations in the build verdict
// turns "remember to check X" into a result the agent cannot skip. The pack keeps
// teaching each rule until its check ships here (ship the check BEFORE deleting the
// prose); post-build geometry rules (empty/degenerate/overlap) stay in the validator
// and the geometry service — this file is code-shape only, no execution.
//
// Design constraints: deterministic, cheap (pure string analysis), and biased hard
// toward ZERO false positives — a noisy lint teaches agents to ignore warnings,
// which is worse than no lint. Nearly every rule here fires only on something that
// is wrong by construction. Runs in the Workers runtime: keep top-level side-effect-free.
//
// ⚠ ONE RULE IS A JUDGMENT, NOT A CORRECTNESS CHECK: `too_many_parameters`
// (t1-paramrestraint, 2026-08-01). Code with 30 sliders is not *wrong* — it is bad
// for the person who has to use it, and it exists because THIS FILE ASKED FOR IT.
// `no_parameters` and `magic_numbers` were the only two rules touching parameter
// count and both pushed the same way, so the lint was a one-way ratchet: a model
// arrived with thirty controls of which three were real, and nothing anywhere ever
// said "that is too many". A rule that only ever pushes one direction isn't a
// standard, it's a slope. The counter-pressure makes the pair a BAND (1..8), and it
// is a lint rather than pack prose on purpose — Axle can COUNT parameters, so it
// must JUDGE them; a rule an agent MAY follow is one it WILL skip
// (context/verdicts-not-recipes-plan.md).
//
// The threshold is measured, not guessed: all 8 hand-authored fixtures in
// evals/golden/ carry 3–8 annotated params (base-cabinet sits EXACTLY on 8), so >8
// is zero false positives against our own references. ⚠ There is NO headroom below
// that — the golden histogram is 3,4,5,5,5,5,5,8, so dropping MAX_PARAMS to 5 trips
// base-cabinet and dropping it to 4 trips SIX of the eight. Re-run
// `npm run test:staticlint` before touching the number; a golden that trips the rule
// means the THRESHOLD is wrong, not the golden.

// Blank out comments and string literals so structural checks (brace balance,
// identifier references) can't be fooled by content. Quotes are kept as empty
// pairs so string-position stays roughly intact. Regex literals are not handled —
// generated model code doesn't use them, and a miss only risks a skipped check.
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++;
      out += q + q;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ⭐ THE POSE REFUSAL IS NOT RE-DERIVED HERE. `parseCodeParams` is the app-side parameter
// parser this file already mirrors, and `poseRefusalSentence` is the ONE wording every door
// prints — `get_parameters` says the same words about the same model (lane 4, Notebook
// d8a33775). A second copy of either is how two surfaces come to disagree
// [[feedback_three_registries]].
// ⚠ THE REFUSAL IS READ FROM `app/lib`, NOT FROM `mcp/lib/paramSchema.js`, AND THAT IS THE
// MOAT. This file ships inside the public cad-engine, whose allowlist is `packages/engine`,
// `app/lib` and this file by name (scripts/export-cad-engine.mjs); `mcp/lib/paramSchema.js`
// is not in it, so importing it refused the whole export. Both parsers attach the SAME
// `poseRefused`, computed once in `poseRefusal()` — so the public engine prints the same
// verdict as axlekeys.com while the worker-side schema reader stays private. Keep this read
// on the app side.
import { parseCodeParams } from "../../app/lib/codeParams.js";
import { poseRefusalSentence } from "../../app/lib/codeIdentifiers.js";

// The parameter grammar — mirror of app/lib/codeParams.ts parseCodeParams (keep in sync).
// The `// [min:max]` annotation IS the switch: with it the const is a user-facing
// control in both parsers, without it the const is an ordinary named dimension. That
// separation already existed in the code; it was only ever missing from the WORDS.
const PARAM_RE = /const\s+(\w+)\s*=\s*(-?[\d.]+)\s*;\s*\/\/[^[\n]*\[(-?[\d.]+):(-?[\d.]+)\]/g;

// Above this many annotated params, warn. Measured against evals/golden/ — see the
// header. Changing it is a threshold change: re-run the golden canary first.
const MAX_PARAMS = 8;
// How many param names a warning lists before it summarises the tail.
const NAME_CAP = 12;
// How many per-param `bad_param_range` findings may stand on their own, per failure mode,
// before they roll up into one. Deliberately low: two or three range typos read best as
// separate lines, and beyond that the list stops being a list of problems and becomes one
// problem repeated. See the rollup below.
const BAD_RANGE_CAP = 3;

// Primitive constructors whose arguments should be driven by named parameters.
const PRIMITIVE_FNS = /\b(makeBaseBox|makeCylinder|makeSphere|drawRoundedRectangle|drawRectangle|drawCircle|drawEllipse)\s*\(([^()]*)\)/g;

// Body names that say nothing. Anchored to the WHOLE literal — "ProbeBody" or
// "Side Panel" never fire; exactly "Part1"/"Body 2"/"Shape" do. Bare "Body" is
// tolerated (established CAD idiom for a single-body model — the goldens use it);
// a NUMBERED Body/Model is still lazy enumeration and fires.
const GENERIC_NAME_RE = /name\s*:\s*(["'`])(?:(?:Part|Shape|Solid|Object|Item|Piece|Untitled)\s*\d*|(?:Body|Model)\s*\d+)\1/gi;

// ── The param_schema argument, and why counting it would be a LIE (t25-w3) ───
//
// Notebook 47db9a23, from a cold-proof driver: it supplied `push_model_code`'s
// `param_schema` and STILL got `no_parameters` ("nothing here is adjustable"). It read
// that as the validator ignoring an argument it was given — reasonably, since
// `lintModelCode(code)` took the code string and nothing else, so there was no parameter
// through which a supplied schema could even reach the rule.
//
// ⭐⭐ THE OBVIOUS FIX IS THE WRONG ONE, AND THE CODE SETTLES IT. The board offered two
// options — count the supplied schema, or say annotations are all the lint reads. Counting
// it was checked against `app/lib/paramPresentation.ts` and it is REFUTED: the resolver
// `resolveParamPresentation()` maps over the CODE's annotated params and joins schema rows
// onto them; a row matching no annotated const is dropped, and `unmatchedSchemaRows()`
// exists precisely to surface those as DRIFT with a Fix button in the Create menu. So a
// schema row without an annotation is not a control, in Studio or in the configurator.
// Counting it would have made the lint report an adjustable model that nobody can adjust —
// the silent-partial-success class W1 exists to close, introduced deliberately.
//
// ⭐ SO THE RULE STANDS AND THE MESSAGE CHANGES. What the driver was actually missing is
// the RELATIONSHIP between the two mechanisms: the annotation DECLARES a control, the
// schema DECORATES one. Knowing a schema was supplied is exactly what lets the warning say
// that instead of repeating a generic nudge at someone who believes they already complied.
const schemaRowCount = (paramSchema) => {
  if (Array.isArray(paramSchema)) return paramSchema.length;
  // The rich dialect nests them; `parameters` is the only shape either parser reads.
  if (paramSchema && Array.isArray(paramSchema.parameters)) return paramSchema.parameters.length;
  return 0;
};

const schemaRowNames = (paramSchema, cap = 8) => {
  const rows = Array.isArray(paramSchema) ? paramSchema : (paramSchema?.parameters ?? []);
  const names = rows.map((r) => r?.id ?? r?.name).filter((n) => typeof n === "string" && n);
  const shown = names.slice(0, cap).join(", ");
  return names.length > cap ? `${shown}, +${names.length - cap} more` : shown;
};

/**
 * Lint model code. Returns [{rule, severity, message}] in the build-record
 * warnings[] shape. Empty array = clean. Never throws.
 *
 * `opts.paramSchema` — the schema the SAME write supplied, when it supplied one. It never
 * satisfies a rule (see above); it only lets `no_parameters` explain itself to a caller who
 * has already tried the other mechanism.
 */
export function lintModelCode(code, opts = {}) {
  const src = String(code ?? "");
  const suppliedSchemaRows = schemaRowCount(opts?.paramSchema);
  const findings = [];
  const push = (rule, severity, message) => findings.push({ rule, severity, message });
  if (!src.trim()) return findings; // "missing code" is the endpoint's 400, not a lint

  const stripped = stripCommentsAndStrings(src);

  // ── main defined, api-only signature ─────────────────────────────────────
  const mainSig = src.match(/(?:const|let|var)\s+main\s*=\s*(?:async\s*)?\(([^)]*)\)|function\s+main\s*\(([^)]*)\)/);
  if (!mainSig) {
    push("main_missing", "error", "No `main` found — the model must define `const main = (api) => { … }`.");
  } else {
    // Count TOP-LEVEL arguments only: `({ makeBaseBox, makeCylinder })` is ONE
    // destructured api arg (the recommended style), not several.
    const sigStr = (mainSig[1] ?? mainSig[2] ?? "").replace(/\{[^}]*\}/g, "api").replace(/\[[^\]]*\]/g, "api");
    const args = sigStr.split(",").map((s) => s.trim()).filter(Boolean);
    if (args.length > 1) {
      push("params_argument", "warning", `main takes ${args.length} arguments — \`api\` is the ONLY argument. Parameters are top-level annotated consts (\`const width = 800; // [400:1600]\`), never a params object.`);
    }
  }

  // ── no global replicad ────────────────────────────────────────────────────
  if (/\breplicad\s*[.[]/.test(stripped)) {
    push("global_replicad", "error", "Code references a global `replicad` — there is none in the worker. Destructure every helper from main's `api` argument.");
  }

  // ── truncated / incomplete code ───────────────────────────────────────────
  if (/…/.test(src) || /\/\/\s*\.{3}\s*(rest|more|remaining|etc|continue)/i.test(src)) {
    push("code_truncated", "error", "Code contains an ellipsis placeholder — it looks incomplete. Push the FULL code: a partial push overwrites the model with a fragment.");
  } else {
    for (const [open, close, label] of [["{", "}", "braces"], ["(", ")", "parentheses"], ["[", "]", "brackets"]]) {
      const opens = stripped.split(open).length - 1;
      const closes = stripped.split(close).length - 1;
      if (opens !== closes) {
        push("code_truncated", "error", `Unbalanced ${label} (${opens} open vs ${closes} close) — the code looks truncated or malformed.`);
        break;
      }
    }
  }

  // ── parameters: present, restrained, sane ranges ──────────────────────────
  // The two ends of the band. Both messages keep "named const" and "user-facing
  // control" as SEPARATE ideas — fusing them into one sentence is what built the
  // ratchet, because it made annotating every const sound like the goal.
  const params = [...src.matchAll(PARAM_RE)];
  if (!params.length) {
    push("no_parameters", "warning", suppliedSchemaRows
      // The caller DID try — telling it "give them a range comment" as if it had done
      // nothing is what made this read like an ignored argument (t25-w3 / 47db9a23).
      ? `No annotated parameters — and the param_schema you supplied (${suppliedSchemaRows} row(s)${schemaRowNames(opts.paramSchema) ? `: ${schemaRowNames(opts.paramSchema)}` : ""}) does not create any. The two are not alternatives: the code's \`// [min:max]\` annotation DECLARES a control, the schema DECORATES one (label, group, unit, buyer visibility). Studio resolves the control list from the annotated consts and drops schema rows that match none — they render as drift to be fixed, never as sliders. Annotate the consts you want adjustable (\`const width = 800; // [400:1600]\`) and your schema rows will attach to them by name; consts fixed by the shop or the material stay plain.`
      : "No annotated parameters — nothing here is adjustable, so the model is a one-off. Give the few dimensions a person would actually turn a range comment (`const width = 800; // [400:1600]`); the ones that are fixed by the shop or the material stay plain consts.");
  } else if (params.length > MAX_PARAMS) {
    // Name them — the fix is to pick which annotations to remove, so a bare count
    // is not actionable. Capped so a 40-param model can't dominate the verdict.
    const names = params.map((m) => m[1]);
    const shown = names.slice(0, NAME_CAP).join(", ");
    const rest = names.length - NAME_CAP;
    push("too_many_parameters", "warning", `${params.length} annotated parameters — every one is a slider in the user's face, and past ~${MAX_PARAMS} most are values nobody turns (a 1.5mm reveal, a foot inset). This does NOT mean hard-code them: drop the \`// [min:max]\` annotation and KEEP the const. \`const frontReveal = 3;\` is still a named, parametric dimension — the geometry derives from it exactly as before, it just stops being a knob. Keep ranges on the handful a person would really adjust (usually overall width/height/depth, material thickness, a count or two); unannotate the rest. Annotated now: ${shown}${rest > 0 ? `, +${rest} more` : ""}.`);
  }
  // ⚠ CAPPED, per failure mode (t6-agentloop closing sweep). This loop used to emit ONE
  // finding per offending param, so a 30-param model with a systematic mistake — min and
  // max annotated in the wrong order throughout, say — produced 30 near-identical warnings
  // and buried every other verdict line under them. Same per-item-no-rollup shape P3 capped
  // for the per-part geometry list, found in the same place for the same reason: the third
  // enumeration nobody was looking at [[feedback_enumeration_blindspot]].
  //
  // The two kinds are capped SEPARATELY and never merged, because they have different
  // fixes (swap the two numbers vs move the default), and a rollup that loses the fix is
  // just a shorter way of being unhelpful. Under the cap the output is byte-identical to
  // before, in SOURCE order — the common case is one or two typos and a rollup would make
  // that harder to read, not easier.
  const bad = [];
  for (const m of params) {
    const [, name, val, min, max] = m;
    const v = parseFloat(val);
    const lo = parseFloat(min);
    const hi = parseFloat(max);
    if (lo > hi) bad.push({ kind: "inverted", name, v, lo, hi });
    else if (v < lo || v > hi) bad.push({ kind: "outside", name, v, lo, hi });
  }
  if (bad.length) {
    const inverted = bad.filter((b) => b.kind === "inverted");
    const outside = bad.filter((b) => b.kind === "outside");
    const rollInverted = inverted.length > BAD_RANGE_CAP;
    const rollOutside = outside.length > BAD_RANGE_CAP;
    // Only the kind that is actually over the cap gets rolled up; the other keeps its
    // per-param lines, still interleaved in the order they appear in the code.
    for (const b of bad) {
      if (b.kind === "inverted" && rollInverted) continue;
      if (b.kind === "outside" && rollOutside) continue;
      if (b.kind === "inverted") push("bad_param_range", "warning", `Parameter '${b.name}' has an inverted range [${b.lo}:${b.hi}] — min must be ≤ max.`);
      else push("bad_param_range", "warning", `Parameter '${b.name}' default ${b.v} is outside its own range [${b.lo}:${b.hi}].`);
    }
    // The rollups NAME the offenders (the fix is per-param, so a bare count is not
    // actionable) and DECLARE the truncation when the list itself is capped — a cut list
    // that doesn't say it was cut is the silent-truncation twin of a silent failure.
    const nameList = (items) => {
      const shown = items.slice(0, NAME_CAP).map((i) => i.name).join(", ");
      const rest = items.length - NAME_CAP;
      return rest > 0 ? `${shown}, +${rest} more (showing the first ${NAME_CAP} of ${items.length})` : shown;
    };
    if (rollInverted) {
      push("bad_param_range", "warning", `${inverted.length} parameters have an INVERTED range — min is greater than max. The annotation reads \`// [min:max]\`, low bound first, so each of these needs its two numbers swapped. ${inverted.length === params.length ? "That is EVERY annotated parameter, which usually means the order was misread once and repeated rather than mistyped separately. " : ""}Inverted: ${nameList(inverted)}.`);
    }
    if (rollOutside) {
      push("bad_param_range", "warning", `${outside.length} parameters have a default OUTSIDE their own range — the model as pushed cannot be reproduced by anyone moving the slider, because its starting value isn't reachable. Either widen the range to include the default or move the default inside it. Affected: ${nameList(outside)}.`);
    }
  }

  // ── a `pose:` tag the guard REFUSED ───────────────────────────────────────
  // ⚠⚠ THIS USED TO BE SILENT, and the silence is the defect. `pose:<joint>` is granted only
  // when the const is mentioned exactly once; a refused tag was dropped and the parameter came
  // back `global` with nothing saying the author had asked for a joint. Worse, the two refusals
  // are not the same failure: a const the geometry READS rebuilds slowly but correctly, while a
  // const an inner scope REDECLARES cannot be reached by a rebuild at all — the slider moves the
  // saved value and the model never changes (the Machine 01 trap, verified live 2026-10-22).
  // Never an error: the model builds, and the author may have meant the rebuild.
  // ⚠ `unreferenced` is EXCLUDED: that const is not live code (the annotation regex matches
  // inside a comment), so there is no build to warn about. `get_parameters` still reports it,
  // where the question being asked is "what are this model's parameters?".
  // One line per NAME, first declaration wins: `parseCodeParams` returns an entry per
  // annotated declaration, and a name annotated twice is still one parameter to the app.
  const poseRefusals = [];
  const refusedSeen = new Set();
  for (const p of parseCodeParams(src)) {
    if (!p.poseRefused || p.poseRefused.reason === "unreferenced") continue;
    if (refusedSeen.has(p.name)) continue;
    refusedSeen.add(p.name);
    poseRefusals.push([p.name, p.poseRefused]);
  }
  for (const [name, refusal] of poseRefusals.slice(0, NAME_CAP)) {
    push("param.pose-refused", "warning", poseRefusalSentence(name, refusal));
  }
  if (poseRefusals.length > NAME_CAP) {
    push("param.pose-refused", "warning", `${poseRefusals.length} pose tags were refused in total; the first ${NAME_CAP} are listed above. The rest: ${poseRefusals.slice(NAME_CAP).map(([n]) => n).join(", ")}.`);
  }

  // ── generic body names ────────────────────────────────────────────────────
  for (const m of src.matchAll(GENERIC_NAME_RE)) {
    push("generic_body_name", "warning", `Body name ${m[0].replace(/^name\s*:\s*/i, "")} says nothing — name parts for what they ARE ('Side Panel Left', 'Seat Slat'), the names surface in the parts tree, BOM, and drawings.`);
  }

  // ── operations that are wrong by construction ─────────────────────────────
  if (/\.rotate\(\s*\)/.test(stripped)) {
    push("rotate_no_args", "error", ".rotate() called with no arguments — it needs (angleDeg, [pivot], [axis]); an empty rotate does nothing silently.");
  }
  if (/\.extrude\(\s*\)/.test(stripped)) {
    push("extrude_no_args", "error", ".extrude() called with no distance — extrude requires an explicit distance.");
  }

  // ── fully hard-coded primitives ───────────────────────────────────────────
  // Fires only when EVERY argument is a bare numeric literal and at least one is
  // ≥10mm — a real dimension nobody can adjust. Mixed args (width, 10, t) pass.
  for (const m of stripped.matchAll(PRIMITIVE_FNS)) {
    const argsStr = m[2].trim();
    if (!argsStr) continue;
    const args = argsStr.split(",").map((s) => s.trim());
    if (args.length && args.every((a) => /^-?[\d.]+$/.test(a)) && args.some((a) => Math.abs(parseFloat(a)) >= 10)) {
      push("magic_numbers", "warning", `${m[1]}(${argsStr}) is built entirely from inline numbers — give each dimension a name (\`const sideThickness = 19;\`) and derive the call from those, so the model reads as parameters instead of literals. Naming is not exposing: a const only becomes a user-facing slider once you add a \`// [min:max]\` range, so this costs you nothing in the parameter menu.`);
    }
  }

  return findings;
}

/**
 * The lint findings AS THEY RIDE A BUILD VERDICT — the one composition, shared by the hosted
 * push verdict (worker/index.js serverSideBuild) and the local engine's report door
 * (packages/engine/report.mjs). `findings` is lintModelCode()'s output for the code that was
 * built; `built` is whether that build succeeded.
 *
 *   built: false  every finding at full strength. On a failed build the lint usually NAMES the
 *                 cause hiding behind a cryptic runtime error (truncated code, a global
 *                 `replicad`), so nothing is softened.
 *   built: true   two rules contradict the build that just succeeded, and are humility cases:
 *                 `main_missing` is definitionally false (the code ran, so there was a main) and
 *                 is DROPPED; `code_truncated` can only be the comment/string stripper misreading
 *                 the source, so it is DOWNGRADED to a warning. Every other finding passes through
 *                 untouched, so an error such as `global_replicad` or `extrude_no_args` still
 *                 fails the model under S9's gate law.
 *
 * ⭐ WHY THIS IS A FUNCTION (t31-kitchen, local-engine-plan §6l). Until 2026-09-24 the transform
 * was typed inline in the worker, beside the build record it wrote. The local engine then needed
 * the same composition to print the same verdict, and a second inline copy is how two surfaces
 * come to disagree about one model (guard S27's law, applied to a composition rather than a rule).
 * Returns a new array; never mutates `findings`.
 */
export function lintForVerdict(findings, { built } = {}) {
  const list = Array.isArray(findings) ? findings : [];
  if (!built) return list.slice();
  return list
    .filter((w) => w.rule !== "main_missing")
    .map((w) => (w.rule === "code_truncated" ? { ...w, severity: "warning" } : w));
}
