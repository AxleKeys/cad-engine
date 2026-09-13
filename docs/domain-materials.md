# Material Selection — Domain Rules (stock, thickness, finish)

Load this section whenever you are **choosing which real material each part is cut
from** — calling `assign_part_materials`, authoring a product's stock palette, or
building geometry that has to come out stock-correct. These rules are *judgment*: which
stock suits which part, at what thickness, with what finish. Axle can check a thickness
*mismatch* after the fact (the cut list flags it), but it cannot judge whether walnut or
melamine was the *right* call — that is what this file is for.

---

## The Prime Directive — pick within the product's PALETTE

`get_part_materials` returns two sets: `materials` (the whole overlaid catalog) and
`palette` (the few stock lines *this product is actually built from*). `get_active_context`
carries the same `material_palette`.

- **When a palette exists, choose within it.** It is the bounded, deliberately-curated
  choice-set for this product — picking 1-of-6 stock lines with known roles is reliable;
  picking 1-of-300 from the full catalog is not. That bound is the whole point.
- Tick within the allowed set. If a part genuinely needs stock the palette doesn't carry,
  add ONE new line and say why — never silently reach past the palette into the catalog.
- No palette yet? Author one first (a handful of real stock lines) *before* generating, so
  parts come out at correct thicknesses by construction, not corrected afterward.

---

## The material has a FORM — respect it (this protects geometric freedom)

Each material carries a `form`. It decides how the part is made, and what may be checked:

| form | what it is | parts | thickness rule |
|---|---|---|---|
| `sheet` | plywood, melamine, MDF | flat panels | built AT an allowed thickness |
| `bar` | lumber, extrusion, rod | cut-to-length | profile + length, no sheet check |
| `block` | foam, billet, blank | **any carved/turned shape** | none — shape freely |
| `bulk` | filament, resin, clay | printed / formed | volume / weight, no thickness |

- Build a `sheet` part's panel thickness to one of the palette's allowed thicknesses.
- A carved sphere, a turned leg, a sculpted form belongs to `block`/`bulk` — **never bind
  sheet stock to a shaped part** (it would be flagged as a mismatch, and it's wrong intent).
  A foam sphere is never checked against a thickness it doesn't have.

---

## Part role → sheet thickness (cabinetry defaults, mm)

When the role is clear and the palette allows it:

| Part role | Thickness |
|---|---|
| Carcass sides, gables, tops, bottoms, fixed shelves | 18–19mm (¾") |
| Doors, drawer fronts, face frames | 18–19mm (¾") |
| Drawer box sides / front / back | 12mm (½") |
| Backs, drawer bottoms | 6mm (¼") |
| Adjustable shelves, long spans (>800mm) | 18–19mm (¾") to avoid sag |

The mismatch you must avoid: assigning ¾" stock to a ¼" back panel (or vice-versa). Read
the palette FIRST and build the panel AT the stock thickness — the cut list will flag a
geometry-vs-stock mismatch, but the right move is to never create it.

---

## Show surface vs utility surface

Match the material's cost and look to what the part is FOR:

- **Show surfaces** (doors, drawer fronts, exposed sides, tops): veneer plywood or solid
  wood — walnut, oak, maple. This is where finish matters.
- **Hidden / interior** (carcass interiors, backs, drawer boxes, cleats): the cheap,
  durable option — birch ply, melamine, paint-grade. Don't spend veneer where no one looks.
- **Paint-grade**: MDF — smooth, grainless, takes paint cleanly. Good for painted doors and
  panels; never for a part meant to show wood grain.
- **Large flat panels**: veneer ply over solid wood (cheaper, flatter, won't cup). Solid
  wood for edges, trim, face frames, and small parts that get machined.

Respect the product's intent: a planter box is wood, a workshop jig might be steel — don't
paint a garden planter in brushed aluminum because the slug exists.

---

## Grain

- Solid wood and veneer: grain `length` — it runs along the part's LONG axis. This is both
  the look and the cut orientation, so the way a part is cut and the way it reads agree.
- MDF, melamine, metal, glass: grain `none`.
- Boards in a run (slats, panel boards) all run grain the same way — along their length.

---

## Mechanics

- `assign_part_materials` binds `{ partName: slug }`. Read `get_part_materials` first for
  the exact part names and the valid slugs (unknown names/slugs are rejected, not applied).
- Assign by GROUP when parts share a role — cascade one slug over the whole group rather
  than binding each part. Per-part binding overrides the group.
- Assign only after a build has recorded the part manifest (push the code first; the push
  returns the part names).
