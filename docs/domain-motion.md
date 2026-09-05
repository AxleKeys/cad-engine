# Domain — Motion (frames, timelines, video, instructions)

Load this when authoring a model's **Motion**: build-sequence animations, product reels, the
interactive step-through, or shop-instruction stills. Motion is **presentation over a model** —
camera + joint poses + part visibility per named scene. A frame **never rebuilds geometry** (pose
and visibility only), so a whole reel is one build and many cheap renders.

## Three output classes — pick the right one, they are not interchangeable

- **Interactive 3D** — a live, rotatable, click-to-advance player (a configurator/embed). Choose
  it when the viewer should explore. A video cannot do this.
- **Marketing video** — a directed MP4, per format (social, ad, Kickstarter). Choose it for reach.
  (Compositing the model over your own artwork in an editor? `render_frames` publishes the same
  timeline as transparent PNGs instead — true alpha, needs an open Studio tab, capped at 120 frames.)
- **Instructions** — a maker pauses, scrubs back, rotates step 4. This is **NOT a video**: it is the
  interactive step-through **+ printable PDF stills**. An MP4 is the wrong container for "attach the
  left side with 4× 8mm dowels."

The same authored frames feed all three. Don't build a video when the user wants to *instruct*.

## ⭐ Want a video? Call `direct_video` and stop reading here

**One call compiles a whole cut** — every camera, every dwell, every transition — from a
**Direction**: a reusable recipe for *how a product is shot*, stored as proportions rather than
positions, so the same one frames a bookshelf and a birdhouse and re-frames itself when either is
resized or published at another aspect.

```
direct_video({ model_id })                       // best fit for this model, never refuses
direct_video({ model_id, direction: "build_up", format: "tiktok_9_16", render: true })
```

- **Omit `direction`** and it picks: a build sequence → Build-Up · joints → Open/Close · otherwise
  Orbit Hero. That choice can never refuse, so a bare call always produces something.
  `list_directions` describes them all, with what each one needs — pass `model_id` to it and each
  row also says whether THIS model can run it, and why not when it cannot.
- **Nothing is locked.** The result is an ordinary timeline — `list_frames` to see it,
  `upsert_video_timeline` to hand-edit any entry, `render_video` to publish.
- **It does not double the pool.** Camera-only beats replay a frame instead of minting one, so a
  five-beat orbit costs the pool ONE frame; re-directing the same `video_id` recompiles in place
  and reuses what is already there. Read `frames_minted` / `frames_reused` in the response — they
  are there so you can see it rather than take it on trust.
- **`render: true` queues an MP4, it does not return one.** The response carries `job_id` and
  `executor_present`; poll `get_job_status`. If `executor_present` is `false`, say so — nothing is
  running to claim it. `null` means the check could not be completed, which is not the same as no.
- **`look` dresses the model for the shot in the same call** — `look: { builtin: "camera-ready" }`
  is the one made for video (grid off, soft floor, warm key); `patch` merges exact
  `renderingConfig`/`sceneConfig` fields on top. Field-level merge, so the model's other scene
  choices survive; applied before the cameras are composed, so a patched `fov` reframes the cut.
  The response's `look_applied` names the exact fields written. ⚠ Refused on an assembly (it owns
  no scene — dress a member model), and a USER scene preset cannot be named here: pass its fields
  as `patch`.
- ⚠ **It frames against the last server-side build** and rebuilds first if the code has moved
  since, so a call right after a push costs a build. Correct rather than fast.
- ⭐ **It works on ASSEMBLIES too.** Pass an assembly id and the whole thing is framed: member
  bounding boxes placed and oriented by their instance transforms, the story told INSTANCE BY
  INSTANCE bottom-up, and joints aggregated across members as `instanceId::jointId` — which is
  why **Open/Close is the hero direction for an assembly**: it cycles the mechanism. Staleness is
  per member, so one edited child rebuilds and the rest do not. A member with no built geometry
  is REPORTED in `notes`, never quietly left out of the frame.

