import { useEffect, useState } from "react";
import { X, Share, Plus, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "pericl.install_prompt_dismissed_at";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

function isStandalone() {
    if (typeof window === "undefined") return false;
    return (
        window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
    );
}

function isIOS() {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
}

function wasDismissedRecently() {
    try {
        const v = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
        return v && Date.now() - v < DISMISS_TTL_MS;
    } catch {
        return false;
    }
}

/**
 * InstallAppPrompt — non-intrusive "Add to Home Screen" affordance.
 * - Android / desktop Chrome: waits for `beforeinstallprompt` and shows a toast
 * - iOS Safari: shows a one-line hint with the Share icon, since iOS doesn't
 *   expose an install API (users must add to home screen manually).
 */
export default function InstallAppPrompt() {
    const [deferred, setDeferred] = useState(null);
    const [show, setShow] = useState(false);
    const [iosHint, setIosHint] = useState(false);

    useEffect(() => {
        if (isStandalone() || wasDismissedRecently()) return;

        const onBefore = (e) => {
            e.preventDefault();
            setDeferred(e);
            setShow(true);
        };
        window.addEventListener("beforeinstallprompt", onBefore);

        // iOS fallback — show soft hint after 20 s of active use
        if (isIOS()) {
            const t = setTimeout(() => setIosHint(true), 20000);
            return () => {
                clearTimeout(t);
                window.removeEventListener("beforeinstallprompt", onBefore);
            };
        }
        return () => window.removeEventListener("beforeinstallprompt", onBefore);
    }, []);

    const install = async () => {
        if (!deferred) return;
        try {
            deferred.prompt();
            await deferred.userChoice;
        } catch {}
        setDeferred(null);
        setShow(false);
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    };

    const dismiss = () => {
        setShow(false);
        setIosHint(false);
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    };

    if (show && deferred) {
        return (
            <div
                className="fixed z-[90] bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:bottom-6 sm:w-[22rem] rounded-2xl border border-border/60 bg-background shadow-xl shadow-black/10 p-4 flex items-start gap-3 animate-float-in"
                data-testid="install-app-prompt"
            >
                <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                    <Smartphone className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Install PericL on this device</div>
                    <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                        Opens fullscreen like a real app — stays on your home screen.
                    </div>
                    <div className="mt-2 flex gap-2">
                        <Button
                            data-testid="install-app-confirm"
                            onClick={install}
                            size="sm"
                            className="rounded-full h-8 px-3 text-xs"
                        >
                            Install
                        </Button>
                        <Button
                            data-testid="install-app-dismiss"
                            onClick={dismiss}
                            size="sm"
                            variant="ghost"
                            className="rounded-full h-8 px-3 text-xs text-muted-foreground"
                        >
                            Not now
                        </Button>
                    </div>
                </div>
                <button
                    onClick={dismiss}
                    className="w-7 h-7 rounded-full grid place-items-center text-muted-foreground hover:bg-muted"
                    aria-label="Close"
                    data-testid="install-app-close"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    }

    if (iosHint) {
        return (
            <div
                className="fixed z-[90] bottom-4 left-4 right-4 rounded-2xl border border-border/60 bg-background shadow-xl shadow-black/10 p-3.5 flex items-center gap-3 animate-float-in"
                data-testid="install-app-ios-hint"
            >
                <div className="w-9 h-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                    <Share className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0 text-xs leading-snug">
                    Add PericL to your home screen: tap <Share className="w-3.5 h-3.5 inline-block -mt-0.5 text-primary" /> Share, then <Plus className="w-3.5 h-3.5 inline-block -mt-0.5 text-primary" /> Add to Home Screen.
                </div>
                <button
                    onClick={dismiss}
                    className="w-7 h-7 rounded-full grid place-items-center text-muted-foreground hover:bg-muted shrink-0"
                    aria-label="Close"
                    data-testid="install-app-ios-close"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    }

    return null;
}
