import fs from 'fs';
let c = fs.readFileSync('src/ui/ui.ts', 'utf8');
c = c.replace(/\\`/g, '`');
c = c.replace(/\\'/g, "'");
fs.writeFileSync('src/ui/ui.ts', c);
console.log('Done replacing');
