const VERIFY_PLAINTEXT = 'vagtplan-auth-v1';
const AUTH_SALT_KEY = 'auth_salt';
const AUTH_VERIFY_KEY = 'auth_verify';

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function toBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt) {
    const raw = await crypto.subtle.importKey('raw', textEnc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
        raw,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptData(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEnc.encode(plaintext));
    const combined = new Uint8Array(12 + ct.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ct), 12);
    return toBase64(combined);
}

export async function decryptData(key, b64) {
    const combined = fromBase64(b64);
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return textDec.decode(pt);
}

export function isAuthSetup() {
    return !!localStorage.getItem(AUTH_SALT_KEY) && !!localStorage.getItem(AUTH_VERIFY_KEY);
}

export async function createAuthKey(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const verify = await encryptData(key, VERIFY_PLAINTEXT);
    localStorage.setItem(AUTH_SALT_KEY, toBase64(salt));
    localStorage.setItem(AUTH_VERIFY_KEY, verify);
    return key;
}

export async function unlockAuthKey(password) {
    const saltB64 = localStorage.getItem(AUTH_SALT_KEY);
    const verifyB64 = localStorage.getItem(AUTH_VERIFY_KEY);
    if (!saltB64 || !verifyB64) return null;
    const salt = fromBase64(saltB64);
    const key = await deriveKey(password, salt);
    try {
        const result = await decryptData(key, verifyB64);
        return result === VERIFY_PLAINTEXT ? key : null;
    } catch {
        return null;
    }
}
