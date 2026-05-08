import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import Footer from "@/components/Footer";

const FREE_FEATURES = [
    "Voice + text capture",
    "Up to 3 active missions",
    "Up to 5 mirror replies / day",
    "Self-trust + execution scores",
    "On-device drift nudge",
    "MBTI + Big Five (one-time)",
    "Local privacy mode",
];
const PREMIUM_FEATURES = [
    "Unlimited mirror replies",
    "Emotional memory continuity",
    "Cloud sync across devices",
    "Advanced behavioral reports",
    "Personality evolution tracking",
    "Priority drift detection",
    "Long-term insight retention",
];

const REGIONS = [
    { code: "us", label: "🇺🇸 US / Europe", currency: "USD" },
    { code: "in", label: "🇮🇳 India", currency: "INR" },
];

function detectRegion() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        return tz.startsWith("Asia/Kolkata") || tz.startsWith("Asia/Calcutta") ? "in" : "us";
    } catch { return "us"; }
}

function fmtMoney(amt, currency) {
    const sym = currency === "inr" ? "₹" : "$";
    return `${sym}${amt.toFixed(currency === "inr" ? 0 : 2)}`;
}

export default function Pricing() {
    const navigate = useNavigate();
    const [region, setRegion] = useState(detectRegion());
    const [packages, setPackages] = useState([]);
    const [busy, setBusy] = useState(null); // package_id being checked out

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const r = await api.get("/billing/pricing", { params: { region } });
                if (alive) setPackages(r.data?.packages || []);
            } catch {
                if (alive) setPackages([]);
            }
        })();
        return () => { alive = false; };
    }, [region]);

    const checkout = async (pkg) => {
        setBusy(pkg.id);
        try {
            const r = await api.post("/billing/checkout", {
                package_id: pkg.id,
                origin: window.location.origin,
            });
            if (r.data?.url) window.location.href = r.data.url;
            else throw new Error("no_url");
        } catch (e) {
            toast.error("Couldn't start checkout. Try again?");
            setBusy(null);
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="pricing-page">
            <Toaster position="top-center" richColors />
            <div className="pointer-events-none absolute -top-32 -left-32 w-[36rem] h-[36rem] bg-primary/8 blob -z-10" aria-hidden />
            <div className="pointer-events-none absolute top-1/2 -right-32 w-[30rem] h-[30rem] bg-accent/8 blob -z-10" style={{ animationDelay: "-7s" }} aria-hidden />

            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2">
                    <Button data-testid="pricing-back" variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Pricing</span>
                </div>
            </header>

            <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground border border-border/60 rounded-full px-3 py-1.5">
                        <Sparkles className="w-3 h-3 text-accent" /> Premium intelligence
                    </span>
                    <h1 className="mt-5 font-display tracking-tight text-3xl sm:text-5xl leading-[1.05]">
                        Pay for clarity,
                        <br />
                        <span className="italic text-primary">not tokens.</span>
                    </h1>
                    <p className="mt-4 text-muted-foreground leading-relaxed max-w-xl">
                        Pericl runs free for as long as you need it to. Upgrade only when deeper memory and unlimited
                        reflections actually pay you back.
                    </p>
                </motion.div>

                {/* Region picker */}
                <div className="inline-flex p-1 rounded-full bg-muted/60 border border-border/60" data-testid="pricing-region">
                    {REGIONS.map((r) => (
                        <button
                            key={r.code}
                            data-testid={`pricing-region-${r.code}`}
                            onClick={() => setRegion(r.code)}
                            className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                                region === r.code ? "bg-background shadow text-foreground" : "text-muted-foreground"
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                    {/* Free tier */}
                    <div className="rounded-3xl border border-border/60 bg-card/60 p-6 sm:p-8" data-testid="pricing-free">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Free</div>
                        <div className="mt-2 font-display text-3xl tracking-tight">Local Mirror</div>
                        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                            Everything that makes Pericl, Pericl. On-device by default. No card needed.
                        </p>
                        <div className="mt-6 font-display text-3xl tabular-nums">$0<span className="text-base text-muted-foreground"> / forever</span></div>
                        <ul className="mt-6 space-y-2.5 text-sm">
                            {FREE_FEATURES.map((f, i) => (
                                <li key={i} className="flex items-start gap-2.5">
                                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                    <span>{f}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Premium tier */}
                    <div className="rounded-3xl border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-accent/5 p-6 sm:p-8 relative" data-testid="pricing-premium">
                        <div className="absolute -top-3 left-6 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] bg-primary text-primary-foreground rounded-full px-3 py-1">
                            <Sparkles className="w-3 h-3" /> Most chosen
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Premium</div>
                        <div className="mt-2 font-display text-3xl tracking-tight">Cloud Intelligence</div>
                        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                            For the version of you that wants memory, depth, and follow-through across devices.
                        </p>

                        <div className="mt-6 space-y-3">
                            {packages.length === 0 ? (
                                <div className="h-20 rounded-2xl bg-muted/40 animate-pulse" />
                            ) : (
                                packages.map((p) => {
                                    const isYearly = p.interval === "year";
                                    return (
                                        <div
                                            key={p.id}
                                            className="rounded-2xl border border-primary/20 bg-background/60 p-4 flex items-center gap-4"
                                            data-testid={`pricing-pkg-${p.id}`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium">{p.label}</div>
                                                <div className="text-[11px] text-muted-foreground">
                                                    Billed {p.interval}{isYearly ? " · save ~30%" : ""}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-display text-xl tabular-nums">{fmtMoney(p.amount, p.currency)}</div>
                                                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                                    /{p.interval}
                                                </div>
                                            </div>
                                            <Button
                                                data-testid={`pricing-checkout-${p.id}`}
                                                onClick={() => checkout(p)}
                                                disabled={!!busy}
                                                size="sm"
                                                className="rounded-full"
                                            >
                                                {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upgrade"}
                                            </Button>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <ul className="mt-6 space-y-2.5 text-sm">
                            {PREMIUM_FEATURES.map((f, i) => (
                                <li key={i} className="flex items-start gap-2.5">
                                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                    <span>{f}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed inline-flex items-start gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <span>
                        Even on Premium, no admin can read your private journals or chats — that&rsquo;s enforced server-side.
                        Cancel anytime; your data comes home with you.
                    </span>
                </div>
            </main>
            <Footer />
        </div>
    );
}
