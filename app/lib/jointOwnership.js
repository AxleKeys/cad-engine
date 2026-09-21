// WHO DECLARED THIS JOINT — the one predicate that separates a model's two joint populations,
// and the one gate that keeps them from becoming two truths.
//
// ⭐⭐ The rule (spine S4 / create-language-plan.md §h C1, HK's ruling 2026-09-17): a model's
// own program may declare its degrees of freedom with `api.joint()`, and what it declares is
// a PROJECTION of the current code — one set, re-derived on every build, allowed to change
// and to disappear when the code does. Everything a person or a tool authored is stored and
// never touched by a re-derive. Both halves live in `data.joints` side by side, so every
// writer has to answer "is this mine to replace?" — and it must answer it the same way in
// Studio, in the worker and over MCP, or the two answers become two sets. That is the Motion
// pool's 2026-08-23 accumulation bug, and this module exists so it is not reborn one room over.
//
// ⚠ Dependency-free ON PURPOSE (types only, the `frameOwnership.ts` law). `worker/index.js`
// imports it under wrangler and `mcp/` imports it under Node's type-stripping, which resolves
// nothing — a single runtime import here would break both. Keep it that way.
//
// ⭐⭐ THE LAW: THIS PREDICATE FAILS TOWARD "AUTHORED", the same direction `isDerivedFrame`
// fails. A joint with no badge — every joint that existed before this shipped — is a person's
// work and survives every build. A badge nobody here recognises is read as authored too, and
// that is the recoverable direction: the re-derive walks around it instead of deleting
// somebody's rig, and joint writes have no undo.

                                          

/** The reserved `stagedBy` value for a joint the model's own CODE declares.
 *
 *  ⭐ It names the HATCH, not just the writer: every refusal this module mints prints it, and
 *  "api.joint" is the exact thing the reader has to go and edit. `SEQUENCE_STAGE` and
 *  `INSTRUCTIONS_STAGE` name their writer for the same reason — one field, one sweep. */
export const CODE_STAGE = "api.joint";

/** THE FIELDS THE PROGRAM OWNS — everything `resolveDeclaredJoints` writes onto a declared
 *  joint, and therefore everything a tool may not touch on one.
 *
 *  ⭐⭐ The rule is mechanical, not a taste call: **a field the declaration writes is the
 *  code's; a field it does not write is the tool's.** That is what leaves `default` (the rig's
 *  resting articulation — `apply_rig_pose`, t14-rig R5) and `group` (a presentational region
 *  tag) editable on a code-declared joint, while `type`, `parts`, `anchor`, `axis`, `min`,
 *  `max`, `parent`, `driven` and `label` are not: re-deriving cannot collide with a field the
 *  program never states, and it silently overwrites every field the program does.
 *
 *  ⚠ `id` and `stagedBy` are the joint's IDENTITY, not content — they are checked separately
 *  (a write may not re-id a declared joint, and may not mint the badge by hand).
 *  `test:jointsdeclared` asserts that every key a declaration emits appears here, so adding a
 *  field to the spec and forgetting this list goes red instead of quietly becoming editable. */
export const DECLARED_FIELDS = ["label", "type", "parts", "pivot", "anchor", "axis", "min", "max", "parent", "driven"]         ;

/** Fields a declared joint CARRIES ACROSS a re-derive — the tool's half of the same joint.
 *  Kept from the stored record because the program never states them, so re-deriving from the
 *  program alone would silently reset a pose or a region tag on every build. */
export const CARRIED_FIELDS = ["default", "group"]         ;

/** True when the model's own program declared this joint, and a build is therefore allowed to
 *  replace it.
 *
 *  ⭐ EXACT-MATCH ON THE STAGE, never "any non-empty badge" — the `isInstructionFrame` shape.
 *  The set this scopes is "what `api.joint()` minted", and a second derived writer appearing
 *  later must not be adopted by this one's re-derive. Reading an unknown badge as authored is
 *  the safe direction: nothing is deleted, and the collision is REPORTED by the merge. */
export function isDeclaredJoint(j                                                 )          {
  return j?.stagedBy === CODE_STAGE;
}

/** Split a joint list into the program's half and everything a re-derive must carry through. */
export function partitionDeclaredJoints                                        (
  joints                                 ,
)                                   {
  const declared      = [];
  const authored      = [];
  for (const j of joints ?? []) (isDeclaredJoint(j) ? declared : authored).push(j);
  return { declared, authored };
}

const sameValue = (a         , b         )          =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

                                
                                                                                                        
                       
                  
                    
                    
                                                                                                 
                                                                                             
                      
                                                                                                 
                   
  

