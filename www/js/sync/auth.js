/**
 * Microsoft-Anmeldung für OneDrive.
 *
 * Drei Wege, weil MSAL nur im echten Browser funktioniert:
 *   Web      MSAL mit Popup (die Origin ist als SPA registriert).
 *   Android  Auth-Code-Flow mit PKCE im System-Browser, Rücksprung über
 *            `locked://auth`. `loginPopup()` ruft `window.open()`, und die
 *            Capacitor-WebView reicht das an Chrome weiter — das Token käme
 *            über `window.opener` nie zurück.
 *   Desktop  derselbe PKCE-Flow, Rücksprung aber über einen kurzlebigen
 *            HTTP-Server auf `http://localhost:<port>`.
 *
 * Der Token-Tausch läuft auf Android und Desktop über die native Seite
 * (`postForm`), nicht über `fetch()` — siehe platform.js.
 */

import { IS_NATIVE, IS_ELECTRON, postForm, openExternal, closeExternal, onAppUrlOpen } from '../platform.js';

export const CFG = {
  clientId: 'ae218dcc-feae-4d39-8190-dd12b272d517',
  authority: 'https://login.microsoftonline.com/common',
  // Pfad relativ zum OneDrive-Root. 2.0 schreibt bewusst in eine eigene Datei:
  // die alte App kennt weder settings noch legacy und würde beides beim
  // Speichern stillschweigend entfernen.
  oneDrivePath: '/Documents/sonstiges/Keuschhaltung/locked2.json',
  legacyPath:   '/Documents/sonstiges/Keuschhaltung/locked.json',
  scopes: 'Files.ReadWrite offline_access openid profile',
};

const NATIVE_REDIRECT = 'locked://auth';
const LS_TOKENS = 'locked_ms_auth_v2';

export const AUTH = { account: null, ready: false, redirectUri: null };

let msalInstance = null;
let tokens = null;          // { access_token, refresh_token, expires_at, username }
let pending = null;         // { verifier, state, redirectUri }
let onAuthChange = () => {};
let onSignedIn = async () => {};

export function setAuthHandlers({ change, signedIn }) {
  if (change) onAuthChange = change;
  if (signedIn) onSignedIn = signedIn;
}

const usesPkce = () => IS_NATIVE || IS_ELECTRON;

// =========================== PKCE ===========================
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomB64(len = 32) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function challengeOf(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}
/** Query-Parameter aus einer Custom-Scheme-URL ziehen (new URL() ist da unzuverlässig). */
function paramsFromUrl(url) {
  const qi = url.indexOf('?');
  if (qi < 0) return new URLSearchParams('');
  const hi = url.indexOf('#', qi);
  return new URLSearchParams(hi > qi ? url.slice(qi + 1, hi) : url.slice(qi + 1));
}
/** Anzeigename aus dem id_token — nur Payload, rein kosmetisch. */
function usernameFromIdToken(idToken) {
  try {
    const p = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.preferred_username || p.email || p.name || null;
  } catch { return null; }
}

function saveTokens() {
  try { localStorage.setItem(LS_TOKENS, JSON.stringify(tokens)); } catch {}
}
function clearTokens() {
  tokens = null;
  try { localStorage.removeItem(LS_TOKENS); } catch {}
}

async function tokenRequest(form) {
  const res = await postForm(`${CFG.authority}/oauth2/v2.0/token`, form);
  const body = res.body || {};
  if (!res.ok) throw new Error(body.error_description || body.error || `Token-Endpunkt HTTP ${res.status}`);
  if (!body.access_token) throw new Error('Antwort ohne access_token');
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || (tokens && tokens.refresh_token) || null,
    expires_at: Date.now() + ((body.expires_in || 3600) - 120) * 1000,  // 2 Min Sicherheitsabstand
    username: (body.id_token && usernameFromIdToken(body.id_token))
      || (tokens && tokens.username) || 'Microsoft-Konto',
  };
}

