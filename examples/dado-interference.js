// FIXTURE — the CONTROL for dado-joint.js. Byte-for-byte the same cabinet with the same
// shelf tongues, except the grooves are never cut: `groovesIn` returns the panel untouched.
//
// So each shelf end is buried 6mm INSIDE a solid side panel — 6 × 300 × 18 = 32,400 mm³ of
// real shared solid volume per joint, 8 joints. The bounding boxes are IDENTICAL to the
// jointed twin's, which is the whole point: no bounding-box test can tell these two models
// apart, and the old rule said the same confident thing about both.
//
// A run of the fixed rule that is silent here has proven nothing — this leg must come back RED.
//
// Pairs with: scripts/headless/test-interference.mjs

const width = 600;        // [300:1200]
const depth = 300;        // [200:600]
const height = 800;       // [400:1600]
const thickness = 18;     // [12:30]
const dadoDepth = 6;      // [0:12]
const shelfCount = 4;     // [1:8]

const main = (api) => {
  const { makeBox } = api;
  const inner = width - 2 * thickness;
  const shelfLen = inner + 2 * dadoDepth;
  const zOf = (i) => Math.round(((i + 1) * height) / (shelfCount + 1));

  // ⛔ THE ONE DIFFERENCE: no groove is ever cut.
  const groovesIn = (panel) => panel;

  const left = groovesIn(makeBox([0, 0, 0], [thickness, depth, height]));
  const right = groovesIn(makeBox([width - thickness, 0, 0], [width, depth, height]));

  const parts = [
    { name: "Side left", shape: left },
    { name: "Side right", shape: right },
  ];
  for (let i = 0; i < shelfCount; i++) {
    const z = zOf(i);
    parts.push({
      name: `Shelf ${i + 1}`,
      shape: makeBox([thickness - dadoDepth, 0, z], [thickness - dadoDepth + shelfLen, depth, z + thickness]),
    });
  }
  return parts;
};
