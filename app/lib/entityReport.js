// The build's ENTITY REPORT — what named spatial entities the code declared, and whether
// that answer is still about the code in hand. t13-workspace P3b, ADR-4.
//
// PURE. Type-only imports, no DOM, no Node — so the identical module runs in the browser
// worker (app/cadWorker.ts), in the Studio tab, and in the headless runner
// (scripts/headless/runner.mjs), the way obb.ts and execProfile.ts already do. One shape,
// one freshness rule, one place.
//
// ── WHY A REPORT OBJECT AND NOT A BARE ARRAY ──────────────────────────────────
//
// `api.anchor()` posts a bare `ModelAnchor[]`, and that is fine for anchors: the ONLY
// consumer is the assembly solver, which resolves them the moment they arrive and says
// "Waiting for build…" when the key is absent. Entities are read differently — Studio holds
// the last report in STATE and draws boxes from it, so the interesting question is not
// "did a build report this" but "does this report describe the code the user is looking at".
// Those come apart constantly:
//
//   • an agent pushes new code and the tab has not rebuilt yet;
//   • the user edits a param and the build FAILS — the last successful report survives in
//     state, describing geometry that no longer exists;
//   • a persisted (IndexedDB) build predates a field a consumer needs.
//
// In all three the honest answer is **ABSENT** — not "no entities". `partsManifest` already
// learned this the expensive way: an unstamped manifest was preferred unconditionally and
// shadowed a corrected headless build forever (app/lib/cutlist.ts:13-23,
// PARTS_MANIFEST_VERSION). So a report carries the same two stamps for the same two
// questions — `v` says it has the right FIELDS, `codeHash` says it describes the right
// BUILD — and `freshEntities()` returns **null** rather than `[]` whenever either fails.
//
// ⭐ null ≠ [] is load-bearing all the way through: resolveWorkspaceState maps a null
// `reportedEntityIds` to entityState "unknown" (no verdict), and an EMPTY array to
// "unreported" (a real finding, surfaced as a sentence). A checker that cannot see must not
// invent a verdict about what it cannot see. [[feedback_silent_catch_hides_holes]]

/** One named entity, as REPORTED BY A BUILD. Never stored on the model: these are
 *  recomputed from the live parameters every build, so a bay declared at
 *  `[x0, y0, z0] … [x0 + bayW, …]` follows its parameters instead of going stale the way
 *  stored coordinates would (ADR-4 — the static-joint-pivot failure, not repeated).
 *
 *  `id` joins to `WorkspaceEntity.id` in the manifest: the manifest holds MEANING (label,
 *  which interactions apply), the build holds GEOMETRY. Coordinates are model-local OCC
 *  (z up), the same frame as ModelAnchor.origin and ModelJoint.pivot. */
                              
                                                                                           
             
                                  
                                                                                     
                                                                                  
                 
                                
                                
                                                                                            
                                
 

/** Bump when a FIELD IS ADDED to ModelEntity that a consumer needs. An older-stamped report
 *  is treated as ABSENT, never as authoritative — the PARTS_MANIFEST_VERSION rule, and it
 *  lives beside the type for the same reason: every writer and every reader already imports
 *  this module, so there is no second place to remember. */
export const ENTITY_REPORT_VERSION = 1;

/** What a build says about the named entities its code declared. */
                               
                                                        
            
                                                                                          
                                                                           
                   
                                                                                          
                                                                          
                          
 

/**
 * The entities a caller is allowed to act on — or **null**, meaning "cannot see".
 *
 * Returns null when: there is no report · it predates the current schema · it was produced
 * from different code than the caller is holding · the caller does not yet know its own
 * code hash. Every one of those is "I don't know", and none of them is "there are none".
 *
 * ⚠ Do not soften this into `?? []` at a call site. The whole point is that the empty array
 * is a claim and this function refuses to make it on evidence it doesn't have.
 */
export function freshEntities(
  report                                 ,
  liveCodeHash                           ,
)                       {
  if (!report || !Array.isArray(report.entities)) return null;
  if (report.v !== ENTITY_REPORT_VERSION) return null;
  if (!liveCodeHash || !report.codeHash || report.codeHash !== liveCodeHash) return null;
  return report.entities;
}

/** Why `freshEntities` returned null, as a sentence — so a panel can say which kind of
 *  "don't know" it is instead of rendering the same blank for all four. */
export function entityReportState(
  report                                 ,
  liveCodeHash                           ,
)                                            {
  if (!report || !Array.isArray(report.entities)) {
    return { fresh: false, reason: "No build has reported this model's named entities yet." };
  }
  if (report.v !== ENTITY_REPORT_VERSION) {
    return { fresh: false, reason: `That build's entity report is version ${report.v}; this build of Studio reads version ${ENTITY_REPORT_VERSION}. Rebuild the model to get a current one.` };
  }
  if (!liveCodeHash) return { fresh: false, reason: "Still reading the model's current code." };
  if (!report.codeHash || report.codeHash !== liveCodeHash) {
    return { fresh: false, reason: "The code has changed since the last successful build, so the reported bays describe geometry that is no longer on screen. Rebuild to bring them back." };
  }
  return { fresh: true, reason: null };
}

/** Entity ids for `WorkspaceContext.reportedEntityIds` — null propagates unchanged, which is
 *  what makes resolveWorkspaceState answer "unknown" instead of "unreported". */
export const reportedEntityIds = (entities                      )                  =>
  entities ? entities.map((e) => e.id) : null;

/** Centre of a reported entity, model-local OCC. */
export const entityCenter = (e             )                           => [
  (e.min[0] + e.max[0]) / 2,
  (e.min[1] + e.max[1]) / 2,
  (e.min[2] + e.max[2]) / 2,
];

/** Size of a reported entity, model-local OCC. */
export const entitySize = (e             )                           => [
  e.max[0] - e.min[0],
  e.max[1] - e.min[1],
  e.max[2] - e.min[2],
];

/**
 * The ghost box for a preview, from an entity's REPORTED bounds and a declared
 * `preview` hint on the interaction. Pure arithmetic — no build, no OCC, no round trip.
 *
 * The hint is declarative on purpose. A shelf is a horizontal slab and a divider is a
 * vertical one, and nothing in `{"op":"shelf","at":0.5}` says which: the entry's vocabulary
 * belongs to the MODEL, not to this file, so guessing an axis from a field name would be
 * inventing meaning the manifest never granted. An interaction that declares no `preview`
 * gets no ghost — and the confirm step shows the entry itself instead, which is honest.
 */
export function ghostBoxFor(
  entity             ,
  preview                                                              ,
  ratio        ,
)                                                                          {
  const axisIndex = preview.axis === "x" ? 0 : preview.axis === "y" ? 1 : 2;
  const size = entitySize(entity);
  const span = size[axisIndex];
  if (!Number.isFinite(ratio) || !Number.isFinite(span) || span <= 0) return null;
  const t = Number.isFinite(preview.thickness) && (preview.thickness          ) > 0
    ? (preview.thickness          )
    : Math.max(span * 0.02, 1);
  const clamped = Math.max(0, Math.min(1, ratio));
  const at = entity.min[axisIndex] + span * clamped;
  // Kept inside the bay: a ghost hanging out of the box it belongs to reads as a bug in the
  // preview rather than as a value near the end of its range.
  const lo = Math.max(entity.min[axisIndex], Math.min(at - t / 2, entity.max[axisIndex] - t));
  const min                           = [...entity.min]                            ;
  const max                           = [...entity.max]                            ;
  min[axisIndex] = lo;
  max[axisIndex] = lo + t;
  return { min, max };
}
