import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Cloud, BellOff, Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStorage } from "@/contexts/StorageContext";
import { migrateLocalToCloud } from "@/lib/storage";
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

export default function Privacy() {
    const navigate = useNavigate();
    const { mode, setMode, refresh, loading } = useStorage();
    const [busy, setBusy] = useState(false);
    const [current, setCurrent] = useState(mode);

    useEffect(() => setCurrent(mode), [mode]);
    useEffect(() => { refresh(); }, [refresh]);

    const apply = async (v) => {
        setBusy(true);
        try {
            if (v === "cloud") await migrateLocalToCloud();
            await setMode(v);
            setCurrent(v);
            toast.success(v === "cloud" ? "Cloud sync turned on" : v === "local" ? "Now keeping data on device only" : "We won't ask again");
        } catch {
            toast.error("Could not update preference");
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
            </main>
            <Footer />
        </div>
    );
}
