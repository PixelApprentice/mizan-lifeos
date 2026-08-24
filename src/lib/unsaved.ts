const guards = new Set<() => Promise<void>>();

export function registerBeforeExit(guard: () => Promise<void>): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export async function flushBeforeExit(): Promise<void> {
  for (const guard of guards) await guard();
}
