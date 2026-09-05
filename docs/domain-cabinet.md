# Cabinet Construction — Domain Rules (Replicad / mm)

Load this section whenever the request involves cabinets, carcasses, vanities,
kitchen runs, drawers, or cabinet doors. These rules define **construction
intent** — how real cabinets go together. They exist because generic joinery
assumptions produce wrong geometry that builds clean and looks plausible.

## The route (the Build Loop for this class)

Massing (the outside envelope at stated dims — the Prime Directive below) → carcass
shells and partitions as named parts → fronts, backs, drawers → joinery. **`measure` is
king here**: flush/gap/engagement between panel pairs proves each pass, probes over
pictures. `certify_model` across the ranges closes it.

---

## The Prime Directive — never override stated dimensions with joinery assumptions

The founding failure this file prevents: given `overall_height` and
`material_thickness`, the generator decided `side_height = overall_height -
material_thickness` because it assumed the bottom panel sits *under* the sides.
It doesn't. The result was a cabinet 19mm short, built clean, no error.

- **Never subtract material thickness from a stated overall dimension.**
  Overall width/height/depth are the *outside* envelope; parts fit inside it.
- If the user, an existing model, or a geometry baseline states coordinates or
  dimensions, **use them exactly** — your job is to express their construction
  in code, not to re-derive it from your own assumptions.
- Explicit coordinates confirm *where*; this file defines *how it joins*.
  When they conflict, stop and flag it — do not silently pick one.

---

## Coordinate convention

Use the platform axes. They are the same axes every Axle verification surface uses,
so they are not negotiable:

```js
// X = width, Y = depth, Z = height
```

X = 0 is the **left** face. Y = 0 is the **front** face (positive toward the wall).
Z = 0 is the floor. Never invent a different convention; never omit the comment.

**Why this matters (2026-07-13):** this file used to say `X = depth, Y = width`. That
"facade" convention *conflicted* with `check_dimensions`, `target_dimensions`, and the
sweep-certification bounding box — all of which read raw bbox extents as
`width = X, depth = Y, height = Z`. Nothing errored: a 762mm-wide cabinet honestly
reported `width: 324` (its depth plus the door), the dimension check PASSED on
transposed numbers, and the brief recorded a width that reads like a bug. Now that the
axes agree, **pass the user's dimensions straight through** — never transpose:

```js
target_dimensions { width: 762, depth: 305, height: 762 }   // means exactly what it says
```

---

## Standard dimensions (metric)

North American kitchen base cabinet defaults. Use these when the user doesn't specify.

