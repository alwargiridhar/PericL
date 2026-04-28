import { useNavigate } from "react-router-dom";
import { ArrowLeft, Brain, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";

const FRAMEWORKS = [
    {
        id: "mbti",
        path: "/personality/mbti",
        Icon: Brain,
        title: "MBTI · 16-type compass",
        subtitle: "32 paired questions · 5 minutes",
        body: "A familiar 4-letter shorthand for how you take in the world and decide what to do.",
        testid: "framework-mbti",
    },
    {
        id: "big-five",
        path: "/personality/big-five",
        Icon: Layers,
        title: "Big Five · OCEAN profile",
        subtitle: "25 statements · 4 minutes",
        body: "Five sliders rather than four labels. Better for tracking how you change over time.",
        testid: "framework-big-five",
    },
];

export default function PersonalityAssessment() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="personality-chooser">
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="chooser-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(-1)}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Personality test</span>
                </div>
            </header>

            <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 space-y-6">
                <div>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                        Pick a lens
                    </div>
                    <h1 className="font-display text-3xl tracking-tight">Sharpen your mirror.</h1>
                    <p className="text-muted-foreground mt-2 leading-relaxed">
                        Both feed your inner voice better context. You can take either, or both — and re-take any time.
                    </p>
                </div>

                <div className="space-y-3">
                    {FRAMEWORKS.map((f) => {
                        const Icon = f.Icon;
                        return (
                            <button
                                key={f.id}
                                data-testid={f.testid}
                                onClick={() => navigate(f.path)}
                                className="w-full text-left rounded-3xl border-2 border-border bg-card p-5 hover:border-primary/40 transition-all flex gap-4"
                            >
                                <div className="w-11 h-11 rounded-2xl bg-muted grid place-items-center shrink-0">
                                    <Icon className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-display text-base">{f.title}</div>
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
                                        {f.subtitle}
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                                        {f.body}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </main>
            <Footer />
        </div>
    );
}
