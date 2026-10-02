import { mkdirSync, writeFileSync } from 'node:fs';
const root = new URL('../src/symbols/', import.meta.url);
mkdirSync(root, { recursive: true });
const wanted = ['Grinning face','Beaming face with smiling eyes','Face with tears of joy','Smiling face with heart-eyes','Smiling face with sunglasses','Winking face','Thinking face','Face blowing a kiss','Sleeping face','Nerd face','Partying face','Star-struck','Face savoring food','Zany face','Upside-down face','Pleading face','Smiling face with smiling eyes','Grinning cat','Cat face','Dog face','Fox','Bear','Panda','Koala','Tiger face','Lion','Rabbit face','Unicorn','Butterfly','Bee','Owl','Penguin','Frog','Octopus','Dolphin','Turtle','Paw prints','Rose','Sunflower','Christmas tree','Jack-o-lantern','Snowman','Birthday cake','Pizza','Strawberry','Cherries','Rocket','Rainbow','Fire','Sparkles','Crown','Skull','Red heart'];
const get = async url => { const r=await fetch(url); if(!r.ok) throw Error(`${r.status} ${url}`); return r; };
const tree=await (await get('https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1')).json();
const items=[];
for(const name of wanted){
 const entry=tree.tree.find(x=>x.path.startsWith(`assets/${name}/`) && x.path.includes('/High Contrast/') && x.path.endsWith('.svg'));
 if(!entry){console.log('No match:',name);continue;}
 const svg=await (await get('https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/'+entry.path.split('/').map(encodeURIComponent).join('/'))).text();
 items.push({id:'fluent-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),label:name,source:'Fluent Emoji',category: /face|cat|kiss|nerd|partying|star-struck/i.test(name)?'Smileys':'Pictorial',svg});
}
for(const name of ['heart','star','paw','cat','dog','butterfly','flower','moon','sun','bolt','diamond','crown','cherry','clover','christmas-tree','gift','guitar-pick','ball-football','ball-basketball','mickey','ghost','mood-happy','mood-smile','mood-wink','rosette','puzzle','rocket','fish','leaf','flame']){
 const r=await fetch(`https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/filled/${name}.svg`);if(!r.ok)continue;
 items.push({id:'tabler-'+name,label:name.replace(/-/g,' ').replace(/^./,s=>s.toUpperCase()),source:'Tabler Filled',category:'Solid icons',svg:await r.text()});
}
writeFileSync(new URL('catalog.json',root), JSON.stringify(items));
for(const [name,url] of [['Fluent-Emoji','https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE'],['Tabler-Icons','https://raw.githubusercontent.com/tabler/tabler-icons/main/LICENSE']]){
 const license=await (await get(url)).text();
 mkdirSync(new URL('../public/licenses/',import.meta.url),{recursive:true});
 writeFileSync(new URL(`../public/licenses/${name}.txt`,import.meta.url),license);
}
console.log(`Bundled ${items.length} curated SVG icons.`);
