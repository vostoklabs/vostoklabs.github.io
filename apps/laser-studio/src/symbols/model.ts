import { bboxOf, buildSymbol, cancelCoincidentRings, centreShapes, type Shapes } from '@vostok/laser';
import { iconByChar } from '@vostok/fonts';
import type { Values } from '../templates/types';

export interface SymbolAsset { id: string; label: string; shapes: Shapes; source: string }
/** `flip` mirrors the symbol in X — an arrow, a paw or a leaf that has to point the other way.
 *  Optional so every project file saved before it existed still loads. */
export interface InlineSymbol extends SymbolAsset {
  char: string; pair?: string; scale: number; dx: number; dy: number; rotation: number; flip?: boolean;
  /** The FILE this was traced from, and the choice that was made per part of it. Kept so a
   *  picker can trace it again on different choices — which is what replaced the import window
   *  in front of the upload. Absent on a library icon and on anything saved before 2026-09-22;
   *  a picker with no file to re-read simply does not offer the rows. */
  svgText?: string;
  svgChoices?: Record<number, { mode: string }>;
}
export type SymbolMap = Record<string, InlineSymbol>;
export const SYMBOL_KEY = '__symbols';
let cachedRaw = '';
let cachedSymbols: SymbolMap = {};
export function readSymbols(values: Values): SymbolMap {
  const raw = String(values[SYMBOL_KEY] || '{}');
  if (raw === cachedRaw) return cachedSymbols;
  const result: SymbolMap = {};
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [char, candidate] of Object.entries(data)) {
        const item = candidate as InlineSymbol;
        if (Array.from(char).length !== 1 || (char.codePointAt(0) ?? 0) < 0xf0000 || !item) continue;
        if (typeof item.label !== 'string' || typeof item.id !== 'string' || !Array.isArray(item.shapes)) continue;
        // The source file rides along when there is one; anything else claiming to be one is
        // dropped rather than trusted, the same way the rings are checked below.
        if (item.svgText !== undefined && typeof item.svgText !== 'string') continue;
        if (![item.scale,item.dx,item.dy,item.rotation].every(Number.isFinite)) continue;
        const valid = item.shapes.every(island => Array.isArray(island) && island.every(ring =>
          Array.isArray(ring) && ring.length >= 3 && ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))));
        if (valid) result[char] = { ...item, char };
      }
    }
  } catch { /* A malformed icon map must not crash the editor. */ }
  cachedRaw = raw; cachedSymbols = result;
  return result;
}
export function writeSymbols(values: Values, symbols: SymbolMap) {
  cachedRaw = JSON.stringify(symbols); cachedSymbols = symbols; values[SYMBOL_KEY] = cachedRaw;
}
export function insertAsset(values: Values, asset: SymbolAsset, extra: Partial<InlineSymbol> = {}): InlineSymbol {
  const symbols = readSymbols(values);
  let code = 0xf0000;
  while (symbols[String.fromCodePoint(code)]) code++;
  const char = String.fromCodePoint(code);
  const item = { ...asset, ...extra, char, scale: 1, dx: 0, dy: 0, rotation: 0 };
  symbols[char] = item; writeSymbols(values, symbols); return item;
}

/** Change a symbol the project already holds — the area picker re-tracing the file it was made
 *  from. In place, under the SAME character, so every field pointing at it follows along
 *  instead of being left on an orphan. */
export function updateSymbol(values: Values, char: string, patch: Partial<InlineSymbol>): void {
  const symbols = readSymbols(values);
  const item = symbols[char];
  if (!item) return;
  symbols[char] = { ...item, ...patch, char };
  writeSymbols(values, symbols);
}
export async function legacyAsset(char: string): Promise<SymbolAsset> {
  const icon = iconByChar(char);
  return { id: icon?.id ?? char, label: icon?.label ?? 'Symbol', source: 'Material Symbols', shapes: normalize(await buildSymbol(char, 1)) };
}
/** SVG tracing groups by colour, not connected island. Recover even-odd nesting
 * before sending rings to the solid geometry engine. Also repairs saved icons.
 *
 * The coincident-contour rule this used to keep to itself now lives in `@vostok/laser`'s
 * `cancelCoincidentRings`, so `buildSymbol` and `buildText` get it too: the same font glyphs
 * that broke a traced smiley here broke a picked one there, and `packages/laser` cannot import
 * from the app. */
