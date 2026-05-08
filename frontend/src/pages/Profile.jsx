import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, User, Target, Sparkles, Brain, Save, Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { profile as profileStore, personality as personalityStore } from "@/lib/storage";
import { useAuth } from "@/contexts/AuthContext";
import Footer from "@/components/Footer";
import MoodChart from "@/components/MoodChart";
import PersonalityEvolution from "@/components/PersonalityEvolution";

const FIELDS = [
    "name", "age", "occupation", "goals", "challenges",
    "personality_traits", "communication_style", "energy_level",
    "motivation_triggers", "core_values", "aspirations",
];

const empty = () => Object.fromEntries(FIELDS.map((f) => [f, ""]));

export default function Profile() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [profile, setProfile] = useState(empty());
    const [personality, setPersonality] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const [p, pa] = await Promise.all([
                    profileStore.get(),
                    personalityStore.latest(),
                ]);
                const merged = { ...empty() };
                FIELDS.forEach((f) => {
                    const v = p?.[f];
                    if (v !== null && v !== undefined) merged[f] = String(v);
                });
                if (!merged.name && user?.name) merged.name = user.name;
                setProfile(merged);
                setPersonality(pa?.assessment || null);
            } finally {
                setLoading(false);
            }
        })();
    }, [user]);

    const update = (k, v) => setProfile((p) => ({ ...p, [k]: v }));

    const save = async () => {
        setSaving(true);
        try {
            const payload = {};
            FIELDS.forEach((f) => {
                if (f === "age") {
                    const n = parseInt(profile.age, 10);
                    payload.age = Number.isFinite(n) ? n : null;
                } else {
                    payload[f] = profile[f] || null;
                }
            });
            await profileStore.put(payload);
            toast.success("Profile saved");
        } catch {
            toast.error("Could not save profile");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground" data-testid="profile-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="profile-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Your profile</span>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
                <div>
                    <h1 className="font-display text-3xl tracking-tight">A clearer picture of you</h1>
                    <p className="text-muted-foreground mt-1.5 leading-relaxed">
                        The more you write down about yourself, the sharper your inner voice becomes when you talk to it.
                    </p>
                </div>

                <MoodChart days={30} />
                <PersonalityEvolution />

                <Section icon={User} title="Basic information" subtitle="Tell us about yourself">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Name">
                            <Input
                                data-testid="profile-name"
                                value={profile.name}
                                onChange={(e) => update("name", e.target.value)}
                                placeholder="Your name"
                            />
                        </Field>
                        <Field label="Age">
                            <Input
                                data-testid="profile-age"
                                type="number"
                                value={profile.age}
                                onChange={(e) => update("age", e.target.value)}
                                placeholder="Age"
                            />
                        </Field>
                    </div>
                    <Field label="Occupation">
                        <Input
                            data-testid="profile-occupation"
                            value={profile.occupation}
                            onChange={(e) => update("occupation", e.target.value)}
                            placeholder="What do you do?"
                        />
                    </Field>
                </Section>

                <Section icon={Target} title="Goals & challenges" subtitle="What drives you and what holds you back">
                    <Field label="Your goals">
                        <Textarea
                            data-testid="profile-goals"
                            rows={3}
                            value={profile.goals}
                            onChange={(e) => update("goals", e.target.value)}
                            placeholder="What are you working towards?"
                        />
                    </Field>
                    <Field label="Your challenges">
                        <Textarea
                            data-testid="profile-challenges"
                            rows={3}
                            value={profile.challenges}
                            onChange={(e) => update("challenges", e.target.value)}
                            placeholder="What obstacles do you face?"
                        />
                    </Field>
                    <Field label="Core values">
                        <Textarea
                            data-testid="profile-core-values"
                            rows={2}
                            value={profile.core_values}
                            onChange={(e) => update("core_values", e.target.value)}
                            placeholder="What matters most to you?"
                        />
                    </Field>
                    <Field label="Aspirations">
                        <Textarea
                            data-testid="profile-aspirations"
                            rows={2}
                            value={profile.aspirations}
                            onChange={(e) => update("aspirations", e.target.value)}
                            placeholder="Where do you see yourself in 5 years?"
                        />
                    </Field>
                </Section>

                <Section icon={Sparkles} title="Self-awareness" subtitle="Help PericL mirror your style">
                    <Field label="Personality traits">
                        <Textarea
                            data-testid="profile-traits"
                            rows={2}
                            value={profile.personality_traits}
                            onChange={(e) => update("personality_traits", e.target.value)}
                            placeholder="Introverted, analytical, creative…"
                        />
                    </Field>
                    <Field label="Communication style">
                        <Input
                            data-testid="profile-communication"
                            value={profile.communication_style}
                            onChange={(e) => update("communication_style", e.target.value)}
                            placeholder="Direct, supportive, analytical…"
                        />
                    </Field>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Energy level">
                            <Input
                                data-testid="profile-energy"
                                value={profile.energy_level}
                                onChange={(e) => update("energy_level", e.target.value)}
                                placeholder="Morning person, night owl…"
                            />
                        </Field>
                        <Field label="What motivates you?">
                            <Input
                                data-testid="profile-motivation"
                                value={profile.motivation_triggers}
                                onChange={(e) => update("motivation_triggers", e.target.value)}
                                placeholder="Deadlines, praise, novelty…"
                            />
                        </Field>
                    </div>
                </Section>

                {/* Personality assessment summary */}
                <Section icon={Brain} title="Personality type" subtitle="From your MBTI assessment">
                    {personality ? (
                        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3">
                            <div className="flex items-baseline gap-3">
                                <span className="font-display text-3xl">{personality.personality_type}</span>
                                <span className="text-sm text-muted-foreground">{personality.type_name}</span>
                            </div>
                            <p className="text-sm leading-relaxed">{personality.description}</p>
                            <Button
                                data-testid="profile-retake-assessment"
                                variant="outline"
                                onClick={() => navigate("/personality/assessment")}
                                className="rounded-full"
                            >
                                Retake assessment
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-2xl border-2 border-dashed border-border p-6 text-center">
                            <p className="text-sm text-muted-foreground mb-4">
                                Take a quick 5-minute MBTI assessment so your inner voice can mirror you better.
                            </p>
                            <Button
                                data-testid="profile-take-assessment"
                                onClick={() => navigate("/personality/assessment")}
                                className="rounded-full"
                            >
                                Start assessment
                            </Button>
                        </div>
                    )}
                </Section>

                <div className="pt-2">
                    <Button
                        data-testid="profile-save"
                        onClick={save}
                        disabled={saving}
                        size="lg"
                        className="w-full h-12 rounded-full"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-2" /> Save profile
                            </>
                        )}
                    </Button>
                </div>
            </main>
            <Footer />
        </div>
    );
}

function Section({ icon: Icon, title, subtitle, children }) {
    return (
        <section className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-muted grid place-items-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="leading-tight">
                    <h2 className="font-display text-lg">{title}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
                </div>
            </div>
            <div className="space-y-3 pl-1">{children}</div>
        </section>
    );
}

function Field({ label, children }) {
    return (
        <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">
                {label}
            </span>
            {children}
        </label>
    );
}
