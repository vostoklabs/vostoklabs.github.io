import fs from 'fs';
const wasmPath = 'node_modules/manifold-3d/manifold.js';
const code = fs.readFileSync(wasmPath, 'utf8');
if (code.includes('scaleTop')) {
  console.log('scaleTop found in manifold.js');
} else {
  console.log('scaleTop NOT found in manifold.js');
}
