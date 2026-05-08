import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Toaster } from "sonner";
import {
    Target, Sparkles, Mic, ArrowRight, BookOpen, MessageCircle, Search,
    Compass, TrendingUp, ShieldCheck, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useStorage } from "@/contexts/StorageContext";
import { getTodayInsights } from "@/lib/behavioral_engine";
import { isEncryptionActive } from "@/lib/storage";

function ScoreRing({ value, label, sub, accent = "primary", testid }) {
    const v = Math.max(0, Math.min(100, Math.round(value || 0)));
    const r = 40;
    const c = 2 * Math.PI * r;
    const offset = c - (v / 100) * c;
    const stroke = accent === "primary" ? "hsl(var(--primary))" : "hsl(var(--accent))";
    return (
        <div className="rounded-3xl border border-border/60 bg-card/60 p-5 sm:p-6 flex items-center gap-4" data-testid={testid}>
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
                    <motion.circle
                        cx="50" cy="50" r={r}
                        fill="none"
                        stroke={stroke}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={c}
                        initial={{ strokeDashoffset: c }}
                        animate={{ strokeDashoffset: offset }}
                        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                    />
                </svg>
                <div className="absolute inset-0 grid place-items-center">
                    <span className="font-display text-2xl tabular-nums">{v}</span>
                </div>
            </div>
            <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
                <div className="text-sm leading-relaxed text-foreground/85 mt-1">{sub}</div>
            </div>
        </div>
    );
}

function MissionCard({ m, onClick }) {
    const stats = m.stats || {};
    const pct = Math.round(stats.percent_complete || 0);
    return (
        <button
            onClick={onClick}
            data-testid={`home-mission-${m.id}`}
            className="text-left rounded-3xl border border-border/60 bg-card/60 p-5 hover:border-primary/40 transition-colors w-full"
        >
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-accent/15 grid place-items-center shrink-0">
                    <Target className="w-4 h-4 text-accent" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Active mission · {stats.days_remaining ?? "?"}d left
                    </div>
                    <div className="font-display text-lg tracking-tight mt-0.5 truncate">
                        {m.outcome || m.title || "Mission"}
                    </div>
                    <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                            className="h-full bg-primary rounded-full"
                        />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{pct}%</span>
                        <span className="capitalize">pace · {(stats.pace || "—").replace("_", " ")}</span>
                    </div>
                </div>
            </div>
        </button>
    );
}

