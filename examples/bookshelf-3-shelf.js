// X = width, Y = depth, Z = height
// Golden: open-back bookshelf — sides run full height, top/bottom/shelves span the
// inner width and butt against the sides' inner faces (no shared volume).
const width = 800; // [400:1600]
const height = 1200; // [600:2000]
const depth = 300; // [200:450]
const thickness = 18; // [12:30]
const shelfCount = 3; // [1:6]

const main = ({ makeBaseBox }) => {
  const innerWidth = width - 2 * thickness;          // safe across ranges: ≥ 340
  const innerHeight = height - 2 * thickness;
  const sideX = width / 2 - thickness / 2;           // side panel centerline

  const leftSide = makeBaseBox(thickness, depth, height).translate(-sideX, 0, 0);
  const rightSide = makeBaseBox(thickness, depth, height).translate(sideX, 0, 0);
  const bottom = makeBaseBox(innerWidth, depth, thickness);
  const top = makeBaseBox(innerWidth, depth, thickness).translateZ(height - thickness);

  const parts = [
    { name: "Left Side", shape: leftSide },
    { name: "Right Side", shape: rightSide },
    { name: "Bottom Panel", shape: bottom },
    { name: "Top Panel", shape: top },
  ];

  // Shelves evenly divide the inner height; each shelf centred on its station.
  const gap = innerHeight / (shelfCount + 1);
  for (let i = 1; i <= shelfCount; i++) {
    const shelfZ = thickness + gap * i - thickness / 2;   // bottom face of shelf
    const shelf = makeBaseBox(innerWidth, depth, thickness).translateZ(shelfZ);
    parts.push({ name: `Shelf ${i}`, shape: shelf });
  }
  return parts;
};
