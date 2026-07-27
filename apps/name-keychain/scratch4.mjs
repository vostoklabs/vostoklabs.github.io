import https from 'https';
https.get('https://gwfh.mranftl.com/api/fonts/roboto', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
     const j = JSON.parse(data);
     console.log("No subsets query:");
     console.log(j.variants[0].ttf);
  });
});
https.get('https://gwfh.mranftl.com/api/fonts/roboto?subsets=latin,cyrillic', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
     const j = JSON.parse(data);
     console.log("With subsets query:");
     console.log(j.variants[0].ttf);
  });
});
