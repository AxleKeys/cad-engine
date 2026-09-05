---
name: design-loop
description: Verify an agent-built CAD model with independent critics instead of self-review — clean-context reviewers that fetch the reference and probe the geometry themselves, then a punch list you gate on. USE WHEN a build pass is finished, before handing a model back to whoever asked for it, or when someone asks "is this actually right?" about a model an agent built. Requires the Axle Keys MCP server to be connected.
---

# The Design Loop

You built it. That is exactly why you may not be the one who says it is finished.

**Tier: Free.** Everything in this skill runs on a free Axle Keys account — it reads, probes
and screenshots, and writes nothing but a note.

---

## The problem this solves

An agent that builds a model cannot reliably verify it, because **its misreading of the
reference is the same lens it would check with.** Self-review catches errors of *execution* —
a proportion that came out wrong, a curve that overshot. It structurally misses errors of
*interpretation*: the thing you were confidently sure the picture showed.

And the usual signals do not catch those either. A model can build clean, hit its target
dimensions to the millimetre, bind every material correctly, raise zero validator warnings —
and still be the wrong object, or one that cannot physically be assembled. Those checks are
all true. None of them measures *"is this the thing that was asked for."*

So verification needs actors defined by what they **don't** have: your context.

## Before you start

The Axle Keys MCP server must be connected. If the tools below aren't available, stop and say
so — don't improvise a substitute.

### One-time install: the critics

This skill spawns subagents from charter files. Copy them where your harness looks for agents:

```
cp skills/design-loop/agents/*.md .claude/agents/
```

⚠⚠ **They arm on your NEXT session, not this one.** Agent charters are scanned at session
start. If you install them now and immediately try to spawn one, you will get *"Agent type not
found"* — that is the install not having taken effect yet, not a broken skill. Start a new
session and they are there.

⛔ **Do not work around that by pasting a charter into a general-purpose agent** and calling it
the same thing. It proves the method but not that the charter loaded, and in a review record
those two failures look identical. If a critic won't spawn, report that it **did not run** and
treat its axis as unaudited.

## Which tool surface do you have?

Axle exposes its tools two ways, and it changes how every probe here is written:

- **Direct** — `measure(...)`, `list_model_files(...)` callable by name.
- **Code Mode only** — some connections expose a reduced set (`execute`, `get_model_state`,
  `create_model`, …) and everything else rides `await axle.<room>.<tool>({...})` inside
  `execute`.

⚠ A tool missing from your list is **not** evidence it doesn't exist. Reach for `execute`, and
use `search_api("<what you want>")` to find where a tool lives — `read_api_docs(room)` only
confirms the room you already guessed.

## Step 1 — preflight

Cheap, and it stops you paying for critics that will both refuse.

1. `get_model_state(model_id, detail:"summary")` — does it build? Is there a brief? A model
   with no recorded ask cannot be audited by anyone; stop and record one with `state_brief`
   first.
2. `list_model_files(model_id, role:"visual_reference")` — **empty means the Fidelity Critic
   refuses by charter.** Before reporting that, list unfiltered: an image sitting under another
   role means the reference exists and is **mis-tagged** (`set_file_role`), which is a different
   unblock from never uploaded (`upload_file`).
3. Check the brief's history — a superseded ask is not a live constraint, and auditing against
   a stale one manufactures findings.

