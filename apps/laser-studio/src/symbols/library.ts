import { ICONS, POPULAR, SYMBOL_GROUPS, searchGroup } from '@vostok/fonts';
import { button, dialog, el, openSvgImport, svgImportDefaults, textField, toast, uploadCta, type SvgImportChoice, type SvgImportPart } from '@vostok/ui-kit';
import { describeSvg, parseSvg } from '@vostok/laser/trace';
import type { Shapes } from '@vostok/laser';
import catalog from './catalog.json';
import { legacyAsset, normalize, shapePath, symbolSvg, type SymbolAsset } from './model';

const cache = new Map<string, SymbolAsset>();
const storageKey = 'laser-studio-my-icons';
function saved(): SymbolAsset[] { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } }
function trace(text: string, overrides?: NonNullable<Parameters<typeof parseSvg>[1]>['overrides']): Shapes {
  return traced(text, overrides).shapes;
}
/** …and the same trace with what the file says its real size is (a cut file has one). */
function traced(text: string, overrides?: NonNullable<Parameters<typeof parseSvg>[1]>['overrides']): { shapes: Shapes; mm?: number } {
  const regions = parseSvg(text.replace(/currentColor/gi, '#000000'), { removeBg: false, ...(overrides ? { overrides } : {}) });
  const shapes = normalize(regions.regions.flatMap(r=>r.components.map(c=>c.rings)) as Shapes);
  return { shapes, ...(regions.mm ? { mm: regions.mm } : {}) };
}
async function assetFor(id: string): Promise<SymbolAsset> {
  const existing = cache.get(id) ?? saved().find(a=>a.id===id); if(existing)return existing;
  const item=catalog.find(a=>a.id===id);
  const asset=item ? { id, label:item.label, source:item.source, shapes:trace(item.svg) } : await legacyAsset(ICONS.find(i=>i.id===id)!.char);
  cache.set(id,asset);return asset;
}
/**
 * One uploaded SVG → a traced asset, through the import window.
 *
 * The window is not optional politeness: an SVG with a white backdrop traces as a solid block
 * over the whole drawing, and without it the only symptom is artwork that comes out wrong with
 * nothing on screen to explain it. Answers null when the customer backs out of it; throws with
 * a plain sentence on a file we cannot use, which the caller toasts.
 *
 * `before` runs once the file has parsed and just before the window opens — the icon library
 * passes its own `close`, so the wall of icons is gone behind the window rather than under it.
 *
 * Lifted out of the library's own upload button when the `svg` field wanted the same flow
 * WITHOUT the library in front of it: a design whose artwork is the customer's own file has no
 * use for a grid of paw prints first (Ian, 2026-09-22).
 */
export interface SvgTrace {
  asset: SymbolAsset;
  /** The file itself, kept so a later window can trace it AGAIN with different choices. */
  svgText: string;
  /** The choice per part, as `svgImportDefaults` made it — what a picker starts its rows on. */
  choices: Record<number, SvgImportChoice>;
  parts: SvgImportPart[];
  issues: string[];
  /** The longest side the FILE says it is, mm. A cut file states one and must not be rescaled;
   *  clip art states none and keeps the design's own default. */
  mm?: number;
}

/**
 * An uploaded SVG traced with NO window in front of it, on the choices the import window would
 * have opened with. Everything the caller needs to re-ask the question later comes back with
 * it, so "no window" is not "no way to fix it" — it is "fix it where you can see what it did"
 * (Ian, 2026-09-22: "drop the svg wizard on upload").
 */
export async function traceSvgFile(file: File): Promise<SvgTrace> {
  if (file.size > 2_000_000) throw Error('Choose an SVG smaller than 2 MB.');
  const svgText = (await file.text()).replace(/currentColor/gi, '#000000');
  const { parts, issues } = describeSvg(svgText);
  const choices = svgImportDefaults(parts);
  const { shapes, mm } = traced(svgText, choices);
  if (!shapes.length) throw Error('There is nothing to cut in this file.');
  return { asset: assetOf(file.name, shapes), svgText, choices, parts, issues, ...(mm ? { mm } : {}) };
}

/** The same file traced again on new choices — the picker's own re-trace. Empty when the
 *  choices leave nothing drawable, which the caller shows rather than throwing over. */
export function retraceSvg(svgText: string, choices: Record<number, SvgImportChoice>): Shapes {
  return trace(svgText, choices);
}

/** What is in a file we already hold, for a picker that lists its parts. The colour is dropped:
 *  a cut file is one colour, so a swatch per part would be a control over nothing. */
export function svgParts(svgText: string): { parts: SvgImportPart[]; issues: string[] } {
  const { parts, issues } = describeSvg(svgText);
  return { parts: parts.map(({ hex, ...p }) => p), issues };
}

/** Named after the file, remembered under "My icons". */
function assetOf(fileName: string, shapes: Shapes): SymbolAsset {
  const asset: SymbolAsset = { id: crypto.randomUUID(), label: fileName.replace(/\.svg$/i, ''), source: 'My icons', shapes };
  try { localStorage.setItem(storageKey, JSON.stringify([asset, ...saved()].slice(0, 40))); }
  catch { toast('Icon added. Browser storage is full; save the project to keep it.', { kind: 'warn' }); }
  return asset;
}

