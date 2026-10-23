// Per-part SOLID VOLUME — "did the cut actually land?" (t12-loop-section, ROUTE 1)
//
// THE FACT THIS EXISTS TO CARRY: the geometry service has measured an exact solid
// volume for every part since t14-sweep — `scripts/headless/runner.mjs:290` calls
// `measureVolume(shape)` while the B-rep is still alive, and POST /validate has always
// returned it in `parts[].volume`. Probed against prod 2026-08-09: the response's part
// keys are `name, bbox, obb, volume, vertexCount`. It reached NO agent surface. The
// build verdict printed bounding boxes, single-part `measure` returned {size,min,max,
// center}, and `get_validation_report` returned sizeX/sizeY/sizeZ/min/obb — so a shelf
// with an 18×350 mortise cut clean through it was INDISTINGUISHABLE from a solid one on
// every surface an agent can see.
//
// ONE implementation, deliberately. The rule this one neighbours (part_overlap) was
// wrong in FOUR copies at once, and the fix had to find all four
// [[feedback_three_registries]]. Both agent-facing readers call in here:
//   • the `measure` route          — worker/index.js POST /mcp/model/:id/measure
//                                    (through app/lib/partMeasure.ts, which is handed solidity())
//   • the build verdict formatter  — mcp/lib/format.js formatBuild
//   • the local engine             — packages/engine/cli.mjs `axle build` and `axle measure`
//                                    (t31-kitchen; this file ships in the pack by §8 decision 7)
//
// ⭐ WHAT IT PROVES, AND WHAT IT DOES NOT. A fill under 100% proves material WAS
// removed from the blank; a fill of 100% proves nothing was. It says nothing about
// WHERE the material went or how thick what remains is. "Is this wall 6mm?" is still
// unanswerable from a volume — that is get_section's irreducible core, and this module
// must never be described as covering it.
//
// RELATED BUT NOT THE SAME QUESTION: app/lib/cutlist.ts SHAPED_VOLUME_RATIO (0.95) asks
// "is the BLANK meaningfully bigger than the part, so nesting by rectangle is
// conservative?" — a coarse commercial threshold. This asks "was ANY material removed?"
// and so sits hard against 1.0. Two thresholds, two questions; neither is the other's
// drift.

/**
 * ⛔⛔ THE OLD `SOLID_FILL_TOL = 0.999` WAS WRONG IN BOTH DIRECTIONS AT ONCE, and its comment
 * argued for it with the exact case it failed: *"the smallest cut worth asking about (a single
 * 6mm drilling) is still far outside float noise"*. It is not, because **`fill` is a RATIO and
 * the tolerance was being reasoned about as an absolute noise floor.** What a fixed-size cut
 * scores depends entirely on the size of the part it is cut from. On an 800×300×18 shelf, 0.999
 * demanded a **17.5mm** bore before it would admit anything had been removed.
 *
 * Measured 2026-08-10 (`scripts/headless/probe-solidity-floor.mjs`), against real geometry:
 *
 *   MISSED as "UNCUT", removed_mm3 reported as 0 — 4 of 7 real cuts
 *     6mm bore through an 800×300×18 shelf     fill 0.99988   509mm³ gone
 *     6mm bore through a 2400×1200×18 sheet    fill 0.99999   509mm³ gone
 *     3mm pilot hole in a shelf                fill 0.99997   127mm³ gone
 *     4 shelf-pin holes, 5mm × 12 deep         fill 0.99978   942mm³ gone
 *
 *   CLAIMED as cut, with nothing cut — 1 of 9 solids
 *     a plain cylinder                         fill 0.78589   "21% HAS been cut away"
 *
 * ⭐⭐ AND THE TWO BANDS OVERLAP, so no value of this constant could ever have worked: an
 * UNCUT part reads as low as 0.786 while a genuinely cut one reads 0.99999. That is why the
 * fix is a change of claim, not a change of number [[feedback_count_the_invariant_not_the_symptom]].
 *
 * ⭐ WHAT IS ACTUALLY SOUND, and it is only one direction. A blank here is a BOX. So:
 *   · volume == blank exactly  ⇒ the part fills a rectangular blank ⇒ **nothing was removed.**
 *     Definitive, and it is the actionable direction: "I cut a dado and this says 100%" means
 *     the cut did not land.
 *   · volume <  blank          ⇒ the part is not a full rectangular block. That is EITHER
 *     material removed OR a part that was never rectangular (a cylinder, a taper, a fillet).
 *     **Volume alone cannot tell those apart** and this module must never pretend otherwise.
 */

