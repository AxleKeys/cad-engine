// ── t8-7: the exec op-profiler ───────────────────────────────────────────────
//
// t8-0 made the phase split visible (exec · mesh · edges) and exec turned out to
// be ~90% of a build. This makes the NEXT level visible: which OCC operations
// exec is actually spending itself on. On the Dog House that answer was "13 fuse
// calls in one part" — a fact no amount of staring at `execMs 5192` could give.
//
// ⚠ It profiles by PATCHING PROTOTYPES, because that is the only place the cost
// lives. `shape.fuse(other)` is a method on replicad's Shape3D prototype, not an
// entry in buildApi, so wrapping the api object alone would report ~5% of exec
// and confidently miss the other 95%. Patching is therefore not an implementation
// detail to be tidied away later — it is the measurement.
//
// Three properties make it safe to run on every build:
//   • Scoped — `restore()` puts every patched method back, and every caller runs
//     it in a `finally`. Nothing survives one exec.
//   • Fail-open — any error while installing degrades to the UNPROFILED api and
//     a null report. A profiler must never be able to fail a build.
//   • Synchronous — exec is `new Function(...)(api)` with no await at any of the
//     five call sites, so patch → run → restore can never interleave with
//     another build, even inside the worker's async message handler.
//
// Cost: two performance.now() calls and a Map lookup per operation, ~0.2µs. A
// build that makes 100k api calls pays ~20ms; the Dog House pays under 0.1ms.
//
// Kept dependency-free ON PURPOSE — scripts/headless/runner.mjs imports this
// file directly under Node's type-stripping, which only works while every import
// here is type-only (see app/lib/obb.ts, the same arrangement).

// ⚠ TYPE-ONLY, which is what keeps the "dependency-free" property above true: it erases
// completely, so Node's type-stripping and the worker bundle still see a file with no
// imports. Never make this a value import.
                                            

// Methods worth timing. Everything here is either a boolean (the usual answer),
// a topology-changing feature, or a transform cheap enough that seeing it at the
// TOP of a profile is itself the finding.
const PROFILED_METHODS = new Set([
  // booleans — the cost, almost always
  "fuse", "cut", "intersect",
  // features
  "fillet", "chamfer", "shell", "hollow", "offset", "simplify",
  // sketch → solid
  "extrude", "revolve", "sweep", "loft", "twistExtrude", "complexExtrude", "genericSweep",
  // transforms + copies
  "rotate", "translate", "scale", "mirror", "clone",
  // tessellation (normally outside exec — if it shows up here, model code called it)
  "mesh", "meshEdges",
  // 2D
  "fuse2D", "cut2D", "intersect2D",
]);

                         
             
                
                                                                                       
                 
                                                             
                  
 

                            
                                                                                   
                     
                
 

                                   

/**
 * Wrap `api` so every operation it can reach is timed.
 *
 * Returns the wrapped api, a `report()` that snapshots the profile, and a
 * `restore()` that MUST be called in a finally — it un-patches every prototype
 * touched. On any failure it returns the original api and a null report, so a
 * caller never has to branch on whether profiling worked.
 */
