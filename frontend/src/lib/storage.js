/**
 * PericL — privacy-first storage abstraction.
 *
 * Modes:
 *   "local" (default) — all user content lives on this device. Server stores only:
 *     identity (auth), session, storage_pref, and ephemerally relays AI calls (no logging).
 *   "cloud" — full sync. Server persists notes, profile, personality, chat, prompts.
 *   "never" — like local + suppress the monthly cloud-sync nudge.
 *
 * All pages should call the helpers below, never the raw `api` directly for user content.
 */

import { api } from "@/lib/api";
import {
    ensureEncryptedStorageReady,
    getEncrypted,
    setEncrypted,
    removeEncrypted,
    isEncryptionActive,
} from "@/lib/encrypted_storage";

// Kick off encryption init eagerly. Reads/writes after this resolves use the
// device key transparently. We re-export the readiness promise for callers
// that need to await (e.g. early app shell).
export const encryptionReady = ensureEncryptedStorageReady();
export { isEncryptionActive };

const LS = {
    PROFILE: "pericl.profile",
    PERSONALITY: "pericl.personality_assessments",
    JOURNAL: "pericl.journal_items",
    CHAT: "pericl.ai_messages",
    PROMPT_TODAY_PREFIX: "pericl.daily_prompt.", // + YYYY-MM-DD
    PROMPT_HISTORY: "pericl.daily_prompts_history",
    RECAPS: "pericl.daily_recaps",
    MISSIONS: "pericl.missions",
    MISSION_PROGRESS: "pericl.mission_progress",
};

