// `measure` — part-to-part clearance / interference, and one part's solidity — as ONE module with
// two callers (t31-kitchen, local-engine-plan §6l; admitted to the pack by §8 decision 7, RULED
// 2026-09-23):
//
//   • the hosted route  worker/index.js  POST /mcp/model/:id/measure  (the MCP `measure` tool)
//   • the local engine  packages/engine/cli.mjs  `axle measure`
//
// A person picks two things in the viewport and reads the distance; a headless agent can't. This
// measures the spatial relationship between two NAMED parts — per-axis gap/overlap/flush, the
// nearest 3D distance, and an interference flag — from a build's parts. Bbox-based: exact for
// axis-aligned rectangular parts (the furniture norm), CONSERVATIVE for rotated/shaped parts (the
// world-aligned box is bigger than the true shape). Feature-level ("this hole to that edge") is out
// of scope — Axle has no stable per-feature naming to address a hole or an edge.
//
// ⚠ This was computed INLINE in the worker's route until 2026-09-24. It moved here byte-for-byte in
// behaviour: test:kitchen runs the old route body (read from git at 7a14987c) and this function on
// the same real /validate-shaped builds and asserts identical status and body.
//
// ⭐ WHAT IT READS, AND THE ONE THING IT IS HANDED. `built` is a /validate-shaped build: `parts`
// (each `{ name, bbox, obb?, volume?, solids? }`) and `interference` (the per-pair verdicts BY NAME,
// app/lib/interference.ts interferencePairs — `null`/absent when this build could not report them).
// `solidity` is mcp/lib/solidity.js's function, passed IN rather than imported: app/ is a strict
// checkJs project and an app → mcp import drags that untyped JS into the typecheck (the reason
// app/lib/drawingLint.ts and motionDrift.ts give for the same choice). Both callers import the one
// solidity() and hand it over, so the sentence is still constructed in exactly one place.
//
// Pure: no I/O, and its one import is a TYPE (erased). The route wraps the answer in a Response;
// the CLI prints it.

                                                          

/** mcp/lib/solidity.js solidity(), as this module uses it. */
                                                                                                               

                                
                       
                                           
 

/** The route's HTTP status and JSON body. 200 = measured; 404 = a part name matched nothing;
 *  422 = the build produced no measurable part. */
                                                                                       

/**
 * Read a measure request — `{ part_a, part_b? }` — into trimmed part names, or a refusal. The
 * hosted route's body and the CLI's `--part-a` / `--part-b` both come through here, so "part_a is
 * required" and "names are trimmed, and a non-string is no name" are decided once (review round 1,
 * NIT 11). The refusal sentence is the route's 400 body, verbatim.
 */
export function readMeasureRequest(body     )                                                       {
  const partA = typeof body.part_a === "string" ? body.part_a.trim() : "";
  if (!partA) return { error: "Pass part_a (a part name). Get names from get_cutlist, get_part_groups, or a prior measure error's available_parts." };
  const partB = typeof body.part_b === "string" ? body.part_b.trim() : "";
  return { partA, partB };
}

/**
 * Measure `partA` alone (partB empty) or `partA` against `partB`. Names match exactly first, then
 * case-insensitively. Call it only on a model that BUILT: the body says `ok: true, built: true`,
 * as the route's does.
 */
