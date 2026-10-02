import { button, el, iconButton, ICONS, dpad, sliderRow, textField, toggleSwitch } from '@vostok/ui-kit';
import { iconByChar } from '@vostok/fonts';
import type { Field, Values } from '../templates/types';
import { insertAsset, legacyAsset, readSymbols, symbolSvg, writeSymbols, type SymbolAsset } from './model';
import { openIconLibrary } from './library';

type TextField = Extract<Field,{kind:'text'}>;
export function symbolTextField(f: TextField, values: Values, change: (key:string,value:string|number|boolean)=>void) {
  let selected: string|null=null, dragging: string|null=null, cursor=String(values[f.key]??'').length;
  const field=textField({label:f.label,value:String(values[f.key]??''),placeholder:f.placeholder,...(f.help?{help:f.help}:{}),onInput:v=>{
    change(f.key,v);cursor=field.field.selectionStart??v.length;paint();
  }});
  if(f.maxLength)field.field.maxLength=f.maxLength;
  const rich=el('div',{className:'ls-rich-text',attrs:{contenteditable:'true',role:'textbox','aria-label':f.label,'aria-multiline':'false',spellcheck:'false'}});
  const inspector=el('details',{className:'ls-symbol-inspector'}) as HTMLDetailsElement;inspector.hidden=true;
  const row=el('div',{className:'ls-text-entry'},[field]);
  field.append(rich);
  const add=button({label:'Add symbol',emphasis:'secondary',title:`Add symbol to ${f.label.toLowerCase()}`,className:'ls-add-symbol',onClick:()=>{
    const start=rich.hidden ? field.field.selectionStart??cursor : cursor;
    const end=rich.hidden ? field.field.selectionEnd??start : start;
    openIconLibrary(asset=>addAsset(asset,start,end),add);
  }});
  row.append(add);
  const node=el('div',{className:'ls-symbol-text-field'},[row,inspector]);
  const value=()=>String(values[f.key]??'');
  function commit(v:string){
    if(f.maxLength && Array.from(v).length>f.maxLength)return false;
    values[f.key]=v;
    const map=readSymbols(values);
    const used=Object.entries(values).filter(([key])=>key!=='__symbols').map(([,value])=>String(value)).join('');
    for(const char of Object.keys(map))if(!used.includes(char))delete map[char];
    writeSymbols(values,map);
    field.setValue(v);change(f.key,v);paint();return true;
  }
  function caret(){
    const sel=window.getSelection();if(!sel?.rangeCount||!rich.contains(sel.anchorNode))return;
    const range=sel.getRangeAt(0).cloneRange();range.selectNodeContents(rich);range.setEnd(sel.anchorNode!,sel.anchorOffset);
    cursor=range.toString().length;
  }
  function addAsset(asset:SymbolAsset,start:number,end:number){
    if(f.maxLength && Array.from(value().slice(0,start)+value().slice(end)).length>=f.maxLength)return;
    const item=insertAsset(values,asset);selected=item.char;commit(value().slice(0,start)+item.char+value().slice(end));
    cursor=start+item.char.length;showInspector();
  }
  function paint(){
    const symbols=readSymbols(values);const has=Array.from(value()).some(c=>!!symbols[c]);
    rich.hidden=!has;field.field.hidden=has;
    if(!has){rich.replaceChildren();inspector.hidden=true;return;}
    rich.replaceChildren();
    for(const char of Array.from(value())){
      const item=symbols[char];if(!item){rich.append(document.createTextNode(char));continue;}
      const token=el('span',{className:'ls-inline-symbol',attrs:{contenteditable:'false',draggable:'true',tabindex:'0',role:'button','aria-label':`Edit ${item.label}`,title:`${item.label} — drag to move, click to edit`}});
      const marker=el('span',{className:'ls-inline-symbol__marker',text:char});
      token.append(marker,symbolSvg(item));token.dataset.char=char;token.classList.toggle('is-selected',selected===char);
      token.addEventListener('click',()=>{selected=char;showInspector();paintSelection();});
      token.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selected=char;showInspector();}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();commit(value().replace(char,''));selected=null;inspector.hidden=true;}});
      token.addEventListener('dragstart',e=>{dragging=char;e.dataTransfer?.setData('text/plain',char);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';});
      token.addEventListener('dragend',()=>{dragging=null;rich.classList.remove('is-dragging');});rich.append(token);
    }
    rich.append(document.createTextNode(''));
  }
  function paintSelection(){for(const token of rich.querySelectorAll<HTMLElement>('.ls-inline-symbol'))token.classList.toggle('is-selected',token.dataset.char===selected);}
  function move(where:'before'|'after'|'both'|'left'|'right'){
    if(!selected)return;
    const map=readSymbols(values), item=map[selected]; if(!item)return;
    let chars=Array.from(value()),i=chars.indexOf(selected);if(i<0)return;
    if(where==='before'||where==='after'||where==='both') {
      chars=chars.filter(c=>c!==selected && !(item.pair && map[c]?.pair===item.pair));
      if(where==='both') {
        if(f.maxLength && chars.length+2>f.maxLength)return;
        const twin=insertAsset(values,item), next=readSymbols(values);
        next[selected]!.pair=selected;next[twin.char]={...item,char:twin.char,pair:selected};writeSymbols(values,next);
        commit(selected+chars.join('')+twin.char);
      } else commit(where==='before'?selected+chars.join(''):chars.join('')+selected);
    } else {
      chars.splice(i,1);chars.splice(Math.max(0,Math.min(chars.length,i+(where==='left'?-1:1))),0,selected);commit(chars.join(''));
    }
    showInspector();
  }

  function showInspector(){
    const symbols=readSymbols(values),item=selected?symbols[selected]:null;if(!item){inspector.hidden=true;return;}
    const patch=(key:'scale'|'dx'|'dy'|'rotation'|'flip',v:number|boolean)=>{
      const map=readSymbols(values),current=map[item.char]!;
      for(const target of Object.values(map))if(target.char===item.char || (current.pair && target.pair===current.pair))Object.assign(target,{[key]:v});
      writeSymbols(values,map);change('__symbols',String(values.__symbols));
    };
    const readout=el('p',{className:'vl-hint ls-symbol-readout'});
    const refresh=()=>{const current=readSymbols(values)[item.char]!;readout.textContent='X '+Math.round(current.dx*100)+'% · Y '+Math.round(current.dy*100)+'% · '+current.rotation+'°';};
    const pad=dpad({compact:true,rotate:true,rotateStep:5,
      onMove:dir=>{const current=readSymbols(values)[item.char]!;const axis=dir==='left'||dir==='right'?'dx':'dy';const delta=dir==='right'||dir==='up'?0.02:-0.02;patch(axis,Math.max(-1,Math.min(1,Math.round((current[axis]+delta)*100)/100)));refresh();},
      onRotate:delta=>{const angle=readSymbols(values)[item.char]!.rotation+delta;patch('rotation',((angle+540)%360)-180);refresh();},
      onReset:()=>{patch('dx',0);patch('dy',0);patch('rotation',0);refresh();},
    });refresh();
    const heading=el('summary',{text:'Symbol: '+item.label});
    inspector.replaceChildren(heading,el('div',{className:'ls-symbol-inspector__body'},[
      sliderRow({label:'Symbol size',value:item.scale*100,min:25,max:200,step:5,unit:'%',onInput:v=>patch('scale',v/100)}),
      el('div',{},[el('p',{className:'vl-label',text:'Symbol position'}),el('div',{className:'ls-symbol-actions'},[
        button({label:'Before',emphasis:'secondary',onClick:()=>move('before')}),
        button({label:'After',emphasis:'secondary',onClick:()=>move('after')}),
        button({label:'Both sides',emphasis:'secondary',onClick:()=>move('both')}),
        el('span',{className:'ls-symbol-reorder'},[iconButton({icon:ICONS.arrowLeft,label:'Move symbol left',onClick:()=>move('left')}),
        iconButton({icon:ICONS.arrowRight,label:'Move symbol right',onClick:()=>move('right')})]),
      ])]),
      // Flip sits with rotation because it is the same question — which way is this thing
      // facing — and a paw or an arrow inserted on the wrong side of a name needs it, not a
      // second copy of the icon.
      el('div',{className:'ls-symbol-transform'},[el('div',{},[el('p',{className:'vl-label',text:'Offset & rotation'}),readout,
        toggleSwitch({label:'Flip',checked:item.flip===true,help:'Mirror the symbol left to right.',onChange:on=>patch('flip',on)})]),pad.root]),
      el('div',{className:'ls-symbol-actions'},[
        button({label:'Replace',emphasis:'secondary',onClick:()=>openIconLibrary(asset=>{const map=readSymbols(values);map[item.char]={...item,...asset};writeSymbols(values,map);change('__symbols',String(values.__symbols));paint();showInspector();})}),
        button({label:'Remove',emphasis:'ghost',onClick:()=>{commit(value().replace(item.char,''));selected=null;inspector.hidden=true;}}),
      ])]));inspector.hidden=false;inspector.open=true;node.closest('.ls-form--right')?.scrollTo({top:0});
  }
  rich.addEventListener('keyup',caret);rich.addEventListener('mouseup',caret);rich.addEventListener('blur',caret);
  rich.addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault();});
  rich.addEventListener('input',()=>{caret();const next=rich.textContent??'';if(f.maxLength&&Array.from(next).length>f.maxLength){paint();return;}field.setValue(next);change(f.key,next);if(!Array.from(next).some(c=>readSymbols(values)[c])){paint();field.field.focus();}if(selected&&!next.includes(selected)){selected=null;inspector.hidden=true;}});
  rich.addEventListener('paste',e=>{e.preventDefault();const text=(e.clipboardData?.getData('text/plain')??'').replace(/[\r\n]/g,' ');const sel=window.getSelection();if(!sel?.rangeCount)return;const range=sel.getRangeAt(0);range.deleteContents();const n=document.createTextNode(text);range.insertNode(n);range.setStartAfter(n);range.collapse(true);sel.removeAllRanges();sel.addRange(range);rich.dispatchEvent(new Event('input'));});
  rich.addEventListener('dragover',e=>{if(dragging){e.preventDefault();rich.classList.add('is-dragging');}});
  rich.addEventListener('drop',e=>{
    if(!dragging)return;e.preventDefault();rich.classList.remove('is-dragging');
    const doc=document as Document & {caretRangeFromPoint(x:number,y:number):Range|null};
    const target=doc.caretRangeFromPoint(e.clientX,e.clientY);let offset=value().length;
    if(target&&rich.contains(target.startContainer)){const r=target.cloneRange();r.selectNodeContents(rich);r.setEnd(target.startContainer,target.startOffset);offset=r.toString().length;}
    const old=value(),from=old.indexOf(dragging);if(from<0)return;
    const stripped=old.slice(0,from)+old.slice(from+dragging.length);if(offset>from)offset-=dragging.length;
    selected=dragging;commit(stripped.slice(0,offset)+dragging+stripped.slice(offset));dragging=null;showInspector();
  });
  // Upgrade legacy font characters into selectable instances when this field is opened.
  async function upgrade(){const initial=value();let text=initial;for(const char of Array.from(text)){if(iconByChar(char)){const item=insertAsset(values,await legacyAsset(char));text=text.replace(char,item.char);}}if(value()===initial && text!==initial)commit(text);}
  paint();void upgrade();
  return {node,set(v:string|number|boolean){field.setValue(String(v));selected=null;inspector.hidden=true;paint();void upgrade();}};
}