// ---------- IndexedDB for audio (avoids 5MB localStorage cap) ----------
const DB_NAME = "pericl_audio";
const STORE = "blobs";
function _openDB() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
async function idbSet(key, val) {
    const db = await _openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
async function idbGet(key) {
    const db = await _openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function idbDel(key) {
    const db = await _openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

// ---------- helpers ----------
function lsGet(key, fallback) {
    return getEncrypted(key, fallback);
}
function lsSet(key, val) {
    // Fire and forget — encryption is a microtask.
    setEncrypted(key, val).catch(() => {});
}
function lsDel(key) {
    removeEncrypted(key);
}
function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}
const nowIso = () => new Date().toISOString();

// ---------- Storage Preference ----------
let _modeCache = null;
export const pref = {
    async get() {
        const r = await api.get("/storage/pref");
        _modeCache = r.data?.mode || "local";
        return r.data;
    },
    async set(mode, fromPrompt = false) {
        const r = await api.put("/storage/pref", { mode, from_prompt: fromPrompt });
        _modeCache = r.data?.mode || mode;
        return r.data;
    },
    async snooze() {
        await api.post("/storage/prompt-shown");
    },
    cachedMode() {
        return _modeCache || "local";
    },
};

const isCloud = () => _modeCache === "cloud";

// ---------- Profile ----------
export const profile = {
    async get() {
        if (isCloud()) {
            const r = await api.get("/profile");
            return r.data;
        }
        return lsGet(LS.PROFILE, { onboarding_completed: false });
    },
    async put(payload) {
        if (isCloud()) {
            const r = await api.put("/profile", payload);
            return r.data;
        }
        const cur = lsGet(LS.PROFILE, {});
        const merged = { ...cur, ...payload };
        merged.onboarding_completed = !!cur.onboarding_completed || !!(
            merged.name || merged.goals || merged.core_values || merged.aspirations
        );
        merged.updated_at = nowIso();
        lsSet(LS.PROFILE, merged);
        return merged;
    },
};

// ---------- Personality ----------
export const personality = {
    async assess(scores) {
        if (isCloud()) {
            const r = await api.post("/personality/assess", { scores });
            return r.data;
        }
        const prof = lsGet(LS.PROFILE, null);
        const r = await api.post("/ai/personality-analyze", { scores, profile: prof });
        const rec = {
            id: uid("pa"),
            framework: "mbti",
            ...r.data,
            created_at: nowIso(),
        };
        const list = lsGet(LS.PERSONALITY, []);
        list.unshift(rec);
        lsSet(LS.PERSONALITY, list.slice(0, 30));
        return rec;
    },
    async assessBigFive(answers) {
        if (isCloud()) {
            const r = await api.post("/personality/big-five-assess", { answers });
            return r.data;
        }
        const prof = lsGet(LS.PROFILE, null);
        const r = await api.post("/ai/big-five-analyze", { answers, profile: prof });
        const rec = {
            id: uid("pa"),
            ...r.data,
            created_at: nowIso(),
        };
        const list = lsGet(LS.PERSONALITY, []);
        list.unshift(rec);
        lsSet(LS.PERSONALITY, list.slice(0, 30));
        return rec;
    },
    async latest() {
        if (isCloud()) {
            const r = await api.get("/personality/latest");
            return r.data;
        }
        const list = lsGet(LS.PERSONALITY, []);
        if (!list.length) return { hasAssessment: false };
        return { hasAssessment: true, assessment: list[0] };
    },
    async result(id) {
        if (isCloud()) {
            const r = await api.get(`/personality/result/${id}`);
            return r.data;
        }
        const list = lsGet(LS.PERSONALITY, []);
        return list.find((x) => x.id === id) || null;
    },
};

// ---------- Journal Items ----------
export const journal = {
    async list() {
        if (isCloud()) {
            const r = await api.get("/timeline");
            return r.data;
        }
        return lsGet(LS.JOURNAL, []);
    },
    async createText(text) {
        if (isCloud()) {
            const r = await api.post("/notes/text", { text });
            return r.data;
        }
        // local: AI categorize via stateless endpoint, save locally
        const ai = await api.post("/ai/categorize", { text }).then((r) => r.data).catch(() => ({}));
        const noteId = uid("note");
        const note = {
            id: noteId,
            type: "text",
            title: ai.summary || text.slice(0, 80),
            detail: text,
            summary: ai.summary || null,
            mood: ai.mood || null,
            completed: false,
            created_at: nowIso(),
        };
        const extracted = (ai.items || [])
            .filter((it) => ["task", "reminder", "idea"].includes(it.type) && it.title)
            .map((it) => ({
                id: uid("item"),
                type: it.type,
                title: String(it.title).slice(0, 200),
                priority: ["low", "medium", "high"].includes(it.priority) ? it.priority : null,
                due_at: it.due_at || null,
                completed: false,
                parent_id: noteId,
                created_at: nowIso(),
            }));
        const list = lsGet(LS.JOURNAL, []);
        lsSet(LS.JOURNAL, [...extracted.slice().reverse(), note, ...list]);
        // Best-effort mission progress auto-detection (local mode)
        const mp = await missions.detectAndLog(text, noteId);
        return { note, extracted, mission_progress: mp };
    },
    async createVoice({ blob, duration, transcript }) {
        if (isCloud()) {
            const fd = new FormData();
            fd.append("audio", blob, "recording.webm");
            fd.append("duration", String(duration));
            fd.append("transcription", transcript || "");
            const r = await api.post("/notes/voice", fd, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            return r.data;
        }
        // local: transcribe via stateless endpoint if no client transcript, then categorize
        let text = (transcript || "").trim();
        if (!text) {
            const fd = new FormData();
            fd.append("audio", blob, "recording.webm");
            try {
                const r = await api.post("/ai/transcribe", fd, {
                    headers: { "Content-Type": "multipart/form-data" },
                });
                text = (r.data?.text || "").trim();
            } catch {}
        }
        const audioId = uid("aud");
        try {
            await idbSet(audioId, blob);
        } catch {
            // IDB unavailable — proceed without storing audio
        }
        const ai = text
            ? await api.post("/ai/categorize", { text }).then((r) => r.data).catch(() => ({}))
            : {};
        const noteId = uid("note");
        const note = {
            id: noteId,
            type: "voice",
            title: ai.summary || (text ? text.slice(0, 80) : "Voice note"),
            audio_id: audioId,
            duration: Number(duration) || 0,
            transcription: text,
            summary: ai.summary || null,
            mood: ai.mood || null,
            completed: false,
            created_at: nowIso(),
        };
        const extracted = (ai.items || [])
            .filter((it) => ["task", "reminder", "idea"].includes(it.type) && it.title)
            .map((it) => ({
                id: uid("item"),
                type: it.type,
                title: String(it.title).slice(0, 200),
                priority: ["low", "medium", "high"].includes(it.priority) ? it.priority : null,
                due_at: it.due_at || null,
                completed: false,
                parent_id: noteId,
                created_at: nowIso(),
            }));
        const list = lsGet(LS.JOURNAL, []);
        lsSet(LS.JOURNAL, [...extracted.slice().reverse(), note, ...list]);
        const mp = text ? await missions.detectAndLog(text, noteId) : null;
        return { note, extracted, mission_progress: mp };
    },
    async update(id, patch) {
        if (isCloud()) {
            const r = await api.patch(`/items/${id}`, patch);
            return r.data;
        }
        const list = lsGet(LS.JOURNAL, []);
        const idx = list.findIndex((i) => i.id === id);
        if (idx === -1) throw new Error("Not found");
        list[idx] = { ...list[idx], ...patch };
        lsSet(LS.JOURNAL, list);
        return list[idx];
    },
    async delete(id) {
        if (isCloud()) {
            await api.delete(`/items/${id}`);
            return;
        }
        const list = lsGet(LS.JOURNAL, []);
        const item = list.find((i) => i.id === id);
        if (item?.audio_id) {
            try { await idbDel(item.audio_id); } catch {}
        }
        lsSet(LS.JOURNAL, list.filter((i) => i.id !== id));
    },
    async audioObjectURL(audioId) {
        if (isCloud()) return `${api.defaults.baseURL}/audio/${audioId}`;
        try {
            const blob = await idbGet(audioId);
            if (blob) return URL.createObjectURL(blob);
        } catch {}
        return null;
    },
};

// ---------- Missions (cloud + local) ----------
const MAX_ACTIVE_MISSIONS_FE = 3;

function _computeStatsLocal(mission, entries) {
    const now = Date.now();
    const start = new Date(mission.start_at || mission.created_at || now).getTime();
    const target = mission.target_date ? new Date(mission.target_date).getTime() : null;
    const totalDays = target ? Math.max(1, Math.round((target - start) / 86400000)) : null;
    const elapsedDays = Math.max(0, Math.round((now - start) / 86400000));
    const daysRemaining = target ? Math.max(0, Math.round((target - now) / 86400000)) : null;

    const tracks = (mission.tracks || []).map((t) => {
        const trEntries = entries.filter((e) => e.track_id === t.id);
        const logged = trEntries.reduce((s, e) => s + Number(e.units || 0), 0);
        const targetUnits = Number(t.target_units || 0);
        return {
            id: t.id,
            title: t.title,
            unit_label: t.unit_label || "units",
            target_units: targetUnits,
            logged_units: logged,
            percent: targetUnits ? Math.min(100, (logged / targetUnits) * 100) : 0,
            entries_count: trEntries.length,
            last_logged_at: trEntries[0]?.created_at || null,
        };
    });
    const grandLogged = tracks.reduce((s, t) => s + t.logged_units, 0);
    const grandTarget = tracks.reduce((s, t) => s + t.target_units, 0);

    let pace = "unknown";
    let expected = 0;
    if (grandTarget && totalDays) {
        expected = grandTarget * (elapsedDays / totalDays);
        if (grandLogged >= expected * 1.05) pace = "ahead";
        else if (grandLogged >= expected * 0.85) pace = "on_track";
        else pace = "behind";
    }

    const dayKeys = new Set(entries.map((e) => (e.created_at || "").slice(0, 10)).filter(Boolean));
    const consistencyPct = elapsedDays ? (dayKeys.size / elapsedDays) * 100 : 0;
    const effortCounts = { low: 0, medium: 0, deep: 0 };
    entries.forEach((e) => { if (effortCounts[e.effort] !== undefined) effortCounts[e.effort] += 1; });
    const lastLogged = entries.length ? entries[0].created_at : null;
    const daysSinceLast = lastLogged
        ? Math.round((now - new Date(lastLogged).getTime()) / 86400000)
        : null;
    return {
        tracks,
        logged_units: grandLogged,
        target_units: grandTarget,
        expected_units_today: Math.round(expected * 10) / 10,
        percent_complete: grandTarget ? Math.min(100, (grandLogged / grandTarget) * 100) : 0,
        elapsed_days: elapsedDays,
        days_remaining: daysRemaining,
        total_days: totalDays,
        pace,
        consistency_pct: Math.round(consistencyPct * 10) / 10,
        effort_counts: effortCounts,
        days_since_last_progress: daysSinceLast,
        entries_count: entries.length,
    };
}

function _serializeMissionLocal(mission) {
    const allProgress = lsGet(LS.MISSION_PROGRESS, []);
    const entries = allProgress
        .filter((p) => p.mission_id === mission.id)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return { ...mission, stats: _computeStatsLocal(mission, entries) };
}

export const missions = {
    async list() {
        if (isCloud()) {
            const r = await api.get("/missions");
            return r.data;
        }
        const list = lsGet(LS.MISSIONS, []);
        return list.map(_serializeMissionLocal);
    },
    async create(payload) {
        if (isCloud()) {
            const r = await api.post("/missions", payload);
            return r.data;
        }
        const list = lsGet(LS.MISSIONS, []);
        const activeCount = list.filter((m) => m.is_active !== false).length;
        if (activeCount >= MAX_ACTIVE_MISSIONS_FE) {
            const e = new Error(`Max ${MAX_ACTIVE_MISSIONS_FE} active missions; archive one first`);
            e.userMessage = e.message;
            throw e;
        }
        const tracks = (payload.tracks || []).slice(0, 6).map((t) => ({
            id: uid("trk"),
            title: String(t.title || "").trim().slice(0, 120),
            target_units: Number(t.target_units || 0),
            unit_label: String(t.unit_label || "units").trim().slice(0, 24),
            is_active: true,
        })).filter((t) => t.title);
        const m = {
            id: uid("msn"),
            title: String(payload.title || "").trim().slice(0, 160),
            outcome: String(payload.outcome || "").slice(0, 400),
            target_date: payload.target_date || null,
            start_at: nowIso(),
            is_active: true,
            tracks,
            created_at: nowIso(),
        };
        if (!m.title) {
            const e = new Error("Mission title required");
            e.userMessage = e.message;
            throw e;
        }
        list.unshift(m);
        lsSet(LS.MISSIONS, list);
        return _serializeMissionLocal(m);
    },
    async update(id, payload) {
        if (isCloud()) {
            const r = await api.patch(`/missions/${id}`, payload);
            return r.data;
        }
        const list = lsGet(LS.MISSIONS, []);
        const i = list.findIndex((m) => m.id === id);
        if (i === -1) throw new Error("Not found");
        const cur = list[i];
        const next = { ...cur };
        ["title", "outcome", "target_date"].forEach((k) => {
            if (k in payload) next[k] = payload[k];
        });
        if ("is_active" in payload) next.is_active = !!payload.is_active;
        if ("tracks" in payload) {
            next.tracks = (payload.tracks || []).slice(0, 6).map((t) => ({
                id: t.id || uid("trk"),
                title: String(t.title || "").trim().slice(0, 120),
                target_units: Number(t.target_units || 0),
                unit_label: String(t.unit_label || "units").trim().slice(0, 24),
                is_active: t.is_active !== false,
            })).filter((t) => t.title);
        }
        list[i] = next;
        lsSet(LS.MISSIONS, list);
        return _serializeMissionLocal(next);
    },
    async delete(id) {
        if (isCloud()) {
            await api.delete(`/missions/${id}`);
            return;
        }
        lsSet(LS.MISSIONS, lsGet(LS.MISSIONS, []).filter((m) => m.id !== id));
        lsSet(LS.MISSION_PROGRESS, lsGet(LS.MISSION_PROGRESS, []).filter((p) => p.mission_id !== id));
    },
    async logProgress(missionId, payload) {
        if (isCloud()) {
            const r = await api.post(`/missions/${missionId}/progress`, payload);
            return r.data;
        }
        const list = lsGet(LS.MISSIONS, []);
        const m = list.find((x) => x.id === missionId);
        if (!m) throw new Error("Mission not found");
        if (payload.track_id && !(m.tracks || []).find((t) => t.id === payload.track_id)) {
            throw new Error("Track not found");
        }
        const entry = {
            id: uid("prg"),
            mission_id: missionId,
            track_id: payload.track_id || null,
            units: Number(payload.units || 0),
            effort: ["low", "medium", "deep"].includes(payload.effort) ? payload.effort : "medium",
            note: String(payload.note || "").slice(0, 400),
            journal_item_id: payload.journal_item_id || null,
            detected: !!payload.detected,
            confidence: payload.confidence,
            created_at: nowIso(),
        };
        if (entry.units <= 0) throw new Error("units must be > 0");
        const all = lsGet(LS.MISSION_PROGRESS, []);
        all.unshift(entry);
        lsSet(LS.MISSION_PROGRESS, all);
        return entry;
    },
    async progressList(missionId) {
        if (isCloud()) {
            const r = await api.get(`/missions/${missionId}/progress`);
            return r.data;
        }
        return lsGet(LS.MISSION_PROGRESS, []).filter((p) => p.mission_id === missionId);
    },
    async deleteProgress(entryId) {
        if (isCloud()) {
            await api.delete(`/missions/progress/${entryId}`);
            return;
        }
        lsSet(LS.MISSION_PROGRESS, lsGet(LS.MISSION_PROGRESS, []).filter((p) => p.id !== entryId));
    },
    // Auto-detect progress from a journal text (used by journal.createText/Voice in local mode)
    async detectAndLog(text, journalItemId) {
        if (!text || isCloud()) return null; // cloud server already runs detection
        const all = lsGet(LS.MISSIONS, []).filter((m) => m.is_active !== false);
        if (!all.length) return null;
        try {
            const r = await api.post("/ai/detect-progress", { text, missions: all });
            const d = r.data;
            if (!d || !d.mission_id || (d.confidence || 0) < 0.55 || !(d.units > 0)) return null;
            const entry = {
                id: uid("prg"),
                mission_id: d.mission_id,
                track_id: d.track_id || null,
                units: Number(d.units),
                effort: d.effort || "medium",
                note: d.note || "",
                journal_item_id: journalItemId,
                detected: true,
                confidence: d.confidence,
                created_at: nowIso(),
            };
            const list = lsGet(LS.MISSION_PROGRESS, []);
            list.unshift(entry);
            lsSet(LS.MISSION_PROGRESS, list);
            return entry;
        } catch {
            return null;
        }
    },
};

// ---------- Behavior signals (local mode) — fed into the Mirror chat prompt ----------
function _computeBehaviorSignalsLocal() {
    const items = lsGet(LS.JOURNAL, []) || [];
    const now = Date.now();
    const sevenAgo = now - 7 * 24 * 3600 * 1000;
    let voiceText7 = 0;
    let completed7 = 0;
    let openTasks = 0;
    let overdue = 0;
    const overdueTitles = [];
    const moods = [];
    let lastEntryAt = 0;
    for (const it of items) {
        const ca = new Date(it.created_at || 0).getTime() || 0;
        if (it.type === "voice" || it.type === "text") {
            if (ca >= sevenAgo) voiceText7 += 1;
            if (ca > lastEntryAt) lastEntryAt = ca;
            if (it.mood) moods.push(it.mood);
        }
        if (it.type === "task") {
            if (it.completed) {
                if (ca >= sevenAgo) completed7 += 1;
            } else {
                openTasks += 1;
            }
        }
        if (it.type === "reminder" && !it.completed && it.due_at) {
            const due = new Date(it.due_at).getTime();
            if (due && due < now) {
                overdue += 1;
                if (overdueTitles.length < 5) overdueTitles.push(it.title);
            }
        }
    }
    const moodCounts = {};
    moods.forEach((m) => { moodCounts[m] = (moodCounts[m] || 0) + 1; });
    const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    return {
        voice_text_entries_7d: voiceText7,
        tasks_completed_7d: completed7,
        open_tasks: openTasks,
        missed_or_overdue_reminders: overdue,
        overdue_titles: overdueTitles,
        days_since_last_entry: lastEntryAt ? Math.floor((now - lastEntryAt) / (24 * 3600 * 1000)) : null,
        top_moods_7d: topMoods,
    };
}

// Lightweight client-side mood heuristic (mirrors AiChat.jsx logic for chat-stateless)
function _inferMoodLocal(text) {
    const t = (text || "").toLowerCase();
    if (/[!]{2,}|🎉|amazing|incredible|stoked|let'?s go|finally|shipped|launch/i.test(t)) return "excited";
    if (/happy|grateful|joy|love|blessed|smile|good day|win|proud/i.test(t)) return "happy";
    if (/stress|overwhelm|anxious|panic|deadline|too much|burn(ed|t)? out/i.test(t)) return "stressed";
    if (/sad|down|cry|lonely|miss|hurt|alone|tired/i.test(t)) return "sad";
    if (/calm|peaceful|breathe|quiet|still|relax/i.test(t)) return "calm";
    if (/focus|plan|ship|build|goal|priorit|launch|strateg/i.test(t)) return "focused";
    return null;
}

// ---------- AI Chat ----------
export const chat = {
    async list() {
        if (isCloud()) {
            const r = await api.get("/ai/messages");
            return r.data;
        }
        return lsGet(LS.CHAT, []);
    },
    async send(message) {
        if (isCloud()) {
            const r = await api.post("/ai/chat", { message });
            return r.data;
        }
        const history = lsGet(LS.CHAT, []);
        const prof = lsGet(LS.PROFILE, null);
        const palist = lsGet(LS.PERSONALITY, []);
        const personalityDoc = palist[0] || null;
        const journalList = lsGet(LS.JOURNAL, []);
        const recent_moods = journalList
            .filter((i) => i.type === "voice" || i.type === "text")
            .map((i) => i.mood)
            .filter(Boolean)
            .slice(0, 8);
        const userMsg = { id: uid("m"), role: "user", content: message, created_at: nowIso() };
        const r = await api.post("/ai/chat-stateless", {
            message,
            history,
            profile: prof,
            personality: personalityDoc,
            recent_moods,
            behavior: _computeBehaviorSignalsLocal(),
            current_mood: _inferMoodLocal(message),
            missions: lsGet(LS.MISSIONS, [])
                .filter((m) => m.is_active !== false)
                .slice(0, 3)
                .map(_serializeMissionLocal),
        });
        const asstMsg = {
            id: uid("m"),
            role: "assistant",
            content: r.data?.reply || "",
            created_at: nowIso(),
        };
        lsSet(LS.CHAT, [...history, userMsg, asstMsg]);
        return { user_message: userMsg, assistant_message: asstMsg };
    },
    async clearAll() {
        if (isCloud()) {
            await api.delete("/ai/messages");
            return;
        }
        lsSet(LS.CHAT, []);
    },
    async deleteOne(id) {
        if (isCloud()) {
            await api.delete(`/ai/messages/${id}`);
            return;
        }
        const list = lsGet(LS.CHAT, []);
        lsSet(LS.CHAT, list.filter((m) => m.id !== id));
    },
    /**
     * Streaming send. onDelta(token) is called for each chunk.
     * Returns { user_message, assistant_message } at the end.
     */
    async sendStream(message, onDelta) {
        const headers = { "Content-Type": "application/json" };
        const url = isCloud()
            ? `${api.defaults.baseURL}/ai/chat/stream`
            : `${api.defaults.baseURL}/ai/chat-stateless/stream`;
        let body;
        if (isCloud()) {
            body = JSON.stringify({ message });
        } else {
            const history = lsGet(LS.CHAT, []);
            const prof = lsGet(LS.PROFILE, null);
            const palist = lsGet(LS.PERSONALITY, []);
            const personalityDoc = palist[0] || null;
            const journalList = lsGet(LS.JOURNAL, []);
            const recent_moods = journalList
                .filter((i) => i.type === "voice" || i.type === "text")
                .map((i) => i.mood)
                .filter(Boolean)
                .slice(0, 8);
            body = JSON.stringify({
                message,
                history,
                profile: prof,
                personality: personalityDoc,
                recent_moods,
                behavior: _computeBehaviorSignalsLocal(),
                current_mood: _inferMoodLocal(message),
                missions: lsGet(LS.MISSIONS, [])
                    .filter((m) => m.is_active !== false)
                    .slice(0, 3)
                    .map(_serializeMissionLocal),
            });
        }
        const resp = await fetch(url, {
            method: "POST",
            headers,
            credentials: "include",
            body,
        });
        if (!resp.ok || !resp.body) {
            throw new Error(`Stream failed: ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let full = "";
        let userMsgId = null;
        let asstMsgId = null;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const frames = buf.split("\n\n");
            buf = frames.pop() || "";
            for (const f of frames) {
                const line = f.split("\n").find((l) => l.startsWith("data: "));
                if (!line) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;
                try {
                    const obj = JSON.parse(payload);
                    if (obj.meta) {
                        userMsgId = obj.meta.user_message_id || userMsgId;
                        asstMsgId = obj.meta.assistant_message_id || asstMsgId;
                    } else if (typeof obj.delta === "string") {
                        full += obj.delta;
                        onDelta && onDelta(obj.delta, full);
                    }
                } catch {}
            }
        }
        const created_at = nowIso();
        const user_message = {
            id: userMsgId || uid("m"),
            role: "user",
            content: message,
            created_at,
        };
        const assistant_message = {
            id: asstMsgId || uid("m"),
            role: "assistant",
            content: full.trim(),
            created_at,
        };
        if (!isCloud()) {
            const history = lsGet(LS.CHAT, []);
            lsSet(LS.CHAT, [...history, user_message, assistant_message]);
        }
        return { user_message, assistant_message };
    },
};

// ---------- Daily Prompt ----------
function _todayKey() {
    return LS.PROMPT_TODAY_PREFIX + new Date().toISOString().slice(0, 10);
}
export const prompt = {
    async today() {
        if (isCloud()) {
            const r = await api.get("/daily-prompt");
            return r.data;
        }
        const key = _todayKey();
        const existing = lsGet(key, null);
        if (existing) return existing;
        const palist = lsGet(LS.PERSONALITY, []);
        const pt = palist[0]?.personality_type || null;
        const r = await api.get("/ai/daily-prompt-pick", { params: { personality_type: pt } });
        const doc = {
            id: uid("dp"),
            prompt_date: new Date().toISOString().slice(0, 10),
            prompt_text: r.data?.text || "Take a breath. What's surfacing for you right now?",
            prompt_type: r.data?.type || "reflection",
            response_text: null,
            is_completed: false,
            completed_at: null,
            created_at: nowIso(),
        };
        lsSet(key, doc);
        return doc;
    },
    async respond(response) {
        if (isCloud()) {
            const r = await api.post("/daily-prompt/respond", { response });
            return r.data;
        }
        const key = _todayKey();
        const today = lsGet(key, null);
        if (!today) throw new Error("No prompt for today");
        const updated = {
            ...today,
            response_text: response,
            is_completed: true,
            completed_at: nowIso(),
        };
        lsSet(key, updated);
        const hist = lsGet(LS.PROMPT_HISTORY, []);
        const idx = hist.findIndex((h) => h.id === updated.id);
        if (idx >= 0) hist[idx] = updated;
        else hist.unshift(updated);
        lsSet(LS.PROMPT_HISTORY, hist.slice(0, 365));
        return updated;
    },
    async history() {
        if (isCloud()) {
            const r = await api.get("/daily-prompts/history");
            return r.data;
        }
        return lsGet(LS.PROMPT_HISTORY, []);
    },
    async delete(id) {
        if (isCloud()) {
            await api.delete(`/daily-prompts/${id}`);
            return;
        }
        const hist = lsGet(LS.PROMPT_HISTORY, []);
        lsSet(LS.PROMPT_HISTORY, hist.filter((p) => p.id !== id));
        const todayKey = _todayKey();
        const t = lsGet(todayKey, null);
        if (t && t.id === id) lsSet(todayKey, null);
    },
};

// ---------- Recap ----------
export const recap = {
    async today() {
        if (isCloud()) {
            const r = await api.post("/recap/today");
            return r.data;
        }
        const list = lsGet(LS.JOURNAL, []);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const items = list.filter((i) => new Date(i.created_at) >= todayStart);
        if (!items.length) {
            const e = new Error("No entries today yet");
            e.userMessage = "No entries today yet";
            throw e;
        }
        const counts = {
            voice_count: items.filter((i) => i.type === "voice" || i.type === "text").length,
            task_count: items.filter((i) => i.type === "task").length,
            reminder_count: items.filter((i) => i.type === "reminder").length,
            idea_count: items.filter((i) => i.type === "idea").length,
        };
        const r = await api.post("/ai/recap-stateless", { items });
        const rec = {
            id: uid("recap"),
            recap_date: todayStart.toISOString().slice(0, 10),
            summary: r.data?.summary || "",
            ...counts,
            created_at: nowIso(),
        };
        const recaps = lsGet(LS.RECAPS, []);
        recaps.unshift(rec);
        lsSet(LS.RECAPS, recaps.slice(0, 60));
        return rec;
    },
    async list() {
        if (isCloud()) {
            const r = await api.get("/recap");
            return r.data;
        }
        return lsGet(LS.RECAPS, []);
    },
};

// ---------- Search (journal + chat) ----------
export const search = {
    async query(q) {
        const term = (q || "").trim();
        if (!term) return { journal: [], chat: [] };
        if (isCloud()) {
            const r = await api.get("/search", { params: { q: term } });
            return r.data || { journal: [], chat: [] };
        }
        const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const items = lsGet(LS.JOURNAL, []).filter((i) =>
            re.test(i.title || "") ||
            re.test(i.detail || "") ||
            re.test(i.transcription || "") ||
            re.test(i.summary || "")
        ).slice(0, 50);
        const chats = lsGet(LS.CHAT, []).filter((m) => re.test(m.content || "")).slice(0, 50);
        return { journal: items, chat: chats };
    },
};

// ---------- Mood timeline ----------
export const mood = {
    async timeline(days = 30) {
        if (isCloud()) {
            const r = await api.get("/mood/timeline", { params: { days } });
            return r.data || [];
        }
        const since = Date.now() - days * 24 * 3600 * 1000;
        return lsGet(LS.JOURNAL, [])
            .filter((i) => (i.type === "voice" || i.type === "text") && i.mood)
            .filter((i) => new Date(i.created_at).getTime() >= since)
            .map((i) => ({ created_at: i.created_at, mood: i.mood }))
            .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    },
};

// ---------- Drift nudge (returning-after-away gentle prompt) ----------
export const drift = {
    async generate(minutesAway) {
        const minutes = Math.max(1, Math.round(minutesAway || 30));
        if (isCloud()) {
            const r = await api.post("/ai/drift-nudge", { minutes_away: minutes });
            return r.data;
        }
        const profile = lsGet(LS.PROFILE, null);
        const missions = lsGet(LS.MISSIONS, [])
            .filter((m) => m.is_active !== false)
            .slice(0, 3)
            .map(_serializeMissionLocal);
        const r = await api.post("/ai/drift-nudge-stateless", {
            minutes_away: minutes,
            profile,
            missions,
        });
        return r.data;
    },
};

// ---------- Bulk migrate (when user upgrades local → cloud) ----------
export async function migrateLocalToCloud() {
    const payload = {
        profile: lsGet(LS.PROFILE, null),
        personality_assessments: lsGet(LS.PERSONALITY, []),
        journal_items: lsGet(LS.JOURNAL, []),
        ai_messages: lsGet(LS.CHAT, []),
        daily_prompts: lsGet(LS.PROMPT_HISTORY, []),
        daily_recaps: lsGet(LS.RECAPS, []),
        missions: lsGet(LS.MISSIONS, []),
        mission_progress: lsGet(LS.MISSION_PROGRESS, []),
    };
    const r = await api.post("/sync/import", payload);
    return r.data;
}

/** Pull all cloud data into local storage (for cloud→local switch). */
export async function migrateCloudToLocal() {
    const r = await api.get("/sync/export");
    const d = r.data || {};
    if (d.profile) lsSet(LS.PROFILE, d.profile);
    if (Array.isArray(d.personality_assessments)) lsSet(LS.PERSONALITY, d.personality_assessments);
    if (Array.isArray(d.journal_items)) lsSet(LS.JOURNAL, d.journal_items);
    if (Array.isArray(d.ai_messages)) lsSet(LS.CHAT, d.ai_messages);
    if (Array.isArray(d.daily_prompts)) lsSet(LS.PROMPT_HISTORY, d.daily_prompts);
    if (Array.isArray(d.daily_recaps)) lsSet(LS.RECAPS, d.daily_recaps);
    if (Array.isArray(d.missions)) lsSet(LS.MISSIONS, d.missions);
    if (Array.isArray(d.mission_progress)) lsSet(LS.MISSION_PROGRESS, d.mission_progress);
    return d;
}