/** How close to its blank a part must measure to be called a FULL one. Relative, and sized
 *  against float precision rather than against any cut: both numbers are exact analytic
 *  volumes, so ~1e-15 relative error is the real floor and 1e-9 sits a million times above it
 *  while remaining far below the faintest physical cut (127mm³ of 4.3M = 3e-5). Every solid
 *  fixture in the floor probe — axis-aligned, tilted 7°/30°, rotated on two axes, 45° in plan,
 *  large and small — measured EXACTLY 1.0, so this is a guard against float, not a fudge. */
export const FULL_BLANK_EPS = 1e-9;

// ⛔ `SOLID_FILL_TOL` IS DELETED, NOT ALIASED, and the first draft of this fix got that wrong.
// Aliasing it to FULL_BLANK_EPS looks harmless and is not: the two carry different MEANINGS —
// one is a fill FRACTION near 1.0, the other an EPSILON near 0 — so a surviving
// `fill >= SOLID_FILL_TOL` would silently become always-true rather than failing. An ESM named
// import of a missing export throws at link time, before a line runs, which is the loud
// failure the alias was mistakenly introduced to provide.

/** A single solid can never exceed its own bounding blank. Above this, the number is not a
 *  usable solid volume. Reported as unusable, never as "solid".
 *
 *  ⚠⚠ THE NAME SAYS "COMPOUND" AND THIS MODULE CANNOT SEE ONE — that is the whole of the
 *  2026-08-30 correction below. A compound double-count IS one cause (`measureVolume` on a
 *  COMPOUND sums its members and counts the overlap twice — ratified as a BOM/mass number,
 *  not a dimension, 2026-08-03, scripts/headless/probe-compound-parity.mjs). It is not the
 *  only one, and this module is handed `{volume, bbox, obb}` — never a solid COUNT — so it
 *  can never tell which cause it is looking at. The constant keeps its name because it is
 *  exported and asserted against by name in scripts/headless/test-partvolume.mjs; the
 *  SENTENCE is what had to change. */
export const COMPOUND_FILL_CEILING = 1.001;

/**
 * The blank a part is cut from, in mm³, and which box that came from.
 *
 * ⚠ THE ORIENTED BLANK COMES FIRST, and that ordering is the whole correctness of this
 * module. A tilted solid slab's WORLD-AXIS box describes where it sits in space, not the
 * board it is cut from — the Dog House's sloped roof reads a fictional 261mm "thickness"
 * on its AABB (t14-sweep B1b). Compare a solid tilted part against its AABB and it reads
 * as ~40% material removed: a false "the cut landed" on a part nobody cut. Against the
 * OBB it reads 100%, correctly. Same preference order as app/lib/cutlist.ts classify().
 *
 * Accepts every shape the two callers hold, because they hold different ones: the
 * geometry service part (`{bbox:{sizeX..}, obb:{w,d,h}}`) and the stored build record
 * (`{sizeX, sizeY, sizeZ, obb:[w,d,h]}`).
 *
 * ⚠⚠ THE DIMS MUST BE THE MEASUREMENT, NOT A DISPLAY VALUE — this module divides an EXACT
 * analytic volume by them, so any rounding a caller applied on the way in comes straight back
 * out as a fill error, and `fill` has no tolerance band to absorb it (FULL_BLANK_EPS is 1e-9,
 * sized against float precision). It happened: the worker's build record stored `obb` at 0.1 mm
 * while storing `volume` at full precision two lines above, so a 6.35 mm sheet part measured
 * against a 6.4 mm blank and an UNCUT panel reported "99.22% of its blank" with a shortfall in
 * mm³ beside it — a phantom one, on the one direction this module can settle, on every
 * inch-native part in the system. When the rounding went the other way the blank came out under the volume and
 * a plain makeBox was reported as a compound double-count. Fixed at the writer 2026-08-30
 * (t25-verdictfamily, Notebook 7343545e); pinned by test-partvolume LEG 8, whose CONTROL leg
 * keeps the rounded record reproducible so the defect stays visible.
 * ⭐ THE RULE FOR ANY FUTURE CALLER: round for the reader, never for this function. If all you
 * hold is a rounded box, you are holding a number this module cannot honestly divide by.
 */
