// Colour classification for design-system.md, "Colour semantics". One self-contained function, so the
// browser check can run it inside the page (it passes the function's source) and Node can test it.
//
// classifyColour('#91C822') -> 'success'; ('rgb(239, 41, 31)') -> 'danger'; ('#0D72DE') -> null.
// A colour reads as a status tone when its hue falls in a status range and it is not greyish:
//   danger (red, pink) 330°-20°, warning (orange, amber, yellow, olive) 20°-65°, success (lime, green)
//   65°-165°; saturation at least 25%, lightness between 12% and 92% (near-black and near-white read as
//   neutral). Only 165°-330° (teal, cyan, blue, indigo, purple, magenta) reads as a category. The ranges
//   meet at 65° with no gap: yellow reads as caution and lime as good (decision of 2026-10-07).
export function classifyColour(text) {
  const value = String(text ?? '').trim().toLowerCase();
  let r, g, b;
  const hex = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (hex) [r, g, b] = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  else if (rgb) [r, g, b] = rgb.slice(1, 4).map(Number);
  else return null;
  if (/^rgba\(/.test(value) && /,\s*0(\.0+)?\s*\)$/.test(value)) return null; // fully transparent
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.25 || lightness < 0.12 || lightness > 0.92) return null;
  let hue = max === rn ? ((gn - bn) / delta) % 6 : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue >= 330 || hue < 20) return 'danger';
  if (hue < 65) return 'warning';
  if (hue < 165) return 'success';
  return null;
}
