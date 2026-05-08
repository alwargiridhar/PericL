/**
 * Encrypted local storage wrapper using Web Crypto API (AES-GCM).
 *
 * Design goals:
 *   - Drop-in replacement for the existing lsGet/lsSet helpers in lib/storage.js
 *   - Per-device key (random, lives in IndexedDB only — never leaves the device,
 *     never sent to the server). If the user clears site data the key is gone
 *     and the data is unrecoverable. That's the privacy tradeoff.
 *   - Backwards-compatible read path: if a stored value is plain JSON (legacy)
 *     it is decoded as-is. Subsequent writes are always encrypted.
 *   - Synchronous-friendly API for callers that don't want to await: we keep
 *     an in-memory cache hydrated on init, so reads after init return instantly.
 *
 * Implementation note: localStorage values are strings. We store
 *   encrypted blobs as base64 with a small JSON envelope to detect them.
 */

const DB_NAME = "pericl_keys";
const STORE = "keys";
const KEY_ID = "device-key-v1";
const ENVELOPE_PREFIX = "PCL1:"; // marker for encrypted strings

let _cryptoKey = null;
let _ready = false;
let _readyPromise = null;
const _cache = new Map(); // memoized decrypted JSON values

function _isCryptoAvailable() {
    return (
        typeof window !== "undefined" &&
        window.crypto &&
        window.crypto.subtle &&
        typeof window.crypto.subtle.encrypt === "function"
    );
}

function _idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _idbGetKey() {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(KEY_ID);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
}

async function _idbPutKey(key) {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(key, KEY_ID);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

async function _getOrCreateKey() {
    let stored;
    try {
        stored = await _idbGetKey();
    } catch {
        stored = null;
    }
    if (stored) return stored;
    const k = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, // extractable so we can persist it
        ["encrypt", "decrypt"]
    );
    try { await _idbPutKey(k); } catch {}
    return k;
}

function _b64encode(buf) {
    let s = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}
function _b64decode(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
}

async function _encryptString(plain) {
    if (!_cryptoKey) return null;
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plain);
    const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, _cryptoKey, enc);
    return ENVELOPE_PREFIX + _b64encode(iv) + ":" + _b64encode(cipher);
}

async function _decryptString(payload) {
    if (!_cryptoKey || typeof payload !== "string" || !payload.startsWith(ENVELOPE_PREFIX)) {
        return null;
    }
    const [, ivB, ctB] = payload.split(":");
    if (!ivB || !ctB) return null;
    const iv = new Uint8Array(_b64decode(ivB));
    const ct = _b64decode(ctB);
    const plain = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, _cryptoKey, ct);
    return new TextDecoder().decode(plain);
}

/**
 * Initialise the encrypted store. Safe to call multiple times — the second call
 * resolves the same promise. After this resolves, sync getCachedJson works.
 */
export async function ensureEncryptedStorageReady() {
    if (_ready) return true;
    if (_readyPromise) return _readyPromise;
    if (!_isCryptoAvailable()) {
        // Fallback: no encryption, plain pass-through.
        _ready = true;
        return true;
    }
    _readyPromise = (async () => {
        try {
            _cryptoKey = await _getOrCreateKey();
        } catch (e) {
            console.warn("[pericl] encrypted storage unavailable, falling back:", e);
            _cryptoKey = null;
        }
        // Hydrate cache from existing localStorage (decrypt where possible).
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        for (const k of keys) {
            if (!k || !k.startsWith("pericl.")) continue;
            const raw = localStorage.getItem(k);
            if (raw == null) continue;
            try {
                if (raw.startsWith(ENVELOPE_PREFIX) && _cryptoKey) {
                    const plain = await _decryptString(raw);
                    if (plain != null) _cache.set(k, JSON.parse(plain));
                } else {
                    // Legacy plain value — keep it readable, don't blow up if it's not JSON.
                    try { _cache.set(k, JSON.parse(raw)); } catch { _cache.set(k, raw); }
                }
            } catch (e) {
                console.warn("[pericl] failed to hydrate", k, e);
            }
        }
        _ready = true;
        return true;
    })();
    return _readyPromise;
}

/** Get a JSON value previously written with `setEncrypted`. Returns `fallback` if missing. */
export function getEncrypted(key, fallback) {
    if (_cache.has(key)) return _cache.get(key);
    // Best-effort sync read for callers that haven't awaited init — read raw plain JSON
    // (encrypted blobs only become usable after ensureEncryptedStorageReady()).
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        if (raw.startsWith(ENVELOPE_PREFIX)) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

/**
 * Write a JSON value. Encrypts when possible, falls back to plain JSON when
 * Web Crypto isn't available. Always updates the in-memory cache so subsequent
 * `getEncrypted` calls see the new value immediately.
 */
export async function setEncrypted(key, value) {
    _cache.set(key, value);
    const json = JSON.stringify(value);
    if (_cryptoKey) {
        try {
            const blob = await _encryptString(json);
            localStorage.setItem(key, blob);
            return;
        } catch (e) {
            console.warn("[pericl] encrypt failed, storing plain:", e);
        }
    }
    localStorage.setItem(key, json);
}

/** Remove a key from both cache and underlying storage. */
export function removeEncrypted(key) {
    _cache.delete(key);
    try { localStorage.removeItem(key); } catch {}
}

/** Returns whether the device key is available (i.e. real encryption is on). */
export function isEncryptionActive() {
    return !!_cryptoKey;
}
