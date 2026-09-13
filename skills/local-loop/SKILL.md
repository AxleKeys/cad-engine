---
name: local-loop
description: Iterate on an Axle Keys model on your own machine at tens of milliseconds a build — the same engine and the same verdict axlekeys.com runs — then push the finished model once instead of a round trip per attempt. USE WHEN a model needs many attempts before it is right (searching for a size that fits, hunting an interference, comparing a dozen variants), when someone says the build loop is too slow, or when they want to work offline. Requires Node 23+ on the machine; the push at the end needs the Axle Keys MCP server.
---

# Local loop

Some answers need one build. Others need forty: the size that finally clears, the pitch where
the parts stop colliding, the variant that uses the least material. This skill is for the
second kind. You do the forty builds on the machine you are already on, where each one costs
tens of milliseconds, and you spend **one** write on the answer.

The local engine is not a lookalike. `npx @axle-keys/cad-engine` runs the same engine the
platform's build service runs, on the same model code, and reports the same geometry verdict —
same rules, same wording, same measured numbers. That is what makes the arithmetic honest:
forty attempts locally cost a few seconds, and forty pushes cost forty round trips and forty
version rows on someone else's model.

**Tier: Free.** Everything in this skill runs on a free Axle Keys account. The engine is MIT
licensed and needs no account at all.

---

## Before you start

**Two doors, and you need both.** The engine, for the attempts — Node 23 or newer, proven in
step 1, not assumed. The Axle Keys MCP server, for the one write at the end: the local engine
can build a model but it cannot save one into someone's account. If the MCP tools are not
available, say so and stop — do not hand back a file on disk and call it a model.

⚠ **If you hold more than one Axle connection, find out which one you are writing through**
before you write. A hosted connector *and* a local install is the ordinary case, and the two
can resolve to different accounts with nothing looking wrong. `get_active_context` reports
`account.label` (the account the call acted on) and `account.connection` (the name the user gave
that credential). ⚠ **It answers for the connection you called it through, not for all of
them** — to tell two apart you must call it on each. Do that once, say which one you are using,
and use the same one all the way through: a model deposited in the wrong workspace looks exactly
like a model deposited in the right one.

**This skill is not how to write geometry — but you will need that, so get it from the
platform before you write any.** The API and the modelling rules are a tool call away:
`get_skill_pack` is the read half, and `search_api` / `read_api_docs` look up a specific call.
Do that *before* the first build, not after one fails: guessing how a part is placed costs you
a build and can cost you a silently wrong model. If you are authoring from a blank page, the
`brief-to-model` skill choreographs the whole job. Nothing here paraphrases any of it — the
local engine reports the same problems the platform reports, and each problem's message is the
instruction.

**Know when it is worth it.** One known change to one known parameter is a push, not a project:
installing an engine to save a single round trip is not a saving. Reach for this skill when the
number of attempts is genuinely unknown, when the user is offline, or when they have said the
loop is too slow.

---

## The loop

### 1. Prove the engine — one build, before you plan around it

Write a probe file — `probe.js`, one line, no parameters:

```js
const main = ({ makeBaseBox }) => [{ name: "probe", shape: makeBaseBox(10, 10, 10) }];
```

```
npx -y @axle-keys/cad-engine build probe.js
```

Expect `✓ built in …ms — 1 part(s)`, `overall 10.0 × 10.0 × 10.0`, `no problems.`, exit 0.
That one command proves all three things the rest of this skill depends on: the package
installs, the Node floor is met, and the geometry kernel loads and builds.

**Judge it by the `✓` line and the exit code, not by a silent stderr.** The engine writes
notes there — you are likely to see one about a bundled drafting face failing to load, which
is harmless unless the model draws text. A build that printed the tick and exited 0 passed.

⚠ **Only a build proves it.** Do not reach for `axle help` or `axle version` as the check:
neither starts the kernel, so neither can tell you geometry works, and `version` may not
answer at all. When you need to name the version — reporting a bug, pinning a run — use
`npm view @axle-keys/cad-engine version`, which reports what `npx -y` just resolved.

