import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, ShieldCheck, Loader2, ArrowRight, Crown } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Footer from "@/components/Footer";

const POLL_TIMES = [0, 1500, 3000, 5000, 8000, 12000]; // ms total: 12s

function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "—"; }
}

export default function Account() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { user, refresh } = useAuth();
    const [billing, setBilling] = useState(null);
    const [pollState, setPollState] = useState(null); // null | "polling" | "paid" | "expired"

    const sessionId = params.get("session_id");

    const loadBilling = async () => {
        try {
            const r = await api.get("/billing/me");
            setBilling(r.data);
        } catch { /* ignore */ }
    };

    useEffect(() => { loadBilling(); refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    // Poll Stripe checkout status if we just returned from a successful flow
    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        setPollState("polling");
        (async () => {
            for (let i = 0; i < POLL_TIMES.length; i++) {
                if (i > 0) await new Promise((r) => setTimeout(r, POLL_TIMES[i]));
                if (cancelled) return;
                try {
                    const r = await api.get(`/billing/status/${sessionId}`);
                    if (r.data?.payment_status === "paid") {
                        setPollState("paid");
                        await loadBilling();
                        await refresh();
                        toast.success("Welcome to Premium ✨");
                        return;
                    }
                    if (r.data?.status === "expired") {
                        setPollState("expired");
                        return;
                    }
                } catch { /* keep polling */ }
            }
            if (!cancelled) setPollState("timeout");
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    const isPremium = !!billing?.is_premium;
    const planLabel = billing?.plan === "premium_yearly"
        ? "Premium · Yearly"
        : billing?.plan === "premium_monthly"
        ? "Premium · Monthly"
        : "Free · Local Mirror";

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="account-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2">
                    <Button data-testid="account-back" variant="ghost" size="icon" onClick={() => navigate("/")} className="rounded-full">
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Account</span>
                </div>
            </header>

            <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
                {sessionId && pollState === "polling" && (
                    <div className="rounded-2xl border border-border/60 bg-card p-5 flex items-center gap-3" data-testid="account-polling">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <div className="text-sm">Confirming your payment…</div>
                    </div>
                )}
                {sessionId && pollState === "paid" && (
                    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5" data-testid="account-paid-banner">
                        <div className="flex items-center gap-3">
                            <Crown className="w-5 h-5 text-primary" />
                            <div className="font-display text-lg">You&rsquo;re premium now.</div>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Memory continuity, unlimited mirror replies, advanced reports — all unlocked.
                        </p>
                    </div>
                )}

                <div className="rounded-3xl border border-border/60 bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                Signed in as
                            </div>
                            <div className="font-display text-xl tracking-tight mt-0.5 truncate">
                                {user?.name || "—"}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                                {user?.email || "—"}
                            </div>
                        </div>
                        {isPremium && (
                            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] bg-primary/10 text-primary rounded-full px-3 py-1">
                                <Crown className="w-3 h-3" /> Premium
                            </span>
                        )}
                    </div>
                </div>

                <div className="rounded-3xl border border-border/60 bg-card p-6" data-testid="account-plan">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Plan</div>
                    <div className="font-display text-xl tracking-tight mt-0.5">{planLabel}</div>
                    {isPremium && billing?.plan_renews_at && (
                        <div className="text-xs text-muted-foreground mt-1">
                            Renews on {fmtDate(billing.plan_renews_at)}
                        </div>
                    )}
                    {!isPremium && (
                        <>
                            {billing?.limits && (
                                <div className="mt-4 space-y-2 text-sm">
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">Mirror replies today</span>
                                        <span className="tabular-nums">
                                            {billing.limits.mirror_remaining_today ?? 0} / {billing.limits.mirror_daily_limit ?? 5}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">Active missions</span>
                                        <span className="tabular-nums">
                                            {billing.limits.active_missions ?? 0} / {billing.limits.max_active_missions ?? 3}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <Button
                                data-testid="account-upgrade"
                                onClick={() => navigate("/pricing")}
                                className="mt-5 rounded-full gap-2"
                            >
                                <Sparkles className="w-4 h-4" />
                                Upgrade to Premium
                                <ArrowRight className="w-4 h-4" />
                            </Button>
                        </>
                    )}
                </div>

                <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed inline-flex items-start gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <span>
                        Cloud Intelligence is opt-in. Admins can never see your journals or chats. Cancel anytime;
                        your data comes home with you.
                    </span>
                </div>
            </main>
            <Footer />
        </div>
    );
}
