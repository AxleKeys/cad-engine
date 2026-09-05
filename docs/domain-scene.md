# Domain — Scene (how a model LOOKS: lighting, environment, backdrop)

Load this when the user wants to **style** a model — "make it look like a product shot", "warmer
light", "put it on a white backdrop", "hero render for the homepage". Scene is **presentation over
geometry**: it never touches the code or the parts, only how they are lit and framed. The whole
surface is two blobs — `renderingConfig` (light + environment + post) and `sceneConfig` (backdrop,
floor, grid, softboxes) — read with `get_rendering_config` and written with `set_rendering_config`.

**The product here is taste, not the fields.** Anyone can flip `floor: true`. The value is knowing
which *combination* reads as "clean e-commerce" versus "dramatic hero" versus "engineering-clear".
Below are the field vocabulary and, more importantly, the **curated looks** — start from a look, then
nudge one or two fields. Don't assemble a scene field-by-field from nothing.

## The one hard rule (a real trap, not style)

`sceneConfig.bgImage` — a backdrop photo — **must be CORS-safe** or the browser taints the canvas and
**every screenshot silently fails** (blank/black). Only pass a data-URI, a same-origin URL, or a
Supabase URL from the `reference-files` bucket (public, and where Studio's own uploads land — so a
plate a human set is always safe). A remote image URL that "looks fine" in the viewport can still break capture.
When unsure, don't set `bgImage`; use `gradientBg` or `backdropSweep` for a clean ground instead.

## Composing a model ONTO a poster (the backdrop as a target, not decoration)

"Put my model on this artwork", "render it over our campaign image", "I need it sitting on a 9:16
poster." This is a **four-step choreography across two rooms**, and doing it in the wrong order
wastes a render.

1. **Set the plate** — `set_rendering_config({ sceneConfig: { bgImage: <url or data-URI> } })`.
   The plate belongs to the **model**, not to a timeline: one poster, shared by every cut. Swap it
   to change it. (Human uploads land in the public `reference-files` bucket, which is why a URL
   from there is CORS-safe; an image *you* generated goes straight in as a data-URI.)
2. **Set the shape** — `upsert_video_timeline({ format })` in the motion room. ⚠ **This is the only
   aspect control there is.** A timeline's `format` sets the composing frame *and* the export
   pixels, so "compose at 9:16" literally means "make a `tiktok_9_16` cut". There is no separate
   aspect argument to look for; if you cannot find one, that is why.
3. **Look** — `capture_screenshot`. With a cut selected the tab's drawing surface **is** the output
   shape, so the screenshot you get back is the composed frame, not a wider view you have to
   imagine cropping. This is the step people skip; the whole point of the plate is that you check
   the composition before committing a render.
4. **Adjust** — move the CAMERA (`capture_screenshot` with `position`/`target`, or a Motion frame's
   camera), not the model. The model's origin is its geometry's business.

**Reading what you get back.** The plate is **fitted**, never stretched: if the poster's shape does
not match the cut's format you will see **letterbox bars** in the frame. Bars are the picture telling
you the truth — fix them by using a poster of that shape, or by choosing the format that matches the
poster. They are not a bug, and they will be in the delivered file.

**The two outputs are different deliverables** — do not conflate them when the user asks for "the
video with the background":

| Ask | Tool | The plate |
|---|---|---|
| a finished, postable piece | `render_video` | **burned in** |
| a cutout for a designer's own layout | `render_frames` | **ignored** — model on alpha, by design |

So a user who composed against a poster and then asks for transparent frames gets frames whose
*framing* assumes the poster but whose *pixels* carry none of it. That is correct. Say it out loud
rather than letting them discover it in an editor.

⚠ `render_video` **refuses** `transparent: true` rather than quietly returning an opaque file —
no browser encodes alpha for any video codec, so a transparent *video* does not exist on any
executor. The refusal names `render_frames`; take the redirect.

**A third surface, and the one that surprises people: `/embed/:id?bg=transparent`.** That flag drops
the embed's page background so the **host page** shows through — but it composites the *whole embed*,
chrome included, because the configurator's panels are frosted. That is the flag doing what it says.
It is not a way to get "just the model over artwork": for that, either set a plate (the artwork goes
INSIDE the stage, where the chrome still has a surface to sit on) or use `render_frames` and let a
designer place the cutout.

## Always: get before set

`set_rendering_config` **merges** — it patches the fields you pass and leaves the user's other choices
alone. So call `get_rendering_config` first and patch a real field. `null` from get = the model has
never been styled and is on Studio's defaults (a warm neutral gradient, soft key light, no floor).

## Curated looks (the taste — pick one, then nudge)

Each is a `set_rendering_config` payload. They mirror Studio's three built-in tiers plus two
intent looks. Merge semantics mean you can layer a look over an existing style.

### "Clean / technical" — stark, grid, neutral (spec sheets, catalog line-art, "show me the shape")
```
renderingConfig: { hdr: "studio", envIntensity: 1.0, shadows: true, shadowOpacity: 0.18, bgVisible: false }
sceneConfig:     { gridMajor: true, gridFade: false, floor: false, contactShadow: false, hemiIntensity: 0.4, gradientBg: false, backdropSweep: false, toneMapping: "neutral", vignette: false }
```
Neutral tone-mapping (not ACES) keeps colors literal — right when the geometry is the message.

