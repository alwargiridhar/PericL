import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Bell } from "lucide-react";
import { Toaster, toast } from "sonner";
import Header from "@/components/Header";
import VoiceDock from "@/components/VoiceDock";
import TimelineItem from "@/components/TimelineItem";
import RecapDrawer from "@/components/RecapDrawer";
import Footer from "@/components/Footer";
import CloudSyncPrompt from "@/components/CloudSyncPrompt";
import { journal } from "@/lib/storage";
import usePushReminders, { pushPermission, requestPushPermission } from "@/hooks/usePushReminders";

export default function Journal() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState("voice");
    const [recapOpen, setRecapOpen] = useState(false);
    const [recap, setRecap] = useState(null);
    const [recapBusy, setRecapBusy] = useState(false);
    const firedRemindersRef = useRef(new Set());
    const listEndRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const items = await journal.list();
            setItems(items || []);
        } catch {
            // 401 handled by interceptor / route
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // In-app reminder polling
    useEffect(() => {
        const id = setInterval(() => {
            const now = Date.now();
            for (const it of items) {
                if (
                    it.type === "reminder" &&
                    !it.completed &&
                    it.due_at &&
                    !firedRemindersRef.current.has(it.id)
                ) {
                    const t = new Date(it.due_at).getTime();
                    if (t <= now) {
                        firedRemindersRef.current.add(it.id);
                        toast(it.title, {
                            description: "Reminder is due",
                            action: {
                                label: "Done",
                                onClick: async () => {
                                    await journal.update(it.id, { completed: true });
                                    load();
                                },
                            },
                            duration: 12000,
                        });
                    }
                }
            }
        }, 20000);
        return () => clearInterval(id);
    }, [items, load]);

    const sendVoice = async ({ blob, duration, transcript }) => {
        setBusy(true);
        try {
            const data = await journal.createVoice({ blob, duration, transcript });
            const note = data?.note;
            const extracted = data?.extracted || [];
            setItems((prev) => [...[...extracted].reverse(), note, ...prev]);
            toast.success(extracted.length ? `Saved + ${extracted.length} item${extracted.length > 1 ? "s" : ""}` : "Saved");
            if (data?.mission_progress) {
                const p = data.mission_progress;
                toast(`+${Math.round(p.units)} ${p.unit_label || ""} logged toward your mission`, { duration: 4000 });
            }
        } catch {
            toast.error("Could not save voice note");
        } finally {
            setBusy(false);
        }
    };

    const sendText = async (text) => {
        setBusy(true);
        try {
            const data = await journal.createText(text);
            const note = data?.note;
            const extracted = data?.extracted || [];
            setItems((prev) => [...[...extracted].reverse(), note, ...prev]);
            if (extracted.length) toast.success(`Sorted into ${extracted.length} item${extracted.length > 1 ? "s" : ""}`);
            if (data?.mission_progress) {
                const p = data.mission_progress;
                toast(`+${Math.round(p.units)} ${p.unit_label || ""} logged toward your mission`, { duration: 4000 });
            }
        } catch {
            toast.error("Could not save note");
        } finally {
            setBusy(false);
        }
    };

    const toggleItem = async (item) => {
        try {
            const updated = await journal.update(item.id, { completed: !item.completed });
            setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
        } catch {
            toast.error("Could not update");
        }
    };

    const deleteItem = async (item) => {
        try {
            await journal.delete(item.id);
            setItems((prev) => prev.filter((i) => i.id !== item.id));
            toast.success("Removed");
        } catch {
            toast.error("Could not delete");
        }
    };

    const snoozeItem = async (item, at) => {
        try {
            const updated = await journal.update(item.id, { due_at: at.toISOString() });
            setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
            firedRemindersRef.current.delete(item.id);
            toast.success(`Snoozed to ${at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
        } catch {
            toast.error("Could not snooze");
        }
    };

    // Native push notifications for upcoming reminders (foreground)
    usePushReminders(items, (it) => {
        firedRemindersRef.current.add(it.id);
    });

    const [pushPerm, setPushPerm] = useState(() => pushPermission());
    const enablePush = useCallback(async () => {
        const r = await requestPushPermission();
        setPushPerm(r);
        if (r === "granted") toast.success("Reminders will notify you here");
        else if (r === "denied") toast("Notifications blocked — enable them from your browser settings");
    }, []);
    const showPushBanner = useMemo(() => {
        if (pushPerm !== "default") return false;
        return (items || []).some((i) => i.type === "reminder" && !i.completed && i.due_at);
    }, [items, pushPerm]);

    const empty = !loading && items.length === 0;

    return (
        <div className="relative flex flex-col min-h-screen bg-background text-foreground">
            <Toaster position="top-center" richColors closeButton />

            {/* Soft ambient blob */}
            <div className="pointer-events-none fixed -top-40 -right-32 w-[28rem] h-[28rem] bg-primary/8 blob -z-0" aria-hidden />

            <Header onOpenRecaps={() => setRecapOpen(true)} />

            <main className="relative z-10 flex-1 max-w-2xl w-full mx-auto px-4 pt-6 pb-40">
                {showPushBanner && (
                    <button
                        data-testid="push-banner"
                        onClick={enablePush}
                        className="w-full mb-4 rounded-2xl border border-accent/30 bg-accent/10 hover:bg-accent/15 transition-colors px-4 py-3 text-left flex items-center gap-3"
                    >
                        <div className="w-9 h-9 rounded-xl bg-accent/15 grid place-items-center shrink-0">
                            <Bell className="w-4 h-4 text-accent" />
                        </div>
                        <div className="text-sm leading-snug">
                            <div className="font-medium">Get notified when reminders are due</div>
                            <div className="text-xs text-muted-foreground">Browser-only · stays on this device</div>
                        </div>
                    </button>
                )}
                {loading ? (
                    <div className="grid place-items-center py-24">
                        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    </div>
                ) : empty ? (
                    <EmptyState />
                ) : (
                    <div className="space-y-4" data-testid="timeline">
                        {items.map((it) => (
                            <TimelineItem
                                key={`${it.type}-${it.id}`}
                                item={it}
                                onToggle={toggleItem}
                                onDelete={deleteItem}
                                onSnooze={snoozeItem}
                            />
                        ))}
                        <div ref={listEndRef} />
                    </div>
                )}
            </main>

            <VoiceDock
                onSave={sendVoice}
                onSendText={sendText}
                mode={mode}
                setMode={setMode}
                busy={busy}
            />

            <RecapDrawer
                open={recapOpen}
                onClose={() => setRecapOpen(false)}
                recap={recap}
                setRecap={setRecap}
                busy={recapBusy}
                setBusy={setRecapBusy}
            />

            <CloudSyncPrompt />
            <Footer />
        </div>
    );
}

function EmptyState() {
    return (
        <div className="text-center py-16 sm:py-24" data-testid="empty-state">
            <div className="relative w-40 h-40 mx-auto mb-8">
                <div className="absolute inset-0 bg-primary/15 blob" />
                <div className="absolute inset-6 bg-accent/10 blob" style={{ animationDelay: "-5s" }} />
                <div className="absolute inset-0 grid place-items-center">
                    <Mic className="w-10 h-10 text-primary" />
                </div>
            </div>
            <h2 className="font-display text-3xl tracking-tight">Your inner voice, captured.</h2>
            <p className="text-muted-foreground mt-3 max-w-sm mx-auto leading-relaxed">
                Tap <span className="font-medium text-foreground">record</span> below to capture a thought.
                It&apos;ll be sorted into <em>tasks</em>, <em>reminders</em>, and <em>ideas</em> automatically.
            </p>
            <div className="mt-8 flex flex-col gap-2 max-w-md mx-auto text-left">
                {[
                    "“Remind me to call dad tomorrow at 6pm.”",
                    "“Idea: a tiny garden on the balcony.”",
                    "“Buy paint, fix the door, return books — by Friday.”",
                ].map((s) => (
                    <div key={s} className="bubble-them px-4 py-2.5 text-sm italic text-muted-foreground">
                        {s}
                    </div>
                ))}
            </div>
        </div>
    );
}
