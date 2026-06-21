/**
 * x, y, and scale are always updated together as an atomic unit — every
 * scale change also adjusts translation via applyScalePivot.
 */
export type Transform = {
  x: number; // horizontal translation (px)
  y: number; // vertical translation (px)
  scale: number; // scale factor (1.0 = original size)
};

/**
 * TransformVelocity is the rate of change of a Transform.
 * vx/vy are linear (px/ms); logVScale is in log-space (log-units/ms) for
 * natural pinch-zoom behavior.
 */
export type TransformVelocity = {
  vx: number; // px/ms
  vy: number; // px/ms
  logVScale: number; // d(ln scale)/dt in 1/ms
};

export function computeDtMs(lastUpdatedAt: number, timestamp: number): number {
  if (Number.isNaN(lastUpdatedAt)) return 16; // default for first update
  return Math.min(timestamp - lastUpdatedAt, 100); // cap to avoid huge jumps after suspension
}

/**
 * Returns the (x, y) translation after applying a scale change of factor ds
 * centered on (originX, originY). Scale must be updated separately.
 */
export function applyScalePivot(
  t: Transform,
  ds: number,
  originX: number,
  originY: number,
): { x: number; y: number } {
  return {
    x: originX + (t.x - originX) * ds,
    y: originY + (t.y - originY) * ds,
  };
}