Run the probe once more with `--json` and read the record. It is the shape you will be reading
for the rest of the loop, and its per-part boxes are **absolute** `minX/maxX/minY/maxY/minZ/maxZ`
— which is how you settle where a primitive actually sits relative to the origin by measuring
it, instead of assuming and finding out four builds later.

`axle help` is still worth one look: it lists the verbs the installed version actually has.
This skill uses `build`, `explain` and `repl`, which every published version carries.

📎 **`axle …` below is shorthand.** There is no `axle` on your PATH — every command in this
skill is really `npx -y @axle-keys/cad-engine …`, exactly as written above.

### 2. Get the code onto the machine — and decide where the model lives

**An existing model.**

```
get_model_code(model_id)
```

Write the code it returns into a file. ⭐ **Keep the `Base:` value it prints.** The push in
step 6 is refused without it — and that refusal is what stops you overwriting a change the user
made in Studio while you were iterating.

⭐ **If the ask is new or has changed, record it — `state_brief(model_id, request, constraints,
target_dimensions)` — before you iterate.** "Now space the slats out" is a different brief from
the one the model was built under, and it is the only record of why the model changed; earlier
briefs are kept as history, so calling it costs nothing.

**A new model from a brief.** Create it on the platform *first*, empty, carrying their words:

```
create_model(
  name: "…",
  brief: "<what they asked for, in THEIR words>",
  constraints: ["opening measures 512mm", "6mm clearance each side", "must clear the radiator"],
  target_dimensions: { width: 500, depth: 140, height: 620 }    # mm
)
```

No `code` argument, so nothing builds and no `rationale` is needed yet. Two reasons to do this
now rather than at the end: Axle cannot see this conversation, ever, so the brief is the only
record of what the work was *for*; and a model that exists before the loop starts is a model
that survives the loop going wrong. Keep the returned `content_hash` — the response tells you
to pass it as `base_content_hash` on your first push, and doing so is always right.

⚠ **`target_dimensions` takes the numbers you will CHECK, not the numbers they said.** A 512mm
opening with 6mm of clearance each side is a *512mm opening* in `constraints` and a **500mm
width** in `target_dimensions` — subtracted twice for "each side", once for "at the back", and
nothing for the front. Do that sum once, out loud, before anything builds: it is the one piece
of arithmetic in this skill that goes wrong, and step 6 is measured against whichever number
you wrote here.

Then write your starting geometry to a file beside `probe.js`.

### 3. Read what can move — ask, don't infer

```
npx -y @axle-keys/cad-engine explain model.js
```

Every parameter, the value a build would use, and the range the model declares — plus, listed
separately when there are any, the numeric constants that carry no range, which is the reason
`--param` refuses a name. (No such section means none, not a tool that failed to look.) Do not work this out by reading the file: `explain` reads the same annotation grammar
that `--param`, the platform and Studio's sliders read, so what it prints is what will actually
move. It does not build, so it costs nothing.

⚠ **A parameter is a TOP-LEVEL const — outside `main`, not inside it.** That is the input
contract for all three of this skill's verbs: nest the consts and `explain` reports that the
model declares none, `--param` refuses every name, and the repl has nothing to sweep. If
`explain` comes back empty on a model that plainly has numbers in it, this is why. (The
unannotated list holds top-level numeric *literals*; a const computed from other consts is an
expression and appears in neither list.)

**Probing out of range is free; shipping out of range is not.** A value outside the declared
range is accepted at the command line — the range is what the model says, not a limit the CLI
enforces — so a fractional or out-of-range probe is a legitimate move, and the verdict tells
you whether it was a good one. Pushing a model whose declared range has been widened is a
different act: it changes what the model promises everything that reads it, and *When it goes
wrong* below says how to handle that.

### 4. Make the criterion something the engine measures