/** ⭐⭐ THE RE-DERIVE. Fold what THIS build's code declares into what the model stores.
 *
 *  `declared` is the build's answer, and it must be an ARRAY. ⚠⚠ Never call this with the
 *  declarations of a build that could not report them: absent is "this build cannot tell" and
 *  `[]` is the claim "this code declares none", and passing the first as the second wipes the
 *  whole derived set. That distinction is the entityReport law (app/lib/entityReport.ts) with a
 *  worse consequence, because this one WRITES — the caller checks `Array.isArray` at its own
 *  door and does nothing when the field is missing.
 *
 *  Non-declared fields survive (`CARRIED_FIELDS`), and a carried `default` is clamped into the
 *  program's current range: a resting value captured before a range narrowed must not pose the
 *  rig somewhere its own code now forbids (the `apply_rig_pose` precedent). */
export function mergeDeclaredJoints(
  stored                                          ,
  declared                       ,
)                   {
  const prior = stored ?? [];
  const authoredIds = new Set(prior.filter((j) => !isDeclaredJoint(j)).map((j) => j.id));
  const priorDeclared = new Map(prior.filter(isDeclaredJoint).map((j) => [j.id, j]));

  const conflicts           = [];
  const next = new Map                    ();
  for (const d of declared) {
    if (authoredIds.has(d.id)) { conflicts.push(d.id); continue; }
    const was = priorDeclared.get(d.id);
    const carried                          = {};
    for (const f of CARRIED_FIELDS) if (was?.[f] !== undefined) carried[f] = was[f];
    if (typeof carried.default === "number") carried.default = Math.max(d.min, Math.min(d.max, carried.default));
    next.set(d.id, { ...d, ...carried }              );
  }

  // Stable order: walk the stored list first so nothing a person sees moves, then append the
  // ids this build newly declared, in declaration order.
  const joints               = [];
  const updated           = [];
  const removed           = [];
  const placed = new Set        ();
  for (const j of prior) {
    if (!isDeclaredJoint(j)) { joints.push(j); continue; }
    const fresh = next.get(j.id);
    if (!fresh) { removed.push(j.id); continue; }
    joints.push(fresh);
    placed.add(j.id);
    if (!sameValue(j, fresh)) updated.push(j.id);
  }
  const added           = [];
  for (const d of declared) {
    const fresh = next.get(d.id);
    if (!fresh || placed.has(d.id)) continue;
    joints.push(fresh);
    placed.add(d.id);
    added.push(d.id);
  }
  return {
    joints, added, updated, removed, conflicts,
    changed: added.length > 0 || updated.length > 0 || removed.length > 0,
  };
}

/** ⭐⭐ THE OWNERSHIP REFUSAL, at the DOOR. Judge a proposed whole-array joints write against
 *  what is stored, and return the sentence that refuses it — or null.
 *
 *  ⚠⚠ THIS LIVES ABOVE THE DATA OWNER ON PURPOSE. `update_joint` and `remove_joint` are the
 *  two verbs the ruling names, but they are not the only writers of `data.joints`: every
 *  mutation in the joints room is a read-modify-write that resends the WHOLE array
 *  (`apply_rig_pose`, `save_rig_pose`, `delete_rig_pose` and `add_joint` all do), and any tool
 *  added later will do the same. Refusing in the two named tools would leave a sibling writer
 *  that silently rewrites a declared joint, which is the whole failure mode
 *  [[feedback_gate_lives_above_the_data_owner]] [[feedback_unvalidated_sibling_writer]].
 *
 *  ◆ Onshape's rule for a part-level mate connector — it "must be edited in its original
 *  location" — which is why every refusal here names the hatch rather than only saying no. */
export function declaredJointRefusal(
  stored                                          ,
  proposed                       ,
)                {
  const hatch = (id        ) =>
    `Edit the api.joint("${id}", …) call in the model's code and push it (push_model_code) — the joint is re-derived on the build — `
    + `or add_joint an authored sibling if you want one this program does not own. Nothing was written.`;
  const priorDeclared = new Map((stored ?? []).filter(isDeclaredJoint).map((j) => [j.id, j]));
  const proposedById = new Map(proposed.map((j) => [j?.id, j]));

  for (const [id, was] of priorDeclared) {
    const now = proposedById.get(id);
    if (!now) {
      return `Joint "${id}" is declared by this model's own code (api.joint), so it cannot be removed here — the next build would declare it again. ${hatch(id)}`;
    }
    if (!isDeclaredJoint(now)) {
      return `Joint "${id}" is declared by this model's own code (api.joint), and this write drops that mark — which would leave a second, frozen copy the next build cannot update. ${hatch(id)}`;
    }
    for (const f of DECLARED_FIELDS) {
      if (!sameValue(was[f], now[f])) {
        return `Joint "${id}" is declared by this model's own code (api.joint), so its \`${f}\` cannot be changed here — the next build would overwrite the edit and nothing would say why. ${hatch(id)}`;
      }
    }
  }
  for (const j of proposed) {
    if (!isDeclaredJoint(j) || priorDeclared.has(j?.id)) continue;
    return `Joint "${j.id}" is marked as declared by model code, but this model's code does not declare it. A code-declared joint is minted by the BUILD, never by a write — add_joint creates an authored joint, or add api.joint("${j.id}", …) to the model's code and push it. Nothing was written.`;
  }
  return null;
}
