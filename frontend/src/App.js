import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { StorageProvider } from "@/contexts/StorageContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AuthCallback from "@/components/AuthCallback";
import Login from "@/pages/Login";
import Journal from "@/pages/Journal";
import AiChat from "@/pages/AiChat";
import Profile from "@/pages/Profile";
import PersonalityAssessment from "@/pages/PersonalityAssessment";
import PersonalityResult from "@/pages/PersonalityResult";
import DailyPrompt from "@/pages/DailyPrompt";
import Privacy from "@/pages/Privacy";

function AppRouter() {
    const location = useLocation();
    if (location.hash?.includes("session_id=")) {
        return <AuthCallback />;
    }
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Journal /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><AiChat /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/personality/assessment" element={<ProtectedRoute><PersonalityAssessment /></ProtectedRoute>} />
            <Route path="/personality/result/:id" element={<ProtectedRoute><PersonalityResult /></ProtectedRoute>} />
            <Route path="/daily-prompt" element={<ProtectedRoute><DailyPrompt /></ProtectedRoute>} />
            <Route path="/privacy" element={<ProtectedRoute><Privacy /></ProtectedRoute>} />
            <Route path="*" element={<Login />} />
        </Routes>
    );
}

export default function App() {
    return (
        <div className="App">
            <ThemeProvider>
                <BrowserRouter>
                    <AuthProvider>
                        <StorageProvider>
                            <AppRouter />
                        </StorageProvider>
                    </AuthProvider>
                </BrowserRouter>
            </ThemeProvider>
        </div>
    );
}
