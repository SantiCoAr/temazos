/* Temazos — juego musical con las reglas de Hitster. Sin dependencias. */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('temazos.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('temazos.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem('temazos.' + k); } catch { /* idem */ } },
  };
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  class AppError extends Error {
    constructor(code, msg, extra) { super(msg || code); this.code = code; Object.assign(this, extra); }
  }

  const MIN_YEAR = 1966, MAX_YEAR = 2025, MAX_TOKENS = 5, START_TOKENS = 2, COOP_LIVES = 3;
  const PLAYER_COLORS = ['#ff3d8b', '#2de2e6', '#ffd23f', '#a78bfa', '#35d07f', '#ff8a3d', '#5aa9ff', '#f472b6', '#c4f042', '#ff6b6b'];
  const DECADE_COLORS = { 1960: '#2de2e6', 1970: '#ff9f43', 1980: '#ff3d8b', 1990: '#a78bfa', 2000: '#5aa9ff', 2010: '#35d07f', 2020: '#e0b400' };
  const decadeColor = (y) => DECADE_COLORS[Math.floor(y / 10) * 10] || '#2de2e6';
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const COUNTRY = (() => {
    const m = /^[a-z]{2}-([A-Z]{2})$/i.exec(navigator.language || '');
    return m ? m[1].toUpperCase() : 'ES';
  })();

  // ---------------------------------------------------------------------------
  // Canciones
  // ---------------------------------------------------------------------------
  const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const SONGS = (window.SONGS || []).map(([y, t, a, x]) => ({ id: `${y}-${slug(t)}`, y, t, a, alt: (x && x.alt) || [], pref: (x && x.pref) || '' }));
  const BY_ID = Object.fromEntries(SONGS.map((s) => [s.id, s]));

  // ---------------------------------------------------------------------------
  // Comparación de textos (para encontrar el audio y corregir respuestas)
  // ---------------------------------------------------------------------------
  function norm(s) {
    return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\s[-–—]\s.*$/, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(the|feat|ft|featuring)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const sim = (a, b) => (!a && !b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length));
  const cleanTitle = (t) => String(t).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim() || t;
  const firstArtist = (a) => String(a).split(/\s+(?:feat\.?|ft\.?|featuring|with|&|x)\s+|,\s*/i)[0].trim();
  const artistNoFeat = (a) => String(a).split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim();

  function artistParts(a) {
    const parts = String(a || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\band\b|\by\b)\s*/i).map(norm).filter((p) => p.length > 1);
    return { full: norm(a), noFeat: norm(artistNoFeat(a)), main: parts[0] || norm(a), parts };
  }
  function titleSim(song, candName) {
    const cn = norm(candName);
    let best = 0;
    for (const t of [song.t, ...song.alt]) {
      const tn = norm(t);
      if (!tn) continue;
      let s = tn === cn ? 1 : sim(tn, cn);
      if (s < 0.8 && (cn.startsWith(tn + ' ') || tn.startsWith(cn + ' '))) s = 0.8;
      best = Math.max(best, s);
    }
    return best;
  }
  function artistMatch(song, candArtists) {
    const ours = artistParts(song.a);
    const theirs = candArtists.filter(Boolean).map(norm);
    const theirFull = theirs.join(' ');
    const hit = (p) => !!p && (theirs.some((t) => t === p || sim(t, p) >= 0.85 || (p.length >= 4 && t.includes(p)) || (t.length >= 4 && p.includes(t))) || (p.length >= 4 && theirFull.includes(p)));
    return { mainHit: hit(ours.main) || hit(ours.noFeat), extra: ours.parts.slice(1).filter(hit).length };
  }
  const BAD_VERSION = /\b(live|karaoke|instrumental|acoustic|cover|tribute|sped up|slowed|demo|re-?recorded|lullaby|piano version|orchestral|a ?cappella|made famous|originally performed|workout|8-bit|reimagined|unplugged|remake|en vivo|en directo)\b/g;
  function scoreCand(song, c) {
    const nameSim = titleSim(song, c.name);
    const am = artistMatch(song, c.artists || []);
    const ours = (song.t + ' ' + song.pref).toLowerCase();
    const raw = (c.name + ' ' + (c.album || '')).toLowerCase();
    let s = nameSim * 50 + (am.mainHit ? 30 : 0) + am.extra * 4;
    for (const w of new Set(raw.match(BAD_VERSION) || [])) if (!ours.includes(w)) s -= 14;
    if (/\b(remix|mix|rmx)\b/.test(c.name.toLowerCase()) && !/\b(remix|mix)\b/.test(ours)) s -= 12;
    if (song.pref && raw.includes(song.pref)) s += 18;
    if (/taylor.?s version/.test(raw)) s -= 5;
    const y = parseInt(c.year, 10);
    if (y > 1900) {
      const d = y - song.y;
      if (d === 0 || d === 1) s += 8; else if (d < 0) s -= 8; else s -= Math.min(6, d * 0.25);
    }
    s += Math.max(0, 8 - (c.rank || 0)) * 0.75;
    return { s, ok: nameSim >= 0.6 && am.mainHit && c.playable !== false };
  }
  function pickBest(song, cands) {
    let best = null;
    for (const c of cands) {
      const r = scoreCand(song, c);
      if (r.ok && (!best || r.s > best._s)) best = { ...c, _s: r.s };
    }
    return best;
  }

  function guessTitleOk(g, song) {
    const gn = norm(g);
    if (!gn) return null;
    for (const t of [song.t, ...song.alt]) {
      const tn = norm(t);
      if (!tn) continue;
      if (gn === tn || sim(gn, tn) >= 0.78) return true;
      const tt = tn.split(' ').filter((w) => w.length > 1);
      const gs = new Set(gn.split(' '));
      if (tt.length && tt.filter((w) => gs.has(w)).length / tt.length >= 0.75) return true;
      if (gn.length >= 5 && tn.includes(gn) && gn.length / tn.length >= 0.6) return true;
    }
    return false;
  }
  function guessArtistOk(g, song) {
    const gn = norm(g);
    if (!gn) return null;
    const ap = artistParts(song.a);
    for (const p of [ap.full, ap.noFeat, ...ap.parts]) {
      if (!p) continue;
      if (gn === p || sim(gn, p) >= 0.75) return true;
      const pt = p.split(' ');
      if (gn.length >= 4 && gn.split(' ').every((w) => pt.includes(w))) return true;
      if (p.length >= 3 && (' ' + gn + ' ').includes(' ' + p + ' ')) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // JSONP (iTunes y Deezer no permiten fetch desde otra web, pero sí JSONP)
  // ---------------------------------------------------------------------------
  let jsonpSeq = 0;
  function jsonp(url, timeout = 9000) {
    return new Promise((resolve, reject) => {
      const name = `__tzjp${++jsonpSeq}_${Date.now()}`;
      const s = document.createElement('script');
      const t = setTimeout(() => { done(); reject(new AppError('network', 'Tiempo de espera agotado')); }, timeout);
      function done() { clearTimeout(t); window[name] = () => {}; s.remove(); }
      window[name] = (data) => { done(); resolve(data); };
      s.onerror = () => { done(); reject(new AppError('network', 'Sin conexión')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + name;
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------------------------
  // Motor de audio 1: fragmentos de 30 s (iTunes, con Deezer de reserva)
  // ---------------------------------------------------------------------------
  function silentWav() {
    const n = 1600, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    let bin = ''; new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  async function itunesLookup(song) {
    const term = `${cleanTitle(song.t)} ${artistNoFeat(song.a)}`;
    const data = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=15&country=${COUNTRY}`);
    const cands = ((data && data.results) || []).filter((r) => r.previewUrl).map((r, i) => ({
      name: r.trackName, artists: [r.artistName], album: r.collectionName, year: String(r.releaseDate || '').slice(0, 4),
      url: r.previewUrl, image: String(r.artworkUrl100 || '').replace(/100x100bb/, '400x400bb') || null, rank: i,
    }));
    return pickBest(song, cands.filter(notBad(song, 'url')));
  }
  async function deezerLookup(song) {
    const queries = [`artist:"${firstArtist(song.a)}" track:"${cleanTitle(song.t)}"`, `${cleanTitle(song.t)} ${firstArtist(song.a)}`];
    for (const q of queries) {
      const data = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15&output=jsonp`);
      const cands = ((data && data.data) || []).filter((r) => r.preview).map((r, i) => ({
        name: r.title, artists: [r.artist && r.artist.name], album: r.album && r.album.title, year: '',
        url: r.preview, image: (r.album && (r.album.cover_big || r.album.cover_medium)) || null, rank: i,
      }));
      const best = pickBest(song, cands.filter(notBad(song, 'url')));
      if (best) return best;
    }
    return null;
  }

  const badPicks = store.get('bad', {});
  const notBad = (song, key) => (c) => !(badPicks[song.id] || []).includes(c[key]);
  function markBad(song, value) {
    if (!value) return;
    const l = badPicks[song.id] || (badPicks[song.id] = []);
    if (!l.includes(value)) l.push(value);
    store.set('bad', badPicks);
  }

  const Preview = {
    kind: 'preview',
    label: 'Fragmento de 30 s',
    audio: null,
    cache: {},
    unlocked: false,
    init() {
      this.audio = $('#preview-audio');
      const a = this.audio;
      a.addEventListener('playing', () => { if (!this.silent) setPlaying(true); });
      a.addEventListener('pause', () => { if (!this.silent) setPlaying(false); });
      a.addEventListener('ended', () => { setPlaying(false); ui.ended = true; updatePlayerUI(); });
      a.addEventListener('timeupdate', () => {
        const p = $('#m-prog');
        if (p && a.duration && isFinite(a.duration) && !this.silent) p.style.width = Math.min(100, (a.currentTime / a.duration) * 100) + '%';
      });
    },
    // iOS solo deja sonar audio que arranca con un toque: lo "desbloqueamos" en el primer toque.
    unlock() {
      if (this.unlocked) return;
      const a = this.audio;
      this.silent = true;
      a.src = silentWav();
      const p = a.play();
      const end = () => { this.silent = false; };
      if (p && p.then) p.then(() => { this.unlocked = true; if (this.silent) a.pause(); end(); }).catch(end); else end();
    },
    async resolve(song) {
      if (song.id in this.cache) return this.cache[song.id];
      let r = null;
      try { r = await itunesLookup(song); } catch { /* probamos Deezer */ }
      if (!r) { try { r = await deezerLookup(song); } catch { /* nada */ } }
      if (r) this.cache[song.id] = r;
      return r;
    },
    play(song) {
      const a = this.audio;
      const go = (r) => {
        if (!r) throw new AppError('notfound');
        this.silent = false;
        a.src = r.url;
        a.currentTime = 0;
        return a.play().then(() => r, (e) => {
          if (e && e.name === 'NotAllowedError') throw new AppError('blocked');
          if (e && e.name === 'AbortError') throw new AppError('aborted');
          throw new AppError('network', 'No se pudo reproducir el fragmento');
        });
      };
      // Si ya lo teníamos buscado, arranca en el mismo toque (importante en iPhone).
      if (this.cache[song.id]) return go(this.cache[song.id]);
      return this.resolve(song).then(go);
    },
    pause() { this.audio.pause(); return Promise.resolve(); },
    resume() { return this.audio.play(); },
    restart() { this.audio.currentTime = 0; return this.audio.play(); },
    stop() { this.audio.pause(); },
    forget(song) { if (this.cache[song.id]) markBad(song, this.cache[song.id].url); delete this.cache[song.id]; },
  };

  // ---------------------------------------------------------------------------
  // Motor de audio 2: Spotify Premium (canción completa desde el segundo 0)
  // Usa Spotify Connect: la app de Spotify (móvil, altavoz, PC...) es la que suena.
  // ---------------------------------------------------------------------------
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);

  const Spotify = {
    kind: 'spotify',
    label: 'Spotify',
    tok: store.get('sp.tok', null),
    deviceId: store.get('sp.device', null),
    deviceName: store.get('sp.deviceName', ''),
    userName: store.get('sp.user', ''),
    devices: null,
    cache: store.get('sp.cache', {}),
    get clientId() { return store.get('sp.clientId', ''); },
    set clientId(v) { store.set('sp.clientId', v); },
    redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
    connected() { return !!(this.clientId && this.tok && this.tok.refresh); },

    async login() {
      if (!this.clientId) throw new AppError('noclient');
      const verifier = randHex(96);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const st = randHex(24);
      store.set('sp.pkce', { verifier, state: st, t: Date.now() });
      const p = new URLSearchParams({
        client_id: this.clientId, response_type: 'code', redirect_uri: this.redirectUri(),
        code_challenge_method: 'S256', code_challenge: challenge, state: st,
        scope: 'user-read-playback-state user-modify-playback-state',
      });
      location.assign('https://accounts.spotify.com/authorize?' + p.toString());
    },
    async handleRedirect() {
      const u = new URL(location.href);
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      if (!code && !err) return null;
      const st = u.searchParams.get('state');
      history.replaceState(null, '', this.redirectUri() + u.hash);
      if (err) return { error: err === 'access_denied' ? 'has cancelado el permiso' : err };
      const pk = store.get('sp.pkce', null);
      if (!pk || pk.state !== st) return { error: 'la respuesta no coincide, vuelve a intentarlo' };
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, grant_type: 'authorization_code', code, redirect_uri: this.redirectUri(), code_verifier: pk.verifier }),
      });
      const d = await r.json().catch(() => ({}));
      store.del('sp.pkce');
      if (!r.ok || !d.access_token) return { error: d.error_description || d.error || 'HTTP ' + r.status };
      this.saveTok(d);
      return { ok: true };
    },
    saveTok(d) {
      this.tok = { access: d.access_token, refresh: d.refresh_token || (this.tok && this.tok.refresh), exp: Date.now() + (d.expires_in || 3600) * 1000 };
      store.set('sp.tok', this.tok);
    },
    logout() {
      this.tok = null; this.devices = null; this.userName = '';
      store.del('sp.tok'); store.del('sp.user');
    },
    refresh() {
      if (!this.tok || !this.tok.refresh) return Promise.reject(new AppError('auth'));
      if (!this._refreshing) {
        this._refreshing = (async () => {
          const r = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.tok.refresh, client_id: this.clientId }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.access_token) {
            if (r.status === 400 || r.status === 401) this.logout();
            throw new AppError('auth');
          }
          this.saveTok(d);
        })().finally(() => { this._refreshing = null; });
      }
      return this._refreshing;
    },
    async token() {
      if (!this.tok) throw new AppError('auth');
      if (Date.now() > this.tok.exp - 60000) await this.refresh();
      return this.tok.access;
    },
    async api(method, path, body) {
      const send = async () => fetch('https://api.spotify.com/v1' + path, {
        method,
        headers: Object.assign({ Authorization: 'Bearer ' + (await this.token()) }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      let r;
      try { r = await send(); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('network', 'Sin conexión con Spotify'); }
      if (r.status === 401) { await this.refresh(); r = await send(); }
      if (r.status === 429) {
        const wait = Number(r.headers.get('Retry-After')) || 2;
        if (wait <= 6) { await sleep(wait * 1000); r = await send(); }
      }
      if (r.status === 204 || r.status === 202) return null;
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!r.ok) {
        const e = (data && data.error) || {};
        const msg = e.message || text || 'HTTP ' + r.status;
        let code = 'spotify';
        if (r.status === 401) code = 'auth';
        else if (r.status === 404) code = 'nodevice';
        else if (r.status === 403 && /premium/i.test(e.reason + ' ' + msg)) code = 'premium';
        else if (r.status === 403 && /(not registered|developer dashboard|user may not be registered)/i.test(msg)) code = 'notallowed';
        else if (r.status === 429) code = 'ratelimit';
        throw new AppError(code, msg, { status: r.status, reason: e.reason });
      }
      return data;
    },
    async loadUser() {
      try {
        const me = await this.api('GET', '/me');
        this.userName = (me && (me.display_name || me.id)) || '';
        store.set('sp.user', this.userName);
      } catch { /* no es imprescindible */ }
    },
    async loadDevices() {
      const d = await this.api('GET', '/me/player/devices');
      this.devices = ((d && d.devices) || []).filter((x) => x.id && !x.is_restricted);
      return this.devices;
    },
    setDevice(dev) {
      this.deviceId = dev ? dev.id : null;
      this.deviceName = dev ? dev.name : '';
      store.set('sp.device', this.deviceId);
      store.set('sp.deviceName', this.deviceName);
    },
    async pickDevice() {
      const list = await this.loadDevices();
      const dev = list.find((x) => x.id === this.deviceId) || list.find((x) => x.is_active) || list.find((x) => /smartphone/i.test(x.type)) || list[0];
      this.setDevice(dev || null);
      return dev || null;
    },
    async resolve(song) {
      if (this.cache[song.id]) return this.cache[song.id];
      const clean = (s) => String(s).replace(/"/g, '');
      const t = clean(cleanTitle(song.t)), a1 = clean(firstArtist(song.a));
      const queries = [`track:"${t}" artist:"${a1}"`, `${t} ${clean(artistNoFeat(song.a))}`, ...song.alt.map((x) => `${clean(x)} ${a1}`)];
      for (const q of queries) {
        const data = await this.api('GET', `/search?type=track&limit=10&market=from_token&q=${encodeURIComponent(q)}`);
        const items = (data && data.tracks && data.tracks.items) || [];
        const cands = items.filter(Boolean).map((x, i) => ({
          uri: x.uri, name: x.name, artists: (x.artists || []).map((ar) => ar.name),
          album: x.album && x.album.name, year: String((x.album && x.album.release_date) || '').slice(0, 4),
          image: x.album && x.album.images && x.album.images.length ? (x.album.images[1] || x.album.images[0]).url : null,
          rank: i, playable: x.is_playable,
        }));
        const best = pickBest(song, cands.filter(notBad(song, 'uri')));
        if (best) {
          const keep = { uri: best.uri, name: best.name, image: best.image };
          this.cache[song.id] = keep;
          store.set('sp.cache', this.cache);
          return keep;
        }
      }
      return null;
    },
    async playOn(dev, uri) {
      await this.api('PUT', `/me/player/play?device_id=${encodeURIComponent(dev)}`, { uris: [uri], position_ms: 0 });
    },
    async play(song) {
      const tr = await this.resolve(song);
      if (!tr) throw new AppError('notfound');
      let dev = this.deviceId;
      if (!dev) { const d = await this.pickDevice(); if (!d) throw new AppError('nodevice'); dev = d.id; }
      try {
        await this.playOn(dev, tr.uri);
      } catch (e) {
        if (e.code !== 'nodevice' && e.status !== 502 && e.status !== 503) throw e;
        // El dispositivo guardado se ha "dormido": buscamos otro (o el mismo con id nuevo).
        const d = await this.pickDevice();
        if (!d) throw new AppError('nodevice');
        await this.playOn(d.id, tr.uri);
      }
      return tr;
    },
    pause() { return this.api('PUT', `/me/player/pause${this.deviceId ? '?device_id=' + encodeURIComponent(this.deviceId) : ''}`).catch(() => {}); },
    resume() { return this.api('PUT', `/me/player/play${this.deviceId ? '?device_id=' + encodeURIComponent(this.deviceId) : ''}`); },
    async restart() {
      await this.api('PUT', `/me/player/seek?position_ms=0${this.deviceId ? '&device_id=' + encodeURIComponent(this.deviceId) : ''}`);
      if (!ui.playing) await this.resume();
    },
    stop() { return this.pause(); },
    forget(song) { if (this.cache[song.id]) markBad(song, this.cache[song.id].uri); delete this.cache[song.id]; store.set('sp.cache', this.cache); },
  };

  // ---------------------------------------------------------------------------
  // Ajustes y estado
  // ---------------------------------------------------------------------------
  const defaults = { players: ['Jugador 1', 'Jugador 2'], rules: 'original', coop: false, target: 10, yearFrom: MIN_YEAR, yearTo: MAX_YEAR, source: 'spotify' };
  let settings = Object.assign({}, defaults, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);

  let state = store.get('game', null);
  if (state && (state.v !== 1 || !Array.isArray(state.players) || !state.players.length)) state = null;
  const save = () => store.set('game', state);

  const ui = { screen: 'setup', busy: false, playing: false, ended: false, needTap: false, error: '', challenger: null, startedAt: 0, failStreak: 0, guessOpen: false };

  const engine = () => ((state ? state.source : settings.source) === 'spotify' ? Spotify : Preview);
  const playEngine = () => (ui.tempPreview ? Preview : engine());
  const owner = (i) => (state.coop ? state.team : state.players[i]);
  const ownerName = (i) => (state.coop ? 'el equipo' : state.players[i].name);
  const sortedCards = (o) => o.cards.map((id) => BY_ID[id]).filter(Boolean).sort((a, b) => a.y - b.y);
  const slotOk = (cards, k, y) => (k === 0 || cards[k - 1].y <= y) && (k === cards.length || y <= cards[k].y);
  const okSlots = (cards, y) => { const r = []; for (let k = 0; k <= cards.length; k++) if (slotOk(cards, k, y)) r.push(k); return r; };
  const rulesLabel = (r) => ({ original: 'Original', pro: 'Pro', expert: 'Experto' }[r] || 'Original');

  function heardSet() { return new Set(store.get('heard', [])); }
  function markHeard(id) {
    const h = store.get('heard', []);
    if (!h.includes(id)) { h.push(id); store.set('heard', h); }
  }
  function songsInRange(from, to) { return SONGS.filter((s) => s.y >= from && s.y <= to); }

  function buildDeck() {
    const pool = songsInRange(settings.yearFrom, settings.yearTo).map((s) => s.id);
    const heard = heardSet();
    let fresh = pool.filter((id) => !heard.has(id));
    const need = settings.players.length * settings.target * 2 + 15;
    if (fresh.length < Math.min(need, pool.length)) {
      const inPool = new Set(pool);
      store.set('heard', [...heard].filter((id) => !inPool.has(id)));
      fresh = pool;
      toast('Ya habíais oído casi todas: vuelven a entrar todas las canciones');
    }
    return shuffle(fresh);
  }
  function draw() {
    if (!state.deck.length) {
      const busy = new Set([...state.players.flatMap((p) => p.cards), ...(state.team ? state.team.cards : [])]);
      state.deck = shuffle(songsInRange(state.yearFrom, state.yearTo).map((s) => s.id).filter((id) => !busy.has(id)));
      toast('Se acabó el mazo: barajo otra vez');
    }
    const id = state.deck.pop();
    markHeard(id);
    return id;
  }
  function newGame() {
    const names = settings.players.map((n, i) => String(n || '').trim().slice(0, 24) || `Jugador ${i + 1}`);
    const coop = settings.coop || names.length === 1;
    state = {
      v: 1, rules: settings.rules, coop, target: settings.target, source: settings.source,
      yearFrom: settings.yearFrom, yearTo: settings.yearTo,
      players: names.map((name, i) => ({ name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], tokens: START_TOKENS, cards: [] })),
      team: coop ? { tokens: START_TOKENS, cards: [], lives: COOP_LIVES } : null,
      turn: 0, round: 1, deck: buildDeck(), cur: null, last: null, over: null,
    };
    if (coop) state.team.cards.push(draw());
    else state.players.forEach((p) => p.cards.push(draw()));
    save();
  }
  const newCur = (id) => ({ id, slot: null, ch: [], g: { t: '', a: '', y: '' }, j: { t: null, a: null, y: null }, revealed: false, played: false, image: null });

  function willKeep(cur) {
    const song = BY_ID[cur.id];
    const cards = sortedCards(owner(state.turn));
    const placed = cur.slot != null && slotOk(cards, cur.slot, song.y);
    const named = cur.j.t === true && cur.j.a === true;
    let keep = placed;
    if (state.rules === 'pro') keep = placed && named;
    if (state.rules === 'expert') keep = placed && named && cur.j.y === true;
    const stealer = !placed && !state.coop ? cur.ch.find((c) => slotOk(cards, c.slot, song.y)) : null;
    return { song, cards, placed, named, keep, stealer };
  }

  function resolveTurn() {
    const cur = state.cur;
    const i = state.turn;
    const own = owner(i);
    const w = willKeep(cur);
    const res = { id: cur.id, who: i, placed: w.placed, keep: w.keep, token: false, stolenBy: null, lifeLost: false };
    if (w.named && own.tokens < MAX_TOKENS) { own.tokens++; res.token = true; }
    if (w.keep) own.cards.push(cur.id);
    else if (w.stealer) { state.players[w.stealer.p].cards.push(cur.id); res.stolenBy = w.stealer.p; }
    if (state.coop && !w.keep) { state.team.lives--; res.lifeLost = true; }
    state.last = res;
    if (state.coop) {
      if (state.team.cards.length >= state.target) state.over = { win: true };
      else if (state.team.lives <= 0) state.over = { win: false };
    } else {
      const winner = state.players.findIndex((p) => p.cards.length >= state.target);
      if (winner >= 0) state.over = { winner };
    }
    state.cur = null;
    if (!state.over) {
      state.turn = (state.turn + 1) % state.players.length;
      if (state.turn === 0) state.round++;
    }
    save();
    return res;
  }

  // ---------------------------------------------------------------------------
  // Reproducción
  // ---------------------------------------------------------------------------
  let tick = null;
  function setPlaying(on) {
    ui.playing = !!on;
    if (on) { ui.ended = false; ui.needTap = false; ui.error = ''; }
    clearInterval(tick);
    if (on && playEngine() === Spotify) tick = setInterval(updatePlayerUI, 1000);
    updatePlayerUI();
  }

  async function playCurrent(fromTap) {
    if (!state || !state.cur) return;
    const song = BY_ID[state.cur.id];
    const eng = engine();
    if (eng === Preview && fromTap) Preview.unlock();
    ui.busy = true; ui.error = ''; ui.needTap = false; ui.ended = false;
    render();
    try {
      if (eng === Spotify && ui.playing) { ui.playing = false; }
      const info = await eng.play(song);
      ui.failStreak = 0;
      if (state.cur && state.cur.id === song.id) {
        state.cur.played = true;
        state.cur.image = (info && info.image) || null;
        save();
      }
      ui.startedAt = Date.now(); ui.pausedElapsed = 0;
      if (eng === Spotify) setPlaying(true);
    } catch (e) {
      handlePlayError(e, song);
    } finally {
      ui.busy = false;
      render();
    }
    prefetchNext();
  }

  function prefetchNext() {
    if (!state || !state.deck.length) return;
    const next = BY_ID[state.deck[state.deck.length - 1]];
    const eng = engine();
    setTimeout(() => { eng.resolve(next).catch(() => {}); }, 1200);
  }

  function handlePlayError(e, song) {
    const code = (e && e.code) || 'network';
    if (code === 'aborted' || !state || !state.cur || state.cur.id !== song.id) return;
    if (code === 'notfound') {
      ui.failStreak++;
      if (state.cur && state.cur.id === song.id && !state.cur.revealed && ui.failStreak <= 4) {
        toast(`No encuentro el audio de una canción: pongo otra`);
        state.cur = newCur(draw());
        save();
        setTimeout(() => playCurrent(false), 50);
        return;
      }
      ui.error = 'No se encuentra el audio. Prueba otra vez o salta.';
      return;
    }
    if (code === 'blocked') { ui.needTap = true; return; }
    if (code === 'nodevice') { openSoundHelp(true); return; }
    if (code === 'auth' || code === 'noclient') {
      ui.error = 'Hay que volver a conectar Spotify.';
      openModal(`<h2>Reconectar Spotify <button class="icon-btn" data-act="close">✕</button></h2>
        <p>La sesión de Spotify ha caducado o se ha cerrado. Vuelve a conectar (la partida se guarda).</p>
        <div class="stack"><button class="btn primary" data-act="sp-login">Conectar con Spotify</button>
        <button class="btn" data-act="use-preview-once">Usar fragmento de 30 s esta vez</button></div>`);
      return;
    }
    if (code === 'premium') {
      ui.error = 'Spotify pide Premium para reproducir.';
      openModal(`<h2>Spotify Premium <button class="icon-btn" data-act="close">✕</button></h2>
        <p>Spotify solo deja controlar la reproducción con una cuenta <b>Premium</b>. Comprueba que estás conectado con tu cuenta Premium.</p>
        <div class="stack"><button class="btn" data-act="use-preview-once">Usar fragmento de 30 s esta vez</button></div>`);
      return;
    }
    if (code === 'notallowed') {
      openModal(`<h2>Falta dar acceso <button class="icon-btn" data-act="close">✕</button></h2>
        <p>Esta cuenta de Spotify no está autorizada en tu app de desarrollador. En <b>developer.spotify.com/dashboard</b> → tu app → <b>User Management</b>, añade el correo de la cuenta con la que te has conectado.</p>
        <div class="stack"><button class="btn" data-act="use-preview-once">Usar fragmento de 30 s esta vez</button></div>`);
      return;
    }
    ui.error = (e && e.message && e.code !== 'network') ? `Error: ${e.message}` : 'Fallo de conexión. Pulsa ▶ para reintentar.';
  }

  async function togglePause() {
    const eng = playEngine();
    if (!state.cur || !state.cur.played) return playCurrent(true);
    try {
      if (ui.playing) { await eng.pause(); ui.pausedElapsed = Date.now() - ui.startedAt; if (eng === Spotify) setPlaying(false); }
      else { if (ui.ended && eng === Preview) Preview.audio.currentTime = 0; await eng.resume(); ui.startedAt = Date.now() - (ui.pausedElapsed || 0); if (eng === Spotify) setPlaying(true); }
    } catch (e) { handlePlayError(e, BY_ID[state.cur.id]); render(); }
  }
  async function restartSong() {
    const eng = playEngine();
    if (!state.cur || !state.cur.played) return playCurrent(true);
    try { await eng.restart(); ui.startedAt = Date.now(); ui.pausedElapsed = 0; if (eng === Spotify) setPlaying(true); } catch (e) { handlePlayError(e, BY_ID[state.cur.id]); render(); }
  }
  async function playPreviewOnce() {
    closeModal();
    if (!state || !state.cur) return;
    const song = BY_ID[state.cur.id];
    Preview.unlock();
    ui.busy = true; render();
    try {
      const r = await Preview.play(song);
      state.cur.played = true; state.cur.image = r.image; save();
      ui.tempPreview = true;
    } catch (e) { handlePlayError(e, song); }
    ui.busy = false; render();
  }

  // ---------------------------------------------------------------------------
  // Pantallas
  // ---------------------------------------------------------------------------
  function render() {
    if (ui.screen === 'game' && state) renderGame(); else renderSetup();
  }

  function renderSetup() {
    ui.screen = 'setup';
    $('#topbar').hidden = true;
    $('#actionbar').hidden = true;
    const s = settings;
    const pool = songsInRange(s.yearFrom, s.yearTo);
    const heard = heardSet();
    const fresh = pool.filter((x) => !heard.has(x.id)).length;
    const solo = s.players.length === 1;
    const yearOpts = (sel, min, max) => { let h = ''; for (let y = min; y <= max; y++) h += `<option value="${y}" ${y === sel ? 'selected' : ''}>${y}</option>`; return h; };
    const resume = state && !state.over
      ? `<div class="panel resume-card"><div><b>Partida en curso</b><div class="hint">Turno de ${esc(state.players[state.turn].name)} · ${rulesLabel(state.rules)}${state.coop ? ' · cooperativo' : ''}</div></div><button class="btn primary" data-act="resume">Continuar</button></div>` : '';
    const rulesDesc = {
      original: 'Coloca la canción en tu línea del tiempo. Si aciertas título y artista, ganas una ficha.',
      pro: 'Para quedarte la carta tienes que colocarla bien <b>y</b> acertar título y artista.',
      expert: 'Como Pro, pero además tienes que decir el <b>año exacto</b>.',
    }[s.rules];

    $('#screen').innerHTML = `
      <div class="brand"><div class="logo">TEMAZOS</div>
        <p>Escucha, adivina título, artista y año, y ordena las canciones en tu línea del tiempo. Reglas de Hitster · ${SONGS.length} éxitos de ${MIN_YEAR} a ${MAX_YEAR}.</p></div>
      ${resume}
      <section class="panel">
        <h2>👥 Jugadores <span class="n">${s.players.length}</span></h2>
        <div id="players">${s.players.map((n, i) => `
          <div class="player-row"><span class="dot" style="--c:${PLAYER_COLORS[i % PLAYER_COLORS.length]}"></span>
            <input data-pi="${i}" value="${esc(n)}" maxlength="24" autocomplete="off" aria-label="Nombre del jugador ${i + 1}">
            ${s.players.length > 1 ? `<button class="icon-btn" data-act="rm-player" data-i="${i}" aria-label="Quitar">✕</button>` : ''}
          </div>`).join('')}</div>
        ${s.players.length < 10 ? '<button class="btn ghost block" data-act="add-player">＋ Añadir jugador</button>' : ''}
        ${solo ? '<p class="hint">Con un jugador se juega en <b>solitario</b>: 3 vidas ❤️ para llegar al objetivo.</p>' : ''}
      </section>
      <section class="panel">
        <h2>🎯 Modo de juego</h2>
        <div class="seg" role="tablist">
          ${['original', 'pro', 'expert'].map((r) => `<button class="${s.rules === r ? 'on' : ''}" data-act="rules-mode" data-v="${r}">${rulesLabel(r)}</button>`).join('')}
        </div>
        <p class="hint">${rulesDesc}</p>
        ${solo ? '' : `<label class="toggle"><input type="checkbox" id="coop" ${s.coop ? 'checked' : ''}><span><b>Cooperativo</b><br><span class="hint">Una sola línea del tiempo para todos y 3 vidas ❤️.</span></span></label>`}
        <div class="row"><span>Cartas para ganar</span>
          <div class="stepper"><button data-act="target" data-d="-1" aria-label="Menos">−</button><b>${s.target}</b><button data-act="target" data-d="1" aria-label="Más">＋</button></div></div>
        <div class="row"><span>Años</span>
          <span class="years"><select id="yearFrom" aria-label="Desde">${yearOpts(s.yearFrom, MIN_YEAR, s.yearTo)}</select> – <select id="yearTo" aria-label="Hasta">${yearOpts(s.yearTo, s.yearFrom, MAX_YEAR)}</select></span></div>
        <p class="hint">${pool.length} canciones en el rango · <b>${fresh}</b> sin escuchar todavía${fresh < pool.length ? ' · <button class="btn link small" data-act="reset-heard">volver a ponerlas todas</button>' : ''}</p>
      </section>
      <section class="panel">
        <h2>🎧 Música</h2>
        <div class="source ${s.source === 'spotify' ? 'on' : ''}" data-act="pick-src" data-v="spotify">
          <label class="head"><input type="radio" name="src" value="spotify" ${s.source === 'spotify' ? 'checked' : ''}> Spotify Premium <span class="tag">Canción entera</span></label>
          <p class="desc">Suena la canción completa desde el principio, sin anuncios, en tu app de Spotify (móvil, altavoz o PC).</p>
          ${s.source === 'spotify' ? spotifyBox() : ''}
        </div>
        <div class="source ${s.source === 'preview' ? 'on' : ''}" data-act="pick-src" data-v="preview">
          <label class="head"><input type="radio" name="src" value="preview" ${s.source === 'preview' ? 'checked' : ''}> Sin cuenta</label>
          <p class="desc">Fragmento de 30 s (de iTunes). No hay que configurar nada, pero el fragmento suele empezar a mitad de canción.</p>
        </div>
      </section>
      <button class="btn primary big" data-act="start">${state && !state.over ? 'Empezar partida nueva' : '▶ Empezar partida'}</button>
      <div style="text-align:center;margin-top:8px"><button class="btn link" data-act="rules">📖 Ver reglas</button></div>
      <p class="footer-note">Los datos se guardan solo en este móvil.</p>`;
  }

  function spotifyBox() {
    if (!Spotify.clientId) {
      return `<div class="sp-box" data-stop>
        <p class="hint" style="margin-top:0">Se configura <b>una sola vez</b> (2–3 min): creas una app gratuita en Spotify y pegas aquí su <b>Client ID</b>.</p>
        <button class="btn small" data-act="sp-help">📋 Ver los pasos</button>
        <input class="text-input" id="sp-client" placeholder="Pega aquí el Client ID" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:10px">
        <button class="btn small primary block" data-act="sp-save-client">Guardar y conectar</button></div>`;
    }
    if (!Spotify.connected()) {
      return `<div class="sp-box" data-stop>
        <button class="btn primary block" data-act="sp-login">Conectar con Spotify</button>
        <div><button class="btn link small" data-act="sp-help">Ver pasos</button><button class="btn link small" data-act="sp-reset">Cambiar Client ID</button></div></div>`;
    }
    const devs = Spotify.devices;
    let devHTML;
    if (!devs) devHTML = '<span class="hint">Buscando dispositivos…</span>';
    else if (!devs.length) devHTML = '<span class="warn-line">No veo ninguno abierto</span>';
    else devHTML = `<select id="sp-device" aria-label="Dispositivo">${devs.map((d) => `<option value="${esc(d.id)}" ${d.id === Spotify.deviceId ? 'selected' : ''}>${esc(d.name)}${d.is_active ? ' (activo)' : ''}</option>`).join('')}</select>`;
    return `<div class="sp-box" data-stop>
      <div class="ok-line">✓ Conectado${Spotify.userName ? ' como ' + esc(Spotify.userName) : ''}</div>
      <div class="row" style="margin-top:6px"><span>Suena en</span><span class="years">${devHTML}<button class="icon-btn" data-act="sp-devices" aria-label="Buscar dispositivos">↻</button></span></div>
      <p class="hint">Abre la app de Spotify en este móvil (o en un altavoz u ordenador) y pulsa ↻ para que aparezca.</p>
      <button class="btn link small" data-act="sp-logout">Desconectar Spotify</button></div>`;
  }

  function phase() {
    const c = state.cur;
    if (!c) return 'idle';
    if (c.revealed) return 'revealed';
    if (ui.challenger != null) return 'challenge';
    return c.slot == null ? 'place' : 'placed';
  }

  function statusText() {
    const c = state.cur;
    if (!c) return ui.playing ? 'Sigue sonando la anterior' : 'Pulsa «Canción aleatoria»';
    if (ui.busy) return 'Cargando canción…';
    if (ui.error) return ui.error;
    if (ui.needTap) return 'Toca ▶ para escuchar';
    if (!c.played) return 'Pulsa ▶ para escuchar';
    if (ui.ended) return 'Ha terminado · ↺ para repetir';
    if (!ui.playing) return 'En pausa';
    if (engine() === Spotify && !ui.tempPreview) {
      const secs = Math.max(0, Math.floor((Date.now() - ui.startedAt) / 1000));
      return `Sonando${Spotify.deviceName ? ' en ' + Spotify.deviceName : ''} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }
    return 'Sonando…';
  }

  function updatePlayerUI() {
    const m = $('#mystery');
    if (m) m.classList.toggle('playing', ui.playing);
    const st = $('#m-status');
    if (st && state) st.textContent = statusText();
    const pb = $('[data-act="toggle-pause"]');
    if (pb && state && state.cur) pb.innerHTML = !state.cur.played || ui.needTap ? '▶ Escuchar' : ui.playing ? '⏸ Pausa' : '▶ Seguir';
  }

  function renderGame() {
    ui.screen = 'game';
    const i = state.turn, p = state.players[i], own = owner(i), ph = phase(), cur = state.cur;
    const tb = $('#topbar');
    tb.hidden = false;
    tb.innerHTML = `
      <button class="icon-btn" data-act="menu" aria-label="Menú">☰</button>
      <div class="turn"><span class="dot" style="--c:${p.color}"></span> Turno de <b>${esc(p.name)}</b></div>
      <div class="stats">
        ${state.coop ? `<span class="chip" title="Vidas">${'❤️'.repeat(Math.max(0, state.team.lives))}${'🖤'.repeat(Math.max(0, COOP_LIVES - state.team.lives))}</span>` : ''}
        <span class="chip" title="Fichas">🪙 ${own.tokens}</span>
        <button class="chip" data-act="score" title="Cartas" style="font-weight:700">🃏 ${own.cards.length}/${state.target}</button>
      </div>`;

    const song = cur && BY_ID[cur.id];
    const showControls = !!cur;
    const usingPreview = engine() === Preview || ui.tempPreview;
    let stage = `<div class="stage">
      <div class="mystery ${ui.playing ? 'playing' : ''} ${cur && cur.revealed ? 'revealed' : ''}" id="mystery">
        <div class="inner">
          <div class="face front"><div class="q">?</div><div class="status" id="m-status">${esc(statusText())}</div>
            <div class="eq"><i></i><i></i><i></i><i></i><i></i></div>
            ${usingPreview && cur ? '<div class="progress"><i id="m-prog"></i></div>' : ''}</div>
          <div class="face back" style="--dc:${song ? decadeColor(song.y) : '#191536'}">${cur && cur.revealed ? `
            <div class="art ${cur.image ? '' : 'none'}" ${cur.image ? `style="background-image:url('${esc(cur.image)}')"` : ''}>${cur.image ? '' : '♪'}</div>
            <div class="info"><div class="yr">${song.y}</div><div class="tt">${esc(song.t)}</div><div class="ar">${esc(song.a)}</div></div>` : ''}</div>
        </div>
      </div>`;
    if (showControls) {
      stage += `<div class="controls">
        <button class="btn" data-act="toggle-pause" ${ui.busy ? 'disabled' : ''}>${!cur.played || ui.needTap ? '▶ Escuchar' : ui.playing ? '⏸ Pausa' : '▶ Seguir'}</button>
        <button class="btn" data-act="restart" ${ui.busy || !cur.played ? 'disabled' : ''} aria-label="Volver a empezar la canción">↺ Repetir</button>
        ${!cur.revealed ? `<button class="btn" data-act="skip" ${own.tokens < 1 || ui.busy ? 'disabled' : ''}>⏭ Saltar <span class="sub">−1🪙</span></button>` : ''}
      </div>
      <div class="source-note">${usingPreview ? 'Fragmento de 30 s' : 'Spotify · canción completa'} · <button class="btn link small" data-act="sound-help">¿No suena?</button></div>`;
    }
    if (cur && !cur.revealed) {
      stage += `<details class="guess" ${ui.guessOpen ? 'open' : ''} id="guess-box"><summary>✍️ Escribir respuesta <span class="hint" style="margin:0">(opcional)</span></summary>
        <div class="fields">
          <input id="g-t" placeholder="Título" value="${esc(cur.g.t)}" autocomplete="off" autocapitalize="sentences">
          <input id="g-a" placeholder="Artista" value="${esc(cur.g.a)}" autocomplete="off">
          ${state.rules === 'expert' ? `<input id="g-y" placeholder="Año" inputmode="numeric" maxlength="4" value="${esc(cur.g.y)}" autocomplete="off">` : ''}
          <p class="hint" style="margin:0">Si lo escribís, se corrige solo al revelar. Si lo decís en voz alta, lo marcáis vosotros.</p>
        </div></details>`;
    }
    if (cur && cur.revealed) stage += judgeHTML();
    stage += '</div>';

    const tlTitle = state.coop ? 'Línea del tiempo del equipo' : `Línea del tiempo de ${esc(p.name)}`;
    $('#screen').innerHTML = `${stage}
      <div class="tl-head"><span>${tlTitle}</span><span>${own.cards.length} carta${own.cards.length === 1 ? '' : 's'}</span></div>
      <div class="timeline" id="timeline">${timelineHTML(ph)}</div>`;
    renderActionbar(ph);
  }

  function cardHTML(s, cls = '', badge = '') {
    return `<div class="tcard ${cls}" style="--dc:${decadeColor(s.y)}"><div class="y">${s.y}</div><div class="m"><div class="t">${esc(s.t)}</div><div class="a">${esc(s.a)}${badge ? ` · <b>${esc(badge)}</b>` : ''}</div></div></div>`;
  }

  function slotLabel(cards, k) {
    if (!cards.length) return 'Colocar aquí';
    if (k === 0) return `Antes de ${cards[0].y}`;
    if (k === cards.length) return `Después de ${cards[k - 1].y}`;
    return cards[k - 1].y === cards[k].y ? `También ${cards[k].y}` : `Entre ${cards[k - 1].y} y ${cards[k].y}`;
  }

  function timelineHTML(ph) {
    const i = state.turn, own = owner(i), cards = sortedCards(own), cur = state.cur;
    const taken = new Map();
    if (cur) {
      if (cur.slot != null) taken.set(cur.slot, { c: state.players[i].color, label: state.coop ? 'Aquí' : state.players[i].name, me: true });
      for (const ch of cur.ch) taken.set(ch.slot, { c: state.players[ch.p].color, label: '¡Hitster! ' + state.players[ch.p].name });
    }
    if (!cards.length && !cur) return '<div class="empty-tl">Sin cartas todavía</div>';
    if (ph === 'revealed') {
      const song = BY_ID[cur.id];
      const ok = okSlots(cards, song.y);
      const placed = cur.slot != null && ok.includes(cur.slot);
      const at = placed ? cur.slot : ok[0];
      const w = willKeep(cur);
      let h = '';
      for (let k = 0; k <= cards.length; k++) {
        const t = taken.get(k);
        if (t && !(t.me && placed)) h += `<div class="slot ${ok.includes(k) ? 'right' : 'wrong'}" style="--c:${t.c}">${ok.includes(k) ? '✓' : '✗'} ${esc(t.label)}</div>`;
        if (k === at) h += cardHTML(song, w.keep ? 'new' : 'ghost', w.keep ? 'nueva' : placed ? 'bien colocada' : 'iba aquí');
        if (k < cards.length) h += cardHTML(cards[k]);
      }
      return h;
    }
    const interactive = ph === 'place' || ph === 'placed' || ph === 'challenge';
    const chColor = ui.challenger != null ? state.players[ui.challenger].color : null;
    const locked = cur && cur.ch.length > 0;
    let h = '';
    for (let k = 0; k <= cards.length; k++) {
      if (interactive) {
        const t = taken.get(k);
        if (t) {
          h += `<button class="slot ${ph === 'challenge' ? 'taken' : 'sel'}" style="--c:${t.c}" ${ph === 'challenge' || (locked && t.me) || !t.me ? 'disabled' : ''} data-act="slot" data-slot="${k}"><span class="qmini">?</span>${esc(t.label)}</button>`;
        } else if (ph === 'challenge') {
          h += `<button class="slot" style="--c:${chColor}" data-act="slot" data-slot="${k}">⚡ ${slotLabel(cards, k)}</button>`;
        } else {
          h += `<button class="slot" data-act="slot" data-slot="${k}" ${locked ? 'disabled' : ''}>＋ ${slotLabel(cards, k)}</button>`;
        }
      }
      if (k < cards.length) h += cardHTML(cards[k]);
    }
    return h;
  }

  function judgeHTML() {
    const cur = state.cur, w = willKeep(cur);
    const yn = (k, label, typed) => `<div class="jrow"><div class="lbl">${label}${typed ? `<small>Escribió: «${esc(typed)}»</small>` : ''}</div>
      <div class="yn"><button class="yes ${cur.j[k] === true ? 'on' : ''}" data-act="judge" data-k="${k}" data-v="1" aria-label="Sí">✓</button><button class="no ${cur.j[k] === false ? 'on' : ''}" data-act="judge" data-k="${k}" data-v="0" aria-label="No">✗</button></div></div>`;
    const lines = [];
    const who = state.coop ? 'El equipo' : esc(state.players[state.turn].name);
    if (w.keep) lines.push(`🃏 ${who} se queda la carta`);
    else if (w.placed && state.rules !== 'original') lines.push(`🗑️ Carta descartada: en modo ${rulesLabel(state.rules)} también hay que acertar ${state.rules === 'expert' ? 'título, artista y año' : 'título y artista'}`);
    else lines.push('🗑️ Carta descartada');
    if (state.coop && !w.keep) lines.push('💔 Perdéis una vida');
    const own = owner(state.turn);
    if (w.named) lines.push(own.tokens < MAX_TOKENS ? '🪙 +1 ficha por acertar título y artista' : '🪙 Título y artista bien (ya tenéis el máximo de 5 fichas)');
    for (const ch of cur.ch) {
      const pl = state.players[ch.p];
      if (w.stealer && w.stealer === ch) lines.push(`⚡ ${esc(pl.name)} gana el reto y se lleva la carta`);
      else lines.push(`⚡ ${esc(pl.name)} pierde su ficha del reto`);
    }
    return `<div class="judge">
      <div class="verdict ${w.placed ? 'good' : 'bad'}">${w.placed ? '✅ ¡Bien colocada!' : `❌ Mal colocada (es de ${w.song.y})`}</div>
      ${yn('t', '¿Acertó el título?', cur.g.t)}
      ${yn('a', '¿Y el artista?', cur.g.a)}
      ${state.rules === 'expert' ? yn('y', '¿Y el año exacto?', cur.g.y) : ''}
      <div class="outcome">${lines.map((l) => `<div>${l}</div>`).join('')}</div>
    </div>`;
  }

  function renderActionbar(ph) {
    const ab = $('#actionbar');
    ab.hidden = false;
    const i = state.turn, own = owner(i), p = state.players[i];
    let h = '';
    if (ph === 'idle') {
      h = `<p class="hint">${state.coop ? `Os toca. Controla ${esc(p.name)}.` : `Te toca, <b>${esc(p.name)}</b>. Pásale el móvil si hace falta.`}</p>
        <button class="btn primary big" data-act="random">🎵 Canción aleatoria</button>
        ${own.tokens >= 3 || ui.playing ? `<div class="split">${ui.playing ? '<button class="btn small" data-act="stop-prev">⏸ Parar la anterior</button>' : ''}${own.tokens >= 3 ? '<button class="btn small" data-act="buy">🛒 Comprar carta (−3 🪙)</button>' : ''}</div>` : ''}`;
    } else if (ph === 'place') {
      h = '<p class="hint">Escucha y <b>toca en la línea del tiempo</b> dónde crees que va.</p>';
    } else if (ph === 'placed') {
      const canCh = !state.coop && state.players.some((pl, k) => k !== i && pl.tokens > 0 && !state.cur.ch.some((c) => c.p === k));
      h = `<div class="split">${canCh ? '<button class="btn yellow" data-act="hitster">⚡ ¡Hitster! <span class="sub">−1🪙</span></button>' : ''}
        <button class="btn primary" data-act="reveal">👀 Revelar</button></div>`;
    } else if (ph === 'challenge') {
      const ch = state.players[ui.challenger];
      h = `<p class="hint"><span class="dot" style="--c:${ch.color}"></span> <b>${esc(ch.name)}</b>: elige otro hueco donde crees que va.</p>
        <button class="btn" data-act="cancel-challenge">Cancelar reto</button>`;
    } else if (ph === 'revealed') {
      h = `<button class="btn green big" data-act="next">Siguiente turno ▶</button>
        <button class="btn link small" data-act="void">¿Ha sonado otra canción? Anular turno</button>`;
    }
    ab.innerHTML = h;
  }

  // ---------------------------------------------------------------------------
  // Modales y avisos
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function openModal(html, id) {
    ui.modal = id || 'modal';
    $('#modal-root').innerHTML = `<div class="modal-bg" data-act="bg-close"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  }
  function closeModal() { ui.modal = null; $('#modal-root').innerHTML = ''; }

  function rulesHTML() {
    return `<h2>📖 Reglas <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
      <p>Son las reglas de <b>Hitster</b>. Cada carta es una canción y el objetivo es ordenarlas por año.</p>
      <h3>Tu turno</h3>
      <ol>
        <li>Pulsa <b>Canción aleatoria</b>: suena una canción que todavía no ha salido.</li>
        <li>Tócala en tu <b>línea del tiempo</b>: antes, después o entre tus cartas, según el año en que creas que salió.</li>
        <li>Antes de revelar, di en voz alta el <b>título</b> y el <b>artista</b> (o escríbelos).</li>
        <li>Pulsa <b>Revelar</b>. Si está bien colocada, te quedas la carta. Si no, se descarta.</li>
      </ol>
      <p>Si hay dos canciones del mismo año, da igual en qué orden vayan.</p>
      <h3>Fichas 🪙</h3>
      <ul>
        <li>Empiezas con 2 (máximo 5). Ganas 1 si aciertas <b>título y artista</b>.</li>
        <li><b>Saltar</b> (1 🪙): cambia la canción por otra.</li>
        <li><b>¡Hitster!</b> (1 🪙): cuando otro jugador ya ha colocado su canción, si crees que está mal, la retas y eliges otro hueco. Si él falla y tú aciertas, la carta es para ti.</li>
        <li><b>Comprar carta</b> (3 🪙): al empezar tu turno, se añade una carta a tu línea del tiempo en su sitio.</li>
      </ul>
      <h3>Ganar</h3>
      <p>Gana el primero que llegue a <b>${state ? state.target : settings.target} cartas</b> (contando la inicial).</p>
      <h3>Modos</h3>
      <ul>
        <li><b>Original</b>: basta con colocarla bien.</li>
        <li><b>Pro</b>: además hay que acertar título y artista para quedarse la carta.</li>
        <li><b>Experto</b>: título, artista y el año exacto.</li>
        <li><b>Cooperativo / solitario</b>: una línea del tiempo para todos y 3 vidas. Cada carta fallada cuesta una vida.</li>
      </ul>
      <div class="stack"><button class="btn primary" data-act="close">Entendido</button></div>`;
  }

  function spotifyHelpHTML() {
    const uri = Spotify.redirectUri();
    return `<h2>🎧 Conectar Spotify <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
      <p>Spotify no deja que una web reproduzca canciones sin una "app" propia. Se crea gratis en 2 minutos y solo se hace una vez. La cuenta tiene que ser <b>Premium</b>.</p>
      <ol>
        <li>Entra en <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> con tu cuenta de Spotify (acepta las condiciones si te las pide).</li>
        <li>Pulsa <b>Create app</b>. Nombre: <i>Temazos</i>. Descripción: <i>Juego</i>.</li>
        <li>En <b>Redirect URIs</b> pega exactamente esto y pulsa <b>Add</b>:
          <div class="copy"><code>${esc(uri)}</code><button class="btn small" data-act="copy" data-text="${esc(uri)}">Copiar</button></div></li>
        <li>En "Which API/SDKs are you planning to use?" marca <b>Web API</b>, acepta y pulsa <b>Save</b>.</li>
        <li>Copia el <b>Client ID</b> (en <i>Basic Information</i>) y pégalo en Temazos.</li>
        <li>Pulsa <b>Conectar con Spotify</b> y acepta.</li>
        <li>Abre la app de Spotify en el móvil (o en un altavoz u ordenador) para que tenga dónde sonar. Puedes volver aquí: la música sigue sonando.</li>
      </ol>
      <p class="hint">¿Ya tenías una app creada en Spotify? Puedes usar esa: solo añade la Redirect URI de arriba.</p>
      <p class="hint">Si otra persona quiere usar su propia cuenta, añade su correo en tu app → <b>User Management</b> (hasta 5 personas).</p>
      <div class="stack"><button class="btn primary" data-act="close">Hecho</button></div>`;
  }

  async function openSoundHelp(fromError) {
    const sp = engine() === Spotify && !ui.tempPreview;
    const body = (devs) => {
      if (!sp) {
        return `<h2>🔈 ¿No suena? <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
          <ul><li>Sube el volumen y quita el modo silencio del móvil.</li><li>Comprueba que tienes conexión a internet.</li></ul>
          <div class="stack"><button class="btn primary" data-act="retry-play">Reintentar</button>
          <button class="btn" data-act="free-skip">Esta canción no carga: poner otra (sin coste)</button></div>`;
      }
      const list = devs == null ? '<p class="hint">Buscando dispositivos…</p>'
        : devs.length ? `<div class="stack">${devs.map((d) => `<button class="btn ${d.id === Spotify.deviceId ? 'primary' : ''}" data-act="pick-device" data-id="${esc(d.id)}">${/smartphone/i.test(d.type) ? '📱' : /computer/i.test(d.type) ? '💻' : '🔊'} ${esc(d.name)}${d.is_active ? ' · activo' : ''}</button>`).join('')}</div>`
          : '<p class="warn-line">No hay ningún dispositivo de Spotify disponible.</p>';
      return `<h2>🔈 ${fromError ? '¿Dónde suena Spotify?' : '¿No suena?'} <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
        <p>Spotify necesita tener su app <b>abierta</b> en algún sitio: este móvil, un altavoz, un ordenador o la tele. Ábrela, vuelve aquí y pulsa Reintentar.</p>
        ${list}
        <div class="stack">
          <a class="btn" href="${IS_IOS ? 'spotify:' : 'https://open.spotify.com/'}" target="_blank" rel="noopener">Abrir Spotify</a>
          <button class="btn primary" data-act="retry-play">Reintentar</button>
          <button class="btn" data-act="use-preview-once">Usar fragmento de 30 s esta vez</button>
          <button class="btn link small" data-act="free-skip">Esta canción no está en Spotify: poner otra</button>
        </div>`;
    };
    openModal(body(sp ? null : []), 'sound');
    if (sp) {
      try { const d = await Spotify.loadDevices(); if (ui.modal === 'sound') $('#modal-root .modal').innerHTML = body(d); } catch (e) { if (ui.modal === 'sound') $('#modal-root .modal').innerHTML = body([]); }
    }
  }

  function scoreHTML() {
    const rows = state.coop
      ? [{ name: 'Equipo', color: PLAYER_COLORS[0], tokens: state.team.tokens, cards: state.team.cards }]
      : state.players;
    return `<h2>🏆 Marcador <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
      ${rows.map((r) => `<div class="score-row"><span class="dot" style="--c:${r.color}"></span><span class="nm">${esc(r.name)}</span><span class="chip">🪙 ${r.tokens}</span><span class="chip">🃏 ${r.cards.length}/${state.target}</span></div>
        <div class="mini-tl">${sortedCards(r).map((s) => `<span style="--dc:${decadeColor(s.y)}" title="${esc(s.t)} — ${esc(s.a)}">${s.y}</span>`).join('')}</div>`).join('')}
      ${state.coop ? `<p class="hint">Vidas: ${state.team.lives} de ${COOP_LIVES}</p>` : ''}
      <p class="hint">Ronda ${state.round} · modo ${rulesLabel(state.rules)}</p>`;
  }

  function menuHTML() {
    const sp = state.source === 'spotify';
    return `<h2>☰ Menú <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
      <div class="stack">
        <button class="btn" data-act="score">🏆 Marcador y cartas</button>
        <button class="btn" data-act="rules">📖 Reglas</button>
        <button class="btn" data-act="switch-source">🎧 Cambiar a ${sp ? 'fragmentos de 30 s' : 'Spotify (canción entera)'}</button>
        <button class="btn" data-act="home">🏠 Ir al inicio (se guarda la partida)</button>
        <button class="btn danger" data-act="end-game">Terminar partida</button>
      </div>`;
  }

  function endHTML() {
    const o = state.over;
    let head;
    if (state.coop) head = o.win ? `<div class="big">🎉</div><h2>¡Lo habéis conseguido!</h2><p>${state.team.cards.length} cartas con ${state.team.lives} vida${state.team.lives === 1 ? '' : 's'} de sobra.</p>`
      : `<div class="big">💀</div><h2>Sin vidas</h2><p>Os habéis quedado en ${state.team.cards.length} de ${state.target} cartas.</p>`;
    else head = `<div class="big">🏆</div><h2>¡Gana ${esc(state.players[o.winner].name)}!</h2><p>Llega a ${state.target} cartas.</p>`;
    return `<div class="winner">${head}</div>${scoreHTML().replace(/<h2>.*?<\/h2>/, '')}
      <div class="stack"><button class="btn primary" data-act="rematch">Jugar otra vez</button><button class="btn" data-act="home-new">Volver al inicio</button></div>`;
  }

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* opcional */ }
  }

  function startGame(fresh) {
    if (fresh) {
      if (settings.source === 'spotify' && !Spotify.connected()) {
        toast('Primero conecta Spotify (o elige «Sin cuenta»)');
        return;
      }
      if (settings.source === 'preview') Preview.unlock();
      newGame();
      if (ui.playing) Promise.resolve(playEngine().stop()).catch(() => {});
      ui.playing = false; ui.challenger = null; ui.tempPreview = false;
    } else if (state.source === 'preview') Preview.unlock();
    ui.screen = 'game';
    keepAwake();
    render();
    window.scrollTo(0, 0);
    prefetchNext();
    if (fresh) toast(state.coop ? 'Primera carta del equipo repartida' : 'Cada jugador tiene ya su primera carta');
  }

  function act(name, el, ev) {
    switch (name) {
      // --- inicio ---
      case 'add-player': settings.players.push(`Jugador ${settings.players.length + 1}`); saveSettings(); render(); setTimeout(() => { const ins = document.querySelectorAll('#players input'); const last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } }, 30); break;
      case 'rm-player': settings.players.splice(Number(el.dataset.i), 1); saveSettings(); render(); break;
      case 'rules-mode': settings.rules = el.dataset.v; saveSettings(); render(); break;
      case 'target': settings.target = Math.max(3, Math.min(20, settings.target + Number(el.dataset.d))); saveSettings(); render(); break;
      case 'reset-heard': store.set('heard', []); toast('Todas las canciones vuelven a estar disponibles'); render(); break;
      case 'pick-src': {
        if (ev.target.closest('.sp-box')) return;
        const v = el.dataset.v;
        if (settings.source === v) return;
        settings.source = v; saveSettings(); render();
        if (v === 'spotify' && Spotify.connected() && !Spotify.devices) refreshSetupDevices();
        break;
      }
      case 'start': startGame(true); break;
      case 'resume': startGame(false); break;
      case 'rules': openModal(rulesHTML(), 'rules'); break;
      case 'sp-help': ev.preventDefault(); openModal(spotifyHelpHTML(), 'sphelp'); break;
      case 'sp-save-client': {
        ev.preventDefault();
        const v = ($('#sp-client') && $('#sp-client').value || '').trim();
        if (!/^[0-9a-f]{32}$/i.test(v)) { toast('El Client ID son 32 letras y números. Cópialo de tu app de Spotify.'); return; }
        Spotify.clientId = v;
        Spotify.login().catch((e) => toast('No se pudo iniciar la conexión: ' + e.message));
        break;
      }
      case 'sp-login':
        ev.preventDefault();
        if (ui.screen === 'game') store.set('returnTo', 'game');
        Spotify.login().catch((e) => toast(e.code === 'noclient' ? 'Falta el Client ID' : 'Error: ' + e.message));
        break;
      case 'sp-reset': ev.preventDefault(); Spotify.clientId = ''; Spotify.logout(); render(); break;
      case 'sp-logout': ev.preventDefault(); Spotify.logout(); render(); break;
      case 'sp-devices':
        ev.preventDefault();
        Spotify.devices = null; render();
        Spotify.loadDevices().then((d) => { if (d.length && !d.some((x) => x.id === Spotify.deviceId)) Spotify.setDevice(d.find((x) => x.is_active) || d[0]); }).catch((e) => { Spotify.devices = []; if (e.code === 'auth') toast('Vuelve a conectar Spotify'); }).finally(() => render());
        break;
      case 'copy': {
        const text = el.dataset.text;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copiado ✓'), () => { window.prompt('Copia esto:', text); });
        break;
      }
      // --- partida ---
      case 'random':
        if (ui.busy) return;
        if (!state.cur) { state.cur = newCur(draw()); ui.guessOpen = false; ui.playing = false; ui.tempPreview = false; save(); }
        playCurrent(true);
        break;
      case 'toggle-pause':
        if (ui.needTap && (engine() === Preview || ui.tempPreview)) { Preview.audio.play().catch(() => {}); return; }
        togglePause();
        break;
      case 'restart': restartSong(); break;
      case 'stop-prev': Promise.resolve(playEngine().pause()).catch(() => {}); setPlaying(false); render(); break;
      case 'retry-play': closeModal(); playCurrent(true); break;
      case 'use-preview-once': playPreviewOnce(); break;
      case 'sound-help': openSoundHelp(false); break;
      case 'pick-device': {
        const d = (Spotify.devices || []).find((x) => x.id === el.dataset.id);
        Spotify.setDevice(d || null);
        closeModal();
        playCurrent(true);
        break;
      }
      case 'free-skip': {
        closeModal();
        if (!state.cur || state.cur.revealed) return;
        engine().forget(BY_ID[state.cur.id]);
        state.cur = Object.assign(newCur(draw()), { slot: state.cur.slot });
        save();
        playCurrent(true);
        break;
      }
      case 'skip': {
        const own = owner(state.turn);
        if (!state.cur || own.tokens < 1 || ui.busy) return;
        own.tokens--;
        for (const ch of state.cur.ch) state.players[ch.p].tokens++; // los retos se devuelven
        state.cur = newCur(draw());
        ui.guessOpen = false;
        save();
        toast('−1 🪙 · nueva canción');
        playCurrent(true);
        break;
      }
      case 'buy': {
        const own = owner(state.turn);
        if (own.tokens < 3 || state.cur) return;
        own.tokens -= 3;
        const id = draw();
        own.cards.push(id);
        const s = BY_ID[id];
        toast(`🛒 Carta comprada: ${s.t} (${s.y})`, 3200);
        if (own.cards.length >= state.target) state.over = state.coop ? { win: true } : { winner: state.turn };
        save();
        render();
        if (state.over) openModal(endHTML(), 'end');
        break;
      }
      case 'slot': {
        const k = Number(el.dataset.slot);
        if (ui.challenger != null) {
          if (k === state.cur.slot || state.cur.ch.some((c) => c.slot === k)) return;
          state.players[ui.challenger].tokens--;
          state.cur.ch.push({ p: ui.challenger, slot: k });
          toast(`⚡ ¡Hitster! de ${state.players[ui.challenger].name}`);
          ui.challenger = null;
        } else {
          if (state.cur.ch.length) return;
          state.cur.slot = state.cur.slot === k ? null : k;
        }
        save();
        render();
        break;
      }
      case 'hitster': {
        const i = state.turn;
        const opts = state.players.map((pl, k) => ({ pl, k })).filter(({ pl, k }) => k !== i && pl.tokens > 0 && !state.cur.ch.some((c) => c.p === k));
        if (!opts.length) return;
        if (opts.length === 1) { ui.challenger = opts[0].k; render(); return; }
        openModal(`<h2>⚡ ¿Quién dice ¡Hitster!? <button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></h2>
          <p>Cuesta 1 🪙. Si ${esc(state.players[i].name)} falla y tú aciertas el hueco, te llevas la carta.</p>
          <div class="stack">${opts.map(({ pl, k }) => `<button class="btn" data-act="pick-challenger" data-k="${k}"><span class="dot" style="--c:${pl.color}"></span> ${esc(pl.name)} · 🪙 ${pl.tokens}</button>`).join('')}</div>`, 'hitster');
        break;
      }
      case 'pick-challenger': ui.challenger = Number(el.dataset.k); closeModal(); render(); break;
      case 'cancel-challenge': ui.challenger = null; render(); break;
      case 'reveal': {
        const cur = state.cur, song = BY_ID[cur.id];
        readGuess();
        cur.revealed = true;
        cur.j.t = guessTitleOk(cur.g.t, song);
        cur.j.a = guessArtistOk(cur.g.a, song);
        cur.j.y = cur.g.y ? Number(cur.g.y) === song.y : null;
        ui.challenger = null;
        save();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      }
      case 'judge': {
        const k = el.dataset.k, v = el.dataset.v === '1';
        state.cur.j[k] = state.cur.j[k] === v ? null : v;
        save();
        render();
        break;
      }
      case 'next': {
        const res = resolveTurn();
        ui.challenger = null; ui.tempPreview = false;
        const s = BY_ID[res.id];
        const who = state.coop ? 'El equipo' : state.players[res.who].name;
        let msg = res.keep ? `🃏 ${who} se queda «${s.t}»` : res.stolenBy != null ? `⚡ ${state.players[res.stolenBy].name} se lleva «${s.t}»` : `🗑️ «${s.t}» (${s.y}) se descarta`;
        if (res.token) msg += ' · +1 🪙';
        render();
        window.scrollTo(0, 0);
        if (state.over) openModal(endHTML(), 'end');
        else toast(msg, 3200);
        break;
      }
      case 'void': {
        if (!state.cur) return;
        if (!window.confirm('¿Anular este turno? La carta se descarta sin penalización y el jugador vuelve a tirar.')) return;
        for (const ch of state.cur.ch) state.players[ch.p].tokens++;
        engine().forget(BY_ID[state.cur.id]);
        state.cur = null;
        save();
        render();
        break;
      }
      case 'score': openModal(scoreHTML(), 'score'); break;
      case 'menu': openModal(menuHTML(), 'menu'); break;
      case 'switch-source': {
        const to = state.source === 'spotify' ? 'preview' : 'spotify';
        if (to === 'spotify' && !Spotify.connected()) { closeModal(); ui.screen = 'setup'; settings.source = 'spotify'; saveSettings(); render(); toast('Conecta Spotify y luego pulsa Continuar'); return; }
        if (ui.playing) Promise.resolve(playEngine().stop()).catch(() => {});
        state.source = to; settings.source = to; saveSettings(); save();
        ui.tempPreview = false;
        ui.playing = false; if (state.cur) state.cur.played = false;
        if (to === 'preview') Preview.unlock();
        closeModal(); render();
        toast(to === 'spotify' ? 'Ahora suena por Spotify' : 'Ahora suenan fragmentos de 30 s');
        break;
      }
      case 'home': closeModal(); ui.screen = 'setup'; render(); break;
      case 'end-game':
        if (!window.confirm('¿Terminar la partida?')) return;
        if (ui.playing) Promise.resolve(playEngine().stop()).catch(() => {});
        state = null; store.del('game'); closeModal(); ui.screen = 'setup'; ui.playing = false; render();
        break;
      case 'rematch': closeModal(); startGame(true); break;
      case 'home-new': closeModal(); state = null; store.del('game'); ui.screen = 'setup'; render(); break;
      case 'close': closeModal(); break;
      case 'bg-close': if (ev.target === el && ui.modal !== 'end') closeModal(); break;
      default: break;
    }
  }

  function readGuess() {
    if (!state || !state.cur) return;
    const g = state.cur.g;
    const t = $('#g-t'), a = $('#g-a'), y = $('#g-y');
    if (t) g.t = t.value.trim();
    if (a) g.a = a.value.trim();
    if (y) g.y = y.value.trim();
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const name = el.dataset.act;
    if (el.tagName === 'A' && name !== 'copy') return; // enlaces normales
    act(name, el, ev);
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.pi != null) { settings.players[Number(t.dataset.pi)] = t.value; saveSettings(); return; }
    if (t.id === 'g-t' || t.id === 'g-a' || t.id === 'g-y') { readGuess(); save(); }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'coop') { settings.coop = t.checked; saveSettings(); return; }
    if (t.id === 'yearFrom' || t.id === 'yearTo') {
      settings[t.id] = Number(t.value);
      if (settings.yearFrom > settings.yearTo) settings.yearTo = settings.yearFrom;
      saveSettings(); render(); return;
    }
    if (t.id === 'sp-device') {
      const d = (Spotify.devices || []).find((x) => x.id === t.value);
      Spotify.setDevice(d || null); return;
    }
  });
  document.addEventListener('toggle', (ev) => { if (ev.target.id === 'guess-box') ui.guessOpen = ev.target.open; }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ui.modal && ui.modal !== 'end') closeModal();
    if (ev.key === 'Enter' && ev.target.id === 'sp-client') act('sp-save-client', ev.target, ev);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ui.screen === 'game') keepAwake();
    if (ui.modal === 'sound') openSoundHelp(true);
    if (ui.screen === 'setup' && settings.source === 'spotify' && Spotify.connected()) refreshSetupDevices();
  });

  function refreshSetupDevices() {
    Spotify.loadDevices()
      .then((d) => { if (d.length && !d.some((x) => x.id === Spotify.deviceId)) Spotify.setDevice(d.find((x) => x.is_active) || d[0]); })
      .catch((e) => { Spotify.devices = []; if (e.code === 'auth') render(); })
      .finally(() => { if (ui.screen === 'setup') render(); });
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------
  async function init() {
    Preview.init();
    let res = null;
    try { res = await Spotify.handleRedirect(); } catch (e) { res = { error: e.message }; }
    if (res && res.ok) {
      settings.source = 'spotify'; saveSettings();
      toast('✓ Spotify conectado');
      Spotify.loadUser().then(() => { if (ui.screen === 'setup') render(); });
    } else if (res && res.error) toast('No se pudo conectar Spotify: ' + res.error, 4500);
    const back = store.get('returnTo');
    store.del('returnTo');
    if (back === 'game' && state && !state.over) { save(); startGame(false); }
    else render();
    if (settings.source === 'spotify' && Spotify.connected()) refreshSetupDevices();
    if (Spotify.connected() && !Spotify.userName) Spotify.loadUser().then(() => { if (ui.screen === 'setup') render(); });
  }

  // Para pruebas automáticas
  window.__temazos = { SONGS, BY_ID, norm, pickBest, scoreCand, guessTitleOk, guessArtistOk, artistParts, get state() { return state; }, ui, Spotify, Preview };

  init();
})();
