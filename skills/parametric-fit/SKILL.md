---
name: parametric-fit
description: Make an existing parametric CAD model fit a real space or a hard number — an alcove, the gap under a window, a maximum depth — by moving the parameters it already declares and PROVING the result with a dimension check, never by editing geometry. USE WHEN someone has a model and a measurement it must meet ("make this shelf fit my 860mm alcove", "the bench has to be under 400 deep", "can it go to 2 metres tall?") and wants the fitted model back, verified. Requires the Axle Keys MCP server to be connected.
---

# Parametric fit

Someone has a model and a space. You hand back the same model, fitted: its parameters set so
the thing actually fits, and the fit **proven** by a dimension check on the rebuilt geometry —
not by reading a number off the code and calling it done.

This is the one thing a parametric model can do that a drawing cannot. Nothing here writes
geometry. If the model does not declare a parameter for the axis that has to change, that is a
finding to hand back, not a reason to edit the code.

**Tier: Free.** Everything in this skill runs on a free Axle Keys account.

---

## Before you start

The Axle Keys MCP server must be connected. If the tools below aren't available, stop and say
so — don't improvise a substitute.

You need two things from the person: **which model**, and **the constraint in their words with
its numbers** — "the alcove is 860 wide and 300 deep". If they gave you a space, the target is
the space *minus the clearance they want*; ask if they didn't say. Do not invent a target.

Do the clearance arithmetic once, out loud, before anything else, because it is the one sum
in this skill that goes wrong. "10mm each side" is subtracted **twice** from the width;
"10mm at the back" is subtracted **once** from the depth, and nothing comes off the front:
an alcove 720 wide and 260 deep with those clearances is a target of **700 × 250**.

Everything Axle measures is in **millimetres**. If `get_active_context` reports
`display_units: "in"`, this person reads in inches — quote the fit in both.

---

## The loop

### 1. Orient — which model

```
get_active_context()
```

If a model is open and its name matches what they said, that is the one — but read
`reported_seconds_ago` before trusting it: the open model is the most recent *report*, and a
report from yesterday is a tab they may have long since closed. If the page is blank, the
report is stale, or they named a different model, find it — `find_models(query: "…")`
searches their library and says why each result matched; `list_models` shows the whole tree.
When two candidates look plausible, ask. Every write below takes a `model_id`, and a fit
applied to the wrong model is work the user has to undo.

### 2. Record the constraint — before touching anything

```
state_brief(
  model_id,
  request: "<what they asked for, in THEIR words>",
  constraints: ["alcove 720 wide × 260 deep", "10mm clearance each side and at the back"],
  target_dimensions: { width: 700, depth: 250 }      # mm; only the axes they constrained
)
```

Axle cannot see this conversation, now or later. The `request` is the only record of what
"fit" meant; `constraints` is where the clearance arithmetic survives (it is shown back to
the next reader as "Must satisfy: …"); `target_dimensions` is what the proof in step 6 is
checked against. Quote them; do not tidy their sentence into yours. Call it again if the ask
changes mid-way. (Its reply may suggest other tools — `get_validation_report` and the like.
You do not need them here; the fit is proven by step 6.)

### 3. Read what can move

```
get_parameters(model_id)
```

Returns every parameter with `value`, `min`, `max`, `locked` and `changeClass`. This is the
whole vocabulary you have. Map the constraint onto it:

- Usually one parameter drives one axis directly — `width` is the overall width.
- Often the axis is **derived**: the overall width is `width` plus two `overhang`s, or the
  overall height is `legHeight` plus `topThickness`. Read the code once to see how the
  envelope is built from the parameters — `get_model_code(model_id)` — read it, do not edit
  it.
- If no parameter reaches the constrained axis, **stop here and say so**: "this model's depth
  is fixed at 350 by its code; making it adjustable is a code change, not a fit." That is a
  complete answer. Do not push code.

A parameter marked `locked` is off limits. `derived: true` just means the parameter came from
a code annotation and has not been saved to a schema yet — the first update saves it.

### 4. Measure where it stands

```
check_dimensions(model_id, width: 700, depth: 250, tolerance_mm: 1)
```

⚠ **Flat arguments in millimetres**, only the axes you were given — not the nested
`target_dimensions` object `state_brief` takes. Same numbers, different shape.

It builds the current code fresh, measures the overall box and returns `pass`, `offAxes` and
`measured` — all three axes of `measured`, so an axis that is meant to stay put can be
*verified* to have stayed put rather than assumed. Read `measured`: it is your starting
point, and `offAxes` names exactly which axes are out. **If it already passes, say so and
stop** — a fit that changes nothing is the right answer more often than it sounds.

**Name the band.** The default is 5% or 3mm, which is loose — a 945mm result passes a 900mm
ask. When the size *is* the point (an alcove, a mating part) pass `tolerance_mm`. It is
symmetric (±), so choose it smaller than the clearance you subtracted: `tolerance_mm: 1`
against a 10mm clearance means the worst case still clears by 9. Use the same band in
step 6 and say which one you used.

