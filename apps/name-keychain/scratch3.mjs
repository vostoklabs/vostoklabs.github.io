import Module from 'manifold-3d';
import https from 'https';

async function run() {
  const wasm = await Module();
  wasm.setup();
  try {
    const cs = new wasm.CrossSection();
    console.log("Empty CS success. Area:", cs.area());
  } catch (e) {
    console.error("Empty CS Error:", e.message);
  }

  // test api
  https.get('https://gwfh.mranftl.com/api/fonts/roboto', (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
       const j = JSON.parse(data);
       console.log("Available subsets:", j.subsets);
       console.log("Default subsets (variants):", j.variants[0].local);
    });
  });
}
run();
