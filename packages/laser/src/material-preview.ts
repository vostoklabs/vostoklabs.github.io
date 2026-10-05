/** Lightweight material preview shared by laser tools. Actual cut geometry is supplied by callers.
 *
 *  With no options it is Laser Studio's 3D view. Every option adds to that, and each default is
 *  what the preview did before the option existed: its own camera, lamps and grid, a shadow under
 *  the product, picking, zoom tools, and labels pinned to points in the scene. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shapes } from './types';

export type V3 = [number, number, number];

export interface PreviewObject { id: string; op: string; shapes: Shapes; paths?: [number, number][][] }

/** Where a piece sits, by angles: see `PreviewPiece`. */
export interface PreviewPose { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number }

/**
 * Where a piece sits, by its own axes: `origin` is the world point its (0, 0) lands on, at the
 * middle of its thickness; `u` and `v` are the world directions its 2D X and Y run along (unit
 * length, at right angles). Its show face, where engraves and scores go, looks along `n`, which
 * is u × v when not given. An engine that builds its pieces in place hands them over this way,
 * and turning that into angles first is one more place for a sign to go wrong.
 */
export interface PreviewFrame { origin: V3; u: V3; v: V3; n?: V3 }

/**
 * One piece of an assembled product, where it sits once put together.
 *
 * `plate` and `objects` are in the piece's OWN frame — the centre of its outline's box at the
 * origin, lying flat. `pose` places its centre (mm, Z up, the table at z = 0; `z` is the middle
 * of its thickness) and turns it about that centre, in degrees, about the WORLD axes, X first,
 * then Y, then Z. So `rx: 90` stands a plate up; `rx: 90, rz: 90` stands it up and turns it to
 * run front-to-back. `hex` is this piece's face colour — a darker backer, a kraft card. A
 * `frame` places it by its axes instead, and wins over `pose`; with neither it lies flat at the
 * origin.
 *
 * `thickness` is how thick THIS piece is, when it is not cut from the sheet the render was
 * given: a bracelet set's holder is 0.6 mm kraft card, not 3 mm plywood, and extruding it
 * through the sheet's thickness is what made it read as another sheet of ply. Absent, the
 * piece is the sheet's own thickness, exactly as before.
 */
export interface PreviewPiece {
  plate: Shapes;
  objects: PreviewObject[];
  pose?: PreviewPose;
  frame?: PreviewFrame;
  hex?: string;
  thickness?: number;
  /** Open cuts through the sheet: each a straight dark gap about a kerf wide, from its first point
   *  to its last, through the whole thickness, so it shows on the piece's edge as it will in the
   *  material. */
  slits?: [number, number][][];
  /** What `onPick` reports when this piece is clicked while picking is on. A piece without one
   *  cannot be picked, though it still hides the pieces behind it. */
  pick?: string;
}

export interface PreviewSolid {
  plate: Shapes;
  objects: PreviewObject[];
  /** Given, the scene is these pieces where they sit ASSEMBLED — a stack by thickness, a stand
   *  with its plate leaning and its feet standing — instead of the flat sheet. */
  pieces?: PreviewPiece[];
  /** The box the camera frames and the contact shadow lies under, mm, when it is not the
   *  pieces' own bounds: the product's body, say, without a part that sticks out of it. */
  bounds?: { min: V3; max: V3 };
}

/** Where the camera stands. Each default is Laser Studio's. */
export interface PreviewCamera {
  /** Vertical field of view, degrees. Default 35. */
  fov?: number;
  /** Near and far clipping, mm. Defaults 0.1 and 5000. */
  near?: number;
  far?: number;
  /** How close and how far the orbit may go, mm. Defaults 5 and 1000. */
  minDistance?: number;
  maxDistance?: number;
  /** The direction a framed view looks from, per unit of `distance`. Default [0.3, -0.9, 0.6]:
   *  front right, a little above. */
  view?: V3;
  /** How far away a framed view stands, in multiples of the product's longest side. Default 1.8. */
  distance?: number;
  /** The longest side a framed view assumes at least, mm, so a tiny product does not fill the
   *  view. Default 20. */
  minSize?: number;
}

/** A directional lamp: how strong, and where it shines from (mm). */
export interface PreviewLamp { intensity: number; position: V3 }

