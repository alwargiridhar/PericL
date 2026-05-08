import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useStorage } from "@/contexts/StorageContext";
import useDriftNudge from "@/hooks/useDriftNudge";
import DriftNudgeModal from "@/components/DriftNudgeModal";
import InstallAppPrompt from "@/components/InstallAppPrompt";

function Shell({ children }) {
    const nudge = useDriftNudge();
    return (
        <>
            {children}
            <DriftNudgeModal
                open={nudge.open}
                payload={nudge.payload}
                loading={nudge.loading}
                onSnooze={nudge.snooze}
                onDismiss={nudge.dismiss}
            />
            <InstallAppPrompt />
        </>
    );
}

// Routes that don't require the onboarding step (the user IS onboarding,
// or visiting auxiliary surfaces, or this is the auth callback).
const ONBOARDING_BYPASS = new Set([
    "/onboarding",
    "/privacy",
    "/account",
    "/pricing",
]);

function _hasOnboarded() {
    try {
        return !!localStorage.getItem("pericl.onboarded_at");
    } catch {
        return true; // be permissive if storage unavailable
    }
}

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    const { loading: storageLoading } = useStorage();
    const location = useLocation();

    if (loading || storageLoading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
        );
    }
    if (!user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }
    // First-time users go to onboarding before anything else, except the
    // explicitly bypassed routes.
    if (!_hasOnboarded() && !ONBOARDING_BYPASS.has(location.pathname)) {
        return <Navigate to="/onboarding" replace />;
    }
    return <Shell>{children}</Shell>;
}
