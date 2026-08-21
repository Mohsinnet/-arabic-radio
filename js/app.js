(function () {
  "use strict";

  var STATIONS = window.STATIONS || [];
  var FLAGS = window.COUNTRY_FLAGS || {};
  var FAVS_KEY = "arabic-radio-favs";
  var VOL_KEY = "arabic-radio-vol";

  var TONE_CLASS = {
    "قرآن": "",
    "أخبار": "news",
    "ثقافة": "culture",
    "منوعات": "variety",
    "موسيقى": "music"
  };

  var state = {
    query: "",
    region: "all",
    tone: "all",
    favsOnly: false,
    currentId: null,
    filtered: []
  };

  var favs = loadFavs();
  var playToken = 0;
  var httpsRetried = false;

  var $ = function (id) { return document.getElementById(id); };
  var audio = $("audio");
  var grid = $("grid");
  var player = $("player");
  var toastEl = $("toast");

  function loadFavs() {
    try {
      return new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || "[]"));
    } catch (e) {
      return new Set();
    }
  }

  function saveFavs() {
    try {
      localStorage.setItem(FAVS_KEY, JSON.stringify(Array.from(favs)));
    } catch (e) { }
  }

  function stationById(id) {
    for (var i = 0; i < STATIONS.length; i++) {
      if (STATIONS[i].id === id) return STATIONS[i];
    }
    return null;
  }

  function flag(country) {
    return FLAGS[country] || "📻";
  }

  function normalize(str) {
    return (str || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ًٌٍَُِّْ]/g, "");
  }

  function applyFilters() {
    var q = normalize(state.query.trim());
    state.filtered = STATIONS.filter(function (s) {
      if (state.favsOnly && !favs.has(s.id)) return false;
      if (state.region !== "all" && s.region !== state.region) return false;
      if (state.tone !== "all" && s.tone !== state.tone) return false;
      if (q) {
        var hay = normalize(s.name + " " + s.city + " " + s.country);
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderStats() {
    var countries = {}, tones = {};
    STATIONS.forEach(function (s) {
      countries[s.country] = true;
      tones[s.tone] = true;
    });
    $("statStations").textContent = STATIONS.length;
    $("statCountries").textContent = Object.keys(countries).length;
    $("statTones").textContent = Object.keys(tones).length;
  }

  function renderChips() {
    var regions = {};
    STATIONS.forEach(function (s) { regions[s.region] = (regions[s.region] || 0) + 1; });

    var regionChips = $("regionChips");
    regionChips.innerHTML = "";
    var allBtn = chip("كل المناطق", "all", STATIONS.length, "region");
    regionChips.appendChild(allBtn);

    Object.keys(regions).forEach(function (r) {
      regionChips.appendChild(chip(r, r, regions[r], "region"));
    });

    var tones = [];
    STATIONS.forEach(function (s) { if (tones.indexOf(s.tone) === -1) tones.push(s.tone); });

    var toneChips = $("toneChips");
    toneChips.innerHTML = "";
    toneChips.appendChild(chip("كل الفئات", "all", null, "tone"));
    tones.forEach(function (t) {
      toneChips.appendChild(chip(t, t, null, "tone"));
    });

    function chip(label, value, count, kind) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state[kind] === value ? " active" : "");
      b.textContent = label + (count != null ? " (" + count + ")" : "");
      if (kind === "tone") b.dataset.tone = value;
      b.addEventListener("click", function () {
        state[kind] = value;
        renderChips();
        renderGrid();
      });
      return b;
    }
  }

  function card(s, index) {
    var el = document.createElement("article");
    el.className = "card" + (s.id === state.currentId ? " playing" : "");
    el.style.animationDelay = Math.min(index * 25, 400) + "ms";
    el.dataset.id = s.id;

    var isFav = favs.has(s.id);
    var toneClass = TONE_CLASS[s.tone] || "";

    el.innerHTML =
      '<div class="card-flag">' + flag(s.country) + "</div>" +
      '<div class="card-info">' +
        '<h3 class="card-name"></h3>' +
        '<p class="card-sub"></p>' +
        '<div class="card-tags">' +
          '<span class="tag ' + toneClass + '"></span>' +
          (s.freq ? '<span class="tag neutral">' + escapeHtml(s.freq) + "</span>" : "") +
        "</div>" +
      "</div>" +
      '<div class="card-actions">' +
        '<button type="button" class="card-play" aria-label="تشغيل ' + escapeAttr(s.name) + '">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
        "</button>" +
        '<button type="button" class="card-fav' + (isFav ? " on" : "") + '" aria-label="المفضلة">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21s-6.7-4.35-9.33-8.11C.8 10.2 1.7 6.9 4.5 5.7c1.9-.8 4-.3 5.5 1.2L12 8.9l2-2c1.5-1.5 3.6-2 5.5-1.2 2.8 1.2 3.7 4.5 1.83 7.19C18.7 16.65 12 21 12 21z"/></svg>' +
        "</button>" +
      "</div>";

    el.querySelector(".card-name").textContent = s.name;
    el.querySelector(".card-sub").textContent =
      flag(s.country) + " " + s.country + (s.city ? " — " + s.city : "");
    el.querySelector(".tag").textContent = s.tone;

    el.querySelector(".card-play").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePlay(s.id);
    });
    el.addEventListener("click", function () { togglePlay(s.id); });
    el.querySelector(".card-fav").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleFav(s.id);
    });

    return el;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(str) { return escapeHtml(str).replace(/"/g, "&quot;"); }

  function renderGrid() {
    applyFilters();

    var frag = document.createDocumentFragment();
    state.filtered.forEach(function (s, i) { frag.appendChild(card(s, i)); });
    grid.innerHTML = "";
    grid.appendChild(frag);

    $("empty").hidden = state.filtered.length > 0;
    var label = state.filtered.length
      ? "عرض " + state.filtered.length + " من أصل " + STATIONS.length + " محطة"
      : "";
    $("resultCount").textContent = label;

    syncPlayingUI();
  }

  function updateFavCount() {
    $("favCount").textContent = favs.size;
    var active = state.favsOnly;
    var btn = $("favFilter");
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }

  function toggleFav(id) {
    if (favs.has(id)) {
      favs.delete(id);
    } else {
      favs.add(id);
      toast("تمت الإضافة إلى المفضلة ♥", true);
    }
    saveFavs();
    updateFavCount();
    refreshCardFavIcons();
    if (state.currentId) syncHeartButton();
    if (state.favsOnly) renderGrid();
  }

  function refreshCardFavIcons() {
    var cards = grid.querySelectorAll(".card");
    Array.prototype.forEach.call(cards, function (c) {
      c.querySelector(".card-fav").classList.toggle("on", favs.has(c.dataset.id));
    });
  }

  function togglePlay(id) {
    if (state.currentId === id && !audio.paused) {
      audio.pause();
      return;
    }
    var s = stationById(id);
    if (!s) return;
    playStation(s);
  }

  function playStation(s) {
    var token = ++playToken;
    httpsRetried = false;
    state.currentId = s.id;

    audio.src = s.stream;
    audio.volume = volumeValue();

    setStatus("جارٍ الاتصال…");
    player.classList.add("show");
    syncPlayingUI();
    syncHeartButton();
    setPlayIcon(false);

    var p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        if (token === playToken) setStatus("");
      });
    }
    updateMediaSession(s);
    highlightCurrentInGrid();
  }

  function highlightCurrentInGrid() {
    var cards = grid.querySelectorAll(".card");
    Array.prototype.forEach.call(cards, function (c) {
      c.classList.toggle("playing", c.dataset.id === state.currentId);
    });
  }

  function syncPlayingUI() {
    var playing = !!state.currentId && !audio.paused && !audio.ended;
    setPlayIcon(playing);
    var eq = $("eq");
    eq.classList.toggle("paused", !playing);
    highlightCurrentInGrid();
  }

  function setPlayIcon(isPlaying) {
    $("iconPlay").classList.toggle("hidden", isPlaying);
    $("iconPause").classList.toggle("hidden", !isPlaying);
  }

  function syncHeartButton() {
    var btn = $("btnFav");
    var on = state.currentId && favs.has(state.currentId);
    btn.disabled = !state.currentId;
    btn.classList.toggle("on", !!on);
    btn.title = on ? "إزالة من المفضلة" : "إضافة للمفضلة";
  }

  function setStatus(msg, isError) {
    var el = $("playerStatus");
    el.textContent = msg || "";
    el.classList.toggle("err", !!isError);
  }

  function currentListForNavigation() {
    var list = state.filtered.slice();
    var cur = stationById(state.currentId);
    if (cur && list.indexOf(cur) === -1) list.unshift(cur);
    return list;
  }

  function step(dir) {
    if (!state.currentId) return;
    var list = currentListForNavigation();
    if (!list.length) return;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.currentId) { idx = i; break; }
    }
    if (idx === -1) idx = 0;
    var next = list[(idx + dir + list.length) % list.length];
    if (next) playStation(next);
  }

  function volumeValue() {
    var v = parseFloat($("volume").value);
    if (isNaN(v)) v = 80;
    return v / 100;
  }

  function paintVolumeFill() {
    var input = $("volume");
    input.style.setProperty("--fill", input.value + "%");
  }

  function saveVolume() {
    try { localStorage.setItem(VOL_KEY, $("volume").value); } catch (e) { }
  }

  function restoreVolume() {
    var saved = null;
    try { saved = localStorage.getItem(VOL_KEY); } catch (e) { }
    if (saved !== null && saved !== "" && !isNaN(parseFloat(saved))) {
      $("volume").value = saved;
    }
    paintVolumeFill();
  }

  var toastTimer = null;
  function toast(msg, ok) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("ok", !!ok);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  function updateMediaSession(s) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: s.name,
      artist: s.city ? s.city + " — " + s.country : s.country,
      album: "راديو الوطن العربي"
    });
    try {
      navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
      navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { step(-1); });
      navigator.mediaSession.setActionHandler("nexttrack", function () { step(1); });
    } catch (e) { }
  }

  audio.addEventListener("playing", function () {
    if (playToken) setStatus("يعمل الآن ● بث مباشر");
    syncPlayingUI();
  });
  audio.addEventListener("pause", function () { syncPlayingUI(); });
  audio.addEventListener("waiting", function () { setStatus("جارٍ التخزين المؤقت…"); });
  audio.addEventListener("error", function () {
    if (!audio.src || !state.currentId) return;
    var src = audio.getAttribute("src") || "";
    if (!httpsRetried && src.indexOf("http://") === 0) {
      httpsRetried = true;
      setStatus("محاولة اتصال آمن…");
      audio.src = src.replace(/^http:/, "https:");
      audio.play().catch(function () { streamFailed(); });
      return;
    }
    streamFailed();
  });

  function streamFailed() {
    setStatus("تعذر الوصول إلى هذا البث حاليًا", true);
    setPlayIcon(false);
    $("eq").classList.add("paused");
    toast("تعذر تشغيل المحطة، جرّب محطة أخرى");
  }

  $("btnPlay").addEventListener("click", function () {
    if (!state.currentId) {
      var first = state.filtered[0];
      if (first) playStation(first);
      return;
    }
    if (audio.paused) {
      audio.play().catch(function () { streamFailed(); });
    } else {
      audio.pause();
    }
  });
  $("btnPrev").addEventListener("click", function () { step(-1); });
  $("btnNext").addEventListener("click", function () { step(1); });
  $("btnFav").addEventListener("click", function () {
    if (state.currentId) toggleFav(state.currentId);
  });

  $("volume").addEventListener("input", function () {
    audio.volume = volumeValue();
    paintVolumeFill();
    saveVolume();
  });

  var searchTimer = null;
  $("search").addEventListener("input", function (e) {
    var val = e.target.value;
    $("searchClear").hidden = !val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = val;
      renderGrid();
    }, 160);
  });
  $("searchClear").addEventListener("click", function () {
    $("search").value = "";
    $("searchClear").hidden = true;
    state.query = "";
    renderGrid();
  });

  $("favFilter").addEventListener("click", function () {
    state.favsOnly = !state.favsOnly;
    updateFavCount();
    renderGrid();
  });

  $("resetFilters").addEventListener("click", resetFilters);
  function resetFilters() {
    state.query = "";
    state.region = "all";
    state.tone = "all";
    state.favsOnly = false;
    $("search").value = "";
    $("searchClear").hidden = true;
    updateFavCount();
    renderChips();
    renderGrid();
  }

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.code === "Space") {
      e.preventDefault();
      $("btnPlay").click();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    }
  });

  renderStats();
  renderChips();
  restoreVolume();
  updateFavCount();
  renderGrid();
})();
