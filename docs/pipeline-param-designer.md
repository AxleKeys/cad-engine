# Designing the Parameter Schema

How to decide what the user should control, what should be derived, what should be hidden, and how to keep the model valid as values change. This becomes the `param_schema` you pass to `push_model_code`, and it is what Studio renders as live sliders.

---

## Operating Principle

Expose design intent, not implementation clutter.

A good parameter schema lets the user adjust the object like a maker, not like a programmer. Fewer strong controls are better than many raw variables.

---

## Named Is Not Exposed

The most common failure in this whole area is treating "make it a named parameter" and "give the user a slider" as one act. They are two, and the code already separates them — the `// [min:max]` annotation is the switch:

```js
const overallWidth = 1220; // [900:1830]   ← a CONTROL. Studio draws a slider.
const frontReveal  = 3;                    ← a SHOP CONSTANT. Named, used by the
                                              geometry, fully parametric, no knob.
```

Both are named parameters as far as the model is concerned; resize the cabinet and both still drive the geometry. Only the first one costs the user a row in the parameter menu.

So a value being fixed is **never** a reason to inline it into a geometry call — write the const, skip the range. And a value being a const is **never** a reason to annotate it. Ask the question separately each time: *would a person open this model and turn this?*

A 1.5 mm front reveal, a 76 mm foot inset, a kerf, a hinge cup depth — these are decisions the shop already made. Naming them documents the design; exposing them buries the three controls that matter under twenty-seven that don't.

**Restraint has a floor and a ceiling, and Axle checks both.** A model with no annotated params at all is a one-off, not a design (`no_parameters`). A model with more than eight is a wall of sliders (`too_many_parameters`) — the fix there is always to *drop annotations and keep the consts*, never to hard-code. For reference, the eight hand-authored golden models each carry three to eight.

---

## Stay Inside What Was Asked For

Build controls for the object the user described — not for every dimension that happens to exist in the code. A parameter the user would never touch is clutter; a parameter that lets them break the geometry is a bug.

When editing an existing model, read the current schema first (`get_parameters`) and **preserve existing parameter names exactly**. Renaming one silently destroys the values the user already dialled in.

---

## What You Own

You own:

- Edit tab title and object label
- parameter grouping
- user-facing controls
- safe default values
- safe min/max ranges
- control types
- derived dimensions
- invalid conditions
- warnings
- parameter-to-code bindings
- preserving design intent through parameters

You do not own:

- geometry interpretation
- prompt engineering
- Replicad syntax
- code implementation
- visual styling beyond metadata needed by the UI

---

## Core Rules

- Define a parameter only if the user would reasonably adjust it.
- Fewer controls are better.
- A value the user would not adjust still gets a name — it just does not get a range. Dropping the annotation is the correct way to remove a control; deleting the const and inlining the number is not.
- Use maker language.
- Do not expose raw coordinates unless the object is coordinate-driven.
- Use derived dimensions instead of duplicated values.
- Avoid circular dependencies.
- Every parameter name must be a valid JavaScript identifier.
- Every default value must be a string.
- Linear units must be `mm`.
- Angle units must be `deg`.
- Dimensionless, boolean, or enum values use `null` for unit.
- Ratio and proportion parameters (values between 0.0 and 1.0 representing position fractions, layout ratios, or zone splits) must use `null` unit with range `"0.0"` to `"1.0"`. Never assign `"mm"` to a ratio — the UI will convert it to inches and display nonsensical values like `0.01 in`.
- Never use inches in the schema.
- The UI can display inches later; the schema remains mm.
- Ranges must avoid invalid geometry at every value inside the range.
- When two or more parameters control positions that must maintain an ordering (e.g. `divA_y < divB_y < divC_y`), their ranges must not overlap. Set the max of the lower parameter below the min of the higher one, with enough gap that the code's `minGap` clamp never fires during normal use. If non-overlapping ranges are not possible, do not expose them as separate editable parameters — derive the dependent ones from the primary.
- Do not create parameters the code will not actually use.
- Do not expose implementation helpers as user controls.

---

## Parameter Quality Test

Before adding a parameter, ask:

1. Does this control matter for what the user actually asked for?
2. Would a real maker want to change this?
3. Does changing it preserve the object's intent?
4. Does it bind cleanly to a single top-level `const` in the code?
5. Can the range avoid broken geometry?
6. Is this better as a derived dimension?

If the answer is weak, do not expose it.

---

## Parameter Classifications

### design_control
Primary dimensions and style choices the user expects to edit.

Examples:

- width
- height
- depth
- shelf count
- roof pitch
- opening width
- layout style

### fabrication_control
Build-specific values that affect fabrication.

Examples:

- material thickness
- reveal gap
- kerf
- tolerance
- tool diameter
- edge band allowance

Usually **not a control at all** — a named const with no range. Expose one only when the object is genuinely about it (a CNC jig where the tool diameter is the point, a cabinet run where the user is choosing sheet thickness). "Advanced and collapsed" is still a row in the menu; the shop constant that never moves does not need one.

### derived_dimension
A formula based on other values.

Examples:

- inner width
- shelf clear opening
- divider spacing
- panel length
- cutter overshoot

Do not expose as a user control.

### hidden_implementation
Values needed by code but not useful to users.

Examples:

- temporary offsets
- cutter positions
- loop indexes
- construction helper dimensions

Do not include as parameters unless the code system requires them.

### relationship_control
A ratio or mode that preserves design intent while resizing.

Examples:

- left bay ratio
- middle shelf ratio
- layout style
- preserve reference layout
- max unsupported span

Use for reference-based or composition-heavy objects.

### count_control
Integer quantities.

Examples:

- shelf count
- drawer count
- hook count
- vent count

