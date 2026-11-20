/*
 * Turnierplaner – Online-Speicher mit Firebase (Firestore + Login)
 *
 * - Turnierleitung meldet sich mit E-Mail/Passwort an und darf schreiben.
 * - Jedes Turnier ist ein Dokument tournaments/<id> mit dem Turnier als JSON-Text.
 * - Änderungen werden ca. 1,5 s nach der letzten Eingabe gespeichert und
 *   auf allen angemeldeten Geräten in Echtzeit übernommen.
 * - Zuschauer lesen einzelne Turniere ohne Anmeldung (Live-Ansicht).
 */
(function (root) {
  'use strict';

  var VERSION = '13.2.0';
  var BASE = root.FIREBASE_SDK_BASE || ('https://www.gstatic.com/firebasejs/' + VERSION + '/');
  var DELAY = 1500;
  var RETRY = 20000;
  var MAX_BYTES = 900000;

  var fb = null, app = null, auth = null, db = null, user = null, loading = null;
  var hooks = null, timers = {}, inflight = {}, again = {}, status = {};
  var globalState = { state: 'idle', msg: '' };
  var unsubList = null, firstSnapshot = true, authKnown = false;

  function cfg() { return root.FIREBASE_CONFIG; }
  function configured() { var c = cfg(); return !!(c && c.apiKey && c.projectId); }
  function enabled() { return configured() && !!user; }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      import(BASE + 'firebase-app.js'),
      import(BASE + 'firebase-auth.js'),
      import(BASE + 'firebase-firestore.js')
    ]).then(function (m) {
      fb = {};
      m.forEach(function (mod) { Object.keys(mod).forEach(function (k) { fb[k] = mod[k]; }); });
      app = fb.initializeApp(cfg());
      auth = fb.getAuth(app);
      db = fb.getFirestore(app);
      return fb;
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  /* ---------- Hilfen ---------- */

  function stripPrivate(key, value) { return key.charAt(0) === '_' ? undefined : value; }
  function serialize(t) { return JSON.stringify(t, stripPrivate, 2); }

  function hhmm(d) {
    var dt = new Date(d);
    return ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2);
  }

  function errText(err) {
    var code = (err && err.code) || '';
    if (/permission-denied/.test(code)) return 'Keine Schreibrechte – ist deine E-Mail in den Firestore-Regeln eingetragen?';
    if (/unavailable|network/.test(code)) return 'Keine Verbindung';
    if (/wrong-password|invalid-credential|invalid-login|user-not-found|invalid-email/.test(code)) return 'E-Mail oder Passwort falsch.';
    if (/too-many-requests/.test(code)) return 'Zu viele Versuche – bitte kurz warten.';
    return (err && err.message) || 'Unbekannter Fehler';
  }

  function isOffline(err) {
    var code = (err && err.code) || '';
    return /unavailable|network|deadline/.test(code) || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  function setStatus(id, state, msg) {
    status[id] = { state: state, msg: msg || '' };
    if (hooks) hooks.onStatus(id);
  }

  function setGlobal(state, msg) {
    globalState = { state: state, msg: msg || '' };
    if (hooks) hooks.onStatus(null);
  }

  function findLocal(id) {
    var list = hooks.tournaments();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Übernimmt Ergebnisse/Festlegungen des anderen Geräts, die hier noch fehlen
  function mergeRemote(local, remote) {
    var changed = false;
    if (!remote || !remote.results) return false;
    Object.keys(remote.results).forEach(function (k) {
      if (!local.results[k]) { local.results[k] = remote.results[k]; changed = true; }
    });
    if (!local.groups2 && remote.groups2) { local.groups2 = remote.groups2; changed = true; }
    if (!local.koSeeds && remote.koSeeds) { local.koSeeds = remote.koSeeds; changed = true; }
    if (local.stages && remote.stages) {
      [2, 3].forEach(function (r) { if (!local.stages[r] && remote.stages[r]) { local.stages[r] = remote.stages[r]; changed = true; } });
    }
    if (local.po && remote.po) {
      Object.keys(remote.po).forEach(function (k) { if (!local.po[k]) { local.po[k] = remote.po[k]; changed = true; } });
    }
    return changed;
  }

  /* ---------- Status-Texte ---------- */

  function statusFor(t) {
    if (!configured()) return { state: 'local', text: 'Nur auf diesem Gerät gespeichert' };
    if (!user) return { state: 'local', text: 'Nicht angemeldet – nur auf diesem Gerät' };
    var s = status[t.id];
    if (s && s.state === 'saving') return { state: 'saving', text: 'Speichere online …' };
    if (s && s.state === 'offline') return { state: 'warn', text: 'Offline – wird automatisch nachgeholt' };
    if (s && s.state === 'error') return { state: 'error', text: 'Nicht gespeichert: ' + s.msg };
    if (t._dirty) return { state: 'pending', text: 'Änderungen werden gleich gespeichert …' };
    if (t._sync && t._sync.at) return { state: 'ok', text: 'Online gespeichert ' + hhmm(t._sync.at) };
    return { state: 'pending', text: 'Noch nicht online gespeichert' };
  }

  function globalStatus() {
    if (!configured()) return { state: 'local', text: 'Online-Speicher nicht eingerichtet – Daten nur auf diesem Gerät' };
    if (globalState.state === 'error') return { state: 'error', text: globalState.msg };
    if (!authKnown) return { state: 'saving', text: 'Verbinde …' };
    if (!user) return { state: 'local', text: 'Nicht angemeldet – Daten nur auf diesem Gerät' };
    if (globalState.state === 'offline') return { state: 'warn', text: 'Offline – Änderungen werden nachgeholt' };
    return { state: 'ok', text: 'Angemeldet als ' + (user.email || 'Turnierleitung') + ' – Turniere werden online gespeichert' };
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

  function push(id) {
    if (!enabled()) return Promise.resolve();
    if (inflight[id]) { again[id] = true; return inflight[id]; }
    var t = findLocal(id);
    if (!t) return Promise.resolve();
    var stamp = t.updatedAt;
    var merged = false;
    setStatus(id, 'saving');
    var ref = fb.doc(db, 'tournaments', id);
    var p = fb.runTransaction(db, function (tx) {
      return tx.get(ref).then(function (snap) {
        if (snap.exists()) {
          var d = snap.data();
          var known = t._sync && t._sync.rev;
          // jemand anderes hat seit unserem letzten Abgleich gespeichert -> zusammenführen
          if (d.updatedAt && d.updatedAt !== known) {
            try { if (mergeRemote(t, JSON.parse(d.data))) merged = true; } catch (e) { /* ignorieren */ }
          }
        }
        var text = serialize(t);
        if (text.length > MAX_BYTES) {
          var e = new Error('Turnier ist zu groß (vermutlich zu große Logos).');
          e.code = 'too-large';
          throw e;
        }
        tx.set(ref, {
          data: text,
          name: t.name || '',
          date: t.date || '',
          format: t.format || 'andi',
          updatedAt: t.updatedAt,
          by: (user && user.email) || ''
        });
      });
    }).then(function () {
      var cur = findLocal(id);
      if (cur) {
        cur._sync = { rev: t.updatedAt, at: new Date().toISOString() };
        if (cur.updatedAt === stamp) cur._dirty = false;
        hooks.persist();
      }
      setStatus(id, 'saved');
      if (merged) hooks.onPulled();
    }).catch(function (err) {
      if (isOffline(err)) setStatus(id, 'offline');
      else setStatus(id, 'error', errText(err));
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

  function remove(t) {
    if (!enabled() || !t) return Promise.resolve();
    clearTimeout(timers[t.id]);
    return fb.deleteDoc(fb.doc(db, 'tournaments', t.id)).catch(function (err) {
      setGlobal('error', 'Löschen online fehlgeschlagen: ' + errText(err));
    });
  }

  /* ---------- Echtzeit-Abgleich (angemeldet) ---------- */

  function startListening() {
    stopListening();
    firstSnapshot = true;
    unsubList = fb.onSnapshot(fb.collection(db, 'tournaments'), function (snap) {
      var remoteIds = {};
      var changed = false;
      snap.forEach(function (d) {
        remoteIds[d.id] = true;
        var meta = d.data();
        var local = findLocal(d.id);
        if (local && ((local._sync && local._sync.rev === meta.updatedAt) || local.updatedAt === meta.updatedAt)) return; // eigener Stand
        var data;
        try { data = JSON.parse(meta.data); } catch (e) { return; }
        data._sync = { rev: meta.updatedAt, at: new Date().toISOString() };
        if (!local) { hooks.add(data); changed = true; }
        else if (!local._dirty) { hooks.replace(data); changed = true; }
        else if ((meta.updatedAt || '') !== ((local._sync && local._sync.rev) || '')) {
          if (mergeRemote(local, data)) changed = true;
          schedule(local, 0);
        }
      });
      hooks.tournaments().slice().forEach(function (t) {
        if (remoteIds[t.id]) return;
        if (t._sync && !t._dirty) { hooks.remove(t.id); changed = true; } // auf anderem Gerät gelöscht
        else if (firstSnapshot) schedule(t, 0);                             // noch nie hochgeladen
      });
      firstSnapshot = false;
      setGlobal('ok');
      if (changed) { hooks.persist(); hooks.onPulled(); }
    }, function (err) {
      setGlobal(isOffline(err) ? 'offline' : 'error', errText(err));
    });
  }

  function stopListening() {
    if (unsubList) { unsubList(); unsubList = null; }
  }

  /* ---------- Login ---------- */

  function login(email, password) {
    return load().then(function () { return fb.signInWithEmailAndPassword(auth, email, password); })
      .catch(function (err) { throw new Error(errText(err)); });
  }

  function logout() {
    if (!auth) return Promise.resolve();
    return fb.signOut(auth);
  }

  function currentUser() { return user; }

  /* ---------- Live-Ansicht (ohne Anmeldung) ---------- */

  function watchTournament(id, cb) {
    var unsub = null, stopped = false;
    load().then(function () {
      if (stopped) return;
      unsub = fb.onSnapshot(fb.doc(db, 'tournaments', id), function (snap) {
        if (!snap.exists()) { cb(null, 'not-found'); return; }
        try { cb(JSON.parse(snap.data().data), null); } catch (e) { cb(null, 'broken'); }
      }, function (err) { cb(null, errText(err)); });
    }).catch(function () { cb(null, 'Keine Verbindung zum Online-Speicher.'); });
    return function () { stopped = true; if (unsub) unsub(); };
  }

  function liveUrl(id) {
    return location.origin + location.pathname + '#/live/' + encodeURIComponent(id);
  }

  function hasPending() {
    return enabled() && hooks.tournaments().some(function (t) { return t._dirty; });
  }

  function init(h) {
    hooks = h;
    if (!configured()) { authKnown = true; return; }
    load().then(function () {
      fb.onAuthStateChanged(auth, function (u) {
        user = u;
        authKnown = true;
        if (u) startListening();
        else stopListening();
        setGlobal('ok');
        if (hooks.onAuth) hooks.onAuth(u);
      });
    }).catch(function () {
      authKnown = true;
      setGlobal('offline', 'Online-Speicher nicht erreichbar – Daten von diesem Gerät');
    });
    window.addEventListener('online', function () {
      hooks.tournaments().forEach(function (t) { if (t._dirty) schedule(t, 0); });
    });
    window.addEventListener('beforeunload', function (e) {
      if (hasPending()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  root.Sync = {
    init: init,
    configured: configured,
    enabled: enabled,
    login: login,
    logout: logout,
    currentUser: currentUser,
    schedule: schedule,
    saveNow: saveNow,
    remove: remove,
    statusFor: statusFor,
    globalStatus: globalStatus,
    serialize: serialize,
    watchTournament: watchTournament,
    liveUrl: liveUrl
  };
})(this);
