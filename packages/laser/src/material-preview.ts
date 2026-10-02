/** Lightweight material preview shared by laser tools. Actual cut geometry is supplied by callers. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Shapes } from './types';

export interface PreviewObject { id: string; op: string; shapes: Shapes; paths?: [number, number][][] }

/**
 * One piece of an assembled product, where it sits once put together.
 *
 * `plate` and `objects` are in the piece's OWN frame — the centre of its outline's box at the
 * origin, lying flat. `pose` places its centre (mm, Z up, the table at z = 0; `z` is the middle
 * of its thickness) and turns it about that centre, in degrees, about the WORLD axes, X first,
 * then Y, then Z. So `rx: 90` stands a plate up; `rx: 90, rz: 90` stands it up and turns it to
 * run front-to-back. `hex` is this piece's face colour — a darker backer, a kraft card.
 *
 * `thickness` is how thick THIS piece is, when it is not cut from the sheet the render was
 * given: a bracelet set's holder is 0.6 mm kraft card, not 3 mm plywood, and extruding it
 * through the sheet's thickness is what made it read as another sheet of ply. Absent, the
 * piece is the sheet's own thickness, exactly as before.
 */
export interface PreviewPiece {
  plate: Shapes;
  objects: PreviewObject[];
  pose: { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number };
  hex?: string;
  thickness?: number;
}

export interface PreviewSolid {
  plate: Shapes;
  objects: PreviewObject[];
  /** Given, the scene is these pieces where they sit ASSEMBLED — a stack by thickness, a stand
   *  with its plate leaning and its feet standing — instead of the flat sheet. */
  pieces?: PreviewPiece[];
}

const FACE = '#c6a676';
const EDGE = '#70502f';
const BURN = '#50321c';
const rad = (deg: number) => (deg * Math.PI) / 180;

function toShapes(islands:Shapes): THREE.Shape[] {
  return islands.filter(i=>i[0]?.length>=3).map(island=>{
    const shape=new THREE.Shape(island[0].map(([x,y])=>new THREE.Vector2(x,y)));
    for(const hole of island.slice(1))shape.holes.push(new THREE.Path(hole.map(([x,y])=>new THREE.Vector2(x,y))));return shape;
  });
}

/** A flat piece as a solid: the outline extruded through the thickness, engraves as a thin
 *  dark skin on the top face, scores as lines on it. Z runs from `z0` to `z0 + thickness`. */
function solidOf(plate: Shapes, objects: PreviewObject[], thickness: number, hex: string, z0: number): THREE.Group {
  const g = new THREE.Group();
  const face=new THREE.MeshStandardMaterial({color:hex,roughness:0.86});const edge=new THREE.MeshStandardMaterial({color:EDGE,roughness:0.94});
  const geometry=new THREE.ExtrudeGeometry(toShapes(plate),{depth:thickness,bevelEnabled:false,curveSegments:8});
  const body = new THREE.Mesh(geometry,[face,edge]); body.position.z = z0; g.add(body);
  for(const o of objects){if(o.id==='plate')continue;
    if(o.op==='engrave'){
      const mesh=new THREE.Mesh(new THREE.ShapeGeometry(toShapes(o.shapes)),new THREE.MeshStandardMaterial({color:BURN,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));mesh.position.z=z0+thickness+0.015;g.add(mesh);
    }else if(o.op==='score'||(o.op==='cut'&&o.paths?.length)){
      const line=(points:THREE.Vector3[])=>{if(points.length>=2)g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:BURN})));};
      // A cut's closed shapes are already holes in the extruded plate; only its OPEN runs — a
      // jigsaw's seams, which part the plate without making a hole — need drawing on the face.
      if(o.op==='score')for(const ring of o.shapes.flat()){const points=ring.map(([x,y])=>new THREE.Vector3(x,y,z0+thickness+0.02));if(points[0])points.push(points[0]);line(points);}
      // Open runs stay open: the seam of a welded letter is a line, not a loop.
      for(const path of o.paths??[])line(path.map(([x,y])=>new THREE.Vector3(x,y,z0+thickness+0.02)));
    }
  }
  return g;
}

export function createMaterialPreview(host:HTMLElement){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f3f4f5');
  const camera=new THREE.PerspectiveCamera(35,1,0.1,5000);camera.up.set(0,0,1);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.domElement.setAttribute('aria-label','3D material preview. Drag to orbit and scroll to zoom.');host.append(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=5;controls.maxDistance=1000;
  scene.add(new THREE.HemisphereLight(0xffffff,0x796552,2.2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-60,-80,160);scene.add(light);
  const grid=new THREE.GridHelper(600,60,0xc0c7ce,0xdce1e5);
  grid.rotation.x=Math.PI/2;grid.position.z=-0.05;scene.add(grid);
  host.dataset.grid='10mm';
  const group=new THREE.Group();scene.add(group);let first=true;
  const draw=()=>renderer.render(scene,camera);controls.addEventListener('change',draw);
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();draw();};
  const observer=new ResizeObserver(resize);observer.observe(host);
  function clear(){group.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});group.clear();}
  function render(out:PreviewSolid,thickness=3,hex=FACE){
    clear();
    if (out.pieces?.length) {
      // Each piece in its own frame, then posed: the geometry is centred on its thickness so
      // `pose.z` is the piece's middle, and the Euler order is ZYX so that the three angles read
      // as rotations about the fixed world axes, X first — the contract `PreviewPiece` states.
      for (const piece of out.pieces) {
        const t = piece.thickness ?? thickness;
        const g = solidOf(piece.plate, piece.objects, t, piece.hex ?? hex, -t / 2);
        g.rotation.order = 'ZYX';
        g.rotation.set(rad(piece.pose.rx ?? 0), rad(piece.pose.ry ?? 0), rad(piece.pose.rz ?? 0));
        g.position.set(piece.pose.x, piece.pose.y, piece.pose.z);
        group.add(g);
      }
    } else {
      group.add(solidOf(out.plate, out.objects, thickness, hex, 0));
    }
    const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    // Framed on the product's longest side in any direction — a standing sign is tall, not
    // wide — from a little lower than before, so an upright plate is seen face-on-ish rather
    // than from above.
    if(first){const d=Math.max(size.x,size.y,size.z,20)*1.8;camera.position.set(center.x+d*0.3,center.y-d*0.9,center.z+d*0.6);controls.target.copy(center);controls.update();first=false;}
    resize();draw();
  }
  function reset(){first=true;}
  function dispose(){observer.disconnect();controls.dispose();clear();grid.geometry.dispose();for(const m of Array.isArray(grid.material)?grid.material:[grid.material])m.dispose();renderer.dispose();renderer.domElement.remove();}
  return {render,reset,dispose};
}
