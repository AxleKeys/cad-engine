# Revising a Working Model

How to make a targeted edit to existing, working Replicad code without breaking what already works. Patch only when the change is local and safe; when the request changes the whole approach, rebuild deliberately instead of forcing a fragile patch.

---

## Operating Principle

Be surgical.

Preserve what works. Change only what the user asked to change.

---

## Read Before You Patch

Call `get_model_code` first. It returns the current code, the **brief** (what the user originally asked for) and the **rationale** (why it was built this way). Both exist precisely so you don't undo a deliberate decision you can't see.

Then hold these as constraints:

- **The existing code** — preserve everything outside the local change.
- **The existing parameter schema** (`get_parameters`) — never rename, remove, or narrow an existing parameter. The user has values dialled into those sliders.
- **The existing named bodies** — do not drop one unless the user explicitly asked for it. They are what the Parts list shows.

---

## What You Own

You own:

- revision classification
- deciding whether local patch is safe
- minimal code edits
- preserving existing parameters
- adding small local geometry when safe
- recognising when a patch is the wrong tool and a rebuild is honest

You do not own:

- full object redesign
- new parameter schema design beyond local additions
- reference remapping
- CNC conversion
- deep fabrication planning

---

## Revision Classification

Use one value:

- dimension_change
- count_change
- add_feature
- remove_feature
- style_change
- parameter_change
- material_change
- layout_change
- reference_match
- fabrication_upgrade
- repair_request
- unclear

---

## Usually Safe To Patch

- make it wider/taller/deeper
- change an existing constant value
- add one shelf to an existing shelf system
- remove a back panel
- increase material thickness
- adjust a reveal gap
- enlarge an existing round hole
- change a simple opening size
- add a simple rectangular support
- rename a part

---

## Usually Requires A Rebuild, Not A Patch

- make it match a new reference closely
- convert open shelves into drawers/doors
- convert a render model into CNC-ready flat-pack parts
- add moving hardware with clearance logic
- change single-body geometry into a multi-part assembly
- change the coordinate system
- replace the main layout logic
- fix a model that failed because the original plan was visually wrong
- add cut lists, nesting, or fabrication outputs not supported by the original structure

When the request lands here, **do not force a patch.** Leave the working code alone, tell the user this is a rebuild rather than a tweak, and say what it will change. Then rebuild deliberately — reloading `pipeline-code-agent` and the relevant domain section — rather than smuggling a redesign in as an edit.

---

## Editing Rules

### Parameter schema rules
- Every parameter name in `EXISTING PARAMETER SCHEMA` is a contract. Do not rename, remove, or change its type unless the revision explicitly requires it.
- If you add a new parameter, it must not conflict with any existing parameter name.
- If you remove a parameter the revision asks to remove, also remove its `const` declaration and all uses from the code.
- Every new editable parameter needs a `// [min:max]` range annotation in the code.
- Every declared `const` with a range annotation must be used in geometry.
- Do not add parameters the user has not asked for.

### Named body rules
- Every name in `EXISTING NAMED BODIES` must remain in the output `bodyNames` and in the returned parts array, unless the revision explicitly removes that part.
- If adding a new part, append it to the named parts array with a clear semantic name.
- If renaming a part the revision asks to rename, update the name everywhere it appears (variable name, return array string, and `bodyNames`).

### Code preservation rules
- Preserve all existing parameter constants unless the revision changes them.
- Preserve every range annotation: `// [min:max]`.
- Preserve the coordinate convention comment.
- Do not reformat unrelated code.
- Do not rename variables unless required.
- Do not convert units.
- Use mm internally.

### Geometry rules
- Openings must be real cuts or built voids.
- Cutters must overshoot both faces they cut through.
- Do not use unavailable or invented Replicad methods.

---

## Function Contract

The revised code must still define:

```js
const main = ({ makeBox, makeCylinder, makeSphere, makeEllipsoid, Sketcher, draw, drawCircle, drawRectangle, drawRoundedRectangle, drawPolysides, loft, revolution, genericSweep, makeHelix, makePolygon, compoundShapes, measureVolume, measureArea, measureLength, DEG2RAD, RAD2DEG }) => {
  return solid;
};
```

Allowed return values:

- a single solid
- `compoundShapes(parts)`
- an array of `{ name: string, shape: Solid }`

---

## Patch Rules By Revision Type

### dimension_change
Change the relevant parameter default. Adjust range only if needed.

### count_change
Change the count parameter if one exists. If no count parameter exists and the structure supports it, add one.

### add_feature
Add the smallest geometry needed. Add it to the named parts array if the model uses named bodies.

### remove_feature
Remove the geometry and references for that feature only.

### style_change
Modify only the affected part.

### parameter_change
Update constants and parameter bindings without breaking existing controls.

### material_change
Change material-related constants only if represented in code. Otherwise note that it belongs in metadata/material UI.

### layout_change
Patch only if the current layout system already supports it. Otherwise rebuild.

### reference_match
Rebuild, unless the request is a tiny local adjustment.

### fabrication_upgrade
Rebuild, unless the change is a small local fabrication note or a simple parameter.

### repair_request
If the code is broken rather than merely out of date, load `pipeline-repair-agent` — unless the fix *is* the edit the user asked for.

---

## Pushing The Revision

`push_model_code({ model_id, code, param_schema, rationale })` — the push returns the build verdict; read it.

The `rationale` should say **what changed and why** — it overwrites the model's current reasoning, so carry forward anything from the old rationale that still holds. It is the only record of intent that survives you.

For a reversible edit, prefer `create_draft` → `validate_draft` → `promote_draft` instead of a direct push.

---

## Final Self-Check

Before you push, verify:

- Is this truly safe to patch, or am I forcing a rebuild through a patch?
- Did I change only what was requested?
- Did I leave every existing parameter name and range intact?
- Is every existing named body still present, unless removal was explicitly asked for?
- Did I preserve working code?
- Does the code still follow the Replicad contract?
- Does my rationale explain the change without discarding the original reasoning?
