// Oriented bounding box — the BLANK a tilted part is actually cut from.
//
// Why this exists: the cut list took thickness from the minimum AXIS-ALIGNED bbox
// dimension (cutlist.ts, `dims.indexOf(Math.min(...dims))`). For an axis-aligned
// panel that is correct. For a part that is tilted in world space it is fiction —
// the Dog House's sloped 20 mm roof reported a 261 mm "thickness", because its
// vertical extent is the drop across the span plus the board:
//   roofSlope × span + roofThk = 0.2619 × 920 + 20.
// It listed as 920 × 820 × 261 Walnut and fed nest_sheets that number.
//
// OCC answers this exactly: BRepBndLib::AddOBB returns the minimal box in the
// part's OWN frame, so a tilted slab reports 920 × 820 × 20 — its real blank.
//
// ⚠ TWO BUILD REGISTRIES CALL THIS, and they must agree or the same model reports
// different cut dims depending on who built it:
//   · app/cadWorker.ts  — the browser build (interactive cut list)
//   · scripts/headless/runner.mjs — the Node build (geometry service → MCP/nest)
// It lives here, imported by both, rather than mirrored in each. Keep it free of
// replicad imports: it takes the raw OC module + a wrapped TopoDS_Shape, which is
// all either caller has in common.
//
// See context/doghouse-sweep-fix-plan.md § B1b.

/** Extents along the box's OWN axes — NOT world w/d/h. Shares the bbox field names
 *  so consumers can treat it as a drop-in dimension triple (the cut list sorts
 *  them anyway); never read `w` as "the world X size" of an oriented box. */
                                  
            
            
            
 

/** `optimal` = false: PCA over the existing triangulation. Measured against the
 *  exact algorithm across panels, tilted slabs, filleted boxes, L-brackets, drilled
 *  panels and a cylinder — identical dims to 0.01 mm, and 0.1–0.3 ms/part instead
 *  of 2.4–22 ms. Exact costs more than the whole rest of the build on a filleted
 *  part, for an answer that did not differ. */
const USE_OPTIMAL = false;

let warned = false;

/**
 * ⚠⚠ THE CEILING IS ONLY AS SHARP AS THE MESH IT CAME FROM (t42-residue 5).
 *
 * Since occ-js 1.0.0, `shape.mesh()` returns SINGLE-precision vertices, while `Bnd_OBB`
 * is exact double on both kernels — and BOTH build registries derive the `aabb` handed
 * in here from mesh vertices (`runner.mjs` `bbox()`, `cadWorker.ts` `aabbSizes()`). So
 * the ceiling below compares an exact number against one carrying ~6e-8 relative error,
 * and measured on the installed kernel that noise DECIDES the answer:
 *
 *   a flat 400 × 300 × 6.35 panel meshes to 6.3499999046325683594 — exactly
 *   float32(6.35) — and its OBB measures 6.3500000000000049738, so the OBB "exceeds"
 *   the ceiling by 8e-16 relative and is THROWN AWAY.
 *
 * That is not a rounding curiosity, because the cut list coalesces on a 1-decimal key
 * (`cutlist.ts` `r1`): the discarded OBB rounds to 6.4 and the float32 AABB rounds to
 * 6.3, so the SAME 6.35 mm board listed 6.3 flat and 6.4 tilted — a tilted part's AABB
 * is far too big for the ceiling to bind, so only the flat one lost its OBB. Two
 * instances of one board reported two thicknesses and did not coalesce.
 *
 * So the ceiling carries the mesh's own slack. `MESH_SLACK` is two orders of magnitude
 * above float32's 5.96e-8 ULP and four below any fit this rule exists to refuse — on a
 * 400 × 300 × 6.35 blank it is 0.00006 mm of thickness.
 */
const MESH_SLACK = 1e-5;

/**
 * Minimal oriented box for a shape, in mm.
 *
 * `aabb` (when the caller has it) is a CEILING, not a fallback: the PCA fit is not
 * guaranteed to beat the axis-aligned box, and a "blank" larger than the AABB would
 * be a worse answer than the one we are replacing. Whichever box is smaller wins —
 * but only by more than `MESH_SLACK` above, never by float32 noise.
 *
 * Returns null when OCC can't answer (empty/void shape, or the binding throws) —
 * the caller then keeps the AABB, i.e. today's behaviour. That degradation is not
 * silent downstream: a tilted part on AABB dims still trips cutlist.ts's `mismatch`
 * flag, which is what surfaced this bug in the first place.
 */
export function orientedExtents(
  oc     ,
  wrapped     ,
  aabb                                      ,
)                         {
  if (!oc?.Bnd_OBB || !oc?.BRepBndLib?.AddOBB || !wrapped) return null;
  let box      = null;
  try {
    box = new oc.Bnd_OBB();
    oc.BRepBndLib.AddOBB(wrapped, box, /* useTriangulation */ true, USE_OPTIMAL, /* useShapeTolerance */ false);
    if (box.IsVoid?.()) return null;
    const dims = [box.XHSize() * 2, box.YHSize() * 2, box.ZHSize() * 2];
    if (!dims.every((n) => Number.isFinite(n) && n >= 0)) return null;
    if (aabb) {
      const aabbDims = [aabb.w, aabb.d, aabb.h];
      if (aabbDims.every((n) => Number.isFinite(n) && n > 0)) {
        const vol = (d          ) => d[0] * d[1] * d[2];
        if (vol(dims) > vol(aabbDims) * (1 + MESH_SLACK)) return { w: aabb.w, d: aabb.d, h: aabb.h };
      }
    }
    return { w: dims[0], d: dims[1], h: dims[2] };
  } catch (err) {
    // Report once per process/worker: losing the OBB means tilted parts silently
    // go back to reporting a fictional thickness, and that must be findable.
    if (!warned) {
      warned = true;
      console.warn("[obb] oriented bounding box unavailable — tilted parts will report axis-aligned dims:", err);
    }
    return null;
  } finally {
    try { box?.delete(); } catch { /* already freed */ }
  }
}
