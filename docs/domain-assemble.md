# Domain — Assemble (an assembly is a program that computes a graph)

Load this when you are building an **assembly**: a scene that places models *you already
created* by reference, mates them to each other, and exposes the whole thing as one object with
its own parameters. An Assemble program is the sentence a kitchen IS — *"six base cabinets at
600 pitch along +x, flush, sharing the toe-kick height"* — instead of six `add_instance` calls,
five `add_constraint` calls and six bindings, all of it again for a seventh cabinet.

⚠ **An Assemble program never makes geometry.** The member models do that (they are ordinary
replicad models — see `pipeline-code-agent` and `api-replicad`). This program computes the
GRAPH: which instances exist, how they are mated, what parameters the assembly publishes, and
which groups it declares. Everything here is **OCC z-up millimetres**.

Both doors take the program:

| Door | What it does |
|---|---|
| `create_assembly({ name, code, rationale })` | mints the assembly, runs the program, solves it, returns the verdict inline |
| `push_assembly_code({ assembly_id, code, rationale, base_content_hash })` | **re-runs** it — the same code against today's members, or new code reconciled onto the existing graph |

A hand-built assembly (`add_instance` / `add_constraint` / `set_assembly_param` / `bind_param`)
is never touched by a program, and there is no migration between the two. Both are first class.

---

## ⭐ The worked example — a kitchen run

This is the whole shape in one program. It assumes three models already exist and have built
server-side: **base-cabinet-600** (600 × 560 × 720, declaring a named anchor `top-mount`, with
its own `toeKickHeight` parameter), **worktop** (600 × 600 × 38, declaring `underside`), and
**back-panel** (600 × 18 × 720). Two of them also declare CONNECTOR anchors, which the
connectors section below uses: the cabinet a drilled `pin-hole`, the back panel an `edge-top`.

```js
// axle asm@1 requires: model.box, model.anchors
const cabinets = 4;   // [1:12] step:1 unit:ratio label:"Cabinets"
const gap = 0;        // [0:50] step:1 unit:mm label:"Gap between cabinets"
const toeKick = 100;  // [80:150] step:5 unit:mm label:"Toe-kick height"

const main = (a) => {
  // 1 · The run. N cabinets along +x, each one flush to the one before it, fronts and
  //     bottoms aligned by MATE (-y and -z), the pitch driven by the `gap` parameter.
  const base = a.use("base-cabinet-600");
  const run = a.run(base, cabinets, {
    key: "base", along: "+x", gapParam: "gap", align: ["-y", "-z"],
  });
  a.ground(run[0]);

  // 2 · One assembly slider into every cabinet's own toe-kick parameter.
  a.bind("toeKick", run.map((c) => [c, "toeKickHeight"]));

  // 3 · The worktop, sized from the same literal and fastened on NAMED anchors (six DOF).
  const top = a.place(a.use("worktop"), { key: "top", params: { length: cabinets * 600 } });
  a.fasten(top, run[0], { my: "anchor:underside", at: "anchor:top-mount" });

  // 4 · The back panel, flush behind the run, its left edge and bottom lined up.
  const back = a.place(a.use("back-panel"), { key: "back", params: { length: cabinets * 600 } });
  a.flush(back, run[0], { along: "+y", align: ["-x", "-z"] });

  a.group("Base run", run, { key: "baseRun", collapsed: true });
  return a.graph();
};
```

At `cabinets = 4` that writes **6 instances** (`base[0]`…`base[3]`, `top`, `back`), **13
constraints** (three offsets per neighbouring pair — the `along` one plus one per `align` face,
so nine across the run — one concentric for the worktop, three for the back panel), **3
assembly parameters** (`cabinets`, `gap`, `toeKick`, the last bound into four cabinets) and
**1 group**. Change `cabinets` to 6 and re-run: two
cabinets are minted, everything else keeps its id, and every Motion frame, scene view and
configurator slot that named an instance still resolves.

⭐ **Read the four counts the response opens with** — `minted · updated · removed · refused`.
They are the answer to "did the run do what I meant", and they cost nothing.

⚠ But they are not the answer to *"is it the right shape"*. Nothing in a program, a graph or a
verdict tells you **where an instance landed** — see *The seed and the place* below. When a mate
you are unsure of is load-bearing, take the screenshot.

---

## The file

```
// axle asm@1 requires: model.box, model.anchors      ← LINE ONE
const <name> = <number>;  // [min:max] …annotations   ← the assembly's PARAMETERS
const main = (a) => {  …  return a.graph(); };        ← the program
```

- **`main` is a function and it is called with one argument.** The door appends
  `return main(asmBuilder(facts));`. A program with no `main` is refused in those words.
- **`a.graph()` must be RETURNED.** Returning anything else is `program.result/not-a-graph`.
  Storing it in a variable first is fine — it is the VALUE that must come back. What it hands
  back is worth logging while you work:

  ```js
  { ok,                 // false when the run raised an error: then every field below is null
    ground,             // the grounded instance's KEY, or null
    instances,          // [{ key, modelId, modelName, transform, visible, parentKey?, paramOverrides? }]
    assemblyParams,     // [{ name, bindings?: [{ instanceKey, param }] }] — the program's half
    constraints,        // [{ key, groupId?, type, a: { instanceKey, anchor }, b: {…}, value?, … }]
    groups,             // [{ key, name, memberKeys, collapsed? }]
    verdict }           // this run's own lines, before the door adds its measured ones
  ```

  ⭐ Note what is NOT in there: no ids, and no positions. `transform` on an instance is the
  SEED, not the place — see below.
- **No `import`, no `export`, no `require`, no TypeScript.** The program is compiled as the
  BODY of a function, so any of those is a syntax error. No `fetch`, no `Date.now()`, no
  `Math.random()` — the isolate has no network, no clock and no dice, on purpose: the same
  facts must always give the same graph.
- `console.log` works, and what it printed comes back as `logs` on the response. Use it.
- ⚠ **Never write `return` at the top level of the program** (outside `main`) — the door's tail
  runs after your code and needs to reach it.

### ⭐⭐ The seed and the place

An instance's `transform` is a **seed**, not an answer. The mates are what place it, and they
are solved after the program has finished. So:

- On every axis a mate locks, the seed is **ignored** — the mate decides.
- On every axis the mates leave free, the seed **is** the position.
- The seed still matters when a mate cannot be satisfied: a run seeded along its axis stands in
  a row instead of piling up on the origin, which is a legible failure instead of a heap.

A worktop fastened onto a cabinet reads `transform: { x: 0, y: 0, z: 0 }` in the graph and sits
at z = 720 in the viewport. **Both are true.** Nothing the program can see, and nothing in the
verdict, reports the solved position — the closest the verdict gets is
`instance.dof/measured`, which tells you *which axes the mates took*, not where they put it.
If where it landed matters, look: `get_model_screenshot` on the assembly, or `get_assembly`
after the run.

---

## The facts a program may read

`facts` is plain JSON, in scope, and `a.*` are the accessors over it. Read them through `a`:

| Accessor | What it is |
|---|---|
| `a.catalogue` | every model this assembly may place, as an array of **model facts** |
| `a.use(idOrName)` | one model fact by model id, or by a **unique** name. This is the one to reach for: a miss is `model.unknown` and two models of one name is `model.ambiguous` — both said out loud |
| `a.model(id)` | one model fact by model id only, and **silently `undefined`** when there is no exact match. Use it only when you mean to test for a model's presence |
| `a.connectors` | the System's connector vocabulary — what may join to what, and what joining means. Empty when no System that declares one is bound; `a.connect` refuses rather than guessing, and `requires: connectors` refuses the whole program before it runs |
| `a.assembly(idOrName)` | A10 — one CHILD ASSEMBLY, as facts: its members and their SOLVED placements relative to its ground. The door read your own `a.assembly(...)` calls statically before this program ran; a miss is `assembly.unknown`, two of one name is `assembly.ambiguous`. `a.place`/`a.run` flatten it — see *Composing another assembly* below |

