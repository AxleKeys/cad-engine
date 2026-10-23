import { scanCodeIdentifiers, poseRefusal,                  } from "./codeIdentifiers.js";

// Code-annotation parameter grammar — parse and rewrite `// [min:max]` annotated
// consts in generated model code. Pure logic, no React/DOM.

/** t8-4 blast-radius classification. Untagged params are treated as "global"
 *  (rebuild everything — slow but always right). */
                                                      

                         
                                                        
                                                                         
                                                                              
                            
                                                                                              
                                                                                     
                            
                                                                 
                   
                                                                           
                                                                                     
                                                                        
                                                                                                  
                                                                                   
                                                                    
                                                                         
  

// Annotation grammar (consts stay numeric so the rewrite regex, sweeps, and
// assembly bindings all keep working):
//   const width = 800;      // [400:1600]                  → slider (negatives OK)
//   const includeBack = 1;  // [0:1] toggle                → toggle (0/1)
//   const roofStyle = 0;    // [0:2] choices: gable|flat|shed → segmented (index)
//   const doorOpen = 0;     // [0:110] pose:door_hinge     → pose class (t8-1): drives
//     the named ModelJoint at render time — the const must NOT be used in the
//     geometry math (the part builds closed; the joint re-poses it). Editing it
//     skips the OCC rebuild entirely. If the const IS referenced anywhere else
//     in the code, the tag is ignored and it stays a normal rebuild param.
//   const doorW = 400;      // [300:600] local:Door        → local class (t8-4): only
//     the named part(s) reshape (names match the built body names). Metadata for
//     the regen engine + agents; the part list is optional (`local` alone is fine).
//   const thickness = 18;   // [12:30] global              → global class (t8-4):
//     reshapes everything that references it. This is also the default for any
//     untagged param — declaring it is documentation, not behavior change.
//
// t9-build presentation tags (all optional, order-independent, appended after the
// class tag). These are UI metadata — they never change geometry:
//   step:5              slider granularity (in the param's own units)
//   unit:mm             display unit label (mm | in | ° | deg | ratio | %…)
//     ⭐ DECLARE THIS ON EVERY NUMERIC PARAM. It is a FACT about the parameter; without it
//     the panel falls back to guessing from the name and range, and its last resort is
//     "assume millimetres". `unit:ratio` is how you say a value has NO unit — a proportion,
//     a multiplier, a normalized 0–1 position. Without it a `doorPosition` of 0.15–0.85 is
//     converted like a length and reads "0.014 in" to anyone working in inches, which is
//     unusable (board t25-units). `ratio | frac | fraction | unitless | none | x | %` all
//     mean the same thing: show the number as it is, never convert it, print no unit.
//     Read in exactly one place — classifyParamUnit, app/lib/paramPresentation.ts (guard S20).
//   label:"Cabinet Width"   human display name (quoted; else derived from the const name)
//   group:"Frame"       collapsible group in the parameter menu (quoted)
//   lock                read-only — the value can't be dragged in the UI
export const parseCodeParams = (code        )              => {
  const re = /const\s+(\w+)\s*=\s*(-?[\d.]+)\s*;\s*\/\/[^\[]*\[(-?[\d.]+):(-?[\d.]+)\]([^\n]*)/g;
  const params              = [];
  const hasPoseTag = code.includes("pose:");
  const scan = hasPoseTag ? scanCodeIdentifiers(code) : null;
  let m                        ;
  while ((m = re.exec(code)) !== null) {
    const p            = { name: m[1], value: parseFloat(m[2]), min: parseFloat(m[3]), max: parseFloat(m[4]) };
    let tail = m[5] ?? "";
    // Extract the QUOTED presentation strings first — their contents (e.g.
    // group:"Global Frame") must not reach the changeClass word-matches below.
    const labelMatch = tail.match(/\blabel:\s*"([^"]*)"/);
    if (labelMatch) { p.label = labelMatch[1]; tail = tail.replace(labelMatch[0], " "); }
    const groupMatch = tail.match(/\bgroup:\s*"([^"]*)"/);
    if (groupMatch) { p.group = groupMatch[1]; tail = tail.replace(groupMatch[0], " "); }
    const stepMatch = tail.match(/\bstep:\s*(-?[\d.]+)/);
    if (stepMatch) { p.step = parseFloat(stepMatch[1]); tail = tail.replace(stepMatch[0], " "); }
    const unitMatch = tail.match(/\bunit:\s*([a-zA-Z°%]+)/);
    if (unitMatch) { p.unit = unitMatch[1]; tail = tail.replace(unitMatch[0], " "); }
    if (/\block\b/.test(tail)) { p.locked = true; tail = tail.replace(/\block\b/, " "); }
    const choicesMatch = tail.match(/choices:\s*([\w][\w \-|]*)/);
    if (choicesMatch) {
      p.kind = "enum";
      p.choices = choicesMatch[1].split("|").map(s => s.trim()).filter(Boolean);
    } else if (/\btoggle\b/.test(tail)) {
      p.kind = "toggle";
    }
    const poseMatch = tail.match(/\bpose:\s*([\w-]+)/);
    if (poseMatch) {
      // Only the declaration may remain; metadata and literal text are not uses.
      // ⭐ A REFUSAL IS REPORTED, NOT DROPPED. The decision is unchanged (exactly one mention
      // ⇒ pose); what is new is that `poseRefused` says WHY when it is not granted.
      const refusal = poseRefusal(scan, p.name, poseMatch[1]);
      if (refusal) p.poseRefused = refusal; else p.pose = poseMatch[1];
    }
    // t8-4 change-class. A choices list could contain the literal words
    // "local"/"global", so class tags are matched outside the choices segment.
    const tailNoChoices = choicesMatch ? tail.replace(choicesMatch[0], "") : tail;
    const localMatch = tailNoChoices.match(/\blocal(?::([\w-]+(?:\|[\w-]+)*))?\b/);
    if (p.pose) {
      p.changeClass = "pose";
    } else if (localMatch) {
      p.changeClass = "local";
      if (localMatch[1]) p.parts = localMatch[1].split("|").filter(Boolean);
    } else if (/\bglobal\b/.test(tailNoChoices)) {
      p.changeClass = "global";
    }
    params.push(p);
  }
  return params;
};

