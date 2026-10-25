# Replicad Examples
# Child of Replicad_API_Master.md — verified placement patterns

---

## makeBaseBox placement

X/Y centred at origin, Z sits on Z=0 (not centred).

```js
// post at XY corner offset `o`, full height S:
makeBaseBox(T, T, S).translate(o, o, 0)

// horizontal beam at Z height `z`, centred in Y at offset `o`:
makeBaseBox(S, T, T).translate(0, o, z)
```

---

## Boolean cutter — always overshoot

```js
const overshoot = 10;
panel.cut(makeBaseBox(w + overshoot * 2, d, h).translate(-overshoot, 0, 0));
```

---

## Multiple cuts — fuse cutters first, then cut once

```js
const combined = cutters.reduce((a, b) => a.fuse(b));
panel.cut(combined);
```