**To see what you can place:** `list_models` or `get_assembly` before you write the program.
Inside one, `console.log(a.catalogue.map((m) => m.name))` — its output comes back as `logs`, so
one throwaway run tells you the whole catalogue.

A **model fact** is:

```js
{ modelId, name,
  box: { min: {x,y,z}, max: {x,y,z}, size: {x,y,z} },   // size = max − min
  anchors: [ { name, origin: [x,y,z], axis: [x,y,z], up?, label?, connector? } ],
  params?: { <name>: <number> },   // the member's own annotated literals, at their defaults
  joints?: [ "<jointId>" ] }
```

⚠ **`box` is the member's box from its LAST SERVER BUILD at its DEFAULT parameters.** A
per-instance `params` override does not change it — the headless solve builds once per distinct
member. Lay out from the default box; if you need a member at another size, that is a different
model, or a `paramOverrides` whose box you accept.

⚠ **`a.catalogue` is capped at 60 models** (the assembly's container, plus everything already
placed). Over that, `catalogue.truncated` says so and `a.use` on a model outside the set
reports `model.unknown`.

### What a program may NEVER see

Instance **ids**, program **stamps**, **hand marks**, the previous run, or the stored value of
an assembly parameter. That is the law that makes a re-run safe: the program computes the graph
from facts, and the door reconciles it onto what is stored. A graph that carries a field called
`id` is refused outright (`law4.id-in-emit`) and nothing is written.

### `requires` — line one, checked before the program runs

```
// axle asm@1 requires: model.box, model.anchors
```

The vocabulary is exactly: **`model.box` · `model.anchors` · `model.params` · `model.joints` ·
`catalogue` · `connectors`**. A name outside it is `program.requires/unknown-fact`; a fact this
assembly cannot supply — no member has ever built, no member declares an anchor — is
`program.requires/fact-unavailable`. Both are refused **before the isolate spins**, because a
program handed an empty fact computes a wrong answer confidently.

**What counts as reading a fact** — this is the part that decides your staleness, so be exact:

| You do this | Declare |
|---|---|
| `a.run(...)` — it lays members out from `box.size` | `model.box` |
| read `.box` yourself (`m.box.size.x`) | `model.box` |
| mate on `anchor:<name>` — the solver needs its geometry | `model.anchors` |
| read `.params` or `.joints` off a model fact | `model.params` / `model.joints` |
| iterate `a.catalogue` to decide what to place | `catalogue` |
| `a.use("name")`, `a.flush`, `a.fasten` on `bbox:` faces, `a.bind` into a member's parameter | **nothing** — none of those reads a fact in your program |

⚠ The door checks that each declared fact is *available*, not that you used it. Declaring more
than you read is not refused — it just stales you more often than you need.

Declare what you actually read, and nothing more. It buys two things: that refusal, and
staleness — a program whose `requires` names **no `model.*` fact** is never staled by a
member's push, because the solve re-places its mates from the new boxes at every read. The
declaration is kept on the record as `program_run.requires`, so `get_assembly` shows you which
facts the last run was judged against. See *Staleness* for the two things that stale you anyway.

Omitting the line is allowed (`program.api/undeclared`, info) and costs you both.

---

## The verbs

`a` is a per-run **builder**: each verb registers a keyed record, and `a.graph()` hands them
back. The verbs **never throw** — they record a finding and return something benign, so one run
reports every problem rather than the first. ⚠ That covers what they CHECK. An option a verb
does not know is ignored without a word, so read each signature: `a.run` takes no `transform`,
and one passed to it is simply gone.

| Verb | Signature | Emits | Key |
|---|---|---|---|
| `a.use` | `a.use(idOrName)` → model fact | nothing | — |
| `a.place` | `a.place(model, { key?, transform?, params?, parent?, on?, visible? })` → **handle** | one instance | `key`, else `<model-slug>#<n>` with `key.derived` |
| `a.run` | `a.run(model, n, { key, along, gap, gapParam, align, slots, ground })` → **handle[]** | `n` instances, seeded at `i·(box.size[axis] + gap)`, plus a `flush` between each neighbouring pair | `key[0]`…`key[n-1]`, or `key[<slot>]` |
| `a.mate` | `a.mate(s, r, { type, my, at, value, valueParam, flip, roll, key, groupId })` → key | ONE stored primitive | `<s>/<type>@<r>` |
| `a.flush` | `a.flush(s, r, { along, gap, gapParam, align })` → preset key | one `offset` along `along` (the subject's face against the reference's opposite face), plus one `offset` per `align` face — the SAME face on both sides, value 0 | `<s>/flush@<r>`; the `along` primitive is keyed by the BARE axis (`…/x`) and each `align` one keeps its sign (`…/-y`) |
| `a.fasten` | `a.fasten(s, r, { my, at, gap, roll, flip })` → key | one `concentric` — all six DOF. `gap` IS its `value`: the distance between the two anchor origins along the mate axis, so omit it for a flush fastening | `<s>/fasten@<r>` |
| `a.slide` | `a.slide(s, r, { my, at, range, value })` → joint key | one `concentric` resting at `value`, carrying `limit: { of: "travel", min, max }` from your `range`. A PRISMATIC degree of freedom along the anchor axis, in mm: `at`'s direction says where "out" is, `value` is where it rests (0 = closed) | `<s>/slide@<r>` |
| `a.hinge` | `a.hinge(s, r, { my, at, range, value, roll })` → joint key | one `concentric` carrying `limit: { of: "roll", min, max }`. A REVOLUTE degree of freedom about that axis, in degrees: `roll` is the rest clocking (absent = 0, closed) and `value` is the gap along the axis, which is not limited | `<s>/hinge@<r>` |
| `a.link` | `a.link(from, to, { ratio, offset } \| { table })` → boolean | one cross-instance DRIVER: `from`'s value computes `to`'s. Each end is `{ instance: <handle>, joint: "<jointId>" }` or the joint key `a.slide`/`a.hinge` returned. It is a modifier over two degrees of freedom that already exist — it emits no constraint and moves nothing on its own | — (its key IS its target) |
| `a.connect` | `a.connect(s, r, connectorId \| { connector, my, at, roll, flip, key })` → key | ONE mate, and the **System** decides which: the connector's own `mateType`, its standing `gap` as the value, and its `rollStep` clocking. Refuses a pair `matesWith` does not allow | `<s>/connect@<r>` |
| `a.cycle` | `a.cycle({ duration, dof?, carriers?, params? })` → boolean | the OPERATION: what the assembly does over time — DOF segments (keyed/interpolated/time-linear) and carrier phases (`[from, to)`, the new carrier owns the part). Call-once, like `a.ground`; Motion reads and stages it, never writes it | — (one record per assembly) |
| `a.bind` | `a.bind(name, [[handle \| "*", "childParam"], …])` → name | the bindings on one assembly parameter | `<name>/bind` |
| `a.ground` | `a.ground(handle)` | the fixed instance | — |
| `a.group` | `a.group(name, handles, { key, collapsed })` → group handle | one group. ⚠ INSTANCE handles only — groups do not nest, and a group handle passed here is `ref.handle` | `key`, else the name's slug |
| `a.graph` | `a.graph()` | the graph plus this run's verdict | — |

- **`a.use` returns a model FACT; `a.place` returns a HANDLE.** Every mate, bind and group
  takes handles from *this run* — the value `a.place` or `a.run` returned. Passing a model
  fact, a key string, or a handle from a collided `a.place` is `ref.handle` / `ref.unplaced`.
  `a.run` hands back a plain array of handles, so `.map`, `.length` and `for…of` all work.