export function blankVolume(part) {
  if (!part) return null;
  const picked = blankDims(part);
  if (!picked) return null;
  const v = picked.dims[0] * picked.dims[1] * picked.dims[2];
  return Number.isFinite(v) && v > 0 ? { volume: v, basis: picked.basis } : null;
}

function blankDims(part) {
  const ob = part.obb;
  let d = null;
  if (Array.isArray(ob) && ob.length === 3) d = [num(ob[0]), num(ob[1]), num(ob[2])];
  else if (ob && typeof ob === "object") d = [num(ob.w), num(ob.d), num(ob.h)];
  if (d && d.every((n) => n != null && n > 0)) return { dims: d, basis: "oriented_blank" };

  const bb = part.bbox ?? part;
  const a = [num(bb?.sizeX), num(bb?.sizeY), num(bb?.sizeZ)];
  if (a.every((n) => n != null && n > 0)) return { dims: a, basis: "bounding_box" };
  return null;
}

// ⚠⚠ THE null GUARD IS LOAD-BEARING, not defensive tidiness. `Number(null)` is 0 and
// `Number(undefined)` is NaN, so a bare `Number.isFinite(Number(n))` accepts a MISSING
// volume as zero — and zero solid against a real blank reads as "100% of this part has
// been cut away". That is the honest-absence rule inverted into the most confident
// possible lie, on exactly the surface built to prevent it. Caught by test-partvolume
// LEG 5, which exists because this is the mistake that was worth a test.
const num = (n) => {
  if (n == null || n === "") return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
};
const mm3 = (n) => `${Math.round(n).toLocaleString("en-US")}mm³`;
const pct = (f) => `${(f * 100).toFixed(2)}%`;

/**
 * The verdict for one part. Never throws; never turns "cannot tell" into "solid".
 *
 * verdict:
 *   "material_removed" — measurably less solid than its blank. The cut landed.
 *   "solid"            — fills its blank. If a cut was expected here, it did NOT land.
 *   "unreliable"       — volume exceeds the blank, which no single solid can. The number is
 *                        not a usable solid volume; this module cannot say which cause it is.
 *   "unmeasured"       — this build reported no volume. Unknown, NOT clear.
 *
 * @returns {null|{verdict,volume_mm3,blank_volume_mm3,removed_mm3,fill,basis,sentence}}
 *          null when there is no blank to compare against at all (no bbox, no obb) —
 *          the caller has nothing to say and should say nothing.
 */