**`passed` is never the user's question.** It answers one thing: did the checks find a problem
that gates. Measured in this skill's own cold-agent proof — a shelving unit built clean at
*every* shelf count from zero to eight, all at the requested overall size. An agent that
stopped at `passed: true` would have handed back a unit with no shelves in it.

⭐ **First, find out what the engine already measures — then calibrate it like anything else.**
Build once at a value you expect to pass and once at one you expect to fail, and read the whole
`problems` array. A rule the platform applies to the final model is worth more than scaffolding
you invent to stand in for it. ⚠ **But a rule whose NAME matches your criterion may be making a
much weaker claim, and that is worse than no rule at all, because it arrives with
`passed: true`.** Measured: two cold runs took the engine's bearing rule for "every slat still
sits on its rails" — and that rule fires only when a part's footprint overlaps its supports by
*nothing at all*. It stayed silent with **69 of a 70mm slat hanging off each end**, and spoke
late by 17mm in one run and by 138mm in the other, which is also why you cannot inherit either
number. **Read the rule's own message text, find the value where it flips, and check that flip
is where your criterion is.** Adopt it only then.

⭐ **And look at what is already recorded on the model.** `get_model_code` prints the target
dimensions someone agreed to earlier; on an existing model that number is often the constraint
restated — "every slat still sits on the rails" and "the depth stays 1200" were the same
sentence in one cold run, and the recorded target turned a fuzzy brief into an exact, free
test. Check there before you build an instrument.

Then decide what the engine will measure that means *right*, and say it out loud — including
its **scope**, because that is where a brief is usually vague. "At least 150mm between shelves"
either does or does not cover the bay under the bottom shelf and the one above the top; state
which you took, in the same sentence as the number, so the user can correct you cheaply rather
than after the push. **Try to make
it a subtraction before you make it a solid** — a criterion derived from numbers the engine
already reports is exact, free, and cannot be wrong about itself, and scaffolding is what you
build when no such subtraction exists. One cold run's whole "nothing hangs off the rails"
question collapsed to a single identity between two reported numbers; another's needed a block.
Almost every brief is one of three shapes:

- **A dimension.** Read it off the verdict. `overall` is the envelope; `--json` gives every
  part's absolute `minX/maxX/…`, so a clear span, an offset or a gap between two parts is a
  subtraction over numbers the engine measured, not numbers you assumed.
- **A clearance or a fit.** Put it in the model as geometry and let the checker judge it.
  "At least 150mm between shelves" is a 150mm solid standing in each opening — a **gauge**: if
  an opening is too short, the engine reports a real measured intersection and names the volume.
  You are not doing the arithmetic; you are asking the same checker that will judge the final
  model.
- **A maximum or a minimum** — "as many shelves as fit", "the widest that still clears". Sweep
  the candidates and take the last one that came back clean. ⚠ **Reach for the dimension
  instrument here whenever the criterion is a distance the engine already measures** — an
  overall size, or a subtraction between two part boxes — and use a gauge only when it is not:
  a gauge has a blind band (rule 3 below) and will hand you a limit that is slightly too
  generous, while a measured distance is exact and free. When both are available, run both and
  believe only a number they agree on — that is how a cold run caught its own gauge answering
  0.04mm on the unsafe side of the true limit.

Five rules for a gauge, every one of them written because it cost a run a wrong answer:

1. ⚠ **It is scaffolding and must never reach the push.** Emit the plain model and the gauged
   model from ONE source — a few lines of script that write both files — and before step 6
   regenerate, grep the plain file for the gauge, and **hash it** — then push. The push takes a
   string, not a path, and no tool call can be handed a file, so the string you send is always
   retyped and is a different artifact from the one you grepped. The hash you take *before* the
   push is what makes the read-back in step 6 mean anything. Proving something about an object
   you are not shipping is worse than not checking at all. A toggle const inside the file you
   will push is *not* this: it satisfies "one source" while shipping the scaffolding.