- ⭐⭐ **In every mate, `s` is the SUBJECT — the one that MOVES — and `r` is the reference it
  moves against.** `a.flush(door, carcass, …)` moves the door. Get them the wrong way round and
  the graph is valid and the wrong thing travels. The same split names the anchors: **`my` is
  an anchor on `s`, `at` is an anchor on `r`.**
- **`a.mate` is the primitive floor.** The three stored mate types:
  - `offset` — one world axis between two faces, `value` apart (0 = touching). Locks ONE
    translation, never orientation. A positive `value` pushes the subject *outward* from the
    reference's face.
  - `concentric` — aligns the two anchor axes, coincides their origins, then separates them by
    `value` along the reference's axis. Locks orientation AND all three translations. ⭐ The
    axes meet **head-on (anti-parallel) by default** — the natural reading of two outward-facing
    mating faces, so an `underside` pointing −z onto a `top-mount` pointing +z sits ON TOP. Pass
    `flip: true` for co-directional (both pointing the same way), which is what stacking
    identical parts wants.
  - `parallel` — orientation only. A `value` on it is ignored and says so.

  Every other verb is sugar that emits these, so hand surgery and a program keep ONE
  representation.
- **`roll` is degrees of extra clocking** about a rotation mate's shared axis, applied after
  alignment. `roll` and `flip` are stored only when they differ from the default, which is
  absence — so a `roll: 0` you pass is simply not written.
- **`a.run` REQUIRES `key`.** `n = 0` is a real answer and returns `[]` — the `[1:12]` on the
  literal is the guard. A fractional or negative `n` is `run.count`.
- **`gap` defaults to 0 — flush.** Pass it to open a joint, or to set a pitch: a run at pitch
  *p* of a member *w* wide is `gap: p − w`, i.e. `p - base.box.size.x`. The box is right there;
  compute it rather than guessing. `gap` takes a number and `gapParam` takes a parameter NAME —
  use `gapParam` when the pitch should be a slider.
- **`a.flush` needs `along` or `align`** (or both); with neither it mates nothing
  (`flush.empty`). Axes are `+x -x +y -y +z -z`; anything else is `axis.unknown/along` or
  `axis.unknown/align`. Keep `along` and `align` on different axes: the same axis in both locks
  one translation twice, and the graph is written with `mate.unsolved` — *"conflicts with
  another X constraint on this model"*.
- ⭐ **A run's fronts and bottoms line up because `align` emits mates for them**, not because
  the transforms happened to be zero. A program that omits `align` has said so, and a
  mixed-depth run then misaligns exactly as written.
- **`a.run`'s chain mates outward from `ground: k`**, so a middle cabinet can be the ground.
  Every member except the anchor slot is the SUBJECT of its own flush; the anchor slot (0 by
  default) is the one nothing places, which is why `a.ground(run[0])` is safe and
  `a.ground(run[2])` on a default run is the `ground.subject` error.
- **`a.ground` is idempotent on the same instance** and an error on a second one
  (`ground.twice`). Ground an instance nothing mates: a ground that is a mate's SUBJECT is
  `ground.subject`, an error, and no graph is written. Say nothing and the door picks the first
  placed instance no mate positions (`ground.derived`); when every instance is a subject it
  stands with no ground and `ground.none`.
- **`parent:` nests one instance under another.** It takes a handle that is already placed, so
  a program can never build a parent cycle. A child's transform is read relative to its parent,
  and a parent edge — like a mate — exempts the pair from the interference check. A `parent`
  that is not a placed handle is `parent.unknown`.
- **`on: [handle, jointId]` rides a named JOINT of another instance instead of its root** (A15).
  Machine 01's pickup head travels with the carriage's `x_slide` this way:
  `a.place(head, { key: "head", on: [carriage, "x_slide"] })`. `jointId` is a joint the
  PARENT's member declares (`list_joints` on its model) — a name it does not have is refused,
  naming the ones it has. `parent` and `on` are exclusive: give one, never both
  (`parent.both`); `on` that is not `[handle, "jointId"]` is `parent.on-shape`. A stored
  `parent` that is `{ instance, joint }` reads this way everywhere that reads one —
  `get_assembly`, `add_instance`/`update_instance`, the viewport; a bare id still means the
  root, forever.
  - ⭐⭐ **WHICH FRAME `transform` IS IN.** With a bare `parent:`, `transform` is relative to
    that instance's ROOT — unchanged, as it always has been. With `on:`, `transform` is
    relative to the NAMED JOINT'S OWN MOVING FRAME: its origin is the joint's pivot, and at
    rest its axes are the parent MEMBER's own (unrotated by the joint) — so `{ x: 30, y: -15,
    z: 8 }` places the rider 30/−15/8 mm from the pivot, and when the joint turns or slides
    the rider turns or slides WITH it. A transform written for a root parent does not carry
    over to `on:` unexamined — re-express it, or expect the instance to jump the moment the
    ride takes effect.
  - **Mates stay rest-only, exactly as they already did for a plain `parent:`.** A mate whose
    subject rides a joint (or any parent) is solved FLAT — `solveAssembly` composes no
    hierarchy — so the mate is placed as if the rider had no parent at all, which is wrong the
    moment the ride is non-trivial. This is not new to `on:`; it is the same limit a plain
    `parent:` subject to a mate has always had (assemblySolver.ts's own "Composing is not
    REPAIRING" note). A rider is placed by its `transform`, never by a mate.
- **`a.connect` is the only verb whose mate you do not choose.** Everything it emits comes
  from the connector definition, which is why it takes no `gap`: a gap you pick is `a.fasten`,
  a gap the System picked is this. See *Connectors* below.
- **`a.place(model, { params })` writes the instance's `paramOverrides`** — one field, and
  those are the two names you will see for it. The member is not rebuilt for it here, so
  `a.model(…).box` still reports the default size (see the box warning above).

### ⭐⭐ Orientation — which way a member faces

A member faces the way its own model was authored. **The only thing that turns one is the
instance's seed transform**, and `transform` is:

```js
{ x, y, z,        // millimetres
  rx, ry, rz }    // DEGREES, about the member's own origin, applied before any mate
```

The second worked example — **a back-to-back island**, which is where the language actually
lives. One row teaches placement; two rows teach orientation.

```js
// axle asm@1 requires: model.box
const perRow = 3;  // [1:12] step:1 unit:ratio label:"Cabinets per row"
const gap = 0;     // [0:50] step:1 unit:mm label:"Gap between cabinets"

