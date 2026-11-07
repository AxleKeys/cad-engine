# Fabrication Outputs — take a finished build to the shop

Load this when the thing you built is meant to be **made**: a cabinet, shelving unit,
furniture, or fixture cut from **sheet goods**, or a **laser/CNC** part. For these
objects the design isn't done when the geometry builds — the user wants a cut list,
a nesting layout, a hardware schedule, and often a dimensioned shop drawing. Axle
computes all of it from the model you already pushed. Your job is to **run the
derivations and relay the verdicts**, not to hand-calculate anything.

The rule that governs this whole section: **the numbers are Axle's, not yours.** Sheet
counts, cost, unplaced parts, thickness mismatches — every one is a value a tool
returns. Never estimate a sheet count or a price in prose; call the tool and report
what it says. (See the platform's verdicts-not-recipes discipline.)

---

## When to reach for this

After a qualifying build (objectCategory ∈ cabinet / shelving / furniture / fixture
from sheet goods, or a laser/CNC part), close the build by offering the manufacturing
exit — don't wait to be asked. One good move is: *"It builds. Want the cut list and
sheet layout?"*

Do **not** trigger this for primitives, organic/decorative forms, or single 3D-printed
parts where a cut list is meaningless.

---

## The precondition: parts need stock bound

A cut list is only real when each part knows **what stock it's cut from**. Parts with
no material land in the "Unassigned" bucket — reported, never hidden, but not yet
cuttable.

- `get_material_palette(model_id)` — what stock the product allows (the choice-space).
- `assign_part_materials(...)` — bind parts to stock slugs (part-explicit wins; a
  group's material fills its members).
- If the palette is empty, the product has no stock defined yet — say so and point the
  user at Materials (Create ▸ Materials), rather than nesting an unassigned model.

`domain-materials` is the authoring side; this section consumes what it produced.

---

## The loop

1. **`get_cutlist(model_id)`** → the rows verdict: item # · qty · L×W×T · material ·
   grain, grouped by stock line, plus **flags** (`unassigned`, `mismatch` = thickness
   doesn't match any allowed stock, `oversize`, `shaped` = curved, bbox is a blank).
   The flags are Axle's judgments — relay them; don't second-guess them.
2. **`nest_sheets(model_id)`** → the layout verdict, e.g. *"41 pieces → 2 sheets
   (2× oak), 47% fill."* **`unplaced` is loud** — a part too big for any stock comes
   back as an error, never silently dropped. If anything is unplaced, lead with it.
3. **`get_nesting(model_id)`** → the last layout + a staleness flag. A model whose
   parameters moved since the nest reports *stale* — re-nest before quoting sheets.
4. **`render_nesting(model_id)`** → the agent's eyes on the packing (a PNG). Use it to
   *see* waste a percentage can't show — a near-empty second sheet, a grain run.
5. **Hardware / BOM** — `get_model_resources` / `set_model_resources` hold the slug→qty
   bill of materials; the Cut List facet's hardware schedule is its human surface
   (pack math, supplier, cost).

Dims are **derived projections of the parameters** — they follow the sliders and are
never edited directly. What IS editable is the fabrication overlay
(`update_cutlist`: grain lock, qty override, exclude, edge banding, notes, manual rows).

---

## Shop drawings (when they'll build from paper)

For a fabricator working off a printout, add a dimensioned view: the drawings room
(`add_view`, `add_dimension`, `lint_drawing`, `export_drawing`) projects the model to
sheets. A dimension is a parameter, drawn — same law as the cut list. **Item numbers
are shared**: the cut list owns them, and drawing balloons cite the same numbers, so
list, sheet labels, and drawings all agree.

---

## Exports (the manufacturing exit point)

| Want | Do |
|---|---|
| Cut list as a spreadsheet | `export_cutlist(model_id, format:"csv")` — headless, returned inline |
| Print-ready **cut pack** (BOM cover + one page per sheet + hardware + part labels) | Studio ▸ Cut List ▸ **PDF** (browser; branded title block) |
| **DXF** of the nested sheets (part rects + labels, layered) for CNC/laser | Studio ▸ Cut List ▸ **DXF** |
| Dimensioned drawing (SVG / PNG / PDF / DXF) | `export_drawing(...)` |

The PDF cut pack and the nesting DXF render in a live Studio tab (jspdf / dxf-writer);
`export_cutlist` CSV and `export_drawing` render headlessly. Tell the user which
surface to click when the artifact is a browser export.

---

## How to close

After a qualifying build, make the fabrication summary one of your two next moves —
the *verdict*, not a tool tour:

> "Built and nested: **41 parts → 2 sheets of ¾″ oak, 47% used, ~$96 in material.**
> Want the PDF cut pack for the shop, or a dimensioned drawing?"

If something's unplaced or unassigned, that's the headline instead — loudly, with the
part named. A cut list that "succeeds" by dropping a part is the one outcome this
whole system refuses.