export async function importSvgFile(file: File, before?: () => void): Promise<SymbolAsset | null> {
  if (file.size > 2_000_000) throw Error('Choose an SVG smaller than 2 MB.');
  const text = (await file.text()).replace(/currentColor/gi, '#000000');
  const { parts, issues } = describeSvg(text);
  before?.();
  const choices = await openSvgImport({
    svgText: text, name: file.name, parts: parts.map(({ hex, ...p }) => p), issues, thinAt: 'symbol size',
    trace: (c) => {
      const shapes = trace(text, c);
      return shapes.length ? { viewBox: '-0.6 -0.6 1.2 1.2', paths: [{ d: shapePath(shapes), fill: 'currentColor' }], summary: 'Single-colour icon. Adjust the parts before adding it.' } : null;
    },
  });
  if (!choices) return null;
  const shapes = trace(text, choices);
  if (!shapes.length) throw Error('No visible shapes selected.');
  return assetOf(file.name, shapes);
}

export function openIconLibrary(onPick: (asset: SymbolAsset)=>void, anchor?: HTMLElement) {
  let category='popular', query='', generation=0;
  const grid=el('div',{className:'ls-icon-grid',attrs:{'aria-label':'Symbols',role:'group'}});
  const count=el('p',{className:'vl-hint',attrs:{'aria-live':'polite'}});
  const nav=el('nav',{className:'ls-icon-categories',attrs:{'aria-label':'Symbol categories'}});
  const search=textField({label:'Search symbols',placeholder:'Try paw, smile, heart…',value:'',onInput:q=>{query=q;void paint();}});
  const categories=[['popular','Popular'],['smileys','Smileys'],['pictorial','Animals & things'],['solid','Solid icons'],['mine','My icons'],['all','All symbols'],...SYMBOL_GROUPS.filter(g=>!['popular','smileys','all'].includes(g.id)).map(g=>[g.id,g.label])];
  const buttons=categories.map(([id,label])=>{
    const b=button({label:label!,emphasis:'ghost',onClick:()=>{category=id!;query='';search.setValue('');void paint();}});nav.append(b);return {id,b};
  });
  const upload=uploadCta({label:'Import your own SVG',accept:'.svg,image/svg+xml',onFiles:async ([file])=>{
    if(!file)return;
    try{const asset=await importSvgFile(file,()=>handle.close());if(asset)onPick(asset);}
    catch(err){toast(`Could not import SVG: ${(err as Error).message}`,{kind:'error'});}
  }});
  const content=el('div',{className:'ls-icon-library'},[
    el('div',{className:'ls-icon-library__search'},[search,upload]),
    el('div',{className:'ls-icon-library__body'},[nav,el('div',{className:'ls-icon-results'},[count,grid])]),
  ]);
  let cleanup=()=>{};
  const handle=dialog({title:'Symbols & icons',content,size:'wide',actions:[{label:'Cancel'}],onClose:()=>cleanup()});
  if(anchor && window.innerWidth>760){
    handle.root.classList.add('ls-icon-dropdown');
    const box=handle.root.querySelector<HTMLElement>('[role="dialog"]')!;
    box.setAttribute('aria-modal','false');
    const position=()=>{const r=anchor.getBoundingClientRect();box.style.width=Math.min(640,innerWidth-24)+'px';const h=box.getBoundingClientRect().height;box.style.left=Math.max(12,Math.min(r.right-640,innerWidth-652))+'px';box.style.top=Math.max(12,Math.min(r.bottom+8,innerHeight-h-12))+'px';};
    position();
    const outside=(e:PointerEvent)=>{if(!box.contains(e.target as Node)&&!anchor.contains(e.target as Node))handle.close();};
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',position);
    cleanup=()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',position);};
  }
  search.field.focus();
  async function paint(){
    const mine=++generation;for(const {id,b} of buttons)b.setAttribute('aria-pressed',String(id===category));
    const q=query.trim().toLowerCase();
    let list: {id:string;label:string;source:string}[];
    if(q)list=[...[...catalog,...saved()].filter(a=>`${a.label} ${a.id} ${a.source}`.toLowerCase().includes(q)),...searchGroup(q,'all').map(a=>({...a,source:'Material Symbols'}))];
    else if(category==='mine')list=saved();
    else if(category==='smileys')list=catalog.filter(a=>a.category==='Smileys');
    else if(category==='pictorial')list=catalog.filter(a=>a.category==='Pictorial');
    else if(category==='solid')list=catalog.filter(a=>a.source==='Tabler Filled');
    else if(category==='popular')list=[...catalog.filter(a=>['tabler-heart','tabler-star','tabler-paw','fluent-grinning-face','fluent-smiling-face-with-heart-eyes','fluent-dog-face','fluent-cat-face','tabler-butterfly','tabler-flower','tabler-moon','tabler-rocket','tabler-crown'].includes(a.id)),...POPULAR.slice(0,24).map(a=>({...a,source:'Material Symbols'}))];
    else if(category==='all')list=[...catalog,...ICONS.map(a=>({...a,source:'Material Symbols'}))];
    else list=searchGroup('',category).map(a=>({...a,source:'Material Symbols'}));
    grid.replaceChildren();count.textContent=list.length?`${list.length} symbols${list.length>120?' · showing first 120, search to narrow':''}`:'No symbols found. Try another name or import an SVG.';
    for(const item of list.slice(0,120)){
      const b=button({label:'',emphasis:'ghost',title:`${item.label} · ${item.source}`,onClick:async()=>{
        try{const a=await assetFor(item.id);handle.close();onPick(a);}catch{toast('Could not load this symbol.',{kind:'error'});}
      }});b.setAttribute('aria-label',item.label);b.classList.add('ls-icon-tile');grid.append(b);
      try{const a=await assetFor(item.id);if(mine!==generation)return;b.append(symbolSvg(a));}catch{b.remove();}
    }
  }
  void paint();
}