### "Product shot" — soft studio, floor, grounded shadow (e-commerce, marketplace thumbnails)
```
renderingConfig: { hdr: "studio", envIntensity: 1.0, shadows: true, shadowOpacity: 0.28 }
sceneConfig:     { floor: true, floorReflective: false, floorRoughness: 0.5, contactShadow: true, contactShadowStrength: 0.45, gridFade: true, gradientBg: true, hemiIntensity: 0.5, toneMapping: "aces", vignette: false }
```
The default workhorse. Grounded contact shadow makes it sit on a surface; ACES gives natural rolloff.

### "Hero" — photoshoot: mirror floor, cyclorama sweep, vignette (homepage, Kickstarter, the money shot)
```
renderingConfig: { hdr: "studio", envIntensity: 1.1, shadows: true, shadowOpacity: 0.3, renderScale: 1.5 }
sceneConfig:     { floor: true, floorReflective: true, floorReflectStrength: 0.6, floorReflectBlur: 0.3, contactShadow: true, contactShadowStrength: 0.5, backdropSweep: true, backdropShape: "cove", gradientBg: false, hemiIntensity: 0.3, toneMapping: "aces", vignette: true, vignetteStrength: 0.35 }
```
`renderScale: 1.5` supersamples for a crisp final frame. The cyclorama (`backdropSweep` + `cove`)
removes the horizon line so the product floats in seamless studio space. Reflective floor sells premium.

### "Warm wood" — furniture in a lived-in light (walnut, oak, anything that should feel handmade)
```
renderingConfig: { hdr: "studio", envIntensity: 1.2, shadows: true, shadowOpacity: 0.25 }
sceneConfig:     { floor: true, floorRoughness: 0.6, contactShadow: true, gradientBg: true, gradTop: "#fbf6ee", gradMid: "#efe6d8", gradBottom: "#ddd2c0", hemiIntensity: 0.6, hemiSky: "#fff1dd", toneMapping: "aces" }
```
Warm gradient + warm hemisphere sky = golden-hour feel that flatters wood grain (pairs with the
material-textures albedo). Don't over-crank `envIntensity` — a blown-out key washes out grain.

### "Dark studio" — moody, single key, black ground (dramatic metal, premium single-object)
```
renderingConfig: { hdr: "studio", envIntensity: 0.7, shadows: true, shadowOpacity: 0.4 }
sceneConfig:     { gradientBg: true, gradTop: "#2a2c30", gradMid: "#17181b", gradBottom: "#0c0d0f", floor: true, floorReflective: true, floorReflectStrength: 0.5, contactShadow: true, hemiIntensity: 0.15, backdropSweep: true, vignette: true, vignetteStrength: 0.5, toneMapping: "aces" }
```

## Field vocabulary (for nudging, once you're on a look)

**`renderingConfig`** — `hdr` (environment map, "studio" is the safe default) · `envIntensity`
(overall ambient brightness, ~0.7 moody → 1.5 bright; there is no post-gain `exposure` control —
it was removed 2026-08-02, light with intensities) · `shadows` + `shadowOpacity` (0.1 faint →
0.4 hard) · `bgVisible` (show the HDR as
the background — usually **false**, you want a clean ground not a photo studio) · `edgeOpacity` +
`edgeColor` (the drawn part outlines) · `renderScale` (supersample; 1.5 for finals, 1 for speed).

**`sceneConfig`** — **ground:** `floor` + `floorReflective`/`floorReflectStrength`/`floorReflectBlur`
+ `floorRoughness`; `contactShadow` + `contactShadowStrength` (the soft ambient-occlusion patch under
the object — cheaper and often better than a hard cast shadow) · **backdrop:** `gradientBg` +
`gradTop`/`gradMid`/`gradBottom`; `backdropSweep` + `backdropShape` ("wall" | "cove", the seamless
cyclorama) · **ambient:** `hemiIntensity` + `hemiSky`/`hemiGround` (sky/bounce color) · **post:**
`toneMapping` ("aces" natural | "neutral" literal), `vignette` + `vignetteStrength`, `fogEnabled` ·
**grid:** `gridMajor`/`gridFade`/`gridColor`/`gridOpacity` (on for technical, off for hero) ·
**softboxes[]:** up to 3 area lights (`key`/`fill`/`back`) with `azimuth`/`elevation`/`intensity` —
reach for these only when the built-in looks aren't enough; the HDR + one key usually is.

## After you style

The write lands in the model's stored data. **An open Studio tab applies it live within one sync
poll** (watch-mode refresh) — the user watching sees it dress in a few seconds; if no tab is open it
applies on next model open. Every screenshot, turntable, and the buyer embed inherit this look, so
styling once pays off across all of them. Close with a concrete next move: `capture_screenshot` to
prove the look, or `capture_turntable` for a spin.
