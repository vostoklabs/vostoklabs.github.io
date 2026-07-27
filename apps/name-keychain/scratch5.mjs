import https from 'https';
import fs from 'fs';
import opentype from 'opentype.js';

https.get('https://gwfh.mranftl.com/api/fonts/roboto', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
     const j = JSON.parse(data);
     const subsets = j.subsets.join(',');
     const url = `https://gwfh.mranftl.com/api/fonts/roboto?subsets=${subsets}`;
     https.get(url, (res2) => {
        let data2 = '';
        res2.on('data', (c) => data2 += c);
        res2.on('end', () => {
           const j2 = JSON.parse(data2);
           const ttfUrl = j2.variants[0].ttf;
           console.log("TTF URL with all subsets:", ttfUrl);
           https.get(ttfUrl, (res3) => {
             const file = fs.createWriteStream("roboto-test.ttf");
             res3.pipe(file);
             file.on('finish', () => {
               file.close();
               const font = opentype.loadSync("roboto-test.ttf");
               const glyphs = font.stringToGlyphs("Привет");
               console.log("Glyphs length:", glyphs.length);
               for (const g of glyphs) {
                 console.log("Cmds length:", g.getPath(0,0,18).commands.length);
               }
             });
           });
        });
     });
  });
});
