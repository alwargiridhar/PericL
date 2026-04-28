import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search as SearchIcon, FileText, Mic, ListTodo, Bell, Lightbulb, MessageCircle } from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { search as searchStore } from "@/lib/storage";
import Footer from "@/components/Footer";

const TYPE_ICON = {
    voice: Mic, text: FileText, task: ListTodo, reminder: Bell, idea: Lightbulb,
};

function fmtRelative(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function highlight(text, q) {
    if (!text || !q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
        <>
            {text.slice(0, idx)}
            <mark className="bg-primary/25 text-foreground rounded px-0.5">
                {text.slice(idx, idx + q.length)}
            </mark>
            {text.slice(idx + q.length)}
        </>
    );
}

export default function SearchPage() {
    const navigate = useNavigate();
    const [q, setQ] = useState("");
    const [results, setResults] = useState({ journal: [], chat: [] });
    const [busy, setBusy] = useState(false);
    const debounceRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const t = q.trim();
        if (!t) { setResults({ journal: [], chat: [] }); return; }
        setBusy(true);
        debounceRef.current = setTimeout(async () => {
            try {
                const r = await searchStore.query(t);
                setResults(r || { journal: [], chat: [] });
            } catch { /* ignore */ }
            finally { setBusy(false); }
        }, 220);
        return () => debounceRef.current && clearTimeout(debounceRef.current);
    }, [q]);

    const total = useMemo(
        () => (results.journal?.length || 0) + (results.chat?.length || 0),
        [results]
    );

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="search-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="search-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(-1)}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="relative flex-1">
                        <SearchIcon className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={inputRef}
                            data-testid="search-input"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search your thoughts, tasks, chats…"
                            className="pl-11 h-11 rounded-full"
                        />
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
                {!q.trim() ? (
                    <p className="text-sm text-muted-foreground py-12 text-center">
                        Search across your journal entries and conversations with yourself.
                    </p>
                ) : busy && total === 0 ? (
                    <p className="text-sm text-muted-foreground py-12 text-center">Searching…</p>
                ) : total === 0 ? (
                    <div data-testid="search-results">
                        <p className="text-sm text-muted-foreground py-12 text-center" data-testid="search-empty">
                            Nothing here for &ldquo;{q.trim()}&rdquo;.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6" data-testid="search-results">
                        {!!results.journal?.length && (
                            <section>
                                <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
                                    Journal · {results.journal.length}
                                </h2>
                                <div className="space-y-2">
                                    {results.journal.map((it) => {
                                        const Icon = TYPE_ICON[it.type] || FileText;
                                        const text = it.transcription || it.detail || it.title || it.summary || "";
                                        return (
                                            <button
                                                key={it.id}
                                                data-testid={`search-result-journal-${it.id}`}
                                                onClick={() => navigate("/")}
                                                className="w-full text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors flex items-start gap-3"
                                            >
                                                <div className="w-9 h-9 rounded-xl bg-muted grid place-items-center shrink-0">
                                                    <Icon className="w-4 h-4 text-primary" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                                                        {it.type} · {fmtRelative(it.created_at)}
                                                    </div>
                                                    <p className="text-sm leading-relaxed line-clamp-3">
                                                        {highlight(text, q.trim())}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        )}
                        {!!results.chat?.length && (
                            <section>
                                <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
                                    Conversations · {results.chat.length}
                                </h2>
                                <div className="space-y-2">
                                    {results.chat.map((m) => (
                                        <button
                                            key={m.id}
                                            data-testid={`search-result-chat-${m.id}`}
                                            onClick={() => navigate("/chat")}
                                            className="w-full text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors flex items-start gap-3"
                                        >
                                            <div className="w-9 h-9 rounded-xl bg-muted grid place-items-center shrink-0">
                                                <MessageCircle className="w-4 h-4 text-accent" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                                                    {m.role === "user" ? "you" : "your inner voice"} · {fmtRelative(m.created_at)}
                                                </div>
                                                <p className="text-sm leading-relaxed line-clamp-3">
                                                    {highlight(m.content, q.trim())}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
}
