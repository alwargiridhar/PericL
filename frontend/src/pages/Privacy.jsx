import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Cloud, BellOff, Loader2, Download, PhoneOff } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStorage } from "@/contexts/StorageContext";
import { migrateLocalToCloud, migrateCloudToLocal } from "@/lib/storage";
import { getNudgePrefs, setNudgePrefs } from "@/hooks/useDriftNudge";
import Footer from "@/components/Footer";

const OPTIONS = [
    {
        value: "local",
        Icon: Lock,
        title: "On this device only",
        body: "Default. Nothing about you is sent to the server beyond what's needed for your inner voice to respond — and even those calls are not logged.",
    },
    {
        value: "cloud",
        Icon: Cloud,
        title: "Sync to cloud",
        body: "Keep a managed copy in the cloud — useful if you switch devices. Data is handled with care for future-you.",
    },
    {
        value: "never",
        Icon: BellOff,
        title: "Local + don't ever ask again",
        body: "Same as local, and the monthly nudge stops appearing.",
    },
];

function fmtHour(h) {
    if (h === 0) return "12 am";
    if (h < 12) return `${h} am`;
    if (h === 12) return "12 pm";
    return `${h - 12} pm`;
}

export default function Privacy() {
    const navigate = useNavigate();
    const { mode, setMode, refresh, loading } = useStorage();
    const [busy, setBusy] = useState(false);
    const [current, setCurrent] = useState(mode);
    const [nudgePrefs, setPrefsState] = useState(() => getNudgePrefs());

    useEffect(() => setCurrent(mode), [mode]);
    useEffect(() => { refresh(); }, [refresh]);

    const updateNudgePrefs = (patch) => {
        const next = setNudgePrefs(patch);
        setPrefsState(next);
    };

    const apply = async (v) => {
        setBusy(true);
        try {
            // When switching cloud → local, pull the cloud data down first so we don't lose it.
            if (v !== "cloud" && current === "cloud") {
                try { await migrateCloudToLocal(); } catch {}
            }
            if (v === "cloud") await migrateLocalToCloud();
            await setMode(v);
            setCurrent(v);
            toast.success(v === "cloud" ? "Cloud sync turned on — local data uploaded" : v === "local" ? "Now keeping data on device only" : "We won't ask again");
        } catch {
            toast.error("Could not update preference");
        } finally {
            setBusy(false);
        }
    };

    const downloadCloud = async () => {
        setBusy(true);
        try {
            await migrateCloudToLocal();
            toast.success("Cloud data copied to this device");
        } catch {
            toast.error("Could not download — try again");
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="privacy-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="privacy-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Privacy & data</span>
                </div>
            </header>

            <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
                <div>
                    <h1 className="font-display text-3xl tracking-tight">Where your thoughts live</h1>
                    <p className="text-muted-foreground mt-1.5 leading-relaxed">
                        PericL is built to feel like you, written down. By default everything stays on this device.
                        You decide if and when anything leaves.
                    </p>
                </div>

                <div className="space-y-3">
                    {OPTIONS.map((opt) => {
                        const selected = current === opt.value;
                        const Icon = opt.Icon;
                        return (
                            <button
                                key={opt.value}
                                data-testid={`privacy-option-${opt.value}`}
                                disabled={busy}
                                onClick={() => apply(opt.value)}
                                className={`w-full text-left rounded-3xl border-2 p-5 transition-all flex gap-4 ${
                                    selected
                                        ? "border-primary bg-primary/8"
                                        : "border-border bg-card hover:border-primary/40"
                                }`}
                            >
                                <div className="w-11 h-11 rounded-2xl bg-muted grid place-items-center shrink-0">
                                    <Icon className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-base">{opt.title}</span>
                                        {selected && (
                                            <span className="text-[10px] uppercase tracking-wider text-primary font-medium">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                                        {opt.body}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Note.</strong>{" "}
                    When you keep your data on device, the monthly check-in respects you — if you say &quot;never,&quot; PericL stops asking.
                    Calls to your inner voice are stateless: nothing about your text or audio is stored on the server.
                </div>

                {current === "cloud" && (
                    <div className="rounded-3xl border border-border bg-card p-5">
                        <div className="flex items-start gap-4">
                            <div className="w-11 h-11 rounded-2xl bg-muted grid place-items-center shrink-0">
                                <Download className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-display text-base">Pull cloud copy onto this device</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                                    Useful before switching back to on-device, or to seed a new browser.
                                </p>
                                <Button
                                    data-testid="privacy-download-cloud"
                                    onClick={downloadCloud}
                                    disabled={busy}
                                    variant="outline"
                                    className="mt-3 rounded-full"
                                >
                                    {busy ? "Working…" : "Download my cloud data"}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="rounded-3xl border border-border bg-card p-5" data-testid="privacy-drift-nudge-card">
                    <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-2xl bg-accent/10 grid place-items-center shrink-0">
                            <PhoneOff className="w-5 h-5 text-accent" strokeWidth={1.7} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="font-display text-base">Drift nudge</h3>
                                <button
                                    data-testid="nudge-toggle"
                                    role="switch"
                                    aria-checked={nudgePrefs.enabled}
                                    onClick={() => updateNudgePrefs({ enabled: !nudgePrefs.enabled })}
                                    className={`relative h-6 w-11 rounded-full transition-colors ${
                                        nudgePrefs.enabled ? "bg-primary" : "bg-muted"
                                    }`}
                                >
                                    <span
                                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform ${
                                            nudgePrefs.enabled ? "translate-x-5" : ""
                                        }`}
                                    />
                                </button>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                                When you&rsquo;ve been away from PericL for a while during your active hours,
                                you get one humble nudge back to your goal. No spying on other apps — it just
                                notices you&rsquo;ve drifted.
                            </p>

                            <div className="mt-4 grid sm:grid-cols-3 gap-3">
                                <label className="text-xs">
                                    <span className="text-muted-foreground">Nudge after</span>
                                    <select
                                        data-testid="nudge-threshold"
                                        value={nudgePrefs.threshold_min}
                                        onChange={(e) => updateNudgePrefs({ threshold_min: parseInt(e.target.value, 10) })}
                                        disabled={!nudgePrefs.enabled}
                                        className="mt-1 w-full h-9 px-3 rounded-full border border-border bg-background text-sm disabled:opacity-50"
                                    >
                                        {[15, 30, 45, 60, 90, 120].map((m) => (
                                            <option key={m} value={m}>{m} min away</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="text-xs">
                                    <span className="text-muted-foreground">Active from</span>
                                    <select
                                        data-testid="nudge-active-start"
                                        value={nudgePrefs.active_start}
                                        onChange={(e) => updateNudgePrefs({ active_start: parseInt(e.target.value, 10) })}
                                        disabled={!nudgePrefs.enabled}
                                        className="mt-1 w-full h-9 px-3 rounded-full border border-border bg-background text-sm disabled:opacity-50"
                                    >
                                        {Array.from({ length: 24 }, (_, h) => (
                                            <option key={h} value={h}>{fmtHour(h)}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="text-xs">
                                    <span className="text-muted-foreground">Until</span>
                                    <select
                                        data-testid="nudge-active-end"
                                        value={nudgePrefs.active_end}
                                        onChange={(e) => updateNudgePrefs({ active_end: parseInt(e.target.value, 10) })}
                                        disabled={!nudgePrefs.enabled}
                                        className="mt-1 w-full h-9 px-3 rounded-full border border-border bg-background text-sm disabled:opacity-50"
                                    >
                                        {Array.from({ length: 24 }, (_, h) => (
                                            <option key={h} value={h}>{fmtHour(h)}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
