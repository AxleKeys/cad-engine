// `api.entity()` — validation of one declaration, and the cross-check of a whole build's
// declarations. t13-workspace P3b (bay / zone / family) and sub-assemblies-plan G1
// (subassembly, plus a family's own `pattern`).
//
// ⭐⭐ WHY THIS IS ONE SHARED MODULE AND NOT A MIRRORED PAIR ANY MORE. Until G1, `declareEntity`
// lived twice — `app/cadWorker.ts` and `packages/engine/runner.mjs` — with a comment on each
// asking the next reader to keep the error strings in step. That was tolerable while an entity
// only reported a box: two copies could at worst say two different things. G1 makes the
// declaration WRITE — a `family` with a `pattern` and a `subassembly` mint PartGroups
// (workspaceManifest.ts `entityGroupsToCreate`) — so two copies would now produce two GROUP
// SETS for one program, which is the argument `jointDeclare.ts` already made for joints. Both
// runtimes call these two functions, and there is nothing left to keep in step.
//
// ⚠ The `entity:` KEY still lives in each runtime's `buildApi` literal and its implementation
// stays OUTSIDE that literal: `scripts/lib/apiKeys.mjs` derives the runtime API surface by
// reading the literal's `key:` pairs, so an inline signature would register its own parameter
// names as phantom API functions.
//
// ⚠ Dependency-free (type-only imports, erasable TypeScript only): `packages/engine/runner.mjs`
// imports it under Node's type-stripping and `scripts/export-cad-engine.mjs` type-erases it
// into the published package.

                                                     

/** Every kind `api.entity()` accepts. bay / zone are REGIONS (a box is the whole point);
 *  family / subassembly name PARTS (a box is optional — give one when the region should be
 *  selectable). */
export const ENTITY_DECL_KINDS = ["bay", "zone", "family", "subassembly"]         ;

/** Kinds whose `min`/`max` may be omitted. */
const BOX_OPTIONAL = new Set        (["family", "subassembly"]);

/** The keys a subassembly declaration may carry. A NEW kind, so an unknown key is refused
 *  outright — `members:` for `parts:` accepted and dropped would leave the door ungrouped with
 *  nothing saying why. The legacy kinds are not held to this (old code may carry extras). */
const SUBASSEMBLY_KEYS = ["kind", "label", "min", "max", "pattern", "parts", "children"];

/** What a model's code hands `api.entity()`. */
                             
                               
                 
                                 
                                 
                                                                                
                   
                                                                                           
                   
                                                                               
                      
 

const isFiniteTriple = (v         )                                =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

const isNameList = (v         )                =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim().length > 0);

/**
 * Validate one `api.entity(id, spec)` call and return the record the build reports.
 *
 * Throws rather than recording a bad declaration: an inverted box renders as a target nobody
 * can hit, and a grouping declaration with a typo in its shape groups nothing — both are found
 * long after the build unless the build refuses them against the offending line.
 */
