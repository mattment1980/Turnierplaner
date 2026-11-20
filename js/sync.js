/*
 * Turnierplaner – Speichern auf GitHub
 *
 * Jedes Turnier liegt als eigene Datei data/<id>.json im Branch "data"
 * des Repos. Geschrieben wird über die GitHub-API mit einem
 * Fine-grained Personal Access Token (nur dieses Repo, "Contents: Read and write").
 * Der Token bleibt im Browser dieses Geräts und wird nie ins Repo geschrieben.
 */
(function (root) {
  'use strict';

  var CFG_KEY = 'turnierplaner:github';
  var API = 'https://api.github.com';
  var DELAY = 8000;        // ms nach der letzten Änderung
  var RETRY = 30000;       // ms bis zum nächsten Versuch nach Fehler/offline

  var hooks = null;        // vom App-Modul: tournaments(), replace(), add(), remove(), persist(), onStatus(), onPulled()
  var timers = {};
  var inflight = {};
  var again = {};
  var status = {};         // id -> { state, at, msg }
  var branchReady = false;
  var globalState = { state: 'idle', msg: '' };

  /* ---------- Konfiguration ---------- */

  function defaults() {
    var c = { owner: '', repo: '', branch: 'data', token: '' };
    var host = location.hostname || '';
    if (/\.github\.io$/i.test(host)) {
      c.owner = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      if (seg) c.repo = seg;
    }
    return c;
  }

  function getConfig() {
    var c = defaults();
    try {
      var saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (saved) Object.keys(saved).forEach(function (k) { if (saved[k] !== undefined && saved[k] !== '') c[k] = saved[k]; });
    } catch (e) { /* ignorieren */ }
    return c;
  }

  function setConfig(c) {
    branchReady = false;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* ignorieren */ }
  }

  function clearToken() {
    var c = getConfig();
    c.token = '';
    setConfig(c);
  }

  function enabled() {
    var c = getConfig();
    return !!(c.owner && c.repo && c.branch && c.token);
  }

  /* ---------- API ---------- */

  function repoPath() {
    var c = getConfig();
    return '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo);
  }

  function httpMessage(status, text) {
    var msg = '';
    try { msg = JSON.parse(text).message || ''; } catch (e) { msg = text || ''; }
    if (status === 401) return 'Token ungültig oder abgelaufen.';
    if (status === 403) return 'Keine Berechtigung – hat der Token „Contents: Read and write“ für dieses Repo?' + (msg ? ' (' + msg + ')' : '');
    if (status === 404) return 'Repo nicht gefunden oder kein Zugriff.';
    return 'GitHub-Fehler ' + status + (msg ? ': ' + msg : '');
  }

  function api(path, opts) {
    opts = opts || {};
    var c = getConfig();
    var headers = {
      'Authorization': 'Bearer ' + c.token,
      'Accept': opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      if (opts.allow404 && res.status === 404) return null;
      if (!res.ok) {
        return res.text().then(function (txt) {
          var e = new Error(httpMessage(res.status, txt));
          e.status = res.status;
          throw e;
        });
      }
      if (res.status === 204) return {};
      return opts.raw ? res.text() : res.json();
    });
  }

  function isOffline(err) {
    return !err.status; // fetch-Fehler ohne HTTP-Status = Netzwerk weg
  }

  function ensureBranch() {
    if (branchReady) return Promise.resolve();
    var c = getConfig();
    return api(repoPath() + '/git/ref/heads/' + encodeURIComponent(c.branch), { allow404: true }).then(function (ref) {
      if (ref) { branchReady = true; return; }
      return api(repoPath()).then(function (repo) {
        return api(repoPath() + '/git/ref/heads/' + encodeURIComponent(repo.default_branch));
      }).then(function (base) {
        return api(repoPath() + '/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + c.branch, sha: base.object.sha } });
      }).then(function () { branchReady = true; });
    });
  }

  function filePath(id) {
    return 'data/' + encodeURIComponent(id) + '.json';
  }

  function contentsUrl(id) {
    return repoPath() + '/contents/' + filePath(id) + '?ref=' + encodeURIComponent(getConfig().branch);
  }

  /* ---------- (De-)Serialisierung ---------- */

  // Felder mit "_" am Anfang (Sync-Status) bleiben lokal
  function stripPrivate(key, value) {
    return key.charAt(0) === '_' ? undefined : value;
  }

  function serialize(t) {
    return JSON.stringify(t, stripPrivate, 2);
  }

  function toBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  /* ---------- Status ---------- */

  function setStatus(id, state, msg) {
    status[id] = { state: state, at: new Date(), msg: msg || '' };
    if (hooks) hooks.onStatus(id);
  }

  function setGlobal(state, msg) {
    globalState = { state: state, msg: msg || '' };
    if (hooks) hooks.onStatus(null);
  }

  function hhmm(d) {
    var dt = new Date(d);
    return ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2);
  }

  function statusFor(t) {
    if (!enabled()) return { state: 'local', text: 'Nur auf diesem Gerät gespeichert' };
    var s = status[t.id];
    if (s && s.state === 'saving') return { state: 'saving', text: 'Speichere auf GitHub …' };
    if (s && s.state === 'offline') return { state: 'warn', text: 'Offline – wird automatisch nachgeholt' };
    if (s && s.state === 'error') return { state: 'error', text: 'Nicht gespeichert: ' + s.msg };
    if (t._dirty) return { state: 'pending', text: 'Änderungen werden gleich gespeichert …' };
    if (t._sync && t._sync.at) return { state: 'ok', text: 'Auf GitHub gespeichert ' + hhmm(t._sync.at) };
    return { state: 'pending', text: 'Noch nicht auf GitHub gespeichert' };
  }

  function globalStatus() {
    if (!enabled()) return { state: 'local', text: 'GitHub-Speicher nicht eingerichtet' };
    if (globalState.state === 'loading') return { state: 'saving', text: 'Lade von GitHub …' };
    if (globalState.state === 'error') return { state: 'error', text: globalState.msg };
    if (globalState.state === 'offline') return { state: 'warn', text: 'Offline – Daten von diesem Gerät' };
    return { state: 'ok', text: 'Mit GitHub verbunden' };
  }

  /* ---------- Speichern ---------- */

  function schedule(t, delay) {
    if (!enabled() || !t) return;
    clearTimeout(timers[t.id]);
    timers[t.id] = setTimeout(function () { push(t.id); }, delay == null ? DELAY : delay);
    if (hooks) hooks.onStatus(t.id);
  }

  function saveNow(t) {
    if (!t) return Promise.resolve();
    clearTimeout(timers[t.id]);
    return push(t.id);
  }

  function findLocal(id) {
    var list = hooks.tournaments();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function push(id) {
    if (!enabled()) return Promise.resolve();
    if (inflight[id]) { again[id] = true; return inflight[id]; }
    var t = findLocal(id);
    if (!t) return Promise.resolve();
    var stamp = t.updatedAt;
    setStatus(id, 'saving');

    function put(sha) {
      var body = {
        message: 'Turnier „' + (t.name || id) + '“ gespeichert',
        content: toBase64(serialize(t)),
        branch: getConfig().branch
      };
      if (sha) body.sha = sha;
      return api(repoPath() + '/contents/' + filePath(id), { method: 'PUT', body: body });
    }

    var p = ensureBranch().then(function () {
      return put(t._sync && t._sync.sha).catch(function (err) {
        // Datei wurde zwischenzeitlich auf einem anderen Gerät geändert:
        // Ergebnisse zusammenführen (eigene Einträge haben Vorrang), dann speichern
        if (err.status === 409 || err.status === 422) {
          return api(contentsUrl(id), { allow404: true }).then(function (meta) {
            if (!meta) return put(null);
            return api(contentsUrl(id), { raw: true }).then(function (txt) {
              if (mergeRemote(t, JSON.parse(txt))) { hooks.persist(); hooks.onPulled(); }
              return put(meta.sha);
            });
          });
        }
        throw err;
      });
    }).then(function (res) {
      var cur = findLocal(id);
      if (cur) {
        cur._sync = { sha: res.content.sha, at: new Date().toISOString() };
        if (cur.updatedAt === stamp) cur._dirty = false;
        hooks.persist();
      }
      setStatus(id, 'saved');
    }).catch(function (err) {
      if (isOffline(err)) setStatus(id, 'offline');
      else setStatus(id, 'error', err.message);
      clearTimeout(timers[id]);
      timers[id] = setTimeout(function () { push(id); }, RETRY);
    }).then(function () {
      inflight[id] = null;
      var cur = findLocal(id);
      var wanted = again[id];
      again[id] = false;
      if (wanted && cur && cur._dirty && status[id] && status[id].state === 'saved') return push(id);
    });
    inflight[id] = p;
    return p;
  }

  // Übernimmt Ergebnisse des anderen Geräts, die hier noch fehlen
  function mergeRemote(local, remote) {
    var changed = false;
    if (!remote || !remote.results) return false;
    Object.keys(remote.results).forEach(function (k) {
      if (!local.results[k]) { local.results[k] = remote.results[k]; changed = true; }
    });
    if (!local.groups2 && remote.groups2) { local.groups2 = remote.groups2; changed = true; }
    if (!local.koSeeds && remote.koSeeds) { local.koSeeds = remote.koSeeds; changed = true; }
    return changed;
  }

  function remove(t) {
    if (!enabled() || !t || !t._sync || !t._sync.sha) return Promise.resolve();
    clearTimeout(timers[t.id]);
    return ensureBranch().then(function () {
      return api(contentsUrl(t.id), { allow404: true });
    }).then(function (meta) {
      if (!meta) return;
      return api(repoPath() + '/contents/' + filePath(t.id), {
        method: 'DELETE',
        body: { message: 'Turnier „' + (t.name || t.id) + '“ gelöscht', sha: meta.sha, branch: getConfig().branch }
      });
    }).catch(function (err) {
      setGlobal('error', 'Löschen auf GitHub fehlgeschlagen: ' + err.message);
    });
  }

  /* ---------- Laden (Abgleich beim Start) ---------- */

  function pullAll() {
    if (!enabled()) return Promise.resolve();
    setGlobal('loading');
    var c = getConfig();
    return ensureBranch().then(function () {
      return api(repoPath() + '/contents/data?ref=' + encodeURIComponent(c.branch), { allow404: true });
    }).then(function (list) {
      var remote = {};
      (Array.isArray(list) ? list : []).forEach(function (f) {
        var m = /^(.+)\.json$/.exec(f.name);
        if (m && f.type === 'file') remote[decodeURIComponent(m[1])] = f.sha;
      });
      var jobs = [];
      Object.keys(remote).forEach(function (id) {
        var local = findLocal(id);
        if (local && local._sync && local._sync.sha === remote[id]) {
          if (local._dirty) schedule(local, 0);
          return; // unverändert
        }
        jobs.push(api(contentsUrl(id), { raw: true }).then(function (txt) {
          var data = JSON.parse(txt);
          if (TL.validateTournament(data)) return;
          data._sync = { sha: remote[id], at: new Date().toISOString() };
          var cur = findLocal(id);
          if (!cur) hooks.add(data);
          else if (!cur._dirty || (data.updatedAt || '') > (cur.updatedAt || '')) hooks.replace(data);
          else schedule(cur, 0); // lokale Version ist neuer
        }));
      });
      hooks.tournaments().slice().forEach(function (t) {
        if (remote[t.id]) return;
        if (t._sync && t._sync.sha && !t._dirty) hooks.remove(t.id); // auf anderem Gerät gelöscht
        else schedule(t, 0);                                          // noch nie hochgeladen
      });
      return Promise.all(jobs);
    }).then(function () {
      hooks.persist();
      setGlobal('ok');
      hooks.onPulled();
    }).catch(function (err) {
      if (isOffline(err)) setGlobal('offline');
      else setGlobal('error', err.message);
    });
  }

  function testConnection() {
    branchReady = false;
    return api(repoPath()).then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) {
        throw new Error('Der Token darf in dieses Repo nicht schreiben.');
      }
      return ensureBranch().then(function () {
        return { ok: true, text: 'Verbindung klappt: ' + repo.full_name + (repo.private ? ' (privat)' : ' (öffentlich)') + ', Branch „' + getConfig().branch + '“.' };
      });
    });
  }

  function hasPending() {
    return enabled() && hooks.tournaments().some(function (t) { return t._dirty; });
  }

  function init(h) {
    hooks = h;
    window.addEventListener('online', function () {
      hooks.tournaments().forEach(function (t) { if (t._dirty) schedule(t, 0); });
    });
    window.addEventListener('beforeunload', function (e) {
      if (hasPending()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  root.Sync = {
    init: init,
    getConfig: getConfig,
    setConfig: setConfig,
    clearToken: clearToken,
    enabled: enabled,
    schedule: schedule,
    saveNow: saveNow,
    remove: remove,
    pullAll: pullAll,
    testConnection: testConnection,
    statusFor: statusFor,
    globalStatus: globalStatus,
    serialize: serialize
  };
})(this);
