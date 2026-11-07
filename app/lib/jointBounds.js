// What a rig OCCUPIES when it is POSED (t7-direction §14) — the bounding box of a
// model's parts after its joints have moved, in model-local OCC millimetres.
//
// ── The bug this exists to kill ──────────────────────────────────────────────
// The Direction compiler framed every shot against `build.geometry.parts`, which is
// the geometry AS BUILT — joints at rest, always. So `open_close` composed a camera
// for a cabinet with its door shut and its drawer in, then played a reel in which the
// door swings 100° and the drawer slides 420 mm forward. Measured on the base cabinet
// (80bb19ac): the rest sphere is r=619.5, the posed one r=770.8 — 24% bigger — and the
// centroid moves 210 mm. Both put the subject through the frame edge, and NOTHING
// caught it, because every check in the chain was asking about the rest pose too.
//
// ⚠⚠ THE SAME PROPERTY THAT MAKES A RIG BUG INVISIBLE MAKES THIS ONE INVISIBLE: a rig
// is INVISIBLE AT REST (app/lib/jointTree.ts's header, and the whole reason
// probe-jointchain exists). The rest box and the posed box agree exactly at every
// joint's default, so a fixture that builds a model and measures it proves nothing
// here. Any test MUST pose the rig.
//
// ── Why this is a second implementation, and why that is not a fork ──────────
// ThreeViewer poses the rig by NESTING THREE.Groups and letting the scene graph
// compose the chain (buildScene → applyJointPose). That is the renderer's answer and
// it needs a browser. This is the same forward kinematics as pure arithmetic on eight
// corners, so the worker — which has no scene graph and no GPU — can answer "how big
// is this thing when it is open?" before it composes a camera.
//
// The two agree BY DERIVATION, not by hope. jointTree.ts's header states the transform
// a nested group produces:
//
//     world(v) = pA + R_A·[ (pB − pA) + R_B·(v − pB) ]
//
// and the parent∘child composition below expands to exactly that (worked through in
// `composeJoint`). scripts/headless/test-jointbounds.mjs checks the identity against
// closed-form answers AND against the flat-fallback law in motion-rigging-plan.md §4.
//
// ⚠ OCC space throughout (Z up), the frame `ModelJoint.pivot`/`axis` are already in.
// The OCC→viewer remap is a rotation, so rotating about an OCC axis by θ and then
// remapping equals remapping and then rotating about the mapped axis by θ — which is
// why this can work entirely in OCC and still match what the viewer draws. The single
// crossing stays where it has always been (motionDirection.js § boxToCtx).
//
// Every import is type-only or from a type-only module, deliberately: it keeps plain
// `node` able to load this file, which is what lets the probe run without a browser.
// Same rule as jointTree.ts and jointAnchors.ts — do not add a runtime-only import.

                                                       
import { buildJointTree, collectDrivers, resolveDrivenTargets,                } from "./jointTree.js";
import { resolveJointAxis, resolveJointPivot } from "./jointAnchors.js";

                                            

/** One part's axis-aligned box as the build record reports it (OCC mm). */
                                                               

/** An OCC bounding box in the shape assemblySolver/assemblyAggregate speak. */
                                                                                                              

/** An affine map p → M·p + t, M row-major 3×3.
 *
 *  ⭐ EXPORTED since t7-sweptcheck. The swept-collision check (app/lib/sweptCollision.ts) hands
 *  this same matrix to OCC as a `gp_Trsf`, so the B-rep it intersects sits exactly where the box
 *  this file computes says it sits. Deriving the transform a second time over there would be a
 *  second forward kinematics, which is the fork this module's header and guard S27 both exist to
 *  prevent [[feedback_three_registries]]. */
                                                

const IDENTITY         = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

const apply = (a        , p      )       => [
  a.m[0] * p[0] + a.m[1] * p[1] + a.m[2] * p[2] + a.t[0],
  a.m[3] * p[0] + a.m[4] * p[1] + a.m[5] * p[2] + a.t[1],
  a.m[6] * p[0] + a.m[7] * p[1] + a.m[8] * p[2] + a.t[2],
];

/** parent ∘ child — child acts first, exactly as a nested THREE.Group does. */
function compose(parent        , child        )         {
  const m = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = parent.m[r * 3] * child.m[c] + parent.m[r * 3 + 1] * child.m[3 + c] + parent.m[r * 3 + 2] * child.m[6 + c];
    }
  }
  return { m, t: apply(parent, child.t) };
}

