// X = width, Y = depth, Z = height
// Golden: four-leg side table — legs terminate exactly at the top's bottom face
// (height - topThickness), never inside it.
const topSize = 450; // [300:800]
const topThickness = 25; // [15:40]
const height = 500; // [350:700]
const legSize = 40; // [25:60]
const legInset = 20; // [10:50]

const main = ({ makeBaseBox }) => {
  const legHeight = height - topThickness;             // legs stop at top's underside
  const legCenter = topSize / 2 - legInset - legSize / 2;

  const top = makeBaseBox(topSize, topSize, topThickness).translateZ(legHeight);

  const parts = [{ name: "Top", shape: top }];
  const corners = [
    [legCenter, legCenter], [legCenter, -legCenter],
    [-legCenter, legCenter], [-legCenter, -legCenter],
  ];
  corners.forEach(([x, y], i) => {
    const leg = makeBaseBox(legSize, legSize, legHeight).translate(x, y, 0);
    parts.push({ name: `Leg ${i + 1}`, shape: leg });
  });
  return parts;
};
