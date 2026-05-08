import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { Sparkles, ArrowUpRight, Loader2 } from "lucide-react";
import { useStorage } from "@/contexts/StorageContext";
import { api } from "@/lib/api";

const TRAITS = ["O", "C", "E", "A", "N"];
const TRAIT_NAMES = { O: "Openness", C: "Conscientiousness", E: "Extraversion", A: "Agreeableness", N: "Neuroticism" };

function fmtMonth(iso) {
    if (!iso) return "";
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch { return ""; }
}

/**
 * PersonalityEvolution — shows up to last 6 retakes and computes deltas.
 */
export default function PersonalityEvolution() {
    const { mode, loading: storageLoading } = useStorage();
    const [items, setItems] = useState(null);

    useEffect(() => {
        if (storageLoading) return;
        let alive = true;
        (async () => {
            try {
                if (mode === "cloud") {
                    const r = await api.get("/personality/history");
                    if (alive) setItems(r.data || []);
                } else {
                    // local mode — pull from localStorage
                    let arr = [];
                    try { arr = JSON.parse(localStorage.getItem("pericl.personality") || "[]"); } catch {}
                    if (alive) setItems(arr);
                }
            } catch {
                if (alive) setItems([]);
            }
        })();
        return () => { alive = false; };
    }, [mode, storageLoading]);

    // Group by framework
    const groups = useMemo(() => {
        if (!items) return null;
        const out = { mbti: [], big_five: [] };
        for (const it of items) {
            const f = it.framework || (it.scores && Object.keys(it.scores).length === 5 ? "big_five" : "mbti");
            if (out[f]) out[f].push(it);
        }
        Object.values(out).forEach((arr) => arr.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")));
        return out;
    }, [items]);

    if (items === null) {
        return (
            <div className="rounded-3xl border border-border bg-card p-8 grid place-items-center" data-testid="personality-evolution-loading">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
        );
    }

    const empty = (groups?.mbti?.length || 0) + (groups?.big_five?.length || 0) < 2;
    if (empty) {
        return (
            <div className="rounded-3xl border border-border/60 bg-card/60 p-6" data-testid="personality-evolution-empty">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-accent/10 grid place-items-center shrink-0">
                        <Sparkles className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                        <div className="font-display text-lg tracking-tight">Personality evolution</div>
                        <div className="text-xs text-muted-foreground">
                            Take an assessment twice to see how you&rsquo;ve shifted.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const big5 = groups.big_five || [];
    const mbti = groups.mbti || [];

    // Big Five chart series
    const big5Data = big5.map((doc) => {
        const row = { date: fmtMonth(doc.created_at) };
        for (const t of TRAITS) row[TRAIT_NAMES[t]] = doc.scores?.[t] || 0;
        return row;
    });

    // MBTI evolution: list types over time and compute changes
    const mbtiTimeline = mbti.map((doc) => ({
        date: fmtMonth(doc.created_at),
        type: doc.personality_type || "—",
    }));

    return (
        <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-6" data-testid="personality-evolution">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-accent/10 grid place-items-center shrink-0">
                    <ArrowUpRight className="w-4 h-4 text-accent" strokeWidth={1.7} />
                </div>
                <div>
                    <div className="font-display text-lg tracking-tight">How you&rsquo;ve shifted</div>
                    <div className="text-xs text-muted-foreground">{items.length} assessment{items.length === 1 ? "" : "s"} on file</div>
                </div>
            </div>

            {big5.length >= 2 && (
                <div data-testid="personality-evolution-big5">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-2">
                        Big Five over time
                    </div>
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={big5Data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                {TRAITS.map((t, i) => (
                                    <Line
                                        key={t}
                                        type="monotone"
                                        dataKey={TRAIT_NAMES[t]}
                                        stroke={["hsl(var(--primary))", "hsl(var(--accent))", "#7e8bef", "#e36a8d", "#7c8db0"][i]}
                                        strokeWidth={2}
                                        dot={{ r: 2 }}
                                        activeDot={{ r: 5 }}
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    {big5.length >= 2 && (
                        <ul className="mt-4 space-y-1.5 text-sm" data-testid="personality-evolution-deltas">
                            {TRAITS.map((t) => {
                                const first = big5[0].scores?.[t] || 0;
                                const last = big5[big5.length - 1].scores?.[t] || 0;
                                const d = last - first;
                                if (Math.abs(d) < 5) return null;
                                const phrase =
                                    t === "C" && d > 0 ? "more disciplined" :
                                    t === "N" && d < 0 ? "more emotionally stable" :
                                    t === "E" && d > 0 ? "more outwardly energised" :
                                    t === "A" && d > 0 ? "warmer toward others" :
                                    t === "O" && d > 0 ? "more open to ideas" :
                                    `${d > 0 ? "increased" : "decreased"} on ${TRAIT_NAMES[t]}`;
                                return (
                                    <li key={t} className="text-foreground/85 flex items-center gap-2">
                                        <span className={`tabular-nums w-12 text-xs ${d > 0 ? "text-primary" : "text-accent"}`}>
                                            {d > 0 ? "+" : ""}{d}
                                        </span>
                                        You&rsquo;ve become {phrase}.
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {mbti.length >= 2 && (
                <div data-testid="personality-evolution-mbti">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-2">
                        MBTI timeline
                    </div>
                    <ol className="relative pl-5 space-y-3 border-l border-border/50">
                        {mbtiTimeline.map((row, i) => (
                            <li key={i} className="text-sm">
                                <span className="absolute -left-[5px] mt-1 w-2.5 h-2.5 rounded-full bg-primary" />
                                <span className="text-muted-foreground text-xs mr-2">{row.date}</span>
                                <span className="font-display tracking-tight">{row.type}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}
