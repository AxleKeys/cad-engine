// X = width, Y = depth, Z = height
// Golden: a slatted bench — the example that shows unsupported_part doing its job.
//
// Two rails run along X on four legs; the slats run across them along Y, one every
// `slatPitch`. At every value in the declared ranges the last slat still lands on the rails
// and the verdict is clean. `railLength` is a plain const on purpose: it is fixed by the
// stock, so it carries no range and `axle explain` lists it as not adjustable. Push
// `slatPitch` PAST its declared maximum — `--param slatPitch=160` — and the slats at the far
// end sit beyond the rails: three or more parts share that level, the rails form its floor,
// and the ones whose footprint misses every rail are reported as unsupported_part.
//
// The check is conservative by design: it only understands bearing from below.
const slatPitch = 100; // [70:120]
const slatCount = 10; // [4:12]
const slatWidth = 60; // [40:65]
const seatDepth = 400; // [300:500]
const seatHeight = 450; // [380:500]
const railLength = 1320;

const main = ({ makeBaseBox }) => {
  const legSize = 50;
  const railHeight = 60;
  const slatThickness = 20;
  const railTop = seatHeight - slatThickness;
  const railY = seatDepth / 2 - legSize / 2;

  const parts = [];
  // makeBaseBox is centred in X and Y and sits ON z=0, so a part is placed by its bottom.
  // Legs at the rail ends, rails on top of them.
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      name: `Leg ${parts.length + 1}`,
      shape: makeBaseBox(legSize, legSize, railTop - railHeight)
        .translate(sx * (railLength / 2 - legSize / 2), sy * railY, 0),
    });
  }
  for (const [i, sy] of [[0, -1], [1, 1]]) {
    parts.push({
      name: `Rail ${i + 1}`,
      shape: makeBaseBox(railLength, legSize, railHeight).translate(0, sy * railY, railTop - railHeight),
    });
  }
  // Slats across the rails, centred on X, one every slatPitch.
  const span = (slatCount - 1) * slatPitch;
  for (let i = 0; i < slatCount; i++) {
    parts.push({
      name: `Slat ${i + 1}`,
      shape: makeBaseBox(slatWidth, seatDepth, slatThickness)
        .translate(-span / 2 + i * slatPitch, 0, railTop),
    });
  }
  return parts;
};
