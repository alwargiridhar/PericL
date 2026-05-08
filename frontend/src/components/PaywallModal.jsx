import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PaywallModal — surfaces when a free-tier user hits a limit (e.g. daily
 * mirror replies, or 4th active mission). Soft, never aggressive.
 */
export default function PaywallModal({ open, title, body, onClose }) {
    const navigate = useNavigate();
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="fixed inset-0 z-[110] grid place-items-end sm:place-items-center p-4 bg-black/40 backdrop-blur-sm"
                    onClick={onClose}
                    data-testid="paywall-backdrop"
                >
                    <motion.div
                        initial={{ y: 30, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 20, opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full sm:max-w-md rounded-[1.75rem] bg-card border border-border/60 shadow-2xl p-6 sm:p-7"
                        data-testid="paywall-modal"
                    >
                        <button
                            onClick={onClose}
                            className="absolute top-3 right-3 w-8 h-8 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted"
                            aria-label="Close"
                            data-testid="paywall-close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-2xl bg-primary/10 grid place-items-center shrink-0">
                                <Sparkles className="w-4.5 h-4.5 text-primary" />
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                Premium intelligence
                            </div>
                        </div>
                        <h2 className="font-display text-2xl tracking-tight leading-snug">
                            {title || "You've used your free reflections for today."}
                        </h2>
                        <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                            {body || "Premium unlocks unlimited mirror replies, emotional memory, and cross-device sync — for the version of you that wants depth and follow-through."}
                        </p>
                        <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
                            <Button
                                data-testid="paywall-not-now"
                                variant="ghost"
                                onClick={onClose}
                                className="rounded-full sm:flex-1 text-muted-foreground"
                            >
                                Not now
                            </Button>
                            <Button
                                data-testid="paywall-upgrade"
                                onClick={() => { onClose(); navigate("/pricing"); }}
                                className="rounded-full sm:flex-1 gap-2"
                            >
                                See premium
                                <ArrowRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