2. ⚠ **The gauged model's verdict is about the gauged model, not yours.** A gauge changes the
   thing being measured: it can grow `overall` (a block standing in the top opening protrudes
   through the roof — measured, 952mm on a 900mm model), and it can make `passed` false all by
   itself, because a gauge floating in mid-air is a part with nothing under it — stand it on
   the floor of the space it is measuring rather than centring it there. **Read only the rule
   you introduced it to trigger, AND only against the parts you introduced it to test**: a
   sweep that reports twelve interference lines may be six real ones and six gauges colliding
   with each other, which look identical if you match on the rule name. **Filter by the PART
   NAMES in the message — gauge-against-model is your answer, gauge-against-gauge is noise —
   never by the rule.** Insetting a gauge from the parts you are not testing helps where it
   can, but it cannot save you when the gauges stack along the very axis you are measuring:
   oversize them and they must overlap each other, and one cold run duly got 11 lines, 6 real
   and 5 spurious. Name-filtering is the remedy that always works. Every dimension, every
   `overall`, the final verdict and the file you push come from the plain model.
3. ⚠ **Calibrate it, and measure its blind band on YOUR model.** Faces that touch exactly are
   a joint, not a collision — the check measures shared *volume* — and it ignores a sliver
   besides, so a gauge cut to exactly the minimum passes at exactly the minimum, which is what
   "at least" means. How big that sliver is depends on the model: three cold runs measured the
   flip in three different places, and one saw 0.1mm reported where another saw 0.1mm ignored.
   So find yours. When the gauge is a fixed size you reposition, walk its position; when the
   gauge's own dimension IS the criterion, freeze the candidate and sweep that dimension until
   it flips — which means the gauge's dimension has to be an annotated top-level const in the
   generated file like any other parameter, or `--param` cannot reach it. Do it at a candidate
   that passes **and** at one that fails — a band measured on
   one side is no evidence it is the same on the other. Either way you learn the band, and you
   learn it is comfortably clear of the number you are about to hand over — or that it is not,
   and the gauge cannot answer this question.
4. ⚠ **Read it as pass/fail, not as a ruler.** The reported mm³ is the volume the two solids
   actually share, so once the gauge punches all the way through the part it stops growing: an
   opening 21mm too short and one 100mm too short can report the same number. It tells you
   *that* it fails, never *by how much*. For how much, move the gauge and find the flip.
5. ⚠ **Take it out and rebuild before you believe the answer.** The last thing you do before
   step 6 is build the plain file and read its verdict — that, not the gauged run, is the model
   the user gets.

### 5. Iterate — the warm loop is the whole point

⏱ A one-shot `axle build` spends most of a second starting Node and the kernel and about a
tenth of it building; every fresh `npx` call also re-resolves the package first. **`axle repl`
pays all of that once.** Measured over eight cold runs on models of 6–13 parts: **247–780 ms of
warm-up, then 9–184 ms per clean build**, against roughly 300–1,300 ms for a one-shot doing
the same work. A build with many colliding parts costs more — 88–541 ms — because measuring
real intersections is the expensive part, so a search that is mostly failures runs several
times slower than the headline. One run put the difference at **38 builds in about 4 seconds
warm against roughly 50 seconds as one-shots**. That warm loop, not the one-shot, is what this
skill is named after.

`repl` takes one line per build on stdin — a file path, then `name=value` overrides — and
prints one JSON object per line:

```
model.js
model.js shelfCount=4
model-gauged.js shelfCount=4 gaugeHeight=150
quit
```

Each line names its own file, so one warm session can sweep the plain model and the gauged one
together — which is what you want, because they must be compared build for build.

⚠ **The records do not echo what you sent** — no filename you can trust as a label, no
parameter values. You are matching them to your input by ORDER alone, so one line that emits
nothing silently shifts every label after it. Count the records against the lines you fed in
before you read any of them as an answer.

The first line back is `{"ready":true,"warmupMs":…}`; then one record per build carrying `ok`,
`passed`, `problems`, `overall {x,y,z}`, each part's size, and `buildMs`. Drive it the way you
would drive any subprocess: feed the whole search in, read the lines back.