async function pkceLogin() {
  const verifier = randomB64();
  const state = randomB64(16);
  let redirectUri = NATIVE_REDIRECT;
  let warten = null;

  if (IS_ELECTRON) {
    const begun = await window.locked.beginAuth();
    redirectUri = begun.redirectUri;
    warten = window.locked.awaitAuth();
  }
  pending = { verifier, state, redirectUri };
  AUTH.redirectUri = redirectUri;

  const q = new URLSearchParams({
    client_id: CFG.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: CFG.scopes,
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  await openExternal(`${CFG.authority}/oauth2/v2.0/authorize?${q}`);

  if (warten) {
    const params = await warten;          // Desktop: der Loopback-Server meldet sich
    await completePkce(params);
  }
  // Android: der Rücksprung kommt später über onAppUrlOpen().
}

/** @param {object} params  { code, state, error, error_description } */
async function completePkce(params) {
  if (params.error) {
    pending = null;
    throw new Error(params.error_description || params.error);
  }
  if (!params.code) return;
  if (!pending || params.state !== pending.state) {
    pending = null;
    throw new Error('Anmeldung abgelehnt (state stimmt nicht)');
  }
  try {
    tokens = await tokenRequest({
      client_id: CFG.clientId,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      scope: CFG.scopes,
    });
    saveTokens();
    AUTH.account = { username: tokens.username };
    onAuthChange();
    await onSignedIn();
  } finally {
    pending = null;
  }
}

/** Rücksprung aus dem Custom Tab (Android). */
async function handleNativeRedirect(url) {
  if (!url || url.indexOf(NATIVE_REDIRECT) !== 0) return;
  await closeExternal();
  await completePkce(Object.fromEntries(paramsFromUrl(url)));
}

async function pkceToken() {
  if (!tokens) throw new Error('Nicht angemeldet');
  if (tokens.access_token && Date.now() < tokens.expires_at) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('Sitzung abgelaufen — bitte neu anmelden');
  tokens = await tokenRequest({
    client_id: CFG.clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    scope: CFG.scopes,
  });
  saveTokens();
  return tokens.access_token;
}

// =========================== MSAL (Web) ===========================
function msalConfig() {
  return {
    auth: {
      clientId: CFG.clientId,
      authority: CFG.authority,
      redirectUri: window.location.origin + window.location.pathname,
    },
    cache: { cacheLocation: 'localStorage' },
  };
}

// MSAL liegt lokal statt beim CDN: ein CDN-Skript ohne Integritätsprüfung könnte
// beliebigen Code in einer App ausführen, die OneDrive-Token hält — und offline
// wäre es gar nicht da. Geladen wird es trotzdem erst bei Bedarf.
let msalPending = null;
function loadMsal() {
  if (window.msal) return Promise.resolve(window.msal);
  if (msalPending) return msalPending;
  msalPending = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/msal-browser.min.js';
    s.onload = () => window.msal ? resolve(window.msal) : reject(new Error('MSAL nicht verfügbar'));
    s.onerror = () => { msalPending = null; reject(new Error('MSAL konnte nicht geladen werden')); };
    document.head.appendChild(s);
  });
  return msalPending;
}

// =========================== ÖFFENTLICHE API ===========================
export async function initAuth() {
  if (usesPkce()) {
    onAppUrlOpen(url => {
      handleNativeRedirect(url).catch(e => console.error('Rücksprung fehlgeschlagen', e));
    });
    try { tokens = JSON.parse(localStorage.getItem(LS_TOKENS) || 'null'); }
    catch { tokens = null; }
    if (tokens) AUTH.account = { username: tokens.username };
    AUTH.redirectUri = IS_ELECTRON ? 'http://localhost (freier Port)' : NATIVE_REDIRECT;
    AUTH.ready = true;
    onAuthChange();
    return;
  }
  AUTH.redirectUri = msalConfig().auth.redirectUri;
  try { await loadMsal(); }
  catch (e) { console.warn('MSAL nicht ladbar', e); AUTH.ready = true; onAuthChange(); return; }
  msalInstance = new window.msal.PublicClientApplication(msalConfig());
  await msalInstance.initialize();
  try { await msalInstance.handleRedirectPromise(); } catch (e) { console.error(e); }
  const accs = msalInstance.getAllAccounts();
  if (accs.length) {
    msalInstance.setActiveAccount(accs[0]);
    AUTH.account = accs[0];
  }
  AUTH.ready = true;
  onAuthChange();
}

export async function login() {
  if (usesPkce()) { await pkceLogin(); return; }
  if (!msalInstance) throw new Error('Anmeldung nicht verfügbar');
  const r = await msalInstance.loginPopup({ scopes: ['Files.ReadWrite'] });
  msalInstance.setActiveAccount(r.account);
  AUTH.account = r.account;
  onAuthChange();
  await onSignedIn();
}

export async function logout() {
  if (usesPkce()) {
    clearTokens();
    AUTH.account = null;
    onAuthChange();
    return;
  }
  if (!msalInstance) return;
  try { await msalInstance.logoutPopup({ account: AUTH.account }); } catch {}
  AUTH.account = null;
  onAuthChange();
}

export async function getToken() {
  if (usesPkce()) return pkceToken();
  if (!msalInstance || !AUTH.account) throw new Error('Nicht angemeldet');
  try {
    const r = await msalInstance.acquireTokenSilent({ scopes: ['Files.ReadWrite'], account: AUTH.account });
    return r.accessToken;
  } catch (e) {
    if (window.msal && e instanceof window.msal.InteractionRequiredAuthError) {
      const r = await msalInstance.acquireTokenPopup({ scopes: ['Files.ReadWrite'] });
      return r.accessToken;
    }
    throw e;
  }
}

export function isSignedIn() { return !!AUTH.account; }
