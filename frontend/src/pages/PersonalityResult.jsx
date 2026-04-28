import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Target, TrendingUp, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { personality as personalityStore } from "@/lib/storage";
import { personalityTypes } from "@/data/mbti-questions";
import Footer from "@/components/Footer";

export default function PersonalityResult() {
    const navigate = useNavigate();
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const data = await personalityStore.result(id);
                if (!data) throw new Error("Not found");
                setData(data);
            } catch {
                navigate("/personality/assessment", { replace: true });
            } finally {
                setLoading(false);
            }
        })();
    }, [id, navigate]);

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
        );
    }
    if (!data) return null;

    // Merge: prefer AI strengths/growth, fall back to canonical static data
    const fallback = personalityTypes[data.personality_type] || {};
    const strengths = data.strengths?.length ? data.strengths : fallback.strengths || [];
    const growthAreas = data.growth_areas?.length ? data.growth_areas : fallback.growthAreas || [];
    const description = data.description || fallback.description || "";
    const typeName = data.type_name || fallback.name || "";

    return (
        <div className="min-h-screen bg-background text-foreground" data-testid="personality-result">
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                        data-testid="result-back"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Your personality</span>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-10 space-y-10">
                {/* Type */}
                <div className="text-center space-y-4">
                    <div className="relative w-28 h-28 mx-auto">
                        <div className="absolute inset-0 bg-primary/20 blob" />
                        <div className="absolute inset-0 grid place-items-center">
                            <Sparkles className="w-10 h-10 text-primary" />
                        </div>
                    </div>
                    <div>
                        <h1 className="font-display text-5xl sm:text-6xl tracking-tight">
                            {data.personality_type}
                        </h1>
                        <p className="text-lg text-muted-foreground mt-2">{typeName}</p>
                    </div>
                </div>

                {/* Description */}
                <div className="bubble-them p-6">
                    <p className="text-base leading-relaxed">{description}</p>
                </div>

                {/* Strengths */}
                {strengths.length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Target className="w-5 h-5 text-primary" />
                            <h2 className="font-display text-xl">Your strengths</h2>
                        </div>
                        <div className="grid gap-2">
                            {strengths.map((s, i) => (
                                <div
                                    key={i}
                                    className="px-4 py-3 rounded-2xl bg-primary/10 border border-primary/20"
                                >
                                    <p className="text-sm">{s}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Growth */}
                {growthAreas.length > 0 && (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-accent" />
                            <h2 className="font-display text-xl">Where you can grow</h2>
                        </div>
                        <div className="grid gap-2">
                            {growthAreas.map((g, i) => (
                                <div
                                    key={i}
                                    className="px-4 py-3 rounded-2xl bg-accent/10 border border-accent/20"
                                >
                                    <p className="text-sm">{g}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* CTA */}
                <div className="space-y-2 pt-2">
                    <Button
                        data-testid="result-cta-chat"
                        onClick={() => navigate("/chat")}
                        size="lg"
                        className="w-full h-12 rounded-full"
                    >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Talk to yourself — now your mirror knows you
                    </Button>
                    <Button
                        data-testid="result-retake"
                        variant="ghost"
                        onClick={() => navigate("/personality/assessment")}
                        className="w-full"
                    >
                        Retake assessment
                    </Button>
                </div>
            </main>
            <Footer />
        </div>
    );
}