| Component | Dimension |
|---|---|
| Material thickness `mat` | 19mm (3/4") |
| Carcass height (no countertop) | 876mm (34.5") |
| Carcass depth | 610mm (24") |
| Total height with countertop | 914mm (36") |
| Toe kick height | 102mm (4") |
| Toe kick setback from front | 76mm (3") |
| Nailer depth (front + back) | 76mm (3") |
| Countertop thickness | 38mm (1.5") |
| Countertop front/side overhang | 19mm (3/4") |
| Shelf setback from front face | 6mm (1/4") |
| Full-overlay door/drawer gap | 3mm (1/8") |

---

## Carcass rules

Return cabinets as a **named parts array** — one entry per panel, never one
fused solid. Build every part with explicit `makeBox` corners.

**Build the carcass in passes, not one shot.** Push the overall envelope first —
a single box at the stated outside dimensions — and prove it with
`check_dimensions` before any panel exists. A wrong envelope discovered after the
joinery is written wastes every part above it, and the Prime Directive above is
exactly the error that hides until then. Then the panels, then the joinery. Between
passes read the build verdict the push hands back (it prints every part's size and
position) and `measure` the pairs that must be flush — that is what catches a side
capped over instead of captured between, while the diff is still one panel wide.

**Side panels** — run the full carcass envelope. Start at `Z = toeKickHeight`,
full depth `Y: 0 → depth`, top at `Z = height`. Never shortened for the bottom
or top panels — those fit *between* the sides.

⚠ **Full height AND full depth — these are not alternatives.** The sides are the
continuous members in both axes. Top, bottom, shelves and back are all captured
between them at interior width; nothing ever caps over a side's outer face, and
a side is never trimmed by the material thickness to make room for a panel.
⚠ **Sides rise from the TOE KICK, not the floor** (`Z: toeKickHeight → height`).
An **end panel** is the exception — it goes floor-up (`Z: 0 → height`, §Run-level
parts). Confusing the two is the commonest carcass error.
*(This paragraph is the single source for that rule. It previously also lived as
two overlapping runtime lessons which disagreed on emphasis and outranked this
file at retrieval; both were deleted 2026-07-27. Do not re-record it as a
lesson — correct it HERE.)*

```js
const leftPanel  = makeBox([0, 0, toeKickHeight], [mat, depth, height]);
const rightPanel = makeBox([width - mat, 0, toeKickHeight], [width, depth, height]);
```

**Bottom panel** — sits **between** the side panels (interior width), at
`Z = toeKickHeight`, and stops before the back panel: `Y: 0 → depth - mat`.

```js
const bottomPanel = makeBox([mat, 0, toeKickHeight], [width - mat, depth - mat, toeKickHeight + mat]);
```

**Back panel** — sits **between** the side panels, `Y: depth - mat → depth`,
and runs `Z: toeKickHeight → height - mat` (stops under the nailers). A back
panel that stops short of the top is the classic silent bug — its top edge is
`height - mat`, nothing else.

**Top nailers** (no full top panel on base cabinets) — front nailer
`Y: 0 → nailerDepth`, back nailer `Y: depth - nailerDepth → depth`, both at
`Z: height - mat → height`, interior width.

**Toe kick** — recessed between the side panels: `Y: setback → setback + mat`,
`Z: 0 → toeKickHeight`, interior width.

**Shelves** — interior width, set back 6mm from the front, spaced equally in
the interior height `height - mat - (toeKickHeight + mat)`. Shelf count is a
parameter; guard it so 0 shelves still returns a valid cabinet.

**Countertop** — sits on top at `Z = height`, overhangs front and sides 19mm,
**no back overhang against a wall**.

### Toe-kick style variants — never silently switch

- **Style A (default, above)**: sides start at `Z = toeKickHeight`; the kick
  board is recessed between them.
- **Style B (separate plinth)**: sides run full height to the floor
  (`Z: 0 → height`) and the toe kick is an independent frame the carcass sits
  on or in front of.

Both are correct constructions. Follow whichever the user or existing model
uses; if starting fresh, use Style A. Switching styles mid-revision moves every
Z coordinate — treat it as a redesign, not an edit.

---

## Doors (full overlay)

Doors cover the side panels and sit **in front of** the carcass
(`Y: -doorThick → 0`). The only visible gap is 3mm on all sides.

```js
const doorGap = 3, doorThick = 19;
const door = makeBox([doorGap / 2, -doorThick, toeKickHeight + doorGap],
                     [width - doorGap / 2, 0, height - doorGap]);
```

Two-door cabinets split at center with `doorGap / 2` pulled in on each side of
the split. Every door gets the gap treatment on **all** edges, including the
outermost ones. Doors are separate named parts — never fused to the carcass.

**Hinges (movement joints)** — a door swings about its **outer vertical edge**, so the
pivot sits at that edge and the axis is `Z`. The two doors of a pair need **opposite
axis signs**: left door `[0, 0, 1]`, right door `[0, 0, -1]`. Give both the same axis
and one door swings *backwards through the carcass* — it never errors and looks correct
in the joint list.

---

## Drawers

**Box construction**: sides run full box depth; front and back sit between the
sides; the 6mm bottom slides into 6mm × 6mm dados in the front and both sides,
starting 13mm from the box bottom; the back is shorter (sits on top of the
bottom panel, no dado). In replicad, cut dados as boolean grooves in a single
solid panel — never stack boxes to fake a notch.

**Undermount slide clearances** (mm):

| Setting | Value |
|---|---|
| Slide lengths available | 229 / 305 / 381 / 457 / 533 (9"–21") |
| Side clearance (each side) | 5mm |
| Clearance below box (undermount) | 14mm |
| Rear clearance (minimum) | 19mm |
| Minimum gap above each box | 13mm |
| Minimum box height | 38mm |

Pick the **longest slide that fits**: `slideDepth = max(s ≤ depth - mat - rearClearance)`.
Box width = `interiorWidth - 2 × sideClearance`. First box sits at
`Z = toeKickHeight + mat + undermountClearance`; a nailer (`mat` thick,
interior width) goes between each pair of drawers — none below the first.

**Drawer faces** are independent design decisions, not derived from the box:
full-overlay faces follow the door gap rules (3mm all around).

---

## Multi-cabinet runs

Widths come as an array; cabinets sit side by side along **X**, so track `offsetX`:

```js
const widths = [400, 450, 600];
let offsetX = 0;
for (const w of widths) { /* build cabinet at offsetX */ offsetX += w; }
```

Run-level parts are **top-level named parts, never per-cabinet**:

- **Toe kick**: one piece spanning the entire run.
- **End panels**: full height to the floor (`Z: 0 → height`), extend 19mm
  forward of the carcass front, depth follows the deepest cabinet.
- **Countertop**: one piece, spans the run plus side overhangs.

---

## Common mistakes (all observed in real builds)

1. Side height = `overall_height - mat` — the founding failure; sides are never
   shortened for the bottom panel.
2. Back panel top at a nailer Z instead of `height - mat` — builds clean,
   19mm gap at the top.
3. Bottom or back panel at full outside width — they sit between the sides.
4. Toe kick / end panels / countertop built per-cabinet inside a run.
5. Door width spanning full interior width — every door edge needs `gap / 2`.
6. Doors or drawer faces fused into the carcass solid.
7. Dado modeled as stacked boxes instead of a groove cut from one solid.
8. Nailer X-offset hardcoded to `mat` instead of the cabinet's own `offsetX + mat`.
9. Shelf count of 0 throwing instead of returning the bare carcass.
10. Re-deriving a stated dimension "because the joinery implies it" — see the
    Prime Directive.
11. Transposing `target_dimensions` to "match the cabinet's axes" — the axes already
    match (`width = X`). Pass the user's numbers straight through.
12. Both doors of a pair on the same hinge axis — one swings backwards through the
    carcass, silently.
