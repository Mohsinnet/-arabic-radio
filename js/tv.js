(function () {
  "use strict";

  var BASE = "https://iptv-org.github.io/iptv/";
  var ARABIC_URL = BASE + "languages/ara.m3u";
  var WORLD_CATEGORIES = [
    { key: "news", label: "أخبار", tone: "news" },
    { key: "movies", label: "أفلام", tone: "music" },
    { key: "series", label: "مسلسلات", tone: "culture" },
    { key: "sports", label: "رياضة", tone: "variety" },
    { key: "documentary", label: "وثائقي", tone: "" },
    { key: "kids", label: "أطفال", tone: "variety" },
    { key: "entertainment", label: "ترفيه", tone: "culture" },
    { key: "music", label: "موسيقى", tone: "music" }
  ];
  var PAGE_SIZE = 60;
  var FAVS_KEY = "arabic-tv-favs";

  var state = {
    source: "arabic",
    category: null,
    query: "",
    channels: [],
    filtered: [],
    loading: false,
    failed: false,
    renderedCount: 0
  };

  var cache = {};
  var favs = loadFavs();
  var hls = null;
  var currentChannel = null;

  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid");
  var video = $("video");
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
    } catch (e) { /* storage unavailable */ }
  }

  function normalize(str) {
    return (str || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ًٌٍَُِّْ]/g, "");
  }

  var toastTimer = null;
  function toast(msg, ok) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("ok", !!ok);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  function parseM3U(text) {
    var lines = text.split(/\r?\n/);
    var out = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf("#EXTINF") === 0) {
        var commaIdx = line.lastIndexOf(",");
        var attrs = {};
        var attrRe = /([a-zA-Z0-9-]+)="([^"]*)"/g;
        var m;
        while ((m = attrRe.exec(line)) !== null) {
          attrs[m[1]] = m[2];
        }
        var name = commaIdx >= 0 ? line.substring(commaIdx + 1).trim() : "";
        cur = {
          name: name || attrs["tvg-id"] || "قناة",
          logo: attrs["tvg-logo"] || "",
          group: (attrs["group-title"] || "").split(";")[0] || "",
          country: attrs["tvg-country"] || ""
        };
      } else if (line.charAt(0) !== "#") {
        if (cur && /^https?:\/\//i.test(line)) {
          cur.url = line;
          out.push(cur);
        }
        cur = null;
      }
    }
    return out;
  }

  function dedupe(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var key = c.name.toLowerCase() + "|" + c.url;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(c);
    }
    return out;
  }

  function fetchPlaylist(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) {
        var channels = dedupe(parseM3U(text));
        cache[url] = channels;
        return channels;
      });
  }

  function arabicCategoryOf(group) {
    var g = normalize(group);
    if (/quran|قران|قرآن|اسلام|إسلام|دين/.test(g)) return "قرآن ودين";
    if (/news|اخبار|أخبار/.test(g)) return "أخبار";
    if (/sport|رياض/.test(g)) return "رياضة";
    if (/kids|child|اطفال|أطفال|طفل/.test(g)) return "أطفال";
    if (/music|موسيق|اغان|أغاني/.test(g)) return "موسيقى";
    if (/movie|film|سينما|افلام|أفلام/.test(g)) return "أفلام";
    if (/document|وثائق/.test(g)) return "وثائقي";
    if (/series|مسلسل|دراما/.test(g)) return "مسلسلات";
    return "عامة";
  }

  function loadData() {
    state.loading = true;
    state.failed = false;
    renderLoading();
    updateStats();

    if (state.source === "fav") {
      state.channels = [];
      state.loading = false;
      state.renderedCount = 0;
      applyFilters();
      renderGrid(true);
      updateEmpty();
      updateStats();
      return;
    }

    fetchPlaylist(urlForSource())
      .then(function (list) {
        if (state.source === "arabic") {
          return list.map(function (c) {
            c.cat = arabicCategoryOf(c.group);
            c.world = false;
            return c;
          });
        }
        return list.map(function (c) {
          c.cat = "عالمية";
          c.world = true;
          return c;
        });
      })
      .then(function (list) {
        state.channels = list;
        state.loading = false;
        state.renderedCount = 0;
        applyFilters();
        renderGrid(true);
        updateEmpty();
        updateStats();
      })
      .catch(function () {
        state.loading = false;
        state.failed = true;
        state.channels = [];
        grid.innerHTML = "";
        $("empty").hidden = false;
        $("emptyTitle").textContent = "تعذر جلب القنوات";
        $("emptyMsg").textContent = "تحقق من اتصالك بالإنترنت ثم أعد المحاولة";
        $("retryBtn").classList.remove("hidden");
        $("resultCount").textContent = "";
        updateStats();
      });
  }

  function urlForSource() {
    if (state.source === "world") {
      var cat = state.category || WORLD_CATEGORIES[0].key;
      return BASE + "categories/" + cat + ".m3u";
    }
    return ARABIC_URL;
  }

  function applyFilters() {
    var q = normalize(state.query.trim());
    state.filtered = state.channels.filter(function (c) {
      if (state.source === "fav" && !favs.has(c.url)) return false;
      if (state.source === "arabic" && state.category && c.cat !== state.category) return false;
      if (q && normalize(c.name).indexOf(q) === -1) return false;
      return true;
    });
  }

  function channelCard(c, index) {
    var el = document.createElement("article");
    el.className = "card tv-card";
    el.style.animationDelay = Math.min((index % PAGE_SIZE) * 22, 400) + "ms";

    var flagBox = document.createElement("div");
    flagBox.className = "card-flag tv-logo";
    if (c.logo) {
      var img = document.createElement("img");
      img.src = c.logo;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.remove();
        flagBox.textContent = "📺";
      });
      flagBox.appendChild(img);
    } else {
      flagBox.textContent = "📺";
    }

    var info = document.createElement("div");
    info.className = "card-info";
    info.innerHTML =
      '<h3 class="card-name"></h3>' +
      '<div class="card-tags">' +
        '<span class="tag ' + tagClass(c) + '"></span>' +
        (c.group ? '<span class="tag neutral">' + escapeHtml(truncate(c.group, 26)) + "</span>" : "") +
      "</div>";

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "card-play";
    playBtn.setAttribute("aria-label", "مشاهدة " + c.name);
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

    el.appendChild(flagBox);
    el.appendChild(info);
    el.appendChild(playBtn);

    el.querySelector(".card-name").textContent = truncate(c.name, 42);
    el.querySelector(".tag").textContent = c.cat || "عام";

    el.addEventListener("click", function () { watch(c); });

    return el;
  }

  function tagClass(c) {
    var map = { "أخبار": "news", "أفلام": "music", "مسلسلات": "culture", "رياضة": "variety", "موسيقى": "music", "عالمية": "variety", "وثائقي": "culture", "قرآن ودين": "" };
    return map[c.cat] !== undefined ? map[c.cat] : "";
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function escapeAttr(str) { return escapeHtml(str); }

  function renderLoading() {
    grid.innerHTML = "";
    for (var i = 0; i < 12; i++) {
      var sk = document.createElement("div");
      sk.className = "card skeleton";
      sk.innerHTML = '<div class="card-flag"></div><div class="card-info"><div class="sk-line w70"></div><div class="sk-line w40"></div></div>';
      grid.appendChild(sk);
    }
    $("resultCount").textContent = "جارٍ تحميل القنوات من GitHub…";
  }

  function renderGrid(reset) {
    if (reset) {
      grid.innerHTML = "";
      state.renderedCount = 0;
      applyFilters();
    }
    var frag = document.createDocumentFragment();
    var end = Math.min(state.renderedCount + PAGE_SIZE, state.filtered.length);
    for (var i = state.renderedCount; i < end; i++) {
      frag.appendChild(channelCard(state.filtered[i], i));
    }
    state.renderedCount = end;
    grid.appendChild(frag);

    var more = $("loadMore");
    more.classList.toggle("hidden", end >= state.filtered.length);

    updateEmpty();
    $("statChannels").textContent = state.source === "fav"
      ? favs.size
      : (state.failed ? "—" : state.filtered.length);

    var totalLabel = state.filtered.length
      ? "عرض " + Math.min(end, state.filtered.length) + " من أصل " + state.filtered.length + " قناة"
      : "";
    $("resultCount").textContent = state.loading ? "جارٍ التحميل…" : totalLabel;
  }

  function updateEmpty() {
    var isEmpty = !state.loading && state.filtered.length === 0;
    $("empty").hidden = !isEmpty;
    if (isEmpty) {
      $("retryBtn").classList.add("hidden");
      $("emptyTitle").textContent = state.source === "fav" ? "لا توجد قنوات في المفضلة" : "لا توجد نتائج مطابقة";
      $("emptyMsg").textContent = state.source === "fav"
        ? "اضغط على القلب ♥ في أي قناة لحفظها هنا"
        : "جرّب كلمة بحث أخرى أو أعد ضبط الفلاتر";
    } else {
      $("emptyMsg").textContent = "جرّب كلمة بحث أخرى أو أعد ضبط الفلاتر";
    }
  }

  function updateStats() {
    $("favCount").textContent = favs.size;
  }

  function buildChips() {
    var row = $("catChips");
    row.innerHTML = "";

    if (state.source === "arabic") {
      addChip(null, "كل الفئات");
      var cats = ["قرآن ودين", "أخبار", "رياضة", "أطفال", "موسيقى", "أفلام", "مسلسلات", "وثائقي", "عامة"];
      cats.forEach(function (cName) { addChip(cName, cName); });
    } else if (state.source === "world") {
      WORLD_CATEGORIES.forEach(function (wc) {
        addChip(wc.key, wc.label, wc.tone);
      });
    }
    row.hidden = state.source === "fav";

    function addChip(value, label, tone) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state.category === value ? " active" : "");
      b.textContent = label;
      if (tone) b.dataset.tone = tone;
      b.addEventListener("click", function () {
        if (state.category === value) return;
        state.category = value;
        buildChips();
        loadData();
      });
      row.appendChild(b);
    }
  }

  function setSource(src) {
    if (state.source === src) return;
    state.source = src;
    state.category = null;
    document.querySelectorAll(".src-tab").forEach(function (t) {
      var active = t.dataset.source === src;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    buildChips();
    loadData();
  }

  document.querySelectorAll(".src-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { setSource(tab.dataset.source); });
  });

  var searchTimer = null;
  $("search").addEventListener("input", function (e) {
    $("searchClear").classList.toggle("hidden", !e.target.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = e.target.value;
      renderGrid(true);
    }, 180);
  });
  $("searchClear").addEventListener("click", function () {
    $("search").value = "";
    $("searchClear").classList.add("hidden");
    state.query = "";
    renderGrid(true);
  });

  $("loadMore").addEventListener("click", function () { renderGrid(false); });
  $("retryBtn").addEventListener("click", loadData);

  function stopPlayback() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function setStatus(msg, isError) {
    var el = $("videoStatus");
    el.textContent = msg || "";
    el.classList.toggle("err", !!isError);
    el.classList.toggle("visible", !!msg);
  }

  function watch(channel) {
    currentChannel = channel;
    $("theater").hidden = false;
    document.body.classList.add("theater-open");
    $("tvName").textContent = channel.name;
    $("tvGroup").textContent = [channel.cat || "", channel.group || ""].filter(Boolean).join(" • ");
    syncTheaterFav();

    playStream(channel.url);
  }

  function playStream(url) {
    stopPlayback();
    setStatus("جارٍ الاتصال…");

    var isHls = /\.m3u8($|\?)/i.test(url);
    var nativeHls = video.canPlayType("application/vnd.apple.mpegurl");

    if (isHls && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ manifestLoadingTimeOut: 12000, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 3 });
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        setStatus("");
        video.play().catch(function () { setStatus("اضغط ▶ لتشغيل البث"); });
      });
      hls.on(window.Hls.Events.ERROR, function (_, data) {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          setStatus("تعذر الوصول إلى البث — قد تكون القناة غير متاحة حاليًا", true);
        } else {
          setStatus("حدث خطأ أثناء تشغيل هذه القناة", true);
          hls.destroy();
          hls = null;
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isHls && nativeHls) {
      video.src = url;
      video.play().catch(function () { setStatus("اضغط ▶ لتشغيل البث"); });
      video.addEventListener("error", function () { setStatus("تعذر تشغيل هذا البث", true); }, { once: true });
    } else {
      video.src = url;
      video.play().catch(function () { setStatus("اضغط ▶ لتشغيل البث"); });
      video.addEventListener("error", function () { setStatus("تعذر تشغيل هذا البث — الصيغة غير مدعومة أو القناة غير متاحة", true); }, { once: true });
    }
  }

  function closeTheater() {
    stopPlayback();
    $("theater").hidden = true;
    document.body.classList.remove("theater-open");
    currentChannel = null;
    setStatus("");
  }

  $("btnCloseTheater").addEventListener("click", closeTheater);
  $("theater").addEventListener("click", function (e) {
    if (e.target === $("theater")) closeTheater();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("theater").hidden) closeTheater();
  });

  $("btnFullscreen").addEventListener("click", function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (video.requestFullscreen) {
      video.requestFullscreen();
    }
  });

  function syncTheaterFav() {
    var btn = $("tvFav");
    var on = currentChannel && favs.has(currentChannel.url);
    btn.disabled = !currentChannel;
    btn.classList.toggle("on", !!on);
  }

  $("tvFav").addEventListener("click", function () {
    if (!currentChannel) return;
    var key = currentChannel.url;
    var meta = { name: currentChannel.name, logo: currentChannel.logo, group: currentChannel.group, cat: currentChannel.cat };
    try {
      localStorage.setItem("arabic-tv-ch:" + key, JSON.stringify(meta));
    } catch (e) { /* ignore */ }
    if (favs.has(key)) {
      favs.delete(key);
      toast("تمت الإزالة من المفضلة");
    } else {
      favs.add(key);
      toast("تمت الإضافة إلى المفضلة ♥", true);
    }
    saveFavs();
    updateStats();
    syncTheaterFav();
    if (state.source === "fav") loadData();
  });

  window.addEventListener("beforeunload", stopPlayback);

  buildChips();
  loadData();
})();
