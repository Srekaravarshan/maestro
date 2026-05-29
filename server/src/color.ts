/**
 * color.ts — deterministic color from repo+branch.
 *
 * Key: always hash "repo/branch" together, never branch alone.
 * Two repos can share a branch name (main, feature-x) — hashing both prevents collisions.
 * The resulting color is stable forever for a given repo/branch pair.
 */

function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;
  const r = hue2rgb(p, q, hNorm + 1 / 3);
  const g = hue2rgb(p, q, hNorm);
  const b = hue2rgb(p, q, hNorm - 1 / 3);
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Returns a saturated, medium-brightness hex color that is stable
 * for the given repo+branch pair. Suitable for VS Code window chrome.
 */
export function stableColor(repo: string, branch: string): string {
  const hue = djb2(`${repo}/${branch}`) % 360;
  // Saturation 65%, lightness 42% → vivid but not blinding on dark UI
  return hslToHex(hue, 0.65, 0.42);
}

/**
 * Returns a darker variant of a hex color (for inactive chrome states).
 * factor=0.7 → 30% darker.
 */
export function darkenColor(hex: string, factor = 0.7): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const toHex = (n: number) => Math.round(n * factor).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
