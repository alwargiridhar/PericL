import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
        );
    }
    if (!user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }
    return <Shell>{children}</Shell>;
}