export function solidity(part, name = part?.name ?? "part") {
  const blank = blankVolume(part);
  if (!blank) return null;
  const volume = num(part?.volume);
  const base = {
    volume_mm3: volume == null ? null : round(volume),
    blank_volume_mm3: round(blank.volume),
    removed_mm3: null,
    fill: null,
    basis: blank.basis,
  };
  const blankWord = blank.basis === "oriented_blank" ? "blank" : "bounding box";

  if (volume == null) {
    return {
      ...base,
      verdict: "unmeasured",
      sentence:
        `The solid volume of "${name}" was NOT measured by this build, so whether material has been ` +
        `cut out of it is unknown — do not read this as solid. (Older builds predate per-part volume; ` +
        `re-push to get a current one.)`,
    };
  }

  const fill = volume / blank.volume;
  base.fill = Math.round(fill * 10000) / 10000;

  // ⭐⭐ A NEGATIVE VOLUME IS NOT A SMALL PART, AND THIS BRANCH EXISTS BECAUSE THE FALL-THROUGH
  // TOLD THE AGENT THE OPPOSITE. `measureVolume` is signed, and an INVERTED solid measures
  // below zero: `makeBaseBox(60,60,40).shell(-3, f => f.inPlane("XY", 20))` — ordinary model
  // code whose selector happens to match no face — measures —199,037mm3 inside a 200,376mm3
  // blank. Without this branch it failed every test above and landed in `material_removed`,
  // where `blank - volume` becomes blank PLUS the magnitude: the agent was told 399,413mm3 had
  // been removed from a 200,376mm3 blank and that "your cut landed".
  //
  // ⚠⚠ THAT SENTENCE IS THE WHOLE RESPONSE on `POST /mcp/model/:id/measure`, with `ok:true`
  // and no soundness field beside it to disagree — so the one place the number is most wrong
  // was also the one place nothing contradicted it. On the BUILD verdict it was merely
  // incoherent, because `non_positive_volume` gates the same part. Found 2026-08-30 by a
  // reviewer of the t31 soundness work; the defect itself predates it.
  //
  // The claim stops where the evidence does, exactly as the ceiling branch below does: a
  // negative volume proves the shape is not a well-formed solid. It does NOT say why, and this
  // module cannot look — it is handed {volume, bbox, obb} and never the B-rep.
  if (volume < 0) {
    return {
      ...base,
      verdict: "unreliable",
      sentence:
        `"${name}" measures a NEGATIVE solid volume of ${mm3(volume)} against a ${mm3(blank.volume)} ${blankWord}. ` +
        `A real solid cannot enclose less than nothing, so this shape is INSIDE OUT or otherwise not a ` +
        `well-formed solid, and the number is not a measurement of it. Nothing about a cut can be read ` +
        `from it — in particular this is NOT material removed, however large the shortfall looks. ` +
        `The build verdict's soundness check reads the B-rep and reports this as \`non_positive_volume\`; ` +
        `this number cannot tell you why.`,
    };
  }

  // ⛔⛔ THIS BRANCH USED TO NAME A CAUSE IT HAD NOT CHECKED, and t31-solidverdict caught it
  // contradicting the build verdict on the SAME PART. It said, verbatim: *"The part is a
  // COMPOUND whose members overlap, and the measurement double-counts the overlap."* On the
  // fillet band — `makeBaseBox(100,100,6.35).fillet(5)`, 101,980mm³ against a 63,500mm³ blank
  // — that is FALSE: those parts are SINGLE solids, and the soundness pass shipped in the same
  // tier now says so out loud on the very same build ("OPEN OR INCONSISTENT SHELL"). Two
  // incompatible causes printed for one part is worse than one wrong cause: a reader who
  // believes either one has been told something the system cannot support.
  //
  // ⭐ THE FIX IS A CHANGE OF CLAIM, NOT OF NUMBER — the same correction the fill tolerance
  // above already went through. This module is handed `{volume, bbox, obb}`. It has no solid
  // COUNT, so "compound" was never available to it; it inferred a mechanism from a ratio. What
  // it CAN say is exactly what it measured — a volume larger than its own blank, which no
  // single solid can be — and that the number is therefore unusable. Naming the two known
  // causes as CANDIDATES is honest; picking one is not [[feedback_omission_is_not_falsehood]].
  //
  // ⚠ AND IT MUST NOT BECOME A GATE. Deciding which cause it is, and refusing the build for
  // it, is the soundness rules' job (app/lib/soundness.ts) — they read the B-rep and can tell
  // an unclosed shell from a double-count. This stays a printed observation.
  if (fill > COMPOUND_FILL_CEILING) {
    return {
      ...base,
      verdict: "unreliable",
      sentence:
        `"${name}" measures ${mm3(volume)} of solid against a ${mm3(blank.volume)} ${blankWord} — ` +
        `${pct(fill)}, which a single solid cannot be. So this volume is not a usable measurement of ` +
        `this part, and nothing about a cut can be read from it. This measurement cannot tell you WHY: ` +
        `the two known causes are a part that is a COMPOUND of overlapping members (the volume then ` +
        `double-counts the overlap) and a part whose shell is open or inconsistent (the kernel then ` +
        `integrates a number that is not an enclosed volume). The build verdict's soundness check reads ` +
        `the B-rep and can separate those two; this number cannot.`,
    };
  }

  // EXACT fill, not a ratio band. This is the only direction volume can settle on its own,
  // and it is the actionable one: a part that completely fills a rectangular blank has had
  // nothing taken out of it, so a cut you expected here did not land.
  if (fill >= 1 - FULL_BLANK_EPS) {
    return {
      ...base,
      removed_mm3: 0,
      verdict: "solid",
      sentence:
        `"${name}" measures ${mm3(volume)} of solid and its ${blankWord} is ${mm3(blank.volume)} — ` +
        `it fills ${pct(fill)} of it exactly, i.e. it is an UNCUT block. If you expected a dado, notch, ` +
        `bore or pocket in this part, it did not land.`,
    };
  }

  const removed = blank.volume - volume;
  // ⚠⚠ THE CLAIM STOPS HERE, DELIBERATELY. A shortfall against a BOX blank means the part is
  // not a full rectangular block. It does NOT mean a cut: a cylinder fills π/4 = 78.5% of its
  // box and has had nothing removed. This branch used to say "HAS been cut away", which made
  // every dowel, peg, turned leg and pipe report as heavily machined — in the build verdict as
  // well as in `measure`. Both readings are offered, the number is exact, and the caller knows
  // which shape it authored [[feedback_omission_is_not_falsehood]].
  return {
    ...base,
    removed_mm3: round(removed),
    verdict: "material_removed",
    sentence:
      `"${name}" measures ${mm3(volume)} of solid against a ${mm3(blank.volume)} ${blankWord} — ` +
      `${pct(fill)}, so ${mm3(removed)} of that blank is NOT in the part. If this part is meant to be ` +
      `a rectangular block, that shortfall IS material removed and your cut landed. If it is round, ` +
      `tapered, filleted or otherwise not box-shaped, the shortfall is its shape and says nothing ` +
      `about a cut — volume alone cannot tell those two apart. Either way it does not say where the ` +
      `material is missing from, or how thick what remains is.`,
  };
}