export function symbolIslands(shapes: Shapes): Shapes {
  const rings = cancelCoincidentRings(shapes.flat().filter(r => r.length >= 3));
  const area = rings.map(r => Math.abs(r.reduce((a,p,i) => { const q=r[(i+1)%r.length]!;return a+p[0]*q[1]-q[0]*p[1]; },0)));
  const inside = ([x,y]: number[], r: number[][]) => {
    let hit=false;
    for(let i=0,j=r.length-1;i<r.length;j=i++) {
      const a=r[i]!,b=r[j]!;
      const cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
      if(Math.abs(cross)<1e-8 && x>=Math.min(a[0],b[0])-1e-8 && x<=Math.max(a[0],b[0])+1e-8 && y>=Math.min(a[1],b[1])-1e-8 && y<=Math.max(a[1],b[1])+1e-8)return true;
      if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }
    return hit;
  };
  const parents=rings.map((r,i)=>{
    let parent=-1;
    rings.forEach((candidate,j)=>{if(area[j]!>area[i]! && (parent<0||area[j]!<area[parent]!) && r.every(p=>inside(p,candidate)))parent=j;});
    return parent;
  });
  const depth=(i:number):number=>parents[i]!<0?0:1+depth(parents[i]!);
  const islands:Shapes=[];
  rings.forEach((r,i)=>{if(depth(i)%2===0)islands.push([r,...rings.filter((_,j)=>parents[j]===i)]);});
  return islands;
}
export function normalize(shapes: Shapes): Shapes {
  const b = bboxOf(shapes); const size = Math.max(b.maxX-b.minX,b.maxY-b.minY,0.001);
  return centreShapes(symbolIslands(shapes)).shapes.map(island=>island.map(r=>r.map(([x,y])=>[x/size,y/size])));
}
export function shapePath(shapes: Shapes, flip = true): string {
  return shapes.flat().map(r=>r.length ? `M${r.map(([x,y])=>`${x},${flip?-y:y}`).join('L')}Z` : '').join('');
}
export function symbolSvg(asset: SymbolAsset): SVGSVGElement {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','-0.6 -0.6 1.2 1.2'); svg.setAttribute('aria-hidden','true');
  const p=document.createElementNS(svg.namespaceURI,'path');
  p.setAttribute('d',shapePath(asset.shapes));p.setAttribute('fill','currentColor');p.setAttribute('fill-rule','evenodd');svg.append(p);return svg;
}
/** Override only our private token glyphs; normal letters retain the existing kerning/layout. */
export function withSymbols(font: any, symbols: SymbolMap): any {
  if (!Object.keys(symbols).length) return font;
  const wrapped = Object.create(font);
  wrapped.charToGlyph = (char: string) => {
    const item = symbols[char]; if (!item) return font.charToGlyph(char);
    const b=bboxOf(item.shapes); const width=(b.maxX-b.minX)*item.scale;
    const angle=item.rotation*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
    // Mirrored BEFORE it is turned, so "Flip" reads as the symbol facing the other way rather
    // than as the rotation running backwards. Ring winding flips with it and nothing downstream
    // minds: `symbolIslands` re-nests these rings by containment, not by direction.
    const mx=item.flip?-1:1;
    return { index: char.codePointAt(0), advanceWidth: (width+0.12)*font.unitsPerEm,
      getPath(x: number, y: number, size: number) {
        const commands: any[]=[];
        for (const ring of item.shapes.flat()) {
          ring.forEach(([rx,py],i)=>{const px=rx*mx;const xx=(px*c-py*s)*item.scale+width/2+item.dx;const yy=(px*s+py*c)*item.scale+0.38+item.dy;
            commands.push({type:i?'L':'M',x:x+xx*size,y:y-yy*size});});commands.push({type:'Z'});
        }
        return {commands};
      },
    };
  };
  wrapped.getKerningValue = (a: any,b: any) => a.index>=0xf0000 || b.index>=0xf0000 ? 0 : font.getKerningValue(a,b);
  return wrapped;
}
