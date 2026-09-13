// The joint HIERARCHY (t14-rig R1) — see context/motion-rigging-plan.md.
//
// The bug this exists to kill: joints did not compose. ThreeViewer added every pivot
// group to the model root as a flat sibling, and `partToJoint` was a plain Map, so a
// part belonged to exactly one joint and a later joint claiming it silently stole it.
// A 2-deep chain therefore TORE when posed — measured with scripts/headless/
// probe-jointchain.mjs: rotating a shoulder 90 deg moved its forearm 0.0 mm, an error
// of 1131 mm against correct forward kinematics. The rig could model a door or a
// drawer and nothing else.
//
// ⚠ THE FAILURE IS INVISIBLE AT REST. Both the broken and the correct graph put every
// part in exactly the same place at each joint's default value; they only disagree once
// something moves. Any test here MUST pose the rig, never just build it — the same trap
// as feedback_joint_pivot_invisible_when_closed.
//
// ── The transform, and why basePos is what it is ─────────────────────────────
// A part's geometry carries ABSOLUTE model coordinates, so ThreeViewer seats a jointed
// mesh at `-pivot` inside its pivot group and puts the group at `+pivot`; net identity
// at rest, and the group's rotation is therefore about the pivot. Nesting a child group
// inside its parent means the child's rest position is no longer its pivot but its pivot
// RELATIVE to the parent's:
//
//     basePos = pivot - parentPivot          (mesh offset stays -pivot, absolute)
//
// Check, for a vertex v under child B whose parent is A:
//     world(v) = pA + R_A * [ (pB - pA) + R_B * (v - pB) ]
//   R_A=R_B=I  -> v                       (rest is untouched)
//   R_B=I      -> pA + R_A*(v - pA)       (pure rotation about A)
//   R_A=I      -> pB + R_B*(v - pB)       (pure rotation about B)
// which is exactly forward kinematics. Three's scene graph composes it for free, so
// there is no ordering code to get wrong — provided groups are CREATED parent-first,
// which is what `order` guarantees.
//
// Coordinates are model-local OCC (z up), the same frame as ModelJoint.pivot/axis.
// occToThree is linear, so converting before or after the subtraction is equivalent.
//
// Every import is type-only, deliberately: it lets plain `node` load this file so
// scripts/headless/test-jointtree.mjs can prove the math without a browser. Same rule
// as jointAnchors.ts — do not add a runtime import.

                                          

                            
                    
                                                                       
                                  
                                                                                     
                                    
                                                                            
                          
                                                                   
                
 

                            
                                                                                         
                     
                               
                                                                                 
                                   
                                                                                       
                                                                  
                     
 

const ZERO                           = [0, 0, 0];

                                                                                                 
                                                                               

/**
 * Resolve a flat list with `parent` references into a parent-before-child order.
 *
 * Shared by the two hierarchies in the system — joints inside a model (t14-rig R1) and
 * INSTANCES inside an assembly (R7) — because they had identical failure modes and two
 * implementations would be two things to keep in sync (feedback_three_registries).
 *
 * Degenerate input is REPAIRED, never rejected: a duplicate id, an unknown parent, a
 * self-parent or a cycle re-roots the offender and records a warning. A rig or an
 * assembly that is 90% right should render 90% right and say what is wrong, rather than
 * blanking the viewport on one bad reference.
 */