// ⭐⭐ ONE PATTERN, TWO READERS. `applyCodeParam` substitutes a value; `codeDeclaresParam`
// asks whether there is anything to substitute. Written as two regexes they would agree
// today and drift the first time either was touched, and the drift would be invisible: the
// writer would silently no-op while the checker said the override had landed
// [[feedback_three_registries]]. So the match is defined once.
//
// ⚠ The name is ESCAPED. It was not, and a param key is not always `\w+` — `param_overrides`
// over MCP takes arbitrary keys, so an override named "a.b" built `const\s+a.b\s*=` and the
// `.` matched any character, rewriting `const aXb`. Escaping cannot change the behaviour of
// any ordinary identifier and closes that.
const paramDeclPattern = (name        ) =>
  new RegExp(`(const\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*)-?[\\d.]+`);

export const applyCodeParam = (code        , name        , value        )         =>
  code.replace(paramDeclPattern(name), `$1${value}`);

/** Whether `applyCodeParam(code, name, …)` would actually change anything.
 *
 *  ⚠ NOT `parseCodeParams().some(p => p.name === name)` — that asks a DIFFERENT question.
 *  parseCodeParams only sees consts carrying a `// [min:max]` annotation, while
 *  applyCodeParam rewrites any numeric const, so an override on an un-annotated const does
 *  land and must not be reported as dropped. This asks the one question that matters: is
 *  there a declaration for this name to write into? */
export const codeDeclaresParam = (code        , name        )          =>
  paramDeclPattern(name).test(code);

/** The effective param names that will go NOWHERE against this code — an override or
 *  binding naming a const the model no longer declares.
 *
 *  ⭐ Why it exists: `applyCodeParam` is a string replace, so a param RENAMED in the source
 *  silently drops every override pointing at the old name and the instance builds at the
 *  new default. Measured 2026-09-23 (scripts/headless/probe-assemble-pin.mjs): an instance
 *  carrying {deckHeight: 700} went to 300mm the moment the child renamed `deckHeight`, with
 *  no toast, no badge and no error anywhere. Silence is the defect; this is what lets a
 *  surface break it. Empty code returns [] — "we have not loaded it" is not "it is dropped". */
export const droppedParamNames = (code                           , effective                        )           =>
  !code ? [] : Object.keys(effective).filter(name => !codeDeclaresParam(code, name));

/** Serialize the annotation body (everything after `//` prose, from `[` on) for a
 *  param. Canonical tag order so a round-trip is stable. */
export const buildAnnotation = (p           )         => {
  let s = `[${p.min}:${p.max}]`;
  if (p.kind === "toggle") s += " toggle";
  else if (p.kind === "enum" && p.choices?.length) s += ` choices: ${p.choices.join("|")}`;
  // Blast-radius class (pose wins; it's only ever set when the geometry-invariance
  // guard passed in parseCodeParams, so re-emitting it is safe).
  if (p.pose) s += ` pose:${p.pose}`;
  else if (p.changeClass === "local") s += p.parts?.length ? ` local:${p.parts.join("|")}` : " local";
  else if (p.changeClass === "global") s += " global";
  // t9-build presentation metadata.
  if (p.step != null && Number.isFinite(p.step)) s += ` step:${p.step}`;
  if (p.unit) s += ` unit:${p.unit}`;
  if (p.label) s += ` label:"${p.label}"`;
  if (p.group) s += ` group:"${p.group}"`;
  if (p.locked) s += " lock";
  return s;
};

/** Rewrite a param's annotation from a metadata patch — used by the parameter menu
 *  when a user edits min/max/step/unit/label/group/lock/change-class. Preserves the
 *  `const name = value;` (value is untouched — that's applyCodeParam's job) and any
 *  human prose written between `//` and the `[range]`. Metadata never changes
 *  geometry, so callers don't rebuild; they just persist the new code. */
export const setCodeParamMeta = (code        , name        , patch                    )         => {
  const cur = parseCodeParams(code).find(p => p.name === name);
  if (!cur) return code;
  const merged            = { ...cur, ...patch };
  const body = buildAnnotation(merged);
  // Match: `const name = value; //<prose>[range]<tail to EOL>`. Keep group 1
  // (decl + `//`) and group 2 (prose) verbatim; replace the bracket + tail.
  const re = new RegExp(`(const\\s+${name}\\s*=\\s*-?[\\d.]+\\s*;\\s*//)([^\\[\\n]*)\\[[^\\]]*\\][^\\n]*`);
  return code.replace(re, (_full, head        , prose        ) => {
    const p = prose.trim();
    return `${head}${p ? ` ${p} ` : " "}${body}`;
  });
};
