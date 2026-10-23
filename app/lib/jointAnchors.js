// Where a joint's pivot comes from (t14-joints).
//
// The bug this exists to kill: `ModelJoint.pivot` is a STATIC triple, written once
// when the joint was authored, while the geometry it hinges is parametric. The Dog
// House door_hinge drifted 31.9 mm in Y (portalDepth 70 → 38.1) and 83.65 mm in Z
// (legHeight 90 → 6.35) — and a revolute joint DOUBLES its pivot error into the gap
// at the open end, so the door floated ~64 mm off its jamb at doorOpen 180. It was
// re-synced by hand once; a re-sync is not a fix, it drifts again on the next
// parameter change.
//
// `api.anchor()` (t9-constraints) already has the property pivot lacks: named anchors
// are declared IN MODEL CODE and recomputed on every build from the live parameters,
// and they ride the build cache (cadWorker IDB v3) so a cache hit doesn't report a
// model as declaring none. So a joint may now name one:
//
//   // model code
//   api.anchor("door_hinge", { origin: [hingeAxisX, hingeAxisY, leafBottomZ], axis: [0,0,1] });
//   // joint
//   { …, anchor: "anchor:door_hinge", pivot: [434.1, 146.5, 111] }
//
// ⚠ `pivot` is NEVER removed. It stays as the fallback, forever — an anchor-backed
// joint whose model code stops declaring the anchor still renders somewhere sane
// instead of blanking, and every joint authored before this change keeps working
// untouched. That is also why the fallback is LOUD (see `warning` below) rather than
// silent: a stale pivot that renders perfectly at 0° is exactly the failure this
// module exists to stop, and a silent fallback would restore it.
//
// ── What the anchor supplies: the ORIGIN, and the axis ONLY IF ASKED ─────────
// The origin is taken always. The axis is NOT, by default: the measured drift is
// entirely positional, a hinge direction like [0,0,1] does not move when a parameter
// moves, and anchors carry an OUTWARD-pointing axis by mating convention (two mating
// anchors meet anti-parallel), so silently adopting one would flip the swing direction
// of any joint that reuses a mating anchor.
//
// t14-rig R2 takes the escape hatch this comment always specified, exactly as specified:
// `axis` is now OPTIONAL, and omitting it — and only omitting it — opts into the
// anchor's. No stored joint changes meaning, because every existing joint has an axis.
// That covers the genuinely parametric hinge DIRECTION (a hatch on a roof whose pitch
// is a parameter), which a static triple gets wrong the same way a static pivot did.
// ⚠ A joint that opts in inherits the mating convention with it: the anchor's axis
// points OUTWARD from the part, so if the swing comes out backwards, negate the axis in
// the model's api.anchor() call rather than re-adding a static one here.

                                                       

// The same "anchor:<name>" vocabulary assemblySolver's constraints use (isNamedAnchor /
// anchorName / namedAnchorRef there) — ONE namespace per model, not one per consumer.
// Restated rather than imported on purpose: every import in this file has to stay
// type-only so plain `node` can load it, which is what lets test-anchors.mjs prove pivot
// re-derivation against a REAL OCC build instead of a hand-written anchor array. A
// 7-character prefix is a cheaper coupling than a test that cannot run.
const ANCHOR_PREFIX = "anchor:";

                                     
                                                               
                                  
                                                                            
                             
                                                                                     
                                                                                   
                   
 

/** Resolve the point a joint hinges/slides about.
 *
 *  `anchors` is the CURRENT build's anchor set, and its three states are all distinct
 *  and all load-bearing (the same distinction assemblySolver draws):
 *    · a non-empty/empty array — the build reported; a missing name is genuinely unknown
 *    · undefined              — no build result yet (or a host that doesn't carry them);
 *                               fall back QUIETLY, since "not yet" is not "wrong"
 *  Conflating them would either spam a warning on every first paint or swallow a real
 *  typo — see feedback_silent_catch_hides_holes. */
export function resolveJointPivot(
  joint                                             ,
  anchors                                  ,
)                     {
  const ref = joint.anchor;
  if (!ref) return { pivot: joint.pivot, source: "pivot" };

  // Accept a bare name as well as the "anchor:<name>" ref the constraint namespace
  // uses. An agent that reads api.anchor("door_hinge") and passes "door_hinge" is
  // being reasonable; refusing that on a prefix would be a papercut with no upside.
  const name = ref.startsWith(ANCHOR_PREFIX) ? ref.slice(ANCHOR_PREFIX.length) : ref;

  if (anchors == null) {
    // Not built yet. The pivot is the best available answer and saying so every
    // frame would drown the real warning.
    return { pivot: joint.pivot, source: "pivot" };
  }

  const a = anchors.find((x) => x.name === name);
  if (!a) {
    return {
      pivot: joint.pivot,
      source: "pivot",
      warning: anchors.length
        ? `Joint "${joint.id}" names anchor "${name}", which this build does not declare `
          + `(declared: ${anchors.map((x) => x.name).join(", ")}). Falling back to the stored `
          + `pivot, which does NOT track parameter changes.`
        : `Joint "${joint.id}" names anchor "${name}", but this model's code declares no `
          + `anchors — add api.anchor("${name}", { origin: […], axis: [0,0,1] }) to it. `
          + `Falling back to the stored pivot, which does NOT track parameter changes.`,
    };
  }
  return { pivot: [a.origin[0], a.origin[1], a.origin[2]], source: "anchor" };
}

/** The axis a joint actually rotates/slides along (t14-rig R2).
 *
 *  A joint that DECLARES an axis keeps it, always — that is every joint authored before
 *  R2, and it is why this is additive. A joint that OMITS one is explicitly asking to
 *  inherit its anchor's, which re-derives from the live parameters on every build; this
 *  is the only way a genuinely parametric hinge DIRECTION can stay correct.
 *
 *  Falls back to [0,0,1] (vertical hinge, the common door case) when there is nothing to
 *  inherit — a joint must always have SOME axis or the viewer cannot pose it at all, and
 *  a silently unposeable joint is worse than a wrong-but-visible one. add_joint refuses
 *  the omit-both combination at authoring time, so reaching the fallback means a joint
 *  was written by an older client or hand-edited. */
export function resolveJointAxis(
  joint                                     ,
  anchors                                  ,
)                           {
  if (joint.axis) return joint.axis;
  const ref = joint.anchor;
  if (ref && anchors) {
    const name = ref.startsWith(ANCHOR_PREFIX) ? ref.slice(ANCHOR_PREFIX.length) : ref;
    const a = anchors.find((x) => x.name === name);
    if (a?.axis) return [a.axis[0], a.axis[1], a.axis[2]];
  }
  return [0, 0, 1];
}

/** The ref form stored on a joint. Mirrors assemblySolver's constraint namespace so a
 *  model has ONE anchor vocabulary, not one per consumer. */
export const jointAnchorRef = (name        )         => `${ANCHOR_PREFIX}${name}`;

/** Log a resolution warning once per (joint, message) rather than once per frame —
 *  the render effects below re-run on every rebuild, and an honest warning that
 *  repeats 60× becomes noise nobody reads. */
const warned = new Set        ();
export function warnJointAnchor(r                    , jointId        )       {
  if (!r.warning) return;
  const key = `${jointId}::${r.warning}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[joints] ${r.warning}`);
}
