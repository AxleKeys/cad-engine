import { tokenizer, parse } from "acorn";

/** The identifier evidence the pose guard decides on. `counts` is every executable mention of a
 *  name; `declarations` is how many times the name is BOUND — by a declarator, a function or
 *  catch parameter, a destructure, or a function/class declaration. Comments and literal text
 *  are excluded; template expressions remain code. */
                                                                                                

/** Every identifier a binding pattern BINDS. `const { xT: other } = m` binds `other`, not `xT`,
 *  which is exactly the distinction a key-counting scan gets wrong. */
function patternNames(node         , out          )       {
  if (!node || typeof node !== "object") return;
  const n = node                                               ;
  switch (n.type) {
    case "Identifier": out.push(String(n.name)); return;
    case "ObjectPattern":
      for (const prop of (n.properties             ) ?? []) {
        const p = prop                                               ;
        // `value` for a Property (the BINDING half), `argument` for a RestElement.
        patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      }
      return;
    case "ArrayPattern":
      for (const el of (n.elements             ) ?? []) patternNames(el, out);
      return;
    case "AssignmentPattern": patternNames(n.left, out); return;   // `(xT = 5) => …`
    case "RestElement": patternNames(n.argument, out); return;
    default: return;
  }
}

/** Walk every node of an acorn AST. Generic on purpose: no acorn-walk dependency, and a node
 *  type this file has never heard of is still descended into rather than skipped. */
function walkAst(node         , visit                                                         )       {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) walkAst(child, visit); return; }
  const n = node                           ;
  if (typeof n.type === "string") visit(n                                              );
  for (const key of Object.keys(n)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    walkAst(n[key], visit);
  }
}

/** Count every name the source BINDS, from the parsed program.
 *
 *  ⭐⭐ WHY THE AST AND NOT A TOKEN RULE. The first cut of this counted a name only where it
 *  followed `const`/`let`/`var` directly, and the review of `a4c899c9` showed why that is not
 *  merely "conservative": a function parameter (`const carriage = (xTravel) => …`), a destructure
 *  (`const { xTravel } = m`) and a comma list (`const q = 1, xTravel = 2`) each shadow the
 *  top-level const exactly the way Machine 01 does — dead slider, no rebuild can reach it — and
 *  each came back wearing the benign `used` sentence, which CLAIMS the rebuild is correct. A
 *  wrong reassurance is worse than no reason at all. The parser sees every binding form there is.
 *
 *  Returns null when the source does not parse as a program; the caller then falls back to the
 *  token rule, which can still see a plain `const` redeclaration. */