/** Rodrigues rotation about a unit axis, row-major. */
function rotation(axis      , rad        )           {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const [x, y, z] = [axis[0] / len, axis[1] / len, axis[2] / len];
  const c = Math.cos(rad), s = Math.sin(rad), k = 1 - c;
  return [
    c + x * x * k,     x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k,     y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
}

/**
 * One joint's own transform, about its ABSOLUTE rest pivot.
 *
 * ⚠ About the ABSOLUTE pivot, not the parent-relative `basePos`, and the two are not
 * interchangeable. ThreeViewer needs `basePos` because a child group already sits
 * inside its parent's frame; composing absolute transforms here reaches the same place
 * without the scene graph. Expanding parent ∘ child for a 2-deep chain:
 *
 *   m = R_A·R_B
 *   t = R_A·(pB − R_B·pB) + (pA − R_A·pA)
 *   ⇒ p ↦ pA + R_A·[ (pB − pA) + R_B·(p − pB) ]
 *
 * which is jointTree.ts's stated identity term for term. Use `basePos` here instead and
 * a chain double-counts its parent's offset the moment anything is nested.
 */
function jointLocal(joint            , pivot      , axis      , value        )         {
  // The same clamp applyJointPose enforces — a scene that names an out-of-range value
  // must frame the pose the viewer will actually draw, not the one it asked for.
  const v = Math.max(joint.min, Math.min(joint.max, value));
  if (joint.type === "prismatic") {
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    return { m: IDENTITY.m.slice(), t: [(axis[0] / len) * v, (axis[1] / len) * v, (axis[2] / len) * v] };
  }
  const m = rotation(axis, (v * Math.PI) / 180);
  const rp = apply({ m, t: [0, 0, 0] }, pivot);
  return { m, t: [pivot[0] - rp[0], pivot[1] - rp[1], pivot[2] - rp[2]] };
}

/** A rig resolved at one set of joint values — the per-joint answer, before anything unions it. */
                           
                                                                                                 
                  
                                                                                             
                                                                              
                                                                                             
                                                                                          
                                                                                            
                                                                                           
                                                                                               
                                                                  
                             
                                                                                         
                                                                                              
                                                                                               
                                                                                          
                                                                                            
                                                                                     
                                  
                                                                                                   
                              
 

/**
 * ⭐⭐ THE SHARED HALF OF `posedPartBounds`, extracted for t7-sweptcheck and called by it.
 *
 * `posedPartBounds` answers "how big is this thing when it is open?" — a single union, which is
 * all a camera needs. The swept-collision check needs the step before that: WHERE EACH PART WENT,
 * so it can pose the B-rep and measure what it now shares with its neighbours. That is the same
 * forward kinematics, so it is this function, called twice, rather than written twice
 * [[feedback_three_registries]].
 *
 * ⭐⭐ `anchors` IS AN ARGUMENT NOW (t46-asm-pose), and its ABSENCE keeps its old meaning exactly.
 * This function resolved every pivot with `resolveJointPivot(j, undefined)` — its documented
 * "no build result yet" branch, the stored pivot, quietly — on the grounds that the server has
 * anchor NAMES only. That stopped being true when `t46-asm-door` put `anchorDefs` on the build
 * record: the viewer hinges an anchor-backed joint about the anchor's LIVE origin and this posed
 * about a triple written once, so a parametric hinge's reel framed a door swinging about a pivot
 * the viewport does not use — the drift `app/lib/jointAnchors.ts` was written to kill, reborn one
 * consumer over [[feedback_reframe_leaves_old_behaviour]]. A caller with the member's anchors
 * passes them; a caller without them passes nothing and gets byte-identically what it got before.
 *
 * ⚠ The other reason `posedPartBounds` gives still applies verbatim: an omitted value is
 * `default ?? min`, not zero — so `{}` is the model AT REST AS DRAWN, which is not always the
 * as-built pose. A caller comparing against as-built geometry must know that; the swept check
 * does, and says so at its own baseline.
 */
export function poseRig(
  joints                                          ,
  jointValues                                          ,
  /** This member's CURRENT build anchors, so an anchor-backed joint hinges where the viewer
   *  hinges it. The three states `resolveJointPivot` draws are preserved: an array reported,
   *  `undefined`/`null` = "no build yet", fall back to the stored pivot quietly. */
  anchors                                ,
)           {
  const list = joints ?? [];
  const anch = anchors ? (anchors                 ) : undefined;
  const tree = buildJointTree(list, (j) => resolveJointPivot(j, anch).pivot);

  // Targets, then DRIVEN values on top — `driven` composes VALUES where `parent` composes
  // TRANSFORMS, and a geared pair that only half-moves here would describe a pose the viewer
  // never shows.
  const values = new Map                ();
  for (const node of tree.order) {
    const j = node.joint;
    const raw = jointValues?.[j.id];
    values.set(j.id, typeof raw === "number" && isFinite(raw) ? raw : (j.default ?? j.min));
  }
  resolveDrivenTargets(collectDrivers(tree.byId, (jointId) => jointId), values);

  // Parent-before-child, so a parent's world transform always exists by the time its child
  // needs it. That ordering is `tree.order`'s guarantee, not an assumption.
  //
  // `world` and `pivotWorld` share ONE call to `jointLocal` per node — not a second forward
  // kinematics, a second READING of the same answer:
  //   · `world`      composes `jointLocal` AS IS — the member-point convention (§ PosedRig).
  //   · `pivotWorld` reuses `jointLocal.m` (rotating about a point never moves that point, so
  //     the rotation half is identical either way) but rebuilds the TRANSLATION in the
  //     scene-graph's own convention — the group's position is its BASE, not `jointLocal`'s
  //     `pivot − R·pivot`: a revolute group never leaves its base (it only turns about its own
  //     origin); a prismatic group slides along its axis by the clamped value FROM its base —
  //     `jointLocal.t` already computed exactly that axis·value term for a prismatic joint
  //     (it carries no pivot term at all), reused rather than re-summed.
  const world = new Map                ();
  const pivotWorld = new Map                ();
  for (const node of tree.order) {
    const j = node.joint;
    const local = jointLocal(j, node.pivot, resolveJointAxis(j, anch), values.get(j.id) ?? 0);
    world.set(j.id, node.parentId ? compose(world.get(node.parentId) ?? IDENTITY, local) : local);

    const g         = j.type === "prismatic"
      ? { m: local.m, t: [node.basePos[0] + local.t[0], node.basePos[1] + local.t[1], node.basePos[2] + local.t[2]] }
      : { m: local.m, t: node.basePos };
    const parentPW = node.parentId ? pivotWorld.get(node.parentId) : undefined;
    pivotWorld.set(j.id, parentPW ? compose(parentPW, g) : g);
  }

  return { tree, world, pivotWorld, values };
}

/** The composed transform acting on one part, or undefined when no joint owns it (it does not
 *  move). Undefined rather than IDENTITY on purpose: a caller can then skip the transform
 *  entirely, which for the OCC half is the difference between no work and a shape copy. */
export function partTransform(rig          , partName        )                     {
  const jointId = rig.tree.partToJoint.get(partName);
  return jointId ? rig.world.get(jointId) : undefined;
}

/** p ↦ M·p + t. Exported alongside `Affine` so the OCC half can check its own gp_Trsf against
 *  the arithmetic this module is asserted on (scripts/headless/test-jointbounds.mjs). */
export function transformPoint(a        , p      )       {
  return apply(a, p);
}

/**
 * The AABB of a transformed box — the AABB OF THE ROTATED CORNERS, which is the exact AABB of
 * the rotated box and therefore never smaller than the solid inside it.
 *
 * ⚠ Generous, never tight, and that direction is load-bearing in both callers: a framing box
 * that is tight lets the subject leave frame, and a collision PRE-FILTER that is tight skips the
 * pair that was about to be the finding.
 */
export function transformedBox(a                    , min      , max      )                           {
  if (!a) return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
  let lo              = null;
  const hi       = [0, 0, 0];
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
    const p = apply(a, [dx ? max[0] : min[0], dy ? max[1] : min[1], dz ? max[2] : min[2]]);
    if (!lo) { lo = [p[0], p[1], p[2]]; hi[0] = p[0]; hi[1] = p[1]; hi[2] = p[2]; continue; }
    for (let i = 0; i < 3; i++) { if (p[i] < lo[i]) lo[i] = p[i]; if (p[i] > hi[i]) hi[i] = p[i]; }
  }
  return { min: lo , max: hi };
}

