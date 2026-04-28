import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Loader2 } from "lucide-react";
import { mood as moodStore } from "@/lib/storage";
import { useStorage } from "@/contexts/StorageContext";

// Numeric mapping so we can plot moods on a single axis (low energy → high energy).
const MOOD_VALUE = {
    sad: 1,
    stressed: 2,
    neutral: 3,
    calm: 4,
    focused: 5,
    happy: 6,
    excited: 7,
};
const MOOD_COLOR = {
    sad: "#7c8db0",
    stressed: "#d97757",
    neutral: "#9ca3af",
    calm: "#6ea3c7",
    focused: "#7e8bef",
    happy: "#f1c869",
    excited: "#e36a8d",
};

function dayKey(iso) {
    return new Date(iso).toISOString().slice(0, 10);
}

export default function MoodChart({ days = 30 }) {
    const [items, setItems] = useState(null);
    const { loading: storageLoading, mode } = useStorage();

    useEffect(() => {
        if (storageLoading) return;
        let alive = true;
        (async () => {
            try {
                const r = await moodStore.timeline(days);
                if (alive) setItems(r || []);
            } catch {
                if (alive) setItems([]);
            }
        })();
        return () => { alive = false; };
    }, [days, storageLoading, mode]);

    const data = useMemo(() => {
        if (!items) return null;
        // Group by day, average the mood value, count entries.
        const byDay = new Map();
        for (const it of items) {
            const k = dayKey(it.created_at);
            const v = MOOD_VALUE[it.mood] || 3;
            const cur = byDay.get(k) || { day: k, sum: 0, n: 0, moods: {} };
            cur.sum += v;
            cur.n += 1;
            cur.moods[it.mood] = (cur.moods[it.mood] || 0) + 1;
            byDay.set(k, cur);
        }
        // Fill missing days with null (chart will leave gaps but still render axis)
        const out = [];
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const k = d.toISOString().slice(0, 10);
            const e = byDay.get(k);
            const dominant = e
                ? Object.entries(e.moods).sort((a, b) => b[1] - a[1])[0][0]
                : null;
            out.push({
                day: k.slice(5), // MM-DD
                value: e ? Math.round((e.sum / e.n) * 10) / 10 : null,
                count: e ? e.n : 0,
                dominant,
            });
        }
        return out;
    }, [items, days]);

    if (items === null) {
        return (
            <div className="rounded-3xl border border-border bg-card p-8 grid place-items-center" data-testid="mood-chart-loading">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
        );
    }
    const hasData = items.length > 0;

    return (
        <div className="rounded-3xl border border-border bg-card p-5" data-testid="mood-chart">
            <div className="flex items-baseline justify-between mb-4">
                <div>
                    <h3 className="font-display text-lg">Mood, last {days} days</h3>
                    <p className="text-xs text-muted-foreground">
                        Higher = more activated. Lower = quieter or heavier.
                    </p>
                </div>
                <div className="text-[11px] text-muted-foreground">
                    {items.length} {items.length === 1 ? "entry" : "entries"}
                </div>
            </div>
            {!hasData ? (
                <p className="text-sm text-muted-foreground py-10 text-center" data-testid="mood-chart-empty">
                    Capture a few thoughts and a shape will start to emerge here.
                </p>
            ) : (
                <div className="h-56" data-testid="mood-chart-area">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                            <defs>
                                <linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                            <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <YAxis
                                domain={[1, 7]}
                                ticks={[1, 3, 5, 7]}
                                tickFormatter={(v) => ({ 1: "low", 3: "calm", 5: "focus", 7: "high" }[v] || "")}
                                tick={{ fontSize: 10 }}
                                stroke="hsl(var(--muted-foreground))"
                            />
                            <Tooltip
                                contentStyle={{
                                    background: "hsl(var(--popover))",
                                    border: "1px solid hsl(var(--border))",
                                    borderRadius: 12,
                                    fontSize: 12,
                                }}
                                formatter={(v, _k, p) => {
                                    if (v == null) return ["—", "no entries"];
                                    const m = p?.payload?.dominant;
                                    return [
                                        m ? `${m} (${p.payload.count})` : `${v}`,
                                        "mood",
                                    ];
                                }}
                                labelFormatter={(l) => `Day ${l}`}
                            />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke="hsl(var(--primary))"
                                strokeWidth={2}
                                fill="url(#moodFill)"
                                connectNulls
                                dot={(props) => {
                                    const { cx, cy, payload } = props;
                                    if (cy == null || payload?.value == null) return null;
                                    const c = MOOD_COLOR[payload.dominant] || "hsl(var(--primary))";
                                    return <circle cx={cx} cy={cy} r={3} fill={c} stroke="white" strokeWidth={1} />;
                                }}
                                activeDot={{ r: 5 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
