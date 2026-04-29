import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import {
    Sun, Moon, Mic, Lock, Target, Bell, Search, Calendar,
    LineChart, MessageSquare, Sparkles, Brain, ChevronDown, ArrowRight,
    PenLine, ListChecks, Shield, Compass, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

// Subtle entrance animation — fade + slight rise.
const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    visible: (i = 0) => ({
        opacity: 1,
        y: 0,
        transition: { delay: i * 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
    }),
};

function Reveal({ children, delay = 0, className = "" }) {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: "-15% 0px" });
    return (
        <motion.div
            ref={ref}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
            variants={fadeUp}
            custom={delay}
            className={className}
        >
            {children}
        </motion.div>
    );
}

export default function Login() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const { theme, toggle } = useTheme();

    useEffect(() => {
        if (!loading && user) navigate("/", { replace: true });
    }, [user, loading, navigate]);

    const startLogin = () => {
        // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
        const redirectUrl = window.location.origin + "/";
        window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    };

    const scrollTo = (id) => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <div
            className="relative min-h-screen overflow-x-hidden bg-background text-foreground"
            data-testid="landing-page"
        >
            {/* Organic ambient blobs (kept very low opacity) */}
            <div className="pointer-events-none fixed -top-40 -left-40 w-[40rem] h-[40rem] bg-primary/10 blob -z-10" aria-hidden />
            <div className="pointer-events-none fixed top-1/3 -right-40 w-[34rem] h-[34rem] bg-accent/10 blob -z-10" style={{ animationDelay: "-7s" }} aria-hidden />
            <div className="pointer-events-none fixed bottom-0 left-1/4 w-[28rem] h-[28rem] bg-primary/8 blob -z-10" style={{ animationDelay: "-14s" }} aria-hidden />

            {/* Soft grain overlay */}
            <div
                className="pointer-events-none fixed inset-0 -z-10 opacity-[0.04] dark:opacity-[0.06] mix-blend-overlay"
                style={{
                    backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
                }}
                aria-hidden
            />

            {/* Top nav */}
            <header className="relative z-20 max-w-6xl mx-auto px-6 sm:px-10 pt-6 flex items-center justify-between">
                <div className="flex items-center gap-2.5" data-testid="landing-brand">
                    <div className="w-9 h-9 rounded-2xl bg-primary text-primary-foreground grid place-items-center font-display font-medium text-base">
                        P
                    </div>
                    <div className="leading-tight">
                        <div className="font-display text-base">PericL</div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            Personal Voice Journal
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        data-testid="landing-signin-link"
                        onClick={startLogin}
                        className="hidden sm:inline-flex text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-full"
                    >
                        Open my mirror
                    </button>
                    <Button
                        data-testid="login-theme-toggle"
                        variant="ghost"
                        size="icon"
                        className="rounded-full"
                        onClick={toggle}
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </Button>
                </div>
            </header>

            {/* Hero */}
            <section className="relative z-10 max-w-6xl mx-auto px-6 sm:px-10 pt-12 sm:pt-20 pb-24 grid lg:grid-cols-12 gap-12 items-center">
                <div className="lg:col-span-7">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <span
                            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground border border-border/60 rounded-full px-3 py-1.5"
                            data-testid="landing-eyebrow"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                            A mirror, not an assistant
                        </span>
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                        className="mt-6 font-display tracking-tight text-5xl sm:text-6xl lg:text-7xl leading-[1.02]"
                        data-testid="landing-hero-headline"
                    >
                        Your inner voice,
                        <br />
                        <span className="italic text-primary">written down.</span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 0.55 }}
                        className="mt-7 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed"
                    >
                        Speak a thought. PericL sorts it into tasks, reminders, and ideas — then talks back as you,
                        a little calmer and a little more honest. No AI assistant. Just you, clearer.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3, duration: 0.5 }}
                        className="mt-10 flex flex-col sm:flex-row sm:items-center gap-4"
                    >
                        <Button
                            data-testid="login-google-btn"
                            onClick={startLogin}
                            className="rounded-full h-14 px-8 text-base font-medium gap-3 shadow-lg shadow-primary/15"
                            size="lg"
                        >
                            <GoogleMark />
                            Open my mirror
                            <ArrowRight className="w-4 h-4 -mr-1" />
                        </Button>
                        <button
                            data-testid="landing-explore-btn"
                            onClick={() => scrollTo("mirror-demo")}
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 group self-start sm:self-auto px-2"
                        >
                            See what it feels like
                            <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
                        </button>
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.45, duration: 0.5 }}
                        className="mt-6 text-xs text-muted-foreground inline-flex items-center gap-2"
                    >
                        <Lock className="w-3 h-3" />
                        Your thoughts stay on your device by default — you decide what travels.
                    </motion.p>
                </div>

                {/* Hero chat mockup — the "show, don't tell" piece */}
                <div className="lg:col-span-5">
                    <HeroChatMockup />
                </div>
            </section>

            {/* Mirror demo — fuller exchange */}
            <section
                id="mirror-demo"
                className="relative z-10 max-w-5xl mx-auto px-6 sm:px-10 py-20 sm:py-28 border-t border-border/40"
            >
                <Reveal>
                    <div className="max-w-2xl">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground inline-flex items-center gap-2">
                            <Compass className="w-3 h-3" /> The Mirror
                        </div>
                        <h2 className="mt-3 font-display text-3xl sm:text-5xl tracking-tight leading-[1.05]">
                            It doesn&rsquo;t agree with you.
                            <br />
                            <span className="italic text-primary">It agrees with the version of you that ships.</span>
                        </h2>
                        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
                            Every reply ends with one specific next move under fifteen minutes — never a list, never a
                            lecture. Drift detection calls out gaps between what you said matters and what you&rsquo;ve
                            actually done. You can&rsquo;t hide from yourself here.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={1} className="mt-12">
                    <FullChatExchange />
                </Reveal>
            </section>

            {/* Feature wall */}
            <section className="relative z-10 max-w-6xl mx-auto px-6 sm:px-10 py-20 sm:py-28 border-t border-border/40">
                <Reveal>
                    <div className="grid sm:grid-cols-2 gap-6 sm:gap-12 mb-16 max-w-5xl">
                        <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                                Everything inside
                            </div>
                            <h2 className="mt-3 font-display text-3xl sm:text-5xl tracking-tight leading-[1.05]">
                                Capture. Reflect. Track.
                            </h2>
                        </div>
                        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed self-end">
                            One quiet place for the whole loop — from a thought spoken into your phone to a quarterly
                            mission you actually finish.
                        </p>
                    </div>
                </Reveal>

                <div className="grid md:grid-cols-2 gap-6 sm:gap-8">
                    <FeatureCluster
                        cluster="capture"
                        title="Capture"
                        Icon={Mic}
                        items={[
                            { Icon: Mic, label: "Speak or type — held in your own voice" },
                            { Icon: Sparkles, label: "Auto-sorted into tasks, reminders & ideas" },
                            { Icon: Bell, label: "Reminders that find their way back to you" },
                            { Icon: Calendar, label: "Snooze: 10 min, 1 hour, tomorrow, next week" },
                        ]}
                    />
                    <FeatureCluster
                        cluster="mirror"
                        title="Mirror"
                        Icon={MessageSquare}
                        items={[
                            { Icon: MessageSquare, label: "Replies stream live, like reading a thought form" },
                            { Icon: Target, label: "Always one 🎯 Next Move under 15 minutes" },
                            { Icon: Compass, label: "Reality check & drift detection, kindly" },
                            { Icon: PenLine, label: "Daily reflection prompts shaped by your type" },
                        ]}
                    />
                    <FeatureCluster
                        cluster="track"
                        title="Track"
                        Icon={Target}
                        items={[
                            { Icon: ListChecks, label: "Up to 3 active missions with real progress" },
                            { Icon: LineChart, label: "Mood-over-time chart, day by day" },
                            { Icon: Brain, label: "MBTI compass + Big Five (OCEAN) profile" },
                            { Icon: Search, label: "Search every thought you&rsquo;ve ever captured" },
                        ]}
                    />
                    <FeatureCluster
                        cluster="own"
                        title="Own"
                        Icon={Lock}
                        items={[
                            { Icon: Lock, label: "On-device by default — IndexedDB + localStorage" },
                            { Icon: Shield, label: "Cloud sync is monthly opt-in, or never" },
                            { Icon: CheckCircle2, label: "Pull a copy back any time, in either direction" },
                            { Icon: Sparkles, label: "Stateless replies — your text isn&rsquo;t logged" },
                        ]}
                    />
                </div>
            </section>

            {/* Look-inside product showcase — static, hand-crafted mockups */}
            <section className="relative z-10 border-t border-border/40">
                <div className="max-w-6xl mx-auto px-6 sm:px-10 py-20 sm:py-28">
                    <Reveal>
                        <div className="max-w-2xl">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground inline-flex items-center gap-2">
                                <LineChart className="w-3 h-3" /> Look inside
                            </div>
                            <h2 className="mt-3 font-display text-3xl sm:text-5xl tracking-tight leading-[1.05]">
                                Real progress,
                                <br />
                                <span className="italic text-primary">tracked quietly.</span>
                            </h2>
                            <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
                                Missions sit in the corner of your screen. Mood lives as a single calm line.
                                Both update on their own, from the thoughts you already speak.
                            </p>
                        </div>
                    </Reveal>

                    <div className="mt-14 grid lg:grid-cols-2 gap-6 lg:gap-10">
                        <Reveal delay={1}>
                            <MissionCardMockup />
                        </Reveal>
                        <Reveal delay={2}>
                            <MoodChartMockup />
                        </Reveal>
                    </div>

                    <Reveal delay={3} className="mt-10">
                        <RecapStrip />
                    </Reveal>
                </div>
            </section>

            {/* Privacy block — distinct visual rhythm */}
            <section className="relative z-10 border-t border-border/40">
                <div className="max-w-6xl mx-auto px-6 sm:px-10 py-20 sm:py-28 grid lg:grid-cols-12 gap-12 items-center">
                    <Reveal className="lg:col-span-5">
                        <div className="relative">
                            <div className="aspect-square w-full max-w-sm mx-auto lg:mx-0 rounded-[2.5rem] bg-gradient-to-br from-primary/10 via-accent/5 to-transparent border border-border/50 grid place-items-center relative overflow-hidden">
                                <div className="absolute inset-0 blob bg-primary/10" aria-hidden />
                                <div className="relative z-10 text-center px-8">
                                    <div className="w-20 h-20 rounded-3xl bg-background/80 backdrop-blur-sm border border-border/50 grid place-items-center mx-auto shadow-lg shadow-primary/10">
                                        <Lock className="w-9 h-9 text-primary" strokeWidth={1.5} />
                                    </div>
                                    <div className="mt-6 font-display text-2xl tracking-tight">
                                        Stays on your device
                                    </div>
                                    <div className="mt-1.5 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                                        Until you say otherwise
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Reveal>

                    <Reveal delay={1} className="lg:col-span-7">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground inline-flex items-center gap-2">
                            <Shield className="w-3 h-3" /> Privacy is the default, not a setting
                        </div>
                        <h2 className="mt-3 font-display text-3xl sm:text-5xl tracking-tight leading-[1.05]">
                            Built like a journal,
                            <br />
                            <span className="italic text-primary">not a feed.</span>
                        </h2>
                        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl">
                            Your voice notes, journal entries, missions, mood and chats live in your browser&rsquo;s own
                            storage. Calls to your inner voice are stateless — nothing about your text is logged on the
                            server. If you ever want a backup across devices, cloud sync is a single tap, and reversible.
                        </p>

                        <ul className="mt-7 space-y-3.5 text-sm sm:text-base">
                            {[
                                "Local-first by default — IndexedDB for audio, localStorage for everything else",
                                "Cloud sync is asked once a month, never pushed",
                                "Bidirectional copy — pull cloud → device any time",
                                "Audit log on the admin side, so trust is auditable",
                            ].map((line, i) => (
                                <li
                                    key={i}
                                    className="flex items-start gap-3 text-foreground/85"
                                    data-testid={`landing-privacy-point-${i}`}
                                >
                                    <CheckCircle2 className="w-4 h-4 mt-1 text-primary shrink-0" />
                                    <span>{line}</span>
                                </li>
                            ))}
                        </ul>
                    </Reveal>
                </div>
            </section>

            {/* FAQ */}
            <section className="relative z-10 border-t border-border/40">
                <div className="max-w-3xl mx-auto px-6 sm:px-10 py-20 sm:py-24">
                    <Reveal>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                            Honest answers
                        </div>
                        <h2 className="mt-3 font-display text-3xl sm:text-5xl tracking-tight leading-[1.05]">
                            Quick questions,
                            <br />
                            <span className="italic text-primary">straight answers.</span>
                        </h2>
                    </Reveal>

                    <div className="mt-12 divide-y divide-border/50 border-y border-border/50">
                        {FAQ.map((qa, i) => (
                            <Reveal key={i} delay={i}>
                                <FaqRow q={qa.q} a={qa.a} index={i} />
                            </Reveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="relative z-10 border-t border-border/40">
                <div className="max-w-3xl mx-auto px-6 sm:px-10 py-20 sm:py-28 text-center">
                    <Reveal>
                        <h2 className="font-display text-3xl sm:text-5xl tracking-tight leading-[1.05]">
                            Begin a quieter,
                            <br />
                            <span className="italic text-primary">honester loop.</span>
                        </h2>
                    </Reveal>
                    <Reveal delay={1}>
                        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
                            One sign-in. Nothing to learn. Speak a thought, watch yourself think it back at you,
                            a little clearer.
                        </p>
                    </Reveal>
                    <Reveal delay={2}>
                        <div className="mt-10">
                            <Button
                                data-testid="landing-cta-google-btn"
                                onClick={startLogin}
                                className="rounded-full h-14 px-8 text-base font-medium gap-3 shadow-lg shadow-primary/15"
                                size="lg"
                            >
                                <GoogleMark />
                                Start the loop · with Google
                                <ArrowRight className="w-4 h-4 -mr-1" />
                            </Button>
                            <p className="mt-4 text-xs text-muted-foreground">
                                One sign-in. Free. Cancel any time — your data comes with you.
                            </p>
                        </div>
                    </Reveal>
                </div>
            </section>

            <FooterLogin />
        </div>
    );
}

/* ---------- subcomponents ---------- */

function HeroChatMockup() {
    return (
        <div className="relative" data-testid="hero-chat-mockup">
            <motion.div
                initial={{ opacity: 0, y: 20, rotate: -1 }}
                animate={{ opacity: 1, y: 0, rotate: -1 }}
                transition={{ delay: 0.2, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="relative rounded-[2rem] border border-border/60 bg-card/70 backdrop-blur-xl p-5 sm:p-6 shadow-2xl shadow-black/5 dark:shadow-black/30"
            >
                <div className="flex items-center gap-2 mb-5 px-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-muted" />
                    <span className="w-2.5 h-2.5 rounded-full bg-muted" />
                    <span className="w-2.5 h-2.5 rounded-full bg-muted" />
                    <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        you · 9:42 pm
                    </span>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.55, duration: 0.45 }}
                    className="flex justify-end mb-3"
                >
                    <div className="bubble-mine px-4 py-2.5 max-w-[88%]">
                        <p className="text-[14px] leading-relaxed">
                            i&rsquo;ll start the launch tomorrow. today i&rsquo;m too tired.
                        </p>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.05, duration: 0.5 }}
                    className="flex justify-start mb-3"
                >
                    <div className="bubble-them px-4 py-3 max-w-[92%]">
                        <p className="text-[14px] leading-relaxed">
                            you said launching matters. pushing it off again is how nothing ships.
                        </p>
                        <p className="text-[14px] leading-relaxed mt-3">
                            🎯 <span className="font-medium">Next Move:</span> open your draft and write 3 plain
                            sentences for the launch tweet.
                        </p>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.6, duration: 0.4 }}
                    className="mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
                >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block animate-pulse" />
                    Streaming · stays on this device
                </motion.div>
            </motion.div>

            {/* Floating side chip */}
            <motion.div
                initial={{ opacity: 0, x: -20, rotate: 6 }}
                animate={{ opacity: 1, x: 0, rotate: 6 }}
                transition={{ delay: 1.4, duration: 0.6 }}
                className="hidden sm:flex absolute -bottom-6 -left-6 items-center gap-2 px-3.5 py-2 rounded-full bg-background border border-border/60 shadow-lg shadow-black/5"
                data-testid="hero-floating-chip-mood"
            >
                <LineChart className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] font-medium">mood: tired → focused</span>
            </motion.div>
            <motion.div
                initial={{ opacity: 0, x: 20, rotate: -4 }}
                animate={{ opacity: 1, x: 0, rotate: -4 }}
                transition={{ delay: 1.55, duration: 0.6 }}
                className="hidden sm:flex absolute -top-5 -right-4 items-center gap-2 px-3.5 py-2 rounded-full bg-background border border-border/60 shadow-lg shadow-black/5"
                data-testid="hero-floating-chip-mission"
            >
                <Target className="w-3.5 h-3.5 text-accent" />
                <span className="text-[11px] font-medium">mission: ship pericL · 62%</span>
            </motion.div>
        </div>
    );
}

