import { bboxOf, roundedRectRing, type Shapes } from '@vostok/laser';
import { FONTS } from '@vostok/fonts';
import { textLayer } from '../engine/text';
import { finalHoleCentre } from '../engine/editorGeometry';
import { tileLayers, tileLook } from '../engine/tiles';
import { readSymbols } from '../symbols/model';
import { keyringFields, keyringFrom } from './keyring';
import { stem } from './shared';
import { num, str, bool, type Values, type TemplateDef } from './types';

/** One decimal, no trailing zero. */
const fmt=(n:number)=>Number(n.toFixed(1)).toString();

// Both tile products use cap-height sizing, and leave the numeral its own bottom band. Every
// proportion of the tile itself — corner, weld, the score inset, the optical lift, the value's
// share of the letter — is `tileLook`, shared with family-crossword so the keychain's tile and
// the crossword's are the same object at the same size.
export async function makeTiles(cells: {x:number;y:number;char:string}[], size:number, v:Values) {
  const font=str(v,'font');
  const look=tileLook(size);
  const cap=bboxOf((await textLayer({text:'H',font,size:1},'off')).flatMap(l=>l.shapes));
  const ratio=Math.max(.1,cap.maxY-cap.minY);
  const asked=size*num(v,'letterScale')/ratio;
  let em=asked,kx=1,ky=1;
  for(const c of cells) {
    const b=bboxOf((await textLayer({text:c.char,font,size:em,symbols:readSymbols(v)},'off')).flatMap(l=>l.shapes));
    const mx=Math.min(1,size*.72/Math.max(.01,b.maxX-b.minX)),my=Math.min(1,size*.58/Math.max(.01,b.maxY-b.minY));
    kx*=mx;ky*=my;em*=mx*my;
  }
  // The numeral is sized from the tile and the letter-size knob, never from what the width fit
  // did to a particular name: every tile of a given size carries the same numeral, the way a
  // real set does, and one wide glyph cannot take the values off the whole bar.
  const edge=str(v,'edgeOp');
  const result=await tileLayers(cells,{size,corner:look.corner,letterSize:em,font,values:bool(v,'values'),valueSize:look.valueRatio*asked,valueMinSize:look.valueFloor/ratio,valueInset:look.valueInset,letterDy:look.letterDy,border:edge==='off'?0:look.inset,weld:look.weld,boldness:num(v,'letterBold'),symbols:readSymbols(v)}, {letter:str(v,'letterOp')==='score'?'score':'engrave',border:edge==='engrave'?'engrave':'score'});
  // How hard the widest glyph squeezed the whole name, the cap it ended at, and which way it
  // was squeezed: a wide FACE binds every tile at once (a font decision), a tall ask binds
  // against the tile itself (a size decision). Only we can see either one happen.
  return {...result,bind:1-em/Math.max(asked,1e-6),wide:kx<=ky,letterCap:em*ratio};
}
export const tileKeychain:TemplateDef={
 id:'tile-keychain',name:'Letter tile keychain',blurb:'A name in word-game letter tiles, welded into one bar — values in the corners.',tags:['keychain','engrave + score + cut'],
 batch:{key:'text',noun:'keychain'},
 fields:[
 {kind:'text',key:'text',label:'Name',value:'JUDE',panel:'right',section:'Text',maxLength:12,placeholder:'A name',
  help:'Letters and digits get a tile, spaces a blank, rest dropped.'},
 // Slabs and sturdy serifs, narrowest capitals first: a tile letter is a small squarish block of
 // ink with no hairlines, and every face here was built as JUDE at 18 mm before it was listed.
 {kind:'font',key:'font',label:'Font',value:'bree-serif',panel:'right',section:'Font',
  recommended:['bree-serif','arvo','roboto-slab','bitter','zilla-slab','sanchez','domine','pt-serif']},
 {kind:'number',key:'tile',label:'Tile size',value:18,min:10,max:26,step:.5,unit:'mm',section:'Tiles',
  help:'Real tiles are 19 to 20 mm, keychains suit 15 to 18.'},
 {kind:'toggle',key:'values',label:'Letter values',value:true,section:'Tiles',
  help:'The small corner number, hidden automatically under about 17 mm tiles.'},
 {kind:'toggle',key:'shrink',label:'Shrink long names',value:true,section:'Tiles',
  help:'Longer names get smaller tiles, so the bar stays a sensible length.'},
 {kind:'select',key:'flow',label:'Layout',value:'row',section:'Tiles',options:[{value:'row',label:'Across'},{value:'column',label:'Down'}],
  help:'The keyring moves to the top in Down, unless you dragged it.'},
 {kind:'select',key:'edgeOp',label:'Tile edges',value:'score',section:'Tiles',options:[{value:'score',label:'Score'},{value:'engrave',label:'Engrave'},{value:'off',label:'Off'}],
  help:'If your software treats blue as a cut, use Engrave instead.'},
 {kind:'number',key:'spacing',label:'Tile spacing',value:0,min:0,max:1.5,step:.1,unit:'mm',section:'Tiles',advanced:true,
  help:'Air between tiles, past 1 mm they read as a chain, still one piece.'},
 {kind:'number',key:'letterScale',label:'Letter size',value:.5,min:.35,max:.65,step:.01,section:'Lettering',format:v=>Math.round(v*100)+'% of tile'},
 {kind:'select',key:'letterOp',label:'Letters',value:'engrave',section:'Lettering',options:[{value:'engrave',label:'Engrave'},{value:'score',label:'Score'}],
  help:'No cut option, it would drop letter middles and sever the tile.'},
 {kind:'number',key:'letterBold',label:'Boldness',value:0,min:-.2,max:.6,step:.05,unit:'mm',section:'Lettering',advanced:true,
  help:'Grows or shrinks the engraved strokes without changing letter size.'},
 ...keyringFields('outside',{dia:5,ring:3})],
 async build(v){
  const syms=readSymbols(v);
  // A letter, a digit, a space or an inline symbol gets a tile; everything else is dropped by
  // name. Any Unicode letter counts — É is a letter on a tile, it just carries no value.
  const keeps=(c:string)=>/[\p{L}\p{N} ]/u.test(c)||!!syms[c];
  const typed=Array.from(str(v,'text').trim().toUpperCase().replace(/\s+/g,' '));
  const dropped=[...new Set(typed.filter(c=>!keeps(c)))];
  const kept=typed.filter(keeps);
  // An empty name is one blank tile, never an empty file: a blank is a real piece of the set and
  // a better first thing to see than nothing to cut.
  const chars=(kept.length?kept:[' ']).slice(0,12);
  const spacing=num(v,'spacing');
  const size=Math.max(10,Math.min(num(v,'tile'),bool(v,'shrink')?(130-spacing*Math.max(0,chars.length-1))/Math.max(1,chars.length):26));
  const look=tileLook(size);
  const vertical=str(v,'flow')==='column';
  const pitch=size+spacing;
  const cells=chars.map((char,i)=>({char,x:vertical?0:(i-(chars.length-1)/2)*pitch,y:vertical?((chars.length-1)/2-i)*pitch:0}));
  const t=await makeTiles(cells,size,v);
  const shapes:Shapes=[...t.blank];
  // A broad continuous spine welds separated tiles without a fragile hairline bridge.
  if(cells.length>1&&spacing>0){const length=(chars.length-1)*pitch;shapes.push([roundedRectRing(vertical?size*.65:length,vertical?length:size*.65,0)]);}
  // Half the bar along the row, and half across it.
  const along=(chars.length-1)*pitch/2+size/2+look.weld;
  const across=size/2+look.weld;
  const keyring=keyringFrom(v);
  // Hardware is hardware, but at the slider's floor a Ø11 lug on a 10 mm tile reads as a blob
  // with tiles stuck to it instead of one object, so the ring comes down with the tile.
  if(size<14){keyring.dia=Math.min(keyring.dia,size*.4);keyring.ring=Math.min(keyring.ring,size*.2);}
  if(keyring.enabled&&keyring.mode==='outside'&&keyring.position<0){
   // The lug rests off the END of the bar — the top of a column, not its middle — and bites in
   // deep enough to weld but no deeper than the end tile's scored border, which is the nearest
   // ink there is and what the engine's ring-on-the-lettering check sees.
   const reach=keyring.dia/2+keyring.ring-Math.max(.4,look.inset+look.weld-.3);
   keyring.rest=vertical?[0,along+reach]:[-along-reach,0];
  }
  const warnings:string[]=[];
  if(!kept.length)warnings.push('Type a name — every letter becomes its own tile.');
  if(keyring.enabled&&keyring.mode==='inside'){
   // Where the hole actually lands, against the letters — the bar is a rounded rectangle, so an
   // approximate body is exact enough to say whether a letter is under it. A dragged hole on a
   // blank tile is fine, and then nothing is said.
   const body:Shapes=[[roundedRectRing((vertical?across:along)*2,(vertical?along:across)*2,look.corner+look.weld)]];
   const{centre}=finalHoleCentre(body,keyring);
   const r=keyring.dia/2+keyring.ring;
   if(cells.some(c=>c.char.trim()!==''&&Math.abs(centre[0]-c.x)<r+size*.3&&Math.abs(centre[1]-c.y)<r+size*.3))
    warnings.push('A hole through a tile cuts into its letter at this size — use the loop tab, or drag it onto a blank tile.');
  }
  const bar=along*2;
  if(bar>140)warnings.push(`This bar is ${fmt(bar)} mm long — turn on Shrink long names, or pick a smaller tile.`);
  if(t.bind>.12)warnings.push(t.wide
   ?`This font’s letters are wide — they have shrunk to ${fmt(t.letterCap)} mm. A narrower face keeps them bigger.`
   :`Letter size is more than the tile can hold — the letters have shrunk to ${fmt(t.letterCap)} mm. A bigger tile fits more.`);
  for(const c of dropped)warnings.push(`Dropped “${c}” — a tile carries a letter, a digit or a space.`);
  if(kept.length>12)warnings.push('Only the first 12 characters are used.');
  if(bool(v,'values')&&t.valuesDropped)warnings.push(`Corner values are hidden — on a ${fmt(size)} mm tile the numeral would engrave under ${fmt(look.valueFloor)} mm. A bigger tile, or bigger letters, brings them back.`);
  const face=FONTS.find(f=>f.id===str(v,'font'));
  if(face&&(face.category==='Script'||face.category==='Handwriting'))warnings.push('Script faces do not read as letter tiles — a slab or a clean sans does.');
  // `hug` with margin 0 is a morphological close: it leaves every convex edge alone and replaces
  // the sharp V where two welded tiles meet with a fillet — the seam still reads as two tiles,
  // with no crack starter in a piece that lives in a pocket.
  return {blank:{kind:'hug',margin:0,smoothing:look.seamFillet+.6*spacing},bodyMembers:['tiles'],
   layers:[{owner:'tiles',id:'tiles',label:'Tiles',shapes,op:'off',hugOnly:true},...t.layers],keyring,warnings};
 },fileName:v=>stem(str(v,'text'),'letter-tiles')
};
