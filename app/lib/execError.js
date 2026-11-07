// Where did the model code actually throw? (t25-w3, Notebook aaa9cd2d)
//
// ⭐⭐ THE REPORT: a cold-proof driver hit `Cannot read properties of undefined (reading 0)`
// — no line, no part, no operation — while the verdict text beside it instructs "fix ONLY
// the broken operation". The instruction is right and, on that error class, unfollowable.
// The driver rewrote its placement logic wholesale, which is the expensive thing the
// instruction exists to prevent.
//
// ⭐ THE ATTRIBUTION IS FREE AND WE WERE THROWING IT AWAY. Both build registries execute
// with `new Function("api", `${code}\nreturn main(api);`)`, and V8 stamps every frame of
// the resulting stack with `<anonymous>:LINE:COL` in the GENERATED function's coordinates.
// `new Function` prepends exactly two lines (`function anonymous(api` / `) {`), so
// generated line N is user line N - 2 — a fixed, verifiable offset, not a heuristic.
// Measured, not assumed: scripts/headless/test-execerror.mjs plants a throw on a known
// line and fails if the reported line moves.
//
// ⭐ THE SECOND HALF IS THE ONE A STACK CANNOT GIVE. OCC exceptions arrive as NUMERIC
// pointers out of WASM — no JS stack at all, and those are the cryptic failures that most
// need a location. So the op profiler (app/lib/execProfile.ts), which already wraps every
// geometry call to time it, now also remembers the INNERMOST operation that was in flight
// when an exception passed through it. `during fillet(), call #3` is attribution for the
// error class that has no line number.
//
// LAWS THIS FILE KEEPS:
//   ⛔ It never changes the error MESSAGE — it appends a clause. `mcp/lib/errorCitations.js`
//      matches learned rules by quoted substrings of the message; rewriting the prefix
//      would silently un-cite every rule that fires on a build failure.
//   ⛔ It fails open, always. A location we cannot prove is a location we do not print;
//      attribution must never be able to turn a build failure into a formatting failure.
//   ⚠ Kept dependency-free and type-erasable ON PURPOSE — packages/engine/runner.mjs
//      imports it under Node's type-stripping and app/cadWorker.ts bundles it for the
//      browser, the same arrangement app/lib/obb.ts and app/lib/execProfile.ts use. No
//      enums, no namespaces, no value imports.

/** Two lines: `function anonymous(api` and `) {`. Generated line = user line + 2. */
export const NEW_FUNCTION_LINE_OFFSET = 2;

/** How much of the offending source line to quote. Long enough to identify the call,
 *  short enough that a minified 4,000-character line cannot own the verdict. */
const SOURCE_QUOTE_CAP = 120;

                                
                                                                         
               
                  
                                                                                           
                  
 

/** What the profiler saw in flight when the throw passed through it. */
                           
             
                                                                               
               
 

/**
 * The user-code line a throw came from, or null.
 *
 * Deliberately conservative: it takes the FIRST `<anonymous>:line:col` frame (the deepest,
 * i.e. where the throw happened) and REFUSES any line outside the code's own extent —
 * which is what rejects the appended `return main(api);` trampoline and any frame from a
 * different eval. A wrong line is worse than no line: it sends the fix to the wrong place.
 */
export function locateExecThrow(err         , code        )                       {
  const stack = (err                                          )?.stack;
  if (typeof stack !== "string" || !code) return null;
  // `<anonymous>:7:16`. The `eval at <anonymous> ([eval]:4:13)` prefix Node adds does not
  // match — there `<anonymous>` is followed by a space, not a colon.
  const m = /<anonymous>:(\d+):(\d+)/.exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - NEW_FUNCTION_LINE_OFFSET;
  const column = Number(m[2]);
  const lines = code.split("\n");
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return null;
  const raw = lines[line - 1] ?? "";
  const source = raw.trim().slice(0, SOURCE_QUOTE_CAP);
  return { line, ...(Number.isFinite(column) ? { column } : {}), ...(source ? { source } : {}) };
}

/**
 * The location clause to append to a build error message, or "" when nothing is provable.
 *
 * Shape: ` — at line 47: \`const p = pts[i][0];\` (thrown during fillet(), call #3)`
 */
export function execThrowClause(err         , code        , failedOp                  )         {
  const site = locateExecThrow(err, code);
  const parts           = [];
  if (site) parts.push(`at line ${site.line}${site.source ? `: \`${site.source}\`` : ""}`);
  // The op is worth printing even WITH a line — the line says where, the op says which
  // call on it. And it is the only attribution an OCC pointer throw can ever have.
  if (failedOp?.op) parts.push(`thrown during ${failedOp.op}()${failedOp.call > 0 ? `, call #${failedOp.call}` : ""}`);
  return parts.length ? ` — ${parts.join(" (")}${parts.length > 1 ? ")" : ""}` : "";
}

/**
 * The build error message, with its location appended when one is provable.
 * `message` goes through UNCHANGED as the prefix — see the citation law above.
 */
export function attributeExecError(message        , err         , code        , failedOp                  )         {
  try {
    return `${message}${execThrowClause(err, code, failedOp)}`;
  } catch {
    // Attribution is decoration on top of a failure that is already being reported.
    return message;
  }
}