export function resolveHierarchy   (
  items                                 ,
  idOf                  ,
  parentOf                              ,
  noun = "Item",
)               {
  const warnings           = [];
  const list = items ?? [];

  // 1. index, rejecting duplicate ids (first wins, so appending stays stable)
  const unique      = [];
  const ids = new Set        ();
  for (const it of list) {
    const id = idOf(it);
    if (ids.has(id)) { warnings.push(`Two ${noun.toLowerCase()}s share the id "${id}". Ignoring the later one — ids must be unique.`); continue; }
    ids.add(id); unique.push(it);
  }

  // 2. resolve parents; an unknown parent re-roots rather than dropping the item
  const parent = new Map                       ();
  for (const it of unique) {
    const id = idOf(it), p = parentOf(it);
    if (!p) { parent.set(id, null); continue; }
    if (p === id) {
      warnings.push(`${noun} "${id}" lists itself as its parent. Treating it as a root ${noun.toLowerCase()}.`);
      parent.set(id, null); continue;
    }
    if (!ids.has(p)) {
      warnings.push(
        `${noun} "${id}" names parent "${p}", which this model does not declare `
        + `(declared: ${unique.map(idOf).join(", ") || "none"}). Treating it as a root ${noun.toLowerCase()}.`,
      );
      parent.set(id, null); continue;
    }
    parent.set(id, p);
  }

  // 3. depth by relaxation; whatever never settles is in a cycle. Cheaper and clearer
  // than colour-marking DFS, and it names every member rather than the closing edge.
  const depth = new Map                ();
  for (const it of unique) if (parent.get(idOf(it)) === null) depth.set(idOf(it), 0);
  for (let changed = true; changed;) {
    changed = false;
    for (const it of unique) {
      const id = idOf(it);
      if (depth.has(id)) continue;
      const pd = depth.get(parent.get(id) );
      if (pd !== undefined) { depth.set(id, pd + 1); changed = true; }
    }
  }
  const cyclic = unique.filter((it) => !depth.has(idOf(it)));
  if (cyclic.length) {
    warnings.push(
      `${noun} parenting forms a cycle: ${cyclic.map(idOf).join(" -> ")}. `
      + `Breaking it — these are treated as root ${noun.toLowerCase()}s.`,
    );
    for (const it of cyclic) { parent.set(idOf(it), null); depth.set(idOf(it), 0); }
  }

  // 4. emit parent-before-child, keeping declaration order inside a depth so the graph
  // is stable across saves (an unstable order would churn the scene graph every rebuild)
  const order = unique
    .map((item, i) => ({ item, id: idOf(item), parentId: parent.get(idOf(item)) ?? null, depth: depth.get(idOf(item)) ?? 0, i }))
    .sort((a, b) => (a.depth - b.depth) || (a.i - b.i))
    .map(({ item, id, parentId, depth: d }) => ({ item, id, parentId, depth: d }));

  return { order, warnings };
}

/**
 * Resolve a flat joint list into a hierarchy.
 *
 * `pivotOf` supplies the pivot per joint so this stays pure and testable — callers pass
 * a closure over resolveJointPivot(joint, anchors) so anchor-backed joints re-derive
 * from the live build, while a test can pass the stored pivot directly.
 *
 * Degenerate rigs are REPAIRED, not rejected: an unknown parent, a cycle or a duplicated
 * part re-roots the offending joint and records a warning. A rig that is 90% right should
 * render 90% right and say what is wrong, rather than showing a blank viewport.
 */
export function buildJointTree(
  joints                                          ,
  pivotOf                                             ,
)            {
  const h = resolveHierarchy(joints, (j) => j.id, (j) => j.parent, "Joint");
  const warnings = [...h.warnings];
  const byId = new Map                   ();
  const order              = [];
  const partToJoint = new Map                ();

  for (const n of h.order) {
    const j = n.item;
    const pivot = pivotOf(j);
    const parentPivot = n.parentId ? (byId.get(n.parentId)?.pivot ?? ZERO) : ZERO;
    const node            = {
      joint: j,
      pivot,
      basePos: [pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]],
      parentId: n.parentId,
      depth: n.depth,
    };
    byId.set(j.id, node);
    order.push(node);

    // Part ownership. FIRST declaration wins, and a conflict is now LOUD. It used to be
    // a bare Map, so a later joint silently stole a part and the rig came apart only
    // when posed — the exact class of bug this module exists to end.
    for (const part of j.parts ?? []) {
      const owner = partToJoint.get(part);
      if (owner && owner !== j.id) {
        warnings.push(
          `Part "${part}" is claimed by both "${owner}" and "${j.id}". Keeping "${owner}". `
          + `With a joint hierarchy a part belongs to ONE joint — its parent joints move it `
          + `automatically, so it should not be listed on them too.`,
        );
        continue;
      }
      partToJoint.set(part, j.id);
    }
  }

  return { order, byId, partToJoint, warnings };
}