⭐ **Sort the constraints while you are here.** A constraint about *interpretation* ("it should
read as mid-century", "the photo wins over the drawing") is unprobeable by construction and
belongs to the Fidelity Critic. Put it where a Spec Auditor meets it and you manufacture a
permanent "unverifiable" — noise without doubt.

## Step 2 — spawn the critics, cold, in parallel

One message, multiple calls, so they run concurrently:

- `subagent_type: "fidelity-critic"` — does it match the reference?
- `subagent_type: "spec-auditor"` — does it satisfy what's written?
- `subagent_type: "dfm-reviewer"` — can it be cut and assembled? ⭐ Include it from the
  *features* pass onward and always before handback. Skip it at early massing, where joinery
  legitimately doesn't exist yet — and **say you skipped it**, or the review claims coverage it
  doesn't have.

⚠⚠ **THE SPAWN PROMPT IS THE CONTAMINATION CHANNEL. This is the whole mechanism.** A critic's
independence is destroyed by a helpful prompt exactly as thoroughly as by reading your code —
and you are the one writing that prompt, while trying to be useful. Pass **only**:

```
Model: <model_id>
Gate: <pass> pass, round <N>
Accepted-as-is from earlier rounds (do not re-litigate): <list, or "none">
```

**Never** pass what you built, why you built it that way, what you think the reference shows,
what you already fixed, or what you expect them to find. If you catch yourself explaining the
model, delete the sentence. They fetch what they need.

The charters read at `detail:"summary"` deliberately — that form withholds the previous
author's code and rationale, so their narrative is *unavailable* rather than merely forbidden.
Don't hand them the code to "save a call."

## Step 3 — compile the punch list

Merge the reports **without editing their findings.** You may deduplicate an identical finding
reported by two critics (keep both citations). You may not soften, reword, or drop one because
you disagree — if you think a critic is wrong, that is a note *beside* the finding.

Group: **BLOCKING** → **MAJOR** → **MINOR** → **UNVERIFIABLE** → **ROUTED**. Then:

> **A pass closes only at 0 blocking. Build-green never closes a pass. Zero blocking from one
> of three critics is not acceptance. The author does not close the pass.**

Present the punch list and your recommendation to the human. You do not announce the gate as
closed.

## Step 4 — record the verdict

One note per gate, so the review survives the conversation:

```
log_backlog_entry({
  type: "decision",
  title: "<pass> gate · <model> — <B> blocking / <M> major / <m> minor / <U> unverifiable",
  body: "<the punch list, the camera poses the Fidelity Critic used, and the
          accepted-as-is carry-forward for the next round>",
  related: { model_id: "<model_id>" },
})
```

⭐ **Record the poses.** A named view (`"front"`, `"iso"`) re-frames from the model's live
bounding box, so two identical calls can frame differently and a round-over-round difference
becomes unattributable — geometry change, or camera? Captures return the pose they resolved to;
pass those coordinates back next round. Critics are fresh each round and cannot carry this, so
it is your job.

## Step 5 — the next round

- Critics are **fresh every round.** A critic that remembers starts defending its last verdict.
- **You** carry forward the accepted-as-is minors, so fresh critics don't re-litigate them.
- ⚠ **The same blocking finding surviving two rounds → escalate to the human.** Two rounds on
  one finding means the author and the critic disagree about what the record says. That is a
  judgment call, not an iteration. Never thrash.

## The laws

1. The author never closes a pass.
2. Critics return **findings, never fixes.** A critic that proposes a fix starts defending it,
   and next round it is grading its own work.
3. **Anything a probe can answer must be probed, not eyeballed.** Judgment is reserved for what
   only judgment can answer — does the silhouette read as the reference.
4. Anything unverifiable is reported **as** unverifiable, with its unblock named. Never waved
   through. ⚠ And a false "unverifiable" costs what a false pass costs: before writing one,
   search for the tool that would settle it.
5. Every blocking finding names the **discriminating evidence** — the exact probe or render
   that settles it either way.
6. No reference on the model → the Fidelity Critic **refuses.** A fidelity verdict built on a
   *described* reference re-enacts the failure the critic was hired to catch.

## Give the model a reference it can be judged against

Fidelity is unmeasurable without one, and a reference that lives only in your conversation is
one a clean-context critic can never fetch — which is the most common way this loop starves.

```
upload_file({ model_id, name: "reference.jpg", content_base64: "...",
              role: "visual_reference" })
```

`role` is a fixed vocabulary, so a near-miss is rejected rather than silently stored. Attach the
reference when the model is created, not when someone asks for a review.
