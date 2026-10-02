# Shape assets

Drop a silhouette in here and list it in `manifest.json`; it appears in all three shape
pickers (hook, link, charm) the next time the app loads. `shield.svg` is a worked example of
the file format — it is **not** listed in the manifest, so it does not ship. To use it, or
your own, add a line:

```json
[
  { "id": "shield", "name": "Shield", "file": "shield.svg" }
]
```

## One file, one closed outline, three optional markers

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120">
  <path   id="outline" d="…"/>                 <!-- the silhouette: one closed path -->
  <line   id="gate" x1 y1 x2 y2/>              <!-- where the hook's gate opens -->
  <circle id="eye" cx cy r/>                   <!-- where a charm hangs FROM this hook -->
  <circle id="top" cx cy r/>                   <!-- where this shape hangs from, as a charm -->
</svg>
```

- **Author it upright**, the way it hangs. Any size — the outline is normalised, and the
  size slider does the rest.
- **Markers are snapped to the nearest point on the outline**, so put them near the edge, not
  exactly on it. Missing markers fall back to: gate on the left side at mid-height (on the
  straightest run there), eye at the bottom, top at the top.
- Put the **gate on a straight or convex run**, never in a concave valley: the cut starts
  slightly outside the edge, and in a valley that clips the neighbouring lobe.
- Keep it **flat**: no transforms, no groups, no strokes, one path. If there are several
  paths, the largest one is taken as the outline. Curves (`C S Q T A`) are fine.
- `id` in the manifest is stored in saved projects and share links — never rename one.