### 5. Fit — move the parameter, read the verdict

```
update_parameters(model_id, values: { width: 700, depth: 250 })
```

`values` maps parameter id to the new number. It rewrites the consts, rebuilds server-side and
returns the build verdict as text **with the new dimensions in it** — the line reads
`overall 700 × 250 × 1200` (X × Y × Z) — read it before doing anything else. One call may
carry several parameters: when the code read in step 3 showed the axes are independent (each
axis its own parameter), move them together; when one parameter reaches two axes, move one at
a time and re-read all three dimensions after each change. Two things to hold to:

- **The range is a promise, not a suggestion.** A value outside `min`…`max` is *refused*, not
  clamped, and that is correct: the author verified the model only inside that range. If the
  constraint needs a value outside it, that is the finding — report the range, the value the
  fit needs, and the nearest in-range value with its remaining gap. Widening a range is a
  code change; it is not this skill.
- **A fit that breaks the model is not a fit.** A clean verdict simply has no problems
  section. A bad one lists them, one per line, like
  `[error] part_interference: Parts 'Side L' and 'Drawer' occupy 34,980mm³ of the SAME solid volume …`
  or `[warning] unsupported_part: Part 'Slat 1' sits at z=430.0mm with nothing beneath it …`.
  The first means two parts now share volume; the second means something is floating. Do not
  hand back a model that fits its alcove and collides with itself — back the value out with
  `update_parameters` set to the previous value (you have it from step 3), and report what
  the constraint ran into. `rollback` also works, but it needs `base_content_hash`, the
  `Base:` value from a fresh `get_model_code` — `update_parameters` does not return one.

When the relationship is not one-to-one, **bracket, then interpolate**. Set the parameter to
the low end of its range and read the `overall` line; set it to the high end and read it
again. If the target is not between those two envelopes, the model cannot fit inside its
declared ranges — say so with both numbers. If it is, the mapping is nearly always linear:
compute the value from the two readings, apply it, read the result. Two or three rounds, each
one a real build with real dimensions, never a guess from the code.

### 6. Prove it

```
check_dimensions(model_id, width: 700, depth: 250, tolerance_mm: 1)   # same axes, same band as step 4
```

This is the claim you are allowed to make. `pass: true` with the band you name, or nothing.
If `offAxes` still lists something, go back to step 5 for that axis; if you cannot close it,
hand back the measured number and the reason, not "close enough".

⚠ **A pass proves the envelope, not the design.** It measures the overall box. It does not
know that a shelf pitch became unusable or a door became too narrow to open. Read the
verdict from step 5 and look at the model in step 7.

### 7. Show them

```
show_model(model_id)
```

Renders the card the user sees — picture, overall size, parameters as they now stand.

⚠ `show_model` exists on the **hosted connector** (`https://api.axlekeys.com/mcp`, the door
this repo points you at). The locally installed stdio server does not have it, and a tool
loader may drop the name silently rather than error — so if it is not in your tool list,
say so and fall back to `get_model_screenshot(model_id)`, which returns a raw image and can
lag the latest build by a few seconds. Do not skip the step silently: the picture is how the
user sees the fit rather than reading about it.

Tell them what moved, from what to what, and that the size was verified against which band.
Their open tab does not switch by itself; say where the model is.

---

## Done looks like

- The same model, with the parameter(s) that reach the constraint set to fitted values.
- A clean build verdict after the change — no new interference, nothing floating.
- A passing `check_dimensions` against the numbers they gave, with the band named.
- Their words on the model as its brief, with the constraints and the target dimensions.
- A picture — `show_model`, or `get_model_screenshot` where that is the tool you have — and a
  one-line account of what moved, in their units as well as millimetres if they read in inches.

## When it goes wrong

**No parameter reaches the axis** — the honest answer is "this dimension is fixed by the
code". Say which const fixes it. Making it adjustable is a code change (the `brief-to-model`
skill, or the user in Studio), and you should not slip one in under a fit.

**The value needed is outside the declared range** — report the range, the needed value and
the nearest in-range result with its gap. Do not force it, do not edit the range.

**The build reports problems after the change** — back it out, then explain what the
constraint ran into (usually a joint that needs a minimum width, or a part that no longer
lands on its support). The user decides what gives.

**`check_dimensions` fails after the fit** — read `offAxes` and `measured`. If a second
parameter moved the axis you had just fixed, fit them together; bracket again if the mapping
surprised you.

**Tools are there but every call comes back `401` / "Unauthorized"** — the connection is
fine; the account isn't admitted yet. Axle Keys is invitation-only: signing in needs a
Keyholder code from [axlekeys.com](https://axlekeys.com). Say that and stop; do not send them
round the loop re-checking their MCP setup.

## What this skill won't do

It does not write or edit model code, add parameters, or widen ranges. It does not optimise
for anything except the numbers it was given — yield, cost and weight are other questions.
It does not fit an assembly of several models; it fits one model at a time.
