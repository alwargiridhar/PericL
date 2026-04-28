/**
 * usePushReminders — schedules native Notifications for upcoming due reminders.
 *
 * Scope: foreground-only (no service worker). When the page is open, this hook
 * watches the items list and fires a `new Notification(...)` when each reminder
 * becomes due. Persists which reminders have already fired (per id) so a refresh
 * within the same hour doesn't double-notify.
 */
import { useEffect, useRef } from "react";

const FIRED_KEY = "pericl.push_fired_ids";
const _supported = () => typeof window !== "undefined" && "Notification" in window;

function _readFired() {
    try { return JSON.parse(localStorage.getItem(FIRED_KEY) || "[]"); } catch { return []; }
}
function _writeFired(arr) {
    try { localStorage.setItem(FIRED_KEY, JSON.stringify(arr.slice(-200))); } catch {}
}

export function pushPermission() {
    if (!_supported()) return "unsupported";
    return Notification.permission; // "default" | "granted" | "denied"
}

export async function requestPushPermission() {
    if (!_supported()) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
        const r = await Notification.requestPermission();
        return r;
    } catch {
        return "denied";
    }
}

export default function usePushReminders(items, onFired) {
    const timersRef = useRef(new Map());
    const onFiredRef = useRef(onFired);
    useEffect(() => { onFiredRef.current = onFired; }, [onFired]);

    useEffect(() => {
        if (!_supported() || Notification.permission !== "granted") return;

        const firedSet = new Set(_readFired());

        // Clear timers we no longer need
        const valid = new Set();
        const now = Date.now();
        for (const it of items || []) {
            if (it.type !== "reminder" || it.completed || !it.due_at) continue;
            const t = new Date(it.due_at).getTime();
            if (!t || t < now - 60_000) continue; // skip very stale
            valid.add(it.id);
            if (timersRef.current.has(it.id)) continue;
            const delay = Math.max(0, t - now);
            // Cap at ~24h ahead to avoid runaway timers; will reschedule on next render
            if (delay > 24 * 3600 * 1000) continue;
            const timer = setTimeout(() => {
                try {
                    if (firedSet.has(it.id)) return;
                    firedSet.add(it.id);
                    _writeFired([..._readFired(), it.id]);
                    new Notification(it.title || "Reminder", {
                        body: "Reminder is due",
                        tag: `pericl-reminder-${it.id}`,
                        icon: "/favicon.ico",
                    });
                    onFiredRef.current && onFiredRef.current(it);
                } catch {}
            }, delay);
            timersRef.current.set(it.id, timer);
        }
        // Cancel timers for items no longer present/valid
        for (const [id, timer] of timersRef.current.entries()) {
            if (!valid.has(id)) {
                clearTimeout(timer);
                timersRef.current.delete(id);
            }
        }

        return () => {
            // clean up only on unmount; intra-update cleanup is handled above
        };
    }, [items]);

    useEffect(() => () => {
        for (const t of timersRef.current.values()) clearTimeout(t);
        timersRef.current.clear();
    }, []);
}