export default function Home() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { mode } = useStorage();
    const [data, setData] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const d = await getTodayInsights({ mode });
                if (alive) setData(d);
            } catch {
                if (alive) setError(true);
            }
        })();
        return () => { alive = false; };
    }, [mode]);

    const firstName = (user?.name || "").split(" ")[0] || "you";
    const identity = useMemo(() => {
        const m = data?.missions?.[0];
        if (m) return m.outcome || m.title;
        return "the person you said you wanted to become.";
    }, [data]);

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="home-page">
            <Toaster position="top-center" richColors />
            <Header />

            <main className="relative z-10 flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 pt-6 pb-16 space-y-5">
                {/* Identity Header */}
                <motion.section
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="pt-2 pb-2"
                    data-testid="home-identity"
                >
                    <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                        Who am I becoming
                    </div>
                    <h1 className="mt-1.5 font-display text-3xl sm:text-4xl tracking-tight leading-[1.1]">
                        {firstName},{" "}
                        <span className="italic text-primary">{identity}</span>
                    </h1>
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                            <ShieldCheck className="w-3 h-3 text-primary" />
                            {mode === "cloud" ? "Cloud intelligence" : "On-device only"}
                        </span>
                        {isEncryptionActive() && mode !== "cloud" && (
                            <span className="inline-flex items-center gap-1.5">
                                <Lock className="w-3 h-3 text-primary" />
                                Encrypted on this device
                            </span>
                        )}
                    </div>
                </motion.section>

                {/* Drift insight + Next move */}
                {data ? (
                    <>
                        {data.scores?.drift_signal && (
                            <motion.section
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.05, duration: 0.5 }}
                                className="rounded-3xl border border-accent/30 bg-accent/5 p-5"
                                data-testid="home-drift-card"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-accent/15 grid place-items-center shrink-0">
                                        <Compass className="w-4 h-4 text-accent" strokeWidth={1.7} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                            Where you&rsquo;re drifting
                                        </div>
                                        <p className="text-base sm:text-lg leading-relaxed mt-1 text-foreground/90">
                                            {data.scores.drift_signal}
                                        </p>
                                    </div>
                                </div>
                            </motion.section>
                        )}

                        {data.next_move && (
                            <motion.section
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1, duration: 0.5 }}
                                className="rounded-3xl border border-primary/30 bg-primary/5 p-5 sm:p-6"
                                data-testid="home-next-move"
                            >
                                <div className="text-[10px] uppercase tracking-[0.22em] text-primary inline-flex items-center gap-1.5">
                                    <Target className="w-3 h-3" /> Next move
                                </div>
                                <h2 className="mt-2 font-display text-2xl tracking-tight leading-snug">
                                    {data.next_move.headline}
                                </h2>
                                <p className="mt-3 text-[15px] leading-relaxed">{data.next_move.action}</p>
                                {data.next_move.anchor && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        For: {data.next_move.anchor}
                                    </p>
                                )}
                                <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
                                    <Button
                                        data-testid="home-act-mirror"
                                        onClick={() => navigate("/chat")}
                                        className="rounded-full sm:flex-1 gap-2"
                                    >
                                        Talk it out · Mirror
                                        <ArrowRight className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        data-testid="home-act-capture"
                                        variant="outline"
                                        onClick={() => navigate("/journal")}
                                        className="rounded-full sm:flex-1 gap-2"
                                    >
                                        <Mic className="w-4 h-4" /> Capture a thought
                                    </Button>
                                </div>
                            </motion.section>
                        )}

                        {/* Scores */}
                        <motion.section
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15, duration: 0.5 }}
                            className="grid sm:grid-cols-2 gap-4"
                            data-testid="home-scores"
                        >
                            <ScoreRing
                                value={data.scores?.self_trust}
                                label="Self-trust"
                                sub="how often you actually do what you said mattered"
                                accent="primary"
                                testid="score-self-trust"
                            />
                            <ScoreRing
                                value={data.scores?.execution}
                                label="Execution"
                                sub="follow-through on tasks, reminders, captures"
                                accent="accent"
                                testid="score-execution"
                            />
                        </motion.section>

                        {/* Missions */}
                        {(data.missions || []).length > 0 && (
                            <motion.section
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2, duration: 0.5 }}
                                className="space-y-3"
                                data-testid="home-missions"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                        Active missions
                                    </div>
                                    <button
                                        data-testid="home-missions-link"
                                        onClick={() => navigate("/missions")}
                                        className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                                    >
                                        Manage <ArrowRight className="w-3 h-3" />
                                    </button>
                                </div>
                                <div className="space-y-2.5">
                                    {data.missions.slice(0, 3).map((m) => (
                                        <MissionCard key={m.id} m={m} onClick={() => navigate("/missions")} />
                                    ))}
                                </div>
                            </motion.section>
                        )}

                        {/* Quick actions */}
                        <motion.section
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.25, duration: 0.5 }}
                            className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
                            data-testid="home-quick-actions"
                        >
                            {[
                                { Icon: BookOpen, label: "Journal", to: "/journal", testid: "quick-journal" },
                                { Icon: MessageCircle, label: "Mirror", to: "/chat", testid: "quick-chat" },
                                { Icon: TrendingUp, label: "Profile", to: "/profile", testid: "quick-profile" },
                                { Icon: Search, label: "Search", to: "/search", testid: "quick-search" },
                            ].map((q) => (
                                <button
                                    key={q.to}
                                    data-testid={q.testid}
                                    onClick={() => navigate(q.to)}
                                    className="rounded-2xl border border-border/60 bg-card/40 p-4 hover:border-primary/40 transition-colors text-center"
                                >
                                    <q.Icon className="w-4 h-4 mx-auto text-muted-foreground" />
                                    <div className="mt-1.5 text-xs">{q.label}</div>
                                </button>
                            ))}
                        </motion.section>
                    </>
                ) : error ? (
                    <p className="text-sm text-muted-foreground py-12 text-center">
                        Couldn&rsquo;t load your insights. <button onClick={() => window.location.reload()} className="underline">Try again</button>.
                    </p>
                ) : (
                    <div className="space-y-3 animate-pulse">
                        <div className="h-32 rounded-3xl bg-muted/40" />
                        <div className="h-24 rounded-3xl bg-muted/40" />
                        <div className="h-24 rounded-3xl bg-muted/40" />
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
}