**Read three fields and you have the verdict.** `passed` — whether anything found gates.
`problems` — each carrying a `rule`, a `severity`, and a message that names the parts and the
measurement, like

```
[error] part_interference: Parts 'A' and 'B' occupy 600,000mm³ of the SAME solid volume
(measured intersection, not a bounding-box guess; boxes penetrate 60.0×100.0×100.0mm).
```

That message is the instruction, and it is the same sentence the platform gives — you do not
need a rule book open beside it. `overall` — the measured envelope.

⚠ **Severity does not tell you what gates.** A `severity: "warning"` still makes `passed`
false — measured: a bench whose only problems were two warning-level `unsupported_part` lines
came back `passed: false`. What does *not* gate is a problem marked `unverified: true` — a
`part_overlap` whose real intersection could not be computed, or an `interference_coverage`
line saying how many of the penetrating pairs were actually tested. Those *report*. So
`passed: true` alongside one of them means "nothing found among the pairs it reached", not
"nothing there", and the same exhausted budget truncates a *failing* build's problem list too.
**Read `problems` on every build, whatever `passed` says.**

⚠ **The repl record carries part SIZES and no positions** — `{"name":"Side","x":18,"y":300,
"z":900}`. Plenty is still derivable in the loop: `overall` minus a part's own size is an exact
overhang, and sizes alone answer most span questions, so work out what you can from what is
there before leaving. For an absolute `minX/maxX/…` you need a one-shot, which runs the same
checks but prints a different shape (its `overall` is `{minX…maxZ, sizeX…}` against the repl's
`{x,y,z}`, and it carries no `buildMs`):

```
npx -y @axle-keys/cad-engine build model.js --json --param shelfCount=4
```

Sweep in the repl, settle a position question with one `--json` build at the value that won,
and write your reader for one shape, not both.

The exit code carries the verdict either way: **0** built and clean · **1** built with
problems · **2** did not build · **3** cannot run — so a shell loop can branch without parsing
anything.

**Stop when the criterion from step 4 is met and `passed` is true** — in that order. Not
before, and not after: a search that keeps running once it has an answer is a search that will
talk itself into a worse one.

### 6. Push ONCE — and let the platform pass judgment

```
push_model_code(
  model_id,
  code: "<the file that finally worked — the one without the gauge>",
  rationale: "<why THIS is the answer — what you searched, what you rejected>",
  base_content_hash: "<the Base: / content_hash you kept in step 2>",
  idempotency_key: "<a fresh random string, so a retry after a dropped reply is not a second write>"
)
```

The verdict usually comes back **in the response**; when it does, read it before doing anything
else — and when it does not, that is ordinary and not a failed push (see below). Either way the
verdict is the evidence: do not assume, and do not read a screenshot as one.

⭐ **Close the loop the push leaves open.** It takes a **string**, not a path, so the bytes you
grepped and the bytes you sent are two different artifacts and only one of them was checked
(rule 1). Afterwards, read the code back — `get_model_code(model_id, detail: "full")` — write it
beside your file and diff or hash the two. One command, and it is the only thing that proves
the model on the platform is the model you tested. If anything else touched the model between
your read and your push, the `Base:` you are holding is stale; re-read for a current one rather
than retrying with the old.

⚠ **The push may report that the build did not finish in time — that is ordinary.** Call
`get_build_status(model_id)`. If it answers with a verdict marked **stale**, it is describing
the *previous* code, not yours; a stale verdict can outlive several reads. Do not conclude your
push failed, and reach for `check_dimensions` before you reach for a second push: it builds the
model's current code and reports `built: true`, which is a real build of exactly what you sent.
A second identical push to refresh a lagging stored verdict is a legitimate rebuild rather than
an attempt — but it is still a write on the user's model, so spend it only if they need the
stored verdict current, and say in the rationale that it is a rebuild.

