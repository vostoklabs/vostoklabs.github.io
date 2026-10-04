// A byte-exact meter for manifold's WASM heap, for the leak tests.
//
// manifold-3d keeps its memory to itself, so `captureHeaps()` patches WebAssembly.instantiate to
// catch every instance's memory as it is made — call it BEFORE the module loads. `heapInUse()`
// then walks dlmalloc's chunks (Emscripten's default allocator; both manifold builds use it) and
// sums the ones in use: what a leak leaves behind, to the byte. The memory's own size is no
// gauge — it grows in 20 % jumps, and a leak of 10 KB a call can hide under one for a thousand.
//
//   import { captureHeaps, heapInUse } from '.../packages/laser/tests/heap-probe.mjs';
//   const heaps = captureHeaps();  …load manifold…;  heapInUse(heaps.at(-1))  // bytes, or NaN

export function captureHeaps() {
  const heaps = [];
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async function (...args) {
    const res = await instantiate.apply(this, args);
    for (const v of Object.values((res.instance ?? res).exports)) if (v instanceof WebAssembly.Memory) heaps.push({ memory: v, state: -1 });
    return res;
  };
  return heaps;
}

/*
  dlmalloc's `_gm_` (wasm32, no locks), in words: 3 topsize, 4 least_addr, 6 top, 108 footprint,
  112 seg.base, 113 seg.size. It sits in static data, below the heap, and is found by what only it
  satisfies: the chunk at `top` heads `topsize | PINUSE`, and the segment starts at least_addr.
*/
function findState(u32, bytes) {
  const words = Math.min(bytes, 8 << 20) >>> 2;
  for (let w = 0; w < words - 120; w++) if (isState(u32, w, bytes)) return w;
  return -1;
}

function isState(u32, w, bytes) {
  const topsize = u32[w + 3];
  const least = u32[w + 4];
  const top = u32[w + 6];
  return top > 0 && least > 0 && top >= least && top + 8 <= bytes && (top & 7) === 0 && topsize > 0
    && u32[w + 112] === least && u32[(top + 4) >>> 2] === (topsize | 1) && u32[w + 108] >= topsize && u32[w + 108] <= bytes;
}

/** Bytes in live chunks, or NaN when the allocator's state cannot be found or walked. */
export function heapInUse(heap) {
  const bytes = heap.memory.buffer.byteLength;
  const u32 = new Uint32Array(heap.memory.buffer);
  if (heap.state < 0 || !isState(u32, heap.state, bytes)) heap.state = findState(u32, bytes);
  if (heap.state < 0) return NaN;
  const w = heap.state;
  const top = u32[w + 6];
  const base = u32[w + 112];
  const end = base + u32[w + 113];
  // The first chunk is the segment's base aligned so its payload (chunk + 8) is; the walk that
  // lands exactly on `top` is the right alignment.
  for (const align of [8, 16]) {
    let p = base + ((align - ((base + 8) % align)) % align);
    let used = 0;
    while (p < end && p !== top) {
      const head = u32[(p + 4) >>> 2];
      const size = head & ~7;
      if (size === 0) break;
      if (head & 2) used += size;
      p += size;
    }
    if (p === top) return used;
  }
  return NaN;
}
