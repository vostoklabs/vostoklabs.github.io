// The vocabulary every shape here is built from. Millimetres, Y up. A ring is a closed polygon
// with its first point NOT repeated, in either winding; an island is its outer ring first and
// its holes after. These are the shapes the laser engine cuts, the pattern engine fills and the
// 3D apps extrude, so nothing here knows about a machine, a screen or a file.

export type Pt = [number, number];
/** A closed polygon, implicitly closed, either winding. */
export type Ring = Pt[];
/** An open run of points. */
export type Polyline = Pt[];
/** One island: its outer ring first, holes after. */
export type Island = Ring[];
/** Islands of rings. */
export type Shapes = Island[];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A box with its width and height worked out. */
export interface SizedBox extends Box {
  w: number;
  h: number;
}