function declarationCountsFromAst(code        )                             {
  let ast         ;
  try {
    ast = parse(code, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch {
    return null;
  }
  const declarations = new Map                ();
  const bind = (names          ) => { for (const nm of names) declarations.set(nm, (declarations.get(nm) ?? 0) + 1); };
  walkAst(ast, (n) => {
    const names           = [];
    switch (n.type) {
      case "VariableDeclarator": patternNames(n.id, names); break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // The function's own name binds too (`function xTravel() {}` shadows just as well).
        if (n.type === "FunctionDeclaration") patternNames(n.id, names);
        for (const p of (n.params             ) ?? []) patternNames(p, names);
        break;
      case "ClassDeclaration": patternNames(n.id, names); break;
      case "CatchClause": patternNames(n.param, names); break;
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ImportSpecifier": patternNames(n.local, names); break;
      default: return;
    }
    bind(names);
  });
  return declarations;
}

/** Scan a model's source for identifier evidence. Returns null when the source cannot be read,
 *  or when it evaluates code dynamically — neither can prove geometry invariance, so callers
 *  must keep the rebuild path.
 *
 *  ⚠ `counts` IS THE GUARD'S INPUT AND IS COMPUTED EXACTLY AS IT ALWAYS WAS — one tokenizer
 *  pass, same `eval`/`Function` bail-out. The AST is consulted only for `declarations`, which
 *  decides WORDING, never the grant. A parse failure therefore cannot change a decision. */
export function scanCodeIdentifiers(code        )                        {
  const counts = new Map                ();
  const fallbackDeclarations = new Map                ();
  try {
    let binder = false; // the previous token was `const` / `let` / `var`
    for (const token of tokenizer(code, { ecmaVersion: "latest", allowAwaitOutsideFunction: true })) {
      const label = token.type.label;
      if (label !== "name") {
        // `const` and `var` are keyword tokens; `let` is contextual and arrives as a name.
        binder = label === "const" || label === "var";
        continue;
      }
      const name = String((token                                     ).value);
      if (name === "eval" || name === "Function") return null;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (binder) fallbackDeclarations.set(name, (fallbackDeclarations.get(name) ?? 0) + 1);
      binder = name === "let";
    }
    return { counts, declarations: declarationCountsFromAst(code) ?? fallbackDeclarations };
  } catch {
    return null;
  }
}

/** Count executable identifier tokens, excluding comments and literal text.
 * Template expressions remain code. An unreadable source or dynamic evaluation
 * cannot prove geometry invariance, so callers must keep the rebuild path. */
export function codeIdentifierCounts(code        )                             {
  return scanCodeIdentifiers(code)?.counts ?? null;
}

// ══ WHY A `pose:` TAG WAS REFUSED — ONE REASON, ONE PLACE ════════════════════════════════════
//
// ⭐⭐ THE DECISION IS NOT MADE HERE AND DOES NOT CHANGE. `pose` is granted when, and only when,
// the tagged const is mentioned EXACTLY ONCE in readable code — its own declaration. Three
// parsers apply that rule (app/lib/codeParams.ts, mcp/lib/paramSchema.js, mcp/lib/drawingData.js)
// and all three used to DROP a refused tag in silence: the parameter came back `global` with
// nothing anywhere saying the author had asked for a joint.
//
// ⚠⚠ AND THE REFUSALS ARE NOT ONE FAILURE. `redeclared` — the name is BOUND a second time, by
// any binding form there is — is the Machine 01 trap (verified live 2026-10-22): the rebuild
// rewrites a top-level const that the shadowing scope never reads, so the slider moves the saved
// value and the geometry never changes. `used` is the milder case the pack describes. `unreadable`
// and `unreferenced` are the two states where the guard could not look at all. The reason, not
// just the refusal, is what tells an author which repair they owe.
                                                                                      

/** Why `pose:<joint>` was refused for a const. `count` is the identifier count that caused it
 *  (0 when the source could not be read, or when the const is not live code at all). */
                                                                                      

/** The refusal for a tagged const, or null when the tag is GRANTED. `scan` is
 *  `scanCodeIdentifiers(code)` — null means the source was unreadable, which is itself a
 *  refusal with a reason rather than a silent drop. */
export function poseRefusal(scan                       , name        , joint        )                     {
  if (!scan) return { joint, reason: "unreadable", count: 0 };
  const count = scan.counts.get(name) ?? 0;
  if (count === 1) return null;
  // ⚠ ZERO MENTIONS IS NOT A USE. The annotation regex matches inside a comment, so a
  // commented-out const still arrives here; accusing it of being "read by the geometry math
  // (0 mentions)" is a false statement in the verdict (review of a4c899c9, LOW 1).
  if (count === 0) return { joint, reason: "unreferenced", count };
  // A second BINDING means an inner scope shadows the parameter, so no rebuild can reach the
  // geometry either. Checked first: it is the strictly worse diagnosis, and the AST sees every
  // binding form — parameters and destructures included.
  const reason                    = (scan.declarations.get(name) ?? 0) > 1 ? "redeclared" : "used";
  return { joint, reason, count };
}

/** ⭐ THE ONE WORDING, shared by every door that reports a refusal — `get_parameters`, the
 *  build verdict's `param.pose-refused` line, and anything added later. A second wording is how
 *  two surfaces come to describe one model differently. */
export function poseRefusalSentence(name        , refusal             )         {
  const lead = `pose:${refusal.joint} was refused on \`${name}\``;
  if (refusal.reason === "redeclared") {
    return `${lead}: \`${name}\` is bound again inside the code (${refusal.count} mentions), so an inner scope — another declaration, a function parameter or a destructure — shadows the parameter. Editing it rebuilds the model and moves nothing. Read the top-level const directly in those blocks, or rename the inner binding.`;
  }
  if (refusal.reason === "unreadable") {
    return `${lead}: the code could not be read for identifier use (it fails to parse, or it calls eval/Function), so the pose guard cannot prove the const only names the joint. The parameter stays a full rebuild until the code parses cleanly.`;
  }
  if (refusal.reason === "unreferenced") {
    return `${lead}: \`${name}\` does not appear in executable code at all — the annotation was found inside a comment or a string, so there is no const for the slider to drive. Declare it as a real top-level const if it is meant to be a parameter.`;
  }
  // ⚠ NO CLAIM OF CORRECTNESS HERE (review of a4c899c9, MEDIUM). `used` means only that the name
  // appears more than once and no second BINDING was visible. The rebuild is correct *if* those
  // mentions are genuine reads of this const; if one of them is a binding the parser could not
  // see, the slider is dead. Say what is known and name the thing to check.
  return `${lead}: \`${name}\` appears ${refusal.count} times, so the guard cannot prove the const only names the joint. If those are genuine reads in the geometry math, the parameter stays a full rebuild — build the part at rest and let the joint carry the motion to get the fast path. If any of them is a second binding of the same name, the rebuild cannot reach the geometry either and the slider will move nothing: check for a redeclaration, a function parameter or a destructure named \`${name}\`.`;
}
