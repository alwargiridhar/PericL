import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PhoneOff, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * DriftNudgeModal — shown when the user returns after a long absence.
 * Humble tone, anchored to their goal, ends with one small Next Move.
 */
export default function DriftNudgeModal({ open, payload, loading, onSnooze, onDismiss }) {
    const navigate = useNavigate();
    if (!open || !payload) return null;

    const goToMirror = () => {
        onDismiss && onDismiss();
        navigate("/chat");
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[100] grid place-items-end sm:place-items-center p-4 bg-black/40 backdrop-blur-sm"
                    data-testid="drift-nudge-backdrop"
                    onClick={onSnooze}
                >
                    <motion.div
                        initial={{ y: 40, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 30, opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                        className="relative w-full sm:max-w-md rounded-[1.75rem] bg-card border border-border/60 shadow-2xl p-6 sm:p-7"
                        data-testid="drift-nudge-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            data-testid="drift-nudge-close"
                            onClick={onSnooze}
                            className="absolute top-3 right-3 w-8 h-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            aria-label="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>

                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-10 h-10 rounded-2xl bg-primary/10 grid place-items-center shrink-0">
                                <PhoneOff className="w-4.5 h-4.5 text-primary" strokeWidth={1.7} />
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                A gentle nudge from yourself
                            </div>
                        </div>

                        <p
                            className="text-[17px] sm:text-lg leading-relaxed text-foreground/90"
                            data-testid="drift-nudge-message"
                        >
                            {loading ? "…" : payload.message}
                        </p>

                        {payload.next_move && (
                            <div
                                className="mt-5 rounded-2xl bg-primary/5 border border-primary/15 px-4 py-3.5"
                                data-testid="drift-nudge-next-move"
                            >
                                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-primary mb-1.5">
                                    <Target className="w-3 h-3" />
                                    Next Move
                                </div>
                                <p className="text-[15px] leading-relaxed">{payload.next_move}</p>
                            </div>
                        )}

                        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2.5">
                            <Button
                                data-testid="drift-nudge-snooze"
                                variant="ghost"
                                onClick={onSnooze}
                                className="rounded-full sm:flex-1 text-muted-foreground"
                            >
                                Not now
                            </Button>
                            <Button
                                data-testid="drift-nudge-act"
                                onClick={goToMirror}
                                className="rounded-full sm:flex-1 gap-2"
                            >
                                Put phone down · talk to myself
                            </Button>
                        </div>

                        <p className="mt-4 text-[11px] text-muted-foreground text-center">
                            Stays on your device · you can turn this off in Privacy
                        </p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
