export interface BuildParams {
  name: string;
  secondLine: string;
  font: string;
  layout: 'horizontal' | 'vertical';
  style: 'raised' | 'engraved';
  size: number; // text_size
  line2Scale: number; // line2_scale
  baseThickness: number; // base_thickness
  textThickness: number; // text_thickness
  outlineWidth: number; // outline_width
  smoothing: number; // smoothing
  ringStyle: 'loop' | 'corner';
  holeDia: number; // hole_dia
  ringThickness: number; // ring_thickness
  ringPosX: number; // ring_pos_x
  ringPosY: number; // ring_pos_y
  haloWidth: number; // halo_width
  haloThickness: number; // halo_thickness
  colorScheme: 'single' | 'plate-text' | 'plate-halo-text';
  plateColor: string;
  haloColor: string;
  textColor: string;
  uniformHeight: boolean;
  line2XOffset: number;
  lineSpacingFactor: number;
}

export type GeometryRequest =
  | { type: 'build'; textContours: number[][][]; params: BuildParams }
  | { type: 'init' };

export interface PartMesh {
  name: string;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  colorRgb: [number, number, number];
}

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'parts'; parts: PartMesh[]; warnings: string[] }
  | { type: 'error'; message: string };