export function profileApi(api     )   
           
                                 
                      
                                                                                     
                                                                 
                                  
  {
  const stats = new Map                                                            ();
  const stack          = [];
  const patchedProtos = new Set        ();
  const restores                    = [];
  let installed = false;
  // The innermost profiled op an exception escaped through, if any (t25-w3).
  let failedOp                  = null;

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const record = (op        , elapsed        , childMs        ) => {
    let s = stats.get(op);
    if (!s) { s = { calls: 0, selfMs: 0, totalMs: 0 }; stats.set(op, s); }
    s.calls += 1;
    s.selfMs += elapsed - childMs;
    s.totalMs += elapsed;
  };

  // Every profiled call runs through here: push a frame, time it, charge the
  // elapsed time to the PARENT's childMs so an outer op reports self time only.
  //
  // ⭐ t25-w3 (Notebook aaa9cd2d): it also NAMES THE OPERATION A THROW CAME OUT OF.
  // This wrapper is already around every geometry call — it is the only place in the
  // system that knows an exception passed through `fillet` rather than `cut`. The
  // INNERMOST frame wins because it throws first and `failedOp` is written once, and
  // that is the attribution an OCC failure can have at all: those arrive as numeric
  // pointers out of WASM with no JS stack, so no line number exists to find.
  const timed = (op        , invoke           )      => {
    const frame        = { childMs: 0 };
    stack.push(frame);
    const t0 = now();
    try {
      return invoke();
    } catch (e) {
      // `calls` is incremented in the finally below, so this call is the one after it.
      if (!failedOp) failedOp = { op, call: (stats.get(op)?.calls ?? 0) + 1 };
      throw e;
    } finally {
      const elapsed = now() - t0;
      stack.pop();
      record(op, elapsed, frame.childMs);
      const parent = stack[stack.length - 1];
      if (parent) parent.childMs += elapsed;
    }
  };

  // A returned shape carries the methods that actually cost — patch its
  // prototype chain the first time we see it. Shapes, Sketchers, Sketches and
  // Drawings each have their own chain, and a chain is only ever patched once.
  const observe = (value     ) => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return value;
    try {
      let proto = Object.getPrototypeOf(value);
      while (proto && proto !== Object.prototype && proto !== Function.prototype) {
        if (!patchedProtos.has(proto)) {
          patchedProtos.add(proto);
          patchProto(proto);
        }
        proto = Object.getPrototypeOf(proto);
      }
    } catch { /* exotic object — not profiling it is fine, breaking the build is not */ }
    return value;
  };

  const patchProto = (proto        ) => {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (!PROFILED_METHODS.has(key)) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (!desc || typeof desc.value !== "function" || !desc.configurable) continue;
      const original = desc.value;
      const patched = function (           ...args       ) {
        return observe(timed(key, () => original.apply(this, args)));
      };
      try {
        Object.defineProperty(proto, key, { ...desc, value: patched });
        restores.push(() => { try { Object.defineProperty(proto, key, desc); } catch { /* gone */ } });
      } catch { /* frozen prototype — skip it, don't fail */ }
    }
  };

  // api entries are plain module functions, EXCEPT Sketcher which is called with
  // `new`. A construct-aware wrapper covers both without the caller caring.
  const wrapApiFn = (name        , fn          )           => {
    const wrapper = function (           ...args       ) {
      return new.target
        ? observe(timed(name, () => Reflect.construct(fn       , args, new.target)))
        : observe(timed(name, () => fn.apply(this, args)));
    };
    try {
      Object.defineProperty(wrapper, "name", { value: name });
      if ((fn       ).prototype) wrapper.prototype = (fn       ).prototype;
      Object.setPrototypeOf(wrapper, fn);   // keeps statics (e.g. Sketcher.foo) reachable
    } catch { /* cosmetic */ }
    return wrapper;
  };

  let wrapped = api;
  try {
    wrapped = {};
    for (const key of Object.keys(api)) {
      const v = api[key];
      wrapped[key] = typeof v === "function" ? wrapApiFn(key, v) : v;
    }
    installed = true;
  } catch {
    wrapped = api;   // fail-open: an unprofiled build beats no build
  }

  const restore = () => {
    for (const undo of restores.splice(0).reverse()) undo();
    patchedProtos.clear();
  };

  const report = ()                   => {
    if (!installed) return null;
    try {
      const ops = [...stats.entries()]
        .map(([op, s]) => ({ op, calls: s.calls, selfMs: Math.round(s.selfMs), totalMs: Math.round(s.totalMs) }))
        .filter((o) => o.selfMs > 0 || o.calls > 0)
        .sort((a, b) => b.selfMs - a.selfMs);
      const measuredMs = Math.round([...stats.values()].reduce((n, s) => n + s.selfMs, 0));
      return { measuredMs, ops };
    } catch { return null; }
  };

  // ⚠ A GETTER, not a value: it is read in the catch AFTER exec, so a snapshot taken
  // here (when nothing has thrown yet) would always be null.
  return { api: wrapped, report, restore, failedOp: () => failedOp };
}

/**
 * Bound the profile for STORAGE. A build record rides in KV and in every verdict
 * an agent reads, so a model with forty distinct operations must not spend forty
 * entries saying so. The tail is rolled into one `other` row — stated, never
 * silently dropped, which is the same rule the part-list cap follows.
 */
