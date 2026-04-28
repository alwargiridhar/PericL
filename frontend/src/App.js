import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AuthCallback from "@/components/AuthCallback";
import Login from "@/pages/Login";
import Journal from "@/pages/Journal";

function AppRouter() {
    const location = useLocation();
    // Synchronous: handle OAuth return BEFORE protected route checks
    if (location.hash?.includes("session_id=")) {
        return <AuthCallback />;
    }
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <Journal />
                    </ProtectedRoute>
                }
            />
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
                        <AppRouter />
                    </AuthProvider>
                </BrowserRouter>
            </ThemeProvider>
        </div>
    );
}
