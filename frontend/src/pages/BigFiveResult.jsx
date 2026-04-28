import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { personality as personalityStore } from "@/lib/storage";
import { TRAIT_NAMES, TRAIT_DESCRIPTIONS } from "@/data/big-five-questions";
import Footer from "@/components/Footer";

const TRAIT_ORDER = ["O", "C", "E", "A", "N"];

export default function BigFiveResult() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [doc, setDoc] = useState(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            const r = await personalityStore.result(id);
            if (alive) setDoc(r);
        })();
        return () => { alive = false; };
    }, [id]);

    if (!doc) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="big-five-result">
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button data-testid="big-five-result-back" variant="ghost" size="icon" onClick={() => navigate("/")} className="rounded-full">
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Your Big Five</span>
                </div>
            </header>

            <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-8 space-y-6">
                <div className="rounded-3xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                        Big Five (OCEAN)
                    </div>
                    <h1 className="font-display text-3xl tracking-tight">A self-portrait</h1>
                    {doc.description && (
                        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground whitespace-pre-line">
                            {doc.description}
                        </p>
                    )}
                </div>

                <div className="space-y-3" data-testid="big-five-traits">
                    {TRAIT_ORDER.map((t) => {
                        const v = doc.scores?.[t] || 0;
                        return (
                            <div key={t} className="rounded-2xl border border-border bg-card p-4" data-testid={`trait-${t}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium">{TRAIT_NAMES[t]}</div>
                                    <div className="text-sm tabular-nums text-muted-foreground">{v}/100</div>
                                </div>
                                <Progress value={v} className="h-2 mt-2" />
                                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                                    {TRAIT_DESCRIPTIONS[t]}
                                </p>
                            </div>
                        );
                    })}
                </div>

                {!!(doc.strengths || []).length && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <h3 className="font-display text-lg mb-3">What's working for you</h3>
                        <ul className="space-y-2">
                            {doc.strengths.map((s, i) => (
                                <li key={i} className="text-sm leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-primary">{s}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {!!(doc.growth_areas || []).length && (
                    <div className="rounded-2xl border border-border bg-card p-5">
                        <h3 className="font-display text-lg mb-3">Where to push yourself</h3>
                        <ul className="space-y-2">
                            {doc.growth_areas.map((s, i) => (
                                <li key={i} className="text-sm leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-accent">{s}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <Button onClick={() => navigate("/chat")} className="w-full h-12 rounded-full" data-testid="big-five-talk">
                    Talk to yourself with this in mind
                </Button>
            </main>
            <Footer />
        </div>
    );
}