export interface MaterialPreviewOptions {
  camera?: PreviewCamera;
  /** The lamps. The sky-and-ground light is the same in every view. Default: the key lamp at 3
   *  from (-60, -80, 160), no fill. */
  light?: { key?: PreviewLamp; fill?: PreviewLamp };
  /** The 10 mm grid on the table: how wide it is, mm. Default 600. */
  grid?: { size?: number };
  /** A soft shadow on the table under the product, so it sits rather than floats. Default off. */
  contactShadow?: boolean;
  /** The camera moved: its zoom relative to the framed view, 1 = the product framed. */
  onZoom?: (zoom: number) => void;
  /** A piece with a `pick` was clicked (the main button, not dragged) while picking is on. */
  onPick?: (pick: string) => void;
  /** A frame was drawn: the place to move labels that follow the product (see `project`). */
  onFrame?: () => void;
}

export interface MaterialPreview {
  /** Draw `out`: the flat sheet, or its pieces assembled. The first render frames the camera. */
  render(out: PreviewSolid, thickness?: number, hex?: string): void;
  /** The next render frames the camera again. */
  reset(): void;
  /** Move the pieces of the last render without rebuilding them, in the order they were given:
   *  a part that moves, an exploded view. */
  setPoses(places: { pose?: PreviewPose; frame?: PreviewFrame }[]): void;
  /** Clicks pick pieces, and the one under the pointer lights up. Needs `onPick`. */
  setPicking(on: boolean): void;
  /** Move the camera toward the product (factor > 1) or away from it, within its limits. */
  zoomBy(factor: number): void;
  /** A world point (mm) on the canvas, in CSS pixels from its top left; `visible` is false
   *  when the point is behind the camera or past its far plane. */
  project(point: V3): { x: number; y: number; visible: boolean };
  dispose(): void;
}

const FACE = '#c6a676';
const EDGE = '#70502f';
const BURN = '#50321c';
/** A slit as the beam leaves it: a charred gap about a kerf wide. */
const SLIT = '#24160a';
const SLIT_WIDTH = 0.3;
/** The piece under the pointer while picking. */
const PICK = '#2563eb';
const rad = (deg: number) => (deg * Math.PI) / 180;

function toShapes(islands:Shapes): THREE.Shape[] {
  return islands.filter(i=>i[0]?.length>=3).map(island=>{
    const shape=new THREE.Shape(island[0].map(([x,y])=>new THREE.Vector2(x,y)));
    for(const hole of island.slice(1))shape.holes.push(new THREE.Path(hole.map(([x,y])=>new THREE.Vector2(x,y))));return shape;
  });
}

/** A flat piece as a solid: the outline extruded through the thickness, engraves as a thin
 *  dark skin on the top face, scores as lines on it, slits as dark gaps through it. Z runs from
 *  `z0` to `z0 + thickness`. The group keeps its plate's mesh and face material in `userData`
 *  (`body`, `face`): what a pick ray hits and what lights up under the pointer. */
function solidOf(plate: Shapes, objects: PreviewObject[], thickness: number, hex: string, z0: number, slits: [number, number][][] = []): THREE.Group {
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
  // Each slit a thin dark block through the sheet, a hair proud of both faces and of the tip;
  // all of a piece's slits are one mesh.
  const parts=slits.filter(s=>s.length>=2).map(s=>{const a=s[0]!,b=s[s.length-1]!;const block=new THREE.BoxGeometry(Math.hypot(b[0]-a[0],b[1]-a[1])+0.04,SLIT_WIDTH,thickness+0.06);block.rotateZ(Math.atan2(b[1]-a[1],b[0]-a[0]));block.translate((a[0]+b[0])/2,(a[1]+b[1])/2,z0+thickness/2);return block;});
  if(parts.length){const merged=mergeGeometries(parts);for(const p of parts)p.dispose();if(merged)g.add(new THREE.Mesh(merged,new THREE.MeshBasicMaterial({color:SLIT})));}
  g.userData.body=body;g.userData.face=face;
  return g;
}

