import { useCallback, useEffect, useState } from "react";
import { companionResetToken, companionSetEnabled, companionStatus, companionUsbConnect, type CompanionStatus } from "../lib/api";

export default function CompanionSettings() {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [usb, setUsb] = useState<{ ok: boolean; text: string } | null>(null);

  const linkUsb = async () => {
    setBusy(true); setUsb(null);
    try { setUsb({ ok: true, text: await companionUsbConnect() }); }
    catch (e) { setUsb({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const apply = useCallback(async (action: () => Promise<CompanionStatus>) => {
    setBusy(true); setError("");
    try {
      const next = await action();
      setStatus(next); setPort(String(next.port));
      if (next.error) setError(next.error);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void apply(companionStatus); }, [apply]);

  const portNumber = Number(port);
  const validPort = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="companion-heading">
      <h3 id="companion-heading" className="hd">Phone companion</h3>
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Your phone becomes a full-screen focus display and remote while Mizan is open on this computer.
        It also keeps a copy of your tasks, projects and calendar, so you can edit them away from home.
        Changes are merged the next time the two devices can reach each other: same Wi-Fi, your phone's hotspot, or a USB cable.
        If both devices edit the same item, the newest edit is kept.
        Nothing goes through the internet or a cloud account.
      </p>
      {!status ? <p role="status" className="text-sm text-ink-dim">Checking...</p> : <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">Port
            <input aria-label="Companion port" disabled={busy || status.running} inputMode="numeric" value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              className="mt-1 block w-28 border border-edge bg-panel-2 p-2 text-sm" />
          </label>
          <button disabled={busy || (!status.enabled && !validPort)}
            onClick={() => void apply(() => companionSetEnabled(!status.enabled, validPort ? portNumber : undefined))}
            className={status.enabled ? "border border-edge px-4 py-2 text-sm" : "btn-px bg-accent px-4 py-2 text-sm font-bold text-black"}>
            {busy ? "Working..." : status.enabled ? "Turn off" : "Turn on"}
          </button>
          <span role="status" className={`text-xs ${status.running ? "text-accent" : "text-ink-dim"}`}>
            {status.running ? `Listening on port ${status.port}` : status.enabled ? "Enabled, not listening" : "Off"}
          </span>
        </div>
        {status.running && (status.qr_svg && status.pair_url ? (
          <div className="flex flex-wrap items-start gap-5">
            <div className="w-56 shrink-0 bg-white p-2" role="img" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: status.qr_svg }} />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p>Scan with the phone while both devices share a network: the same Wi-Fi, the phone's hotspot, or USB tethering.</p>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-dim">
                <li>Open the link in Chrome on the phone.</li>
                <li>Tap <b>Full</b> for a full-screen timer. Tap the timer 3 times to leave full screen.</li>
                <li>In the Mizan Android app, scan the code to pair it instead. The app keeps the screen on and works offline.</li>
              </ol>
              <p className="text-xs text-ink-dim">Other addresses for this computer: {status.addresses.slice(1).join(", ") || "none"}</p>
              <button onClick={() => setShowLink(!showLink)} className="border border-edge px-3 py-1.5 text-xs">{showLink ? "Hide link" : "Show pairing link"}</button>
              {showLink && <p className="break-all border border-edge p-2 text-xs">{status.pair_url}</p>}
              <p className="text-[11px] text-ink-dim">The link includes a private pairing code. Only share it with your own devices. Anyone on this Wi-Fi who has the code can read and change your tasks. Traffic stays on the local network but is not encrypted, so avoid using this on public Wi-Fi.</p>
              <button disabled={busy} onClick={() => void apply(companionResetToken)} className="border border-danger/40 px-3 py-1.5 text-xs text-danger">
                New pairing code (unpairs phones)
              </button>
            </div>
          </div>
        ) : <p className="text-sm text-ink-dim">No local network address found. Connect to Wi-Fi, your phone's hotspot or USB tethering, then reopen Settings, or use the USB debugging link below.</p>)}
        {status.running && (
          <div className="space-y-2 border-t border-edge pt-3">
            <h4 className="text-xs font-bold">No Wi-Fi? Use the USB cable</h4>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-dim">
              <li><b>USB tethering (easiest):</b> plug the phone in and turn on <i>Settings → Network → Hotspot &amp; tethering → USB tethering</i>. This computer gets a cable network from the phone (and its mobile data). The phone app finds this computer again on its own. Pair once with the QR code above if it has never been paired.</li>
              <li><b>Cable only, no tethering:</b> turn on USB debugging on the phone (Developer options), plug it in, then press the button. The phone app then reaches Mizan through the cable at 127.0.0.1. Press it again after re-plugging.</li>
            </ol>
            <button disabled={busy} onClick={() => void linkUsb()} className="border border-edge px-3 py-1.5 text-xs">Link phone over USB debugging</button>
            {usb && <p role={usb.ok ? "status" : "alert"} className={`text-xs ${usb.ok ? "text-accent" : "text-danger"}`}>{usb.text}</p>}
          </div>
        )}
        {status.running && <p className="text-[11px] text-ink-dim">If the phone cannot connect over Wi-Fi, hotspot or tethering, your firewall may be blocking incoming connections. Allow TCP port {status.port} from private networks, for example with <code>sudo ufw allow from 192.168.0.0/16 to any port {status.port} proto tcp</code> and the same for <code>172.16.0.0/12</code> and <code>10.0.0.0/8</code>. Android hotspots and tethering use random addresses from these ranges.</p>}
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