const round = (n) => Math.round(n * 100) / 100;

/** The compact form for a per-part line in the build verdict — a few tokens, and only
 *  when there is something to say. `null` on a part that fills its blank: printing
 *  "100% solid" on every part of every build is the token cost this returns nothing to
 *  avoid. The silent case is made legible by solidityLine() below, which states the
 *  rule once for the whole model instead of once per part. */
export function solidityTag(part) {
  const s = solidity(part);
  if (!s) return null;
  // ⚠ "of its blank", never "cut away" — see the solidity() comment. A cylinder is 78.6% of
  // its box and nothing was cut; this line appears on every part of every build, so it is the
  // widest-read sentence in the module and was the widest-read wrong one.
  if (s.verdict === "material_removed") return `${pct(s.fill)} of its blank (${mm3(s.removed_mm3)} short)`;
  // ⚠ "volume unusable", never "(compound double-count)" — see the unreliable branch of
  // solidity(). This tag is the widest-read form of the sentence, so it was the widest-read
  // place the unchecked cause was asserted; it now says only what the ratio proves.
  // A negative fill would print as "-99.33% of its own blank", which reads like a very small
  // part rather than an impossible one. The two unusable causes get their own words.
  if (s.verdict === "unreliable") {
    return s.volume_mm3 != null && s.volume_mm3 < 0
      ? `volume unusable (NEGATIVE — inside out)`
      : `volume unusable (${pct(s.fill)} of its own blank)`;
  }
  return null;
}

