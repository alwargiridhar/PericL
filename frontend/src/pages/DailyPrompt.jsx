import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Calendar, CheckCircle2, MessageCircle, Trash2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function DailyPrompt() {
    const navigate = useNavigate();
    const [today, setToday] = useState(null);
    const [history, setHistory] = useState([]);
    const [response, setResponse] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState("today");

    useEffect(() => {
        (async () => {
            try {
                const [t, h] = await Promise.all([
                    api.get("/daily-prompt"),
                    api.get("/daily-prompts/history"),
                ]);
                setToday(t.data);
                setResponse(t.data?.response_text || "");
                setHistory(h.data || []);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const submit = async () => {
        if (!response.trim()) return;
        setSubmitting(true);
        try {
            const r = await api.post("/daily-prompt/respond", { response: response.trim() });
            setToday(r.data);
            const h = await api.get("/daily-prompts/history");
            setHistory(h.data || []);
            toast.success("Reflection saved");
        } catch {
            toast.error("Could not save reflection");
        } finally {
            setSubmitting(false);
        }
    };

    const remove = async (id) => {
        try {
            await api.delete(`/daily-prompts/${id}`);
            setHistory((h) => h.filter((p) => p.id !== id));
            toast.success("Removed");
        } catch {
            toast.error("Could not delete");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground" data-testid="daily-prompt-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="prompt-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Daily reflection</span>
                    <div className="ml-auto flex rounded-full bg-muted/60 p-1 text-xs">
                        <button
                            data-testid="prompt-tab-today"
                            onClick={() => setTab("today")}
                            className={`px-3 py-1.5 rounded-full transition-colors ${
                                tab === "today" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
                            }`}
                        >
                            Today
                        </button>
                        <button
                            data-testid="prompt-tab-history"
                            onClick={() => setTab("history")}
                            className={`px-3 py-1.5 rounded-full transition-colors ${
                                tab === "history" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
                            }`}
                        >
                            History
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
                {tab === "today" && today && (
                    <>
                        <div className="space-y-3">
                            <div className="relative w-16 h-16">
                                <div className="absolute inset-0 bg-accent/25 blob" />
                                <div className="absolute inset-0 grid place-items-center">
                                    <Sparkles className="w-6 h-6 text-accent" />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{fmtDate(new Date().toISOString())}</span>
                                <span>·</span>
                                <span>{today.prompt_type}</span>
                            </div>
                            <h1 className="font-display text-2xl sm:text-3xl tracking-tight leading-snug">
                                {today.prompt_text}
                            </h1>
                        </div>

                        <Textarea
                            data-testid="prompt-response"
                            rows={8}
                            value={response}
                            onChange={(e) => setResponse(e.target.value)}
                            disabled={today.is_completed}
                            placeholder="Take a moment to think — write whatever comes up. There&apos;s no right answer."
                            className="resize-none text-base leading-relaxed"
                        />

                        {!today.is_completed ? (
                            <div className="flex gap-2">
                                <Button
                                    data-testid="prompt-submit"
                                    onClick={submit}
                                    disabled={!response.trim() || submitting}
                                    className="flex-1 rounded-full h-11"
                                >
                                    {submitting ? "Saving…" : "Save reflection"}
                                </Button>
                                <Button
                                    data-testid="prompt-discuss"
                                    variant="outline"
                                    onClick={() => navigate("/chat")}
                                    className="rounded-full h-11"
                                >
                                    <MessageCircle className="w-4 h-4 mr-2" />
                                    Talk it out
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-sm text-primary">
                                    <CheckCircle2 className="w-4 h-4" />
                                    Completed at {fmtTime(today.completed_at)}
                                </div>
                                <Button
                                    data-testid="prompt-discuss"
                                    variant="outline"
                                    onClick={() => navigate("/chat")}
                                    className="w-full rounded-full h-11"
                                >
                                    <MessageCircle className="w-4 h-4 mr-2" />
                                    Discuss with PericL
                                </Button>
                            </div>
                        )}

                        <div className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground leading-relaxed">
                            <strong className="text-foreground">Tip.</strong>{" "}
                            Don&apos;t edit yourself. Stream-of-consciousness is the point — patterns emerge over time.
                        </div>
                    </>
                )}

                {tab === "history" && (
                    <div className="space-y-3" data-testid="prompt-history">
                        <h2 className="font-display text-xl">Your reflection journey</h2>
                        {history.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <p>No past reflections yet.</p>
                                <p className="text-sm mt-2">Start today and build a journey worth re-reading.</p>
                            </div>
                        ) : (
                            history.map((p) => (
                                <div
                                    key={p.id}
                                    className={`rounded-2xl border p-4 ${
                                        p.is_completed
                                            ? "bg-primary/5 border-primary/20"
                                            : "bg-muted/30 border-border"
                                    }`}
                                    data-testid={`prompt-history-${p.id}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                                                <Calendar className="w-3 h-3" />
                                                <span>{fmtDate(p.prompt_date)}</span>
                                                {p.is_completed && (
                                                    <CheckCircle2 className="w-3 h-3 text-primary" />
                                                )}
                                            </div>
                                            <p className="text-sm font-medium mt-1.5">{p.prompt_text}</p>
                                            {p.response_text && (
                                                <p className="text-sm text-muted-foreground mt-2 line-clamp-3 whitespace-pre-wrap">
                                                    {p.response_text}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            data-testid={`prompt-delete-${p.id}`}
                                            onClick={() => {
                                                if (window.confirm("Delete this reflection?")) remove(p.id);
                                            }}
                                            className="text-muted-foreground hover:text-destructive p-1"
                                            aria-label="Delete"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