- ⭐⭐ **A cut you tuned by hand can become a Direction.** `save_direction({ model_id, video_id,
  name })` reads the cut's cameras and timings back as semantic beats, so the shot you spent your
  judgement on applies to every model afterwards — including ones it has never seen. Entries the
  compiler made are copied from the authored table exactly; entries a person re-composed are
  MEASURED off the pose they actually chose, which is the opposite of re-applying a direction
  (there, hand-tuned shots are walked around). Saved directions appear in `list_directions` with
  `saved: true` and are passed to `direct_video` exactly like a built-in. `delete_direction`
  removes one; re-saving under the same name updates it in place.
  - It returns a short deterministic **note** about the beat table it just saved ("every beat is
    the same length", "nothing rests at the end"). ⚠ **That note never blocks and never edits** —
    the Direction is already written when you read it. Pass it on if the user is choosing how the
    reel should feel; do not treat it as a failure or re-save to "fix" it.
  - It also returns `issues` for the limits of the reading — the vocabulary always aims at the
    model's centre, so a shot re-aimed at a specific feature saves as the nearest centred one and
    says so. Reported, never a refusal.

**Hand-author instead only when the brief demands a shot no direction gives you** — a specific
angle on a specific feature, a client's storyboard, a mechanism that has to be filmed a particular
way. That path is the rest of this document, and the full per-beat recipes live in
`context/motion-director-playbook.md` § 5.

## The Frame is the atom — NOT the keyframe

A **frame** is a named *scene* (SketchUp Scenes / Keynote Morph), a whole snapshot: `camera`,
`jointStates`, `visibility`, `explode`, `buildStep`, timing (`hold` in, `move` to next). You author
*scenes* and the timeline interpolates between them. There is no per-property keyframe track. Don't
try to animate a single value in isolation — capture the start scene and the end scene.

## Rigging comes first — a frame can only pose joints that exist

Frames set joint VALUES. Something has to have declared the joints, and how they relate, or
there is nothing to animate. That is the `motion` room's other half: `list_joints`,
`add_joint`, `update_joint`, `remove_joint`. Joints live **on the model** and travel with it,
so every instance and configurator inherits the rig for free.

**Joints CHAIN.** `parent` makes one joint's motion compose on top of another's — a shoulder
carries its elbow, a boom carries its dipper, a carcass carries the drawer inside it. Build a
chain **proximal first**, because `parent` must name a joint that already exists.

⚠ `parts` lists **only that joint's own parts**. A parent moves its whole subtree
automatically, so re-listing a child's parts on its parent is an authoring error and is
refused. This is the single easiest mistake to make.

**A ball joint is not a type** — it is revolutes chained at one pivot. Pass
`dof: ["x","y","z"]` instead of `axis` and `add_joint` emits them for you, in application
order (x, then y, then z). Read `chain_onto` from the response and parent the NEXT link onto
**that** id: parent onto the wrong DOF and the link inherits only part of the rotation.

**Drivers compute a value from another joint.** `driven: { source, ratio, offset }` gives
`value = source × ratio + offset`, clamped to the driven joint's own limits — a gear pair,
both doors of a cabinet opening together (`ratio: -1`), a lid stay tracking a lid. A driven
joint is not posed independently: a `jointStates` entry for it is overwritten by its source.

`parent` and `driven` are **orthogonal**. `parent` composes *transforms* (where a joint sits);
`driven` composes *values* (how far it has moved). A joint may use either or both.

⭐⭐ **A rig failure is invisible at rest.** A broken chain puts every part in exactly the
right place at its default value and only comes apart once something moves. So never conclude
a rig is correct because it built or because a screenshot looks right — **pose it**, and check
the far end of the chain rather than the joint you just added. `list_joints` reports each
joint's `chain` (root-to-here) and `children` so you can read the structure without guessing.

**Prefer `anchor` over a measured `pivot`** on anything parametric: an anchor is declared in
the model's own code (`api.anchor(...)`) and recomputed every build, so a hinge follows the
geometry instead of drifting off it. A revolute joint DOUBLES a pivot error at the open end.

## Tool workflow (motion staging room)

⚠ **This is the by-hand loop.** For a video, `direct_video` does steps 1-4 in one call and hands
back a playable cut; come here to REFINE it, or when the brief needs a shot no direction gives.

0. **`direct_video`** — compile a whole cut from a Direction. `list_directions` to choose one, or
   omit `direction` for the best fit (which never refuses). The result is an ordinary timeline, so
   everything below still applies to it.
1. **`list_frames` FIRST** — always. It returns the existing frames/timelines **and** the model's
   `parts` (names, for `visibility`) and `joints` (ids + range, for `jointStates`). You cannot author
   a frame correctly without these names.
   ⭐ **Everything a write REPLACES, it returns in FULL, spelled the way you write it back**: a
   frame's `visibility` and `jointStates` maps, its `notes`, a cut's `sequence` entries with their
   composed `camera`/`transition`, and `interactive.sequence`. So changing ONE key is: read the map,
   change that key, send the map. Never reconstruct one from a count or from memory. (Empty maps are
   omitted — no overrides means every part visible and every joint at rest.)
2. **`capture_frame` / `update_frame`** — a scene. `visibility` maps **part name → boolean**;
   `jointStates` maps **joint id → value**. `camera` is **viewer space** (three.js, Y up, mm):
   `{ position:[x,y,z], target:[x,y,z] }`. Headless you can't *see*, so prefer copying an existing
   frame's camera from `list_frames` and nudging it. ⚠ Omitting `camera` is a real fallback but a
   weak shot: the default aims at the ORIGIN, and the model sits on `y = 0` — see "Aim at mid-height"
   below before you ship a reel with it. Precise bbox-framed presets exist only in Studio; when in
   doubt, set a reasonable camera and tell the user to refine it.
   ⭐ **A part name or joint id you pass that the model doesn't have is REFUSED**, with the known
   list — fix it and re-send. But an unknown key in some *other*, already-authored frame never
   blocks you: the write lands and the response carries `warning` + `stale_references` naming the
   frames. That is normal drift (a part renamed, a `count` parameter lowered), it poses and hides
   nothing at playback, and **nothing is repaired for you**. Never re-send a write because of it.
   To clean it up: `prune_stale_visibility` (below) for the visibility keys, `update_frame` with the
   `jointStates` map minus the dead ids for the poses, `set_frame_notes` for a drifted callout.
3. **`prune_stale_visibility`** — the repair verb for that drift, and **the only tool in this room
   that deletes something you did not name**. It needs no map round-trip: the server already knows
   which keys are stale, drops exactly those, and reports what went, per frame.
   ⚠⚠ **There is no undo** — motion writes create no version row. Call it with `dry_run: true`
   first; pass `frame_ids` to narrow it. It prunes **visibility only** — a stale joint pose or
   callout subject is left for `update_frame` / `set_frame_notes`, because re-pointing those is a
   judgement and deleting authored text is not a cleanup.
   ⭐ It **refuses rather than guesses**: if the model's part list comes back empty it does nothing
   and says so, because empty means *"we don't know what parts exist"* (a model that has never built
   looks identical to a failed read), and pruning against it would delete every visibility key in
   the pool. If you get that refusal, build the model first — do not work around it.
4. **`generate_frames_from_sequence`** — the fast path for a **build animation**: one frame per part
   in build order with cumulative visibility (each part appears from its step on). It REPLACES the
   frame pool and uses a default camera — then `update_frame` a few cameras for variety.
5. **`set_frame_notes`** — the frame's on-screen TEXT beyond its label. ⭐ One field decides the
   kind: pass `subject` (a **part name**) and you get an **anchored callout** — a tinted pill drawn
   pointing at that part, tracking it as the camera moves; omit `subject` and you get a **caption
   line**, bulleted under the label in the lower third. Both burn in on every executor.
   ⚠ It **REPLACES** the frame's notes: send the whole list, re-sending each note you are keeping
   with its `id` from `list_frames`; `notes: []` clears them. A bare string is a caption line, so
   `notes: ["Sanded to 180"]` is the short spelling. A `subject` naming no part is **refused** —
   unlike a stale visibility key this one is not inert, because a callout the scene cannot resolve
   is simply not drawn and the note's text reaches no render at all. A note a frame inherits from
   its build step reads back as `from: "step"`; it belongs to that step and is not replaced here.
6. **Arrange** — `reorder_frames` (the pool), `set_interactive` (the click-through order),
   `upsert_video_timeline` (a per-format cut; omit `sequence` = all frames).
   ⭐ A `sequence` entry may be an **object** instead of a bare id, and that is how one frame pool
   serves two outputs: `{ frame_id, camera }` composes a shot for **this cut only** — the frame keeps
   its own camera and the click-through walkthrough keeps using it — and `{ frame_id, transition }`
   sets that segment's `duration`/`type`/`easing`. Reach for the camera override when a frame that
   reads well as a *destination* is composed wrong as a *waypoint*: a foundation shot framed low so
   the build grows into frame is right in a sweep and weak as a static click-to. **Scene content —
   visible parts, poses, explode — always stays shared; never duplicate a frame just to reframe it.**
   ⚠ `sequence` REPLACES the stored one: re-send whole entries, or an entry you re-send as a bare id
   loses the camera it had — including shots a **human** composed in Studio, which live in this same
   field. `list_frames` returns each cut's `sequence` **in full**, entries and all, so re-sending it
   intact is a copy, not a reconstruction. (`composedShots`/`transitions` are the counts beside it.)
7. **`render_video`** — queues the MP4. **Poll `get_job_status`** → `result.download_url`.
   Its levers: `fps` · `quality` (bitrate only) · `range: [startSec, endSec]` to publish one beat of
   a long cut · `format` to render the same timeline at a second aspect · `captions: false` to
   suppress the burned-in text. ⚠ `format` does **not** recompose: stored cameras keep their pose,
   so a 16:9 shot rendered 9:16 crops the sides — look at the result.

## The maker's brand on the output

Every reel already carries an accent — the tick beside a frame's title — and it comes from the
**active brand profile's `spec.identity`**: `{ accent, logoUrl, wordmark }`. Read it with
`get_active_branding`, set it with `create_brand_profile` (⚠ sending `spec` replaces that object
whole, so read it first and re-send the keys you are keeping). With no identity set, outputs use
Axle's default accent — which is fine, and is a thing worth telling a maker who is publishing under
their own name.

`upsert_video_timeline`'s **`end_card`** ends a cut on that brand: logo (or shop name) over an accent
rule over the model's name. `true` for a 2s hold, `{ seconds: 1.5 }` to time it, `false` to remove it;
**off unless asked for**. It adds no frame to the timeline — the card is composited after the sequence
has played, so the click-through walkthrough and the embed are unchanged. ⛔ The MP4 is **silent**, end
card included; there is no audio anywhere in Axle, by decision. Point a maker at their editor for that.

## Format → platform judgment

`tiktok_9_16` / `ig_4_5` = vertical social. `yt_16_9` = landscape/YouTube. `square` = feed-safe.
`website` = the embed/hero (16:9). One timeline can be re-cut per format via `upsert_video_timeline`,
or rendered once at another aspect with `render_video`'s `format` — but the cut is *composed* for one
frame shape, so re-cut when the framing matters and override when you just need a second file.

## Three facts that change how you author

- **Context burns in on EVERY executor, by default.** Callouts (a note with a `subject` → drawn
  pointing at that part) and the caption lower-third (the frame's **label** + its un-anchored notes)
  are burned into the video whether a Studio tab or the headless render worker claims the job — the
  same picture either way, since 2026-08-03. PDF instruction stills carry the notes too. Pass
  `captions: false` to `render_video` for clean pixels. ⚠ The consequence to author for: **a frame's
  `label` is on-screen COPY**, not a filing name — it is the caption's title line, and `Frame 3` is
  what a viewer reads. Keep supers to ≤ 2 per reel, ≤ 4 words. The whole overlay is yours: the label
  via `capture_frame`/`update_frame`, and the anchored callouts + extra caption lines via
  `set_frame_notes`. Author the text with the shot, not after it — a callout is the reason a viewer
  understands the beat, and it costs one call.
- **Visibility maps are OVERRIDES, not whitelists.** Every renderer (tab, embed, headless) resolves
  a frame the same way: `buildStep` derives the base state (parts visible up to that step), then the
  frame's `visibility` map merges ON TOP — over an all-visible base when there is no `buildStep`. So
  for a build reel, set `buildStep` (or use `generate_frames_from_sequence`) and the parts arrive
  everywhere; to hide a part, say so explicitly (`{lid: false}`) — an absent key stays visible, it
  does not hide. Read the real part names from `list_frames` — never from material bindings, which
  can list parts the current geometry does not build.
- **render_video is executor-run, and needs nothing open.** The job is claimed by whichever executor
  is running: a live Studio tab on this model, or the **headless render worker** — no browser, no tab,
  no window. With NO executor running it stays **queued**. Say so honestly: if `get_job_status` sits at
  `queued`, nothing is executing it; don't promise a file that isn't coming. But don't tell the user it
  is impossible without a tab — that is false, and it is the wrong answer to "can this be automated?"

## Directing a 10-second reel BY HAND

⚠ **Reach for `direct_video` first** (top of this file) — it compiles everything below in one
call, and the six built-in Directions (incl. the Turntable, a uniform 360° spin) are these same
rules already applied. What follows is the
custom-shot path: read it when the brief demands a shot no direction gives you, or when you are
refining a compiled cut entry by entry.

Load this stance when the ask is a *short-form reel* (IG/TikTok/hero loop), not an instruction sheet.

**Order of work:** look → storyboard on the clock → compute cameras → draft at low fps → refine →
60fps final. Do not reorder; framing cannot rescue a blown-out material.

**The clock.** Each frame owns `Hold In → Move → Hold Out`;
`total = Σ(hold + move + holdOut) + lastHold`. A non-last `hold` defaults to 0 and the last frame
auto-holds 1.5s. On a **video** timeline the move comes from the *next* sequence entry's
`transition.duration` (a `MotionTransition` needs an `id`). Aim for **3–5 beats in 10s**.

**What the engine really does** — the menu is wider than the behaviour:

- 5 transition types = **3 behaviours**: `cut` snaps, `orbit` arcs, and `dolly`/`zoom`/`reveal` are
  all the *same straight lerp* (three names for one move, because they read as three intentions).
  `dissolve` was **removed** — it promised a pixel blend and was that same lerp; an old timeline
  carrying one still plays unchanged.
- Easing is **4 quadratics** (`linear`/`ease`/`ease-in`/`ease-out`). Snap comes from a `cut`, never
  from a fast lerp.
- ⚠ `orbit` takes the **shortest angular path and wraps at ±180°** — a single 360° segment animates
  nothing. Chain arcs of **≤ 90°**.
- Explode is **global and radial**; per-part motion exists only through joints.
- `quality` sets **bitrate only** — iterate by lowering `fps`, never quality.

**The rubric.** Open mid-move (`hold: 0` on frame 1 — the first frame is the thumbnail) · one idea ·
vary the beats, never uniform cells · nothing fully still except a 1.5–2s final rest · arcs over
lines · ease-out into arrivals, `linear` only for a loop spin · pop-on-arrival for build beats · one
joint performance where joints exist (`jointMove` lets the product perform while the camera holds) ·
light before framing · compose per format · ≤ 2 supers of ≤ 4 words · 60fps finals · **never ship a
reel nobody watched**.

**Aim at mid-height.** The viewer does not centre the model vertically — it sits ON `y = 0` and
rises. Point the camera target at `[0, height/2, 0]` (height from `check_dimensions` /
`get_build_status`); aiming at the origin (which the default shot does) puts the subject in the top
half of every frame with a dead bottom.

**Composing for vertical (9:16).** Framing math fits the bounding *sphere*, which is very
conservative for a long, flat object — it will look small. **Elevation is the vertical-format lever**
(look down 25–42° to foreshorten length), then favour three-quarter azimuths (±20–65°) and avoid the
broadside, then tune distance. Stored cameras do **not** reframe across formats: compose per format.

**Light.** The key light is **world-fixed**, so an orbiting camera sweeps through it and the same
material can read three different ways around one turntable. Either flatten the ratio or keep the
hero arc in the flattering zone. A **pale material under a hot key clips to flat white with no
grain** — check before you frame. The levers are `renderingConfig.envIntensity` /
`keyIntensity` / `fillIntensity` and the softbox intensities (`set_rendering_config`; details in
domain-scene). There is **no `exposure` control** — it was removed 2026-08-02.

**Verify.** Render a low-fps draft, then *look at frames*, not at a status field. A per-frame
difference (`tblend=difference` + `signalstats`) is the rubric as numbers: non-zero at t=0 proves the
hook, dips prove the holds, a zero tail proves the rest.

## Anti-goals

- Don't rebuild geometry from a frame (pose/visibility only).
- Don't treat an instruction as a video (interactive + PDF stills).
- Don't invent part names or joint ids — read them from `list_frames`. A callout's `subject` is a
  part name too, and a wrong one is the quietest failure in the room: nothing is drawn.
