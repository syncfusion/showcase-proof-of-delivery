// What the app does with the drawn signature's data, kept apart from the viewer so it can be tested.
// The PDF Viewer stores a drawn signature as a JSON list of path points: { command: 'M' | 'L', x, y }.
import type { StrokePoint } from '../domain/types';

/** The viewer's field value as path points; an empty list when the value is not a point list. */
export function parseStroke(value: string): StrokePoint[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { command?: unknown; x: number; y: number } => !!p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p, i) => ({ command: p.command === 'M' || i === 0 ? 'M' : 'L', x: p.x, y: p.y }));
  } catch {
    return [];
  }
}

/** In 34.2.8 a stroke with no width or no height at all (one perfectly straight horizontal or vertical line)
 *  shows in the field but is missing from the saved PDF; a single pixel of wobble is enough for it to be kept
 *  (validation/prototype.md, finding F2). */
export function strokeLeavesNoMark(value: string): boolean {
  const points = parseStroke(value);
  if (points.length === 0) return false; // not a point list: leave the viewer's value alone
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) < 1 || Math.max(...ys) - Math.min(...ys) < 1;
}

/** The drawing as an SVG path and a view box around it, for the delivery slip; null when there is nothing to draw. */
export function strokeSvg(points: readonly StrokePoint[], padding = 8): { d: string; viewBox: string } | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const width = Math.max(...xs) - Math.min(...xs) + padding * 2;
  const height = Math.max(...ys) - Math.min(...ys) + padding * 2;
  const d = points.map((p) => `${p.command} ${p.x} ${p.y}`).join(' ');
  return { d, viewBox: `${minX} ${minY} ${width} ${height}` };
}