/** One driven joint, flattened for the render loop. `id`/`sourceId` are whatever KEY the
 *  caller poses by — plain joint ids for a single model, `${instanceId}::${jointId}` for
 *  an assembly member — so this stays agnostic about which of the two it is looking at. */
                              
             
                   
                
                 
              
              
 

/**
 * Resolve driven joint values in place (t14-rig R4).
 *
 * `driven` composes VALUES, where `parent` composes TRANSFORMS — a gear pair, two doors
 * opening together at ratio −1, a lid stay tracking a lid. The two are orthogonal and a
 * joint may use either or both.
 *
 * Resolution is a bounded fixed point rather than a topological sort, deliberately: a
 * driver chain is a handful of entries at most, one pass per entry is guaranteed to
 * settle any acyclic graph, and it TERMINATES on a cyclic one instead of needing a
 * separate cycle detector on the hot path. A cycle simply stops converging and the
 * values stay wherever the last pass left them — bounded and boring, which is what you
 * want 60 times a second. add_joint refuses the cycle at authoring time.
 *
 * A driven joint whose source is missing keeps its own target rather than snapping to
 * zero: a rig with one bad reference should still pose, and the missing name is reported
 * at authoring time where it can be read.
 */
export function resolveDrivenTargets(driven                        , targets                     )       {
  if (!driven.length) return;
  for (let pass = 0; pass < driven.length; pass++) {
    let changed = false;
    for (const d of driven) {
      const src = targets.get(d.sourceId);
      if (src === undefined) continue;
      const v = Math.max(d.min, Math.min(d.max, src * d.ratio + d.offset));
      if (targets.get(d.id) !== v) { targets.set(d.id, v); changed = true; }
    }
    if (!changed) break;
  }
}

/** Flatten a joint map into driver entries. `keyOf` maps a joint id to the key the caller
 *  poses by, which is what makes this work for both a single model and an assembly member. */
export function collectDrivers                                 (
  groups                ,
  keyOf                                               ,
)                {
  const out                = [];
  for (const [key, entry] of groups) {
    const d = entry.joint.driven;
    if (!d?.source) continue;
    out.push({
      id: key,
      sourceId: keyOf(d.source, key),
      ratio: d.ratio ?? 1,
      offset: d.offset ?? 0,
      min: entry.joint.min,
      max: entry.joint.max,
    });
  }
  return out;
}

/**
 * Which joint a click on `partName` should actually drive.
 *
 * The owning joint, except when that joint is DRIVEN: a driven value is recomputed from
 * its source every frame, so setting it directly is overwritten immediately and the part
 * reads as unresponsive — click a door of a geared pair and nothing happens. Walking up
 * to the first undriven source drives what the user meant.
 *
 * Shared by all three click surfaces (Studio model, Studio assembly, embed) so a door
 * behaves identically wherever it is clicked, rather than each re-deriving the rule.
 */
export function jointForPartClick(
  joints                                          ,
  partName        ,
)                    {
  const list = joints ?? [];
  // First declaration wins, matching buildJointTree's part ownership exactly — the two
  // must agree or a click drives a different joint than the one that owns the part.
  const owner = list.find((j) => (j.parts ?? []).includes(partName));
  if (!owner) return null;
  const byId = new Map(list.map((j) => [j.id, j]));
  const seen = new Set        ();
  let cur = owner;
  while (cur.driven?.source && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next = byId.get(cur.driven.source);
    if (!next) break;      // dangling source: drive the joint itself rather than nothing
    cur = next;
  }
  return cur;
}

/** Log tree warnings once per (model, message) — the render effect re-runs on every
 *  rebuild and an honest warning that repeats 60x becomes noise. Mirrors warnJointAnchor. */
const warnedTrees = new Set        ();
export function warnJointTree(tree           , scope = "")       {
  for (const w of tree.warnings) {
    const key = `${scope}::${w}`;
    if (warnedTrees.has(key)) continue;
    warnedTrees.add(key);
    console.warn(`[joints] ${w}`);
  }
}
