import { useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recap as recapStore } from "@/lib/storage";
import { toast } from "sonner";

export default function RecapDrawer({ open, onClose, recap, setRecap, busy, setBusy }) {
    useEffect(() => {
        if (!open || recap) return;
        // load latest
        (async () => {
            try {
                const list = await recapStore.list();
                if (list?.length) setRecap(list[0]);
            } catch {}
        })();
    }, [open, recap, setRecap]);

    if (!open) return null;

    const generate = async () => {
        setBusy(true);
        try {
            const r = await recapStore.today();
            setRecap(r);
            toast.success("Today's reflection is ready");
        } catch (e) {
            toast.error(e?.userMessage || e?.response?.data?.detail || "No entries today yet");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} data-testid="recap-drawer">
            <div
                className="absolute inset-x-0 bottom-0 sm:inset-0 sm:m-auto sm:max-w-lg sm:h-fit sm:rounded-3xl bg-card text-card-foreground rounded-t-3xl p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                            Daily reflection
                        </div>
                        <h2 className="font-display text-2xl">
                            {recap?.recap_date
                                ? new Date(recap.recap_date).toLocaleDateString(undefined, {
                                      weekday: "long",
                                      month: "long",
                                      day: "numeric",
                                  })
                                : "Today"}
                        </h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full" data-testid="recap-close">
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                {recap ? (
                    <>
                        <p className="text-base leading-relaxed text-foreground/90 whitespace-pre-wrap">
                            {recap.summary}
                        </p>
                        <div className="grid grid-cols-4 gap-2 mt-6">
                            <Stat label="Notes" value={recap.voice_count} />
                            <Stat label="Tasks" value={recap.task_count} />
                            <Stat label="Reminders" value={recap.reminder_count} />
                            <Stat label="Ideas" value={recap.idea_count} />
                        </div>
                    </>
                ) : (
                    <div className="rounded-2xl bg-muted/50 p-6 text-center">
                        <p className="text-sm text-muted-foreground mb-4">
                            Generate a warm recap of your day from PericL.
                        </p>
                    </div>
                )}

                <Button
                    data-testid="recap-generate-btn"
                    onClick={generate}
                    disabled={busy}
                    className="w-full mt-6 rounded-full h-12"
                >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {busy ? "Reflecting…" : recap ? "Generate again" : "Generate today's recap"}
                </Button>
            </div>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-2xl bg-muted/50 p-3 text-center">
            <div className="font-display text-2xl">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
    );
}
