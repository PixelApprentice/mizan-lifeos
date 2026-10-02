// iOS Clock-style scroll wheels: swipe or scroll a column, it snaps to the centred value.
import { useEffect, useId, useRef, useState } from "react";
import { durationMinutes } from "../lib/focusTime";

const ROW = 44;
interface Option { value: number; label: string }

export function Wheel({ label, options, value, change, width }: {
  label: string; options: Option[]; value: number; change: (value: number) => void; width?: number;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  useEffect(() => {
    const wheel = ref.current;
    if (wheel && Math.abs(wheel.scrollTop - index * ROW) > 1) wheel.scrollTop = index * ROW;
  }, [index, options.length]);
  // Scroll handlers fire after a delay, so they must read the latest value and callback,
  // not the ones from the render that started the scroll.
  const latest = useRef({ index, change });
  latest.current = { index, change };
  useEffect(() => () => clearTimeout(timeout.current), []);
  const pick = (i: number) => {
    const next = Math.min(options.length - 1, Math.max(0, i));
    if (next !== latest.current.index) latest.current.change(options[next].value);
  };
  return <div className="duration-column" style={width ? { width } : undefined}>
    <span id={`${id}-label`} className="text-xs text-ink-dim">{label}</span>
    <div className="duration-wheel-frame">
      <div aria-hidden="true" className="duration-selection" />
      <div ref={ref} role="listbox" tabIndex={0} aria-labelledby={`${id}-label`}
        aria-activedescendant={`${id}-${index}`} className="duration-wheel"
        onScroll={() => {
          clearTimeout(timeout.current);
          timeout.current = setTimeout(() => { if (ref.current?.clientHeight) pick(Math.round(ref.current.scrollTop / ROW)); }, 120);
        }}
        onKeyDown={(event) => {
          const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1
            : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
              : event.key === "PageDown" ? index + 5 : event.key === "PageUp" ? index - 5 : null;
          if (next !== null) { event.preventDefault(); pick(next); }
        }}>
        {options.map((option, i) =>
          <button type="button" key={option.value} id={`${id}-${i}`} role="option" aria-selected={i === index} tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()} onClick={() => pick(i)}
            className={i === index ? "text-accent" : "text-ink-dim"}>
            {option.label}
          </button>)}
      </div>
    </div>
  </div>;
}

const range = (from: number, to: number, pad = 2) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: String(from + i).padStart(pad, "0") }));
const HOURS = range(0, 8, 1);
const MINUTES = range(0, 59);
const HOURS_12 = range(1, 12, 1);
const MERIDIEM = [{ value: 0, label: "AM" }, { value: 1, label: "PM" }];

export default function DurationWheel({ minutes, change }: { minutes: number; change: (minutes: number) => void }) {
  const safeMinutes = durationMinutes(0, Number.isInteger(minutes) ? minutes : 5);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return <div className="w-full max-w-xs">
    <div className="flex justify-center gap-6" aria-label="Session duration wheels">
      <Wheel label="Hours" options={HOURS} value={hours} change={(hour) => change(durationMinutes(hour, remainder))} />
      <Wheel label="Minutes" options={MINUTES} value={remainder} change={(minute) => change(durationMinutes(hours, minute))} />
    </div>
    <p className="mt-3 text-center text-xs text-ink-dim">Swipe, scroll, or use arrow keys · {safeMinutes} minutes (5 min to 8 h)</p>
  </div>;
}

/** 24-hour "HH:MM" value, shown as hour / minute / AM-PM wheels. */
export function TimeWheel({ value, change, label = "Time" }: { value: string; change: (value: string) => void; label?: string }) {
  const [h, m] = /^\d{2}:\d{2}$/.test(value) ? value.split(":").map(Number) : [9, 0];
  const pm = h >= 12 ? 1 : 0;
  const hour12 = h % 12 || 12;
  const emit = (hour: number, minute: number, meridiem: number) =>
    change(`${String((hour % 12) + meridiem * 12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  return <div className="flex justify-center gap-3" role="group" aria-label={`${label} wheels`}>
    <Wheel label="Hour" width={72} options={HOURS_12} value={hour12} change={(hour) => emit(hour, m, pm)} />
    <Wheel label="Min" width={72} options={MINUTES} value={m} change={(minute) => emit(hour12, minute, pm)} />
    <Wheel label="" width={72} options={MERIDIEM} value={pm} change={(meridiem) => emit(hour12, m, meridiem)} />
  </div>;
}

/** Native time input with an optional wheel picker underneath. */
export function TimeField({ value, change, label, disabled }: { value: string; change: (value: string) => void; label: string; disabled?: boolean }) {
  const [open, setOpen] = useState(() => localStorage.getItem("mizan:time-wheels") === "1");
  return <span className="inline-flex flex-col gap-2">
    <span className="inline-flex items-center gap-1">
      <input aria-label={label} disabled={disabled} type="time" value={value} onChange={(e) => change(e.target.value)}
        className="border border-edge bg-panel-2 px-2 py-1.5 tabular-nums outline-none focus:border-accent" />
      <button type="button" disabled={disabled} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} wheel for ${label}`} title="Wheel picker"
        onClick={() => { localStorage.setItem("mizan:time-wheels", open ? "0" : "1"); setOpen(!open); }}
        className={`border px-2 py-1.5 text-xs ${open ? "border-accent text-accent" : "border-edge text-ink-dim"}`}>◎</button>
    </span>
    {open && !disabled && <TimeWheel value={value} change={change} label={label} />}
  </span>;
}