/**
 * One line for the whole model, so that a part printed WITHOUT a tag means something
 * definite instead of meaning nothing. Without this, "no note on Shelf 2" is
 * indistinguishable from "this build never measured volume" — the orphaned-reader
 * failure mode, where silence reads as a clean result [[feedback_legible_refusal]].
 *
 * Returns null when no part carries a volume at all (an older build record) — an honest
 * absence, and the one case where saying nothing is correct.
 */
export function solidityLine(parts) {
  const verdicts = (parts ?? []).map((p) => solidity(p)).filter(Boolean);
  if (!verdicts.length || verdicts.every((v) => v.verdict === "unmeasured")) return null;
  const cut = verdicts.filter((v) => v.verdict === "material_removed").length;
  const solid = verdicts.filter((v) => v.verdict === "solid").length;
  const bad = verdicts.filter((v) => v.verdict === "unreliable").length;
  const unknown = verdicts.filter((v) => v.verdict === "unmeasured").length;
  const bits = [];
  if (cut) bits.push(`${cut} measuring short of its blank`);
  if (solid) bits.push(`${solid} exactly filling its blank`);
  // ⚠ "unmeasurable", not "(compound)" — the cause is not something this module has checked.
  if (bad) bits.push(`${bad} measuring MORE than its own blank, so unmeasurable`);
  if (unknown) bits.push(`${unknown} not measured`);
  return `Solid volumes measured — ${bits.join(", ")}. A part with no note above fills its rectangular blank EXACTLY, so nothing has been taken out of it and a cut you expected there did not land. A part measuring short is either cut or simply not box-shaped (a cylinder is 78.5% of its box); volume cannot separate those, and measure(part) names the number.`;
}

// PIECES: how many separate solids a part is (app/lib/connectivity.ts countPieces, carried on the
// build record as `solids`). The same two readers print it: the per-part tag and one model-wide line.
//
// ⭐ A FACT, NOT A FAILURE. A part in several solids is often right (lettering, a group of slats
// returned as one compound), so push_model_code reports the count and gates nothing (HK ruling, plan
// §8c). certify_model is where a count becomes a verdict, and only against the code as saved
// (part_splits, scripts/headless/sweep.mjs). Silent on a part of one solid and on a record with no
// count (a build before the count shipped): neither has anything to say.

/** `8 separate solids` for a part in more than one solid, else null. */
export function piecesTag(part) {
  const n = part?.solids;
  return Number.isInteger(n) && n > 1 ? `${n} separate solids` : null;
}

/** The whole per-part clause the build verdict appends to a part's line: solidityTag and piecesTag
 *  joined by " · ", led by " · ", or "" when the part has nothing to say. ONE layout, called by the
 *  push verdict (mcp/lib/format.js formatBuild) and the local engine (`axle build`), so the two
 *  lines for the same part cannot be laid out two ways (t31-kitchen review round 1; it was a
 *  one-liner typed in both until then). */
export function solidTag(part) {
  const t = [solidityTag(part), piecesTag(part)].filter(Boolean).join(" · ");
  return t ? ` · ${t}` : "";
}

/** One line for the model: how many parts are several separate solids. Names the first five at
 *  detail "standard" and "full"; "summary" gives the count alone. null when no part is. */
export function piecesLine(parts, level = "standard") {
  const list = parts ?? [];
  const split = list.filter((p) => piecesTag(p));
  if (!split.length) return null;
  const head = `${split.length} of ${list.length} part(s) are each several separate solids, not one piece`;
  if (level === "summary") return `${head}.`;
  const named = split.slice(0, 5).map((p) => `${p.name} (${p.solids})`).join(", ");
  return `${head}: ${named}${split.length > 5 ? `, +${split.length - 5} more` : ""}.`;
}
