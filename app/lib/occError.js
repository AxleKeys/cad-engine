// The ONE exception decode — shared by app/cadWorker.ts, packages/engine/runner.mjs,
// app/lib/interference.ts and app/lib/soundness.ts, for the same reason obb.ts and
// execError.ts are shared: the browser's build verdict and the agent's headless one must
// not be able to describe the same OCC failure differently (t42-kernel §3 F4, §8 K3 P1).
//
// ⭐ WHY THIS EXISTS — TWO REASONS, AND THE FIRST ONE IS LIVE TODAY.
//
// (1) FOUR OF THE SIX THROW SITES NEVER DECODED AT ALL. An OCC C++ throw arrives in JS as a
//     bare NUMBER (a pointer) on replicad-opencascadejs 0.23.0, and the repo had six places
//     that branch on `typeof e === "number"` — but only TWO ran the decode (cadWorker's
//     build catch, runner.mjs's). The other four printed the pointer itself:
//         OCC exception pointer: 8522992
//     at a user, on today's kernel, where the decode was sitting one call away and would
//     have said `OCC: StartSol echec` (baselines/occ-throw-0.23.0.json records both forms
//     from the same throw). The drawings pane, the drawing export, the interference
//     verdict's degrade reason and the soundness coverage finding all reported an address.
//     So this file fixes a 0.23 bug; it is not only a bump prerequisite.
//
// (2) AND THE VALUE TYPE CHANGES UNDER THE BUMP. 0.23 builds OCC with Emscripten's
//     JS-emulated exceptions; 1.0.0 uses NATIVE WASM exceptions, so the same throw arrives
//     as a `WebAssembly.Exception` object. `typeof e === "number"` is then FALSE at all six
//     sites, every branch falls through to `e?.message ?? String(e)`, and an agent receives
//     the string `[object WebAssembly.Exception]` — measured, §3 F4's table. Branching on
//     the THROWN VALUE TYPE is what makes one file correct on both kernels.
//
// ⚠ `oc.getExceptionMessage` THROWS on a plain JS `Error` ("a.getArg is not a function"),
// so it can never be called blindly — hence `isWasmException` gating it, and hence the
// generic path being the fallback of every branch rather than a fourth case.
//
// ⭐ THE WASM BRANCH IS INERT ON 0.23 (nothing arrives as an Exception object there), which
// is exactly why this ships AHEAD of the version pins: it fixes (1) now and is already
// correct for (2) when the pins land. `getStandard_FailureData` still exists on 1.0.0 — it
// is simply never reached, so the numeric branch stays rather than being replaced.
//
// LAWS THIS FILE KEEPS:
//   ⛔ The `OCC: ` prefix is load-bearing — `mcp/lib/errorCitations.js` matches the allocator
//      rule as `/NCollection_IncAllocator|OCC:[\s\S]*out of memory/i`. Decoding a site that
//      used to print a pointer can only ADD citations (no rule matches "exception pointer");
//      changing this prefix would silently remove them.
//   ⛔ It fails DOWN to a less specific message, never up to a prettier one. When the decode
//      is unavailable the pointer form is returned verbatim — `OCC exception pointer: 8522992`
//      at least says "I could not read this", where an invented sentence would not
//      [[feedback_fallback_hides_provenance]].
//   ⚠ Kept dependency-free and type-erasable ON PURPOSE — packages/engine/runner.mjs imports
//      it under Node's type-stripping and app/cadWorker.ts bundles it for the browser, the
//      same arrangement obb.ts, execProfile.ts, execError.ts and degenerate.ts use. No
//      enums, no namespaces, no value imports.
//   ⚠ `WebAssembly.Exception` is NOT in this project's TS lib (DOM, DOM.Iterable, ES2022), so
//      it is reached through `globalThis` rather than through the global type. That is a
//      typing workaround, not a runtime one.

/** The honest last resort: whatever a non-OCC throw says about itself.
 *  An empty `message` falls through to `String(e)` deliberately — the previous inline form
 *  (`e?.message ?? String(e)`) returned the empty string there, i.e. a failure reported with
 *  no text at all. No citation rule can match "", so nothing un-cites by fixing it. */