const main = (a) => {
  const cab = a.use("base-cabinet-600");

  // The FRONT row — an ordinary run.
  const front = a.run(cab, perRow, { key: "front", along: "+x", gapParam: "gap", align: ["-y", "-z"] });
  a.ground(front[0]);

  // The BACK row, facing the other way. a.run takes no transform, so this row is placed
  // member by member and chained with exactly the flush a.run would have emitted.
  const back = [];
  for (let i = 0; i < perRow; i++) {
    back.push(a.place(cab, { key: "back[" + i + "]", transform: { rz: 180 } }));
    if (i > 0) a.flush(back[i], back[i - 1], { along: "+x", gapParam: "gap", align: ["-y", "-z"] });
  }
  // The back row behind the front one: its bbox -y face against the front row's +y face.
  a.flush(back[0], front[0], { along: "+y", align: ["-x", "-z"] });

  // Groups do not nest, so the island is ONE flat group of every instance.
  a.group("Island", front.concat(back), { key: "island", collapsed: true });
  return a.graph();
};
```

- ⚠⚠ **`a.run` has no `transform`, and one passed to it is dropped without a word.** A row that
  faces another way cannot be a run: place its members yourself and chain them with exactly the
  `a.flush` `a.run` would have emitted between neighbours (above).
- ⭐ **`offset` never touches orientation**, so a yawed member positioned only by flushes keeps
  its yaw. That is why the loop above works.
- ⭐ **`concentric` and `parallel` OWN the subject's orientation** — they overwrite `rx/ry/rz`
  outright, so a seed rotation on a fastened instance is discarded. One rotation mate per
  instance; a second is *"conflicts with another rotation mate"*. Its DOF line reads
  `locked R x/y/z`, which is how you spot it.
- ⭐ **In an `offset`, `bbox:±axis` is the ±axis extreme of the instance's WORLD-oriented box,
  after its transform** — not the member's authored face. A cabinet yawed 180° has its authored
  front on its `bbox:+y` side, and `a.flush(yawed, other, { along: "+y" })` still means "put it
  behind". (In a rotation mate the anchor keeps its direction and turns with the member.)
- **`flip` and `roll` are rotation-mate arguments only.** `flip: true` turns the head-on
  default into co-directional; `roll: <degrees>` clocks the subject about the mate axis after
  alignment. On an `offset` both are ignored.
- **`visible: false`** on `a.place` places the instance and hides it. It is still a real
  instance — it can be a mate's reference, and it is left out of the interference check.

### Anchors — the two namespaces

Both ends of a mate name an anchor, as a string:

- **bbox**, which every model has for free: `bbox:-x` `bbox:+x` `bbox:-y` `bbox:+y` `bbox:-z`
  `bbox:+z` `bbox:cx` `bbox:cy` `bbox:cz`. −x/+x = left/right, −y/+y = front/back, −z/+z =
  bottom/top, c* = that axis's centre.
- **named**, written `anchor:<name>` — what the member's own code declared with `api.anchor()`.
  These carry a direction, which is why **`concentric` wants them on both sides**.

A named anchor the member does not declare is refused at write time, not left to the solver.
`list_anchors` on a member (or `member_anchors` on `get_assembly`) says which exist; inside a
program they are `a.use(...).anchors`.

### Connectors — when the System already knows how two parts join

A **System** can declare a connector vocabulary: named couplers, what each may mate with, and
what mating means. Cabinet Systems declares six — `shelfPin` · `shelfPinHole` · `dowel` ·
`dowelHole` · `panelEdge` · `panelFace` — and a member's own code tags an anchor with one:

```js
api.anchor("pin-hole", { origin: [18, 280, 400], axis: [1, 0, 0], connector: "shelfPinHole" });
```

That tag is what turns a named anchor into a connector anchor, and it rides into your facts as
`a.use(...).anchors[].connector`. `a.connectors` is the vocabulary itself, resolved down the
context stack from whatever Systems are bound to this assembly's project.

**`a.connect(subject, reference)` then says which two parts join, and nothing else.** The mate
it emits — type, gap, clocking — is the System's:

```js
// axle asm@1 requires: catalogue, model.anchors, connectors
const main = (a) => {
  const carcass = a.place(a.use("base-cabinet-600"), { key: "carcass" });
  const pin = a.place(a.use("shelf-pin-5mm"), { key: "pin" });

  // The carcass declares `pin-hole` (shelfPinHole); the pin declares `shank` (shelfPin).
  // The System says those two mate, concentric, gap 0 — so that is the mate that is stored.
  a.connect(pin, carcass);

  a.ground(carcass);
  return a.graph();
};
```

- **It refuses what the System forbids.** `shelfPin` does not mate with `panelEdge`, so
  connecting a pin to the back panel's edge is `connect.incompatible` and **no graph is
  written**. Enforcing that rule is the whole point of the verb — if the rule is what is wrong,
  `a.fasten` mates the two anyway.
- **It never picks between candidates.** A carcass with a drilled ROW of holes gives more than
  one compatible pair, which is `connect.ambiguous` with every candidate listed. Name them:
  `a.connect(pin, carcass, { my: "anchor:shank", at: "anchor:pin-hole-2" })`. The third argument
  is a connector id as a plain string, or that object when you need to be specific.
- ⚠ **Two connects between the SAME two instances collide on the default key**
  (`<s>/connect@<r>` is per instance pair). Give each its own: `{ key: "pin/lower" }`.
- **`rollStep` is real clocking.** A connector that only seats every 90° snaps the `roll` you
  pass to the nearest increment and says so (`connect.roll-snapped`) — a clocking the part
  cannot physically take is not a mate it can hold.
- **With no vocabulary in scope the verb refuses** (`connect.vocabulary`) rather than inventing
  a mate. Declare `requires: connectors` on line one and the door refuses the program earlier
  still, before it runs at all — which is the refusal you want, because a program handed an
  empty vocabulary computes a wrong answer confidently.
- ⚠ **`matesWith` is the only condition a connector carries.** There is no `when` clause: your
  program's own `if` is the when.

---

### A16 — the operation: what the assembly DOES over time

Every verb above places things at REST. `a.cycle` is different: it stores ONE record,
`operation`, that says what the assembly does between t=0 and `duration` seconds — a machine's
pickup-lift-traverse-release cycle, a conveyor that runs, a lid that opens and closes. Motion
reads it and stages cameras/cuts/captions over it; it never writes it, so deleting a shot never
deletes a release.

The Code facet's Operation card lets a person edit duration, drive segments and carrier phases
with mechanism and joint pickers. It previews with the same evaluator that Motion uses. Preview
does not save placements or alter shots. The assembly still has five facets.

`get_assembly` returns `operation_owner` and the observed `facet_hash`. Whole-operation ownership
is stored as `operationOwner: "hand" | "program"`. Older program assemblies follow the program;
an older authored cycle with no program remains authored. Take control preserves the complete
saved cycle through explicit and automatic reruns, including a program that emits no cycle.
If a run removes a required instance or changes its rig incompatibly, the run is refused.

An agent edits the same record with `set_assembly_operation({ assembly_id, operation,
base_facet_hash })`. Quote the base from the read your draft came from; a stale base refuses the
write. `operation: null` clears the cycle under hand ownership. Return to program calls
`push_assembly_code` with `release_operation: true`, the observed Assembly `base_facet_hash`
and the normal code base. Only a successful validated rerun changes ownership and replaces the
cycle. A refused run leaves the saved cycle untouched. Changing the owner through a raw data
write cannot bypass this release contract.

This is illustrative, not a program from the demo catalogue below (its members declare no
joints) — the shape is what matters:

```js
a.cycle({
  duration: 6,
  dof: [
    // The constant-speed drive (O4) — no keys to author, just a rate.
    { joint: { instance: arm, joint: "lift" }, kind: "linear", from: 0, to: 2, start: 0, rate: 10 },
    { joint: { instance: belt, joint: "belt_travel" }, kind: "linear", from: 3, to: 6, start: 0, rate: 20 },
  ],
  carriers: [
    // The NEW carrier owns the part (O3) — phases are [from, to) and never overlap.
    { part: cube, carrier: { instance: arm, joint: "lift" }, from: 0, to: 2, offset: "preserve" },
    { part: cube, carrier: "world", from: 2, to: 3, offset: "preserve" },
    { part: cube, carrier: { instance: belt, joint: "belt_travel" }, from: 3, to: 6, offset: "snap:load" },
  ],
});
```

- **`dof` drives a joint's VALUE over time.** Each entry's `joint` is exactly what `a.link`'s
  ends already are — `{ instance: <handle>, joint: "<jointId>" }` for a member's own joint, or
  the `asm::` handle `a.slide`/`a.hinge` returned — so a program never learns a second reference
  shape. `kind: "keyed"` holds a step between named `{ t, value }` keys (a digital state with no
  business easing); `"interpolated"` eases between them; `"linear"` needs no keys at all —
  `value(t) = start + rate·(t − from)`, the one shape a crank or a belt that simply turns wants.
  A joint no segment covers, or a `t` before its first one, sits at its ordinary REST — never 0.
- **`carriers` re-parents a PART for `[from, to)`.** `part` is a handle, `carrier` is `"world"`
  or `{ instance: <handle>, joint? }` (the SAME shape A15's `on:` reads). `offset: "preserve"`
  measures the part's world pose the instant before `from` — under whatever carried it then, or
  its ordinary placement if nothing did — and holds that exact offset for the whole phase: a
  pickup that does not teleport. `offset: "snap:<anchor>"` places the part at a named anchor of
  the CARRIER's own model instead, for a phase with nothing prior to preserve (the belt's very
  first cube) — it is never valid with `carrier: "world"`, which has no model to declare one.
- ⚠⚠ **O3 — the new carrier owns the part.** Two phases of ONE part overlapping in time is
  `cycle.overlap` and no graph is written; two phases of DIFFERENT parts need not agree on
  boundaries at all.
- ⚠ **O2 — one finite cycle.** `duration` is the whole story; repeat is Motion's OWN
  presentation choice layered on top, never a second field here.
- **`a.cycle` is call-once**, exactly like `a.ground` — a second call is `cycle.twice`.
- ⚠⚠ **v1: a carried part may not have children.** `parent:`ing an instance to one that also
  appears as a carrier's `part` is refused — the evaluator would leave the child behind while a
  live viewer's own parent-child hierarchy drags it along, two readers disagreeing with nothing
  to say so. Un-parent the child, or give it its own carrier phase.
- ⚠ **v1's person-authoring IS the program.** Editing `dof`/`carriers` by hand means editing
  this call in the Code facet and re-running; there is no separate timeline editor for the
  operation yet, and Motion's own camera timeline is a different tool for a different clock.

---

### A10 — composing another assembly

A kitchen of cabinets where each cabinet is itself an assembly cannot be nested — this room's
object model is flat. `a.assembly(ref)` is how you build one anyway: it reads a CHILD assembly as
**facts**, the way `a.use` reads a model, and `a.place`/`a.run` **flatten** it under a key path.

```js
// axle asm@1 requires: catalogue
const cab = a.assembly("base-cabinet-assembly");   // a string literal, or a top-level const
const one = a.place(cab, { key: "cab[0]" });
const two = a.place(cab, { key: "cab[1]", transform: { x: 600 } });
a.flush(two, one, { along: "+x" });                // mates against the GROUND instance a.place returned
```

- **`a.assembly(idOrName)` → a child fact**, by assembly id or a **unique** name among the
  assemblies THIS program's own `a.assembly(...)` calls name. It never fetches and never re-runs
  the child's program — the door read every `a.assembly(...)` call **statically, before this
  program ran** (a string literal, or a top-level `const` holding one — a computed reference is
  `assembly.unread` and the door never gathers it), gathered those children, solved each one, and
  handed the results in. A miss is `assembly.unknown`; two the door read with one name is
  `assembly.ambiguous`.
- **`a.place(childFact, { key, transform?, parent?, on?, visible? })` and `a.run(childFact, n,
  {...})` flatten it.** Every member of the child is emitted as its own instance, keyed
  `<key>/<memberKey>` (`cab[0]/door`, `cab[0]/carcass`) — the child's GROUND member takes your
  `transform`/`parent`/`on` exactly as a plain `a.place` would, and every OTHER member is
  `parent`-ed to it with its placement relative to that ground, exactly as the child's own last
  solve measured it, so the whole thing moves as one. The child's own internal mates are **NOT**
  re-emitted (rigid in v1 — a flexible sub-assembly, whose internal DOF the parent could also
  drive, is v2). One `collapsed` group is made per child, keyed `<key>`, so Motion tells it as one
  beat and Make schedules it as one part TYPE.
- **The return value is the GROUND's own handle** — mate against it exactly as you would a plain
  model instance; `a.fasten(two, one, { my: "bbox:-x", at: "bbox:+x" })` moves the whole cabinet.
- **A child with no stored ground** uses its first member and says so (`assembly.ground-derived`,
  info) — the same shape `a.graph()`'s own ground-derive uses one level up.
- **What carries, and when.** A pinned child instance is pinned in the parent (the SAME frozen
  code); its EFFECTIVE `paramOverrides` (its own raw overrides, with the child's own
  assembly-param bindings resolved on top, exactly as `get_assembly` would show you that member)
  and its `jointValues` carry too, so a door on the third nested cabinet still opens. **All three
  carry ONCE — at the moment the flattened member is first MINTED — and become ordinary HAND
  fields from then on.** Editing them by hand afterwards survives every later re-run of the
  PARENT exactly as any other hand field does; a later unpin, or a jointValues change, IN THE
  CHILD does not reach back and change the parent's already-minted copy — the two are independent
  the instant the parent's flatten first wrote them.
- **A cycle is refused at the door, before anything runs** — an assembly that reads itself,
  directly or through a child's own `a.assembly` calls, however many hops down, verified by
  actually walking that reference graph (never assumed from a shallower check).
- **Editing the child stales the parent too, in TWO ways.** Pushing a MEMBER of the child (its
  door model, say) stales the parent exactly as pushing a member of the parent's own catalogue
  does. Separately, moving an instance INSIDE the child, adding or removing one of its mates, or
  changing one of its assembly params — none of which touches a single member's CODE — also
  stales the parent: the child's whole placed GRAPH is part of the parent's stamp, not just its
  members' code hashes.
- ⚠ **At most 10 DIRECT `a.assembly(...)` references per program.** Each one is fetched and
  solved on every run, and checked again on every `get_assembly` — a program naming more is
  refused loudly (`assembly.too-many-children`), never silently truncated.
- ⚠ **`a.run`'s seed spacing reads `model.box.size`, and a child fact has no single box.** Pass an
  explicit `gap`, or expect every composed member to seed at the same spot before its mates place
  it (the mates still solve correctly — the seed only matters when one cannot).
- ⚠ **If the child itself cannot be solved** (a mate it stores no longer resolves, say), it still
  flattens — at its unsolved, manually-placed positions — and the verdict says so
  (`assembly.child-solve-failed`) naming the child, rather than silently composing it wrong.
- ⚠ **Caps still apply, and still say so.** Flattening inflates instance counts — `a.catalogue`'s
  60-model cap bounds how many CHILDREN you can even read by name, and the assembly's own instance
  caps (the DOF probe, the embed's render cap) are instance caps, not child-assembly caps: ten
  composed cabinets of six parts each is 60 instances, exactly as if you had placed them flat.
- ⚠ **v2, not this door:** a flexible sub-assembly (a child's own internal DOF exposed to the
  parent's program) and `t46-asm-autorun`'s fan-out (pushing a member re-runs every assembly that
  reads it, including through a child).

---

## Keys — the identity you assign

Every instance, constraint, parameter and group carries a **key you choose**. The door owns the
ids; the key is what the next run matches on.

- **Unique per CLASS, not globally.** An instance and a group may both be keyed `baseRun`.
- **A duplicate key inside one class is an error and NO graph is written** —
  `key.duplicate/emitted-twice`, both emits named.
- **A run's index is a SLOT.** `base[2]` means "the third cabinet", which is exactly what a
  person means when they nudge it, so a hand mark rides the slot through a resize. For a
  heterogeneous run — a sink base dropped mid-run — pass `slots: ["l", "sink", "r"]` and the
  members key `base[l]`, `base[sink]`, `base[r]` instead of re-pointing every later index.
- **A preset's primitives are keyed under the preset**, and the preset key is also their
  `groupId`, so the inspector shows "one mate": `base[1]/flush@base[0]` emits
  `base[1]/flush@base[0]/x`, `…/-y`, `…/-z`.
- **A parameter's key is its name.** `valueParam` and every binding address it by name.
- **A run's slot index is just part of the key string**, and `a.place` may spell it itself:
  `key: "back[0]"` on a hand-placed member reads and behaves exactly like a run's own. The door
  gives run-produced keys no privilege.
- **Name your keys.** `a.place` with no key derives one from the model slug and its occurrence
  (`worktop#1`) and says so with `key.derived` — usable, but a re-order moves it.