**"Push once" forbids pushing your search, not pushing a second decision.** If the finished
model has a real defect you would not ship — a control the geometry never reads, say — fix it
and push again, and let the rationale say what changed and why. Two versions that each record a
decision are a history; twenty that record attempts are a search someone else has to read.

Then prove the size on the platform, not on your disk:

```
check_dimensions(model_id, width: 500, depth: 140, height: 620, tolerance_mm: 0.5)
```

⚠ **Flat arguments in millimetres**, only the axes you were given — not the nested
`target_dimensions` object `create_model` takes. Same numbers, different shape. The default
band is 5%-or-3mm, which is loose; when the size *is* the point, name `tolerance_mm` and say
which band you used. It rebuilds the model's current code on the platform and measures it,
which also makes it the strongest parity check available to you.

⚠ **It verifies; it can never discriminate.** A band waves through everything inside it — one
cold run's true boundary sat 0.08mm past the target and passed a ±0.1mm check comfortably. Do
the searching in step 5 where the numbers are exact, and use this to prove the winner.

⚠ **The band is symmetric, so it cannot express "or under".** Half of all fit briefs are
one-sided — *700mm or less*, *no deeper than 400* — and this tool can only say "is it 700 ± x".
Prove a maximum in step 5, from the measured envelope, and then use `check_dimensions` to pin
the value you actually chose. Say which of the two you did; "within ±0.5mm of 700" and "700 or
under" are different claims and only one of them was asked for.

📎 The push carries an optional `param_schema`, and without it the model's parameters stay
*derived from your annotations* rather than stored — which is why a read-back may say the schema
is "not yet stored". The sliders work either way; nothing is missing. Send a schema only if you
have a reason to fix one.

**If the user gave no dimensions at all**, check against the target already recorded on the
model — `get_model_code` prints it — because that is the size someone previously agreed to and
your change should not have moved it. If there is no recorded target either, do not invent one:
report what the build measured, and say it was measured, not verified against an ask.

### 7. When the local and platform verdicts disagree

**One asymmetry is expected and is not a bug.** The platform runs code-shape checks the local
engine does not — measured: code that reported exactly one problem locally
(`part_interference`, 600,000mm³) came back from a push with the identical interference
sentence *plus* two `magic_numbers` warnings about inline literals. Same geometry verdict, extra
advice. A clean local build returning warnings from the platform is normal; act on the advice
or don't, but do not read it as a broken engine.

**A real disagreement is narrower**: the two doors differ about *geometry*. One reports a rule
the other doesn't, or the same rule with different numbers, or one builds and the other errors
on identical code. The two are meant to be one implementation, so that is a parity bug — and it
is worth more to the platform than a clean run is.

When you hit one:

1. **Do not paper over it.** Do not edit the model until the local verdict agrees; that is
   fixing the instrument, and it destroys the only evidence.
2. **Believe the platform.** Its verdict is the one attached to the model and the one the
   user's Studio shows. Hand the model back in the state the platform judged.
3. **Report it with both halves side by side**: the local `--json` record, the platform's
   verdict text, the exact code, and the engine version from `npm view @axle-keys/cad-engine version`.
   Tell the user plainly that the two disagreed and that it is worth sending to Axle Keys. Do
   not file it as a modelling lesson; it is not one.

### 8. Hand back

