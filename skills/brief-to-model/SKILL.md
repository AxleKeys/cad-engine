---
name: brief-to-model
description: Turn a plain-English description into a real parametric 3D CAD model — built, dimension-verified, and shown back as a picture you can spin. USE WHEN someone describes a physical thing they want to make ("a shelf for a 900mm alcove", "a phone stand", "a planter box in 18mm ply") and wants an actual model rather than a sketch, a render, or code they have to run themselves. Requires the Axle Keys MCP server to be connected.
---

# Brief → Model

Someone describes a thing. You hand back a real parametric CAD model: geometry built on
Axle's server, dimensions checked against what they asked for, and a picture of it.

Not a mesh, not a render, not a script they have to run. A model with named parameters
they can drag afterwards, living in their Axle workspace.

**Tier: Free.** Everything in this skill runs on a free Axle Keys account.

---

## Before you start

The Axle Keys MCP server must be connected. If the tools below aren't available, stop and
say so — don't improvise a substitute. There is no offline mode and no local fallback.

**You do not need to know CAD to run this skill.** Step 2 loads the geometry rules from
the platform. Do not skip it and write from memory — Axle checks what you build, and the
rules it teaches are the ones its checker enforces.

That instruction was earned. The first run of this skill skipped step 2, guessed one
convention wrong (where a primitive sits relative to the origin), and produced a planter
box with a sealed lid and a half-thickness floor — which **built cleanly and passed its
dimension check on all three axes**. Confident, verified, wrong. Load the rules.

---

## The loop

### 1. Orient

```
get_active_context()
```

Tells you where the user actually is: their workspace, whether a model is already open,
which **System packs** are active (domain rule-sets like cabinetmaking), and whether the
product has a **material palette** (the stock it's allowed to be built from).

Read all four. A palette means real thicknesses you must build to, not invent.

If `context_stack` is present, open with it so the user can see which brain is answering.
On a blank page with no System packs bound it comes back `null` — don't try to print it,
and don't treat its absence as an error.

### 2. Load the rules — before writing any geometry

```
get_skill_pack()                       # master file; it names the sections to load next
get_skill_pack(section: "…")           # load what it named
search_knowledge(query: "…", model_id) # focused questions, once you have a model_id
```

If `active_systems` came back non-empty, load the union of their rules sections. Domain
knowledge is **withheld until you ask with the right `model_id`** — a cabinet rule must not
leak into an unrelated build — so pass `model_id` on `search_knowledge` once you have one.

This step is not optional and it is not padding. It is how your code ends up matching the
conventions Axle validates against.

### 3. Create the model — carrying their words

```
create_model(
  name: "Alcove Shelf",
  brief: "<what they asked for, in THEIR words>",
  constraints: ["must fit a 900mm alcove", "18mm birch ply", "no visible fixings"],
  target_dimensions: { width, depth, height },   # mm, if they gave sizes
  project_id: "…"                                # optional, to nest it
)
```

Returns `model_id`.

⚠ **`brief` must be their words, quoted — not your summary.** Axle never sees this
conversation. Not now, not later. There is no transcript. The brief is the only record of
what was actually wanted, and everything downstream — validation, later edits, the next
agent to open this model — reads it instead of asking. Paraphrasing it into your own
tidy sentence is the single most damaging thing you can do in this skill.

`constraints` are what the result gets judged against. Extract them; don't leave them in
your head.

### 4. Build

```
push_model_code(model_id, code, rationale: "why it's built this way")
```

The build runs server-side and the verdict usually comes back in the response — build
status, part counts, measured geometry, validator warnings. **Read it.** Never assume it
worked.

Slower builds don't fit in the response. When it says the build is still running, that is
a normal outcome and not a failure: call `get_build_status(model_id)` and read the verdict
there. Expect this often enough to handle it every time.

If it failed, fix the operation that broke and push again. Don't rewrite the whole model.

**Validator warnings are part of the verdict, not decoration.** The most common one tells
you your driving dimensions aren't annotated as adjustable — and if you ignore it, the
user gets a fixed lump of geometry instead of the parametric model this skill promised
them. The warning states the exact form it wants. Do what it says and push again.

`rationale` is required and is the only record of your reasoning — write it for whoever
opens this cold in six months: key dimensions and where they came from, the approach you
took, what you rejected, what a future edit must not break.

### 5. Prove the size

If they gave dimensions:

```
check_dimensions(model_id, width: 900, depth: 300, height: 2100)
```

⚠ **Flat arguments in millimetres** — `width`/`depth`/`height` at the top level. This is
*not* the nested `target_dimensions: {…}` object that `create_model` takes. Same three
numbers, different shape, and the mistake is easy to make in sequence.

Returns `pass` plus `offAxes` naming exactly which axes are out of tolerance, so you can
revise precisely instead of guessing. Tolerance is 5% or 3mm.

Don't claim you hit their numbers until this passes. Claiming it is exactly the kind of
thing this tool exists to stop.

⚠ **A pass proves the envelope, not the design.** It measures the overall bounding box.
A box with the right outside dimensions and a sealed lid where an open top was asked for
passes all three axes. So a green `check_dimensions` retires exactly one question — is it
the right size — and none of the others. Read the constraints back against what you
actually built, and use `show_model` to look at it.

### 6. Show them

```
show_model(model_id)
```

Renders a visual card — picture, overall size, build status, parameters. This is how the
user *sees* the result instead of reading your description of it.

Use `get_model_screenshot` only when **you** want to eyeball the geometry yourself; it
returns a raw image for your inspection and it lags the latest build. `show_model` is the
one for the human.

---

## Done looks like

- A model in their workspace with named parameters they can drag.
- A build verdict you actually read.
- If sizes were given: a passing `check_dimensions`.
- A picture, via `show_model`.
- Their own words preserved in the brief.

Then tell them where it is — the Project explorer. **Their open tab does not switch by
itself**, so "it's on your screen" is wrong unless you put it there.

## When it goes wrong

**Tools missing** — the MCP server isn't connected at all. Say so plainly.

**Tools are there, but every call comes back `401` / "Unauthorized" / "invalid_token"** —
this is a *different problem* and it matters that you don't confuse the two. The connection
is fine; the account isn't admitted yet.

Axle Keys is currently invitation-only: signing in needs a **Keyholder code**, which you
request at [axlekeys.com](https://axlekeys.com). Tell the user that plainly and stop — do
not send them round the loop re-checking their MCP setup, re-pasting the URL, or hunting
for a config mistake. There isn't one. No amount of reconnecting fixes not having access,
and "check your connection" is the single most frustrating thing you can say to someone
whose connection is already correct.

**Build failed** — the verdict names the operation. Fix that one thing and push again. If
the same failure repeats, `search_knowledge` with the error text before trying a third
time; someone has usually hit it before.

**`check_dimensions` fails** — read `offAxes`. It tells you which axes, so change those.

**No dimensions given** — skip step 5, and say you skipped it. Don't invent a target and
then verify against your own invention; that proves nothing.

## What this skill won't do

Drawings, cut lists, and video are separate capabilities on paid tiers, and separate
skills. This one ends at a built, verified, visible model — which is the part that has to
be right before any of those mean anything.