function FullChatExchange() {
    const lines = [
        { side: "mine", text: "i keep saying i'll write — i haven't opened the doc in 4 days." },
        {
            side: "them",
            text: "you said writing matters this quarter. four days of avoidance is the tell, not the busy week.",
        },
        { side: "mine", text: "today's just bad — meetings till 6." },
        {
            side: "them",
            text: "you don't need a clean day. you need 12 minutes.",
            next: "🎯 Next Move: open the doc, write the worst possible first paragraph, save and close.",
        },
    ];
    return (
        <div className="rounded-[2rem] border border-border/60 bg-card/60 backdrop-blur-xl p-5 sm:p-7 max-w-2xl mx-auto" data-testid="mirror-demo-thread">
            {lines.map((l, i) => (
                <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-10% 0px" }}
                    transition={{ delay: 0.15 * i, duration: 0.4 }}
                    className={`flex ${l.side === "mine" ? "justify-end" : "justify-start"} mb-3 last:mb-0`}
                >
                    <div className={`${l.side === "mine" ? "bubble-mine" : "bubble-them"} px-4 py-3 max-w-[88%]`}>
                        <p className="text-[14.5px] leading-relaxed">{l.text}</p>
                        {l.next && (
                            <p className="text-[14.5px] leading-relaxed mt-3">
                                {l.next.split("Next Move:")[0]}
                                <span className="font-medium">Next Move:</span>
                                {l.next.split("Next Move:")[1]}
                            </p>
                        )}
                    </div>
                </motion.div>
            ))}
        </div>
    );
}

