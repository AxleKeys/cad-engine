// FIXTURE — a textbook dado joint. The shelf's tongue sits INSIDE a groove cut out of the
// side panel: the two parts share FACES on five sides and share NO volume at all.
//
// This is the case the old bounding-box rule got confidently wrong (t4-overlap-truth):
//   · the shelf's box penetrates the side panel's box by 6 × 300 × 18 mm
//   · the side panel still fills ~97.6% of its own box (four 6mm dados out of a
//     600×300×18 panel is ~2.4% of the volume), clearing the old TIGHT_BOX_FILL = 0.95 bar
//   → so the rule asserted its most confident wording: "parts must share faces, never volume".
//
// Its twin, dado-interference.js, is the SAME model with the grooves left uncut, so the
// shelves really are buried in the sides. The only variable between them is the notch.
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
  const shelfLen = inner + 2 * dadoDepth;          // the tongues that live in the grooves
  const zOf = (i) => Math.round(((i + 1) * height) / (shelfCount + 1));

  const groovesIn = (panel, xMin, xMax) => {
    let out = panel;
    for (let i = 0; i < shelfCount; i++) {
      const z = zOf(i);
      out = out.cut(makeBox([xMin, -1, z], [xMax, depth + 1, z + thickness]));
    }
    return out;
  };

  // Left side: 0 → thickness in X. Its groove is cut from the inner face inward.
  const left = groovesIn(
    makeBox([0, 0, 0], [thickness, depth, height]),
    thickness - dadoDepth, thickness,
  );
  // Right side: width - thickness → width in X.
  const right = groovesIn(
    makeBox([width - thickness, 0, 0], [width, depth, height]),
    width - thickness, width - thickness + dadoDepth,
  );

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
