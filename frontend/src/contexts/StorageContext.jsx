import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { pref } from "@/lib/storage";
import { useAuth } from "@/contexts/AuthContext";

const StorageContext = createContext({
    mode: "local",
    loading: true,
    refresh: () => {},
    setMode: async () => {},
    snooze: async () => {},
    showPrompt: false,
    dismissPrompt: () => {},
});

export function StorageProvider({ children }) {
    const { user, loading: authLoading } = useAuth();
    const [data, setData] = useState({ mode: "local", should_prompt_now: false });
    const [loading, setLoading] = useState(true);
    const [showPrompt, setShowPrompt] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const d = await pref.get();
            setData(d);
            setShowPrompt(!!d.should_prompt_now);
        } catch {
            setData({ mode: "local", should_prompt_now: false });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            setLoading(false);
            return;
        }
        refresh();
    }, [user, authLoading, refresh]);

    const setMode = async (mode, fromPrompt = false) => {
        const d = await pref.set(mode, fromPrompt);
        setData({ ...d, should_prompt_now: false });
        setShowPrompt(false);
        return d;
    };

    const snooze = async () => {
        try { await pref.snooze(); } catch {}
        setShowPrompt(false);
    };

    const dismissPrompt = () => setShowPrompt(false);

    return (
        <StorageContext.Provider
            value={{
                mode: data.mode,
                pref: data,
                loading,
                refresh,
                setMode,
                snooze,
                showPrompt,
                dismissPrompt,
            }}
        >
            {/* Block children until we know the mode — prevents pages from
                hitting localStorage when the user is in cloud, or vice versa,
                during the brief refresh window on first load. */}
            {loading && user ? (
                <div className="min-h-screen grid place-items-center bg-background">
                    <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
            ) : (
                children
            )}
        </StorageContext.Provider>
    );
}

export const useStorage = () => useContext(StorageContext);