/** Put a piece where `at` says: by its frame, else by its pose, else flat at the origin. */
function place(g: THREE.Group, at: { pose?: PreviewPose; frame?: PreviewFrame }) {
  if (at.frame) {
    const u=new THREE.Vector3(...at.frame.u),v=new THREE.Vector3(...at.frame.v),n=at.frame.n?new THREE.Vector3(...at.frame.n):new THREE.Vector3().crossVectors(u,v);
    g.matrixAutoUpdate=false;g.matrix.makeBasis(u,v,n).setPosition(...at.frame.origin);g.matrixWorldNeedsUpdate=true;return;
  }
  // The geometry is centred on its thickness so `pose.z` is the piece's middle, and the Euler
  // order is ZYX so that the three angles read as rotations about the fixed world axes, X
  // first — the contract `PreviewPiece` states.
  const pose = at.pose ?? { x: 0, y: 0, z: 0 };
  g.matrixAutoUpdate = true;
  g.rotation.order = 'ZYX';
  g.rotation.set(rad(pose.rx ?? 0), rad(pose.ry ?? 0), rad(pose.rz ?? 0));
  g.position.set(pose.x, pose.y, pose.z);
}

/** The soft round shadow under the product: a radial fade on a unit square, scaled to fit. */
function contactShadowMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;
  const fade=ctx.createRadialGradient(64,64,8,64,64,64);fade.addColorStop(0,'rgba(40,30,20,0.32)');fade.addColorStop(1,'rgba(40,30,20,0)');ctx.fillStyle=fade;ctx.fillRect(0,0,128,128);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));mesh.visible=false;return mesh;
}

