# `public/labs/` — 研究所 tile artwork

The pictures behind the 研究所 tiles in the navbar's 技术专区 hover menu.

The list itself is **not here and not in `lib/zones/labs.ts`** — it is
[`INSTITUTES` in `lib/org.ts`](../../lib/org.ts), the single source of truth for
the org tree. A 研究所 is the top level and is **composed of 实验室**; the tile
shows the 研究所 name, the 实验室 under it, and its live 版块 count.

(The columns behind it read backwards and are deliberately not renamed:
`Zone.lab` holds the 研究所, `Zone.department` the 实验室. See the header of
`lib/org.ts`.)

## How a tile picks its picture

1. the `image` on that 研究所's entry in `lib/org.ts` — a file in **this** folder;
2. otherwise a cover borrowed from one of that 研究所's 版块;
3. otherwise a generated cover (name-hashed colour + first character).

So this folder is optional: leave it empty and the grid still renders finished-
looking tiles. A file whose name does not match (or is missing) falls back to 3
rather than showing a broken image.

## Filenames the entries expect

Each line in `INSTITUTES` carries its filename as a comment. Drop the file here,
then uncomment that entry's `image`:

| 研究所 (rename freely) | file to drop here | line to uncomment |
| --- | --- | --- |
| 计算视觉研究所 | `vision.jpg` | `image: '/labs/vision.jpg'` |
| 网络技术研究所 | `network.jpg` | `image: '/labs/network.jpg'` |
| 3 号研究所（待填写） | `lab-3.jpg` | `image: '/labs/lab-3.jpg'` |
| 4 号研究所（待填写） | `lab-4.jpg` | `image: '/labs/lab-4.jpg'` |
| 5 号研究所（待填写） | `lab-5.jpg` | `image: '/labs/lab-5.jpg'` |
| 6 号研究所（待填写） | `lab-6.jpg` | `image: '/labs/lab-6.jpg'` |

The names are a convention, not a lookup: nothing scans this folder. The `image`
string in `lib/org.ts` is the only thing that is read, so any filename works as
long as the two agree. `.jpg`, `.png` and `.webp` are all fine — change the
extension in both places.

## What the picture should be

- **Aspect 16:9**, `object-cover` inside a 168 px-wide tile, so ~**640×360** is
  plenty and anything wider is wasted bytes. Keep each file under ~200 KB.
- The 研究所 name and its 实验室 are printed *below* the picture, not on it — pick
  artwork that does not carry its own title text.
- Per the 配色契约 the panel around it is ink and hairlines; the picture is the
  material, so real colour belongs here.

Files are served straight from `/labs/<name>` and are wrapped in
`withBasePath()` at render time, so they keep working under the `/ai-community`
subpath deploy. Nothing here is user-uploaded — these are committed assets.