---

## Parameters are LITERALS, and the slider rewrites the literal

An assembly parameter is an **annotated const above `main`**, in Create's own grammar:

```js
const cabinets = 4;   // [1:12] step:1 unit:ratio label:"Cabinets"
const gap = 0;        // [0:50] step:1 unit:mm label:"Gap between cabinets"
const shelves = 3;    // a plain const — NO annotation, so NOT a parameter
```

- `[min:max]` is what makes a const a parameter. Without it, it is a constant and lifts to no
  row at all.
- The tags this room reads are **`step:` `unit:` `label:"…"` `group:"…"`**, in any order after
  the range. (Create's other tags — `toggle`, `choices:`, `pose:`, `local`/`global` — are for a
  model's own code and are not read here.) `label` and `step` are derived when you omit them;
  **`unit` is never guessed** — declare it on every numeric parameter.
  The vocabulary is `mm` · `in` · `deg` (or `°`) · **`ratio`**, and `ratio` is the one that says
  *there is no unit* — use it for a count, a multiplier or a 0–1 position. Without it a
  `cabinets` of 1–12 is converted like a length by anything showing inches.
- ⚠ **There is no `a.params`.** The program cannot read a stored parameter value — that would
  be undefined on the first run, and it would make editing the default a permanent no-op. The
  literal IS the value.
- **`set_assembly_param` rewrites the literal and re-runs the program.** So does the Studio
  slider. That is the whole mechanism: a parameter change is a code change.
- **A value DERIVED from a literal** (a worktop `length` of `cabinets * 600`) goes onto the
  instance through `a.place(model, { params: { … } })` — program-owned, re-emitted every run.
- **`a.bind(name, rows)`** publishes one assembly parameter into the members' own parameters.
  A row is `[handle, "childParamName"]`. `name` must be spelled exactly like the const, or you
  have declared a second, unlifted parameter (`param.unlifted`).
  ⚠ **`["*", "childParamName"]` is stored as ONE row with a literal `"*"`, not expanded into
  one row per instance.** It is resolved at READ time — every reader (the server build, the
  Studio pane, the published configurator) treats `"*"` as "every instance that has this
  parameter". So the wildcard works, and a graph dump of it shows one row rather than your
  cabinets by name. Pass handles when you want to see them named, or when only some instances
  should follow the slider.
- ⚠⚠ **Before you bind a TRAVEL or ANGLE control into a member, read that member's
  `get_parameters`.** A joint moves without a rebuild only when the child parameter reports
  `changeClass: "pose"`. If it reports anything else (`global`, or `local` when the const
  also carries a `local:` tag) and carries a `poseRefused` note, the member's
  `pose:` tag was refused — the binding will be accepted, the value will be saved, and nothing
  will move until the member's code is fixed. `poseRefused.reason` says which repair:
  `used` (the geometry math reads the const — build the part at rest and let the joint carry
  the motion) or `redeclared` (an inner scope shadows the const — read the top-level one, or
  rename the inner). Fix the member first; binding into a refused pose const is a silent
  no-op from this room's side.
- **Any number of mates may name one parameter.** A parameter is keyed by its NAME, so four
  flushes all reading `gapParam: "gap"` share one control and emit one row — not a duplicate key.
- **On `a.flush`, `gap`/`gapParam` set the `along` offset's value only.** Every `align` offset
  is 0 by definition: the same face on both sides.
- **`valueParam` / `gapParam`** point a mate's distance at a parameter by name. A parameter
  referenced that way with no annotated literal is kept and warned (`param.unlifted`) — its
  stored label and range stand. Declare the literal and the program owns those too.

---

## Pushing: the two doors, and `base_content_hash`

**First time**

```
create_model(...) × N          // the members must exist and must have BUILT server-side
create_assembly({ name: "Kitchen Run", code, rationale: "why this program" })
```

**Every time after**

```
get_assembly({ assembly_id })              → code · content_hash · program_run · stale
push_assembly_code({ assembly_id, code, rationale, base_content_hash: <content_hash> })
```

- `rationale` is required in practice on both — **Axle cannot see your conversation**, and it
  rides on the record and on the version row.
- `base_content_hash` is **required in practice on any assembly that already has a program**.
  Omit it and the push is refused (`base_required`: nothing written, nothing run). If the
  program moved since you read it, the push is refused as a `conflict` naming both hashes —
  re-read, decide whether your program still makes sense on top of what arrived, retry with
  the new hash. It covers the CODE only; a person dragging an instance never refuses you.
- ⭐ **`written: false` means your program was refused and NOTHING changed.** Read the verdict.
  A create whose program failed still leaves the assembly row, with the code and no graph —
  fix it and `push_assembly_code`, never a second `create_assembly`.
- The state before each run is snapshotted: `list_versions` / `rollback` work on assemblies.

---

## Reading the verdict

Every line is `{ rule, severity, message, unverified?, entities?, observedHash? }`.

- **`error`** — no graph was written. **`warning`** — the graph exists and is flagged.
  **`info`** — a fact about what happened. Only an error gates.
- **`unverified: true`** means *could not tell*, not *fine*. It never gates, and a line marked
  that way is a check that did **not** run.
- ⭐⭐ **Match by FAMILY, never by exact string.** A rule id is `family` or `family/case` — the
  case after a **slash**. `limit.combination` answers with either of its cases; an exact match on
  a bare id goes silent the day that family takes a case.
- Three kinds of line are normal on a healthy run and are not problems: `ground.resolved`
  (twice — the reconciler names the ground by key, the verdict names it by label),
  `instance.dof/measured` (one per instance) and `facts.connectors` (the standing *could not
  tell*, because this door cannot see the connector vocabulary at all). A clean run is `0
  errors, 0 warnings` and a handful of notes.

### Every line this room can raise

**Refused, or noted, before the program runs**

| rule | what it means |
|---|---|
| `program.empty` | no `code` was given |
| `program.requires/unknown-fact` | `requires` names a fact outside the vocabulary |
| `program.requires/fact-unavailable` | `requires` names a fact this assembly cannot supply |
| `program.api/generation-mismatch` | the pragma names another api generation than `asm@1` |
| `program.api/undeclared` | *info* — no pragma, so nothing could be refused early |
| `catalogue.truncated` | over 60 models, so `a.use` cannot see the rest |
| `facts.connectors` | *info, could not tell* — the connector vocabulary is empty on this door |

**From your program, through the library**

| rule | what it means |
|---|---|
| `option.unknown` | *warning* — a verb was passed an option it does not recognise (misspelled, or reaching for a DIFFERENT verb's option — `transform` is `a.place`'s, not `a.run`'s). The run still succeeds; the option is simply not read, and this is the one line that says so |
| `model.unknown` · `model.ambiguous` | `a.use` found no model with that id or name, or two with that name |
| `assembly.unknown` · `assembly.ambiguous` | `a.assembly` found no child the door read with that id/name, or two with that name |
| `assembly.empty` | a child fact with no members to flatten (an empty assembly) |
| `assembly.unread` | an `a.assembly(...)` argument the door could not read statically — not a string literal or a top-level const |
| `assembly.cycle` | this assembly reads itself through `a.assembly`, directly or through a child, however many hops down — refused before anything runs |
| `assembly.unreadable` | a transport failure while resolving or cycle-checking a composed child — refused rather than treated as missing or assumed acyclic |
| `assembly.too-many-children` | more than 10 direct `a.assembly(...)` references in one program |
| `assembly.child-solve-failed` | *warning, could not tell* — a child's own mates could not be solved, so it flattened at its unsolved placements |
| `assembly.ground-derived` | *info* — the child stores no ground, so its first member was used |
| `ref.handle` · `ref.unplaced` | a mate/bind/group end is not a handle this run placed |
| `parent.unknown` | `parent:` (or `on`'s first element) is not a handle placed earlier in this run |
| `parent.both` | `a.place` was given both `parent` and `on` — pick one relation, never both |
| `parent.on-shape` | `on` is not `[handle, "jointId"]` — a two-element array, the second a non-empty string |
| `key.duplicate/emitted-twice` | two records of one class share a key — **no graph** |
| `key.derived` | *info* — an instance was placed with no key |
| `mate.type` | not one of `offset` · `concentric` · `parallel` |
| `mate.value-ignored` | a `parallel` was given a value; an orientation mate has no distance |
| `flush.empty` | an `a.flush` with neither `along` nor `align` |
| `axis.unknown/along` · `axis.unknown/align` | not one of `+x -x +y -y +z -z` |
| `run.key` · `run.count` | `a.run` with no key, or a count that is not a whole non-negative number |
| `ground.twice` · `ground.subject` | two grounds, or a ground that a mate moves |
| `ground.derived` · `ground.none` | *info* — the ground was picked for you, or nothing could be |
| `limit.missing` | `a.slide` / `a.hinge` with no `range`. The limit IS the verb — without one you wanted `a.fasten` |
| `limit.shape` | a limit that is not `{ of, min, max }` with `min` strictly less than `max`. A limit that cannot move is a locked mate wearing one |
| `limit.combination/parallel` | a `parallel` mate carrying a limit. It places nothing and its orientation locks all three rotations, so there is no degree of freedom in it |
| `limit.combination/offset-roll` | an `offset` mate with `of: "roll"`. An offset has no roll to free; a hinge is a `concentric` |
| `limit.rest` | the mate rests outside its own limit. The stored `value`/`roll` IS the derived joint's value at rest |
| `link.ref` | an end of `a.link` that is neither `{ instance, joint }` nor a joint key |
| `link.joint` | an end names a joint the member's model does not declare. Its joints are its own code's, and they ride in the catalogue facts |
| `link.relation` | a link carrying BOTH a `table` and a `ratio`/`offset`. A driver is linear OR tabulated |
| `link.table` | a table with fewer than two rows, a row that is not two finite numbers, or rows that go backwards |
| `link.duplicate` | two links drive one joint — **no graph**. A computed value has ONE source |
| `connect.vocabulary` | `a.connect` with no connector vocabulary in scope. Nothing declares what joining would mean |
| `connect.anchor/subject` · `connect.anchor/reference` | one side declares no connector anchor (or none by the name or connector id you narrowed to). The line lists what it DOES declare |
| `connect.unknown-connector` | an anchor names a connector the bound vocabulary does not define — a typo, or the System that defines it is not bound |
| `connect.incompatible` | the pair exists and `matesWith` forbids it. That is the System's answer, not a bug |
| `connect.ambiguous` | more than one compatible anchor pair. Never picked for you — every candidate is listed, and `my`/`at` name the one you meant |
| `connect.roll-snapped` | *info* — a connector with a `rollStep` snapped your `roll` to its nearest increment |
| `cycle.duration` | `a.cycle` with no positive, finite `duration` |
| `cycle.dof-range` · `cycle.dof-shape` | a `dof` entry's `from`/`to` are not `from < to`; or its `kind` isn't `keyed`/`interpolated`/`linear`, or is missing what that kind needs (`keys`, or `start`/`rate`) |
| `cycle.carrier` · `cycle.carrier-joint` | a carrier is neither `"world"` nor `{ instance, joint? }`; or names a joint that instance's model does not declare |
| `cycle.carrier-range` · `cycle.carrier-offset` | a carrier phase's `from`/`to` are not `from < to`; or `offset` is not `"preserve"`/`"snap:<anchor>"` — or snaps with `carrier: "world"`, which has no model to declare an anchor on |
| `cycle.overlap` | O3 — two carrier phases of ONE part overlap in time — **no graph** |
| `cycle.param` | an operation param with no string `name` or numeric `value` |
| `cycle.twice` | `a.cycle` called more than once — one assembly, one operation |
| `program.threw` · `program.result/not-a-graph` | the program raised, or returned something that is not `a.graph()` |

**From the reconciler, writing your graph onto what is stored**

| rule | what it means |
|---|---|
| `run.no-graph/program-errors` · `run.no-graph/no-emit` | the run produced no graph, or emitted nothing at all |
| `law4.id-in-emit` | the emitted graph carries an `id` field — refused |
| `key.missing` | an emitted record carries no key |
| `key.duplicate/stored-twice` | two STORED records claim one key |
| `key.unresolved/unknown-key` · `key.unresolved/not-a-key` · `key.unresolved/unknown-ground` · `key.unresolved/unknown-link-end` | a reference names a key this run did not emit — a mate end, a ground, or a link's source or target |
| `key.unresolved/unknown-operation-part` · `key.unresolved/unknown-operation-joint` | A16 — `a.cycle`'s emit names an instance key (a `part` or a carrier's `instance`) or a dof/carrier joint reference this run did not place or emit — **no graph** |
| `link.role/drives-output` · `link.role/reads-input` | A14 — *warning*, never an error: a link drives a member's declared `output` joint, or reads from its declared `input`. A shared input shaft fed from one source is legitimate, so this names it rather than refusing |
| `operation.resolved` | *info* — the operation's key-space emit resolved to ids: how many carrier phases, driven joints, and the duration |
| `operation.hand-retained` | *info* — this run kept the complete hand-owned cycle; Return to program is the explicit way to recompute it |
| `operation.hand-refused` | a retained hand-owned cycle no longer fits the resulting instances, mates or effective rigs — the whole run is refused and nothing is written |
| `operation.refused` | A16's structural checks (phase overlap, an unknown part/carrier by id, a joint the carrier lacks, a dof segment on an unknown joint) failed on the RESOLVED record — **no graph**. The same `checkOperation` runs from every writer's `contract.structural`, below — this is the reconciler catching it one step earlier, with ids already in hand |
| `key.removed` | a stored entity whose key you no longer emit was removed |
| `key.skipped` · `key.skipped-unused` | *info* — a key a person took with `own: true`; and one of those you no longer emit |
| `ref.skipped` · `ref.dangling/names-a-removed-instance` | your emit references a taken key; or a stored record still names a removed instance |
| `hand.owned/walked-around` | *info* — a field a person owns was left exactly as they left it |
| `authored` | *info* — an entity a hand made, never touched |
| `param.unlifted` | a parameter the program registers with no annotated literal |
| `contract.structural` · `ground.subject` · `ground.resolved` | the record-level checks, run after reconciliation |

**Measured after the write**

| rule | what it means |
|---|---|
| `member.unbuilt` · `member.unreachable` · `member.stale` | a member has never built; is gone or trashed; or its code has moved |
| `anchor.geometry-unrecorded` | a member's build recorded anchor NAMES with no geometry |
| `mate.unsolved` · `mate.circular` | the solver could not satisfy a mate, or the mates form a cycle |
| `mate.unchecked` | *could not tell* — a mate the solver did not evaluate |
| `solve.failed` | *could not tell* — the graph is written; where it sits is unknown |
| `interference.bbox` | two placed **bounding boxes** overlap, and no mate or parent edge joins them |
| `interference.ride-unverified` | *could not tell, unverified* — an instance rides a joint (A15) this box check cannot pose, so any overlap involving it (or its absence) is measured from that instance's parent's ROOT, not the joint's moving frame |
| `instance.floating` | a program-emitted instance with no mate, no parent, and not the ground |
| `instance.dof/measured` | *info* — which axes each instance's mates locked, and which come from its transform |
| `instance.dof/probe-failed` · `dof.skipped` | *could not tell* — the DOF probe threw, or the graph is over 24 instances |
| `ground.resolved` · `ground.none` | *info* — the ground, named every run |

⭐ **Under-constrained is a REPORT, not a failure.** An `offset` locks one translation, so a
cabinet placed by two offsets is free on four DOF by design and takes them from its transform.
`instance.dof/measured` says which; it is never a thing to fix.

⚠ **`interference.bbox` is a BOX check, not a solid one**, and it skips any pair joined by a
mate or a parent edge — a drawer lives inside its bay by design. ⭐ So it is precisely the pairs
you mated that it cannot check: a `concentric` that buries the worktop inside the cabinet is
silence here, not a warning. A mate you are unsure of needs a look, not a verdict. `measure` is
the escalation for a real solid check.

⚠ It also measures the members' **default** boxes, like everything else: an instance you resized
through `paramOverrides` is checked at the size it last BUILT. And it names the pair by label
(the model's name plus its occurrence, "base-cabinet-600 2"), with their instance ids in the
line's `entities` — `get_assembly` is what maps an id back to your key.

---

## When a person edits what the program made

The record remembers who made each entity. Yours carry a `program: { hash, key }` stamp; a
person's do not, and a run never touches those.

- **A hand edit marks the FIELD it touched, and the field is what survives.** Someone nudges
  `base[2]`; the next run writes every other field of it and leaves `transform` exactly as they
  left it, reporting `hand.owned/walked-around`. You do not need to do anything about it.
  ⭐⭐ **That is a promise about the record, not about the position.** Your mates still place the
  instance, so on an axis they lock, the kept transform changes nothing and the cabinet does not
  move; on an axis they leave free, it does. Both halves are normal, and the `hand.owned` line
  names the mates that are still placing it so you can tell which you are looking at. (This is
  *The seed and the place*, one paragraph on.)
  ⚠ So a run whose `align` locks the other two axes leaves a hand nudge **nowhere to go** —
  every drag on it is stored and inert. If a person should be able to adjust a row by hand, drop
  the `align` on the axis you want them to own, and accept that a mixed-depth run then
  misaligns on it.
- **Structural surgery on your entity is refused**, naming three ways forward: edit the
  program, add an authored sibling beside it, or pass **`own: true`** on the call.
- **`own: true`** strips the stamp, hands the entity to the person, and remembers its key in
  `programRun.skipped`. Your next run **drops its emit for that key** (`key.skipped`) instead
  of minting a twin. Owning one primitive of a preset takes the whole preset.
- Your emit may still **reference** a skipped key — the person owns the cabinet, your run still
  mates around it. If that entity was then removed, the one mate is dropped with `ref.skipped`
  and the neighbour falls back to its seed transform, said out loud.
- **`release`** is the way back: `release: ["transform"]` hands one field to the program,
  `release: "*"` re-stamps the whole entity and clears it from the skip list. `own` and
  `release` never share a call.

`own` / `release` live on `update_instance`, `remove_instance`, `update_constraint` and
`remove_constraint`. `get_assembly`'s `program_run` reports all of it: `hand`, `skipped`, and
what the last run minted, updated, removed and refused.

---

## Staleness, and the re-run — hand-pressed, or opt-in automatic

`get_assembly` reports **`stale`**: the member build units whose code has moved since your last
run, each with its reason. It is keyed per build unit, so a pinned instance — one frozen at a
member's exact code — is never stale for that member having moved.

**The fix is to push the SAME code again.** A re-run against today's members re-solves the
graph, keeps every id, and reports what changed.

⚠ Staleness is per member and per code hash. A comment edit in a member stales every assembly
that requires any fact of it. A program that requires **no `model.*` fact** is not staled by a
member's PUSH, because the solve re-places its mates from the new boxes at every read and the
graph you computed did not change.

⚠⚠ **But a declaration cannot make a missing member up to date.** Two things stale any program,
whatever it declares: a member that is **gone or in the Trash**, and a member with **no code to
measure**. Those are not pushes — the assembly is made of something that is not there any more —
and `stale`'s reason says which. So `stale` being non-empty on a program that declares only
`catalogue` is not a bug in the rule; read the reason.

⚠ **A program with NO `requires` line is staled by a push.** Silence is not the claim "I read no
member facts" — it is no claim at all, and the door will not read it as one. That is the second
half of what omitting the line costs you.

### The trigger (A8 part 4): push_model_code and push_assembly_code always answer, autoRun catches up on its own

**Every member's push lists the assemblies it staled, whether or not any of them re-run.**
`push_model_code`, `promote_draft`, `rollback` (when the model's code actually moved) and
`push_assembly_code` (for the parents that compose it) each return `staled_assemblies: [{id,
name}, …]` — the pusher learns the blast radius without a separate `get_assembly` per
suspect. `staled_assemblies_note` instead of the array means the query itself could not run;
that is not the same claim as "nothing was staled" and is never read as one.

**`autoRun` is the opt-in catch-up, off by default.** `create_assembly({ auto_run: true })` or
`push_assembly_code({ assembly_id, code, rationale, auto_run: true })` turns it on for one
assembly; `get_assembly` always reports `autoRun` (`false` is the honest default, not an
absence). With it on, the worker re-runs that assembly's STORED program — once, through the same
door `push_assembly_code` uses — the moment a push staled it, under a CAS on the assembly's own
content hash: a person or agent who wrote it since is never overwritten, and the assembly simply
stays stale with its reason on the next read. A re-run that itself changed the graph can stale
its OWN `autoRun` parents in turn (one composition level up), bounded so a cycle of two
`autoRun` assemblies pointing at each other runs each one once, never loops.

**Why off by default.** A push fanning out writes into every assembly that happens to place the
model — some of which a person may be looking at in Studio right now — is the *"hidden swarm of
autonomous agents that silently overwrite work"* the product rules out. Turn it on only for an
assembly you want to track a member hands-off; leave it off for one you are actively iterating
on and re-run it yourself, with the same code, when `stale` says to.

⚠ **This is a RE-RUN, not a notification.** `staled_assemblies` names what the push staled; it
says nothing about whether any of them already caught up. Read `get_assembly` on a name you
care about — its `program_run.trigger` says `{ kind: "autoRun", by, at }` when the run you are
looking at was the fan-out's, not a hand press or your own explicit call.

---

## Not built yet — do not write code that assumes these

- **The T-Slot connector vocabulary.** It is declared (`extrusionEnd` · `extrusionFace` ·
  `cornerCube` · `endPlate`, clocking every 90°) and the T-Slot System itself is still
  unselectable, so nothing binds it yet. `a.connect` works the moment one does.
- **A `when` condition on a connector type.** Closed for v1 by design: `matesWith` is the only
  condition, and your own `if` is the when. Do not look for `when` on a connector.
- **A tool that authors a CONNECT.** `add_constraint` writes the primitive a connector would
  have chosen, without checking the pair; only a program reads the vocabulary.
- **A limit editor in Studio.** `a.slide`, `a.hinge` and `add_constraint`'s `limit` all work;
  the Assemble tab's mate card does not show or edit one, so a PERSON cannot turn a mate into a
  degree of freedom — only you can. Say so if they ask why the control is missing.
- **A tool that authors a LINK.** There is none, on purpose: a link's two ends are joints of two
  different members, and naming them by hand is the composite-id typing this language exists to
  remove. `a.link` in a program is the only door.

---

## Closing a build

1. `get_assembly` → read `program_run`, `stale` and `dangling_instances`.
2. Re-run with the same code if anything is stale.
3. `get_model_screenshot` on the assembly for a look, or `capture_preview` for the framed shot.
4. Offer what fits: **MANUFACTURE** (`export_cutlist`, STEP), **DOCUMENT**
   (`generate_drawing_pack`), **VISUALIZE** (`direct_video` — Open/Close is the hero direction
   for an assembly).
