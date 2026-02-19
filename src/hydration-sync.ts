export function shouldSkipSyncOnHydration(
  storedLength: number,
  canSetAnnotations: boolean,
): boolean {
  return storedLength > 0 && canSetAnnotations;
}