function FeatureCluster({ cluster, title, Icon, items }) {
    return (
        <div
            className="rounded-[1.75rem] border border-border/50 bg-card/40 p-7 sm:p-9 hover:border-primary/30 hover:bg-card/70 transition-colors"
            data-testid={`feature-cluster-${cluster}`}
        >
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 grid place-items-center">
                    <Icon className="w-4.5 h-4.5 text-primary" />
                </div>
                <h3 className="font-display text-2xl tracking-tight">{title}</h3>
            </div>
            <ul className="space-y-3.5">
                {items.map((it, i) => {
                    const ItIcon = it.Icon;
                    return (
                        <li
                            key={i}
                            className="flex items-start gap-3 text-sm sm:text-[15px] leading-relaxed text-foreground/90"
                            data-testid={`feature-item-${cluster}-${i}`}
                        >
                            <ItIcon className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
                            <span dangerouslySetInnerHTML={{ __html: it.label }} />
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

const FAQ = [
    {
        q: "Is this an AI assistant?",
        a: "No. PericL is a mirror — your own voice, written down. There's no chatbot persona, no agent. It reads what you said, compares it to what you said you wanted, and gives you back one specific next move.",
    },
    {
        q: "Where does my data live?",
        a: "On your device, until you say otherwise. Voice notes go to your browser's IndexedDB. Journal entries, chats, missions, profile and personality results live in localStorage. Cloud sync is offered once a month — you can also turn that nudge off forever.",
    },
    {
        q: "What does the 🎯 Next Move actually do?",
        a: "Every reply ends with exactly one action under 15 minutes, anchored to one of your top goals or active missions. No bullet lists, no five-step plans. The point is to break the freeze, not to plan another week.",
    },
    {
        q: "How does drift detection work?",
        a: "PericL keeps a quiet count of your last 7–14 days — entries written, tasks closed, reminders missed, dominant moods. When your behavior drifts from what you said matters, the next reply names the gap calmly and points you to the smallest move back.",
    },
    {
        q: "Do you train on my data?",
        a: "No. The replies you get are stateless — your text isn't stored, fine-tuned on, or shared. Even on cloud-sync mode, your content is only mirrored to your account, never used to train anything.",
    },
];

function FaqRow({ q, a, index }) {
    return (
        <details className="group py-5" data-testid={`faq-${index}`}>
            <summary className="cursor-pointer flex items-center justify-between gap-4 list-none">
                <span className="font-display text-lg sm:text-xl tracking-tight pr-4">{q}</span>
                <span className="relative w-8 h-8 rounded-full border border-border/60 grid place-items-center shrink-0 transition-transform group-open:rotate-45 group-open:border-primary/40 group-open:bg-primary/5">
                    <span className="absolute block w-3 h-px bg-foreground" />
                    <span className="absolute block w-px h-3 bg-foreground" />
                </span>
            </summary>
            <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed pr-12">
                {a}
            </p>
        </details>
    );
}

function FooterLogin() {
    return (
        <footer className="relative z-10 border-t border-border/40">
            <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-primary text-primary-foreground grid place-items-center font-display text-[11px]">
                        P
                    </div>
                    <span>© {new Date().getFullYear()} Giridhar Alwar · PericL · Personal Voice Journal</span>
                </div>
                <div className="flex items-center gap-1.5 uppercase tracking-[0.22em]">
                    <Lock className="w-3 h-3" /> on-device, by default
                </div>
            </div>
        </footer>
    );
}

function GoogleMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.63z" fill="#fff"/>
            <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.92v2.33A9 9 0 0 0 9 18z" fill="#fff"/>
            <path d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.92A9 9 0 0 0 0 9a9 9 0 0 0 .92 4.04l3.05-2.33z" fill="#fff"/>
            <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .92 4.96l3.05 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#fff"/>
        </svg>
    );
}

/* ---------- product mockups (no real screenshots — pure JSX) ---------- */

function MissionCardMockup() {
    const tracks = [
        { name: "Chapters drafted", units: 6, target: 12, pct: 50 },
        { name: "Edit passes", units: 2, target: 4, pct: 50 },
        { name: "Hours of deep work", units: 18, target: 30, pct: 60 },
    ];
    return (
        <div
            className="rounded-[1.75rem] border border-border/60 bg-card/60 backdrop-blur-xl p-7 sm:p-8 shadow-xl shadow-black/5"
            data-testid="mockup-mission-card"
        >
            <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-2xl bg-accent/15 grid place-items-center shrink-0">
                    <Target className="w-4.5 h-4.5 text-accent" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Active mission · 84 days left
                    </div>
                    <div className="font-display text-xl tracking-tight mt-0.5">
                        Finish the book draft
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-display tabular-nums">53%</div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">on pace</div>
                </div>
            </div>

            <div className="space-y-4">
                {tracks.map((t, i) => (
                    <div key={i}>
                        <div className="flex items-center justify-between text-[13px]">
                            <span className="text-foreground/85">{t.name}</span>
                            <span className="text-muted-foreground tabular-nums">{t.units} / {t.target}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                whileInView={{ width: `${t.pct}%` }}
                                viewport={{ once: true }}
                                transition={{ delay: 0.3 + i * 0.12, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                                className="h-full bg-primary rounded-full"
                            />
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 pt-5 border-t border-border/50 flex items-center gap-3">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Detected from your last entry: <span className="text-foreground/85">+1 chapter, +2 hrs deep work</span>
                </p>
            </div>
        </div>
    );
}

function MoodChartMockup() {
    // 30 fake mood points (1..7 scale). Stable shape: dip mid-month, recovery toward end.
    const pts = [4, 4, 5, 4, 3, 4, 5, 5, 4, 3, 2, 3, 3, 2, 3, 4, 4, 5, 5, 6, 5, 5, 6, 6, 5, 6, 6, 5, 6, 7];
    const W = 480, H = 160, pad = 12;
    const max = 7, min = 1;
    const stepX = (W - pad * 2) / (pts.length - 1);
    const path = pts
        .map((v, i) => {
            const x = pad + i * stepX;
            const y = H - pad - ((v - min) / (max - min)) * (H - pad * 2);
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    const area = `${path} L ${(pad + (pts.length - 1) * stepX).toFixed(1)},${H - pad} L ${pad},${H - pad} Z`;

    return (
        <div
            className="rounded-[1.75rem] border border-border/60 bg-card/60 backdrop-blur-xl p-7 sm:p-8 shadow-xl shadow-black/5"
            data-testid="mockup-mood-chart"
        >
            <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 grid place-items-center shrink-0">
                    <LineChart className="w-4.5 h-4.5 text-primary" strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Mood, last 30 days
                    </div>
                    <div className="font-display text-xl tracking-tight mt-0.5">
                        Heavier mid-month. Lifting now.
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-display tabular-nums">4.6</div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">avg</div>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none" aria-hidden>
                <defs>
                    <linearGradient id="moodArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {/* baseline grid */}
                {[2, 4, 6].map((y) => (
                    <line
                        key={y}
                        x1={pad}
                        x2={W - pad}
                        y1={H - pad - ((y - min) / (max - min)) * (H - pad * 2)}
                        y2={H - pad - ((y - min) / (max - min)) * (H - pad * 2)}
                        stroke="hsl(var(--border))"
                        strokeDasharray="3 4"
                        strokeWidth="0.5"
                    />
                ))}
                <motion.path
                    d={area}
                    fill="url(#moodArea)"
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4, duration: 0.6 }}
                />
                <motion.path
                    d={path}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                />
                {/* end dot */}
                <circle
                    cx={pad + (pts.length - 1) * stepX}
                    cy={H - pad - ((pts[pts.length - 1] - min) / (max - min)) * (H - pad * 2)}
                    r="4"
                    fill="hsl(var(--primary))"
                    stroke="hsl(var(--background))"
                    strokeWidth="2"
                />
            </svg>

            <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>30 days ago</span>
                <span>today</span>
            </div>
        </div>
    );
}

function RecapStrip() {
    return (
        <div
            className="rounded-[1.75rem] border border-border/60 bg-gradient-to-r from-primary/5 via-card/60 to-accent/5 p-6 sm:p-8 grid sm:grid-cols-12 gap-5 sm:gap-8 items-center"
            data-testid="mockup-recap-strip"
        >
            <div className="sm:col-span-3 flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-background/70 backdrop-blur-sm border border-border/60 grid place-items-center shrink-0">
                    <Calendar className="w-5 h-5 text-primary" strokeWidth={1.5} />
                </div>
                <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Daily recap
                    </div>
                    <div className="font-display text-lg tracking-tight">Tonight, 9:30 pm</div>
                </div>
            </div>
            <p className="sm:col-span-9 text-[15px] sm:text-base leading-relaxed text-foreground/85">
                <span className="italic text-muted-foreground">From your day:</span>{" "}
                You captured 7 thoughts, closed 3 tasks, and said the word
                <span className="text-foreground"> &ldquo;tired&rdquo;</span> four times. Two ideas worth keeping —
                pinned for tomorrow. Pace on the book draft is steady. The thing you&rsquo;ve been avoiding is
                <span className="text-foreground"> the launch tweet</span>. Sleep on it.
            </p>
        </div>
    );
}
