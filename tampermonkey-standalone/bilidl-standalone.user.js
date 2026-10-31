// ==UserScript==
// @name         BiliDL 独立版 · 页面内多选下载
// @namespace    https://github.com/bilidl/standalone
// @version      1.2.45
// @description  不依赖电脑端服务：在 B 站页面里直接解析、多选、下载视频与图文。自带设置小窗（登录 / 下载目录 / 重命名 / 清晰度）。
// @author       BiliDL
// @match        https://space.bilibili.com/*
// @match        https://www.bilibili.com/*
// @match        https://m.bilibili.com/*
// @match        https://t.bilibili.com/*
// @match        https://b23.tv/*
// @match        https://live.bilibili.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      bilibili.com
// @connect      hdslb.com
// @connect      bilivideo.com
// @connect      biliapi.net
// @connect      b23.tv
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ---------------------------------------------------------------- 设置 */

  const APP = "bilidl_sa_";
  const QUALITY = [
    ["8K", 127], ["4K", 120], ["1080P60", 116], ["1080P+", 112], ["1080P", 80],
    ["720P60", 74], ["720P", 64], ["480P", 32], ["360P", 16],
  ];
  const QN_NAME = { 127: "8K", 126: "杜比视界", 125: "HDR", 120: "4K", 116: "1080P60", 112: "1080P+", 80: "1080P", 74: "720P60", 64: "720P", 32: "480P", 16: "360P" };

  const DEFAULTS = {
    quality: 116,
    exAudio: false,
    exVideoMute: false,
    exSub: false,
    exDm: false,
    exCover: false,
    exNfo: false,
    subDir: "BiliDL",
    videoTpl: "<video_title>-<video_id>-<video_episode>.<ext>",
    opusTpl: "<opus_title>-<opus_id>-<opus_order>.<ext>",
    readlistTpl: "<readlist_title>/<readlist_order>-<opus_title>/<opus_id>-<opus_order>.<ext>",
    gmSave: false,   // 图文/封面等小文件是否用 GM_download 保存（支持子目录，但个别环境会弹新标签）
    interval: 900,
    concurrency: 2,
    apiDelay: 700,
    lastOpusDir: "",
    lastVideoDir: "",
    selMode: false,
  };

  // 双后端：优先 GM 存储，同时写一份 localStorage。
  // 某些浏览器的 TM 沙箱里 GM_setValue 会静默失败，只写 GM 会导致「换页面就丢设置」。
  const store = {
    key(k) { return APP + k; },
    get(k, d) {
      let v;
      try { v = GM_getValue(this.key(k), undefined); } catch (e) { v = undefined; }
      if (v === undefined) {
        try { const raw = localStorage.getItem(this.key(k)); if (raw !== null) v = JSON.parse(raw); } catch (e) {}
      }
      return v === undefined || v === null ? d : v;
    },
    set(k, v) {
      let ok = false;
      try { GM_setValue(this.key(k), v); ok = true; } catch (e) {}
      try { localStorage.setItem(this.key(k), JSON.stringify(v)); ok = true; } catch (e) {}
      if (!ok) console.warn("[BiliDL] 设置保存失败", k);
      return ok;
    },
    reset(keys) { keys.forEach((k) => this.set(k, DEFAULTS[k])); },
  };

  const conf = {};
  for (const k in DEFAULTS) conf[k] = store.get(k, DEFAULTS[k]);

  function saveConf(patch) {
    Object.assign(conf, patch || {});
    for (const k in (patch || {})) store.set(k, conf[k]);
  }

  /* ------------------------------------------------------------ 小工具 */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rand = (a, b) => a + Math.random() * (b - a);
  const fmtSize = (n) => {
    if (!n || n < 0) return "?";
    const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + u[i];
  };

  function toast(msg, ms) {
    let el = $("#bilidl-sa-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "bilidl-sa-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("on"), ms || 2600);
  }

  /* --------------------------------------------------------- B 站 API */

  const RISK = new Set([-352, -412, -403, -509, -799]);
  let coolUntil = 0;
  let lastApi = 0;

  async function apiGet(url, opts) {
    opts = opts || {};
    const now = Date.now();
    if (now < coolUntil) await sleep(coolUntil - now);
    const wait = lastApi + (conf.apiDelay || 700) - Date.now();
    if (wait > 0) await sleep(wait + rand(0, 250));
    lastApi = Date.now();
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      let r, j;
      try {
        r = await fetch(url, { credentials: "include", headers: { Accept: "application/json, text/plain, */*" } });
      } catch (e) {
        lastErr = new Error("网络错误：" + e.message);
        await sleep(1500 * (i + 1));
        continue;
      }
      if (r.status === 412 || r.status === 429) {
        coolUntil = Date.now() + 20000 * (i + 1);
        lastErr = new Error("触发风控（HTTP " + r.status + "），已自动冷却");
        continue;
      }
      try { j = await r.json(); } catch (e) { lastErr = new Error("返回不是 JSON"); continue; }
      if (j.code === 0) return j.data === undefined ? {} : j.data;
      if (RISK.has(j.code)) { coolUntil = Date.now() + 20000 * (i + 1); lastErr = new Error("触发风控（" + j.code + "），已自动冷却"); continue; }
      if (j.code === -101 || j.code === -111) throw new Error("需要登录：请在设置里点「扫码登录」或用 Cookie 登录");
      if (j.code === -404 || j.code === 62002 || j.code === 62004) throw new Error("内容不存在或已删除");
      throw new Error(j.message || ("接口错误 " + j.code));
    }
    throw lastErr || new Error("请求失败");
  }

  const nav = () => apiGet("https://api.bilibili.com/x/web-interface/nav");
  const view = (bvid) => apiGet("https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid));
  const opusDetail = (id) => apiGet("https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail?id=" + encodeURIComponent(id));
  const dynamicDetail = (id) => apiGet("https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=" + encodeURIComponent(id));

  async function playurl(bvid, cid, qn) {
    const q = [
      "bvid=" + encodeURIComponent(bvid), "cid=" + cid, "qn=" + qn,
      "fnval=0", "fnver=0", "fourk=1", "platform=pc", "type=mp4",
    ].join("&");
    const data = await apiGet("https://api.bilibili.com/x/player/playurl?" + q);
    const durl = data.durl || [];
    if (!durl.length) return null;
    return { url: durl[0].url, backup: (durl[0].backup_url || [])[0] || "", quality: data.quality || qn, size: durl[0].size || 0 };
  }

  async function dashStreams(bvid, cid, qn) {
    const q = ["bvid=" + encodeURIComponent(bvid), "cid=" + cid, "qn=" + qn, "fnval=4048", "fnver=0", "fourk=1", "platform=pc"].join("&");
    const data = await apiGet("https://api.bilibili.com/x/player/playurl?" + q);
    const dash = data.dash || {};
    const videos = (dash.video || []).filter((v) => v.id <= qn && v.id !== 125 && v.id !== 126);
    videos.sort((a, b) => b.id - a.id || (b.bandwidth || 0) - (a.bandwidth || 0));
    const audios = (dash.audio || []).concat((dash.dolby && dash.dolby.audio) || []);
    audios.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    return {
      video: videos[0] ? { url: videos[0].baseUrl || videos[0].base_url, id: videos[0].id } : null,
      audio: audios[0] ? { url: audios[0].baseUrl || audios[0].base_url } : null,
      quality: videos[0] ? videos[0].id : data.quality || qn,
    };
  }

  function xmlToSrt(xml) {
    const out = [];
    const re = /<d p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g;
    let m, i = 0;
    const clock = (sec) => {
      sec = Math.max(0, sec);
      const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60), se = Math.floor(sec % 60);
      const ms = Math.round((sec - Math.floor(sec)) * 1000);
      const p = (n, w) => String(n).padStart(w, "0");
      return `${p(h,2)}:${p(mi,2)}:${p(se,2)},${p(ms < 1000 ? ms : 999,3)}`;
    };
    while ((m = re.exec(xml))) {
      const t = parseFloat((m[1] || "").split(",")[0]);
      if (!isFinite(t)) continue;
      const text = m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (!text) continue;
      i++;
      out.push(`${i}\n${clock(t)} --> ${clock(t + 4)}\n${text}\n`);
    }
    return out.join("\n");
  }

  function textDownload(name, text, mime) {
    try {
      saveBlob(new Blob([text], { type: mime || "text/plain;charset=utf-8" }), name);
      dlLog({ name, how: "text" });
      return true;
    } catch (e) { console.warn("[BiliDL] 文本文件下载失败", e); return false; }
  }

  async function extraFiles(bvid, cid, nameFor) {
    const made = [];
    if (conf.exCover) {
      const pic = (await view(bvid)).pic || "";
      if (pic) { await blobDownload({ url: pic, name: nameFor("jpg", ""), headers: { Referer: "https://www.bilibili.com/video/" + bvid } }).catch(() => {}); made.push("封面"); }
    }
    if (conf.exNfo) {
      const d = await view(bvid);
      const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const nfo = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<movie>\n  <title>${esc(d.title)}</title>\n  <uniqueid type="bilibili" default="true">${esc(bvid)}</uniqueid>\n  <plot>${esc(d.desc)}</plot>\n  <premiered>${new Date((d.pubdate || 0) * 1000).toISOString().slice(0, 10)}</premiered>\n  <studio>${esc(d.owner && d.owner.name)}</studio>\n  <thumb>${esc(d.pic)}</thumb>\n</movie>\n`;
      if (textDownload(nameFor("nfo", ""), nfo, "application/xml")) made.push("NFO");
    }
    if (conf.exDm) {
      const xml = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({ method: "GET", url: "https://comment.bilibili.com/" + cid + ".xml", onload: (r) => resolve(r.responseText || ""), onerror: reject, timeout: 20000 });
      }).catch(() => "");
      const srt = xml ? xmlToSrt(xml) : "";
      if (srt) { if (textDownload(nameFor("srt", "danmaku"), srt)) made.push("弹幕SRT"); } else toast("这个视频没有抓到弹幕");
    }
    if (conf.exSub) {
      try {
        const p = await apiGet(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`);
        const list = ((p.subtitle || {}).subtitles) || [];
        if (!list.length) toast("没有可用字幕（多为 UP 主未上传或未登录）");
        for (const it of list) {
          const url = it.subtitle_url && (it.subtitle_url.startsWith("//") ? "https:" + it.subtitle_url : it.subtitle_url);
          if (!url) continue;
          const j = await apiGet(url);
          const body = (j.body || []).map((b, i) => `${i + 1}\n00:${String(Math.floor(b.from / 60)).padStart(2, "0")}:${String(Math.floor(b.from % 60)).padStart(2, "0")},${String(Math.round((b.from % 1) * 1000)).padStart(3, "0")} --> 00:${String(Math.floor(b.to / 60)).padStart(2, "0")}:${String(Math.floor(b.to % 60)).padStart(2, "0")},${String(Math.round((b.to % 1) * 1000)).padStart(3, "0")}\n${String(b.content || "").trim()}\n`).join("\n");
          if (body && textDownload(nameFor("srt", it.lan), body)) made.push("字幕SRT");
        }
      } catch (e) { console.warn("[BiliDL] 字幕失败", e); }
    }
    if (made.length) toast("附加文件：" + made.join("、"));
  }

  /* ------------------------------------------------------------ 命名 */

  const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
  const ALIAS = {
    "<视频标题>": "video_title", "<视频BV号>": "video_id", "<视频分集序号>": "video_episode",
    "<分集标题>": "video_page_title", "<UP主昵称>": "video_author", "<清晰度>": "video_quality",
    "<发布时间>": "video_date",
    "<专栏或动态标题>": "opus_title", "<专栏或动态id>": "opus_id", "<专栏或动态图片序号>": "opus_order",
    "<UP主>": "opus_author", "<日期>": "opus_date",
  };

  function cleanSeg(s) {
    return String(s || "").replace(ILLEGAL, "_").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 120);
  }

  function renderPath(tpl, vars, ext) {
    let t = String(tpl || "").trim() || "<title>.<ext>";
    for (const zh in ALIAS) t = t.split(zh).join("<" + ALIAS[zh] + ">");
    const MISS = "\u0000";
    const repl = (name) => {
      const key = name.replace(/[<>${}]/g, "").trim();
      const v = vars[key];
      if (v === undefined || v === null || String(v) === "") return MISS;   // 缺失变量先打标记
      return String(v);
    };
    t = t.replace(/<([a-zA-Z0-9_]+)>/g, (m, k) => (k === "ext" ? ext : repl(m)));
    t = t.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k === "ext" ? ext : repl(m)));
    // 把「缺失变量 + 相邻的 - / _ 空格」整段删掉，避免出现 `-单集.mp4` 这种残渣
    t = t.replace(/[\s_\-\/]*\u0000[\s_\-\/]*/g, (mm) => (mm.includes("/") ? "/" : ""));
    t = t.replace(/^[\s_\-\/]+|[\s_\-\/]+$/g, "");
    const parts = String(t).split(/[\\/]+/).map(cleanSeg).filter((p) => p && p !== "." && p !== "..");
    if (!parts.length) parts.push("untitled");
    let last = parts.pop();
    if (!/\.[a-z0-9]{1,5}$/i.test(last)) last += "." + ext;
    last = last.slice(0, 170);
    const prefix = cleanSeg(conf.subDir || "").replace(/^\/+|\/+$/g, "");
    return [prefix, ...parts, last].filter(Boolean).join("/");
  }

  /* ------------------------------------------------------------ 下载 */

  const queue = [];
  let running = 0;
  let paused = false;
  const done = { ok: 0, fail: 0, skip: 0 };
  const failedJobs = [];   // 失败的任务留一份，方便一键重试
  const usedNames = new Set();
  const runningJobs = new Set();   // 正在下载的任务对象（取消全部要标记它们）
  const activeReqs = new Set();    // 在途的 GM_download / GM_xmlhttpRequest 句柄（取消全部要 abort）
  function trackReq(handle) { if (handle) activeReqs.add(handle); return handle; }
  function untrackReq(handle) { if (handle) activeReqs.delete(handle); }

  function unique(name) {
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
    const m = name.match(/^(.*?)(\.[a-z0-9]{1,5})$/i);
    const base = m ? m[1] : name; const ext = m ? m[2] : "";
    for (let i = 1; i < 1000; i++) {
      const cand = base + "-" + i + ext;
      if (!usedNames.has(cand)) { usedNames.add(cand); return cand; }
    }
    return name;
  }

  function dlLog(rec) {
    try {
      window.__bilidlDlLog = window.__bilidlDlLog || [];
      window.__bilidlDlLog.push(Object.assign({ t: Date.now() }, rec));
      if (window.__bilidlDlLog.length > 50) window.__bilidlDlLog.shift();
    } catch (e) {}
  }

  // 从 TM 拿到的响应里取出二进制（不同 TM 版本可能给 Blob / ArrayBuffer / 字符串）
  function toBlob(r, mime) {
    const body = r && r.response;
    if (!body) throw new Error("空响应");
    if (body instanceof Blob) return body;
    if (body instanceof ArrayBuffer) return new Blob([body], { type: mime || "application/octet-stream" });
    if (ArrayBuffer.isView(body)) return new Blob([body.buffer], { type: mime || "application/octet-stream" });
    if (typeof body === "string") return new Blob([body], { type: mime || "text/plain;charset=utf-8" });
    return new Blob([body], { type: mime || "application/octet-stream" });
  }

  // 把 blob 存成文件。要点：保存点击**绝不能让 B站 的 document 级监听看到**，
  // 否则它会把这次点击当成「打开图片」，于是下载成功 + 另外弹一个标签页。
  // 做法：把 <a> 放进一个 closed shadow root 里再派发 click ——
  // composed:false 的事件不会跨出 shadow 边界，document 上的捕获/冒泡监听都收不到。
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const fname = String(name || "download").split("/").pop() || "download";
    const mk = () => {
      const a = document.createElement("a");
      a.download = fname; a.href = url; a.rel = "noopener"; a.style.display = "none";
      a.addEventListener("click", (e) => e.stopPropagation(), true);
      return a;
    };
    let ok = false;
    try {
      const host = document.createElement("div");
      host.style.cssText = "display:none!important";
      (document.body || document.documentElement).appendChild(host);
      const root = host.attachShadow({ mode: "closed" });
      const a = mk();
      root.appendChild(a);
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: false }));
      setTimeout(() => { try { host.remove(); } catch (e) {} }, 3000);
      ok = true;
    } catch (e) { ok = false; }
    if (!ok) {                                    // 极端内核：游离节点直接点
      try { mk().click(); ok = true; } catch (e) { ok = false; }
    }
    if (!ok) {                                    // 最后的兜底（会经过页面监听，但只在前两条都失败时）
      try {
        const a = mk();
        (document.body || document.documentElement).appendChild(a);
        a.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
        a.remove();
      } catch (e) { console.warn("[BiliDL] saveBlob 失败", e); }
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function blobDownload(opt) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") return reject(new Error("缺少 GM_xmlhttpRequest（检查 @grant）"));
      // 不要手动加 Origin / Referer：TM 与浏览器都把它们当受限头，
      // 带上反而可能让请求直接失败（这是 1.2.11 全量下载失败的原因）。
      const headers = Object.assign({}, opt.headers || {});
      let handle = null;
      handle = GM_xmlhttpRequest({
        method: "GET", url: opt.url, headers, responseType: "arraybuffer", timeout: 120000,
        onprogress: (p) => { if (p && p.total) opt.onProgress && opt.onProgress(p.loaded / p.total); },
        onload: (r) => {
          untrackReq(handle);
          const status = (r && r.status) || 0;
          if (status >= 400) return reject(new Error("HTTP " + status));
          try {
            const blob = toBlob(r, opt.mime);
            saveBlob(blob, opt.name);
            dlLog({ name: opt.name, how: "blob", size: blob.size });
            resolve(true);
          } catch (e) { reject(e); }
        },
        onerror: () => { untrackReq(handle); reject(new Error("网络错误（可能被 @connect / 防盗链拦截）")); },
        ontimeout: () => { untrackReq(handle); reject(new Error("下载超时")); },
      });
      trackReq(handle);
    });
  }

  function flatten(name) {
    return String(name || "").replace(/^[\/\\]+|[\/\\]+$/g, "").replace(/[\/\\]+/g, "-");
  }

  function gmDownload(opt) {
    const native = () => new Promise((resolve, reject) => {
      let handle = null;
      handle = GM_download({
        url: opt.url, name: opt.name, headers: opt.headers, saveAs: false,
        onprogress: (p) => { if (p && p.total) opt.onProgress && opt.onProgress(p.loaded / p.total); },
        onload: () => { untrackReq(handle); resolve(true); },
        onerror: (e) => { untrackReq(handle); reject(new Error((e && (e.error || e.details)) || "下载失败")); },
        ontimeout: () => { untrackReq(handle); reject(new Error("下载超时")); },
      });
      trackReq(handle);
    });
    const isVideo = opt.kind === "video";
    if (!isVideo) {
      // 浏览器自身的 a[download] 不支持子目录（"/" 会被替换成 "_"），
      // 所以规则里带 "/" 时改用 GM_download（TM 走 downloads API，支持相对路径）；失败再退回 blob 平铺保存。
      const wantsPath = !!conf.gmSave && typeof GM_download === "function";
      if (wantsPath) {
        return native().then(
          (r) => { dlLog({ name: opt.name, how: "native-path" }); return r; },
          (e) => {
            dlLog({ name: opt.name, how: "native-path-fail", err: String(e && e.message) });
            return blobDownload(Object.assign({}, opt, { name: flatten(opt.name) })).catch((e2) => {
              dlLog({ name: opt.name, how: "blob-fail", err: String(e2 && e2.message) });
              throw e2;
            });
          });
      }
      // 没有子目录：一律 blob，绝不交给 GM_download（避免个别 TM 配置把跨域地址开成标签页）
      return blobDownload(opt).catch((e) => {
        dlLog({ name: opt.name, how: "blob-fail", err: String(e && e.message) });
        throw e;
      });
    }
    return native().then((r) => { dlLog({ name: opt.name, how: "native" }); return r; },
      (e) => {
        dlLog({ name: opt.name, how: "native-fail", err: String(e && e.message) });
        return blobDownload(opt);
      });
  }

  function enqueue(job) {
    queue.push(job);
    renderQueue();
    pump();
  }

  /** 取消全部：清空排队 + 中止在途下载 + 清掉失败/计数，任务不再留在队列里。 */
  function cancelAllJobs() {
    const removed = queue.length + runningJobs.size;
    queue.length = 0;
    failedJobs.length = 0;
    done.ok = done.fail = done.skip = 0;
    for (const job of runningJobs) job.canceled = true;
    for (const handle of [...activeReqs]) {
      try { handle.abort && handle.abort(); } catch (e) { console.warn("[BiliDL] abort", e); }
    }
    activeReqs.clear();
    runningJobs.clear();
    running = 0;   // 句柄 abort 后回调不保证立刻回来，计数先归零
    paused = false;
    const pauseBtn = $("#bilidl-sa-pause");
    if (pauseBtn) pauseBtn.textContent = "暂停";
    renderQueue();
    toast(removed ? "已取消并移除 " + removed + " 个任务" : "下载队列已经是空的");
  }

  function pump() {
    if (paused) return;
    const limit = Math.max(1, Math.min(4, conf.concurrency || 2));
    while (running < limit && queue.length) {
      const job = queue.shift();
      running++;
      job.status = "run"; job.progress = 0;
      runningJobs.add(job);
      renderQueue();
      runJob(job)
        .then((r) => {
          if (job.canceled) return;
          job.status = r === "skip" ? "skip" : "ok";
          if (r === "skip") done.skip++; else done.ok++;
        })
        .catch((e) => {
          if (job.canceled) { job.status = "canceled"; return; }
          job.status = "fail";
          job.error = e && e.message ? e.message : String(e);
          done.fail++;
          failedJobs.push(job);
          console.warn("[BiliDL]", e);
        })
        .finally(async () => {
          runningJobs.delete(job);
          running = Math.max(0, running - 1);
          renderQueue();
          await sleep(rand(conf.interval || 900, (conf.interval || 900) + 600));
          pump();
        });
    }
    if (!running && !queue.length) renderQueue();
  }

  async function runJob(job) {
    const name = unique(job.name);
    await gmDownload({
      url: job.url, name, headers: job.headers, kind: job.kind,
      onProgress: (p) => { job.progress = p; renderQueue(); },
    });
    if (job.extra && !extrasDone.has(job.extra.cid)) {
      extrasDone.add(job.extra.cid);
      try { await extraFiles(job.extra.bvid, job.extra.cid, job.extra.nameFor); } catch (e) { console.warn("[BiliDL] 附加文件失败", e); }
    }
    return "ok";
  }

  const extrasDone = new Set();
  // 供调试/自动化测试用（浏览器控制台可调用）
  try {
    window.__bilidlSA = { extraFiles, dashStreams, conf, gmDownload, renderPath, xmlToSrt, blobDownload, saveBlob, toBlob, buildVideoJobs, buildOpusJobs, buildArticleJobs };
    window.__bilidlSA.getWorkOf = (el) => workOf(el);
  } catch (e) {}

  /* -------------------------------------------------- 解析链接 / 作品 */

  const BV_RE = /BV[0-9A-Za-z]{10}/;
  const AV_RE = /av(\d{1,12})/i;

  function classify(url) {
    if (!url) return null;
    if (/\/opus\/(\d{6,})/.test(url)) return { kind: "opus", ident: url.match(/\/opus\/(\d{6,})/)[1] };
    if (/\/read\/cv(\d{1,12})/.test(url)) return { kind: "article", ident: url.match(/\/read\/cv(\d{1,12})/)[1] };
    if (/t\.bilibili\.com\/(\d{15,})/.test(url)) return { kind: "dynamic", ident: url.match(/t\.bilibili\.com\/(\d{15,})/)[1] };
    const bv = url.match(BV_RE); if (bv) return { kind: "video", ident: bv[0] };
    const av = url.match(AV_RE); if (av) return { kind: "video", ident: "av" + av[1] };
    return null;
  }

  function gmResolve(url) {
    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest !== "function") return resolve(null);
      try {
        GM_xmlhttpRequest({
          method: "GET", url, timeout: 15000,
          onload: (r) => resolve((r && (r.finalUrl || r.responseURL)) || null),
          onerror: () => resolve(null), ontimeout: () => resolve(null),
        });
      } catch (e) { resolve(null); }
    });
  }

  async function resolveShort(url) {
    // b23.tv 等短链：先试 GM_xmlhttpRequest（不受跨域限制），失败再退回 fetch
    const viaGm = await gmResolve(url);
    if (viaGm && viaGm !== url) return viaGm;
    try {
      const r = await fetch(url, { method: "GET", redirect: "follow", credentials: "omit" });
      if (r.url && r.url !== url) return r.url;
    } catch (e) {}
    return url;
  }

  function opusPics(item) {
    const pics = [];
    const add = (u) => {
      let v = String(u || "").trim();
      if (!v) return;
      if (v.startsWith("//")) v = "https:" + v;
      v = v.replace(/^http:\/\/([\w.-]*hdslb\.com\/bfs\/)/i, "https://$1");
      v = v.replace(/@[^/]*$/, "");
      if (v) pics.push(v);
    };
    const mods = (item && item.modules) || [];
    for (const m of mods) {
      // 新版图文（如 /opus/1262380051833290755）把九宫格放在 MODULE_TYPE_TOP 的
      // module_top.display.album.pics 里，正文 module_content 只有文字。
      if (m.module_type === "MODULE_TYPE_TOP") {
        const album = m.module_top && m.module_top.display && m.module_top.display.album;
        for (const pic of (album && album.pics) || []) add(pic && (pic.url || pic.src));
      }
      if (m.module_type === "MODULE_TYPE_CONTENT" && m.module_content) {
        for (const p of m.module_content.paragraphs || []) {
          if (p.para_type === 2 && p.pic && p.pic.pics) for (const pic of p.pic.pics) add(pic && (pic.url || pic.src));
        }
      }
    }
    if (!pics.length && item && item.basic && item.basic.image) {
      const im = item.basic.image;
      add(typeof im === "string" ? im : (im && (im.url || im.src)));
    }
    return [...new Set(pics)];
  }

  function opusTitle(item) {
    let t = "";
    for (const m of (item && item.modules) || []) {
      if (m.module_type === "MODULE_TYPE_TITLE" && m.module_title) t = m.module_title.text || "";
    }
    if (!t && item && item.basic) t = item.basic.title || "";
    return String(t || "图文").replace(/\s*-\s*哔哩哔哩\s*$/, "").trim();
  }

  function opusAuthor(item) {
    for (const m of (item && item.modules) || []) {
      if (m.module_type === "MODULE_TYPE_AUTHOR" && m.module_author) return m.module_author.name || "";
    }
    return "";
  }

  async function buildOpusJobs(work) {
    const d = await opusDetail(work.ident);
    const item = d.item || d;
    const title = work.title || opusTitle(item);
    const author = opusAuthor(item);
    const pics = opusPics(item);
    if (!pics.length) throw new Error("图文里没有找到图片");
    const jobs = [];
    pics.forEach((url, i) => {
      jobs.push({
        kind: "opus", title, url,
        headers: { Referer: "https://www.bilibili.com/opus/" + work.ident, Origin: "https://www.bilibili.com" },
        name: renderPath(conf.opusTpl, { opus_title: title, opus_id: work.ident, opus_order: i + 1, opus_author: author, opus_date: "" }, "jpg"),
        status: "wait",
      });
    });
    return jobs;
  }

  function gmGetText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") return reject(new Error("缺少 GM_xmlhttpRequest"));
      try {
        GM_xmlhttpRequest({
          method: "GET", url, timeout: 20000,
          headers: { Referer: "https://www.bilibili.com/" },
          onload: (r) => resolve(String((r && r.responseText) || "")),
          onerror: () => reject(new Error("网络错误")), ontimeout: () => reject(new Error("超时")),
        });
      } catch (e) { reject(e); }
    });
  }

  async function buildArticleJobs(work) {
    const cv = work.ident;
    // 新版专栏正文是一条动态图文：先用 /x/article/view 拿 dyn_id_str，再用 opus/detail 取全部图片
    let title = work.title || "";
    let urls = [];
    let opusId = "";   // 新版专栏的 <opus_id>（动态图文 id），不是 cv 号
    try {
      const v = await apiGet("https://api.bilibili.com/x/article/view?id=" + cv);
      const vd = (v && (v.data || v)) || {};
      title = title || vd.title || "";
      opusId = String((vd.opus && vd.opus.opus_id) || "").trim();
      const dyn = String(vd.dyn_id_str || "").trim();
      if (!opusId) opusId = dyn;
      if (dyn) {
        const od = await opusDetail(dyn);
        const item = (od && od.item) || od || {};
        urls = opusPics(item);
        if (!title) title = opusTitle(item);
      }
    } catch (e) { /* 老专栏退回抓页面 */ }
    if (!urls.length) {
      const html = await gmGetText("https://www.bilibili.com/read/cv" + cv);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const holder = doc.querySelector(".article-holder, .article-content, #read-article-holder") || doc;
      urls = [...holder.querySelectorAll("img")]
        .map((i) => i.getAttribute("data-src") || i.getAttribute("src") || "")
        .filter((u) => /hdslb\.com\/bfs\//.test(u))
        .map((u) => (u.startsWith("//") ? "https:" + u : u).split("@")[0]);
    }
    const uniq = [...new Set(urls)];
    if (!uniq.length) throw new Error("专栏里没有找到图片");
    title = String(title || ("专栏 " + cv)).trim();
    const rl = work.readlist;
    const varsBase = { opus_title: title, opus_id: opusId || cv, opus_author: "", opus_date: "" };
    return uniq.map((url, i) => {
      const vars = { ...varsBase, opus_order: i + 1 };
      if (rl) { vars.readlist_title = rl.title; vars.readlist_order = rl.order || ""; vars.readlist_id = rl.id; }
      const tpl = rl ? (conf.readlistTpl || DEFAULTS.readlistTpl) : (conf.opusTpl || DEFAULTS.opusTpl);
      return {
        kind: "article", title, url,
        headers: { Referer: "https://www.bilibili.com/read/cv" + cv, Origin: "https://www.bilibili.com" },
        name: renderPath(tpl, vars, "jpg"),
        status: "wait",
      };
    });
  }

  async function buildDynamicJobs(work) {
    const d = await dynamicDetail(work.ident);
    const mods = d.item || d;
    const desc = (mods.modules && mods.modules.module_dynamic && mods.modules.module_dynamic.desc && mods.modules.module_dynamic.desc.text) || "动态";
    const author = (mods.modules && mods.modules.module_author && mods.modules.module_author.name) || "";
    const major = (mods.modules && mods.modules.module_dynamic && mods.modules.module_dynamic.major) || {};
    const pics = [];
    const push = (u) => { if (u) pics.push(String(u).replace(/@[^/]*$/, "")); };
    if (major.opus && major.opus.pics) major.opus.pics.forEach((p) => push(p.url));
    if (major.draw && major.draw.items) major.draw.items.forEach((p) => push(p.src));
    if (major.article && major.article.covers) major.article.covers.forEach(push);
    if (!pics.length) throw new Error("动态里没有图片");
    return pics.map((url, i) => ({
      kind: "opus", title: desc.slice(0, 80), url,
      headers: { Referer: "https://t.bilibili.com/" + work.ident, Origin: "https://t.bilibili.com" },
      name: renderPath(conf.opusTpl, { opus_title: desc.slice(0, 80), opus_id: work.ident, opus_order: i + 1, opus_author: author, opus_date: "" }, "jpg"),
      status: "wait",
    }));
  }

  async function buildVideoJobs(work, pages) {
    const info = await view(work.ident);
    const bvid = info.bvid; const title = work.title || info.title;
    const author = (info.owner && info.owner.name) || "";
    const date = new Date((info.pubdate || 0) * 1000).toISOString().slice(0, 10);
    const all = (info.pages || []).map((p) => ({ page: p.page, cid: p.cid, part: p.part || "" }));
    if (!all.length) throw new Error("视频没有分集信息");
    const wanted = pages && pages.length ? all.filter((p) => pages.includes(p.page)) : all;
    const jobs = [];
    // 合集变量：优先用页面上下文（合集页选中的视频），其次用视频自带的 ugc_season
    let vlInfo = work.videolist || null;
    if (!vlInfo && info.ugc_season && info.ugc_season.title) {
      const eps = [];
      for (const sec of info.ugc_season.sections || []) for (const ep of sec.episodes || []) eps.push(ep.bvid);
      const idx = eps.indexOf(bvid);
      vlInfo = { id: String(info.ugc_season.id || info.ugc_season.season_id || ""), title: info.ugc_season.title, order: idx >= 0 ? idx + 1 : 0 };
    }
    const authorUid = String((info.owner && (info.owner.mid || info.owner.uid)) || "");
    for (const pg of wanted) {
      const vars = {
        video_title: title, video_id: bvid, video_episode: pg.page,
        video_page_title: pg.part || "", video_author: author,
        video_quality: QN_NAME[conf.quality] || conf.quality, video_date: date,
        video_author_uid: authorUid,
      };
      if (vlInfo) {
        vars.videolist_title = vlInfo.title || "";
        vars.videolist_order = vlInfo.order || "";
        vars.videolist_id = vlInfo.id || "";
      }
      const nameFor = (ext, suffix) => {
        let n = renderPath(conf.videoTpl, vars, ext);
        return suffix ? n.replace(/(\.[^.\/]+)$/, "-" + suffix + "$1") : n;
      };
      const refHeaders = { Referer: "https://www.bilibili.com/video/" + bvid, Origin: "https://www.bilibili.com" };
      const partTitle = title + (pg.part ? " · " + pg.part : "");
      const extra = { bvid, cid: pg.cid, nameFor };
      const push = (label, url, name, quality, size) => {
        jobs.push({
          kind: "video", title: label ? partTitle + "（" + label + "）" : partTitle, url,
          headers: refHeaders, name, status: "wait", size: size || 0, quality, extra,
        });
      };

      // 「只下载无声视频」「只下载纯音频」是「替代普通视频」的两个开关，
      // 但两个可以同时勾（各出一份），并且都能和字幕/弹幕/封面/NFO 这些附加文件共存。
      // 以前写成 if / else if，多选时只会出一个文件；现在按勾选逐项产出。
      if (conf.exAudio || conf.exVideoMute) {
        const ds = await dashStreams(bvid, pg.cid, conf.quality).catch(() => null);
        if (conf.exAudio) {
          if (ds && ds.audio) push("音频轨", ds.audio.url, nameFor("m4a", ""), ds.quality, 0);
          else toast("取不到纯音频轨（可能需要登录），已跳过该项", 4000);
        }
        if (conf.exVideoMute) {
          if (ds && ds.video) push("无声", ds.video.url, nameFor("mp4", "mute"), ds.video.quality, 0);
          else toast("取不到无声视频轨（可能需要登录），已跳过该项", 4000);
        }
        continue;
      }

      let stream = null;
      for (const qn of [conf.quality, 80, 64, 32, 16].filter((v, i, a) => a.indexOf(v) === i && v <= conf.quality)) {
        try { stream = await playurl(bvid, pg.cid, qn); } catch (e) { if (/需要登录/.test(e.message)) throw e; }
        if (stream && stream.url) break;
      }
      if (!stream) throw new Error("取不到播放地址（可能需要登录或该清晰度不可用）");

      // 渐进式 MP4 最高只到 720P；1080P / 1080P60 只能拿 DASH 分离流，
      // 浏览器没有 ffmpeg 合不了，于是拆成「视频轨 + 音频轨」两个文件。
      if (stream.quality < conf.quality) {
        let ds = null;
        try { ds = await dashStreams(bvid, pg.cid, conf.quality); } catch (e) { ds = null; }
        if (ds && ds.video && ds.video.quality > stream.quality) {
          push("视频轨", ds.video.url, nameFor("mp4", "v"), ds.video.quality, 0);
          if (ds.audio) push("音频轨", ds.audio.url, nameFor("m4a", "a"), ds.quality, 0);
          toast("「" + (QN_NAME[conf.quality] || conf.quality) + "」需要 DASH：已下载视频轨+音频轨（浏览器无法合并，用 EXE/Docker/APK 版可直接出单文件）", 6000);
          continue;
        }
      }
      push("", stream.url, nameFor("mp4", ""), stream.quality, stream.size);
    }
    return jobs;
  }

  async function addWorks(works) {
    let n = 0;
    for (const w of works) {
      try {
        let jobs = [];
        if (w.kind === "video") jobs = await buildVideoJobs(w);
        else if (w.kind === "opus") jobs = await buildOpusJobs(w);
        else if (w.kind === "dynamic") jobs = await buildDynamicJobs(w);
        else if (w.kind === "article") jobs = await buildArticleJobs(w);
        else throw new Error("暂不支持的链接类型：" + w.kind);
        jobs.forEach(enqueue);
        n += jobs.length;
        toast("已加入 " + jobs.length + " 个下载：" + (w.title || w.ident).slice(0, 20));
      } catch (e) {
        toast("失败：" + (w.title || w.ident).slice(0, 14) + " · " + e.message, 4200);
        pushLog("error", (w.title || w.ident) + "：" + e.message);
      }
    }
    return n;
  }

  /* ------------------------------------------------------------ 日志 */

  const logs = [];
  function pushLog(level, text) {
    logs.unshift({ t: new Date().toLocaleTimeString(), level, text });
    if (logs.length > 120) logs.pop();
    renderQueue();
  }

  /* ---------------------------------------------------- 页面作品扫描 */

  const picked = new Map();
  // 每次打开页面都从「关闭」开始：只有用户在设置窗口里主动勾选才会出现勾选框
  let selMode = false;
  let opicSeq = 0;                     // 图文图片计数用的请求序号（必须在任何调用之前声明）
  let lastPath = location.pathname;

  function workOf(anchor) {
    const href = anchor.getAttribute("href") || "";
    const abs = href.startsWith("//") ? "https:" + href : href;
    const w = classify(abs);
    if (!w) return w;
    // 文集页：给每篇文章补上「文集 id / 标题 / 序号」，下载时才能按文集规则命名
    const rl = location.pathname.match(/\/read\/readlist\/(rl\d+)/i);
    if (rl) {
      const id = rl[1];
      let title = String(document.title || "").replace(/\s*-\s*哔哩哔哩.*$/, "").trim();
      const h = document.querySelector(".read-list-title, .read-list__title, h1");
      if (h && h.textContent.trim()) title = h.textContent.trim();
      const cards = [...document.querySelectorAll("a[href*='/read/cv']")];
      const idx = cards.indexOf(anchor);
      w.readlist = { id, title, order: idx >= 0 ? idx + 1 : 0 };
    }
    // 合集页（space.bilibili.com/<uid>/lists/<id>）：补上合集 id/标题/序号
    const vl = location.pathname.match(/\/lists\/(\d{3,})/i);
    if (vl) {
      const vtitle = (() => {
        const h = document.querySelector(".list-title, .detail-header h1, h1");
        if (h && h.textContent.trim()) return h.textContent.trim();
        return String(document.title || "").replace(/\s*-\s*哔哩哔哩.*$/, "").trim();
      })();
      const cards = [...document.querySelectorAll("a[href*='/video/BV']")];
      const idx = cards.indexOf(anchor);
      w.videolist = { id: vl[1], title: vtitle, order: idx >= 0 ? idx + 1 : 0 };
    }
    return w;
  }

  function cardRootOf(anchor) {
    const hit = anchor.closest(".opus-card, .bili-video-card, .bili-dyn-card-opus, .bili-dyn-list__item");
    if (hit) return hit;
    let el = anchor.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      const w = el.getBoundingClientRect().width;
      if (el.tagName !== "A" && w > 90 && w < window.innerWidth * 0.92 && el.querySelectorAll('a[href*="/opus/"], a[href*="/video/BV"], a[href*="/read/cv"]').length === 1) return el;
      el = el.parentElement;
    }
    return anchor.parentElement;
  }

  function cardTitleOf(root) {
    const t = root.querySelector(".opus-card__title, .bili-video-card__info--tit, h3[title], .bili-dyn-title__text, .title");
    const s = (t && (t.getAttribute("title") || t.textContent)) || root.textContent || "";
    return s.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  // 缩略图容器：勾选框只挂这里 → 永远在缩略图左上角，不压标题
  function thumbOf(anchor, root) {
    const a = anchor.closest("a.bili-cover-card, a.opus-card__cover") || anchor;
    const ar = a.getBoundingClientRect();
    const covers = (el) => !!el && (el === a || el.contains(a)) && el !== root;
    let t = a.parentElement;
    if (!covers(t) || t.getBoundingClientRect().height > Math.max(ar.height * 1.8, 120)) {
      t = ar.width > 60 ? a : null;
    }
    if (t && t.getBoundingClientRect().width < 60) t = null;
    return t;
  }

  function scanCards() {
    const roots = new Map();
    const seenKey = new Set();
    const anchors = document.querySelectorAll('a.bili-cover-card[href], a[href*="/opus/"], a[href*="/video/BV"], a[href*="/read/cv"]');
    anchors.forEach((a) => {
      const w = workOf(a);
      if (!w) return;
      let root = cardRootOf(a);
      if (!root) return;
      // 列表页（文集/列表）里多篇文章可能被算进同一个容器，这里以链接自身为卡片，避免几个作品共用一个勾选框
      const inner = root.querySelectorAll('a.bili-cover-card[href], a[href*="/opus/"], a[href*="/video/BV"], a[href*="/read/cv"]');
      if (inner.length > 1) {
        root = a.closest("a") || a;
        // 这种「一个链接就是一张卡」的列表页，勾选框挂在它自己的封面上
        const img = root.querySelector("img");
        root._bilidlThumb = img ? img.parentElement : root;
      }
      const key = w.kind + ":" + w.ident;
      // 同一作品只保留一张卡（封面链接和标题链接会命中同一个作品）
      if (seenKey.has(key)) return;
      seenKey.add(key);
      root.dataset.bilidlKey = key;
      root.dataset.bilidlKind = w.kind;
      root.dataset.bilidlIdent = w.ident;
      root.dataset.bilidlTitle = cardTitleOf(root);
      if (!root._bilidlThumb) {
        // 优先用封面链接算缩略图（先命中的可能是标题链接，算出来会落在标题上）
        const coverA = root.querySelector("a.bili-cover-card, a.opus-card__cover") || a;
        root._bilidlThumb = thumbOf(coverA, root);
      }
      roots.set(root, w);
    });
    return roots;
  }

  function isPicked(key) { return picked.has(key); }

  function togglePick(card) {
    const key = card.dataset.bilidlKey;
    if (!key) return;
    if (picked.has(key)) { picked.delete(key); card.classList.remove("bilidl-sel"); }
    else {
      picked.set(key, {
        kind: card.dataset.bilidlKind, ident: card.dataset.bilidlIdent,
        title: card.dataset.bilidlTitle || "",
      });
      card.classList.add("bilidl-sel");
    }
    syncSel();
  }

  function clearPicked() {
    picked.clear();
    document.querySelectorAll(".bilidl-sel").forEach((e) => e.classList.remove("bilidl-sel"));
    document.querySelectorAll(".bilidl-ov-on").forEach((e) => { e.classList.remove("bilidl-ov-on"); });
    syncSel();
  }

  function mountOverlays() {
    if (!selMode) return;
    if (window.__bilidlOvOwner && window.__bilidlOvOwner !== "standalone") return;
    if (!window.__bilidlOvOwner) {
      window.__bilidlOvOwner = "standalone";
      document.querySelectorAll(".bilidl-ov").forEach((b) => b.remove());
    }
    scanCards().forEach((w, card) => {
      card.classList.add("bilidl-hit");
      const host = card._bilidlThumb;
      if (!host) return;
      if (!host._bilidlPos) {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host._bilidlPos = true;
      }
      host.querySelectorAll(":scope > .bilidl-ov").forEach((b) => b.remove());
      const box = document.createElement("span");
      box.className = "bilidl-ov";
      box.dataset.key = card.dataset.bilidlKey;
      box.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); togglePick(card); });
      host.appendChild(box);
      const on = picked.has(card.dataset.bilidlKey);
      box.classList.toggle("bilidl-ov-on", on);
      card.classList.toggle("bilidl-sel", on);
    });
    // 清掉重复 / 过期的勾选框：同一作品只留一个
    const keys = new Set([...scanCards().keys()].map((c) => c.dataset.bilidlKey));
    const kept = new Set();
    document.querySelectorAll(".bilidl-ov").forEach((b) => {
      const k = b.dataset.key || ((b.parentElement && b.parentElement.closest("[data-bilidl-key]") || {}).dataset || {}).bilidlKey || "";
      if (!k || !keys.has(k) || kept.has(k) || !b.isConnected) { b.remove(); return; }
      kept.add(k);
    });
    syncSel();
  }

  function clearOverlays() {
    document.querySelectorAll(".bilidl-ov").forEach((e) => e.remove());
    document.querySelectorAll(".bilidl-hit").forEach((e) => e.classList.remove("bilidl-hit"));
    document.querySelectorAll(".bilidl-sel").forEach((e) => e.classList.remove("bilidl-sel"));
  }

  function syncSel() {
    try {
      const b = $("#bilidl-sa-send");
      if (b && !b.dataset.busy) { b.disabled = picked.size === 0; if (/解析中/.test(b.textContent)) b.textContent = "发送下载"; }
    } catch (e) {}
    const n = picked.size;
    const bar = $("#bilidl-sa-selbar");
    if (bar) {
      bar.style.display = selMode && (n || document.querySelector(".bilidl-ov")) ? "flex" : "none";
      const txt = $("#bilidl-sa-selcount");
      if (txt) {
        const v = [...picked.values()].filter((x) => x.kind === "video").length;
        txt.textContent = "已选 " + n + " 个（视频 " + v + " / 图文 " + (n - v) + "）";
      }
      const send = $("#bilidl-sa-send");
      if (send) send.disabled = n === 0;
    }
    const tip = $("#bilidl-sa-tip");
    if (tip) tip.style.display = selMode && document.querySelector(".bilidl-ov") ? "flex" : "none";
  }

  document.addEventListener("click", (e) => {
    if (!selMode) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("#bilidl-sa-panel, #bilidl-sa-selbar, #bilidl-sa-tip, #bilidl-sa-toast")) return;
    if (t.classList.contains("bilidl-ov")) {
      e.preventDefault();
      return;
    }
    const card = t.closest("[data-bilidl-key]");
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    togglePick(card);
  }, true);

  let mountTimer = 0;
  function scheduleMount() {
    clearTimeout(mountTimer);
    mountTimer = setTimeout(() => { if (selMode) mountOverlays(); }, 400);
  }

  refreshOpusCount();
  setTimeout(refreshOpusCount, 2500);
  new MutationObserver(() => { if (selMode) scheduleMount(); }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", () => { if (selMode) scheduleMount(); }, { passive: true });
  // ---- 当前图文 / 专栏的图片总数 ----
  function opicHost() {
    let el = document.getElementById("bilidl-sa-opic");
    if (el) return el;
    el = document.createElement("div");
    el.id = "bilidl-sa-opic";
    el.title = "当前图文/专栏的图片总数";
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 4.6-4.2a2 2 0 0 1 2.7 0L20 20"/></svg>' +
      '<span class="n">0</span><span class="t">张图</span>';
    document.body.appendChild(el);
    return el;
  }
  function opicCountFromModules(mods) {
    let n = 0;
    for (const mo of mods || []) {
      // 新版图文（如 /opus/1262380051833290755）把相册放在 MODULE_TYPE_TOP，
      // 正文 module_content 里只有文字/表情，不能只数 paragraphs。
      if (mo && mo.module_type === "MODULE_TYPE_TOP") {
        const album = mo.module_top && mo.module_top.display && mo.module_top.display.album;
        if (album && Array.isArray(album.pics)) n += album.pics.length;
      }
      const ps = (mo && mo.module_content && mo.module_content.paragraphs) || [];
      for (const p of ps) {
        if (!p) continue;
        if (p.para_type === 2 && p.pic && Array.isArray(p.pic.pics)) n += p.pic.pics.length;
        if (p.para_type === 1 && p.text && Array.isArray(p.text.pics)) n += p.text.pics.length;
      }
    }
    return n;
  }
  function opicCountFromDom(isCv) {
    const sel = isCv
      ? ".article-holder img, #read-article-holder img, .article-content img, .opus-module-content img, .opus-module-top img"
      : ".opus-module-content img, .opus-module-top img, .horizontal-scroll-album img, .bili-album img, .opus-module-content .album img, .opus-card img";
    // B站 的图文页会把同一张图渲染两遍（SSR + 前端 hydration），所以必须按图片地址去重，
    // 否则 10 张图会数成 20 张。这里同时剥掉 @480w_1c 这类缩放后缀。
    // 正文里的 /bfs/emote/ 是文字表情，不是投稿图，不能计入。
    const seen = new Set();
    Array.from(document.querySelectorAll(sel)).forEach((i) => {
      const raw = i.currentSrc || i.src || i.getAttribute("data-src") || "";
      if (!/hdslb\.com\/bfs\//.test(raw)) return;
      if (/\/bfs\/(?:emote|face|garb|pendant|banner|small_dynamic_cover)\//.test(raw)) return;
      seen.add(raw.split("@")[0].split("?")[0]);
    });
    return seen.size;
  }
  async function refreshOpusCount() {
    // 两个脚本同时装时只留一个计数气泡
    if (window.__bilidlOpicOwner && window.__bilidlOpicOwner !== "sa") {
      const mine = document.getElementById("bilidl-sa-opic"); if (mine) mine.style.display = "none";
      return;
    }
    window.__bilidlOpicOwner = "sa";
    const mOpus = location.pathname.match(/\/opus\/(\d{6,})/);
    const mCv = location.pathname.match(/\/read\/cv(\d{1,12})/);
    const box = document.getElementById("bilidl-sa-opic");
    if (!mOpus && !mCv) { if (box) box.style.display = "none"; return; }
    const seq = ++opicSeq;
    let n = opicCountFromDom(!!mCv);          // 先数页面上真实渲染出来的图（最准，且不受接口风控影响）
    if (!n && mOpus) {                         // 页面还没渲染时，退回接口
      try {
        const r = await fetch("https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail?id=" + mOpus[1], { credentials: "include" });
        const txt = await r.text();
        if (txt.trim().startsWith("{")) {
          const j = JSON.parse(txt);
          n = opicCountFromModules((j && j.data && j.data.item && j.data.item.modules) || []);
        }
      } catch (e) {}
    }
    if (seq !== opicSeq) return;
    const el = opicHost();
    el.style.display = n > 0 ? "inline-flex" : "none";
    el.querySelector(".n").textContent = String(n);
  }

  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; picked.clear(); scheduleMount(); refreshOpusCount(); }
  }, 1200);

  /* ------------------------------------------------------------ 登录 */

  let navCache = null;

  async function refreshLogin(show) {
    try {
      const d = await nav();
      navCache = d;
      const txt = $("#bilidl-sa-login");
      if (txt) {
        txt.textContent = d.isLogin ? "已登录：" + (d.uname || "") + "（" + (d.vipStatus === 1 ? "大会员" : "普通") + "）" : "未登录（只能下载 720P 以下）";
        txt.className = "sa-login " + (d.isLogin ? "ok" : "warn");
      }
      return d;
    } catch (e) {
      if (show) toast("登录状态检查失败：" + e.message);
      return null;
    }
  }

  function applyCookie(text) {
    const raw = String(text || "").trim();
    if (!raw) return 0;
    let pairs = [];
    if (raw.startsWith("{")) {
      try {
        const j = JSON.parse(raw);
        const arr = j.cookies || j;
        if (Array.isArray(arr)) pairs = arr.map((c) => [c.name || c.Name, c.value || c.Value]);
      } catch (e) {}
    }
    if (!pairs.length) {
      pairs = raw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
        const i = s.indexOf("=");
        return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : null;
      }).filter(Boolean);
    }
    let n = 0;
    for (const [k, v] of pairs) {
      if (!k) continue;
      try {
        document.cookie = k + "=" + v + "; domain=.bilibili.com; path=/; max-age=15552000; secure";
        n++;
      } catch (e) {}
    }
    return n;
  }

  function qrLogin() {
    const w = window.open("https://passport.bilibili.com/login?gourl=" + encodeURIComponent(location.href), "bilidl_login", "width=460,height=620");
    if (!w) { toast("弹出窗被拦截，请允许弹窗后重试"); return; }
    toast("请在弹出窗口用 B 站 App 扫码，登录后会自动检测");
    let n = 0;
    const timer = setInterval(async () => {
      n++;
      const d = await refreshLogin(false);
      if (d && d.isLogin) {
        clearInterval(timer);
        try { w.close(); } catch (e) {}
        toast("登录成功：" + (d.uname || ""));
        renderPanel();
      } else if (n > 150) clearInterval(timer);
    }, 2000);
  }

  function logout() {
    ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid"].forEach((k) => {
      document.cookie = k + "=; domain=.bilibili.com; path=/; max-age=0";
    });
    toast("已清除登录 Cookie");
    setTimeout(() => refreshLogin(true), 500);
  }

  /* ------------------------------------------------------------ 面板 */

  let panelBuilt = false;

  function buildPanel() {
    if (panelBuilt) return;
    panelBuilt = true;
    const qopt = QUALITY.map(([n, v]) => `<option value="${v}"${v === conf.quality ? " selected" : ""}>${n}</option>`).join("");
    const wrap = document.createElement("div");
    wrap.id = "bilidl-sa-wrap";
    wrap.innerHTML = `
      <div id="bilidl-sa-fab" title="BiliDL 独立版">⬇</div>
      <div id="bilidl-sa-tip">选择模式已开：点卡片或缩略图选中，右下角「发送下载」</div>
      <div id="bilidl-sa-selbar">
        <span id="bilidl-sa-selcount">已选 0 个</span>
        <button id="bilidl-sa-selall" class="ghost">全选本页</button>
        <button id="bilidl-sa-selclear" class="ghost">清空</button>
        <button id="bilidl-sa-send">发送下载</button>
      </div>
      <div id="bilidl-sa-panel">
        <div class="sa-head"><b>BiliDL 独立版</b><span id="bilidl-sa-ver">v1.2.41</span><button id="bilidl-sa-close" class="ghost">×</button></div>

        <div class="sa-sec">
          <div class="sa-h">账号</div>
          <div id="bilidl-sa-login" class="sa-login warn">未登录（只能下载 720P 以下）</div>
          <div class="sa-row">
            <button id="bilidl-sa-qr">B站 App 扫码登录</button>
            <button id="bilidl-sa-check" class="ghost">刷新状态</button>
            <button id="bilidl-sa-logout" class="ghost">退出登录</button>
          </div>
          <textarea id="bilidl-sa-cookie" rows="2" placeholder="手动粘贴 Cookie，例如 SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx"></textarea>
          <div class="sa-row"><button id="bilidl-sa-cookiebtn">用 Cookie 登录</button><span class="sa-note">只写进本机浏览器 Cookie，不上传</span></div>
        </div>

        <div class="sa-sec">
          <div class="sa-h">下载设置</div>
          <div class="sa-l" style="margin-top:8px">下载哪些文件（可多选，默认正常有声视频）</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;margin-bottom:6px">
            <label><input type="checkbox" id="bilidl-sa-exaudio" /> 纯音频</label>
            <label><input type="checkbox" id="bilidl-sa-exmute" /> 无声视频</label>
            <label><input type="checkbox" id="bilidl-sa-exsub" /> 字幕SRT</label>
            <label><input type="checkbox" id="bilidl-sa-exdm" /> 弹幕SRT</label>
            <label><input type="checkbox" id="bilidl-sa-excover" /> 封面</label>
            <label><input type="checkbox" id="bilidl-sa-exnfo" /> NFO</label>
          </div>
          <label class="sa-l">清晰度<select id="bilidl-sa-quality">${qopt}</select></label>
          <label class="sa-l">下载子目录（浏览器默认下载目录下）<input id="bilidl-sa-subdir" type="text" value="${esc(conf.subDir)}" placeholder="BiliDL"></label>
          <label class="sa-l">视频重命名规则<textarea id="bilidl-sa-vtpl" rows="2">${esc(conf.videoTpl)}</textarea></label>
          <div class="sa-note">变量：&lt;video_title&gt; 视频标题 · &lt;video_id&gt; BV号 · &lt;video_episode&gt; 分集序号 · &lt;video_page_title&gt; 分集标题 · &lt;video_author&gt; UP主 · &lt;video_author_uid&gt; UP主UID · &lt;video_quality&gt; 清晰度 · &lt;video_date&gt; 日期 · &lt;videolist_title&gt; 合集标题 · &lt;videolist_order&gt; 合集内序号 · &lt;videolist_id&gt; 合集ID · &lt;ext&gt; 扩展名（不在合集时 videolist 三项自动忽略；写 / 可建子文件夹）</div>
          <label class="sa-l">图文重命名规则<textarea id="bilidl-sa-otpl" rows="2">${esc(conf.opusTpl)}</textarea></label>
          <label class="sa-l">文集重命名规则<textarea id="bilidl-sa-rtpl" rows="2">${esc(conf.readlistTpl || DEFAULTS.readlistTpl)}</textarea></label>
          <div class="sa-note">文集变量：&lt;readlist_title&gt; 文集标题 · &lt;readlist_order&gt; 文集内文章序号 · &lt;readlist_id&gt; 文集ID（rl…），另外沿用 &lt;opus_title&gt;/&lt;opus_id&gt;/&lt;opus_order&gt;/&lt;ext&gt;；写 / 可建子文件夹</div>
            <label class="sa-l" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="bilidl-sa-gmsave" ${conf.gmSave ? "checked" : ""}> 用 GM_download 保存小文件（规则里的 / 才能建子目录；个别环境会弹新标签）</label>
          <div class="sa-note">变量：&lt;opus_title&gt; 标题 · &lt;opus_id&gt; 图文id · &lt;opus_order&gt; 图片序号 · &lt;opus_author&gt; 作者 · &lt;ext&gt; 扩展名。规则里写 <b>/</b> 会在子目录下再建文件夹。</div>
          <label class="sa-l">评论/动态图片重命名规则<textarea id="bilidl-sa-ctpl" rows="2">${esc(cmtTpl)}</textarea></label>
          <div class="sa-note">变量：&lt;author&gt; 评论者/主播昵称 · &lt;video_id&gt; 视频BV号 · &lt;comment_id&gt; 评论id · &lt;order&gt; 图片序号 · &lt;ext&gt; 扩展名。默认 &lt;author&gt;-&lt;video_id&gt;-&lt;comment_id&gt;-&lt;order&gt;.&lt;ext&gt;。</div>
          <label class="sa-l">同时下载数<input id="bilidl-sa-conc" type="number" min="1" max="4" value="${conf.concurrency}"></label>
          <label class="sa-l">每个文件之间的间隔（毫秒）<input id="bilidl-sa-interval" type="number" min="0" max="20000" step="100" value="${conf.interval}"></label>
          <div class="sa-row"><button id="bilidl-sa-save">保存设置</button>
          <button id="bilidl-sa-reset">恢复默认</button><span class="sa-note">浏览器只能存到默认下载目录，子目录用文件名前缀实现</span></div>
        </div>

        <div class="sa-sec">
          <div class="sa-h">页面多选</div>
          <label class="sa-tgl"><input id="bilidl-sa-selmode" type="checkbox"> 开启多选模式（点缩略图即选中）</label>
          <div class="sa-note">在 UP 主空间的「图文 / 视频」页勾选作品后点「发送下载」。默认关闭，不影响正常浏览。</div>
        </div>

        <div class="sa-sec">
          <div class="sa-h">当前页面</div>
          <div class="sa-row"><button id="bilidl-sa-cur" class="primary">下载本页作品</button><span class="sa-note" id="bilidl-sa-curnote">自动识别本页的视频 / 图文 / 专栏</span></div>
        </div>

        <div class="sa-sec">
          <div class="sa-h">粘贴链接下载</div>
          <textarea id="bilidl-sa-links" rows="2" placeholder="每行一个：视频 / opus / 专栏 / b23.tv 短链"></textarea>
          <div class="sa-row"><button id="bilidl-sa-linkgo">解析并下载</button><span class="sa-note">支持一次多条</span></div>
        </div>

        <div class="sa-sec">
          <div class="sa-h">队列 <span id="bilidl-sa-qstat" class="sa-note"></span></div>
          <div id="bilidl-sa-queue" class="sa-q"></div>
          <div class="sa-row"><button id="bilidl-sa-pause" class="ghost">暂停</button><button id="bilidl-sa-cancelall" class="ghost">取消全部</button><button id="bilidl-sa-clearq" class="ghost">清除已完成</button><button id="bilidl-sa-retry" class="ghost">重试失败</button></div>
        </div>

        <div class="sa-sec">
          <div class="sa-h">日志</div>
          <div id="bilidl-sa-logs" class="sa-q"></div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    // 关键样式也写死在元素上：B站 页面若拦掉 <style> 或压 z-index，面板照样能弹出来
    const saFab = $("#bilidl-sa-fab");
    const saPanel = $("#bilidl-sa-panel");
    Object.assign(saFab.style, { position: "fixed", right: "14px", bottom: "16px", width: "40px", height: "40px",
      borderRadius: "50%", background: "#fb7299", color: "#fff", border: "0", cursor: "pointer", fontSize: "18px",
      lineHeight: "40px", textAlign: "center", opacity: ".85", zIndex: "2147483000", padding: "0",
      boxShadow: "0 4px 14px rgba(0,0,0,.35)" });
    Object.assign(saPanel.style, { position: "fixed", right: "14px", bottom: "64px", width: "372px",
      maxWidth: "92vw", maxHeight: "76vh", overflow: "auto", background: "#171c24", color: "#e6edf3",
      border: "1px solid #2b3442", borderRadius: "14px", padding: "14px", display: "none",
      zIndex: "2147483001", boxShadow: "0 18px 50px rgba(0,0,0,.5)", fontSize: "13px", lineHeight: "1.6",
      boxSizing: "border-box" });

    let saPanelWanted = false;
    function setSaPanel(open) {
      const want = typeof open === "boolean" ? open : !saPanel.classList.contains("on");
      saPanelWanted = want;
      saPanel.classList.toggle("on", want);
      saPanel.style.display = want ? "block" : "none";
      if (want) { try { renderPanel(); refreshLogin(false); } catch (e) { console.warn("[BiliDL] 面板渲染失败", e); } }
    }

    // 一次真实点击会同时触发 mousedown 兜底和 click，如果两边都 toggle 就会「打开后立刻关闭」。
    // 统一走这个去抖的开关。
    let lastFabAt = 0;
    function toggleSaPanel() {
      const now = Date.now();
      if (now - lastFabAt < 400) return;
      lastFabAt = now;
      setSaPanel();
    }
    saFab.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleSaPanel(); });
    ["mousedown", "pointerdown"].forEach((ev) => {
      document.addEventListener(ev, (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("#bilidl-sa-fab")) {
          try { e.stopPropagation(); } catch (err) {}
          if (ev === "mousedown") toggleSaPanel();
        }
      }, true);
    });
    try {
      window.__bilidlSA = window.__bilidlSA || {};
      window.__bilidlSA.version = "1.2.7";
      window.__bilidlSA.openPanel = () => setSaPanel(true);
      window.__bilidlSA.closePanel = () => setSaPanel(false);
      window.__bilidlSA.state = () => ({ cls: saPanel.className, display: saPanel.style.display,
        rect: saPanel.getBoundingClientRect(), errors: window.__bilidlErrors || [] });
      window.__bilidlOpenPanel = () => setSaPanel(true);
      window.__bilidlErrors = window.__bilidlErrors || [];
      window.addEventListener("error", (e) => { window.__bilidlErrors.push(String(e.message)); }, true);
      window.addEventListener("unhandledrejection", (e) => { window.__bilidlErrors.push("promise: " + String(e.reason)); }, true);
    } catch (err) {}
    // 面板自愈：B站 的全局点击监听 / SPA 重渲染 / 别家脚本都可能把面板关掉或整块移除。
    // 只要用户没主动关，就每隔 700ms 检查并把面板恢复回来。
    setInterval(() => {
      if (!saPanelWanted) return;
      try {
        if (saPanel.isConnected === false) {
          const host = document.getElementById("bilidl-sa-wrap") || saPanel.parentElement;
          if (host && host.isConnected === false) (document.body || document.documentElement).appendChild(host);
        }
        if (saPanel.style.display !== "block") {
          saPanel.style.display = "block";
          saPanel.classList.add("on");
        }
      } catch (e) {}
    }, 700);

    saPanel.addEventListener("click", (e) => e.stopPropagation());
    $("#bilidl-sa-close").addEventListener("click", (e) => { e.preventDefault(); setSaPanel(false); });
    $("#bilidl-sa-check").addEventListener("click", () => refreshLogin(true));
    $("#bilidl-sa-qr").addEventListener("click", qrLogin);
    $("#bilidl-sa-logout").addEventListener("click", logout);
    $("#bilidl-sa-cookiebtn").addEventListener("click", () => {
      const n = applyCookie($("#bilidl-sa-cookie").value);
      if (!n) return toast("没解析到 Cookie");
      toast("已写入 " + n + " 条 Cookie，正在校验…");
      setTimeout(async () => {
        const d = await refreshLogin(false);
        if (d && d.isLogin) toast("登录成功：" + (d.uname || ""));
        else toast("仍未登录：扫码登录更可靠（SESSDATA 若为 HttpOnly 无法用脚本写入）", 4200);
      }, 900);
    });
    $("#bilidl-sa-save").addEventListener("click", () => {
      saveConf({
        quality: Number($("#bilidl-sa-quality").value) || 116,
        subDir: $("#bilidl-sa-subdir").value.trim(),
        videoTpl: $("#bilidl-sa-vtpl").value.trim() || DEFAULTS.videoTpl,
        opusTpl: $("#bilidl-sa-otpl").value.trim() || DEFAULTS.opusTpl,
        readlistTpl: (($("#bilidl-sa-rtpl") || {}).value || "").trim() || DEFAULTS.readlistTpl,
        gmSave: !!($("#bilidl-sa-gmsave") || {}).checked,
        concurrency: Math.max(1, Math.min(4, Number($("#bilidl-sa-conc").value) || 2)),
        interval: Math.max(0, Math.min(20000, Number($("#bilidl-sa-interval").value) || 0)),
        exAudio: $("#bilidl-sa-exaudio").checked,
        exVideoMute: $("#bilidl-sa-exmute").checked,
        exSub: $("#bilidl-sa-exsub").checked,
        exDm: $("#bilidl-sa-exdm").checked,
        exCover: $("#bilidl-sa-excover").checked,
        exNfo: $("#bilidl-sa-exnfo").checked,
      });
      cmtSave($("#bilidl-sa-ctpl").value);
      renderPanel();
      toast("设置已保存（下次打开页面仍然生效）");
    });
    const resetBtn = $("#bilidl-sa-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => {
      if (!confirm("恢复全部设置为默认值？（重命名规则、清晰度、下载目录等）")) return;
      store.reset(Object.keys(DEFAULTS));
      Object.assign(conf, DEFAULTS);
      try { localStorage.removeItem(CMT_KEY); GM_setValue(CMT_KEY, CMT_DEFAULT); } catch (e) {}
      cmtTpl = CMT_DEFAULT;
      renderPanel();
      toast("已恢复默认设置");
    });
    $("#bilidl-sa-selmode").addEventListener("change", (e) => setSelMode(e.target.checked));
    $("#bilidl-sa-selclear").addEventListener("click", clearPicked);
    $("#bilidl-sa-selall").addEventListener("click", () => {
      scanCards().forEach((w, card) => {
        const key = card.dataset.bilidlKey;
        if (!picked.has(key)) {
          picked.set(key, { kind: card.dataset.bilidlKind, ident: card.dataset.bilidlIdent, title: card.dataset.bilidlTitle || "" });
          card.classList.add("bilidl-sel");
        }
      });
      syncSel();
      toast("已选中本页 " + picked.size + " 个作品");
    });
    $("#bilidl-sa-send").addEventListener("click", () => {
      const list = [...picked.values()];
      if (!list.length) return;
      const btn = $("#bilidl-sa-send");
      const restore = () => { btn.textContent = "发送下载"; btn.disabled = picked.size === 0; };
      // 不在这里 await：把作品加入队列是后台动作，界面要立刻恢复，
      // 否则网络一慢按钮就卡在「解析中…」，没法继续挑下一批。
      btn.textContent = "解析中…";
      clearPicked();
      restore();
      Promise.resolve()
        .then(() => addWorks(list))
        .then((n) => toast("已加入 " + n + " 个下载任务"))
        .catch((e) => toast("加入队列失败：" + (e && e.message ? e.message : e), 4200))
        .finally(restore);
    });
    $("#bilidl-sa-pause").addEventListener("click", (e) => {
      paused = !paused;
      e.target.textContent = paused ? "继续" : "暂停";
      if (!paused) pump();
    });
    $("#bilidl-sa-clearq").addEventListener("click", () => { done.ok = done.fail = done.skip = 0; renderQueue(); });
    $("#bilidl-sa-cancelall").addEventListener("click", () => { cancelAllJobs(); });
    $("#bilidl-sa-retry").addEventListener("click", () => {
      if (!failedJobs.length) { toast("没有失败的任务"); return; }
      const n = failedJobs.length;
      failedJobs.forEach((job) => {
        job.status = "wait";
        job.progress = 0;
        job.error = "";
        queue.push(job);
      });
      failedJobs.length = 0;
      done.fail = 0;
      toast("已重新排队 " + n + " 个失败任务");
      renderQueue();
      pump();
    });
    $("#bilidl-sa-cur").addEventListener("click", async () => {
      const w = classify(location.href.split("#")[0]);
      const note = $("#bilidl-sa-curnote");
      if (!w) { if (note) note.textContent = "当前页面不是视频 / 图文 / 专栏页"; return toast("当前页面没有可下载的作品"); }
      const title = String(document.title || "").replace(/\s*-\s*哔哩哔哩.*$/, "").trim();
      try {
        await addWorks([{ ...w, title }]);
        if (note) note.textContent = "已加入队列：" + (w.kind === "video" ? w.ident : "图文 " + w.ident);
        toast("已加入下载队列");
      } catch (e) { toast("加入队列失败：" + (e && e.message ? e.message : e)); }
    });
    $("#bilidl-sa-linkgo").addEventListener("click", async () => {
      const raw = $("#bilidl-sa-links").value.split(/[\s\n]+/).map((s) => s.trim()).filter(Boolean);
      if (!raw.length) return toast("先粘贴链接");
      const works = [];
      for (const u of raw) {
        let url = u;
        if (/b23\.tv|bili2233/.test(u)) url = await resolveShort(u);
        const w = classify(url);
        if (w) works.push({ ...w, title: "" }); else pushLog("warn", "无法识别：" + u);
      }
      if (!works.length) return toast("没有识别到可下载的链接");
      await addWorks(works);
    });
    $("#bilidl-sa-quality").addEventListener("change", () => {});
    $("#bilidl-sa-selmode").checked = selMode;
    renderPanel();
    refreshLogin(false);
  }

  function renderPanel() {
    const q = $("#bilidl-sa-quality");
    if (q) q.value = String(conf.quality);
    const sd = $("#bilidl-sa-subdir"); if (sd) sd.value = conf.subDir;
    const vt = $("#bilidl-sa-vtpl"); if (vt) vt.value = conf.videoTpl;
    const ot = $("#bilidl-sa-otpl"); if (ot) ot.value = conf.opusTpl;
    const rt = $("#bilidl-sa-rtpl"); if (rt) rt.value = conf.readlistTpl || DEFAULTS.readlistTpl;
    const gs = $("#bilidl-sa-gmsave"); if (gs) gs.checked = !!conf.gmSave;
    const cc = $("#bilidl-sa-conc"); if (cc) cc.value = conf.concurrency;
    const iv = $("#bilidl-sa-interval"); if (iv) iv.value = conf.interval;
    const ct = $("#bilidl-sa-ctpl"); if (ct) ct.value = cmtTpl;
    const map = { "bilidl-sa-exaudio": conf.exAudio, "bilidl-sa-exmute": conf.exVideoMute, "bilidl-sa-exsub": conf.exSub,
      "bilidl-sa-exdm": conf.exDm, "bilidl-sa-excover": conf.exCover, "bilidl-sa-exnfo": conf.exNfo };
    for (const [id, value] of Object.entries(map)) { const el = $("#" + id); if (el) el.checked = !!value; }
    renderQueue();
  }

  function renderQueue() {
    const box = $("#bilidl-sa-queue");
    if (box) {
      const items = [];
      const active = queue.filter((j) => j.status === "run" || j.status === "wait").slice(0, 12);
      for (const j of active) {
        items.push(`<div class="sa-qitem"><span class="sa-qn">${esc(j.name.split("/").pop())}</span>
          <span class="sa-qs ${j.status}">${j.status === "run" ? Math.round((j.progress || 0) * 100) + "%" : "等待"}</span></div>`);
      }
      box.innerHTML = items.join("") || '<div class="sa-note">暂无任务</div>';
      const st = $("#bilidl-sa-qstat");
      if (st) st.textContent = `完成 ${done.ok} · 失败 ${done.fail} · 队列 ${queue.length} · 进行中 ${running}`;
    }
    const lb = $("#bilidl-sa-logs");
    if (lb) {
      lb.innerHTML = logs.map((l) => `<div class="sa-log ${l.level}"><span>${l.t}</span> ${esc(l.text)}</div>`).join("") || '<div class="sa-note">暂无日志</div>';
    }
  }

  function setSelMode(on, silent) {
    selMode = !!on;
    saveConf({ selMode });
    const cb = $("#bilidl-sa-selmode");
    if (cb) cb.checked = selMode;
    if (selMode) scheduleMount();
    else { clearPicked(); clearOverlays(); }
    syncSel();
    if (!silent) toast(selMode ? "多选模式已开启：点卡片即可选中" : "多选模式已关闭");
  }

  /* ------------------------------------------------ 评论图片下载（共用模块） */

  const isLive = /(^|\.)live\.bilibili\.com$/i.test(location.hostname);
  const liveRoomId = (() => {
    try {
      const m = location.pathname.match(/^\/(\d+)/);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  })();

  const cmtToast = (m) => {
    if (typeof toast === "function") { try { toast(m); return; } catch (e) {} }
    let el = document.querySelector("#bilidl-cmt-toast");
    if (!el) { el = document.createElement("div"); el.id = "bilidl-cmt-toast"; el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:90px;z-index:100001;background:#0e1218;color:#fff;border:1px solid #2b3240;border-radius:8px;padding:8px 14px;font-size:13px"; document.body.appendChild(el); }
    el.textContent = m; el.style.display = "block";
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = "none"; }, 2600);
  };

  const CMT_KEY = "cmtTpl";
  const CMT_DEFAULT = "<author>-<video_id>-<comment_id>-<order>.<ext>";
  let cmtTpl = (() => {
    let v;
    try { v = GM_getValue(CMT_KEY, undefined); } catch (e) {}
    if (!v) { try { v = localStorage.getItem(CMT_KEY) || undefined; } catch (e) {} }
    return String(v || CMT_DEFAULT);
  })();

  function cmtSave(tpl) {
    cmtTpl = String(tpl || "").trim() || CMT_DEFAULT;
    try { GM_setValue(CMT_KEY, cmtTpl); } catch (e) {}
    try { localStorage.setItem(CMT_KEY, cmtTpl); } catch (e) {}
  }

  const CMT_ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

  function cmtClean(s) {
    return String(s == null ? "" : s).replace(CMT_ILLEGAL, "_").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 120);
  }

  function cmtRender(vars, ext) {
    let t = String(cmtTpl).replace(/<([a-zA-Z0-9_]+)>/g, (m, k) => (k === "ext" ? ext : (vars[k] == null ? "" : String(vars[k]))));
    const parts = t.split(/[\\/]+/).map(cmtClean).filter((p) => p && p !== "." && p !== "..");
    if (!parts.length) parts.push("comment");
    let last = parts.pop();
    if (!/\.[a-z0-9]{1,5}$/i.test(last)) last += "." + ext;
    return parts.concat(last.slice(0, 170)).join("/");
  }

  const CMT_SEL = 'img[src*="hdslb.com"], source[srcset*="hdslb.com"]';
  // 头像 / 表情 / 装扮 / 等级 / 认证 这类「不是用户投稿的图」的 URL 特征
  const CMT_DENY = /\/bfs\/(face|emote|garb|vip|pendant|static|small_dynamic_cover)\/|noface|\/bfs\/.*(avatar|emote)/i;
  // 用户在评论区真发的图：new_dyn（新版评论图/动态图）与 comment（旧版评论图）
  const CMT_USER_PIC = /\/bfs\/(new_dyn|comment)\//i;

  const CMT_ATTRS = ["src", "data-src", "data-original", "data-fail-src", "srcset", "data-srcset", "href", "poster"];

  function cmtNorm(u) { return cmtNormWith(u, CMT_DENY); }

  function cmtNormWith(u, deny) {
    let v = String(u || "").trim();
    if (!v) return "";
    v = v.replace(/^url\((['"]?)/, "").replace(/(['"]?)\)$/, "").trim();
    // srcset 可能是 "a.jpg 1x, b.jpg 2x"：取最后一项（分辨率最高）
    if (v.indexOf(",") >= 0) {
      const cands = v.split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
      v = cands[cands.length - 1] || "";
    } else {
      v = v.split(/\s+/)[0];
    }
    if (!v) return "";
    if (v.startsWith("//")) v = "https:" + v;
    // B站部分图片地址是 http://i0.hdslb.com/...，统一升到 https 再校验
    v = v.replace(/^http:\/\/([\w.-]*hdslb\.com\/bfs\/)/i, "https://$1");
    if (!/^https:\/\/[\w.-]*hdslb\.com\/bfs\//i.test(v)) return "";
    if (deny.test(v) || /\.svg(\?|$)/i.test(v)) return "";
    return v.replace(/@[^/]*$/, "");
  }

  // 一张图可能有多个属性/多种承载方式（懒加载 data-src、srcset、background-image、灯箱 <a href>），全部收一遍
  function cmtPicUrl(el) {
    // DOM 位置排除：表情图、头像、等级牌、挂件、用户名区域
    try {
      if (el.closest('[class*="emote"], [class*="emoji"], [class*="avatar"], [class*="user-name"], [class*="userinfo"], [class*="level-icon"], [class*="badge"], [class*="pendant"], [class*="face"]')) return "";
    } catch (e) {}
    for (const a of CMT_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const u = cmtNorm(v); if (u) return u; }
    }
    const bg = (el.style && el.style.backgroundImage) || "";
    if (bg) { const u = cmtNorm(bg); if (u) return u; }
    return "";
  }

  function cmtCollect(node) {
    const raw = [];
    const seen = new Set();
    const push = (u) => { if (u && !seen.has(u)) { seen.add(u); raw.push(u); } };
    const grab = (root) => {
      let els = [];
      try { els = root.querySelectorAll("*"); } catch (e) { return; }
      els.forEach((el) => {
        // 背景图元素即使没有 img 标签也算
        const bg = el.style && el.style.backgroundImage;
        if (!el.getAttribute) return;
        const hasPicAttr = CMT_ATTRS.some((a) => el.getAttribute(a));
        if (!hasPicAttr && !bg) return;
        push(cmtPicUrl(el));
      });
    };
    // 递归穿透多层 shadow DOM（评论 renderer → pictures renderer → img）
    const walk = (root, depth) => {
      if (!root || depth > 8) return;
      grab(root);
      if (root.shadowRoot) walk(root.shadowRoot, depth + 1);
      try { root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) walk(el, depth + 1); }); } catch (e) {}
    };
    walk(node, 0);
    // 只要「用户发的图」：优先 new_dyn / comment 目录，实在没有才退回宽松结果
    const strict = raw.filter((u) => CMT_USER_PIC.test(u));
    return strict.length ? strict : raw;
  }


  // 主播动态：每条动态一个按钮，下载该动态相册里的全部图片。
  function dynPics(node) {
    const out = [];
    const seen = new Set();
    const add = (v) => {
      if (!v) return;
      const u = cmtNorm(v);
      if (!u || seen.has(u)) return;
      seen.add(u);
      out.push(u);
    };
    try {
      node.querySelectorAll(".dyn-card-opus__pics img, .bili-album__preview__picture img").forEach((el) => {
        for (const a of ["src", "data-src", "data-original"]) add(el.getAttribute && el.getAttribute(a));
      });
      node.querySelectorAll(".dyn-card-opus__pics source, .bili-album__preview__picture source").forEach((el) => {
        const ss = (el.getAttribute && (el.getAttribute("srcset") || el.getAttribute("data-srcset"))) || "";
        add(ss.split(",")[0].trim().split(/\s+/)[0]);
      });
    } catch (e) {}
    return out;
  }

  function dynMountIn(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.getAttribute("data-bilidl-dyn") === "1") return;
    const pics = dynPics(node);
    if (!pics.length) return;
    const host = node.querySelector(".bili-dyn-item__body") || node;
    const btn = document.createElement("div");
    btn.className = "bilidl-cmt bilidl-dyn";
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.title = "保存这条动态的图片（" + pics.length + " 张）";
    btn.innerHTML = cmtBtnHTML(pics.length, false);
    const go = (e) => { e.preventDefault(); e.stopPropagation(); cmtDownload(node, btn, dynPics, "动态图片"); };
    btn.addEventListener("click", go);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") go(e);
    });
    host.appendChild(btn);
    node.setAttribute("data-bilidl-dyn", "1");
  }

  function dynScanAll() {
    let items = [];
    try { items = document.querySelectorAll(".bili-dyn-item"); } catch (e) { return; }
    items.forEach(dynMountIn);
  }

  function cmtBtnHTML(n, done) {
    const icon = done
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10.5"/><path d="m7.6 10 4.4 4.4 4.4-4.4"/><path d="M4.5 19h15"/></svg>';
    return icon + '<span class="t">' + (done ? "已保存" : "保存图片") + "</span><em>" + n + "</em>";
  }

  try { window.__bilidlCMT = { collect: cmtCollect, picUrl: cmtPicUrl, render: cmtRender, btn: cmtBtnHTML, full: cmtFullPics, dbg: () => ({ id: null, map: Object.keys(cmtPicsByRpid), pics: cmtPicsByRpid }), idOf: cmtIdFrom, load: cmtLoadMap }; } catch (e) {}

  function cmtAuthor(node) {
    if (isLive) {
      const el = node && node.querySelector && (node.querySelector(".bili-dyn-title__text") || node.querySelector(".user-name"));
      return el ? String(el.textContent || "").trim() : "";
    }
    const SEL = "#user-name, .user-name, [class*='user-name'], .bili-comment-user-info-name, .name";
    const pick = (root) => {
      const el = root.querySelector ? root.querySelector(SEL) : null;
      return el ? (el.getAttribute("title") || el.textContent || "").trim() : "";
    };
    const deep = (root, depth) => {
      if (!root || depth > 4) return "";
      let a = pick(root);
      if (a) return a;
      const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of nodes) {
        if (el.shadowRoot) { a = deep(el.shadowRoot, depth + 1); if (a) return a; }
      }
      return "";
    };
    let a = deep(node, 0);
    if (!a && node.shadowRoot) a = deep(node.shadowRoot, 0);
    return a;
  }

  function cmtIdFrom(node) {
    if (isLive) {
      if (node && node.classList && node.classList.contains("bili-dyn-item")) {
        const title = (node.querySelector(".bili-dyn-title__text") || {}).textContent || "";
        const time = (node.querySelector(".bili-dyn-time") || {}).textContent || "";
        const pic = dynPics(node)[0] || "";
        const seed = title.trim() + "|" + time.trim() + "|" + pic;
        let h = 0;
        for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
        return "dyn" + (h >>> 0).toString(36);
      }
      return "";
    }
    let id = "";
    const scan = (root) => {
      root.querySelectorAll("*").forEach((el) => {
        for (const at of el.attributes || []) {
          if (!id && /^(data-)?(rpid|comment-?id|id)$/i.test(at.name) && /^\d{10,}$/.test(at.value)) id = at.value;
        }
        if (!id && el.shadowRoot) scan(el.shadowRoot);
      });
    };
    scan(node);
    if (!id && node.shadowRoot) scan(node.shadowRoot);
    if (!id) {
      try { const d = node.__data__ || node.data || node.comment; if (d && d.rpid) id = String(d.rpid); } catch (e) {}
    }
    return id;
  }

  let cmtBvid = isLive ? ("live" + (liveRoomId || "room")) : (location.href.match(/BV[0-9A-Za-z]{10}/) || [""])[0];
  let cmtMap = null;

  const cmtPicsByRpid = {};

  // 九宫格只显示 8 张、第 9 张藏在「+1」里时，DOM 里根本拿不到那张；
  // 评论接口的 content.pictures 是权威列表，用它补全。
  async function cmtFullPics(node, domPics) {
    try {
      const rpid = cmtIdFrom(node);
      await cmtLoadMap();
      let api = rpid ? cmtPicsByRpid[rpid] : null;
      if (!api) {
        // rpid 超过 2^53 时 JSON 解析会掉精度，退一步用图片 URL 反查这条评论
        const hit = domPics.map((u) => cmtMap && cmtMap[u]).find(Boolean);
        if (hit) api = cmtPicsByRpid[String(hit.rpid)];
      }
      if (api && api.length > domPics.length) return api;
    } catch (e) {}
    return domPics;
  }

  let cmtMapPromise = null;
  // 并发调用共用同一个请求，避免第二次直接拿到空对象
  async function cmtLoadMap() {
    if (cmtMap) return cmtMap;
    if (!cmtMapPromise) cmtMapPromise = _cmtLoadMap().catch(() => (cmtMap = cmtMap || {}));
    return cmtMapPromise;
  }

  async function _cmtLoadMap() {
    if (cmtMap) return cmtMap;
    cmtMap = {};
    try {
      // aid 来源：页面里的 __INITIAL_STATE__（评论区页面可能没有 BV 号）或 view 接口
      const st = window.__INITIAL_STATE__ || {};
      let aid = st.aid || (st.videoData && st.videoData.aid) || 0;
      const bv = cmtBvid || (location.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/) || [])[1] || "";
      if (!aid && bv) {
        const info = await (await fetch("https://api.bilibili.com/x/web-interface/view?bvid=" + bv, { credentials: "include" })).json();
        aid = info && info.data && info.data.aid;
      }
      if (!aid) return cmtMap;
      for (let pn = 1; pn <= 3; pn++) {
        const r = await (await fetch(`https://api.bilibili.com/x/v2/reply?oid=${aid}&type=1&pn=${pn}&ps=20&sort=2&nohot=1`, { credentials: "include" })).json();
        const list = (r && r.data && r.data.replies) || [];
        if (!list.length) break;
        for (const c of list) {
          const pics = (c.content && c.content.pictures) || [];
          const urls = pics.map((p) => String(p.img_src || "").replace(/@[^/]*$/, ""));
          const rec = { rpid: String(c.rpid_str || c.rpid), uname: (c.member && c.member.uname) || "" };
          urls.forEach((u) => { if (u) cmtMap[u] = rec; });
          if (urls.length) cmtPicsByRpid[String(c.rpid_str || c.rpid)] = urls;
          // 楼中楼里的图也算这条评论的
          const sub = (c.replies || []).concat((c.reply_control && []) || []);
          sub.forEach((sc) => {
            const sp = ((sc.content || {}).pictures) || [];
            const su = sp.map((x) => String(x.img_src || "").replace(/@[^/]*$/, "")).filter(Boolean);
            if (su.length && sc.rpid) {
              const key = String(c.rpid_str || c.rpid);
              const cur = cmtPicsByRpid[key] || [];
              cmtPicsByRpid[key] = Array.from(new Set(cur.concat(su)));
            }
          });
        }
        await new Promise((r2) => setTimeout(r2, 700));
      }
    } catch (e) { console.warn("[BiliDL] 评论映射获取失败", e); }
    return cmtMap;
  }

  function cmtButtonLabel(n) { return cmtBtnHTML(n, false); }

  function cmtDownload(node, btn, picsFn, extra) {
    const label = extra || "评论图片";
    const isDyn = !!picsFn;
    let pics = (picsFn || cmtCollect)(node);
    if (!pics.length) return cmtToast("这条" + label.replace(/图片$/, "") + "没有找到图片");
    btn.disabled = true;
    const author = cmtAuthor(node);
    let cid = cmtIdFrom(node);
    const go = async () => {
      // 动态图已经在 DOM 里，直接下；视频评论才需要补 API 原图。
      if (!isDyn) {
        pics = await cmtFullPics(node, pics);
        if (!cid) {
          const map = await cmtLoadMap();
          const hit = pics.map((u) => map && map[u]).find(Boolean);
          if (hit) { cid = hit.rpid; }
        }
      }
      const vars = { author: author || (isDyn ? "主播" : "评论者"), video_id: cmtBvid || "", comment_id: cid || "unknown" };
      let ok = 0;
      for (let i = 0; i < pics.length; i++) {
        const m = String(pics[i]).match(/\.(gif|png|webp|jpe?g|avif)(?:\?|$)/i);
        const ext = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
        const mime = ext === "png" ? "image/png" : (ext === "gif" ? "image/gif" : (ext === "webp" ? "image/webp" : (ext === "avif" ? "image/avif" : "image/jpeg")));
        const name = cmtRender({ ...vars, order: i + 1 }, ext);
        try {
          await gmDownload({ url: pics[i], name, kind: "image", mime });
          ok++;
        } catch (e) { console.warn("[BiliDL] " + label + "失败", e); }
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
      }
      btn.innerHTML = cmtBtnHTML(ok + "/" + pics.length, true);
      btn.disabled = false;
      cmtToast(label + "：已提交 " + ok + "/" + pics.length + " 个下载");
    };
    go();
  }

  const cmtMounted = new Set();
  const cmtNoPicAt = new WeakMap();   // 上次确认「这条评论还没图」的时间

  function cmtMountIn(node) {
    if (!node || node.nodeType !== 1) return;
    const isComment = /^BILI-COMMENT-RENDERER$/i.test(node.tagName) ||
      (typeof node.className === "string" && /(^|\s)(reply-item|comment-item|sub-reply-item|reply-wrap)(\s|$)/.test(node.className));
    if (!isComment) return;                       // 只在「评论卡片」本身挂一次，避免重复按钮
    const nodeId = cmtIdFrom(node) || "";
    const key = "c" + (nodeId || (node.className || "") + "@" + (node.compareDocumentPosition && node.__bilidlSeq || Math.random()));
    if (nodeId && cmtMounted.has(key)) return;    // 同一条评论只挂一个按钮
    // 没有图的评论别每 500ms 都把整棵子树重扫一遍；1.5 秒后允许再试（图片是懒加载的）
    const missAt = cmtNoPicAt.get(node) || 0;
    if (missAt && Date.now() - missAt < 1500) return;
    const pics = cmtCollect(node);
    // 图片是懒加载的，这一刻可能还没 src。不能在此之前就记为 mounted，
    // 否则后续扫描永远跳过这条评论，按钮要等很久（或永远）才出现。
    if (!pics.length) {
      cmtNoPicAt.set(node, Date.now());
      return;
    }
    if (nodeId) cmtMounted.add(key);
    const host = node.shadowRoot || node;
    if (node.shadowRoot) cmtObserve(node.shadowRoot);
    // 同一条评论所在的那棵 shadow 树里只保留一个按钮
    const scope = node.shadowRoot || (node.getRootNode ? node.getRootNode() : null);
    if (scope && scope.querySelector && scope.querySelector(".bilidl-cmt")) return;
    // 按钮在 shadow DOM 里，document 上的样式穿不透，得把这个样式表也送进 shadow root
    if (node.shadowRoot && !node.shadowRoot.querySelector('style[data-bilidl-cmt]')) {
      const css = (document.getElementById("bilidl-cmt-style") || {}).textContent || "";
      const sc = document.createElement("style");
      sc.setAttribute("data-bilidl-cmt", "");
      sc.textContent = css;
      try { node.shadowRoot.appendChild(sc); } catch (e) {}
    }
    const btn = document.createElement("button");
    btn.className = "bilidl-cmt";
    btn.type = "button";
    btn.innerHTML = cmtButtonLabel(pics.length);
    cmtFullPics(node, pics).then((full) => {
      if (full && full.length > pics.length) btn.innerHTML = cmtButtonLabel(full.length);
    }).catch(() => {});
    btn.title = "下载这条评论里的全部图片/动图原图";
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); cmtDownload(node, btn); }, true);
    try { host.appendChild(btn); } catch (e) { node.appendChild(btn); }
  }

  function cmtScanAll() {
    if (isLive) { dynScanAll(); return; }
    const walk = (root) => {
      if (!root) return;
      root.querySelectorAll("bili-comment-renderer, [class*='reply-item'], [class*='comment-item']").forEach((el) => cmtMountIn(el));
      if (root.querySelectorAll) root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) { cmtObserve(el.shadowRoot); walk(el.shadowRoot); }
      });
    };
    walk(document);
    const host = document.querySelector("bili-comments");
    if (host && host.shadowRoot) {
      cmtObserve(host.shadowRoot);
      host.shadowRoot.querySelectorAll("bili-comment-renderer").forEach((el) => cmtMountIn(el));
    }
  }

  // 节流而不是防抖：B站 页面 DOM 一直在变，防抖会被无限重置，按钮要等几分钟才出来
  let cmtTimer = 0;
  let cmtLastScan = 0;
  function cmtSchedule() {
    if (cmtTimer) return;
    const wait = Math.max(0, 500 - (Date.now() - cmtLastScan));
    cmtTimer = setTimeout(() => {
      cmtTimer = 0;
      cmtLastScan = Date.now();
      cmtScanAll();
    }, wait);
  }

  // 评论卡片和图片都在 shadow DOM 里，document 上的 MutationObserver 看不到；
  // 给每棵 shadowRoot 单独挂一个，并监听 src/srcset/style，懒加载一写进去就能触发扫描。
  const cmtObserved = new WeakSet();
  const cmtMo = new MutationObserver(() => cmtSchedule());
  function cmtObserve(root) {
    if (!root || cmtObserved.has(root)) return;
    cmtObserved.add(root);
    try {
      cmtMo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "data-src", "data-original", "data-fail-src", "srcset", "data-srcset", "style"],
      });
    } catch (e) {}
  }

  function cmtInjectCss() {
    const st = document.createElement("style");
    st.id = "bilidl-cmt-style";
    st.textContent = `
      .bilidl-cmt{display:inline-flex;align-items:center;gap:6px;margin:7px 0 3px;padding:5px 12px;border-radius:99px;
        background:linear-gradient(135deg,#fb7299,#ff9dc0);color:#2a0a14;border:none;font-size:12px;line-height:1.5;
        font-weight:600;font-family:inherit;cursor:pointer;z-index:60;box-shadow:0 2px 10px rgba(251,114,153,.28);
        transition:transform .15s,box-shadow .15s,filter .15s}
      .bilidl-cmt:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(251,114,153,.42);filter:brightness(1.05)}
      .bilidl-cmt:active{transform:translateY(0)}
      .bilidl-cmt svg{flex:0 0 auto;display:block}
      .bilidl-cmt .t{letter-spacing:.2px}
      .bilidl-cmt em{font-style:normal;background:rgba(0,0,0,.20);border-radius:99px;padding:0 7px;font-size:11px;
        line-height:17px;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}
      .bilidl-cmt:disabled{opacity:.75;cursor:default;transform:none}
      /* 主播动态：每条动态一个按钮，放在正文下方 */
      .bilidl-dyn{margin:8px 0 0;padding:3px 10px;font-size:11px;box-shadow:none}
      .bilidl-dyn .t{display:inline}`;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ 样式 */

  function injectCss() {
    const css = `
    #bilidl-sa-opic{position:fixed;right:14px;bottom:68px;z-index:99998;display:none;align-items:center;gap:6px;
      padding:6px 11px;border-radius:99px;background:rgba(23,28,36,.94);color:#fff;font-size:12px;line-height:1;
      border:1px solid #2b3240;box-shadow:0 6px 18px rgba(0,0,0,.35);user-select:none}
    #bilidl-sa-opic svg{color:#fb7299}
    #bilidl-sa-opic .n{font-weight:700;font-size:13px;color:#fb7299;font-variant-numeric:tabular-nums}
    #bilidl-sa-opic .t{color:#b9c3d1}
    #bilidl-sa-fab{position:fixed;right:14px;bottom:16px;width:40px;height:40px;border-radius:50%;background:#fb7299;color:#fff;
      display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;z-index:99999;opacity:.55;
      box-shadow:0 4px 14px rgba(0,0,0,.35);transition:opacity .2s,transform .2s}
    #bilidl-sa-fab:hover{opacity:1;transform:scale(1.06)}
    #bilidl-sa-panel{display:none;position:fixed;right:14px;bottom:64px;width:372px;max-height:76vh;overflow:auto;
      background:#171c24;color:#e6e9ef;border:1px solid #2b3240;border-radius:12px;z-index:99998;padding:12px;
      font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5)}
    #bilidl-sa-panel.on{display:block}
    #bilidl-sa-panel .sa-head{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid #262d3a;margin-bottom:8px}
    #bilidl-sa-panel .sa-head b{font-size:14px;color:#fff}
    #bilidl-sa-ver{font-size:11px;color:#8b97a8;border:1px solid #2f3846;border-radius:99px;padding:0 6px}
    #bilidl-sa-close{margin-left:auto}
    #bilidl-sa-panel .sa-sec{margin:10px 0 14px}
    #bilidl-sa-panel .sa-h{font-size:12px;color:#9aa6b8;margin-bottom:6px;letter-spacing:.4px}
    #bilidl-sa-panel .sa-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
    #bilidl-sa-panel .sa-l{display:flex;flex-direction:column;gap:4px;margin:6px 0;font-size:12px;color:#aab4c4}
    #bilidl-sa-panel .sa-tgl{display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer}
    #bilidl-sa-panel .sa-note{font-size:11px;color:#7d8798;line-height:1.5}
    #bilidl-sa-panel input[type=text],#bilidl-sa-panel input[type=number],#bilidl-sa-panel select,
    #bilidl-sa-panel textarea{background:#0f141b;border:1px solid #2b3240;color:#e6e9ef;border-radius:7px;padding:6px 8px;
      font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;width:100%;box-sizing:border-box}
    #bilidl-sa-panel button{background:#fb7299;border:none;color:#fff;border-radius:7px;padding:6px 12px;font-size:12px;cursor:pointer}
    #bilidl-sa-panel button.ghost{background:#232b38;color:#cfd7e3}
    #bilidl-sa-panel button:disabled{opacity:.45;cursor:default}
    .sa-login{font-size:12px;padding:5px 8px;border-radius:7px;background:#222a36}
    .sa-login.ok{color:#8fe3a1}
    .sa-login.warn{color:#ffcc7a}
    .sa-q{max-height:130px;overflow:auto;font-size:11px;color:#98a4b6}
    .sa-qitem{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px dashed #232b38}
    .sa-qn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px}
    .sa-qs{color:#8fa0b8}
    .sa-qs.run{color:#fb7299}
    .sa-qs.ok{color:#8fe3a1}
    .sa-qs.fail{color:#ff8b8b}
    .sa-log{padding:1px 0}
    .sa-log.error{color:#ff9b9b}
    .sa-log.warn{color:#ffd08a}
    #bilidl-sa-tip{display:none;position:fixed;left:16px;top:76px;z-index:99997;background:#171c24;color:#e6e9ef;
      border:1px solid #2b3240;border-radius:8px;padding:6px 10px;font:12px/1.5 -apple-system,"Microsoft YaHei",sans-serif}
    #bilidl-sa-selbar{display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:99998;
      background:#171c24;border:1px solid #2b3240;border-radius:99px;padding:7px 10px;gap:8px;align-items:center;
      font:13px/1.4 -apple-system,"Microsoft YaHei",sans-serif;color:#e6e9ef;box-shadow:0 8px 30px rgba(0,0,0,.45)}
    #bilidl-sa-selbar button{background:#fb7299;border:none;color:#fff;border-radius:99px;padding:5px 12px;font-size:12px;cursor:pointer}
    #bilidl-sa-selbar button.ghost{background:#232b38;color:#cfd7e3}
    #bilidl-sa-selbar button:disabled{opacity:.5;cursor:default}
    #bilidl-sa-toast{position:fixed;left:50%;transform:translateX(-50%) translateY(20px);bottom:74px;z-index:100000;
      background:#0e1218;color:#fff;border:1px solid #2b3240;border-radius:8px;padding:8px 14px;font-size:12.5px;
      opacity:0;pointer-events:none;transition:.22s;max-width:70vw}
    #bilidl-sa-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
    .bilidl-hit{position:relative}
    .bilidl-ov{position:absolute;left:8px;top:8px;width:26px;height:26px;border-radius:7px;background:rgba(20,24,32,.55);
      border:2px solid rgba(255,255,255,.85);z-index:95;cursor:pointer;display:block;box-sizing:border-box}
    .bilidl-ov-on{background:#fb7299;border-color:#fff}
    .bilidl-ov-on::after{content:"✓";position:absolute;left:0;right:0;top:-1px;text-align:center;color:#fff;font-size:17px;font-weight:700}
    .bilidl-sel{outline:2.5px solid #fb7299;outline-offset:-2px;border-radius:8px}
    `;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------ 启动 */

  function boot() {
    injectCss();
    buildPanel();
    cmtInjectCss();
    cmtSchedule();
    // 首屏/懒加载兜底：前几秒多扫几次，不依赖某一次 DOM 变化
    [300, 900, 1800, 3500, 6000].forEach((ms) => setTimeout(cmtSchedule, ms));
    if (isLive) {
      const feed = document.querySelector(".room-feed, .bili-dyn-list");
      if (feed) cmtObserve(feed);
    }
    new MutationObserver(() => cmtSchedule()).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", () => cmtSchedule(), { passive: true });
    if (selMode) scheduleMount();
    try {
      if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand("打开 BiliDL 设置面板", () => { $("#bilidl-sa-panel").classList.add("on"); renderPanel(); });
      GM_registerMenuCommand("切换多选模式", () => setSelMode(!selMode));
    } catch (err) {
      console.warn("[BiliDL] GM_registerMenuCommand 不可用，跳过菜单项", err && err.message);
    }
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