Say four things: **where the model is** (its name, and that their open tab does not switch by
itself), **the platform's verdict**, **the dimension check** with the band you used, and **how
the answer was reached** — the winning values, in a form that runs, plus the measurement that
chose them and the one that rejected the next candidate along ("this is the last count where
the gauge still cleared; one more and the build reports the collision, by this much"). Quote
numbers the engine produced. That is the difference between a recommendation and a result.

⚠ **Do not repeat a number from this page as if it were your model's.** Every figure here came
off a different object. Build yours — and if what you measure happens to match what you read
here, that is a coincidence you got away with, not a confirmation. It would have looked exactly
the same had you not measured at all.

---

## Done looks like

- One model on the platform, built there, carrying the user's own words as its brief and your
  reasoning as its rationale.
- One code write, not forty. The version history reads as a decision, not as a search.
- A build verdict from the platform with no gating problems, read and quoted — never inferred
  from a clean local run.
- A passing `check_dimensions` against the numbers they gave, with the band named.
- The code read back and diffed against the file you tested.
- The winning parameters in a form that runs, and the measurement that chose them.

Unless the honest answer was that it cannot be done inside the model's declared ranges — then
*Done* is the refusal shape in **When it goes wrong**, and none of the above applies except the
recorded brief.

## When it goes wrong

**`npx` cannot reach the registry** — the engine is offline *after* it is installed, not
before. The first install needs the network; say that rather than reporting the machine as
broken.

**Node is too old** — the refusal names the version and the fix. It is not a warning to work
around: the engine ships as source, and Node runs it natively from 23 onward.

**The local engine cannot build something the platform can** — a model that reaches for text or
for an imported asset is reaching for something that lives with the user's account, and the
local build says so plainly. That model's loop stays on the platform; nothing else in this
skill changes.

**Everything passes and nothing is decided** — you are reading `passed` as if it answered the
brief. Go back to step 4 and give the engine something to measure.

**Nothing in the range satisfies the criterion** — that is an answer, and often the most useful
one. It has its own ending, because none of *Done looks like* applies: there is no push, and the
dimension check you run is evidence of the shortfall rather than proof of success.

A finished refusal is five things: the ask **recorded** on the model with `state_brief`, so it
survives you; the shortfall **measured** — `check_dimensions` against what they asked, run on the
model as it stands and reported with its `pass: false` and `offAxes`, because a failing check on
the unchanged model *is* the evidence and not a broken one; the **best in-range candidate** built
and named, so they know what they *can* have; the **one line that would have to change**, quoted
from the model; and the winning out-of-range candidate **built, verified and held on disk**, so
that if they say yes it is one push and not a fresh search. Then stop, and say you have stopped.

⚠ The held candidate must carry the **widened annotation**, not just the new value:
`const railLength = 700; // [900:1600]` is an incoherent artifact — a default outside the range
its own comment declares. Widen the annotation to the least that answers them, and say in your
report which floor you chose and why that one.

⚠ **"The user has not asked" and "the user asked without knowing" are different, and the second
is the one you will meet.** Someone who says *"just make it fit"* is asking for a shorter bench,
not consenting to a change in what their model promises every slider and configurator that reads
it — they do not know a declared range exists. So do not widen a range silently *in the same
breath* as the fit. Report the range, the shortfall and the single line, and let them say yes.
If they do — or if they told you up front to change whatever it takes — widening it is ordinary
work: push it with the rationale naming the old range, the new one, and who asked.

**The push is refused over the base hash** — either you omitted it on a model that already had
code, or the model moved under you (the user saved in Studio, or another agent pushed).
Re-read `get_model_code`, re-apply your change to *that* code, and push again with the new
`Base:`. Never route around the refusal: it is the only thing standing between your loop and
someone else's work.

**The dimension check fails after a clean local run** — read `offAxes` and `measured`, and
compare them to the local `overall`. If those two disagree, you have a parity finding (step 7).
If they agree, the target was never met and the search is not finished.

**Every MCP call comes back `401` / "Unauthorized"** — the connection is fine; the account
isn't admitted yet. Axle Keys is invitation-only: signing in needs a Keyholder code from
[axlekeys.com](https://axlekeys.com). Say that and stop; do not send them round the loop
re-checking their setup.

## What this skill won't do

It does not teach geometry — that is `brief-to-model`, the platform's own `get_skill_pack`, and
the `docs/` in this repo. It does not keep anything: the engine runs models, it does not store
them, and the file on your disk is a copy that stops being true the moment either side moves.
It does not sync — the model on the platform changes only when you push. And it does not
replace the platform for assemblies, drawings, cut lists, renders or video; the local engine
builds one model's code, measures it, and can write a STEP or STL from it (`axle export`).
Everything else lives where the model lives.
