import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Trash2, Sparkles, Brain } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function AiChat() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [profile, setProfile] = useState(null);
    const [personality, setPersonality] = useState(null);
    const endRef = useRef(null);

    useEffect(() => {
        (async () => {
            try {
                const [m, p, pa] = await Promise.all([
                    api.get("/ai/messages"),
                    api.get("/profile"),
                    api.get("/personality/latest"),
                ]);
                setMessages(m.data || []);
                setProfile(p.data || null);
                setPersonality(pa.data || null);
            } catch {}
        })();
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    const send = async () => {
        const t = input.trim();
        if (!t || loading) return;
        setInput("");
        setLoading(true);
        const optimistic = {
            id: `tmp-${Date.now()}`,
            role: "user",
            content: t,
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimistic]);
        try {
            const r = await api.post("/ai/chat", { message: t });
            const { user_message, assistant_message } = r.data;
            setMessages((prev) => [
                ...prev.filter((m) => m.id !== optimistic.id),
                user_message,
                assistant_message,
            ]);
        } catch {
            toast.error("Couldn't reach PericL. Try again?");
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        } finally {
            setLoading(false);
        }
    };

    const clearAll = async () => {
        try {
            await api.delete("/ai/messages");
            setMessages([]);
            toast.success("Chat cleared");
        } catch {
            toast.error("Could not clear");
        }
    };

    const showOnboarding = messages.length === 0;
    const needsAssessment = !personality?.hasAssessment;

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground">
            <Toaster position="top-center" richColors />

            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
                    <Button
                        data-testid="chat-back-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="leading-tight">
                        <div className="font-display text-base font-medium">Talk to PericL</div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            personal assistant · friend
                        </div>
                    </div>
                    <div className="ml-auto">
                        {messages.length > 0 && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        data-testid="chat-clear-btn"
                                        variant="ghost"
                                        size="icon"
                                        className="rounded-full"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will permanently delete all messages with PericL. This can&apos;t be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={clearAll}
                                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                                            data-testid="chat-clear-confirm"
                                        >
                                            Clear
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-2xl w-full mx-auto px-4 pt-6 pb-32" data-testid="chat-messages">
                {showOnboarding && (
                    <div className="text-center py-10">
                        <div className="relative w-32 h-32 mx-auto mb-6">
                            <div className="absolute inset-0 bg-primary/15 blob" />
                            <div className="absolute inset-0 grid place-items-center">
                                <Sparkles className="w-8 h-8 text-primary" />
                            </div>
                        </div>
                        <h2 className="font-display text-3xl">Hey {user?.name?.split(" ")[0] || "there"}.</h2>
                        <p className="text-muted-foreground mt-3 max-w-md mx-auto leading-relaxed">
                            I&apos;m your assistant and a quiet friend. Tell me what&apos;s on your mind, ask me to help plan,
                            vent, or just think out loud.
                        </p>
                        {needsAssessment && (
                            <button
                                data-testid="chat-cta-personality"
                                onClick={() => navigate("/personality/assessment")}
                                className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-accent text-accent-foreground text-sm font-medium"
                            >
                                <Brain className="w-4 h-4" />
                                Take the 5-min personality test for richer chats
                            </button>
                        )}
                    </div>
                )}

                <div className="space-y-3">
                    {messages.map((m) => (
                        <div
                            key={m.id}
                            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-float-in`}
                            data-testid={`chat-msg-${m.role}`}
                        >
                            <div
                                className={`max-w-[85%] px-4 py-3 ${
                                    m.role === "user" ? "bubble-mine" : "bubble-them"
                                }`}
                            >
                                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</p>
                                <p className={`text-[11px] mt-1 ${m.role === "user" ? "opacity-70" : "text-muted-foreground"}`}>
                                    {fmtTime(m.created_at)}
                                </p>
                            </div>
                        </div>
                    ))}
                    {loading && (
                        <div className="flex justify-start animate-float-in">
                            <div className="bubble-them px-4 py-3">
                                <div className="flex gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "120ms" }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "240ms" }} />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>
            </main>

            <div className="sticky bottom-0 pb-4 pt-2">
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none" />
                <div className="relative max-w-2xl mx-auto px-4">
                    <div className="glass rounded-3xl p-2 flex items-end gap-2 shadow-xl shadow-black/5">
                        <textarea
                            data-testid="chat-input"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    send();
                                }
                            }}
                            placeholder={profile?.onboarding_completed ? "What's on your mind?" : "Tell me about yourself…"}
                            rows={1}
                            className="flex-1 resize-none bg-transparent border-0 focus:outline-none px-3 py-3 text-base placeholder:text-muted-foreground max-h-32"
                        />
                        <Button
                            data-testid="chat-send"
                            onClick={send}
                            disabled={!input.trim() || loading}
                            size="icon"
                            className="rounded-full h-12 w-12 shrink-0"
                        >
                            <Send className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
