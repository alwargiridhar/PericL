/**
 * BehavioralEngine — purely deterministic on-device computation of
 * Self-Trust + Execution scores from local journal/mission data.
 *
 * For cloud users we still call /api/scores so the server is the source of
 * truth; for local users the same algorithm runs entirely in the browser.
 *
 * Why deterministic? Per the product spec, scores must NOT cost LLM tokens
 * and must update in real time as the user logs activity.
 */

import { api } from "@/lib/api";
import { journal as journalStore } from "@/lib/storage";

function _dateKey(iso) {
    if (!iso) return null;
    try { return new Date(iso).toISOString().slice(0, 10); } catch { return null; }
}

export function computeScoresFromItems(items, days = 14) {
    const now = Date.now();
    const horizon = now - days * 24 * 3600 * 1000;
    const inWindow = (i) => {
        const t = i.created_at ? Date.parse(i.created_at) : 0;
        return t >= horizon;
    };
    const captures = (items || []).filter((i) => (i.type === "voice" || i.type === "text") && inWindow(i));
    const tasks = (items || []).filter((i) => i.type === "task" && inWindow(i));
    const reminders = (items || []).filter((i) => i.type === "reminder" && inWindow(i));

    const captures_per_day = captures.length / Math.max(1, days);
    const tasks_total = tasks.length;
    const tasks_done = tasks.filter((t) => t.completed).length;
    const reminders_total = reminders.length;
    const reminders_done = reminders.filter((r) => r.completed).length;
    const days_active = new Set(captures.map((i) => _dateKey(i.created_at)).filter(Boolean)).size;

    const taskRate = tasks_total ? tasks_done / tasks_total : 0.5;
    const remRate = reminders_total ? reminders_done / reminders_total : 0.5;
    const activityNorm = Math.min(1, captures_per_day / 1.5);

    const execution = Math.round((taskRate * 0.45 + remRate * 0.20 + activityNorm * 0.35) * 100);
    const self_trust = Math.round(((days_active / Math.max(1, days)) * 0.50 + taskRate * 0.30 + remRate * 0.20) * 100);

    const lastCap = captures.reduce((acc, i) => Math.max(acc, Date.parse(i.created_at || 0) || 0), 0);
    const hours_since = lastCap ? (now - lastCap) / 3600000 : days * 24;

    let drift_signal = null;
    if (captures.length === 0) {
        drift_signal = "Nothing captured this week — when did you last say what was actually on your mind?";
    } else if (hours_since > 48) {
        drift_signal = `It's been ${Math.round(hours_since / 24)} days since you last wrote anything down.`;
    } else if (tasks_total >= 3 && tasks_done === 0) {
        drift_signal = `You've named ${tasks_total} things to do — none done yet.`;
    } else if (reminders_total > 0 && reminders_done === 0) {
        drift_signal = "You set reminders but haven't followed through on any.";
    } else if (days_active < 3 && days >= 7) {
        drift_signal = `Only ${days_active} active day(s) in the last week — momentum is thin.`;
    }

    return {
        self_trust: Math.max(0, Math.min(100, self_trust)),
        execution: Math.max(0, Math.min(100, execution)),
        consistency_days: days_active,
        drift_signal,
        stats: {
            captures: captures.length,
            captures_per_day: Math.round(captures_per_day * 100) / 100,
            tasks_total, tasks_done, reminders_total, reminders_done,
            hours_since_last_capture: Math.round(hours_since * 10) / 10,
        },
    };
}

/**
 * High-level entry point. For cloud users: hits /api/insights/today.
 * For local users: builds the payload from on-device data and calls the
 * stateless variant so the server can craft the next-move sentence.
 */
export async function getTodayInsights({ mode } = {}) {
    if (mode === "cloud") {
        const r = await api.get("/insights/today");
        return r.data;
    }
    // local / never modes — gather context from device storage.
    const items = await journalStore.list({ limit: 1000 });
    const profile = JSON.parse(localStorage.getItem("pericl.profile") || "null");
    // Missions — try cloud, fall back to local cache used by missions.list()
    let missions = [];
    try {
        const cached = JSON.parse(localStorage.getItem("pericl.missions") || "[]");
        missions = (cached || []).filter((m) => m.is_active !== false).slice(0, 3);
    } catch { /* ignore */ }
    const scores = computeScoresFromItems(items, 14);
    try {
        const r = await api.post("/insights/today-stateless", {
            items, profile, missions,
        });
        return r.data;
    } catch {
        // Final fallback: synthesise a humble next move locally.
        return {
            scores,
            missions,
            next_move: {
                headline: "Smallest move back to today.",
                action: "Open your journal and write one honest sentence about where you are.",
                anchor: (missions[0]?.outcome || missions[0]?.title || "what matters to you"),
            },
        };
    }
}
