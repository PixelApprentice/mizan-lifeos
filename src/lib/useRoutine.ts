// Loads the routine setting (choosing a sensible default the first time) and follows edits.
import { useEffect, useState } from "react";
import { getSetting, readTracker, setSetting } from "./api";
import { defaultRoutine, parseRoutine, SETTING_KEY, type Routine } from "./routine";

export async function loadRoutine(): Promise<Routine> {
  const stored = await getSetting(SETTING_KEY).catch(() => "");
  if (stored) return parseRoutine(stored, defaultRoutine([]));
  const rows = await readTracker().catch(() => []);
  const routine = defaultRoutine(rows);
  await setSetting(SETTING_KEY, JSON.stringify(routine)).catch(() => undefined);
  return routine;
}

export async function saveRoutine(r: Routine): Promise<void> {
  await setSetting(SETTING_KEY, JSON.stringify(r));
}

export function useRoutine(): Routine | null {
  const [routine, setRoutine] = useState<Routine | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void loadRoutine().then((r) => live && setRoutine(r));
    load();
    window.addEventListener("mizan:settings-changed", load);
    return () => { live = false; window.removeEventListener("mizan:settings-changed", load); };
  }, []);
  return routine;
}
