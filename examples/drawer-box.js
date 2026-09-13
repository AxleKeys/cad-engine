// X = width, Y = depth, Z = height
// Golden: a carcass with one drawer — the example that shows what a --param is FOR.
//
// The drawer is a hollow box that fits the opening minus `clearance` on each side and on
// top. At every value in the declared range the drawer's faces touch or clear the carcass
// and the verdict is clean: shared faces are not a collision. Push clearance BELOW the range
// it declares — `--param clearance=-1` — and the drawer is 2mm wider than its opening, so
// the build reports part_interference against both sides and the top, with the shared mm³
// measured, not guessed. The CLI does not enforce the range; the verdict is what tells you
// why the floor is where it is.
//
// The drawer rests on the carcass bottom (no clearance underneath), so it is supported, and
// `drawerOpen` slides it out of the front so you can see it is one.
const width = 400; // [250:800]
const depth = 350; // [250:600]
const height = 200; // [120:400]
const thickness = 18; // [12:25]
const clearance = 1.5; // [0:4]
const drawerOpen = 120; // [0:200]

const main = ({ makeBaseBox }) => {
  const innerW = width - 2 * thickness;
  const innerH = height - 2 * thickness;
  const drawerW = innerW - 2 * clearance;
  const drawerH = innerH - clearance;          // clearance on top only; it sits on the bottom
  const drawerD = depth - thickness;           // stops at the back panel's front face
  const drawerWall = 12;

  // makeBaseBox is centred in X and Y and sits ON z=0, so a part is placed by its bottom.
  // Carcass: two sides run full height, top and bottom sit between them, back closes it.
  const sideL = makeBaseBox(thickness, depth, height).translate(-width / 2 + thickness / 2, 0, 0);
  const sideR = makeBaseBox(thickness, depth, height).translate(width / 2 - thickness / 2, 0, 0);
  const bottom = makeBaseBox(innerW, depth, thickness);
  const top = makeBaseBox(innerW, depth, thickness).translateZ(height - thickness);
  const back = makeBaseBox(innerW, thickness, innerH).translate(0, depth / 2 - thickness / 2, thickness);

  // Drawer: one solid, hollowed from above, flush with the carcass front.
  const outer = makeBaseBox(drawerW, drawerD, drawerH);
  const cavity = makeBaseBox(drawerW - 2 * drawerWall, drawerD - 2 * drawerWall, drawerH)
    .translateZ(drawerWall);
  const drawer = outer.cut(cavity)
    .translate(0, -thickness / 2 - drawerOpen, thickness);

  return [
    { name: "Side L", shape: sideL },
    { name: "Side R", shape: sideR },
    { name: "Bottom", shape: bottom },
    { name: "Top", shape: top },
    { name: "Back", shape: back },
    { name: "Drawer", shape: drawer },
  ];
};
