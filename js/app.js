/* Turnierplaner – Oberfläche. Daten liegen im localStorage des Browsers. */
(function () {
  'use strict';

  var STORAGE_KEY = 'turnierplaner:v1';
  var app = document.getElementById('app');
  var logoInput = document.getElementById('logo-file');
  var pendingLogo = null;
  var importInput = document.getElementById('import-file');
  var topbarSub = document.getElementById('topbar-sub');

  var state = { tournaments: [], storageOk: true, showNewForm: false };

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

  // Änderung an einem Turnier: lokal speichern und GitHub-Upload anstoßen
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
    if (parts[0] === 'github') return { view: 'github' };
    return { view: 'home' };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function statusText(t) {
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
    var r = route();
    var active = document.activeElement && document.activeElement.id;
    if (r.view === 'tournament') {
      var t = find(r.id);
      if (!t) { go('#/'); return; }
      topbarSub.textContent = t.name + (t.date ? ' · ' + fmtDate(t.date) : '');
      document.title = t.name + ' – Turnierplaner';
      app.innerHTML = renderTournament(t, r.tab);
    } else if (r.view === 'github') {
      topbarSub.textContent = 'GitHub-Speicher';
      document.title = 'GitHub-Speicher – Turnierplaner';
      app.innerHTML = renderGithub();
    } else {
      topbarSub.textContent = '';
      document.title = 'Turnierplaner';
      app.innerHTML = renderHome();
    }
    if (active) {
      var el = document.getElementById(active);
      if (el) el.focus();
    }
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

  function renderHome() {
    var list = state.tournaments.slice().sort(function (a, b) {
      return (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '');
    });
    var h = '<img class="hero" src="img/banner.jpg" alt="Sportbund Turnierplaner" width="1600" height="533">' +
      '<div class="t-head"><div><h1>Meine Turniere</h1>' +
      '<div class="muted">16 Teams · 4 Gruppen · 2 Gruppenphasen · Finalrunde mit allen Plätzen 1–16</div></div>' +
      '<div class="btn-row"><button class="btn primary" data-action="toggle-new">+ Neues Turnier</button>' +
      '<button class="btn" data-action="import">Importieren</button></div></div>' +
      '<div class="sync-line">' + syncBadge(Sync.globalStatus(), '') +
      ' <a href="#/github" class="small">' + (Sync.enabled() ? 'GitHub-Einstellungen' : 'GitHub-Speicher einrichten') + '</a></div>';

    if (state.showNewForm) {
      h += '<div class="card" style="margin-top:16px"><h3>Neues Turnier anlegen</h3>' +
        '<div class="new-form">' +
        '<label class="field">Name<input type="text" id="new-name" placeholder="z. B. Hallenturnier U9"></label>' +
        '<label class="field">Datum<input type="date" id="new-date"></label>' +
        '<label class="field">Ort<input type="text" id="new-venue"></label>' +
        '<label class="field">Jahrgang<input type="text" id="new-age" placeholder="z. B. U9 (2018/2019)"></label>' +
        '</div><div class="btn-row" style="margin-top:12px">' +
        '<button class="btn primary" data-action="create">Anlegen</button>' +
        '<button class="btn" data-action="toggle-new">Abbrechen</button></div></div>';
    }

    if (!list.length) {
      h += '<div class="card empty" style="margin-top:16px">Noch keine Turniere angelegt.<br>Leg mit „Neues Turnier“ los oder importiere eine Turnierdatei.</div>';
      return h;
    }
    h += '<div class="t-list">';
    list.forEach(function (t) {
      h += '<div class="card t-card">' + logoHtml(t.logo, 'card-logo') + '<h3><a href="#/t/' + esc(t.id) + '/' + (t.groups2 || TL.phaseProgress(t, 1).done ? 'p1' : 'setup') + '">' + esc(t.name) + '</a></h3>' +
        '<div class="muted small">' + esc([fmtDate(t.date), t.venue, t.ageGroup].filter(Boolean).join(' · ') || 'ohne Datum') + '</div>' +
        '<span class="status-pill">' + esc(statusText(t)) + '</span>' +
        '<div class="btn-row">' +
        '<a class="btn small" href="#/t/' + esc(t.id) + '/p1">Öffnen</a>' +
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
      '<button class="btn small" data-action="export" data-id="' + esc(t.id) + '">Exportieren</button>' +
      '<a class="btn small" href="#/">Alle Turniere</a></div></div>' +
      '<div class="sync-line no-print">' + syncBadge(Sync.statusFor(t), t.id) +
      (Sync.enabled() ? ' <button class="btn small" data-action="sync-now">Jetzt speichern</button>' : ' <a href="#/github" class="small">GitHub-Speicher einrichten</a>') + '</div>';

    h += '<nav class="tabs">';
    TABS.forEach(function (x) {
      var count = '';
      if (x.key === 'p1') count = TL.phaseProgress(t, 1).done + '/24';
      if (x.key === 'p2' && t.groups2) count = TL.phaseProgress(t, 2).done + '/24';
      h += '<a class="tab' + (x.key === tab ? ' active' : '') + '" href="#/t/' + esc(t.id) + '/' + x.key + '">' +
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
      '<dt>Teams</dt><dd>16 (4 Gruppen à 4)</dd>' +
      '<dt>Spielfelder</dt><dd>' + esc(t.config.fields) + '</dd>' +
      '<dt>Spielzeit</dt><dd>' + esc(t.config.gameMinutes) + ' min</dd>' +
      '<dt>Platzierung</dt><dd>' + esc(TL.TIEBREAK_TEXT) + ' (je Gruppenphase getrennt)</dd>' +
      '</dl></div>';
    h += '<h2>Ablauf / Zeitplan</h2><div class="card"><dl class="info">';
    TL.timetable(t).forEach(function (r) { h += '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.value || '–') + '</dd>'; });
    h += '</dl><p class="muted small">Wird automatisch aus den Startzeiten und dem Takt berechnet.</p></div>';

    h += '<h2>Spielregeln</h2><div class="card">';
    t.info.forEach(function (row, i) {
      h += '<div class="rule-row"><input type="text" id="rl-' + i + '" data-rule="' + i + '" data-key="label" value="' + esc(row.label) + '" aria-label="Regel">' +
        '<input type="text" id="rv-' + i + '" data-rule="' + i + '" data-key="value" value="' + esc(row.value) + '" aria-label="Beschreibung">' +
        '<button class="btn small danger" data-action="rule-del" data-i="' + i + '" aria-label="Regel entfernen">✕</button></div>';
    });
    h += '<div class="btn-row" style="margin-top:8px"><button class="btn small" data-action="rule-add">+ Regel hinzufügen</button></div></div>';
    return h;
  }

  /* ----- GitHub-Speicher ----- */

  function renderGithub() {
    var c = Sync.getConfig();
    var h = '<h1>GitHub-Speicher</h1>' +
      '<p>Wenn eingerichtet, speichert die App jedes Turnier automatisch als kleine Datei in deinem GitHub-Repo ' +
      '(Branch „' + esc(c.branch) + '“, Ordner <code>data/</code>). Auf jedem anderen Gerät mit Token werden die Turniere beim Öffnen geladen.</p>' +
      '<div class="banner warn">Das Repo ist öffentlich: Teamnamen, Ergebnisse und Logos sind für jeden lesbar. Keine Spielernamen eintragen.</div>';

    h += '<div class="card"><h3>Einmalig pro Gerät: Token anlegen</h3><ol class="steps">' +
      '<li>Auf GitHub <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">neuen Fine-grained Token anlegen</a> (Settings → Developer settings → Personal access tokens → Fine-grained tokens).</li>' +
      '<li><b>Token name:</b> z. B. „Turnierplaner“, <b>Expiration:</b> z. B. 1 Jahr.</li>' +
      '<li><b>Repository access:</b> „Only select repositories“ → <b>' + esc(c.repo || 'Turnierplaner') + '</b>.</li>' +
      '<li><b>Permissions → Repository permissions → Contents:</b> „Read and write“. Sonst nichts.</li>' +
      '<li>„Generate token“, Token kopieren und unten einfügen.</li></ol>' +
      '<p class="muted small">Der Token bleibt nur in diesem Browser. Geht ein Gerät verloren, den Token auf GitHub löschen.</p></div>';

    h += '<h2>Verbindung</h2><div class="card"><div class="form-grid">' +
      '<label class="field">GitHub-Benutzer<input type="text" id="gh-owner" value="' + esc(c.owner) + '" placeholder="mattment1980"></label>' +
      '<label class="field">Repository<input type="text" id="gh-repo" value="' + esc(c.repo) + '" placeholder="Turnierplaner"></label>' +
      '<label class="field">Branch für Daten<input type="text" id="gh-branch" value="' + esc(c.branch) + '"></label>' +
      '<label class="field">Token<input type="password" id="gh-token" autocomplete="off" placeholder="' + (c.token ? 'gespeichert – zum Ändern neu einfügen' : 'github_pat_…') + '"></label>' +
      '</div><div class="btn-row" style="margin-top:14px">' +
      '<button class="btn primary" data-action="gh-save">Speichern & Verbindung testen</button>' +
      (c.token ? '<button class="btn" data-action="gh-pull">Jetzt mit GitHub abgleichen</button>' +
        '<button class="btn danger" data-action="gh-disconnect">Token von diesem Gerät entfernen</button>' : '') +
      '</div><p id="gh-result" class="small" style="margin-bottom:0">' + (c.token ? syncBadge(Sync.globalStatus(), '') : '') + '</p></div>';
    h += '<div class="btn-row" style="margin-top:16px"><a class="btn" href="#/">Zurück zu den Turnieren</a></div>';
    return h;
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

  var actions = {
    'toggle-new': function () { state.showNewForm = !state.showNewForm; render(); var n = document.getElementById('new-name'); if (n) n.focus(); },
    'create': function () {
      var t = TL.createTournament({
        name: document.getElementById('new-name').value.trim() || 'Neues Turnier',
        date: document.getElementById('new-date').value,
        venue: document.getElementById('new-venue').value.trim(),
        ageGroup: document.getElementById('new-age').value.trim()
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
      t.createdAt = new Date().toISOString();
      state.tournaments.push(t);
      save(t);
      go('#/t/' + t.id + '/setup');
    },
    'delete': function (el) {
      var t = find(el.dataset.id);
      if (!t || !confirm('Turnier „' + t.name + '“ wirklich löschen?' + (Sync.enabled() ? ' Es wird auch auf GitHub gelöscht.' : '') + ' Das kann nicht rückgängig gemacht werden.')) return;
      Sync.remove(t);
      state.tournaments = state.tournaments.filter(function (x) { return x.id !== t.id; });
      persist();
      go('#/');
    },
    'print': function () { window.print(); },
    'sync-now': function () { var t = currentTournament(); if (t) Sync.saveNow(t); },
    'gh-save': function () {
      var c = Sync.getConfig();
      c.owner = document.getElementById('gh-owner').value.trim();
      c.repo = document.getElementById('gh-repo').value.trim();
      c.branch = document.getElementById('gh-branch').value.trim() || 'data';
      var tok = document.getElementById('gh-token').value.trim();
      if (tok) c.token = tok;
      var out = document.getElementById('gh-result');
      if (!c.owner || !c.repo || !c.token) { out.textContent = 'Bitte Benutzer, Repository und Token ausfüllen.'; out.className = 'small sync-error'; return; }
      Sync.setConfig(c);
      out.className = 'small'; out.textContent = 'Teste Verbindung …';
      Sync.testConnection().then(function (res) {
        out.className = 'small sync-ok'; out.textContent = res.text + ' Turniere werden abgeglichen …';
        return Sync.pullAll().then(function () {
          if (route().view === 'github') render();
          var o = document.getElementById('gh-result');
          if (o) { o.className = 'small sync-ok'; o.textContent = res.text + ' Abgleich fertig.'; }
        });
      }).catch(function (err) {
        out.className = 'small sync-error';
        out.textContent = err.status ? err.message : 'Keine Verbindung zu GitHub (offline?).';
      });
    },
    'gh-pull': function () { Sync.pullAll(); },
    'gh-disconnect': function () {
      if (!confirm('Token von diesem Gerät entfernen? Die Turniere bleiben im Browser und auf GitHub erhalten.')) return;
      Sync.clearToken(); render();
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
      save(t); render();
    },
    'lock-groups2': function () { var t = currentTournament(); if (t) lockGroups2(t); },
    'lock-ko': function () { var t = currentTournament(); if (t) lockKo(t); },
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
      if (n > 0) { t.config[el.dataset.config] = n; save(t); }
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
  });

  app.addEventListener('change', function (e) {
    var el = e.target;
    var t = currentTournament();
    if (!t) return;
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
      var problem = TL.validateTournament(t);
      if (problem) { alert(problem); return; }
      delete t._sync; delete t._dirty;
      if (find(t.id)) {
        if (!confirm('Dieses Turnier existiert bereits. Als Kopie importieren?')) return;
        t.id = TL.uid();
        t.name += ' (Import)';
      }
      state.tournaments.push(t);
      save(t);
      go('#/t/' + t.id + '/p1');
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
      // nicht neu zeichnen, während jemand gerade tippt
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT' && app.contains(a)) { updateSyncStatus(null); return; }
      render();
    }
  });
  render();
  Sync.pullAll();
})();
