// `api.joint()` — the model's program declaring its own degrees of freedom (spine S4 /
// create-language-plan.md §h C1, ⚖️ RULED by HK 2026-09-17). The fifth declaration, beside
// `api.anchor()`, `api.entity()` and `api.importSTEP()`.
//
// ⭐⭐ WHY THIS IS ONE SHARED MODULE AND NOT A MIRRORED PAIR. `declareAnchor` and
// `declareEntity` exist twice — once in `app/cadWorker.ts` and once in
// `packages/engine/runner.mjs` — with a comment on each telling the next reader to keep the
// error strings in step. That is a hand-kept mirror, and the repo's own law says a hand-kept
// mirror is the bug waiting to happen [[feedback_three_registries]]. A joint is worse than an
// anchor to get wrong: an anchor that differs between the tab and the headless door produces
// two messages, while a JOINT that differs produces two `data.joints` sets, because this
// declaration WRITES. So the validation, the resolution and the ball expansion all live here,
// both mirrors call the same function, and there is nothing left to keep in step.
//
// ⚠ What still lives in each mirror is the `joint:` KEY, and it stays OUTSIDE the `buildApi`
// object literal for the reason `declareAnchor` does: `scripts/lib/apiKeys.mjs` derives the
// runtime API surface by reading that literal's `key:` pairs, so an inline function signature
// would register its own parameter names as phantom API functions.
//
// ⚠ Dependency-free (types only, the `frameOwnership.ts` law): `packages/engine/runner.mjs`
// imports it under Node's type-stripping and `scripts/export-cad-engine.mjs` type-erases it
// into the published npm package, so a runtime import of anything outside `app/lib` would
// either fail to resolve or publish a phantom dependency.

                                                       
// ⚠ THE `.ts` EXTENSION IS LOAD-BEARING, not a slip. This module is imported by
// packages/engine/runner.mjs and by mcp/tools/joints.js under Node's type-stripping, which
// does not resolve an extensionless specifier — the extensionless form compiles, bundles and
// ships, and then dies only in the headless door [[feedback_node_loads_ts_extensionless]].
// `allowImportingTsExtensions` is already set; Vite resolves the explicit extension unchanged.
import { CODE_STAGE } from "./jointOwnership.js";

/** The one axis per degree of freedom a ball joint decomposes into. */
export const DOF_AXES                                           = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** A ball joint, expanded into chained revolutes at one pivot (t14-rig R3).
 *
 *  `dof` is APPLICATION order — rotate about x, THEN y, THEN z. A nested transform
 *  composes innermost-first, so the chain is built in REVERSE: the first-applied
 *  rotation sits deepest. Application order x,y,z therefore yields R = Rz·Ry·Rx, the
 *  same convention AssemblyInstance.transform uses, so a rig and a constraint can never
 *  disagree about what "twist" means.
 *
 *  Only the DEEPEST joint carries `parts`; the outer ones move them through the chain.
 *  Listing them on all three would make the joint conflict with itself.
 *
 *  ⚠⚠ MOVED HERE FROM `mcp/tools/joints.js` 2026-09-17 (t46-api-joint) WITHOUT A LINE OF
 *  CHANGE, and that is the point: `api.joint`'s `dof` and `add_joint`'s `dof` are the same
 *  convenience, so they must emit the same chain in the same application order with the same
 *  `<id>-x/-y/-z` ids. A second implementation is how the two doors come to disagree about
 *  rotation order — and the assembly solver's convention is downstream of both. `joints.js`
 *  re-exports it, so every existing importer (scripts/headless/test-jointtree.mjs included)
 *  keeps its import path.
 *
 *  Exported for scripts/headless/test-jointtree.mjs — the ordering and the parts
 *  placement are exactly the kind of thing that looks right until a rig is posed. */