const plainText = (e         )         => {
  const m = (e                                            )?.message;
  return typeof m === "string" && m.length > 0 ? m : String(e);
};

/**
 * Is this a native WASM exception (1.0.0's OCC throw), rather than an Error or a number?
 *
 * Checked two ways because the second is the one that was actually MEASURED: `instanceof`
 * against the real constructor when the runtime exposes it, and the constructor NAME, which
 * is what `leg-c-fused.mjs` observed on 1.0.0 (`ctor === "Exception"`). A false positive here
 * is survivable and a false negative is not: `getExceptionMessage` throwing is caught below
 * and falls through to `plainText`, whereas a missed Exception object stringifies to the
 * useless `[object WebAssembly.Exception]`.
 */
export function isWasmException(e         )          {
  if (!e || typeof e !== "object") return false;
  const WA = (globalThis                                             ).WebAssembly;
  if (typeof WA?.Exception === "function") {
    try {
      if (e instanceof (WA.Exception                                    )) return true;
    } catch { /* exotic prototype — fall through to the constructor name */ }
  }
  return (e                                       ).constructor?.name === "Exception";
}

/** 0.23's path: the pointer, decoded through the Standard_Failure it addresses. */
function decodeNumeric(e        , oc     )         {
  try {
    const d = oc?.OCJS?.getStandard_FailureData?.(e);
    // ⚠ NOT `?? JSON.stringify(d)`, which the cadWorker site used to carry as its last
    // resort: an embind handle stringifies to `{}`, so that branch produced `OCC: {}` —
    // strictly less informative than the pointer, and unmatchable by any rule.
    const text = d ? (d.GetMessageString?.() ?? d.what?.() ?? d.message ?? null) : null;
    if (typeof text === "string" && text.length > 0) return `OCC: ${text}`;
  } catch { /* the decode itself can throw; the pointer form is still the honest answer */ }
  return `OCC exception pointer: ${e}`;
}

/** 1.0.0's path: `getExceptionMessage(e)` returns `[type, message]`, e.g.
 *  `["StdFail_NotDone", "BRep_API: command not done"]`. Returns null when it cannot read
 *  one, so the caller falls through to `plainText` rather than to an invented string. */
function decodeWasm(e         , oc     )                {
  try {
    const pair = oc?.getExceptionMessage?.(e);
    if (!pair) return null;
    const [type, message] = Array.isArray(pair) ? pair : [pair, null];
    const t = typeof type === "string" ? type.trim() : "";
    const m = typeof message === "string" ? message.trim() : "";
    if (!t && !m) return null;
    return `OCC: ${[t, m].filter(Boolean).join(": ")}`;
  } catch { /* throws on a plain Error, and on anything embind does not recognise */ }
  return null;
}

/**
 * What a caught value SAYS, whatever it turned out to be.
 *
 * @param e  the caught value — a number (0.23 OCC), a WebAssembly.Exception (1.0.0 OCC), an
 *           Error (replicad's own throws and every JS fault), or anything else.
 * @param oc the live OCC module, when the call site has one. WITHOUT it an OCC throw still
 *           returns a legible message, just an undecoded one — so a site that cannot reach
 *           `oc` is degraded, never broken. Use `ocFrom(replicad)` where only the replicad
 *           module object is in scope.
 */
export function occErrorText(e         , oc      )         {
  if (typeof e === "number") return decodeNumeric(e, oc);
  if (isWasmException(e)) return decodeWasm(e, oc) ?? plainText(e);
  return plainText(e);
}

/**
 * The live OCC module out of the replicad module object, or null.
 *
 * Exists so the three cadWorker sites stay one-liners AND so `getOC()` throwing before the
 * kernel is ready can never turn a build failure into a reporting failure — the same
 * fail-open rule execError.ts keeps.
 */
export function ocFrom(replicadModule     )      {
  try { return replicadModule?.getOC?.() ?? null; } catch { return null; }
}