/** Do two affines place their part in the SAME place? Used to tell a part that moved from one
 *  that did not, which is how the swept check decides a pair is worth a boolean at all. The
 *  epsilon is numerical only — these are products of rotations, not measured quantities. */
export function sameAffine(a                    , b                    , eps = 1e-9)          {
  const A = a ?? IDENTITY, B = b ?? IDENTITY;
  for (let i = 0; i < 9; i++) if (Math.abs(A.m[i] - B.m[i]) > eps) return false;
  for (let i = 0; i < 3; i++) if (Math.abs(A.t[i] - B.t[i]) > eps) return false;
  return true;
}

/**
 * The box a model's parts occupy with its joints at `jointValues`.
 *
 * `jointValues` is the same map a MotionFrame carries (`jointStates`: joint id → degrees
 * for a revolute, mm for a prismatic). A joint the map omits sits at `default ?? min`,
 * which is what ThreeViewer does with an absent value — so `{}` yields the model AT REST
 * AS DRAWN, which is NOT always the as-built box: a joint with a non-zero `default`
 * renders open and the build record still reports it shut.
 *
 * ⭐⭐ ANCHORS ARE RESOLVABLE ON THE SERVER NOW, and a caller that has them passes them
 * (t46-asm-pose). This said they were not, and cited the build record keeping anchor
 * NAMES only — true when it was written, and untrue since `t46-asm-door` added
 * `anchorDefs` to that record. A caller that passes none still gets the documented "no
 * build result yet" branch: the stored pivot, quietly, as stale as the stored pivot is.
 * ⚠ That fallback is a DEGRADE, not a neutral default — for an anchor-backed joint whose
 * parameters have moved it frames a swing about a pivot the viewport does not use. The
 * assembly path passes the member's anchors through `evaluateAssemblyPose`; a caller that
 * cannot, says so [[feedback_fallback_hides_provenance]].
 *
 * Returns null when there is nothing to measure, never a zero box: an empty box would
 * frame a camera on a point and read as a successful answer.
 */
