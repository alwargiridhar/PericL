import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { mbtiQuestions } from "@/data/mbti-questions";
import { api } from "@/lib/api";

export default function PersonalityAssessment() {
    const navigate = useNavigate();
    const [idx, setIdx] = useState(0);
    const [answers, setAnswers] = useState({});
    const [submitting, setSubmitting] = useState(false);

    const q = mbtiQuestions[idx];
    const total = mbtiQuestions.length;
    const progress = ((idx + 1) / total) * 100;
    const last = idx === total - 1;
    const canProceed = answers[q.id] !== undefined;

    const setAnswer = (score) => setAnswers({ ...answers, [q.id]: score });

    const back = () => (idx > 0 ? setIdx(idx - 1) : navigate(-1));

    const submit = async () => {
        setSubmitting(true);
        try {
            const scores = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
            Object.values(answers).forEach((s) => (scores[s] = (scores[s] || 0) + 1));
            const r = await api.post("/personality/assess", { scores });
            navigate(`/personality/result/${r.data.id}`, { replace: true });
        } catch {
            toast.error("Could not submit. Try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const next = () => {
        if (last) submit();
        else setIdx(idx + 1);
    };

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="personality-assessment">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between mb-3">
                        <Button
                            data-testid="assessment-back"
                            variant="ghost"
                            size="icon"
                            onClick={back}
                            className="rounded-full"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex items-center gap-2 text-sm">
                            <Sparkles className="w-4 h-4 text-accent" />
                            <span className="font-medium">
                                Question {idx + 1} of {total}
                            </span>
                        </div>
                        <div className="w-9" />
                    </div>
                    <Progress value={progress} className="h-1.5" />
                </div>
            </header>

            <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10">
                <h2 className="font-display text-2xl sm:text-3xl tracking-tight leading-snug mb-8">
                    {q.text}
                </h2>
                <div className="space-y-3" role="radiogroup">
                    {q.options.map((opt, i) => {
                        const selected = answers[q.id] === opt.score;
                        return (
                            <button
                                key={i}
                                data-testid={`assessment-option-${i}`}
                                onClick={() => setAnswer(opt.score)}
                                className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${
                                    selected
                                        ? "border-primary bg-primary/10"
                                        : "border-border bg-card hover:border-primary/40"
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <span
                                        className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${
                                            selected ? "border-primary" : "border-muted-foreground/40"
                                        }`}
                                    >
                                        {selected && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                                    </span>
                                    <span className="text-base leading-relaxed">{opt.text}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </main>

            <div className="sticky bottom-0 bg-gradient-to-t from-background via-background/95 to-transparent">
                <div className="max-w-2xl mx-auto px-4 py-4">
                    <Button
                        data-testid="assessment-next"
                        onClick={next}
                        disabled={!canProceed || submitting}
                        size="lg"
                        className="w-full h-12 rounded-full text-base font-medium"
                    >
                        {submitting ? "Analysing…" : last ? "See my type" : (
                            <>
                                Next <ArrowRight className="w-4 h-4 ml-2" />
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}
