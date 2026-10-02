import type { FocusState, SessionRecord } from "./api";

export function focusRemainingSec(state: FocusState, now: number): number {
  const base = state.paused_at ? Date.parse(state.paused_at) : now;
  return Math.max(0, Math.ceil((Date.parse(state.ends_at) - base) / 1000));
}

export function sessionRecord(state: FocusState, now: number, broken: boolean, reason = ""): SessionRecord {
  const elapsed = state.planned_min * 60 - focusRemainingSec(state, now);
  return {
    started_at: state.started_at, ended_at: new Date(now).toISOString(),
    planned_min: state.planned_min,
    actual_min: Math.floor(Math.max(0, Math.min(elapsed, state.planned_min * 60)) / 60),
    broken, reason, kills: state.kills,
  };
}

export function durationMinutes(hours: number, minutes: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new Error("Use whole hours and minutes.");
  return Math.min(480, Math.max(5, hours * 60 + minutes));
}