### style_control
Small design mode or construction choices.

Examples:

- roof style
- cabinet style
- layout mode
- construction method

### optional_toggle
On/off features.

Examples:

- include back panel
- add ventilation
- include toe kick

---

## Control Types

Choose the most natural control.

### number_with_slider
Continuous design values the user explores visually.

Examples: width, height, depth, roof pitch, opening size.

### number
Precise values where dragging is not useful.

Examples: kerf, tolerance, reveal gap, tool diameter.

### toggle
On/off features.

Examples: include back panel, add toe kick, add ventilation.

Binds to a numeric 0/1 const: `const includeBack = 1; // [0:1] toggle`.

### stepper
Integer counts.

Examples: shelf count, drawer count, hook count.

### preset_buttons
Standard values or common sizes.

Examples: cabinet widths, dog sizes, sheet thicknesses.

### segmented
Small mutually exclusive style choices.

Examples: roof style, cabinet style, layout mode.

Binds to a numeric index const: `const roofStyle = 0; // [0:2] choices: gable|flat|shed`.
List the same choices in the schema's `choices` array (display labels).

### dropdown
Large choice sets.

Examples: material library, finish, hardware family.

Binds by index, same as segmented.

---

## Group Rules

Groups should sound like how a maker thinks.

Good groups:

- Cabinet Size
- Shelf Layout
- Openings
- Roof
- Animal Fit
- Toe Kick
- Material
- Construction
- CNC Setup
- Advanced Fit

Avoid generic groups:

- Dimensions
- Settings
- Misc
- Variables

Order groups from most important to least important.

Each group needs a one-sentence help description.

---

## Priority Rules

### primary
The 2–4 controls users adjust first.

### secondary
Normal useful controls.

### advanced
Fabrication constants, tolerances, hidden-safe controls, and expert settings.

Advanced controls should be collapsed by default in the UI.

---

## Lock Rules

Use `locked: true` only when the value follows a known standard or must remain fixed for safety.

Examples:

- standard base cabinet height
- minimum material thickness
- fabrication method constraints

Always provide `lockReason` when locked.

---

## Warning Rules

Use short inline warnings only when helpful.

Examples:

- `Long span may sag.`
- `Low pitch may shed poorly.`
- `Thin walls may be fragile.`
- `Tight clearance may bind.`

Set warning to null when not needed.

---

## Quality Goal Behavior

### fast_preview
Keep controls minimal. Usually 1–3 parameters.

### clean_parametric_model
Expose the main maker controls and hide implementation math.

### reference_match
Use relationship controls where needed to preserve proportions, layout rhythm, or reference intent.

### fabrication_ready
Include necessary fabrication controls, usually advanced.

### marketplace_ready
Favor clean buyer-facing controls, presets, safe ranges, and polished labels.

### repair_or_revision
Preserve the existing schema unless the revision requires a local addition.

---

## Object-Specific Intelligence

### Shelving
Prefer controls for:

- width
- height
- depth
- material thickness
- shelf count
- bay pattern or layout style
- back panel toggle
- max unsupported span

Use derived dimensions for shelf spacing and divider positions.

### Cabinets
Prefer controls for:

- width
- height
- depth
- construction type
- door/drawer count
- reveal gap
- toe kick height
- material thickness
- back panel toggle

Use derived dimensions for openings, door sizes, drawer fronts, and interior clearances.

### Furniture
Prefer controls for:

- overall size
- seat/work height if relevant
- leg spacing
- top thickness
- bracing toggle
- overhang

Use derived dimensions for support positions.

### Enclosures / dog houses / sheds
Prefer controls for:

- width
- height
- depth
- wall thickness
- roof style
- roof pitch
- opening size
- ventilation toggle

Use derived dimensions for roof profile and wall panel sizes.

### CNC
Add advanced controls only when CNC is requested:

- material thickness
- tool diameter
- kerf
- slot clearance
- dogbone toggle

### 3D printing
Add advanced controls only when printing is requested:

- wall thickness
- clearance
- minimum feature size
- support strategy if needed

---

## The Schema Shape

`param_schema` is a **flat array** of parameter objects — pass it to `push_model_code`. Each item:

```json
{
  "id": "string",
  "name": "string",
  "displayName": "string",
  "controlType": "number_with_slider | number | toggle | stepper | preset_buttons | segmented | dropdown",
  "unit": "mm | deg | null",
  "default": "string",
  "min": null,
  "max": null,
  "step": null,
  "choices": null,
  "presets": null,
  "locked": false,
  "lockReason": null,
  "buyerFacing": true,
  "priority": "primary | secondary | advanced",
  "group": "string",
  "tooltip": "string",
  "warning": null,
  "classification": "design_control | fabrication_control | relationship_control | count_control | style_control | optional_toggle"
}
```

`name` must match the top-level `const` in your code exactly — that is the binding. The slider rewrites that literal, so a mismatch means the control does nothing.

**Derived dimensions are not parameters.** If a value is computed from others (`shelfWidth = width - 2 * mat`), declare it as a plain `const` in the code — never as a slider the user can desync.

---

## Final Self-Check

Before you push, verify:

- Does every parameter `name` match a top-level `const` in the code?
- Are there too many controls? Count the annotated consts — more than eight and you are almost certainly exposing shop constants. Drop those annotations; keep the consts.
- Is anything hard-coded that should at least be *named*, even if it is never exposed?
- Are raw coordinates hidden?
- Are defaults strings?
- Are units mm/deg/null only?
- Are parameter names valid JavaScript identifiers?
- Can every range produce valid geometry?
- Are derived dimensions formulas, not duplicated controls?
- Would a maker understand the labels?
- Does this schema preserve design intent when resized?
