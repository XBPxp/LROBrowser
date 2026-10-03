export interface LastroServerWalkAltitude {
  width: number;
  height: number;
  TYPE: { WALKABLE: number };
  getCellType(x: number, y: number): number | undefined;
}
export function findLastroServerWalkPath(
  x0: number, y0: number, x1: number, y1: number, out: Int16Array, altitude: LastroServerWalkAltitude,
): number;