export function posedPartBounds(
  parts                                       ,
  joints                                          ,
  jointValues                                          ,
  /** Exploded-view amount, 0 (assembled) → 1 (fully spread) — the same scalar a
   *  MotionFrame carries (t7-cinema C0-4). Mirrors ThreeViewer's radial explode
   *  exactly: each part offsets along the unit radial from the model centre by
   *  `amount × spread`, spread = half the model's largest extent, both measured at
   *  REST — and the offset is applied BEFORE the joint transform, because the viewer
   *  moves the MESH inside its pivot group ("we move the mesh, not its pivot group"),
   *  so an open door's spread composes through its own hinge rotation there and here
   *  alike. Frame-safe: the OCC→viewer remap is an axis permutation, under which
   *  normalize, max-extent and the composition all commute. Explode-Settle's widest
   *  moment used to survive on the recipe's hand-tuned k generosity; now it is in the
   *  envelope like every joint pose. */
  explodeAmount = 0,
  /** ⭐⭐ A RIG THIS CALLER HAS ALREADY POSED (t46-asm-pose) — the assembly path's, from
   *  `evaluateAssemblyPose`. Without it this function poses a SECOND rig from the same joints and
   *  the same values, which is a second forward kinematics for one member: two answers that agree
   *  until one of them grows an input the other has not got, and A9's renderer bug was exactly
   *  that shape [[feedback_three_registries]]. Absent → one is posed here, as always.
   *  ⚠ It must be `poseRig` over the SAME joints and values, or these boxes describe a pose
   *  nothing drew. `test:asmpose` measures that rather than trusting the caller. */
  rig                  ,
  /** This member's build anchors, for the rig posed HERE. Ignored when `rig` is given — that
   *  caller has resolved them already. See `poseRig`. */
  anchors                                ,
)                {
  if (!Array.isArray(parts) || !parts.length) return null;

  // ⭐ The chain, the driven values and the composed transforms all come from `poseRig` above —
  // the same code that ran inline here until t7-sweptcheck, which needs the PER-PART answer this
  // function only ever unions.
  const rigged = rig ?? poseRig(joints, jointValues, anchors);

  // The explode offsets, derived from the REST boxes exactly as the viewer captures its
  // radial bases at build time (ThreeViewer § "Capture exploded-view bases"): centre and
  // spread from the union of the parts as reported, direction from each part's own rest
  // centre. Computed only when asked — the zero path stays byte-identical.
  const explodeOffsets = new Map              ();
  if (explodeAmount > 0) {
    let rlo              = null;
    const rhi       = [0, 0, 0];
    for (const part of parts) {
      if (!Array.isArray(part?.min) || !Array.isArray(part?.max)) continue;
      if (!rlo) { rlo = [part.min[0], part.min[1], part.min[2]]; rhi[0] = part.max[0]; rhi[1] = part.max[1]; rhi[2] = part.max[2]; continue; }
      for (let i = 0; i < 3; i++) { if (part.min[i] < rlo[i]) rlo[i] = part.min[i]; if (part.max[i] > rhi[i]) rhi[i] = part.max[i]; }
    }
    if (rlo) {
      const centre       = [(rlo[0] + rhi[0]) / 2, (rlo[1] + rhi[1]) / 2, (rlo[2] + rhi[2]) / 2];
      const spread = Math.max(rhi[0] - rlo[0], rhi[1] - rlo[1], rhi[2] - rlo[2]) * 0.5;
      for (const part of parts) {
        if (!Array.isArray(part?.min) || !Array.isArray(part?.max)) continue;
        const d       = [
          (part.min[0] + part.max[0]) / 2 - centre[0],
          (part.min[1] + part.max[1]) / 2 - centre[1],
          (part.min[2] + part.max[2]) / 2 - centre[2],
        ];
        const m = Math.hypot(d[0], d[1], d[2]);
        // The viewer zeroes a sub-epsilon radial (a part dead-centre does not move).
        if (m * m < 1e-6) continue;
        const k = (explodeAmount * spread) / m;
        explodeOffsets.set(part.name, [d[0] * k, d[1] * k, d[2] * k]);
      }
    }
  }

  let lo              = null;
  const hi       = [0, 0, 0];
  for (const part of parts) {
    if (!Array.isArray(part?.min) || !Array.isArray(part?.max)) continue;
    const xf = partTransform(rigged, part.name);
    const off = explodeOffsets.get(part.name);
    // ⚠ The AABB of the ROTATED CORNERS, which is the exact AABB of the rotated box and
    // therefore never smaller than the solid inside it. A framing box may be generous;
    // it may never be tight, or the thing it was measured for leaves the frame.
    for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
      const c       = [dx ? part.max[0] : part.min[0], dy ? part.max[1] : part.min[1], dz ? part.max[2] : part.min[2]];
      // Explode BEFORE the joint transform — the mesh moves inside its pivot group.
      if (off) { c[0] += off[0]; c[1] += off[1]; c[2] += off[2]; }
      const p = xf ? apply(xf, c) : c;
      if (!lo) { lo = [p[0], p[1], p[2]]; hi[0] = p[0]; hi[1] = p[1]; hi[2] = p[2]; continue; }
      for (let i = 0; i < 3; i++) { if (p[i] < lo[i]) lo[i] = p[i]; if (p[i] > hi[i]) hi[i] = p[i]; }
    }
  }
  if (!lo) return null;
  return { min: { x: lo[0], y: lo[1], z: lo[2] }, max: { x: hi[0], y: hi[1], z: hi[2] } };
}

