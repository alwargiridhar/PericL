/**
 * useDriftNudge — detects when the user has been away from PericL for a long
 * time during active hours, and offers a humble nudge to come back to their
 * goal when they return.
 *
 * Privacy-respecting: we do NOT try to monitor what else the user is doing on
 * their device. We simply time our own absence. If PericL has been hidden /
 * backgrounded / the browser closed for >= thresholdMinutes, and the current
 * local time is inside `activeHours`, we fire the nudge — on return and/or via
 * a scheduled notification through the service worker.
 *
 * State machine:
 *   - lastActiveAt: wall-clock ms, updated on any user interaction while visible
 *   - lastNudgeAt: wall-clock ms of the most recent nudge shown (for snooze)
 *   - nudgePayload: the server-generated message + next_move, held in state
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { drift } from "@/lib/storage";

const LS_PREFS = "pericl.nudge_prefs_v1";
const LS_LAST_ACTIVE = "pericl.nudge_last_active_v1";
const LS_LAST_NUDGE = "pericl.nudge_last_shown_v1";

const DEFAULT_PREFS = {
    enabled: true,
    threshold_min: 30,
    snooze_min: 120,
    active_start: 9, // 9am
    active_end: 22, // 10pm
};

export function getNudgePrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(LS_PREFS) || "null");
        return { ...DEFAULT_PREFS, ...(raw || {}) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}
export function setNudgePrefs(patch) {
    const next = { ...getNudgePrefs(), ...(patch || {}) };
    localStorage.setItem(LS_PREFS, JSON.stringify(next));
    return next;
}

function _readNum(key) {
    const v = parseInt(localStorage.getItem(key) || "0", 10);
    return Number.isFinite(v) ? v : 0;
}
function _writeNum(key, v) {
    try { localStorage.setItem(key, String(v)); } catch {}
}

function inActiveHours(prefs, now = new Date()) {
    const h = now.getHours();
    const { active_start: s, active_end: e } = prefs;
    if (s <= e) return h >= s && h < e;
    // wrap-around (e.g. 22 .. 6)
    return h >= s || h < e;
}

export default function useDriftNudge() {
    const [payload, setPayload] = useState(null); // { message, next_move }
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const prefsRef = useRef(getNudgePrefs());
    const fetchingRef = useRef(false);

    // Ping "last active" on any user interaction while the tab is visible.
    useEffect(() => {
        const bump = () => {
            if (document.visibilityState === "visible") {
                _writeNum(LS_LAST_ACTIVE, Date.now());
            }
        };
        bump(); // initial
        const events = ["pointerdown", "keydown", "scroll", "focus", "touchstart"];
        events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
        document.addEventListener("visibilitychange", bump);
        return () => {
            events.forEach((e) => window.removeEventListener(e, bump));
            document.removeEventListener("visibilitychange", bump);
        };
    }, []);

    const fetchNudge = useCallback(async (minutesAway) => {
        if (fetchingRef.current) return null;
        fetchingRef.current = true;
        setLoading(true);
        try {
            const d = await drift.generate(minutesAway);
            return d || null;
        } catch {
            return null;
        } finally {
            fetchingRef.current = false;
            setLoading(false);
        }
    }, []);

    const maybeNudge = useCallback(async () => {
        const prefs = (prefsRef.current = getNudgePrefs());
        if (!prefs.enabled) return;
        if (!inActiveHours(prefs)) return;
        const lastActive = _readNum(LS_LAST_ACTIVE);
        if (!lastActive) return;
        const awayMs = Date.now() - lastActive;
        const awayMin = Math.floor(awayMs / 60000);
        if (awayMin < prefs.threshold_min) return;
        const lastShown = _readNum(LS_LAST_NUDGE);
        if (lastShown && Date.now() - lastShown < prefs.snooze_min * 60000) return;
        const d = await fetchNudge(awayMin);
        if (!d) return;
        _writeNum(LS_LAST_NUDGE, Date.now());
        setPayload(d);
        setOpen(true);
        // Schedule a service-worker notification in case the user closes the tab again
        // without acting on the modal, so the nudge can resurface within 2 hours.
        try {
            if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
                const reNudgeAt = Date.now() + prefs.snooze_min * 60_000 + 5_000;
                navigator.serviceWorker.controller.postMessage({
                    type: "schedule-drift-nudge",
                    fireAt: reNudgeAt,
                    title: "A gentle nudge",
                    body: d.next_move || "Pick the smallest move back to what matters.",
                });
            }
        } catch {}
    }, [fetchNudge]);

    // Run on mount and whenever the tab becomes visible again.
    useEffect(() => {
        maybeNudge();
        const onVis = () => {
            if (document.visibilityState === "visible") maybeNudge();
        };
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("focus", onVis);
        return () => {
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("focus", onVis);
        };
    }, [maybeNudge]);

    const snooze = useCallback(() => {
        _writeNum(LS_LAST_NUDGE, Date.now());
        setOpen(false);
        try {
            navigator.serviceWorker?.controller?.postMessage({ type: "cancel-drift-nudge" });
        } catch {}
    }, []);

    const dismiss = useCallback(() => {
        setOpen(false);
    }, []);

    // Dev-only manual trigger
    const triggerNow = useCallback(async () => {
        const d = await fetchNudge(45);
        if (d) {
            setPayload(d);
            setOpen(true);
        }
    }, [fetchNudge]);

    return { open, payload, loading, snooze, dismiss, triggerNow };
}
