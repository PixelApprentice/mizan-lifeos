// Live prayer times: fetched once per day from the AlAdhan API, cached in settings,
// falling back to the built-in monthly table (from day_info) when offline.
import { getSetting, setSetting, todayStr, type Prayers } from "./api";

function to12h(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

export async function livePrayers(fallback: Prayers): Promise<{ prayers: Prayers; source: "live" | "cache" | "builtin" }> {
  const today = todayStr();
  const city = (await getSetting("prayer_city")).trim();
  const country = (await getSetting("prayer_country")).trim();
  if (!city || !country) return { prayers: fallback, source: "builtin" };
  const cachedRaw = await getSetting("prayer_cache");
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (cached.date === today && cached.city === city && cached.country === country && validPrayers(cached.prayers)) {
        return { prayers: cached.prayers, source: "cache" };
      }
    } catch (error) {
      console.warn("Prayer cache is invalid; fetching a new copy.", error);
    }
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(
      `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=3`,
      { signal: ctrl.signal },
    );
    if (!res.ok) throw new Error(`Prayer service returned ${res.status}`);
    const json = await res.json();
    const t2 = json?.data?.timings;
    if (![t2?.Fajr, t2?.Dhuhr, t2?.Asr, t2?.Maghrib, t2?.Isha].every(
      (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d/.test(value),
    )) throw new Error("Invalid prayer service response");
    const prayers: Prayers = {
      fajr: to12h(t2.Fajr),
      dhuhr: to12h(t2.Dhuhr),
      asr: to12h(t2.Asr),
      maghrib: to12h(t2.Maghrib),
      isha: to12h(t2.Isha),
    };
    await setSetting("prayer_cache", JSON.stringify({ date: today, city, country, prayers }));
    return { prayers, source: "live" };
  } catch (error) {
    console.warn("Live prayer times unavailable; using the offline fallback.", error);
    return { prayers: fallback, source: "builtin" };
  } finally {
    clearTimeout(timeout);
  }
}

function validPrayers(value: unknown): value is Prayers {
  return typeof value === "object" && value !== null &&
    ["fajr", "dhuhr", "asr", "maghrib", "isha"].every((key) =>
      key in value && typeof Reflect.get(value, key) === "string" &&
      /^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/.test(Reflect.get(value, key)),
    );
}