export function validateEntitySpec(id        , spec            )                 {
  if (!id || typeof id !== "string") throw new Error("api.entity(id, spec): id must be a non-empty string");
  if (!spec || typeof spec !== "object") throw new Error(`api.entity("${id}"): the second argument must be { kind, label, min, max }`);
  if (!(ENTITY_DECL_KINDS                     ).includes(spec.kind          ))
    throw new Error(`api.entity("${id}"): kind must be "bay", "zone", "family" or "subassembly" — got ${JSON.stringify(spec.kind)}`);
  const kind = spec.kind;

  if (kind === "subassembly") {
    const extra = Object.keys(spec).filter((k) => !SUBASSEMBLY_KEYS.includes(k));
    if (extra.length)
      throw new Error(`api.entity("${id}"): a subassembly takes ${SUBASSEMBLY_KEYS.join(", ")} — got ${extra.map((k) => `"${k}"`).join(", ")}. Its direct parts go in \`parts\` (or \`pattern\`), its families in \`children\`.`);
  }

  // ── The box ────────────────────────────────────────────────────────────────
  const hasBox = spec.min !== undefined || spec.max !== undefined;
  if (hasBox || !BOX_OPTIONAL.has(kind)) {
    for (const k of ["min", "max"]         ) {
      if (!isFiniteTriple(spec[k]))
        throw new Error(`api.entity("${id}"): ${k} must be [x, y, z] finite numbers`);
    }
    const min = spec.min                            ;
    const max = spec.max                            ;
    const axes = ["x", "y", "z"];
    for (let i = 0; i < 3; i++) {
      if (max[i] < min[i])
        throw new Error(`api.entity("${id}"): max ${axes[i]} (${max[i]}) is below min ${axes[i]} (${min[i]}) — the corners are swapped, and an inverted box cannot be drawn or clicked`);
    }
  }
  if (spec.label !== undefined && typeof spec.label !== "string")
    throw new Error(`api.entity("${id}"): label must be a string when given`);

  // ── The grouping fields (G1) ───────────────────────────────────────────────
  if (spec.pattern !== undefined) {
    if (kind !== "family" && kind !== "subassembly")
      throw new Error(`api.entity("${id}"): pattern only applies to a "family" or a "subassembly" — a ${kind} is a region, not a set of parts`);
    if (typeof spec.pattern !== "string" || !spec.pattern.trim())
      throw new Error(`api.entity("${id}"): pattern must be a non-empty part-name rule like "Slat *" ("*" is the only wildcard)`);
  }
  for (const k of ["parts", "children"]         ) {
    if (spec[k] === undefined) continue;
    if (kind !== "subassembly")
      throw new Error(`api.entity("${id}"): ${k} only applies to a "subassembly"${kind === "family" ? " — a family's members follow its pattern, and it cannot contain other groups" : ""}`);
    if (!isNameList(spec[k]))
      throw new Error(`api.entity("${id}"): ${k} must be a non-empty array of ${k === "parts" ? "part names" : "entity ids"}`);
  }
  // A family with neither a box nor a pattern is a declaration that does nothing — no region to
  // select, no rule to group by — and accepting it would let the author believe it worked.
  if (kind === "family" && !hasBox && spec.pattern === undefined)
    throw new Error(`api.entity("${id}"): a family needs a pattern (its parts' names, like "Slat *") to group them, or min and max to make it a selectable region — it has neither, so it would do nothing`);
  if (spec.pattern !== undefined && spec.parts !== undefined)
    throw new Error(`api.entity("${id}"): give a subassembly a pattern OR a parts list, not both — one rule per group. Repeating parts belong in a child family (children), fixed ones in parts.`);
  if (spec.children) {
    if (spec.children.includes(id))
      throw new Error(`api.entity("${id}"): a subassembly cannot contain itself`);
    const dup = spec.children.find((c, i) => spec.children .indexOf(c) !== i);
    if (dup) throw new Error(`api.entity("${id}"): children names "${dup}" twice`);
  }

  return {
    id,
    kind,
    ...(spec.label ? { label: spec.label } : {}),
    ...(hasBox || !BOX_OPTIONAL.has(kind) ? { min: spec.min, max: spec.max } : {}),
    ...(spec.pattern !== undefined ? { pattern: spec.pattern } : {}),
    ...(spec.parts ? { parts: [...spec.parts] } : {}),
    ...(spec.children ? { children: [...spec.children] } : {}),
  };
}

/**
 * Cross-check a whole build's declarations, after `main()` returned (a subassembly may name a
 * family declared further down the file). Throws on the first contradiction the code alone
 * makes certain — a child that is not declared, is not a family, or sits in two subassemblies.
 * Overlaps between RULES need the built part names and the model's stored groups, so those are
 * judged where groups are minted (workspaceManifest.ts `entityGroupsToCreate`), as warnings.
 */
export function checkDeclaredEntities(entities                  )       {
  const byId = new Map(entities.map((e) => [e.id, e]         ));
  const parentOf = new Map                ();
  for (const e of entities) {
    if (e.kind !== "subassembly" || !e.children) continue;
    for (const c of e.children) {
      const child = byId.get(c);
      if (!child) {
        const fams = entities.filter((x) => x.kind === "family").map((x) => `"${x.id}"`);
        throw new Error(`api.entity("${e.id}"): child "${c}" is not declared in this build — children name api.entity(id, { kind: "family", pattern }) declarations in the same code. Declared families: ${fams.length ? fams.join(", ") : "(none)"}`);
      }
      if (child.kind !== "family")
        throw new Error(`api.entity("${e.id}"): child "${c}" is a ${child.kind}, and a subassembly contains only families — one level, no subassembly inside a subassembly`);
      if (!child.pattern)
        throw new Error(`api.entity("${e.id}"): child "${c}" is a family with no pattern, so it groups no parts and there is nothing to put inside "${e.id}" — give it a pattern, e.g. api.entity("${c}", { kind: "family", pattern: "Slat *" })`);
      const other = parentOf.get(c);
      if (other) throw new Error(`api.entity("${e.id}"): family "${c}" is already a child of subassembly "${other}" — a family sits in one subassembly`);
      parentOf.set(c, e.id);
    }
  }
}
