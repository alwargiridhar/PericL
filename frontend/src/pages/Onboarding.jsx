import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, Cloud, ShieldCheck, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStorage } from "@/contexts/StorageContext";
import { useAuth } from "@/contexts/AuthContext";
import { migrateLocalToCloud } from "@/lib/storage";

const MODES = [
    {
        value: "local",
        emoji: "🟢",
        Icon: Lock,
        title: "Local Private Mode",
        subtitle: "Maximum privacy",
        bullets: [
            "Everything stays on your device",
            "Encrypted with a key only you have",
            "No journals leave this browser",
            "Lightweight intelligence",
        ],
        cta: "Start privately",
        accent: "primary",
    },
    {
        value: "cloud",
        emoji: "🟣",
        Icon: Cloud,
        title: "Cloud Intelligence Mode",
        subtitle: "Deeper reflection · cross-device",
        bullets: [
            "Smarter mirror responses with memory",
            "Cross-device sync across phone & laptop",
            "Long-term behavioral insights",
            "Switch back to local at any time",
        ],
        cta: "Enable cloud intelligence",
        accent: "accent",
    },
];

export default function Onboarding() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { setMode } = useStorage();
    const [busy, setBusy] = useState(false);
    const [picked, setPicked] = useState(null);

    const apply = async (mode) => {
        if (busy) return;
        setBusy(true);
        setPicked(mode);
        try {
            if (mode === "cloud") {
                try { await migrateLocalToCloud(); } catch { /* no local data yet, fine */ }
            }
            await setMode(mode);
            // Mark onboarded — store a flag so we don't re-prompt on every load
            try {
                localStorage.setItem("pericl.onboarded_at", new Date().toISOString());
            } catch {}
            navigate("/", { replace: true });
        } catch {
            setBusy(false);
            setPicked(null);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground" data-testid="onboarding-page">
            <div className="pointer-events-none absolute -top-32 -left-32 w-[36rem] h-[36rem] bg-primary/8 blob -z-10" aria-hidden />
            <div className="pointer-events-none absolute top-1/2 -right-32 w-[30rem] h-[30rem] bg-accent/8 blob -z-10" style={{ animationDelay: "-7s" }} aria-hidden />

            <div className="max-w-3xl mx-auto px-6 sm:px-10 pt-16 sm:pt-24 pb-16">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground border border-border/60 rounded-full px-3 py-1.5">
                        <ShieldCheck className="w-3 h-3" /> Choose your privacy mode
                    </span>
                    <h1 className="mt-5 font-display tracking-tight text-3xl sm:text-5xl leading-[1.05]">
                        Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}.
                        <br />
                        <span className="italic text-primary">How private should this be?</span>
                    </h1>
                    <p className="mt-4 text-muted-foreground leading-relaxed max-w-xl">
                        Pericl is built to help you stay aligned with who you said you wanted to become — without
                        sacrificing your privacy. You can switch modes any time.
                    </p>
                </motion.div>

                <div className="mt-10 grid sm:grid-cols-2 gap-5">
                    {MODES.map((m, i) => {
                        const Icon = m.Icon;
                        const accentText = m.accent === "primary" ? "text-primary" : "text-accent";
                        const accentBg = m.accent === "primary" ? "bg-primary/10" : "bg-accent/10";
                        const accentBorder = m.accent === "primary" ? "border-primary/30" : "border-accent/30";
                        return (
                            <motion.button
                                key={m.value}
                                data-testid={`onboarding-pick-${m.value}`}
                                onClick={() => apply(m.value)}
                                disabled={busy}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 + i * 0.08, duration: 0.5 }}
                                whileHover={!busy ? { y: -2 } : undefined}
                                className={`text-left rounded-[1.75rem] border-2 ${accentBorder} bg-card p-6 sm:p-7 transition-all hover:shadow-lg disabled:opacity-50`}
                            >
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={`w-11 h-11 rounded-2xl ${accentBg} grid place-items-center shrink-0`}>
                                        <Icon className={`w-5 h-5 ${accentText}`} strokeWidth={1.7} />
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                            {m.emoji} {m.subtitle}
                                        </div>
                                        <div className="font-display text-xl sm:text-2xl tracking-tight mt-0.5">
                                            {m.title}
                                        </div>
                                    </div>
                                </div>
                                <ul className="space-y-2.5 text-sm sm:text-[15px]">
                                    {m.bullets.map((b, j) => (
                                        <li key={j} className="flex items-start gap-2.5 text-foreground/85">
                                            <CheckCircle2 className={`w-4 h-4 mt-0.5 ${accentText} shrink-0`} />
                                            <span>{b}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div className={`mt-6 inline-flex items-center gap-2 text-sm font-medium ${accentText}`}>
                                    {picked === m.value ? "Working…" : m.cta}
                                    {picked !== m.value && <ArrowRight className="w-4 h-4" />}
                                </div>
                            </motion.button>
                        );
                    })}
                </div>

                <p className="mt-10 text-xs text-muted-foreground inline-flex items-center gap-2">
                    <Sparkles className="w-3 h-3" />
                    Even Pericl cannot read your private reflections unless you choose Cloud Intelligence.
                </p>

                <div className="mt-10 flex justify-end">
                    <Button
                        data-testid="onboarding-skip"
                        variant="ghost"
                        onClick={() => apply("local")}
                        disabled={busy}
                        className="text-muted-foreground"
                    >
                        Skip — keep it private by default
                    </Button>
                </div>
            </div>
        </div>
    );
}
