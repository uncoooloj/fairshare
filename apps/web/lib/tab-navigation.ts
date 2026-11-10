/** Horizontal tab keyboard navigation; Enter/Space keep native button activation. */
export function tabDestination(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
