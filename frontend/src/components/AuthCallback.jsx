import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallback() {
    const navigate = useNavigate();
    const { setUser } = useAuth();
    const hasProcessed = useRef(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (hasProcessed.current) return;
        hasProcessed.current = true;

        const hash = window.location.hash || "";
        const match = hash.match(/session_id=([^&]+)/);
        if (!match) {
            navigate("/login", { replace: true });
            return;
        }
        const sessionId = decodeURIComponent(match[1]);

        (async () => {
            try {
                const res = await api.post("/auth/process-session", { session_id: sessionId });
                setUser(res.data);
                // strip hash
                window.history.replaceState(null, "", "/");
                navigate("/", { replace: true, state: { user: res.data } });
            } catch (e) {
                console.error(e);
                setError("Sign-in failed. Please try again.");
                setTimeout(() => navigate("/login", { replace: true }), 1500);
            }
        })();
    }, [navigate, setUser]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="text-center" data-testid="auth-callback">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/15 grid place-items-center animate-pulse-ring">
                    <div className="w-8 h-8 rounded-full bg-primary blob" />
                </div>
                <p className="mt-6 text-muted-foreground">
                    {error ? error : "Welcoming you in…"}
                </p>
            </div>
        </div>
    );
}