export function compactProfile(p                              , max = 8)                   {
  if (!p?.ops?.length) return null;
  if (p.ops.length <= max) return p;
  const head = p.ops.slice(0, max);
  const tail = p.ops.slice(max);
  return {
    measuredMs: p.measuredMs,
    ops: [...head, {
      op: `${tail.length} other op(s)`,
      calls: tail.reduce((n, o) => n + o.calls, 0),
      selfMs: tail.reduce((n, o) => n + o.selfMs, 0),
      totalMs: tail.reduce((n, o) => n + o.totalMs, 0),
    }],
  };
}

// ── Reading the profile ──────────────────────────────────────────────────────

/** Ops whose cost is the boolean kernel — the ones a compound can sidestep. */
const BOOLEAN_OPS = new Set(["fuse", "cut", "intersect"]);

/**
 * One line, ops first, longest first. `cap` bounds the enumeration so a model
 * with thirty distinct operations doesn't spend thirty lines of anyone's context
 * saying so — the remainder is ROLLED UP and stated, never silently dropped.
 */
export function formatOpProfile(p                              , opts                                    = {})         {
  if (!p?.ops?.length) return "";
  const indent = opts.indent ?? "";
  const cap = opts.cap ?? 6;
  const total = p.measuredMs || 1;
  const shown = p.ops.slice(0, cap);
  const rest = p.ops.slice(cap);
  const part = (o        ) => `${o.op} ×${o.calls} ${o.selfMs}ms (${Math.round((o.selfMs / total) * 100)}%)`;
  const line = shown.map(part).join(" · ");
  const restMs = rest.reduce((n, o) => n + o.selfMs, 0);
  return indent + line + (rest.length ? ` · ${rest.length} other op(s) ${restMs}ms` : "");
}

/** What one build cost, split into the half a coarse preview can cheapen and the half it cannot. */
                            
                                                                              
                 
                                                                    
                 
 

/**
 * t8-7 P2 — is the coarse drag preview worth building?
 *
 * A coarse build lowers `meshOpts` and nothing else: it re-runs main() at full
 * price, and the trailing fine build cannot reuse that exec because the worker's
 * cache key is quality+assetsKey+code. So the preview's whole benefit is showing
 * a picture `tessMs` sooner, and its whole cost is delaying the CORRECT picture
 * by `execMs`. Pay for it only when tessellation is the expensive half.
 *
 * `null` (no measurement yet) keeps t8-2b's behaviour — guessing wrong here costs
 * latency, never correctness, so the unmeasured case defaults to what shipped.
 */
export function coarsePreviewPays(last                              )          {
  if (!last) return true;
  return last.tessMs >= last.execMs;
}

/**
 * The VERDICT, not the recipe (context/verdicts-not-recipes-plan.md): Axle can
 * see that one operation class owns the build, so it says so — rather than
 * shipping every agent a standing paragraph about boolean cost that most models
 * never need. Returns null when there is nothing worth saying.
 */
export function execProfileVerdict(p                              , execMs        )                {
  if (!p?.ops?.length || !(execMs > 0)) return null;
  const boolMs = p.ops.filter((o) => BOOLEAN_OPS.has(o.op)).reduce((n, o) => n + o.selfMs, 0);
  const boolCalls = p.ops.filter((o) => BOOLEAN_OPS.has(o.op)).reduce((n, o) => n + o.calls, 0);
  const share = boolMs / execMs;
  // Under a second nobody is waiting, whatever the split — say nothing.
  if (execMs < 1000 || share < 0.5) return null;
  return `⚠ ${Math.round(share * 100)}% of exec (${Math.round(boolMs)}ms across ${boolCalls} boolean op(s)) is the OCC boolean kernel. ` +
    `If those shapes only need to LOOK adjacent — a lattice, a slat screen, decorative battens — returning them as ` +
    `api.makeCompound([...]) instead of fusing is typically 3× faster and changes nothing visible. ` +
    `Clip each member BEFORE compounding: .intersect() on a compound silently uses one solid.`;
}
