import type { RouteInventory } from '../../schemas/route-inventory.schema.js';
import type { Gap } from '../../schemas/gap-analysis.schema.js';
import type { PublicSurface, PublicSurfaceBrokenLink, PublicSurfaceViolation } from '../../schemas/public-surface.schema.js';

export function buildPublicSurface(pages: RouteInventory['routes'], gaps: Gap[]): PublicSurface {
  const accessibilityViolations: PublicSurfaceViolation[] = [];
  const brokenLinks: PublicSurfaceBrokenLink[] = [];
  for (const r of pages) {
    for (const v of r.a11yViolations) {
      accessibilityViolations.push({ ...v, path: r.path });
    }
    for (const b of r.brokenLinks) {
      brokenLinks.push({ ...b, path: r.path });
    }
  }
  return { pages, gaps, accessibilityViolations, brokenLinks };
}