/** The AABB of a flat `[x0,y0,z0,x1,y1,z1,…]` vertex array — the one min/max scan this
 *  codebase had three independent copies of (ThreeViewer.tsx's `occPartBoxFromVertices`,
 *  make-cabinet-fixture.mjs's stats scan, test-shadow-envelope.mjs's `partBoxFrom`) before
 *  t38-look S5 consolidated them here [[feedback_three_registries]]. `null` for an empty or
 *  missing array, never a degenerate zero box. */
export function occBoxFromVertices(vertices                                      )                                  {
  if (!vertices?.length) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Per-part OCC boxes from a server build record — the input `posedPartBounds` wants,
 *  read from the same `geometry.parts` array `occBoxFromBuild` unions. */
export function partBoxesFromBuild(build     )            {
  const parts = build?.geometry?.parts;
  if (!Array.isArray(parts)) return [];
  const out            = [];
  for (const p of parts) {
    if (!Array.isArray(p?.min) || p.min.length !== 3) continue;
    const min       = [Number(p.min[0]), Number(p.min[1]), Number(p.min[2])];
    out.push({
      name: p.name,
      min,
      max: [min[0] + (p.sizeX ?? 0), min[1] + (p.sizeY ?? 0), min[2] + (p.sizeZ ?? 0)],
    });
  }
  return out;
}