export const expandBallJoint = ({ id, label, dof, parts, parent, shared = {} }   
                                                                                                                
 )                            => {
  const chain = [...dof].reverse();
  return chain.map((d, i) => ({
    id: `${id}-${d}`,
    label: `${label || "Joint"} ${d.toUpperCase()}`,
    type: "revolute",
    parts: i === chain.length - 1 ? parts : [],
    ...shared,
    axis: DOF_AXES[d],
    ...(i === 0 ? (parent ? { parent } : {}) : { parent: `${id}-${chain[i - 1]}` }),
  }));
};

/** What a model's code hands `api.joint()`. `range` is `[min, max]`.
 *
 *  ⚠ `anchor` is REQUIRED and there is no `pivot`, which is the one place this spec
 *  deliberately narrows `ModelJoint`. A stored pivot is a frozen triple that is correct only
 *  at the parameter values it was measured at — a measured doghouse door drifted 84 mm and
 *  floated off its jamb after two parameter edits. A joint declared IN the program, whose
 *  whole justification is that it re-derives with the geometry, must not be able to freeze
 *  one: the program names an `api.anchor()` and the build fills the fallback pivot in from
 *  that anchor's live origin, every build. */
                            
                                 
                  
                 
                 
                                  
                           
                  
                                                               
                 
 

/** One raw `api.joint()` call, before the anchors are resolved. */
                                                          

/** Validate + record one `api.joint()` declaration.
 *
 *  ⭐ Shape only. The anchor cannot be resolved here — `main()` may declare a joint BEFORE the
 *  anchor it names, and refusing that ordering would be a rule about line order rather than
 *  about the model. Resolution happens in `resolveDeclaredJoints` once `main()` has returned
 *  and the anchor map is complete; it throws out of the same try, so an unresolvable anchor is
 *  still a build error against the offending model rather than a joint that silently isn't there.
 *
 *  Throws rather than recording a bad joint, for `declareAnchor`'s reason with a sharper edge:
 *  a malformed joint is INVISIBLE AT REST. It renders perfectly until something poses it
 *  [[feedback_pivot_invisible_when_closed]], and by then the build that could have explained it
 *  is long gone. */
