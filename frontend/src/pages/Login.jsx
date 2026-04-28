import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Mic, Sparkles, Bell } from "lucide-react";

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

    return (
        <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
            {/* organic blobs */}
            <div className="pointer-events-none absolute -top-32 -left-32 w-[40rem] h-[40rem] bg-primary/15 blob" />
            <div className="pointer-events-none absolute -bottom-32 -right-32 w-[34rem] h-[34rem] bg-accent/15 blob" style={{ animationDelay: "-7s" }} />

            <div className="absolute top-4 right-4 z-10">
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

            <div className="relative z-10 max-w-2xl mx-auto px-6 pt-16 pb-24 sm:pt-24">
                <div className="flex items-center gap-3 mb-12">
                    <div className="w-10 h-10 rounded-2xl bg-primary text-primary-foreground grid place-items-center font-display font-medium text-lg">
                        P
                    </div>
                    <div className="leading-tight">
                        <div className="font-display text-xl tracking-tight">PericL</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Personal Voice Journal
                        </div>
                    </div>
                </div>

                <h1 className="font-display text-4xl sm:text-6xl tracking-tight font-medium leading-[1.05]">
                    Speak it.
                    <br />
                    <span className="text-primary">It&rsquo;s just you, written down.</span>
                </h1>
                <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
                    PericL isn&rsquo;t an assistant. It&rsquo;s your inner voice — a calmer, slightly-ahead version of yourself
                    you can talk to. Your thoughts stay on your device by default. You decide what travels.
                </p>

                <div className="mt-10 grid sm:grid-cols-3 gap-3">
                    {[
                        { Icon: Mic, label: "Speak or type — your call" },
                        { Icon: Sparkles, label: "Sorted into tasks, reminders, ideas" },
                        { Icon: Bell, label: "Reminders find their way back" },
                    ].map(({ Icon, label }, i) => (
                        <div
                            key={label}
                            className="bubble-them p-5 animate-float-in"
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            <Icon className="w-5 h-5 text-primary mb-3" />
                            <p className="text-sm leading-relaxed">{label}</p>
                        </div>
                    ))}
                </div>

                <div className="mt-12 flex flex-col items-start gap-3">
                    <Button
                        data-testid="login-google-btn"
                        onClick={startLogin}
                        className="rounded-full h-14 px-8 text-base font-medium gap-3 shadow-lg shadow-primary/20"
                        size="lg"
                    >
                        <GoogleMark />
                        Continue with Google
                    </Button>
                    <p className="text-xs text-muted-foreground pl-2">
                        Sign in to begin. Your data stays on your device unless you choose otherwise.
                    </p>
                </div>
            </div>
            <FooterLogin />
        </div>
    );
}

function FooterLogin() {
    return (
        <div className="absolute bottom-3 inset-x-0 text-center text-[11px] text-muted-foreground z-10">
            © {new Date().getFullYear()} Giridhar Alwar · PericL · Personal Voice Journal
        </div>
    );
}

function GoogleMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.63z" fill="#fff"/>
            <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.92v2.33A9 9 0 0 0 9 18z" fill="#fff"/>
            <path d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.92A9 9 0 0 0 0 9a9 9 0 0 0 .92 4.04l3.05-2.33z" fill="#fff"/>
            <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .92 4.96l3.05 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#fff"/>
        </svg>
    );
}
