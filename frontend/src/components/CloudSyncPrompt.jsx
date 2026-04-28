import { Lock, Cloud, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStorage } from "@/contexts/StorageContext";
import { migrateLocalToCloud } from "@/lib/storage";
import { toast } from "sonner";

export default function CloudSyncPrompt() {
    const { showPrompt, setMode, snooze, dismissPrompt } = useStorage();

    if (!showPrompt) return null;

    const turnOnCloud = async () => {
        try {
            await migrateLocalToCloud();
            await setMode("cloud", true);
            toast.success("Cloud sync turned on");
        } catch {
            toast.error("Couldn't enable cloud sync — try again");
        }
    };

    const remindLater = async () => {
        await snooze();
        toast("Got it — I'll ask again next month", { duration: 2200 });
    };

    const neverAsk = async () => {
        try {
            await setMode("never", true);
            toast.success("Your data stays on this device only");
        } catch {
            toast.error("Could not save preference");
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4"
            onClick={dismissPrompt}
            data-testid="cloud-sync-prompt"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md bg-card text-card-foreground rounded-3xl shadow-2xl p-6 sm:p-7 space-y-5 animate-float-in"
            >
                <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-primary/15 grid place-items-center shrink-0">
                        <Lock className="w-5 h-5 text-primary" />
                    </div>
                    <div className="leading-tight">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Once a month
                        </div>
                        <h2 className="font-display text-xl mt-0.5">
                            Want to keep a copy in the cloud?
                        </h2>
                    </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                    Right now, your journal, reflections and chats live <strong className="text-foreground">only on this device</strong>.
                    PericL never tracks them. Switching on cloud sync (managed with care, integrity, and ready
                    for future-you) lets you continue across devices.
                </p>

                <div className="space-y-2">
                    <Button
                        data-testid="cloud-prompt-yes"
                        onClick={turnOnCloud}
                        className="w-full h-11 rounded-full"
                    >
                        <Cloud className="w-4 h-4 mr-2" />
                        Yes — keep my data safe in cloud
                    </Button>
                    <Button
                        data-testid="cloud-prompt-later"
                        variant="outline"
                        onClick={remindLater}
                        className="w-full h-11 rounded-full"
                    >
                        Remind me next month
                    </Button>
                    <Button
                        data-testid="cloud-prompt-never"
                        variant="ghost"
                        onClick={neverAsk}
                        className="w-full h-11 rounded-full text-muted-foreground"
                    >
                        <BellOff className="w-4 h-4 mr-2" />
                        Never ask — keep it local forever
                    </Button>
                </div>

                <p className="text-[11px] text-center text-muted-foreground">
                    You can change this anytime from Settings.
                </p>
            </div>
        </div>
    );
}
