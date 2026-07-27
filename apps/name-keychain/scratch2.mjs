import Module from 'manifold-3d';

async function run() {
  const wasm = await Module();
  wasm.setup();
  try {
    const cs = new wasm.CrossSection([], 'NonZero');
    console.log("Success");
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
