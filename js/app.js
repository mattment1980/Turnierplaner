/* Turnierplaner – Oberfläche. Daten liegen im localStorage des Browsers. */
(function () {
  'use strict';

  var STORAGE_KEY = 'turnierplaner:v1';
  var app = document.getElementById('app');
  var logoInput = document.getElementById('logo-file');
  var pendingLogo = null;
  var importInput = document.getElementById('import-file');
  var topbarSub = document.getElementById('topbar-sub');

  var state = { tournaments: [], storageOk: true, showNewForm: false, newFormat: 'groups', newTeams: 16, live: null, showShare: false };
  var viewOnly = false; // Live-Ansicht für Zuschauer: nur lesen
  var brand = document.querySelector('.brand');

  function tbase(t) { return (viewOnly ? '#/live/' : '#/t/') + encodeURIComponent(t.id) + '/'; }

  /* ---------- Speichern / Laden ---------- */

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      state.tournaments = data && Array.isArray(data.tournaments) ? data.tournaments : [];
      window.localStorage.setItem(STORAGE_KEY + ':probe', '1');
      window.localStorage.removeItem(STORAGE_KEY + ':probe');
    } catch (e) {
      state.storageOk = false;
      document.getElementById('storage-warning').hidden = false;
    }
  }

  // Änderung an einem Turnier: lokal speichern und Online-Speicherung anstoßen
  function save(t) {
    if (t) {
      t.updatedAt = new Date().toISOString();
      t._dirty = true;
    }
    persist();
    if (t) Sync.schedule(t);
  }

  function persist() {
    if (!state.storageOk) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournaments: state.tournaments }));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        alert('Der Speicher im Browser ist voll. Bitte alte Turniere exportieren und löschen oder Logos entfernen.');
        return;
      }
      state.storageOk = false;
      document.getElementById('storage-warning').hidden = false;
    }
  }

  function find(id) {
    for (var i = 0; i < state.tournaments.length; i++) if (state.tournaments[i].id === id) return state.tournaments[i];
    return null;
  }

  /* ---------- Hilfen ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : iso;
  }

  function teamObj(t, id) {
    for (var i = 0; i < t.teams.length; i++) if (t.teams[i].id === id) return t.teams[i];
    return null;
  }

  function logoHtml(src, cls) {
    return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="">' : '';
  }

  // Teamname mit Logo (falls vorhanden)
  function teamHtml(t, id) {
    var tm = teamObj(t, id);
    return '<span class="tname">' + logoHtml(tm && tm.logo, 'tlogo') + '<span>' + esc(TL.teamName(t, id)) + '</span></span>';
  }

  // Bild verkleinern (max x max Pixel, Seitenverhältnis bleibt) -> Data-URL
  function shrinkImage(file, max) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) { reject(new Error('Bitte eine Bilddatei auswählen (PNG, JPG, SVG …).')); return; }
      if (file.size > 15 * 1024 * 1024) { reject(new Error('Das Bild ist zu groß (max. 15 MB).')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 300, h = img.naturalHeight || 300;
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        var out = c.toDataURL('image/webp', 0.85);
        if (out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/png');
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  function route() {
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    if (parts[0] === 't' && parts[1]) return { view: 'tournament', id: parts[1], tab: parts[2] || 'setup' };
    if (parts[0] === 'login') return { view: 'login' };
    if (parts[0] === 'live' && parts[1]) return { view: 'live', id: decodeURIComponent(parts[1]), tab: parts[2] || '' };
    return { view: 'home' };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function fmt(t) { return t.format || 'andi'; }
  function isAndi(t) { return fmt(t) === 'andi'; }
  function isMulti(t) { return fmt(t) === 'multi'; }

  function firstPlayTab(t) { return isAndi(t) ? 'p1' : isMulti(t) ? 'r1' : 'spiele'; }

  function openTab(t) {
    if (isAndi(t)) return t.groups2 || TL.phaseProgress(t, 1).done ? 'p1' : 'setup';
    if (isMulti(t)) return GE.hasResults(t) ? 'r1' : 'setup';
    return GE.hasResults(t) ? 'spiele' : 'setup';
  }

  function statusText(t) {
    if (isMulti(t)) {
      if (ME.finalRanking(t).places.every(function (p) { return p.team; })) return 'Abgeschlossen';
      if (Object.keys(t.po || {}).length) return 'Playoffs';
      var tlm = ME.timeline(t);
      for (var r = 3; r >= 1; r--) {
        if (r === 1 || (t.stages && t.stages[r])) {
          var rp = ME.roundProgress(t, r, tlm);
          if (r > 1 || rp.done) return 'Runde ' + r + ' · ' + rp.done + '/' + rp.total;
        }
      }
      return 'In Vorbereitung';
    }
    if (!isAndi(t)) {
      var fr = GE.finalRanking(t);
      if (fr.places[0].team && !fr.provisional && (!GE.hasKo(t) || t.koSeeds)) return 'Abgeschlossen';
      if (t.koSeeds) return 'K.-o.-Runde';
      var pg = GE.stageProgress(t);
      return pg.done ? (fmt(t) === 'league' ? 'Liga' : 'Gruppenphase') + ' · ' + pg.done + '/' + pg.total : 'In Vorbereitung';
    }
    if (TL.finalRanking(t)[0].team) return 'Abgeschlossen';
    if (t.koSeeds) return 'Finalrunde';
    if (t.groups2) return 'Gruppenphase 2 · ' + TL.phaseProgress(t, 2).done + '/24';
    var p = TL.phaseProgress(t, 1);
    return p.done ? 'Gruppenphase 1 · ' + p.done + '/24' : 'In Vorbereitung';
  }

  function sameGroups(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* ---------- Rendering ---------- */

  function render() {
    state.pendingRender = false;
    var r = route();
    var active = document.activeElement && document.activeElement.id;
    viewOnly = r.view === 'live';
    app.classList.toggle('view-only', viewOnly);
    brand.setAttribute('href', viewOnly ? '#/live/' + encodeURIComponent(r.id) : '#/');
    if (r.view !== 'live' && state.live) { state.live.unsub(); state.live = null; }
    if (r.view === 'live') {
      renderLive(r);
    } else if (r.view === 'tournament') {
      var t = find(r.id);
      if (!t) { go('#/'); return; }
      topbarSub.textContent = t.name + (t.date ? ' · ' + fmtDate(t.date) : '');
      document.title = t.name + ' – Turnierplaner';
      app.innerHTML = renderTournament(t, r.tab);
    } else if (r.view === 'login') {
      topbarSub.textContent = 'Anmeldung';
      document.title = 'Anmeldung – Turnierplaner';
      app.innerHTML = renderLogin();
    } else {
      topbarSub.textContent = '';
      document.title = 'Turnierplaner';
      app.innerHTML = renderHome();
    }
    if (active) {
      var el = document.getElementById(active);
      if (el) el.focus();
    }
    if (state.showShare && r.view === 'tournament') drawQr();
  }

  /* ----- Live-Ansicht ----- */

  function renderLive(r) {
    if (!Sync.configured()) {
      topbarSub.textContent = '';
      app.innerHTML = '<div class="card empty">Die Live-Ansicht ist noch nicht eingerichtet.</div>';
      return;
    }
    if (!state.live || state.live.id !== r.id) {
      if (state.live) state.live.unsub();
      var live = { id: r.id, t: null, err: null, at: null, unsub: function () {} };
      state.live = live;
      live.unsub = Sync.watchTournament(r.id, function (data, err) {
        if (state.live !== live) return;
        live.t = data; live.err = err; live.at = new Date();
        if (route().view === 'live') render();
      });
    }
    var t = state.live.t;
    if (!t) {
      topbarSub.textContent = 'Live';
      app.innerHTML = state.live.err
        ? '<div class="card empty">' + (state.live.err === 'not-found' ? 'Dieses Turnier gibt es nicht (mehr).' : esc(state.live.err)) + '</div>'
        : '<div class="card empty">Lade Turnier …</div>';
      return;
    }
    if (!t.format) t.format = 'andi';
    var tab = r.tab && r.tab !== 'setup' ? r.tab : firstPlayTab(t);
    topbarSub.textContent = t.name + ' · Live';
    document.title = t.name + ' – Live';
    app.innerHTML = renderTournament(t, tab);
  }

  function liveBadge() {
    var at = state.live && state.live.at;
    return '<span class="sync sync-ok live-dot">Live – aktualisiert sich automatisch' + (at ? ' · Stand ' + ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2) + ':' + ('0' + at.getSeconds()).slice(-2) : '') + '</span>';
  }

  /* ----- Teilen: Link & QR-Code ----- */

  var qrLoading = null;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (qrLoading) return qrLoading;
    qrLoading = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'js/vendor/qrcode.js'; // qrcode-generator 1.4.4, MIT-Lizenz (Kazuhiko Arase)
      sc.onload = function () { resolve(); };
      sc.onerror = function () { qrLoading = null; reject(new Error('QR-Code konnte nicht geladen werden')); };
      document.head.appendChild(sc);
    });
    return qrLoading;
  }

  function drawQr() {
    var box = document.getElementById('qr');
    if (!box) return;
    var url = box.getAttribute('data-url');
    loadQrLib().then(function () {
      var qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag ? qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) : qr.createImgTag(6, 12);
    }).catch(function () { box.textContent = 'QR-Code nicht verfügbar (offline?) – Link oben nutzen.'; });
  }

  function renderShare(t) {
    var url = Sync.liveUrl(t.id);
    return '<div class="card share-card">' +
      '<div class="share-text"><h3>Live-Ansicht für Eltern & Zuschauer</h3>' +
      '<p class="muted small">Jeder mit diesem Link sieht Spielplan, Tabellen und Ergebnisse in Echtzeit – ohne Anmeldung und ohne Bearbeitungsrechte.</p>' +
      '<input type="text" id="share-url" readonly value="' + esc(url) + '">' +
      '<div class="btn-row" style="margin-top:8px"><button class="btn small primary" data-action="copy-link">Link kopieren</button>' +
      (navigator.share ? '<button class="btn small" data-action="native-share">Teilen …</button>' : '') +
      '<a class="btn small" href="' + esc(url) + '" target="_blank" rel="noopener">Öffnen</a>' +
      '<button class="btn small" data-action="share">Schließen</button></div></div>' +
      '<div class="qr" id="qr" data-url="' + esc(url) + '">QR-Code wird erstellt …</div></div>';
  }

  /* ----- Anmeldung ----- */

  function renderLogin() {
    var h = '<h1>Anmeldung Turnierleitung</h1>';
    if (!Sync.configured()) {
      return h + '<div class="banner warn">Der Online-Speicher ist noch nicht eingerichtet (Firebase-Konfiguration fehlt). Bis dahin speichert die App nur im Browser.</div>' +
        '<a class="btn" href="#/">Zurück</a>';
    }
    var u = Sync.currentUser();
    if (u) {
      return h + '<div class="card"><p>Angemeldet als <b>' + esc(u.email || '') + '</b>. Alle Turniere werden online gespeichert und auf deinen Geräten abgeglichen.</p>' +
        '<div class="btn-row"><a class="btn primary" href="#/">Zu den Turnieren</a><button class="btn danger" data-action="logout">Abmelden</button></div></div>';
    }
    return h + '<div class="card login-card"><p class="muted small">Nur für die Turnierleitung. Eltern und Zuschauer brauchen keinen Zugang – sie bekommen den Live-Link.</p>' +
      '<label class="field">E-Mail<input type="text" id="login-email" autocomplete="username" inputmode="email"></label>' +
      '<label class="field" style="margin-top:10px">Passwort<input type="password" id="login-pw" autocomplete="current-password"></label>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn primary" data-action="login">Anmelden</button><a class="btn" href="#/">Abbrechen</a></div>' +
      '<p id="login-msg" class="small sync-error" style="margin-bottom:0"></p></div>';
  }

  function syncBadge(st, id) {
    return '<span class="sync sync-' + st.state + '" data-sync-status="' + esc(id || '') + '">' + esc(st.text) + '</span>';
  }

  function updateSyncStatus(id) {
    var els = app.querySelectorAll('[data-sync-status]');
    Array.prototype.forEach.call(els, function (el) {
      var key = el.getAttribute('data-sync-status');
      var st;
      if (!key) st = Sync.globalStatus();
      else if (id === null || key === id) { var t = find(key); if (!t) return; st = Sync.statusFor(t); }
      else return;
      el.className = 'sync sync-' + st.state;
      el.textContent = st.text;
    });
  }

  function newTeamsInput(format) {
    if (format === 'multi') {
      var v = ME.SIZES.indexOf(state.newTeams) >= 0 ? state.newTeams : 32;
      return '<select id="new-teams">' + ME.SIZES.map(function (n) { return '<option value="' + n + '"' + (n === v ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>';
    }
    return '<input type="number" id="new-teams" min="' + GE.MIN_TEAMS + '" max="' + GE.MAX_TEAMS + '" value="' + (format === 'andi' ? 16 : state.newTeams) + '"' + (format === 'andi' ? ' disabled' : '') + '>';
  }

  function renderHome() {
    var list = state.tournaments.slice().sort(function (a, b) {
      return (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '');
    });
    var h = '<img class="hero" src="img/banner.jpg" alt="Sportbund Turnierplaner" width="1600" height="533">' +
      '<div class="t-head"><div><h1>Meine Turniere</h1>' +
      '<div class="muted">Liga, WM-Format, Mehrstufig oder Andi Spezial – mit Spielplan, Tabellen, K.-o.-Runde und Endstand</div></div>' +
      '<div class="btn-row"><button class="btn primary" data-action="toggle-new">+ Neues Turnier</button>' +
      '<button class="btn" data-action="import">Importieren</button></div></div>' +
      '<div class="sync-line">' + syncBadge(Sync.globalStatus(), '') +
      (Sync.configured() ? ' <a href="#/login" class="small">' + (Sync.currentUser() ? 'Abmelden' : 'Anmelden') + '</a>' : '') + '</div>';

    if (state.showNewForm) {
      h += '<div class="card" style="margin-top:16px"><h3>Neues Turnier anlegen</h3>' +
        '<div class="new-form">' +
        '<label class="field">Name<input type="text" id="new-name" placeholder="z. B. Hallenturnier U9"></label>' +
        '<label class="field">Datum<input type="date" id="new-date"></label>' +
        '<label class="field">Ort<input type="text" id="new-venue"></label>' +
        '<label class="field">Jahrgang<input type="text" id="new-age" placeholder="z. B. U9 (2018/2019)"></label>' +
        '<label class="field">Modus<select id="new-format">' + GE.FORMATS.map(function (f) {
          return '<option value="' + f.key + '"' + (f.key === state.newFormat ? ' selected' : '') + '>' + esc(f.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="field">Anzahl Teams<span id="new-teams-wrap">' + newTeamsInput(state.newFormat) + '</span></label>' +
        '</div><p class="muted small" id="new-format-desc">' + esc(GE.formatInfo(state.newFormat).desc) + '</p>' +
        '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn primary" data-action="create">Anlegen</button>' +
        '<button class="btn" data-action="toggle-new">Abbrechen</button></div></div>';
    }

    if (!list.length) {
      h += '<div class="card empty" style="margin-top:16px">Noch keine Turniere angelegt.<br>Leg mit „Neues Turnier“ los oder importiere eine Turnierdatei.</div>';
      return h;
    }
    h += '<div class="t-list">';
    list.forEach(function (t) {
      h += '<div class="card t-card">' + logoHtml(t.logo, 'card-logo') + '<h3><a href="' + tbase(t) + openTab(t) + '">' + esc(t.name) + '</a></h3>' +
        '<div class="muted small">' + esc([fmtDate(t.date), t.venue, t.ageGroup].filter(Boolean).join(' · ') || 'ohne Datum') + '</div>' +
        '<div class="muted small">' + esc(GE.formatInfo(fmt(t)).name + ' · ' + t.teams.length + ' Teams') + '</div>' +
        '<span class="status-pill">' + esc(statusText(t)) + '</span>' +
        '<div class="btn-row">' +
        '<a class="btn small" href="' + tbase(t) + firstPlayTab(t) + '">Öffnen</a>' +
        '<button class="btn small" data-action="export" data-id="' + esc(t.id) + '">Exportieren</button>' +
        '<button class="btn small" data-action="duplicate" data-id="' + esc(t.id) + '">Als Vorlage kopieren</button>' +
        '<button class="btn small danger" data-action="delete" data-id="' + esc(t.id) + '">Löschen</button>' +
        '</div></div>';
    });
    return h + '</div>';
  }

  var TABS = [
    { key: 'setup', label: 'Teams & Einstellungen' },
    { key: 'p1', label: 'Gruppenphase 1' },
    { key: 'p2', label: 'Gruppenphase 2' },
    { key: 'ko', label: 'Finalrunde' },
    { key: 'final', label: 'Endstand' },
    { key: 'info', label: 'Infos & Regeln' }
  ];

  function renderTournament(t, tab) {
    var h = '<div class="t-head"><div class="t-title">' + logoHtml(t.logo, 'tour-logo') + '<div><h1>' + esc(t.name) + '</h1><div class="muted">' +
      esc([fmtDate(t.date), t.venue, t.ageGroup].filter(Boolean).join(' · ')) + '</div></div></div>' +
      '<div class="btn-row"><button class="btn small" data-action="print">Drucken</button>' +
      (viewOnly ? '' : '<button class="btn small" data-action="export" data-id="' + esc(t.id) + '">Exportieren</button>' +
      '<a class="btn small" href="#/">Alle Turniere</a>') + '</div></div>';
    if (viewOnly) {
      h += '<div class="sync-line no-print">' + liveBadge() + '</div>';
    } else {
      h += '<div class="sync-line no-print">' + syncBadge(Sync.statusFor(t), t.id) +
        (Sync.enabled() ? ' <button class="btn small" data-action="sync-now">Jetzt speichern</button> <button class="btn small primary" data-action="share">Live-Link & QR-Code</button>'
          : Sync.configured() ? ' <a href="#/login" class="small">Anmelden, um online zu speichern</a>' : '') + '</div>';
      if (state.showShare && Sync.enabled()) h += renderShare(t);
    }

    if (isMulti(t)) return h + renderMultiTournament(t, tab);
    if (!isAndi(t)) return h + renderGenericTournament(t, tab);

    h += '<nav class="tabs">';
    TABS.forEach(function (x) {
      if (viewOnly && x.key === 'setup') return;
      var count = '';
      if (x.key === 'p1') count = TL.phaseProgress(t, 1).done + '/24';
      if (x.key === 'p2' && t.groups2) count = TL.phaseProgress(t, 2).done + '/24';
      h += '<a class="tab' + (x.key === tab ? ' active' : '') + '" href="' + tbase(t) + x.key + '">' +
        x.label + (count ? '<span class="count">' + count + '</span>' : '') + '</a>';
    });
    h += '</nav>';

    if (tab === 'p1') h += renderPhase(t, 1);
    else if (tab === 'p2') h += renderPhase(t, 2);
    else if (tab === 'ko') h += renderKo(t);
    else if (tab === 'final') h += renderFinal(t);
    else if (tab === 'info') h += renderInfo(t);
    else h += renderSetup(t);
    return h;
  }

  /* ----- Teams & Einstellungen ----- */

  function renderSetup(t) {
    var locked = TL.hasResultsWithPrefix(t, 'p1-');
    var h = '<div class="card"><h3>Turnierdaten</h3><div class="form-grid">' +
      textField('Name', 'name', t.name) +
      '<label class="field">Datum<input type="date" id="f-date" data-field="date" value="' + esc(t.date) + '"></label>' +
      textField('Ort', 'venue', t.venue) +
      textField('Jahrgang', 'ageGroup', t.ageGroup) +
      '</div>' +
      '<div class="logo-field"><span class="field-label">Turnierlogo</span>' + logoButton('tournament', t.id, t.logo, 'Turnierlogo') +
      (t.logo ? '<button class="btn small danger" data-action="remove-logo" data-target="tournament" data-id="' + esc(t.id) + '">Entfernen</button>' : '<span class="muted small">Optional – wird automatisch verkleinert.</span>') +
      '</div></div>';

    h += '<h2>Spielbetrieb</h2><div class="card"><div class="form-grid">' +
      numField('Spielfelder', 'fields', t.config.fields, 1, 8) +
      numField('Spielzeit (Minuten)', 'gameMinutes', t.config.gameMinutes, 1, 60) +
      numField('Takt pro Spielrunde (Minuten)', 'slotMinutes', t.config.slotMinutes, 1, 90) +
      '</div><p class="muted small">Takt = Spielzeit + Wechselzeit. Bei 4 Feldern laufen alle Spiele einer Runde gleichzeitig.</p>' +
      '<h3 style="margin-top:14px">Startzeiten</h3><div class="form-grid">';
    TL.TIME_SLOTS.forEach(function (s) {
      h += '<label class="field">' + esc(s.label) + '<input type="time" id="f-time-' + s.key + '" data-time="' + s.key + '" value="' + esc(t.config.times[s.key] || '') + '"></label>';
    });
    h += '</div></div>';

    h += '<h2>Teams & Gruppen (Gruppenphase 1)</h2>';
    if (locked) h += '<div class="banner info">Die Gruppenphase läuft bereits. Teamnamen kannst du weiter ändern, die Gruppeneinteilung nicht mehr.</div>';
    h += '<div class="btn-row no-print" style="margin-bottom:12px">' +
      '<button class="btn" data-action="draw"' + (locked ? ' disabled' : '') + '>Gruppen zufällig auslosen</button>' +
      '<span class="muted small">Die Reihenfolge in der Gruppe bestimmt den Spielplan (Pos. 1–4). Auf „+ Logo“ tippen, um ein Vereinslogo hochzuladen.</span></div>';
    h += '<div class="group-grid">';
    t.groups1.forEach(function (g, gi) {
      h += '<div class="card group-card"><h3>Gruppe ' + (gi + 1) + '</h3>';
      g.forEach(function (id, pi) {
        var tm = teamObj(t, id);
        h += '<div class="team-row">' + logoButton('team', id, tm.logo, 'Logo ' + tm.name) +
          '<input type="text" id="team-' + esc(id) + '" data-team="' + esc(id) + '" value="' + esc(tm.name) + '" aria-label="Gruppe ' + (gi + 1) + ' Position ' + (pi + 1) + '">' +
          (tm.logo ? '<button class="icon-btn" data-action="remove-logo" data-target="team" data-id="' + esc(id) + '" title="Logo entfernen" aria-label="Logo entfernen">✕</button>' : '') +
          '</div>';
      });
      h += '</div>';
    });
    h += '</div>';
    h += '<h2>Turnier verwalten</h2><div class="card btn-row">' +
      '<button class="btn" data-action="duplicate" data-id="' + esc(t.id) + '">Als Vorlage für neues Turnier kopieren</button>' +
      '<button class="btn danger" data-action="reset-results">Alle Ergebnisse zurücksetzen</button>' +
      '<button class="btn danger" data-action="delete" data-id="' + esc(t.id) + '">Turnier löschen</button></div>';
    return h;
  }

  function logoButton(target, id, src, label) {
    return '<button class="logo-btn' + (src ? ' has-logo' : '') + '" data-action="upload-logo" data-target="' + target + '" data-id="' + esc(id) + '" title="' + esc(src ? 'Logo ändern' : 'Logo hochladen') + '" aria-label="' + esc(label) + '">' +
      (src ? '<img src="' + esc(src) + '" alt="">' : '<span>+ Logo</span>') + '</button>';
  }

  function textField(label, key, value) {
    return '<label class="field">' + esc(label) + '<input type="text" id="f-' + key + '" data-field="' + key + '" value="' + esc(value) + '"></label>';
  }

  function numField(label, key, value, min, max) {
    return '<label class="field">' + esc(label) + '<input type="number" id="f-' + key + '" data-config="' + key + '" min="' + min + '" max="' + max + '" value="' + esc(value) + '"></label>';
  }

  /* ----- Gruppenphasen ----- */

  function renderPhase(t, phase) {
    var h = '';
    if (phase === 2 && !t.groups2) {
      var p1done = TL.isPhaseComplete(t, 1);
      h += '<div class="banner info">Die Gruppen der Phase 2 werden aus den Tabellen der Phase 1 gemischt: ' +
        'Jede neue Gruppe bekommt einen Ersten, Zweiten, Dritten und Vierten – jeweils aus einer anderen alten Gruppe. ' +
        'Punkte und Tore beginnen in Phase 2 wieder bei null.</div>';
      h += '<div class="btn-row" style="margin-bottom:14px"><button class="btn primary" data-action="lock-groups2"' + (p1done ? '' : ' disabled') + '>Gruppenphase 2 festlegen</button>' +
        (p1done ? '' : '<span class="muted small">Möglich, sobald alle 24 Spiele der Phase 1 eingetragen sind (' + TL.phaseProgress(t, 1).done + '/24).</span>') + '</div>';
      h += '<h2>' + (p1done ? 'Vorschau' : 'Vorläufige Vorschau (Stand jetzt)') + '</h2>' + renderGroupPreview(t, TL.computeGroups2(t));
      return h;
    }

    var prog = TL.phaseProgress(t, phase);
    h += '<div class="muted small">' + prog.done + ' von ' + prog.total + ' Spielen eingetragen</div>' +
      '<div class="progress"><span style="width:' + Math.round(prog.done / prog.total * 100) + '%"></span></div>';

    // Hinweis, wenn sich eine Festlegung durch Korrekturen geändert hätte
    if (phase === 1 && t.groups2 && TL.isPhaseComplete(t, 1) && !sameGroups(t.groups2, TL.computeGroups2(t))) {
      h += '<div class="banner warn" style="margin-top:12px">Durch eine Korrektur passen die Tabellen nicht mehr zu den festgelegten Gruppen der Phase 2. ' +
        '<button class="btn small" data-action="lock-groups2">Gruppenphase 2 neu festlegen</button></div>';
    }
    if (phase === 2 && t.koSeeds && TL.isPhaseComplete(t, 2) && !sameGroups(t.koSeeds, TL.computeKoSeeds(t))) {
      h += '<div class="banner warn" style="margin-top:12px">Durch eine Korrektur passen die Tabellen nicht mehr zur festgelegten Finalrunde. ' +
        '<button class="btn small" data-action="lock-ko">Finalrunde neu festlegen</button></div>';
    }

    h += '<h2>Tabellen</h2><div id="tables" class="tables-grid">' + renderTables(t, phase) + '</div>';
    h += '<p class="muted small">Platzierung: ' + esc(TL.TIEBREAK_TEXT) + '. Wertung nur innerhalb dieser Gruppenphase.</p>';

    h += '<h2>Spielplan</h2>';
    var games = TL.phaseGames(t, phase);
    var slots = {};
    games.forEach(function (g) { (slots[g.slot] = slots[g.slot] || []).push(g); });
    Object.keys(slots).forEach(function (s) {
      var list = slots[s];
      h += '<div class="slot"><div class="slot-head">' + esc(list[0].time) + ' Uhr <span class="muted">Runde ' + (parseInt(s, 10) + 1) + '</span></div><div class="games">';
      list.forEach(function (g) { h += renderGame(t, g, 'Gruppe ' + (g.group + 1)); });
      h += '</div></div>';
    });

    h += '<div class="btn-row no-print" style="margin-top:18px">';
    if (phase === 1) {
      h += t.groups2
        ? '<a class="btn primary" href="#/t/' + esc(t.id) + '/p2">Weiter zur Gruppenphase 2</a>'
        : '<button class="btn primary" data-action="lock-groups2"' + (TL.isPhaseComplete(t, 1) ? '' : ' disabled') + '>Gruppenphase 2 festlegen</button>';
    } else {
      h += t.koSeeds
        ? '<a class="btn primary" href="#/t/' + esc(t.id) + '/ko">Weiter zur Finalrunde</a>'
        : '<button class="btn primary" data-action="lock-ko"' + (TL.isPhaseComplete(t, 2) ? '' : ' disabled') + '>Finalrunde festlegen</button>';
      h += '<button class="btn danger" data-action="unlock-groups2">Festlegung Phase 2 aufheben</button>';
    }
    h += '</div>';
    return h;
  }

  function renderGroupPreview(t, groups) {
    var h = '<div class="group-grid">';
    groups.forEach(function (g, gi) {
      h += '<div class="card group-card"><h3>Gruppe ' + (gi + 1) + '</h3><ol>';
      g.forEach(function (id, rank) {
        var old = -1;
        t.groups1.forEach(function (og, ogi) { if (og.indexOf(id) >= 0) old = ogi; });
        h += '<li>' + teamHtml(t, id) + ' <span class="muted small">(' + (rank + 1) + '. Gruppe ' + (old + 1) + ')</span></li>';
      });
      h += '</ol></div>';
    });
    return h + '</div>';
  }

  function renderTables(t, phase) {
    var h = '';
    for (var g = 0; g < TL.GROUP_COUNT; g++) {
      var rows = TL.standings(t, phase, g);
      h += '<div class="card"><h3>Gruppe ' + (g + 1) + '</h3><table class="standings"><thead><tr>' +
        '<th class="l">#</th><th class="l">Team</th><th title="Spiele">Sp</th><th title="Siege-Unentschieden-Niederlagen">S-U-N</th><th>Tore</th><th title="Tordifferenz">TD</th><th>Pkt</th></tr></thead><tbody>';
      var groupDone = rows.every(function (r) { return r.sp === 3; });
      rows.forEach(function (r, i) {
        h += '<tr><td class="l">' + (i + 1) + '</td><td class="l team">' + teamHtml(t, r.team) +
          (r.note && groupDone ? '<span class="note">(' + esc(r.note) + ')</span>' : '') + '</td><td>' + r.sp + '</td><td>' +
          r.s + '-' + r.u + '-' + r.n + '</td><td>' + r.gf + ':' + r.ga + '</td><td>' + (r.td > 0 ? '+' : '') + r.td +
          '</td><td class="pts">' + r.pts + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    return h;
  }

  function sideHtml(t, id, label) {
    return id ? teamHtml(t, id) : '<span class="placeholder">' + esc(label) + '</span>';
  }

  function renderGame(t, g, metaLabel, isKo) {
    var r = TL.getResult(t, g.id) || {};
    var ready = !!(g.home && g.away);
    var done = TL.isPlayed(r);
    var dis = ready ? '' : ' disabled';
    if (viewOnly) {
      var pen = isKo && done && r.h === r.a && r.pen ? '<div class="pen">Sieger im Neunmeterschießen: ' + esc(TL.teamName(t, r.pen === 'h' ? g.home : g.away)) + '</div>' : '';
      return '<div class="game' + (done ? ' done' : '') + '">' +
        '<div class="meta"><b>Spiel ' + g.no + '</b><span>Feld ' + g.field + '</span><span>' + esc(isKo ? g.time + ' Uhr' : metaLabel) + '</span></div>' +
        '<div class="home">' + sideHtml(t, g.home, g.homeLabel) + '</div>' +
        '<div class="score score-ro"><span>' + (done ? r.h : '–') + '</span><span class="sep">:</span><span>' + (done ? r.a : '–') + '</span></div>' +
        '<div class="away">' + sideHtml(t, g.away, g.awayLabel) + '</div>' + pen + '</div>';
    }
    var h = '<div class="game' + (done ? ' done' : '') + '">' +
      '<div class="meta"><b>Spiel ' + g.no + '</b><span>Feld ' + g.field + '</span><span>' + esc(isKo ? g.time + ' Uhr' : metaLabel) + '</span></div>' +
      '<div class="home">' + sideHtml(t, g.home, g.homeLabel) + '</div>' +
      '<div class="score">' +
      '<input type="text" inputmode="numeric" autocomplete="off" maxlength="2" id="s-' + g.id + '-h" data-game="' + g.id + '" data-side="h" value="' + (r.h != null ? r.h : '') + '"' + dis + ' aria-label="Tore Heim">' +
      '<span class="sep">:</span>' +
      '<input type="text" inputmode="numeric" autocomplete="off" maxlength="2" id="s-' + g.id + '-a" data-game="' + g.id + '" data-side="a" value="' + (r.a != null ? r.a : '') + '"' + dis + ' aria-label="Tore Gast">' +
      '</div>' +
      '<div class="away">' + sideHtml(t, g.away, g.awayLabel) + '</div>';
    if (isKo && done && r.h === r.a) {
      h += '<div class="pen">Unentschieden – Sieger im Neunmeterschießen: <select id="pen-' + g.id + '" data-pen="' + g.id + '">' +
        '<option value="">bitte wählen</option>' +
        '<option value="h"' + (r.pen === 'h' ? ' selected' : '') + '>' + esc(TL.teamName(t, g.home)) + '</option>' +
        '<option value="a"' + (r.pen === 'a' ? ' selected' : '') + '>' + esc(TL.teamName(t, g.away)) + '</option></select></div>';
    }
    return h + '</div>';
  }

  /* ----- Finalrunde ----- */

  var KO_SECTIONS = [
    { round: 'vf', title: 'Viertelfinale' },
    { round: 'q', title: 'Qualifikation Platz 9–16' },
    { round: 'hf', title: 'Halbfinale & kleines Halbfinale' },
    { round: 'pl', title: 'Platzierungsspiele 9–16' },
    { round: 'f', title: 'Finale & Spiele um Platz 3–8' }
  ];

  function renderKo(t) {
    var h = '';
    if (!t.koSeeds) {
      var ok = t.groups2 && TL.isPhaseComplete(t, 2);
      h += '<div class="banner info">Die Finalrunde wird aus den Tabellen der Gruppenphase 2 gebildet: ' +
        'Gruppenerste und -zweite spielen über Kreuz Viertelfinale (1. G1 – 2. G3, 1. G3 – 2. G1, 1. G2 – 2. G4, 1. G4 – 2. G2). ' +
        'Dritte und Vierte spielen die Plätze 9–16 aus.</div>' +
        '<div class="btn-row" style="margin-bottom:14px"><button class="btn primary" data-action="lock-ko"' + (ok ? '' : ' disabled') + '>Finalrunde festlegen</button>' +
        (ok ? '' : '<span class="muted small">Möglich, sobald die Gruppenphase 2 komplett ist.</span>') + '</div>';
    } else {
      h += '<p class="muted small">Unentschieden in der Finalrunde: Ergebnis eintragen und den Sieger des Neunmeterschießens auswählen.</p>';
    }
    var games = TL.koGames(t);
    KO_SECTIONS.forEach(function (sec) {
      var list = games.filter(function (g) { return g.round === sec.round; });
      h += '<div class="slot"><h2>' + esc(sec.title) + ' <span class="muted small">ab ' + esc(list[0].time) + ' Uhr</span></h2><div class="games">';
      list.forEach(function (g) {
        h += '<div class="ko-label">' + esc(g.label) + '</div>' + renderGame(t, g, '', true);
      });
      h += '</div></div>';
    });
    if (t.koSeeds) h += '<div class="btn-row no-print" style="margin-top:18px"><a class="btn primary" href="#/t/' + esc(t.id) + '/final">Zum Endstand</a>' +
      '<button class="btn danger" data-action="unlock-ko">Festlegung Finalrunde aufheben</button></div>';
    return h;
  }

  /* ----- Endstand ----- */

  function renderFinal(t) {
    var ranking = TL.finalRanking(t);
    var h = '<img class="hero hero-final" src="img/banner.jpg" alt="Sportbund Turnierplaner" width="1600" height="533">' +
      '<h2 style="margin-top:0">Endstand</h2><ol class="ranking">';
    ranking.forEach(function (r) {
      h += '<li class="p' + r.place + '"><span class="place">' + r.place + '</span>' +
        (r.team ? teamHtml(t, r.team) : '<span class="open">noch offen</span>') + '</li>';
    });
    return h + '</ol>';
  }

  /* ----- Infos & Regeln ----- */

  function renderInfo(t) {
    var h = '<div class="card"><dl class="info">' +
      '<dt>Jahrgang</dt><dd>' + esc(t.ageGroup || '–') + '</dd>' +
      '<dt>Modus</dt><dd>' + esc(GE.formatInfo(fmt(t)).name) + '</dd>' +
      '<dt>Teams</dt><dd>' + (isAndi(t) ? '16 (4 Gruppen à 4)' : isMulti(t) ? t.teams.length + '</dd><dt>Ablauf</dt><dd>' + esc(ME.structureText(t)) : t.teams.length + (fmt(t) === 'groups' ? ' (' + t.groups.map(function (g) { return g.length; }).join(' + ') + ')' : '') + (fmt(t) === 'league' && t.config.double ? ', Hin- und Rückrunde' : '')) + '</dd>' +
      '<dt>Spielfelder</dt><dd>' + (isMulti(t) ? esc(ME.locations(t).map(function (l) { return l.name + ': ' + l.fields; }).join(' · ')) : esc(t.config.fields)) + '</dd>' +
      '<dt>Spielzeit</dt><dd>' + esc(t.config.gameMinutes) + ' min</dd>' +
      '<dt>Platzierung</dt><dd>' + esc(TL.TIEBREAK_TEXT) + (isAndi(t) ? ' (je Gruppenphase getrennt)' : '') + '</dd>' +
      (!isAndi(t) && !isMulti(t) && GE.hasKo(t) ? '<dt>K.-o.-Runde</dt><dd>' + esc(planText(t)) + '</dd>' : '') +
      '</dl></div>';
    h += '<h2>Ablauf / Zeitplan</h2><div class="card"><dl class="info">';
    (isAndi(t) ? TL.timetable(t) : isMulti(t) ? ME.timetable(t) : GE.timetable(t)).forEach(function (r) { h += '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.value || '–') + '</dd>'; });
    h += '</dl><p class="muted small">Wird automatisch aus den Startzeiten und dem Takt berechnet.</p></div>';

    if (viewOnly) {
      h += '<h2>Spielregeln</h2><div class="card"><dl class="info">';
      t.info.forEach(function (row) { h += '<dt>' + esc(row.label) + '</dt><dd>' + esc(row.value) + '</dd>'; });
      return h + '</dl></div>';
    }
    h += '<h2>Spielregeln</h2><div class="card">';
    t.info.forEach(function (row, i) {
      h += '<div class="rule-row"><input type="text" id="rl-' + i + '" data-rule="' + i + '" data-key="label" value="' + esc(row.label) + '" aria-label="Regel">' +
        '<input type="text" id="rv-' + i + '" data-rule="' + i + '" data-key="value" value="' + esc(row.value) + '" aria-label="Beschreibung">' +
        '<button class="btn small danger" data-action="rule-del" data-i="' + i + '" aria-label="Regel entfernen">✕</button></div>';
    });
    h += '<div class="btn-row" style="margin-top:8px"><button class="btn small" data-action="rule-add">+ Regel hinzufügen</button></div></div>';
    return h;
  }

  /* ===== Liga & WM-Format ===== */

  function genericTabs(t) {
    var pg = GE.stageProgress(t);
    var tabs = [
      { key: 'setup', label: 'Teams & Einstellungen' },
      { key: 'spiele', label: fmt(t) === 'league' ? 'Liga' : 'Gruppenphase', count: pg.done + '/' + pg.total }
    ];
    if (GE.hasKo(t)) tabs.push({ key: 'ko', label: 'K.-o.-Runde' });
    tabs.push({ key: 'final', label: 'Endstand' }, { key: 'info', label: 'Infos & Regeln' });
    return tabs;
  }

  function renderGenericTournament(t, tab) {
    var h = '<nav class="tabs">';
    genericTabs(t).forEach(function (x) {
      if (viewOnly && x.key === 'setup') return;
      h += '<a class="tab' + (x.key === tab ? ' active' : '') + '" href="' + tbase(t) + x.key + '">' +
        x.label + (x.count ? '<span class="count">' + x.count + '</span>' : '') + '</a>';
    });
    h += '</nav>';
    if (tab === 'spiele') return h + renderGStage(t);
    if (tab === 'ko' && GE.hasKo(t)) return h + renderGKo(t);
    if (tab === 'final') return h + renderGFinal(t);
    if (tab === 'info') return h + renderInfo(t);
    return h + renderGSetup(t);
  }

  function planText(t) {
    var plan = GE.koPlan(t);
    if (fmt(t) === 'league') {
      return plan.size ? 'Die besten ' + plan.size + ' der Tabelle spielen K.-o. (1. gegen ' + plan.size + '., 2. gegen ' + (plan.size - 1) + '. …).' : 'Ohne K.-o.-Runde: Die Tabelle ist der Endstand.';
    }
    if (plan.size < 2) return 'Zu wenige Teams für eine K.-o.-Runde.';
    var adv = t.config.advance;
    var txt = 'K.-o.-Runde mit ' + plan.size + ' Teams: die ersten ' + adv + ' jeder Gruppe';
    if (plan.fill) txt += ' plus die ' + plan.fill + ' besten Gruppen-' + (adv + 1) + '.';
    else txt += '.';
    if (plan.cut) txt += ' Achtung: ' + plan.cut + ' Gruppen-Qualifikant(en) passen nicht in den Baum – die schwächsten scheiden aus.';
    return txt;
  }

  function renderGSetup(t) {
    var locked = GE.hasResults(t);
    var dis = locked ? ' disabled' : '';
    var f = fmt(t);
    var h = '<div class="card"><h3>Turnierdaten</h3><div class="form-grid">' +
      textField('Name', 'name', t.name) +
      '<label class="field">Datum<input type="date" id="f-date" data-field="date" value="' + esc(t.date) + '"></label>' +
      textField('Ort', 'venue', t.venue) +
      textField('Jahrgang', 'ageGroup', t.ageGroup) +
      '</div>' +
      '<div class="logo-field"><span class="field-label">Turnierlogo</span>' + logoButton('tournament', t.id, t.logo, 'Turnierlogo') +
      (t.logo ? '<button class="btn small danger" data-action="remove-logo" data-target="tournament" data-id="' + esc(t.id) + '">Entfernen</button>' : '<span class="muted small">Optional – wird automatisch verkleinert.</span>') +
      '</div></div>';

    h += '<h2>Modus: ' + esc(GE.formatInfo(f).name) + '</h2><div class="card">';
    if (locked) h += '<div class="banner info">Es sind schon Ergebnisse eingetragen – Teamanzahl, Gruppen und Modus-Einstellungen sind gesperrt. Teamnamen und Logos kannst du weiter ändern.</div>';
    h += '<div class="form-grid">' +
      '<label class="field">Anzahl Teams<input type="number" id="g-teamCount" data-gstruct="teamCount" min="' + GE.MIN_TEAMS + '" max="' + GE.MAX_TEAMS + '" value="' + t.teams.length + '"' + dis + '></label>';
    if (f === 'groups') {
      h += '<label class="field">Anzahl Gruppen<input type="number" id="g-groupCount" data-gstruct="groupCount" min="1" max="' + Math.max(1, Math.floor(t.teams.length / 2)) + '" value="' + t.groups.length + '"' + dis + '></label>' +
        '<label class="field">Weiter pro Gruppe<input type="number" id="g-advance" data-gconf="advance" min="1" max="' + GE.GROUP_MAX + '" value="' + esc(t.config.advance) + '"' + dis + '></label>';
    } else {
      h += '<label class="field">K.-o.-Runde<select id="g-koSize" data-gconf="koSize"' + dis + '>' +
        [[0, 'Keine'], [2, 'Finale (Top 2)'], [4, 'Halbfinale (Top 4)'], [8, 'Viertelfinale (Top 8)'], [16, 'Achtelfinale (Top 16)']].filter(function (o) { return o[0] <= t.teams.length; }).map(function (o) {
          return '<option value="' + o[0] + '"' + (String(t.config.koSize) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>' +
        '<label class="field check"><span>Hin- und Rückrunde</span><input type="checkbox" id="g-double" data-gconf="double"' + (t.config.double ? ' checked' : '') + dis + '></label>';
    }
    if (GE.hasKo(t)) {
      h += '<label class="field">Platzierungsspiele<select id="g-placement" data-gconf="placement"' + (t.koSeeds && GE.hasResults(t) && Object.keys(t.results).some(function (k) { return k.indexOf('ko') === 0; }) ? ' disabled' : '') + '>' +
        GE.PLACEMENTS.map(function (p) { return '<option value="' + p.key + '"' + (t.config.placement === p.key ? ' selected' : '') + '>' + p.label + '</option>'; }).join('') + '</select></label>';
    }
    h += '</div><p class="muted small" style="margin-bottom:0">' + esc(planText(t)) + ' Spiele insgesamt: ' + (GE.stageGames(t).length + (GE.hasKo(t) ? GE.koDefs(t).length : 0)) + '.</p></div>';

    h += '<h2>Spielbetrieb</h2><div class="card"><div class="form-grid">' +
      numField('Spielfelder', 'fields', t.config.fields, 1, 16) +
      numField('Spielzeit (Minuten)', 'gameMinutes', t.config.gameMinutes, 1, 90) +
      numField('Takt pro Spielrunde (Minuten)', 'slotMinutes', t.config.slotMinutes, 1, 120) +
      numField('Pause vor K.-o.-Runde (Minuten)', 'pauseMinutes', t.config.pauseMinutes, 0, 240) +
      '</div><p class="muted small">Takt = Spielzeit + Wechselzeit. Die Spiele werden automatisch auf die Felder verteilt – möglichst ohne zwei Spiele eines Teams direkt hintereinander.</p>' +
      '<h3 style="margin-top:14px">Zeiten</h3><div class="form-grid">' +
      '<label class="field">Turnierbeginn<input type="time" id="f-time-start" data-time="start" value="' + esc(t.config.times.start || '') + '"></label>' +
      (GE.hasKo(t) ? '<label class="field">Beginn K.-o.-Runde (leer = automatisch)<input type="time" id="f-time-ko" data-time="ko" value="' + esc(t.config.times.ko || '') + '"></label>' : '') +
      '<label class="field">Siegerehrung (optional)<input type="time" id="f-time-ceremony" data-time="ceremony" value="' + esc(t.config.times.ceremony || '') + '"></label>' +
      '</div></div>';

    h += '<h2>' + (f === 'league' ? 'Teams' : 'Teams & Gruppen') + '</h2>';
    var warns = GE.groupWarnings(t);
    if (warns.length) h += '<div class="banner warn">' + warns.map(esc).join('<br>') + '</div>';
    if (f === 'groups') {
      h += '<div class="btn-row no-print" style="margin-bottom:12px">' +
        '<button class="btn" data-action="gdraw"' + dis + '>Gruppen zufällig auslosen</button>' +
        '<span class="muted small">Oder von Hand: bei jedem Team die Gruppe auswählen. „+ Logo“ antippen für ein Vereinslogo.</span></div>';
    } else {
      h += '<p class="muted small">„+ Logo“ antippen, um ein Vereinslogo hochzuladen.</p>';
    }
    h += '<div class="group-grid">';
    t.groups.forEach(function (g, gi) {
      h += '<div class="card group-card"><h3>' + (f === 'league' ? 'Teams' : esc(GE.groupName(gi)) + ' <span class="muted small">(' + g.length + ')</span>') + '</h3>';
      g.forEach(function (id) {
        var tm = teamObj(t, id);
        h += '<div class="team-row">' + logoButton('team', id, tm.logo, 'Logo ' + tm.name) +
          '<input type="text" id="team-' + esc(id) + '" data-team="' + esc(id) + '" value="' + esc(tm.name) + '" aria-label="Teamname">' +
          (f === 'groups' ? '<select class="move" id="mv-' + esc(id) + '" data-move="' + esc(id) + '" aria-label="Gruppe"' + dis + '>' +
            t.groups.map(function (_, k) { return '<option value="' + k + '"' + (k === gi ? ' selected' : '') + '>' + String.fromCharCode(65 + k) + '</option>'; }).join('') + '</select>' : '') +
          (tm.logo ? '<button class="icon-btn" data-action="remove-logo" data-target="team" data-id="' + esc(id) + '" title="Logo entfernen" aria-label="Logo entfernen">✕</button>' : '') +
          '</div>';
      });
      h += '</div>';
    });
    h += '</div>';
    h += '<h2>Turnier verwalten</h2><div class="card btn-row">' +
      '<button class="btn" data-action="duplicate" data-id="' + esc(t.id) + '">Als Vorlage für neues Turnier kopieren</button>' +
      '<button class="btn danger" data-action="reset-results">Alle Ergebnisse zurücksetzen</button>' +
      '<button class="btn danger" data-action="delete" data-id="' + esc(t.id) + '">Turnier löschen</button></div>';
    return h;
  }

  function renderGTables(t) {
    var plan = GE.koPlan(t);
    var h = '';
    GE.allStandings(t).forEach(function (st, g) {
      var title = fmt(t) === 'league' ? 'Tabelle' : GE.groupName(g);
      var qual = fmt(t) === 'league' ? plan.size : (plan.size ? Math.min(t.config.advance, st.rows.length) : 0);
      h += '<div class="card' + (fmt(t) === 'league' ? ' wide' : '') + '">' + (fmt(t) === 'league' ? '' : '<h3>' + esc(title) + '</h3>') + '<table class="standings"><thead><tr>' +
        '<th class="l">#</th><th class="l">Team</th><th title="Spiele">Sp</th><th title="Siege-Unentschieden-Niederlagen">S-U-N</th><th>Tore</th><th title="Tordifferenz">TD</th><th>Pkt</th></tr></thead><tbody>';
      st.rows.forEach(function (r, i) {
        var cls = i < qual ? ' class="q"' : (plan.fill && i === t.config.advance && fmt(t) === 'groups' ? ' class="q-maybe"' : '');
        h += '<tr' + cls + '><td class="l">' + (i + 1) + '</td><td class="l team">' + teamHtml(t, r.team) +
          (r.note && st.complete ? '<span class="note">(' + esc(r.note) + ')</span>' : '') + '</td><td>' + r.sp + '</td><td>' +
          r.s + '-' + r.u + '-' + r.n + '</td><td>' + r.gf + ':' + r.ga + '</td><td>' + (r.td > 0 ? '+' : '') + r.td +
          '</td><td class="pts">' + r.pts + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });
    return h;
  }

  function renderGStage(t) {
    var games = GE.stageGames(t);
    var prog = GE.stageProgress(t, games);
    var complete = prog.done === prog.total && prog.total > 0;
    var h = '<div class="muted small">' + prog.done + ' von ' + prog.total + ' Spielen eingetragen</div>' +
      '<div class="progress"><span style="width:' + Math.round(prog.done / Math.max(1, prog.total) * 100) + '%"></span></div>';
    if (t.koSeeds && complete && !sameGroups(t.koSeeds, GE.computeKoSeeds(t))) {
      h += '<div class="banner warn" style="margin-top:12px">Durch eine Korrektur passen die Tabellen nicht mehr zur festgelegten K.-o.-Runde. ' +
        '<button class="btn small" data-action="lock-ko">K.-o.-Runde neu festlegen</button></div>';
    }
    h += '<h2>' + (fmt(t) === 'league' ? 'Tabelle' : 'Tabellen') + '</h2><div id="tables" class="tables-grid">' + renderGTables(t) + '</div>';
    h += '<p class="muted small">Platzierung: ' + esc(TL.TIEBREAK_TEXT) + '.' + (GE.hasKo(t) ? ' Grün markiert = K.-o.-Runde' + (GE.koPlan(t).fill ? ', gelb = Chance als bester Nachrücker' : '') + '.' : '') + '</p>';

    h += '<h2>Spielplan</h2>';
    var slots = {};
    games.forEach(function (g) { (slots[g.slot] = slots[g.slot] || []).push(g); });
    Object.keys(slots).forEach(function (s) {
      var list = slots[s];
      h += '<div class="slot"><div class="slot-head">' + esc(list[0].time) + ' Uhr <span class="muted">Runde ' + (parseInt(s, 10) + 1) + '</span></div><div class="games">';
      list.forEach(function (g) { h += renderGame(t, g, g.groupLabel); });
      h += '</div></div>';
    });

    h += '<div class="btn-row no-print" style="margin-top:18px">';
    if (GE.hasKo(t)) {
      h += t.koSeeds
        ? '<a class="btn primary" href="#/t/' + esc(t.id) + '/ko">Weiter zur K.-o.-Runde</a>'
        : '<button class="btn primary" data-action="lock-ko"' + (complete ? '' : ' disabled') + '>K.-o.-Runde festlegen</button>';
    } else {
      h += '<a class="btn primary" href="#/t/' + esc(t.id) + '/final">Zum Endstand</a>';
    }
    h += '</div>';
    return h;
  }

  function renderGKo(t) {
    var h = '';
    if (!t.koSeeds) {
      var ok = GE.stageComplete(t);
      h += '<div class="banner info">' + esc(planText(t)) + ' Gesetzt wird nach Gruppenplatz, dann nach Punkten, Tordifferenz und Toren pro Spiel – Setzplatz 1 trifft auf den letzten Setzplatz. Teams aus derselben Gruppe treffen in der ersten Runde möglichst nicht aufeinander.</div>' +
        '<div class="btn-row" style="margin-bottom:14px"><button class="btn primary" data-action="lock-ko"' + (ok ? '' : ' disabled') + '>K.-o.-Runde festlegen</button>' +
        (ok ? '' : '<span class="muted small">Möglich, sobald alle Spiele der ' + (fmt(t) === 'league' ? 'Liga' : 'Gruppenphase') + ' eingetragen sind.</span>') + '</div>';
    } else {
      h += '<p class="muted small">Unentschieden: Ergebnis eintragen und den Sieger des Neunmeterschießens auswählen.</p>';
    }
    GE.koSections(t, GE.koGames(t)).forEach(function (sec) {
      h += '<div class="slot"><h2>' + esc(sec.title) + ' <span class="muted small">ab ' + esc(sec.games[0].time) + ' Uhr</span></h2><div class="games">';
      sec.games.forEach(function (g) { h += '<div class="ko-label">' + esc(g.label) + '</div>' + renderGame(t, g, '', true); });
      h += '</div></div>';
    });
    if (t.koSeeds) h += '<div class="btn-row no-print" style="margin-top:18px"><a class="btn primary" href="#/t/' + esc(t.id) + '/final">Zum Endstand</a>' +
      '<button class="btn danger" data-action="unlock-ko">Festlegung K.-o.-Runde aufheben</button></div>';
    return h;
  }

  function renderGFinal(t) {
    var fr = GE.finalRanking(t);
    var h = '<img class="hero hero-final" src="img/banner.jpg" alt="Sportbund Turnierplaner" width="1600" height="533">' +
      '<h2 style="margin-top:0">Endstand</h2>';
    if (fr.provisional) h += '<div class="banner info">Vorläufig – es sind noch nicht alle Spiele eingetragen.</div>';
    h += '<ol class="ranking">';
    fr.places.forEach(function (r) {
      h += '<li class="p' + r.place + '"><span class="place">' + r.place + '</span>' +
        (r.team ? teamHtml(t, r.team) : '<span class="open">noch offen</span>') + '</li>';
    });
    return h + '</ol>';
  }

  /* ===== Mehrstufig ===== */

  var BRANCH_CLASS = { r1: 'r1', gold: 'gold', silver: 'silver', bronze: 'bronze', cl: 'cl', el: 'el', conf: 'conf' };

  function branchBadge(key) {
    return '<span class="branch-badge b-' + BRANCH_CLASS[key] + '">' + esc(ME.BRANCHES[key].name) + '</span>';
  }

  function multiTabs(t, tl) {
    var tabs = [{ key: 'setup', label: 'Teams & Einstellungen' }];
    ME.rounds(t).forEach(function (r) {
      var p = ME.roundProgress(t, r, tl);
      tabs.push({ key: 'r' + r, label: 'Runde ' + r, count: (r === 1 || t.stages[r]) ? p.done + '/' + p.total : '' });
    });
    tabs.push({ key: 'po', label: 'Playoffs' }, { key: 'final', label: 'Endstand' }, { key: 'info', label: 'Infos & Regeln' });
    return tabs;
  }

  function renderMultiTournament(t, tab) {
    var tl = ME.timeline(t);
    var h = '<nav class="tabs">';
    multiTabs(t, tl).forEach(function (x) {
      if (viewOnly && x.key === 'setup') return;
      h += '<a class="tab' + (x.key === tab ? ' active' : '') + '" href="' + tbase(t) + x.key + '">' +
        x.label + (x.count ? '<span class="count">' + x.count + '</span>' : '') + '</a>';
    });
    h += '</nav>';
    var m = /^r([123])$/.exec(tab);
    if (m && ME.rounds(t).indexOf(+m[1]) >= 0) return h + renderMRound(t, +m[1], tl);
    if (tab === 'po') return h + renderMPo(t, tl);
    if (tab === 'final') return h + renderMFinal(t);
    if (tab === 'info') return h + renderInfo(t);
    return h + renderMSetup(t);
  }

  function multiLoc(t) { return ME.locations(t).length > 1; }

  function slotHead(t, g) {
    var parts = [];
    if (g.date) parts.push(ME.fmtDate(g.date));
    parts.push(g.time + ' Uhr');
    var h = esc(parts.join(' · '));
    if (multiLoc(t)) h += ' <span class="muted">' + esc(ME.locById(t, g.loc).name) + '</span>';
    return h;
  }

  function gamesBySlot(t, games, meta) {
    var h = '', key = null;
    games.forEach(function (g) {
      var k = g.date + '|' + g.time + '|' + g.loc;
      if (k !== key) {
        if (key !== null) h += '</div></div>';
        h += '<div class="slot"><div class="slot-head">' + slotHead(t, g) + '</div><div class="games">';
        key = k;
      }
      if (g.isKo) h += '<div class="ko-label">' + esc(g.label) + '</div>';
      h += renderGame(t, g, meta(g), !!g.isKo);
    });
    if (key !== null) h += '</div></div>';
    return h;
  }

  function renderMTables(t, r, branch, tl) {
    var groups = ME.groupsOf(t, r, branch);
    var h = '';
    groups.forEach(function (_, g) {
      var st = ME.standings(t, r, branch, g, tl);
      h += '<div class="card"><h3>Gruppe ' + ME.groupLetter(g) + '</h3><table class="standings"><thead><tr>' +
        '<th class="l">#</th><th class="l">Team</th><th title="Spiele">Sp</th><th title="Siege-Unentschieden-Niederlagen">S-U-N</th><th>Tore</th><th title="Tordifferenz">TD</th><th>Pkt</th></tr></thead><tbody>';
      st.rows.forEach(function (row, i) {
        h += '<tr><td class="l">' + (i + 1) + '</td><td class="l team">' + teamHtml(t, row.team) +
          (row.note && st.complete ? '<span class="note">(' + esc(row.note) + ')</span>' : '') + '</td><td>' + row.sp + '</td><td>' +
          row.s + '-' + row.u + '-' + row.n + '</td><td>' + row.gf + ':' + row.ga + '</td><td>' + (row.td > 0 ? '+' : '') + row.td +
          '</td><td class="pts">' + row.pts + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });
    return h;
  }

  function renderMRound(t, r, tl) {
    var h = '';
    var last = ME.rounds(t)[ME.rounds(t).length - 1];
    if (r > 1 && !t.stages[r]) {
      var ready = ME.roundComplete(t, r - 1, tl);
      h += '<div class="banner info">Die Gruppen der Runde ' + r + ' werden aus den Tabellen der Runde ' + (r - 1) + ' gebildet – gesetzt nach Leistung im Schlangenverfahren, ' +
        'Teams aus derselben Gruppe der Vorrunde treffen möglichst nicht wieder aufeinander. Punkte und Tore beginnen wieder bei null.</div>' +
        '<div class="btn-row" style="margin-bottom:14px"><button class="btn primary" data-action="mlock" data-round="' + r + '"' + (ready ? '' : ' disabled') + '>Runde ' + r + ' festlegen</button>' +
        (ready ? '' : '<span class="muted small">Möglich, sobald alle Spiele der Runde ' + (r - 1) + ' eingetragen sind.</span>') + '</div>';
      if (ready) {
        var preview = ME.computeStage(t, r, tl);
        h += '<h2>Vorschau</h2>';
        ME.branchesOf(t, r).forEach(function (b) {
          h += '<h3 class="branch-title">' + branchBadge(b.key) + '</h3><div class="group-grid" style="margin-bottom:14px">';
          preview[b.key].forEach(function (grp, gi) {
            h += '<div class="card group-card"><h3>Gruppe ' + ME.groupLetter(gi) + '</h3><ol>' +
              grp.map(function (id) { return '<li>' + teamHtml(t, id) + '</li>'; }).join('') + '</ol></div>';
          });
          h += '</div>';
        });
      }
      return h;
    }
    var prog = ME.roundProgress(t, r, tl);
    h += '<div class="muted small" id="mprog-text">' + prog.done + ' von ' + prog.total + ' Spielen eingetragen</div>' +
      '<div class="progress"><span id="mprog-bar" style="width:' + Math.round(prog.done / Math.max(1, prog.total) * 100) + '%"></span></div>';
    var branches = ME.branchesOf(t, r);
    if (branches.length > 1) {
      h += '<div class="btn-row no-print branch-jump">' + branches.map(function (b) { return '<a class="btn small" href="#" data-action="jump" data-target="br-' + b.key + '">' + esc(ME.BRANCHES[b.key].name) + '</a>'; }).join('') + '</div>';
    }
    branches.forEach(function (b) {
      var games = tl.filter(function (g) { return g.round === r && g.branch === b.key && !g.isKo; });
      if (b.key !== 'r1') h += '<h2 id="br-' + b.key + '" class="branch-title">' + branchBadge(b.key) + (multiLoc(t) ? ' <span class="muted small">' + esc(ME.locById(t, t.config.place[b.key]).name) + '</span>' : '') + '</h2>';
      h += '<div class="tables-grid" data-mtables="' + r + '-' + b.key + '">' + renderMTables(t, r, b.key, tl) + '</div>';
      h += '<h3 style="margin-top:16px">Spielplan' + (b.key === 'r1' ? '' : ' ' + esc(ME.BRANCHES[b.key].name)) + '</h3>';
      h += gamesBySlot(t, games, function (g) { return 'Gruppe ' + ME.groupLetter(g.group); });
    });
    h += '<p class="muted small">Platzierung: ' + esc(TL.TIEBREAK_TEXT) + '. Wertung nur innerhalb dieser Runde.</p>';
    h += '<div class="btn-row no-print" style="margin-top:18px">';
    if (r < last) {
      h += t.stages[r + 1]
        ? '<a class="btn primary" href="#/t/' + esc(t.id) + '/r' + (r + 1) + '">Weiter zu Runde ' + (r + 1) + '</a>'
        : '<button class="btn primary" data-action="mlock" data-round="' + (r + 1) + '" data-next="1"' + (ME.roundComplete(t, r, tl) ? '' : ' disabled') + '>Runde ' + (r + 1) + ' festlegen</button>';
    } else {
      h += '<a class="btn primary" href="#/t/' + esc(t.id) + '/po">Weiter zu den Playoffs</a>';
    }
    if (r > 1) h += '<button class="btn danger" data-action="munlock" data-round="' + r + '">Festlegung Runde ' + r + ' aufheben</button>';
    h += '</div>';
    return h;
  }

  function renderMPo(t, tl) {
    var last = ME.rounds(t)[ME.rounds(t).length - 1];
    var h = '<p class="muted small">Jede Leistungsgruppe startet ihre Playoffs, sobald ihre Gruppenspiele fertig sind. Unentschieden: Ergebnis eintragen und den Sieger des Neunmeterschießens auswählen.</p>';
    var offset = 0;
    ME.poBranches(t).forEach(function (b) {
      var size = ME.poSize(t, b);
      h += '<h2 class="branch-title">' + branchBadge(b) + ' <span class="muted small">Gesamtplätze ' + (offset + 1) + '–' + (offset + size) + (multiLoc(t) ? ' · ' + esc(ME.locById(t, t.config.place[b]).name) : '') + '</span></h2>';
      offset += size;
      if (!t.po[b]) {
        var ready = ME.branchComplete(t, last, b, tl);
        h += '<div class="btn-row" style="margin-bottom:10px"><button class="btn primary" data-action="mpo-lock" data-branch="' + b + '"' + (ready ? '' : ' disabled') + '>Playoffs ' + esc(ME.BRANCHES[b].name) + ' festlegen</button>' +
          (ready ? '' : '<span class="muted small">Möglich, sobald alle Gruppenspiele ' + esc(ME.BRANCHES[b].name) + ' in Runde ' + last + ' eingetragen sind.</span>') + '</div>';
      }
      var games = tl.filter(function (g) { return g.isKo && g.branch === b; });
      h += gamesBySlot(t, games, function () { return ''; });
      if (t.po[b]) h += '<div class="btn-row no-print" style="margin:8px 0 18px"><button class="btn small danger" data-action="mpo-unlock" data-branch="' + b + '">Festlegung Playoffs ' + esc(ME.BRANCHES[b].name) + ' aufheben</button></div>';
    });
    h += '<div class="btn-row no-print" style="margin-top:18px"><a class="btn primary" href="#/t/' + esc(t.id) + '/final">Zum Endstand</a></div>';
    return h;
  }

  function renderMFinal(t) {
    var fr = ME.finalRanking(t);
    var h = '<img class="hero hero-final" src="img/banner.jpg" alt="Sportbund Turnierplaner" width="1600" height="533">' +
      '<h2 style="margin-top:0">Endstand</h2>';
    var current = null;
    fr.places.forEach(function (p) {
      if (p.branch !== current) {
        if (current !== null) h += '</ol>';
        h += '<h3 class="branch-title" style="margin-top:16px">' + branchBadge(p.branch) + '</h3><ol class="ranking">';
        current = p.branch;
      }
      h += '<li class="p' + p.place + '"><span class="place">' + p.place + '</span>' +
        (p.team ? teamHtml(t, p.team) : '<span class="open">noch offen</span>') + '</li>';
    });
    return h + '</ol>';
  }

  function renderMSetup(t) {
    var locked = GE.hasResults(t);
    var dis = locked ? ' disabled' : '';
    var h = '<div class="card"><h3>Turnierdaten</h3><div class="form-grid">' +
      textField('Name', 'name', t.name) +
      '<label class="field">Datum<input type="date" id="f-date" data-field="date" value="' + esc(t.date) + '"></label>' +
      textField('Ort', 'venue', t.venue) +
      textField('Jahrgang', 'ageGroup', t.ageGroup) +
      '</div>' +
      '<div class="logo-field"><span class="field-label">Turnierlogo</span>' + logoButton('tournament', t.id, t.logo, 'Turnierlogo') +
      (t.logo ? '<button class="btn small danger" data-action="remove-logo" data-target="tournament" data-id="' + esc(t.id) + '">Entfernen</button>' : '<span class="muted small">Optional – wird automatisch verkleinert.</span>') +
      '</div></div>';

    h += '<h2>Modus: Mehrstufig</h2><div class="card">';
    if (locked) h += '<div class="banner info">Es sind schon Ergebnisse eingetragen – Teamanzahl und Gruppen sind gesperrt. Teamnamen, Logos, Orte und Zeiten kannst du weiter ändern.</div>';
    h += '<div class="form-grid"><label class="field">Anzahl Teams<select id="m-teams" data-mstruct="teams"' + dis + '>' +
      ME.SIZES.map(function (n) { return '<option value="' + n + '"' + (n === t.teams.length ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="muted small" style="margin-bottom:0">' + esc(ME.structureText(t)) + ' Spiele insgesamt: ' + ME.timeline(t).length + '.</p></div>';

    // Orte
    var locs = ME.locations(t);
    h += '<h2>Orte & Spielfelder</h2><div class="card">';
    locs.forEach(function (l) {
      h += '<div class="loc-row"><label class="field">Ort<input type="text" id="loc-name-' + esc(l.id) + '" data-loc="' + esc(l.id) + '" data-lkey="name" value="' + esc(l.name) + '"></label>' +
        '<label class="field">Spielfelder<input type="number" id="loc-fields-' + esc(l.id) + '" data-loc="' + esc(l.id) + '" data-lkey="fields" min="1" max="16" value="' + esc(l.fields) + '"></label>' +
        (locs.length > 1 ? '<button class="btn small danger" data-action="loc-del" data-id="' + esc(l.id) + '">Entfernen</button>' : '<span></span>') + '</div>';
    });
    h += '<div class="btn-row" style="margin-top:6px"><button class="btn small" data-action="loc-add">+ Ort hinzufügen</button></div>';
    if (locs.length > 1) {
      h += '<h3 style="margin-top:16px">Wer spielt wo?</h3><div class="form-grid">';
      var keys = ['r1'].concat(ME.branchesOf(t, 2).map(function (b) { return b.key; }));
      if (ME.rounds(t).length === 3) keys = keys.concat(ME.branchesOf(t, 3).map(function (b) { return b.key; }));
      keys.forEach(function (k) {
        var cur = t.config.place[k] || (k === 'r1' ? 'all' : locs[0].id);
        h += '<label class="field">' + (k === 'r1' ? 'Runde 1' : 'Runde ' + (['gold', 'silver', 'bronze'].indexOf(k) >= 0 ? 2 : 3) + ' · ' + esc(ME.BRANCHES[k].name)) +
          '<select id="place-' + k + '" data-place="' + k + '">' +
          (k === 'r1' ? '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>Auf alle Orte verteilen</option>' : '') +
          locs.map(function (l) { return '<option value="' + esc(l.id) + '"' + (cur === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') +
          '</select></label>';
      });
      h += '</div>';
    }
    h += '</div>';

    // Zeiten
    h += '<h2>Spielbetrieb & Termine</h2><div class="card"><div class="form-grid">' +
      numField('Spielzeit (Minuten)', 'gameMinutes', t.config.gameMinutes, 1, 90) +
      numField('Takt pro Spielrunde (Minuten)', 'slotMinutes', t.config.slotMinutes, 1, 120) +
      numField('Pause zwischen den Runden (Minuten)', 'pauseMinutes', t.config.pauseMinutes, 0, 240) +
      '</div><div class="form-grid" style="margin-top:12px">';
    ME.rounds(t).forEach(function (r) {
      var rc = t.config.rounds[r] || {};
      h += '<label class="field">Runde ' + r + ' – Datum<input type="date" id="rd-' + r + '" data-rdate="' + r + '" value="' + esc(rc.date || '') + '"></label>' +
        '<label class="field">Runde ' + r + ' – Beginn' + (r > 1 ? ' (leer = automatisch)' : '') + '<input type="time" id="rs-' + r + '" data-rstart="' + r + '" value="' + esc(rc.start || '') + '"></label>';
    });
    h += '</div><p class="muted small" style="margin-bottom:0">Ohne Datum läuft die Runde am selben Tag wie die vorige. Ohne Beginn startet sie nach der vorigen Runde plus Pause. Playoffs schließen direkt an die Gruppenspiele am jeweiligen Ort an.</p></div>';

    // Teams
    h += '<h2>Teams & Gruppen (Runde 1)</h2>' +
      '<div class="btn-row no-print" style="margin-bottom:12px"><button class="btn" data-action="mdraw"' + dis + '>Gruppen zufällig auslosen</button>' +
      '<span class="muted small">Oder von Hand: Namen direkt in die Gruppen eintragen. „+ Logo“ antippen für ein Vereinslogo.</span></div><div class="group-grid">';
    t.groups.forEach(function (g, gi) {
      h += '<div class="card group-card"><h3>Gruppe ' + ME.groupLetter(gi) + '</h3>';
      g.forEach(function (id) {
        var tm = teamObj(t, id);
        h += '<div class="team-row">' + logoButton('team', id, tm.logo, 'Logo ' + tm.name) +
          '<input type="text" id="team-' + esc(id) + '" data-team="' + esc(id) + '" value="' + esc(tm.name) + '" aria-label="Teamname">' +
          (tm.logo ? '<button class="icon-btn" data-action="remove-logo" data-target="team" data-id="' + esc(id) + '" title="Logo entfernen" aria-label="Logo entfernen">✕</button>' : '') +
          '</div>';
      });
      h += '</div>';
    });
    h += '</div><h2>Turnier verwalten</h2><div class="card btn-row">' +
      '<button class="btn" data-action="duplicate" data-id="' + esc(t.id) + '">Als Vorlage für neues Turnier kopieren</button>' +
      '<button class="btn danger" data-action="reset-results">Alle Ergebnisse zurücksetzen</button>' +
      '<button class="btn danger" data-action="delete" data-id="' + esc(t.id) + '">Turnier löschen</button></div>';
    return h;
  }

  function updateMultiLive(t, el, r) {
    var m = /^m(\d)-(\w+)-g/.exec(el.dataset.game);
    if (!m) return;
    var round = +m[1], branch = m[2];
    var tl = ME.timeline(t);
    var box = app.querySelector('[data-mtables="' + round + '-' + branch + '"]');
    if (box) box.innerHTML = renderMTables(t, round, branch, tl);
    el.closest('.game').classList.toggle('done', TL.isPlayed(r));
    var prog = ME.roundProgress(t, round, tl);
    var bar = document.getElementById('mprog-bar'), txt = document.getElementById('mprog-text');
    if (bar) bar.style.width = Math.round(prog.done / Math.max(1, prog.total) * 100) + '%';
    if (txt) txt.textContent = prog.done + ' von ' + prog.total + ' Spielen eingetragen';
    var tab = app.querySelector('.tab.active .count');
    if (tab) tab.textContent = prog.done + '/' + prog.total;
    var btn = app.querySelector('[data-action="mlock"][data-next="1"]');
    if (btn) btn.disabled = !ME.roundComplete(t, round, tl);
  }

  /* ---------- Aktionen ---------- */

  function currentTournament() {
    var r = route();
    return r.view === 'tournament' ? find(r.id) : null;
  }

  function clearResults(t, prefix) {
    Object.keys(t.results).forEach(function (k) { if (k.indexOf(prefix) === 0) delete t.results[k]; });
  }

  function exportTournament(t) {
    var blob = new Blob([Sync.serialize(t)], { type: 'application/json' });
    var a = document.createElement('a');
    var slug = (t.name || 'turnier').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '');
    a.href = URL.createObjectURL(blob);
    a.download = slug + (t.date ? '-' + t.date : '') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function lockGroups2(t) {
    if (!TL.isPhaseComplete(t, 1)) return;
    var hasLater = TL.hasResultsWithPrefix(t, 'p2-') || TL.hasResultsWithPrefix(t, 'ko');
    if (hasLater && !confirm('Die Gruppen der Phase 2 werden neu gebildet. Bereits eingetragene Ergebnisse der Phase 2 und der Finalrunde werden gelöscht. Fortfahren?')) return;
    clearResults(t, 'p2-'); clearResults(t, 'ko');
    t.groups2 = TL.computeGroups2(t);
    t.koSeeds = null;
    save(t);
    go('#/t/' + t.id + '/p2');
  }

  function lockKo(t) {
    if (!t.groups2 || !TL.isPhaseComplete(t, 2)) return;
    if (TL.hasResultsWithPrefix(t, 'ko') && !confirm('Die Finalrunde wird neu gebildet. Bereits eingetragene Ergebnisse der Finalrunde werden gelöscht. Fortfahren?')) return;
    clearResults(t, 'ko');
    t.koSeeds = TL.computeKoSeeds(t);
    save(t);
    go('#/t/' + t.id + '/ko');
  }

  function lockKoGeneric(t) {
    if (!GE.stageComplete(t)) return;
    if (TL.hasResultsWithPrefix(t, 'ko') && !confirm('Die K.-o.-Runde wird neu gebildet. Bereits eingetragene K.-o.-Ergebnisse werden gelöscht. Fortfahren?')) return;
    clearResults(t, 'ko');
    t.koSeeds = GE.computeKoSeeds(t);
    save(t);
    go('#/t/' + t.id + '/ko');
  }

  var actions = {
    'toggle-new': function () { state.showNewForm = !state.showNewForm; render(); var n = document.getElementById('new-name'); if (n) n.focus(); },
    'create': function () {
      var format = document.getElementById('new-format').value;
      var t = GE.createTournament(format, {
        name: document.getElementById('new-name').value.trim() || 'Neues Turnier',
        date: document.getElementById('new-date').value,
        venue: document.getElementById('new-venue').value.trim(),
        ageGroup: document.getElementById('new-age').value.trim(),
        teamCount: parseInt(document.getElementById('new-teams').value, 10) || 16
      });
      state.tournaments.push(t);
      state.showNewForm = false;
      save(t);
      go('#/t/' + t.id + '/setup');
    },
    'import': function () { importInput.value = ''; importInput.click(); },
    'export': function (el) { var t = find(el.dataset.id); if (t) exportTournament(t); },
    'duplicate': function (el) {
      var src = find(el.dataset.id);
      if (!src) return;
      var t = JSON.parse(Sync.serialize(src));
      t.id = TL.uid();
      t.name = src.name + ' (Kopie)';
      t.date = '';
      t.results = {};
      t.groups2 = null;
      t.koSeeds = null;
      if (t.format === 'multi') { t.stages = { 2: null, 3: null }; t.po = {}; }
      t.createdAt = new Date().toISOString();
      state.tournaments.push(t);
      save(t);
      go('#/t/' + t.id + '/setup');
    },
    'delete': function (el) {
      var t = find(el.dataset.id);
      if (!t || !confirm('Turnier „' + t.name + '“ wirklich löschen?' + (Sync.enabled() ? ' Es wird auch online gelöscht – der Live-Link funktioniert dann nicht mehr.' : '') + ' Das kann nicht rückgängig gemacht werden.')) return;
      Sync.remove(t);
      state.tournaments = state.tournaments.filter(function (x) { return x.id !== t.id; });
      persist();
      go('#/');
    },
    'print': function () { window.print(); },
    'sync-now': function () { var t = currentTournament(); if (t) Sync.saveNow(t); },
    'login': function () {
      var email = document.getElementById('login-email').value.trim();
      var pw = document.getElementById('login-pw').value;
      var msg = document.getElementById('login-msg');
      msg.textContent = 'Melde an …'; msg.className = 'small';
      Sync.login(email, pw).then(function () { go('#/'); }).catch(function (err) { msg.className = 'small sync-error'; msg.textContent = err.message; });
    },
    'logout': function () {
      if (!confirm('Abmelden? Die Turniere bleiben online gespeichert. Auf diesem Gerät kannst du danach nur lokal weiterarbeiten.')) return;
      Sync.logout().then(function () { go('#/'); });
    },
    'share': function () { state.showShare = !state.showShare; render(); },
    'copy-link': function () {
      var inp = document.getElementById('share-url');
      inp.select();
      var done = function () { var b = app.querySelector('[data-action="copy-link"]'); if (b) b.textContent = 'Kopiert ✓'; };
      if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(done, function () { document.execCommand('copy'); done(); });
      else { document.execCommand('copy'); done(); }
    },
    'native-share': function () {
      var t = currentTournament();
      if (t && navigator.share) navigator.share({ title: t.name, text: 'Live-Ergebnisse: ' + t.name, url: Sync.liveUrl(t.id) }).catch(function () {});
    },
    'upload-logo': function (el) {
      pendingLogo = { target: el.dataset.target, id: el.dataset.id };
      logoInput.value = '';
      logoInput.click();
    },
    'remove-logo': function (el) {
      var t = currentTournament();
      if (!t) return;
      if (el.dataset.target === 'tournament') delete t.logo;
      else { var tm = teamObj(t, el.dataset.id); if (tm) delete tm.logo; }
      save(t); render();
    },
    'draw': function () {
      var t = currentTournament();
      if (!t || TL.hasResultsWithPrefix(t, 'p1-')) return;
      t.groups1 = TL.drawGroups(t);
      save(t); render();
    },
    'reset-results': function () {
      var t = currentTournament();
      if (!t || !confirm('Alle Ergebnisse dieses Turniers löschen? Teams und Einstellungen bleiben erhalten.')) return;
      t.results = {}; t.groups2 = null; t.koSeeds = null;
      if (isMulti(t)) { t.stages = { 2: null, 3: null }; t.po = {}; }
      save(t); render();
    },
    'lock-groups2': function () { var t = currentTournament(); if (t) lockGroups2(t); },
    'lock-ko': function () { var t = currentTournament(); if (t) (isAndi(t) ? lockKo : lockKoGeneric)(t); },
    'mdraw': function () { var t = currentTournament(); if (t && ME.drawGroups(t)) { save(t); render(); } },
    'mlock': function (el) {
      var t = currentTournament();
      if (!t) return;
      var r = parseInt(el.dataset.round, 10);
      var later = TL.hasResultsWithPrefix(t, 'm' + r + '-') || TL.hasResultsWithPrefix(t, 'm3-') || TL.hasResultsWithPrefix(t, 'ko-');
      if (later && !confirm('Runde ' + r + ' wird neu gebildet. Alle Ergebnisse ab Runde ' + r + ' und der Playoffs werden gelöscht. Fortfahren?')) return;
      if (ME.lockRound(t, r)) { save(t); go('#/t/' + t.id + '/r' + r); }
    },
    'munlock': function (el) {
      var t = currentTournament();
      if (!t) return;
      var r = parseInt(el.dataset.round, 10);
      if (!confirm('Festlegung der Runde ' + r + ' aufheben? Alle Ergebnisse ab Runde ' + r + ' und der Playoffs werden gelöscht.')) return;
      ME.unlockRound(t, r); save(t); render();
    },
    'mpo-lock': function (el) {
      var t = currentTournament();
      if (t && ME.lockPo(t, el.dataset.branch)) { save(t); render(); }
    },
    'mpo-unlock': function (el) {
      var t = currentTournament();
      if (!t || !confirm('Festlegung der Playoffs ' + ME.BRANCHES[el.dataset.branch].name + ' aufheben? Deren Ergebnisse werden gelöscht.')) return;
      ME.unlockPo(t, el.dataset.branch); save(t); render();
    },
    'loc-add': function () {
      var t = currentTournament();
      if (!t) return;
      var k = 1;
      while (t.config.locations.some(function (l) { return l.id === 'L' + k; })) k++;
      t.config.locations.push({ id: 'L' + k, name: 'Halle ' + (t.config.locations.length + 1), fields: 4 });
      save(t); render();
    },
    'loc-del': function (el) {
      var t = currentTournament();
      if (!t || t.config.locations.length < 2) return;
      t.config.locations = t.config.locations.filter(function (l) { return l.id !== el.dataset.id; });
      Object.keys(t.config.place).forEach(function (k) { if (t.config.place[k] === el.dataset.id) t.config.place[k] = k === 'r1' ? 'all' : t.config.locations[0].id; });
      save(t); render();
    },
    'jump': function (el) { var target = document.getElementById(el.dataset.target); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'gdraw': function () {
      var t = currentTournament();
      if (t && GE.drawGroups(t)) { save(t); render(); }
    },
    'unlock-groups2': function () {
      var t = currentTournament();
      if (!t) return;
      if (!confirm('Festlegung der Gruppenphase 2 aufheben? Alle Ergebnisse der Phase 2 und der Finalrunde werden gelöscht.')) return;
      clearResults(t, 'p2-'); clearResults(t, 'ko');
      t.groups2 = null; t.koSeeds = null;
      save(t); render();
    },
    'unlock-ko': function () {
      var t = currentTournament();
      if (!t) return;
      if (!confirm('Festlegung der Finalrunde aufheben? Alle Ergebnisse der Finalrunde werden gelöscht.')) return;
      clearResults(t, 'ko');
      t.koSeeds = null;
      save(t); render();
    },
    'rule-add': function () { var t = currentTournament(); if (!t) return; t.info.push({ label: '', value: '' }); save(t); render(); var el = document.getElementById('rl-' + (t.info.length - 1)); if (el) el.focus(); },
    'rule-del': function (el) { var t = currentTournament(); if (!t) return; t.info.splice(parseInt(el.dataset.i, 10), 1); save(t); render(); }
  };

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });

  app.addEventListener('input', function (e) {
    var el = e.target;
    var t = currentTournament();
    if (!t) return;

    if (el.dataset.game) {
      var digits = el.value.replace(/\D/g, '').slice(0, 2);
      if (digits !== el.value) el.value = digits;
      var r = t.results[el.dataset.game] || {};
      if (digits === '') delete r[el.dataset.side];
      else r[el.dataset.side] = parseInt(digits, 10);
      if (!TL.isPlayed(r) || r.h !== r.a) delete r.pen;
      if (r.h == null && r.a == null) delete t.results[el.dataset.game];
      else t.results[el.dataset.game] = r;
      save(t);
      if (el.dataset.game.indexOf('ko') === 0) return; // Finalrunde: Aktualisierung beim Verlassen des Feldes
      if (isMulti(t)) { updateMultiLive(t, el, r); return; }
      if (!isAndi(t)) { updateGenericLive(t, el, r); return; }
      var tables = document.getElementById('tables');
      var phase = el.dataset.game.charAt(1) === '1' ? 1 : 2;
      if (tables) tables.innerHTML = renderTables(t, phase);
      el.closest('.game').classList.toggle('done', TL.isPlayed(r));
      var prog = TL.phaseProgress(t, phase);
      var bar = app.querySelector('.progress > span');
      if (bar) bar.style.width = Math.round(prog.done / prog.total * 100) + '%';
      var info = bar && bar.parentNode.previousElementSibling;
      if (info) info.textContent = prog.done + ' von ' + prog.total + ' Spielen eingetragen';
      var tab = app.querySelector('.tab.active .count');
      if (tab) tab.textContent = prog.done + '/24';
      var lockBtn = app.querySelector('[data-action="' + (phase === 1 ? 'lock-groups2' : 'lock-ko') + '"]');
      if (lockBtn) lockBtn.disabled = prog.done !== prog.total;
      return;
    }
    if (el.dataset.team) {
      t.teams.forEach(function (x) { if (x.id === el.dataset.team) x.name = el.value; });
      save(t); return;
    }
    if (el.dataset.field) {
      t[el.dataset.field] = el.value;
      save(t);
      if (el.dataset.field === 'name' || el.dataset.field === 'date') topbarSub.textContent = t.name + (t.date ? ' · ' + fmtDate(t.date) : '');
      return;
    }
    if (el.dataset.config) {
      var n = parseInt(el.value, 10);
      if (n > 0 || (n === 0 && el.dataset.config === 'pauseMinutes')) { t.config[el.dataset.config] = n; save(t); }
      return;
    }
    if (el.dataset.time) {
      t.config.times[el.dataset.time] = el.value;
      save(t); return;
    }
    if (el.dataset.rule != null) {
      t.info[parseInt(el.dataset.rule, 10)][el.dataset.key] = el.value;
      save(t);
    }
    if (el.dataset.loc && el.dataset.lkey === 'name') {
      t.config.locations.forEach(function (l) { if (l.id === el.dataset.loc) l.name = el.value; });
      save(t);
    }
  });

  function updateGenericLive(t, el, r) {
    var tables = document.getElementById('tables');
    if (tables) tables.innerHTML = renderGTables(t);
    el.closest('.game').classList.toggle('done', TL.isPlayed(r));
    var prog = GE.stageProgress(t);
    var bar = app.querySelector('.progress > span');
    if (bar) bar.style.width = Math.round(prog.done / Math.max(1, prog.total) * 100) + '%';
    var info = bar && bar.parentNode.previousElementSibling;
    if (info) info.textContent = prog.done + ' von ' + prog.total + ' Spielen eingetragen';
    var tab = app.querySelector('.tab.active .count');
    if (tab) tab.textContent = prog.done + '/' + prog.total;
    var lockBtn = app.querySelector('[data-action="lock-ko"]');
    if (lockBtn && !t.koSeeds) lockBtn.disabled = prog.done !== prog.total;
  }

  app.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'new-format') {
      state.newFormat = el.value;
      document.getElementById('new-teams-wrap').innerHTML = newTeamsInput(el.value);
      document.getElementById('new-format-desc').textContent = GE.formatInfo(el.value).desc;
      return;
    }
    if (el.id === 'new-teams') { state.newTeams = parseInt(el.value, 10) || 16; return; }
    var t = currentTournament();
    if (!t) return;
    if (el.dataset.gstruct) {
      var v = parseInt(el.value, 10);
      if (el.dataset.gstruct === 'teamCount') GE.setTeamCount(t, v);
      else GE.setGroupCount(t, v);
      save(t); render(); return;
    }
    if (el.dataset.gconf) {
      var key = el.dataset.gconf;
      if (key === 'double') t.config.double = el.checked;
      else if (key === 'placement') t.config.placement = el.value;
      else t.config[key] = Math.max(0, parseInt(el.value, 10) || 0);
      if (key === 'advance') t.config.advance = Math.max(1, t.config.advance);
      if (key !== 'placement') t.koSeeds = null;
      save(t); render(); return;
    }
    if (el.dataset.move) {
      GE.moveTeam(t, el.dataset.move, parseInt(el.value, 10));
      save(t); render(); return;
    }
    if (el.dataset.mstruct) { if (ME.setTeamCount(t, parseInt(el.value, 10))) { save(t); } render(); return; }
    if (el.dataset.place) { t.config.place[el.dataset.place] = el.value; save(t); render(); return; }
    if (el.dataset.loc && el.dataset.lkey === 'fields') {
      var nf = Math.max(1, parseInt(el.value, 10) || 1);
      t.config.locations.forEach(function (l) { if (l.id === el.dataset.loc) l.fields = nf; });
      save(t); render(); return;
    }
    if (el.dataset.rdate || el.dataset.rstart) {
      var rk = el.dataset.rdate || el.dataset.rstart;
      t.config.rounds[rk] = t.config.rounds[rk] || { date: '', start: '' };
      t.config.rounds[rk][el.dataset.rdate ? 'date' : 'start'] = el.value;
      save(t); return;
    }
    if (el.dataset.pen) {
      var r = t.results[el.dataset.pen];
      if (r) { if (el.value) r.pen = el.value; else delete r.pen; }
      save(t); render(); return;
    }
    // verzögert, damit ein Klick ins nächste Feld nicht verloren geht
    if (el.dataset.game && el.dataset.game.indexOf('ko') === 0) setTimeout(render, 0);
  });

  // Enter springt ins nächste Ergebnisfeld
  app.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.target.id === 'login-pw' || e.target.id === 'login-email')) { e.preventDefault(); actions.login(); return; }
    if (e.key !== 'Enter' || !e.target.dataset.game) return;
    e.preventDefault();
    var inputs = Array.prototype.slice.call(app.querySelectorAll('input[data-game]:not([disabled])'));
    var i = inputs.indexOf(e.target);
    var current = e.target.id;
    if (e.target.dataset.game.indexOf('ko') === 0) render();
    var fresh = Array.prototype.slice.call(app.querySelectorAll('input[data-game]:not([disabled])'));
    var idx = fresh.map(function (x) { return x.id; }).indexOf(current);
    var next = fresh[(idx >= 0 ? idx : i) + 1];
    if (next) { next.focus(); next.select(); }
  });

  // Änderungen von anderen Geräten anzeigen, sobald niemand mehr tippt
  app.addEventListener('focusout', function () {
    if (!state.pendingRender) return;
    setTimeout(function () {
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT' && app.contains(a)) return; // direkt ins nächste Feld gewechselt
      state.pendingRender = false;
      render();
    }, 400);
  });

  app.addEventListener('focusin', function (e) {
    if (e.target.dataset && e.target.dataset.game) e.target.select();
  });

  importInput.addEventListener('change', function () {
    var file = importInput.files && importInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var t;
      try { t = JSON.parse(reader.result); } catch (err) { alert('Die Datei konnte nicht gelesen werden.'); return; }
      var problem = TL.validateTournament(t) || (t && t.format === 'multi' ? ME.validate(t) : t && t.format && t.format !== 'andi' ? GE.validate(t) : null);
      if (problem) { alert(problem); return; }
      delete t._sync; delete t._dirty;
      if (find(t.id)) {
        if (!confirm('Dieses Turnier existiert bereits. Als Kopie importieren?')) return;
        t.id = TL.uid();
        t.name += ' (Import)';
      }
      state.tournaments.push(t);
      save(t);
      go('#/t/' + t.id + '/' + openTab(t));
    };
    reader.readAsText(file);
  });

  logoInput.addEventListener('change', function () {
    var file = logoInput.files && logoInput.files[0];
    var t = currentTournament();
    if (!file || !t || !pendingLogo) return;
    var target = pendingLogo;
    pendingLogo = null;
    shrinkImage(file, target.target === 'tournament' ? 320 : 160).then(function (dataUrl) {
      if (target.target === 'tournament') t.logo = dataUrl;
      else { var tm = teamObj(t, target.id); if (tm) tm.logo = dataUrl; }
      save(t); render();
    }).catch(function (err) { alert(err.message); });
  });

  window.addEventListener('hashchange', render);

  load();
  Sync.init({
    tournaments: function () { return state.tournaments; },
    add: function (t) { state.tournaments.push(t); },
    replace: function (t) {
      for (var i = 0; i < state.tournaments.length; i++) if (state.tournaments[i].id === t.id) state.tournaments[i] = t;
    },
    remove: function (id) { state.tournaments = state.tournaments.filter(function (x) { return x.id !== id; }); },
    persist: persist,
    onStatus: updateSyncStatus,
    onPulled: function () {
      // nicht neu zeichnen, während jemand gerade tippt – wird beim Verlassen des Feldes nachgeholt
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT' && app.contains(a)) { state.pendingRender = true; updateSyncStatus(null); return; }
      render();
    },
    onAuth: function () { if (route().view !== 'live') render(); }
  });
  render();
})();