export const declareJoint = (collect                                      , name        , spec           )       => {
  if (!name || typeof name !== "string") throw new Error("api.joint(name, spec): name must be a non-empty string");
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    throw new Error(`api.joint("${name}"): the second argument must be { type, parts, anchor, range, … }`);
  if (spec.type !== "revolute" && spec.type !== "prismatic")
    throw new Error(
      `api.joint("${name}"): type must be "revolute" (a door swinging) or "prismatic" (a drawer sliding) — got ${JSON.stringify(spec.type)}. `
      + `Those are the only two the record has. A BALL joint is not a type: pass dof: ["x","y","z"] on a revolute and this emits one revolute per degree of freedom, chained at the same anchor. `
      + `A CYLINDRICAL joint is a revolute plus a prismatic on one axis, declared as two calls. A FIXED joint is what api.anchor() already is.`,
    );
  if (!Array.isArray(spec.parts) || spec.parts.some((p) => typeof p !== "string" || !p))
    throw new Error(`api.joint("${name}"): parts must be an array of build-part names — the names this model's own main() returns`);
  if (!spec.parts.length)
    throw new Error(`api.joint("${name}"): parts is empty, so this joint would move nothing. Name the parts it poses, or drop the declaration`);
  if (typeof spec.anchor !== "string" || !spec.anchor.trim())
    throw new Error(
      `api.joint("${name}"): anchor is required and must name an api.anchor() this same code declares (e.g. anchor: "hinge_left"). `
      + `A joint declared in the program has no static pivot on purpose — the anchor is what makes the hinge follow the geometry when a parameter moves`,
    );
  if (spec.label !== undefined && typeof spec.label !== "string")
    throw new Error(`api.joint("${name}"): label must be a string when given`);
  // ⚠ A RANGE IS REQUIRED IN v1, AND THAT IS A KNOWN GAP, NOT A DESIGN. C1 reads "range
  // omitted means CONTINUOUS", but `ModelJoint.min`/`max` are required numbers and nothing in
  // the record, the viewer, the pose machinery or the swept-collision pass can express a joint
  // with no stop. Inventing a spelling here (±Infinity, a `continuous: true` flag, min===max)
  // would put a fourth opinion of "unbounded" into a record three readers already agree about.
  // Refused loudly, with the hatch named, until that decision is ruled — never accepted and
  // silently turned into [0, 360], which is a different joint.
  if (spec.range === undefined)
    throw new Error(
      `api.joint("${name}"): range is required — [min, max], degrees for a revolute, mm of travel for a prismatic. `
      + `An omitted range is meant to mean CONTINUOUS, and the record cannot say that yet (min and max are required numbers), `
      + `so it is refused rather than quietly turned into a range you did not write. Give the joint its real stops, e.g. range: [0, 110]`,
    );
  if (!Array.isArray(spec.range) || spec.range.length !== 2 || spec.range.some((n) => typeof n !== "number" || !Number.isFinite(n)))
    throw new Error(`api.joint("${name}"): range must be [min, max] finite numbers — degrees for a revolute, mm of travel for a prismatic`);
  if (spec.range[1] < spec.range[0])
    throw new Error(`api.joint("${name}"): range is [${spec.range[0]}, ${spec.range[1]}] — max is below min, so the joint has nowhere to move`);
  if (spec.parent !== undefined && (typeof spec.parent !== "string" || !spec.parent.trim()))
    throw new Error(`api.joint("${name}"): parent must be another joint's name (omit it for a joint attached to the model root)`);
  if (spec.parent === name)
    throw new Error(`api.joint("${name}"): a joint cannot be its own parent`);
  if (spec.driven !== undefined) {
    const d = spec.driven;
    if (!d || typeof d !== "object" || Array.isArray(d))
      throw new Error(`api.joint("${name}"): driven must be { source, ratio?, offset? } — this joint's value computed from another's`);
    if (typeof d.source !== "string" || !d.source.trim())
      throw new Error(`api.joint("${name}"): driven.source must be another joint's name`);
    if (d.source === name) throw new Error(`api.joint("${name}"): a joint cannot drive itself`);
    for (const k of ["ratio", "offset"]         ) {
      if (d[k] !== undefined && (typeof d[k] !== "number" || !Number.isFinite(d[k]          )))
        throw new Error(`api.joint("${name}"): driven.${k} must be a finite number`);
    }
  }
  if (spec.dof !== undefined) {
    if (!Array.isArray(spec.dof) || !spec.dof.length)
      throw new Error(`api.joint("${name}"): dof must be a non-empty array like ["x", "y", "z"] — one revolute per degree of freedom`);
    const bad = spec.dof.filter((d) => !DOF_AXES[d          ]);
    if (bad.length) throw new Error(`api.joint("${name}"): dof entries must be "x", "y" or "z" — got: ${bad.join(", ")}`);
    if (new Set(spec.dof).size !== spec.dof.length)
      throw new Error(`api.joint("${name}"): dof entries must be distinct — got: ${spec.dof.join(", ")}`);
    if (spec.type !== "revolute")
      throw new Error(`api.joint("${name}"): dof builds a ball joint out of revolutes — set type: "revolute", or drop dof for a prismatic`);
    if (spec.axis !== undefined)
      throw new Error(`api.joint("${name}"): axis and dof are alternatives — dof supplies one axis per degree of freedom`);
  }
  // t14-rig R2: `axis` may be omitted to INHERIT the anchor's direction, which re-derives from
  // the live parameters every build — the only way a genuinely parametric hinge DIRECTION stays
  // correct (a hatch on a roof whose pitch is a parameter). Since `anchor` is required here,
  // omitting it is always available and is the better default.
  if (spec.axis !== undefined) {
    if (!Array.isArray(spec.axis) || spec.axis.length !== 3 || spec.axis.some((n) => !Number.isFinite(n)))
      throw new Error(`api.joint("${name}"): axis must be [x, y, z] finite numbers, or omitted to inherit the anchor's direction`);
    if (Math.hypot(...spec.axis) < 1e-9)
      throw new Error(`api.joint("${name}"): axis has zero length — it must point somewhere, or be omitted to inherit the anchor's`);
  }
  collect?.({ name, spec });
};

