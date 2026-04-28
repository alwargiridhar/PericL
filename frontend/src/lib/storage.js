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

const LS = {
    PROFILE: "pericl.profile",
    PERSONALITY: "pericl.personality_assessments",
    JOURNAL: "pericl.journal_items",
    CHAT: "pericl.ai_messages",
    PROMPT_TODAY_PREFIX: "pericl.daily_prompt.", // + YYYY-MM-DD
    PROMPT_HISTORY: "pericl.daily_prompts_history",
    RECAPS: "pericl.daily_recaps",
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
    try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
    } catch {
        return fallback;
    }
}
function lsSet(key, val) {
    try {
        localStorage.setItem(key, JSON.stringify(val));
    } catch {}
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
        return { note, extracted };
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
        return { note, extracted };
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

// ---------- Bulk migrate (when user upgrades local → cloud) ----------
export async function migrateLocalToCloud() {
    const prof = lsGet(LS.PROFILE, null);
    if (prof) await api.put("/profile", prof);
    // Note: full data migration (journal, chat, prompts) is intentionally
    // skipped to keep the implementation focused. Profile syncs immediately;
    // subsequent writes will go to cloud.
}