export function createMaterialPreview(host:HTMLElement,opts:MaterialPreviewOptions={}):MaterialPreview{
  // Field by field, so a field passed as `undefined` keeps its default.
  const c=opts.camera??{};const cam={fov:c.fov??35,near:c.near??0.1,far:c.far??5000,minDistance:c.minDistance??5,maxDistance:c.maxDistance??1000,view:c.view??[0.3,-0.9,0.6] as V3,distance:c.distance??1.8,minSize:c.minSize??20};
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f3f4f5');
  const camera=new THREE.PerspectiveCamera(cam.fov,1,cam.near,cam.far);camera.up.set(0,0,1);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.domElement.setAttribute('aria-label','3D material preview. Drag to orbit and scroll to zoom.');host.append(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=cam.minDistance;controls.maxDistance=cam.maxDistance;
  const key=opts.light?.key??{intensity:3,position:[-60,-80,160] as V3};
  scene.add(new THREE.HemisphereLight(0xffffff,0x796552,2.2));const light=new THREE.DirectionalLight(0xffffff,key.intensity);light.position.set(...key.position);scene.add(light);
  if(opts.light?.fill){const fill=new THREE.DirectionalLight(0xffffff,opts.light.fill.intensity);fill.position.set(...opts.light.fill.position);scene.add(fill);}
  const gridSize=opts.grid?.size??600;const grid=new THREE.GridHelper(gridSize,Math.round(gridSize/10),0xc0c7ce,0xdce1e5);
  grid.rotation.x=Math.PI/2;grid.position.z=-0.05;scene.add(grid);
  host.dataset.grid='10mm';
  const shadow=opts.contactShadow?contactShadowMesh():null;if(shadow)scene.add(shadow);
  const group=new THREE.Group();scene.add(group);let first=true;
  /** Camera to target when the product was last framed: zoom 1. */
  let fitDistance=1;const zoomNow=()=>fitDistance/Math.max(1e-6,camera.position.distanceTo(controls.target));
  const draw=()=>{renderer.render(scene,camera);opts.onFrame?.();};controls.addEventListener('change',()=>{draw();opts.onZoom?.(zoomNow());});
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();draw();};
  const observer=new ResizeObserver(resize);observer.observe(host);
  // Picking: a click, not a drag, on a piece that has a `pick`; the one under the pointer lights up.
  let picking=false,hovered:THREE.Object3D|null=null;
  const paintPicks=()=>{for(const g of group.children){const lit=picking&&hovered===g,face=g.userData.face as THREE.MeshStandardMaterial;face.emissive.set(lit?PICK:'#000000');face.emissiveIntensity=lit?0.22:0;}};
  const ray=new THREE.Raycaster();
  // The nearest piece under the pointer wins, so one that cannot be picked still hides the ones behind it.
  const hit=(ev:PointerEvent):THREE.Object3D|null=>{const r=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2(((ev.clientX-r.left)/r.width)*2-1,-((ev.clientY-r.top)/r.height)*2+1),camera);const nearest=ray.intersectObjects(group.children.map(g=>g.userData.body),false)[0];const g=group.children.find(x=>x.userData.body===nearest?.object);return g?.userData.pick!==undefined?g:null;};
  if(opts.onPick){const onPick=opts.onPick,el=renderer.domElement;let down:{x:number;y:number}|null=null;
    // The main button only: the others pan the view.
    el.addEventListener('pointerdown',ev=>{down=ev.button===0?{x:ev.clientX,y:ev.clientY}:null;});
    el.addEventListener('pointercancel',()=>{down=null;});
    // A pointer that travelled more than 5 px was an orbit, not a click.
    el.addEventListener('pointerup',ev=>{if(!picking||!down)return;const travel=Math.hypot(ev.clientX-down.x,ev.clientY-down.y);down=null;if(travel>5)return;const g=hit(ev);if(g)onPick(g.userData.pick);});
    el.addEventListener('pointermove',ev=>{if(!picking||ev.buttons)return;const g=hit(ev);if(g===hovered)return;hovered=g;el.style.cursor=g?'pointer':'';paintPicks();draw();});
    el.addEventListener('pointerleave',()=>{if(!hovered)return;hovered=null;el.style.cursor='';paintPicks();draw();});
  }
  function clear(){group.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});group.clear();if(hovered){hovered=null;renderer.domElement.style.cursor='';}}
  function render(out:PreviewSolid,thickness=3,hex=FACE){
    clear();
    if (out.pieces?.length) {
      // Each piece in its own frame, then posed (see `place`).
      for (const piece of out.pieces) {
        const t = piece.thickness ?? thickness;
        const g = solidOf(piece.plate, piece.objects, t, piece.hex ?? hex, -t / 2, piece.slits);
        place(g, piece);
        if (piece.pick !== undefined) g.userData.pick = piece.pick;
        group.add(g);
      }
    } else {
      group.add(solidOf(out.plate, out.objects, thickness, hex, 0));
    }
    const box=out.bounds?new THREE.Box3(new THREE.Vector3(...out.bounds.min),new THREE.Vector3(...out.bounds.max)):new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    if(shadow){shadow.scale.set(size.x*1.9,size.y*1.9,1);shadow.position.set(center.x,center.y,0.02);shadow.visible=true;}
    if(picking)paintPicks();
    // Framed on the product's longest side in any direction — a standing sign is tall, not
    // wide — from a little lower than before, so an upright plate is seen face-on-ish rather
    // than from above.
    if(first){const d=Math.max(size.x,size.y,size.z,cam.minSize)*cam.distance;camera.position.set(center.x+d*cam.view[0],center.y+d*cam.view[1],center.z+d*cam.view[2]);controls.target.copy(center);fitDistance=camera.position.distanceTo(center);controls.update();first=false;}
    resize();draw();
  }
  function reset(){first=true;}
  function setPoses(places:{pose?:PreviewPose;frame?:PreviewFrame}[]){places.forEach((at,i)=>{const g=group.children[i];if(g)place(g as THREE.Group,at);});draw();}
  function setPicking(on:boolean){picking=on;if(!on){hovered=null;renderer.domElement.style.cursor='';}paintPicks();draw();}
  function zoomBy(factor:number){const dir=camera.position.clone().sub(controls.target);const d=Math.min(controls.maxDistance,Math.max(controls.minDistance,dir.length()/factor));camera.position.copy(controls.target).add(dir.setLength(d));controls.update();}
  function project(point:V3){camera.updateMatrixWorld();const p=new THREE.Vector3(...point).project(camera);return {x:((p.x+1)/2)*host.clientWidth,y:((1-p.y)/2)*host.clientHeight,visible:p.z>-1&&p.z<1};}
  function dispose(){observer.disconnect();controls.dispose();clear();grid.geometry.dispose();for(const m of Array.isArray(grid.material)?grid.material:[grid.material])m.dispose();if(shadow){shadow.geometry.dispose();shadow.material.map?.dispose();shadow.material.dispose();}renderer.dispose();renderer.domElement.remove();}
  return {render,reset,setPoses,setPicking,zoomBy,project,dispose};
}