const anchorName = (ref        )         => (ref.startsWith("anchor:") ? ref.slice("anchor:".length) : ref).trim();

/** ⭐⭐ Resolve one build's `api.joint()` declarations into the ModelJoint records the rest of
 *  the system reads — run AFTER `main()` returns, with that same build's anchors in hand.
 *
 *  Throws out of the build's own try, so every failure below lands on the author as a build
 *  error against their code, not as a joint that quietly is not there.
 *
 *  ⚠ The `pivot` written here is the FALLBACK, exactly as `add_joint`'s anchor path writes it:
 *  `anchor` stays on the record and its live origin is what actually poses the joint, so the
 *  fallback is never the thing that drifts. */
export function resolveDeclaredJoints(
  decls                      ,
  anchors                        ,
)               {
  const byName = new Map(anchors.map((a) => [a.name, a]));
  const out                            = [];
  const seen = new Set        ();
  for (const { name, spec } of decls) {
    if (seen.has(name)) throw new Error(`api.joint("${name}"): declared twice — a joint name is unique within a model`);
    seen.add(name);
    const an = anchorName(spec.anchor);
    const found = byName.get(an);
    if (!found) {
      throw new Error(
        `api.joint("${name}"): anchor "${an}" is not declared by this code. `
        + (anchors.length
          ? `It declares: ${anchors.map((a) => a.name).join(", ")}`
          : `It declares no anchors at all — add api.anchor("${an}", { origin: [x,y,z], axis: [0,0,1] }) at the hinge line`),
      );
    }
    const shared                          = {
      pivot: found.origin,
      anchor: `anchor:${an}`,
      min: spec.range [0],
      max: spec.range [1],
      ...(spec.driven ? { driven: spec.driven } : {}),
      // ⭐ The badge, minted in ONE place. Rides `shared` so every link of a ball joint carries
      // it — the list collapses a ball into one row, and half a row cannot be the program's.
      stagedBy: CODE_STAGE,
    };
    if (spec.dof?.length) {
      out.push(...expandBallJoint({ id: name, label: spec.label ?? name, dof: spec.dof, parts: spec.parts, parent: spec.parent, shared }));
    } else {
      out.push({
        id: name,
        label: spec.label ?? name,
        type: spec.type,
        parts: spec.parts,
        ...shared,
        ...(spec.parent ? { parent: spec.parent } : {}),
        // omitted on purpose when absent — its absence is what opts into the anchor's axis
        ...(spec.axis !== undefined ? { axis: spec.axis } : {}),
      });
    }
  }
  // ── Cycles, judged on the DECLARED set only ─────────────────────────────────
  // A `parent` or a `driven.source` may legitimately name an AUTHORED joint this build cannot
  // see, so an unknown name is not an error here — `buildJointTree` re-roots whatever arrives
  // and says so. What IS an error is a loop among the joints this program itself declares,
  // because that is invisible at rest and the author is right here to be told about it.
  const ids = new Set(out.map((j) => j.id          ));
  const byId = new Map(out.map((j) => [j.id          , j]));
  const walk = (start        , next                                                    , what        ) => {
    const path = [start];
    let cur = next(byId.get(start) );
    const visited = new Set([start]);
    while (cur && ids.has(cur)) {
      path.push(cur);
      if (cur === start) throw new Error(`api.joint("${start}"): that is a ${what} cycle — ${path.join(" → ")}. A joint cannot end up ${what === "parent" ? "carrying" : "driving"} itself`);
      if (visited.has(cur)) return;
      visited.add(cur);
      cur = next(byId.get(cur) );
    }
  };
  for (const j of out) {
    walk(j.id          , (x) => x.parent                      , "parent");
    walk(j.id          , (x) => (x.driven                                   )?.source, "driver");
  }
  return out                           ;
}
