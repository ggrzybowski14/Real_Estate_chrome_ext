/**
 * Structured logs for explore jobs (no cookies, no full HTML). Meta is truncated elsewhere on errors.
 */
export function logExplorePhase(
  phase: string,
  meta?: Record<string, string | number | boolean | undefined>
): void {
  const safe =
    meta === undefined
      ? {}
      : Object.fromEntries(
          Object.entries(meta).filter(([, v]) => v !== undefined)
        ) as Record<string, string | number | boolean>;
  console.info("[explore]", { phase, ...safe });
}