export function measureParts(built               , partA        , partB        , solidity            )                {
  const v = built;
  const parts = (v.parts ?? []).filter((p     ) => p.bbox);
  const names = parts.map((p     ) => p.name);
  if (!parts.length) return { status: 422, body: { error: "The model built but produced no measurable parts." } };
  const find = (n        ) => parts.find((p     ) => p.name === n) || parts.find((p     ) => p.name?.toLowerCase() === n.toLowerCase());
  const a = find(partA);
  if (!a) return { status: 404, body: { error: `Part "${partA}" not found`, available_parts: names } };
  const r1 = (n        ) => Math.round(n * 100) / 100;
  // t12-loop-section ROUTE 1. The boxes are the cheap half and they cannot see
  // INSIDE a part: an 18×350 mortise cut clean through a shelf leaves the bounding
  // box identical to a solid shelf's, which is precisely why a driver could not
  // confirm its own cut. /validate has always returned the exact measured solid
  // volume, and the route once dropped it. mcp/lib/solidity.js turns it into the
  // verdict (and is the SAME module the build verdict prints from).
  const boxOf = (p     ) => ({
    name: p.name,
    size: { w: r1(p.bbox.sizeX), d: r1(p.bbox.sizeY), h: r1(p.bbox.sizeZ) },
    min: [r1(p.bbox.minX), r1(p.bbox.minY), r1(p.bbox.minZ)],
    max: [r1(p.bbox.maxX), r1(p.bbox.maxY), r1(p.bbox.maxZ)],
    center: [r1((p.bbox.minX + p.bbox.maxX) / 2), r1((p.bbox.minY + p.bbox.maxY) / 2), r1((p.bbox.minZ + p.bbox.maxZ) / 2)],
    // null (not absent) when this build could not measure a volume — the caller must
    // be able to tell "cannot tell" from "nothing was cut", the same three-outcome
    // rule `anchors` and `shared_volume` already follow on this route.
    solid: solidity(p, p.name),
    // How many solids the part is (app/lib/connectivity.ts). null, not absent, when this service
    // did not count them, under the same three-outcome rule as `solid` above.
    solids: Number.isInteger(p.solids) ? p.solids : null,
  });
  if (!partB) {
    const s = boxOf(a).solid;
    return {
      status: 200,
      body: {
        ok: true, built: true, mode: "single", units: "mm", part: boxOf(a),
        summary: s
          ? s.sentence
          : `"${a.name}" is ${r1(a.bbox.sizeX)} × ${r1(a.bbox.sizeY)} × ${r1(a.bbox.sizeZ)}mm at [${r1(a.bbox.minX)}, ${r1(a.bbox.minY)}, ${r1(a.bbox.minZ)}].`,
        note: "`size`/`min`/`max`/`center` describe the part's axis-aligned bounding box (width=X, depth=Y, height=Z) — a box says nothing about what has been cut OUT of the part. `solid` is the exact measured volume against the rectangular blank the part would be cut from, and it reads in ONE direction: exactly 100% proves nothing was removed, so a dado, notch, bore or pocket you expected there did not land. Under 100% means the part does not fill a rectangular blank — material removed if the part is meant to be a block, but a cylinder fills 78.5% of its box with nothing cut, so volume alone cannot separate a cut from a shape. ⚠ It also does NOT locate the cut or report a wall thickness — volume cannot answer 'is this wall 6mm'.",
      },
    };
  }
  const b = find(partB);
  if (!b) return { status: 404, body: { error: `Part "${partB}" not found`, available_parts: names } };
  // Per-axis relation from the AABB projection overlap: + = overlap, - = separation.
  const FLUSH = 0.5;
  const LO = ["minX", "minY", "minZ"], HI = ["maxX", "maxY", "maxZ"], AX = ["x", "y", "z"]         ;
  const axes                                                                        = {}; const sep = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const overlap = Math.min(a.bbox[HI[i]], b.bbox[HI[i]]) - Math.max(a.bbox[LO[i]], b.bbox[LO[i]]);
    if (overlap > FLUSH) axes[AX[i]] = { relation: "overlap", mm: r1(overlap) };
    else if (overlap < -FLUSH) { axes[AX[i]] = { relation: "gap", mm: r1(-overlap) }; sep[i] = -overlap; }
    else axes[AX[i]] = { relation: "flush", mm: 0 };
  }
  const nearest = r1(Math.sqrt(sep[0] ** 2 + sep[1] ** 2 + sep[2] ** 2));
  const intersecting = axes.x.relation === "overlap" && axes.y.relation === "overlap" && axes.z.relation === "overlap";
  const ca = boxOf(a).center, cb = boxOf(b).center;
  const centerOffset = { x: r1(cb[0] - ca[0]), y: r1(cb[1] - ca[1]), z: r1(cb[2] - ca[2]), distance: r1(Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2])) };
  const axisWord                         = { x: "X/width", y: "Y/depth", z: "Z/height" };
  const rel = AX.map((k) => `${axisWord[k]} ${axes[k].relation === "flush" ? "flush" : `${axes[k].relation} ${axes[k].mm}mm`}`).join(", ");
  // ⭐ t4-overlap-truth. The boxes are the cheap half; the build already measured the
  // REAL shared volume of exactly these pairs, and /validate hands it back by name. A
  // cold driver deleted a correct notch because the joint was "unverifiable by measure"
  // — so measure now answers it instead of leaving the agent with a scary bbox flag.
  const shared = (v.interference ?? []).find((p) =>
    (p.a === a.name && p.b === b.name) || (p.a === b.name && p.b === a.name));
  const summary = shared?.kind === "interference"
    ? `"${a.name}" and "${b.name}" REALLY INTERSECT — a measured ${shared.volume}mm³ of shared solid, not just overlapping boxes. ${rel}.`
    : shared?.kind === "contact"
      ? `"${a.name}" and "${b.name}" share faces but NO volume — measured intersection 0mm³, i.e. a joint (a dado, notch, cope or lap reads exactly like this). Their bounding boxes overlap, which is why the box figures below say "overlap". ${rel}.`
      : shared?.kind === "unverified"
        ? `"${a.name}" and "${b.name}" have overlapping bounding boxes and the real intersection could NOT be measured: ${shared.reason}. Treat as unknown, not as clear. ${rel}.`
        : intersecting
          ? `"${a.name}" and "${b.name}" INTERSECT — they overlap on all three axes (possible interference). ${rel}.`
          : `"${a.name}" → "${b.name}": nearest gap ${nearest}mm (${rel}).`;
  return {
    status: 200,
    body: {
      ok: true, built: true, mode: "pair", units: "mm",
      part_a: boxOf(a), part_b: boxOf(b), axes,
      nearest_distance_mm: nearest, intersecting, center_offset_mm: centerOffset, summary,
      // The measured half. `null` = this build could not report it (an older geometry
      // service); absent-but-not-null with intersecting=false = the boxes never touched,
      // so there is nothing to measure. Never read a missing verdict as "clear".
      shared_volume: v.interference
        ? (shared
            ? { verdict: shared.kind, volume_mm3: shared.volume ?? null, ...(shared.reason ? { reason: shared.reason } : {}) }
            : { verdict: "no_contact", volume_mm3: 0 })
        : null,
      note: "Box figures are bounding-box based (width=X, depth=Y, height=Z) and are CONSERVATIVE for rotated, notched or dado'd parts — their world-aligned box is larger than the solid. `shared_volume` is the real measured intersection and is the one to trust; the build verdict reports the same measurement for every pair as `part_interference`. Each part also carries `solid` — its own exact volume against a rectangular blank, which is how you confirm a cut did NOT land on ONE part (a box cannot see a mortise): exactly 100% proves nothing was removed. Under 100% is material removed only if the part is meant to be a block — a cylinder is 78.5% of its box with nothing cut. Call measure with a single part for that verdict on its own.",
    },
  };
}
