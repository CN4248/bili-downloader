"""自动追更（订阅）：定时扫描选定 UP 主，有新视频 / 新图文就自动下载。

防风控是这里的第一约束，所有设计都围绕它：

* **串行扫描**：任何时刻只有一个订阅在请求列表接口，绝不并发翻页；
* **两次扫描之间强制空档**（`min_gap`，默认 90 秒）+ 随机抖动，订阅再多也不会变成扫描风暴；
* **翻页延迟**复用「下载设置 → 空间检索间隔」（默认 1.6 秒/页）；
* **引擎冷却时直接跳过**：一旦下载侧命中风控，订阅扫描自动让路；
* **每轮限量**：单次最多下载 `max_new` 个作品（默认 20），剩下的留到下一轮；
* **不请求高风险接口**：视频列表走 App 端接口，图文走 opus feed，与批量检索完全一致。
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from . import api
from .errors import BiliError, ParseError, RiskControl
from .models import AuthorWork

DEFAULT_INTERVAL = 600  # 默认 10 分钟扫一次（与 bili-sync 默认一致）
MIN_INTERVAL = 120  # 允许的最短间隔（秒）
DEFAULT_MAX_NEW = 20  # 单轮最多下载多少个作品
DEFAULT_MIN_GAP = 90  # 两次订阅扫描之间的最小空档（秒）
MAX_SCAN_PAGES = 40  # 定时扫描最多翻多少页（避免每次全量翻到底）
SEEN_LIMIT = 600  # 每个频道记住多少个已处理作品


def _now() -> float:
    return time.time()


def _clamp_int(value: Any, low: int, high: int, default: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _channel(kind: str) -> dict[str, Any]:
    return {
        "enabled": True,
        "dir": "",
        "since": "",
        "since_title": "",
        "since_time": 0,
        "template": "",
        "seen": [],
        "last_new": 0,
        "last_message": "",
        "last_error": "",
        # 过滤规则（与 bili-sync 的过滤规则对齐）：关键词包含 / 排除，视频时长上下限（秒，0=不限）
        "filters": {"include": "", "exclude": "", "min_dur": 0, "max_dur": 0},
    }


def _blank_sub() -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:10],
        # 订阅类型：up=UP 主投稿 / fav=收藏夹 / bangumi=番剧影视 / toview=稍后再看
        "kind": "up",
        "target": "",
        "mid": "",
        "name": "",
        "face": "",
        "enabled": True,
        "interval": 0,
        "video": _channel("video"),
        "opus": _channel("opus"),
        "last_check": 0.0,
        "created": _now(),
        "checking": False,
    }


class Subscriber:
    """订阅存储 + 定时扫描调度器。"""

    def __init__(self, engine, path: Path) -> None:
        self.engine = engine
        self.path = Path(path)
        self.data: dict[str, Any] = {
            "enabled": True,
            "interval": DEFAULT_INTERVAL,
            "max_new": DEFAULT_MAX_NEW,
            "min_gap": DEFAULT_MIN_GAP,
            "subs": [],
        }
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._last_scan = 0.0
        self._closed = False
        self._load()

    # ------------------------------------------------------------------ 存储
    def _load(self) -> None:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        for key in ("enabled", "interval", "max_new", "min_gap"):
            if key in raw:
                self.data[key] = raw[key]
        subs = raw.get("subs")
        if isinstance(subs, list):
            self.data["subs"] = [self._normalize_sub(item) for item in subs if isinstance(item, dict)]
        self._normalize_config()

    def _save(self) -> None:
        payload = {
            "enabled": bool(self.data["enabled"]),
            "interval": int(self.data["interval"]),
            "max_new": int(self.data["max_new"]),
            "min_gap": int(self.data["min_gap"]),
            "subs": self.data["subs"],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def _normalize_config(self) -> None:
        self.data["enabled"] = bool(self.data.get("enabled", True))
        self.data["interval"] = _clamp_int(self.data.get("interval"), MIN_INTERVAL, 7 * 24 * 3600, DEFAULT_INTERVAL)
        self.data["max_new"] = _clamp_int(self.data.get("max_new"), 1, 200, DEFAULT_MAX_NEW)
        self.data["min_gap"] = _clamp_int(self.data.get("min_gap"), 30, 3600, DEFAULT_MIN_GAP)

    def _normalize_sub(self, raw: dict[str, Any]) -> dict[str, Any]:
        sub = _blank_sub()
        sub["id"] = str(raw.get("id") or sub["id"])
        sub["mid"] = str(raw.get("mid") or "").strip()
        sub["name"] = str(raw.get("name") or "").strip()
        sub["face"] = str(raw.get("face") or "").strip()
        sub["enabled"] = bool(raw.get("enabled", True))
        sub["interval"] = _clamp_int(raw.get("interval"), 0, 7 * 24 * 3600, 0)
        sub["last_check"] = float(raw.get("last_check") or 0.0)
        sub["created"] = float(raw.get("created") or _now())
        sub["kind"] = str(raw.get("kind") or "up")
        if sub["kind"] not in ("up", "fav", "bangumi", "toview", "lists", "readlist"):
            sub["kind"] = "up"
        sub["target"] = str(raw.get("target") or "")[:120]
        for kind in ("video", "opus"):
            src = raw.get(kind) if isinstance(raw.get(kind), dict) else {}
            ch = sub[kind]
            ch["enabled"] = bool(src.get("enabled", True))
            ch["dir"] = str(src.get("dir") or "").strip()
            ch["since"] = str(src.get("since") or "").strip()
            ch["since_title"] = str(src.get("since_title") or "").strip()
            ch["since_time"] = int(src.get("since_time") or 0)
            ch["template"] = str(src.get("template") or "").strip()[:400]
            seen = src.get("seen")
            ch["seen"] = [str(x) for x in seen][:SEEN_LIMIT] if isinstance(seen, list) else []
            ch["last_new"] = int(src.get("last_new") or 0)
            ch["last_message"] = str(src.get("last_message") or "")
            ch["last_error"] = str(src.get("last_error") or "")
            filt = src.get("filters") if isinstance(src.get("filters"), dict) else {}
            ch["filters"] = {
                "include": str(filt.get("include") or "")[:200],
                "exclude": str(filt.get("exclude") or "")[:200],
                "min_dur": _clamp_int(filt.get("min_dur"), 0, 24 * 3600, 0),
                "max_dur": _clamp_int(filt.get("max_dur"), 0, 24 * 3600, 0),
            }
        return sub

    # ------------------------------------------------------------------ 生命周期
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def close(self) -> None:
        self._closed = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except BaseException:  # noqa: BLE001 - 关停时不关心异常
                pass

    # ------------------------------------------------------------------ 查询
    def interval_of(self, sub: dict[str, Any]) -> int:
        own = int(sub.get("interval") or 0)
        return own if own >= MIN_INTERVAL else int(self.data["interval"])

    def _next_run(self) -> float:
        """距离下一次自动扫描还有多少秒（0 表示马上就该扫）。"""
        if not self.data["enabled"]:
            return -1.0
        now = _now()
        times = []
        for sub in self.data["subs"]:
            if not sub.get("enabled"):
                continue
            if not (sub["video"]["enabled"] or sub["opus"]["enabled"]):
                continue
            due = float(sub.get("last_check") or 0.0) + self.interval_of(sub)
            times.append(max(0.0, due - now))
        if not times:
            return -1.0
        wait = min(times)
        gap = self.data["min_gap"] - (now - self._last_scan)
        return max(wait, gap, 0.0)

    def snapshot(self) -> dict[str, Any]:
        subs = []
        for sub in self.data["subs"]:
            item = json.loads(json.dumps(sub))
            item["interval_effective"] = self.interval_of(sub)
            subs.append(item)
        return {
            "config": {
                "enabled": bool(self.data["enabled"]),
                "interval": int(self.data["interval"]),
                "max_new": int(self.data["max_new"]),
                "min_gap": int(self.data["min_gap"]),
                "min_interval": MIN_INTERVAL,
            },
            "subs": subs,
            "next_run": self._next_run(),
            "last_scan": self._last_scan,
            "now": _now(),
        }

    # ------------------------------------------------------------------ 增删改
    async def upsert(self, payload: dict[str, Any]) -> dict[str, Any]:
        sid = str(payload.get("id") or "").strip()
        sub = None
        for item in self.data["subs"]:
            if item["id"] == sid:
                sub = item
                break
        created = sub is None
        if created:
            sub = _blank_sub()
            self.data["subs"].append(sub)

        skind = str(payload.get("kind") or sub.get("kind") or "up").strip()
        if skind not in ("up", "fav", "bangumi", "toview", "lists", "readlist"):
            raise ParseError("订阅类型只能是 up / fav / bangumi / toview / lists / readlist")
        if skind != sub.get("kind"):
            sub["kind"] = skind
            sub["target"] = ""
            sub["name"] = ""
        if "target" in payload:
            sub["target"] = str(payload["target"] or "").strip()[:120]

        mid = str(payload.get("mid") or "").strip()
        if not mid:
            digits = "".join(ch for ch in str(payload.get("url") or "") if ch.isdigit())
            mid = digits[:12]
        if mid and mid.isdigit() and mid != sub["mid"]:
            sub["mid"] = mid
            sub["name"] = ""
            sub["face"] = ""
        if skind == "up" and not sub["mid"]:
            raise ParseError("请填写 UP 主 ID 或空间链接")
        if skind in ("fav", "bangumi") and not sub["target"]:
            raise ParseError("请填写收藏夹 media_id" if skind == "fav" else "请填写番剧 season_id 或链接")
        if skind == "lists" and (not sub["mid"] or not sub["target"]):
            raise ParseError("请填写合集链接，例如 https://space.bilibili.com/601598/lists/6413356")
        if skind == "readlist" and not sub["target"]:
            raise ParseError("请填写文集链接，例如 https://www.bilibili.com/read/readlist/rl1099181")
        if skind == "readlist":
            m = re.search(r"(rl\d+)", sub["target"], re.I)
            if m:
                sub["target"] = m.group(1).lower()

        if "name" in payload and payload["name"]:
            sub["name"] = str(payload["name"]).strip()
        if "enabled" in payload:
            sub["enabled"] = bool(payload["enabled"])
        if "interval" in payload:
            sub["interval"] = _clamp_int(payload["interval"], 0, 7 * 24 * 3600, 0)

        reset = False
        for kind in ("video", "opus"):
            patch = payload.get(kind)
            if not isinstance(patch, dict):
                continue
            ch = sub[kind]
            for key in ("since", "since_title"):
                if key in patch:
                    ch[key] = str(patch.get(key) or "").strip()
            if "template" in patch:
                ch["template"] = str(patch.get("template") or "").strip()[:400]
            if "dir" in patch:
                new_dir = str(patch.get("dir") or "").strip()
                old_dir = str(ch.get("dir") or "")
                if new_dir != old_dir:
                    moved = await self._move_dir(kind, old_dir, new_dir)
                    if moved:
                        self.engine.log(
                            f"订阅目录已迁移：{old_dir or '（全局）'} → {new_dir or '（全局）'}（{moved} 个文件）",
                            "ok",
                        )
                ch["dir"] = new_dir
            if "since_time" in patch:
                ch["since_time"] = int(patch.get("since_time") or 0)
            if "enabled" in patch:
                ch["enabled"] = bool(patch["enabled"])
            if isinstance(patch.get("filters"), dict):
                f = patch["filters"]
                ch["filters"] = {
                    "include": str(f.get("include") or "").strip()[:200],
                    "exclude": str(f.get("exclude") or "").strip()[:200],
                    "min_dur": _clamp_int(f.get("min_dur"), 0, 24 * 3600, 0),
                    "max_dur": _clamp_int(f.get("max_dur"), 0, 24 * 3600, 0),
                }
            if "since" in patch:
                ch["seen"] = []
                reset = True

        if skind == "readlist":
            # 文集是图文源：只开图文通道
            sub["video"]["enabled"] = False
            sub["opus"]["enabled"] = True
            if not sub["name"]:
                try:
                    info = await api.readlist_detail(self.engine.session, sub["target"])
                    sub["name"] = str(info.get("title") or f"文集 {sub['target']}")
                except BiliError:
                    sub["name"] = f"文集 {sub['target']}"
        elif skind != "up":
            sub["opus"]["enabled"] = False
            if not sub["name"]:
                if skind == "lists":
                    try:
                        info = await api.videolist_detail(
                            self.engine.session, sub["mid"], sub["target"], max_pages=1
                        )
                        sub["name"] = str(info.get("title") or f"合集 {sub['target']}")
                    except BiliError:
                        sub["name"] = f"合集 {sub['target']}"
                else:
                    sub["name"] = {"fav": "收藏夹", "bangumi": "番剧", "toview": "稍后再看"}[skind]
        if skind == "up" and (created or not sub["name"]):
            try:
                card = await api.user_card(self.engine.session, sub["mid"])
                sub["name"] = sub["name"] or str(card.get("name") or "")
                sub["face"] = sub["face"] or str(card.get("face") or "")
            except BiliError:
                sub["name"] = sub["name"] or f"UID {sub['mid']}"
        if reset:
            sub["last_check"] = 0.0
        if created:
            sub["last_check"] = 0.0
        self._save()
        self.engine.log(
            f"{'新增' if created else '更新'}订阅：{sub['name'] or sub['mid']}", "ok"
        )
        return json.loads(json.dumps(sub))

    async def _move_dir(self, kind: str, old_dir: str, new_dir: str) -> int:
        """订阅目录变更时，把旧目录里的全部文件/文件夹搬到新目录。返回搬了多少个文件。

        安全约束：
        * 旧目录为空（用全局目录）或新目录为空（改回全局）时不搬，避免把全局下载根目录整个搬走；
        * 旧目录 == 全局视频/图文根目录时不搬（只改订阅路径），并写 WARN；
        * 新旧目录互相包含时直接拒绝（会把目录搬进自己里面）。
        """
        if not old_dir or not new_dir or old_dir == new_dir:
            return 0
        old = Path(old_dir).expanduser()
        new = Path(new_dir).expanduser()
        if not old.exists() or not old.is_dir():
            return 0
        settings = self.engine.store.get()
        root = Path(settings.video_dir if kind == "video" else settings.opus_dir).expanduser()
        try:
            if old.resolve() == root.resolve() or root.resolve().is_relative_to(old.resolve()):
                self.engine.log(
                    f"旧目录就是/包含了全局下载根目录（{old}），未自动搬移；只更新订阅路径，文件请手动整理", "warn"
                )
                return 0
            if new.resolve() == old.resolve() or new.resolve().is_relative_to(old.resolve()) or old.resolve().is_relative_to(new.resolve()):
                raise ParseError("新旧目录不能互相包含（不能把目录搬进它自己里面）")
        except OSError:
            pass
        moved = await asyncio.to_thread(self._merge_move, old, new)
        try:
            old.rmdir()   # 只有空目录才会成功
        except OSError:
            pass
        return moved

    @staticmethod
    def _merge_move(src: Path, dst: Path) -> int:
        """递归合并搬移：同名目录合并，同名文件加 -1 后缀，绝不覆盖已有文件。"""
        from .naming import unique_path

        dst.mkdir(parents=True, exist_ok=True)
        moved = 0
        for entry in list(src.iterdir()):
            target = dst / entry.name
            if entry.is_dir():
                if target.exists() and not target.is_dir():
                    target = unique_path(dst, entry.name)
                moved += Subscriber._merge_move(entry, target)
                try:
                    entry.rmdir()
                except OSError:
                    pass
            else:
                if target.exists():
                    target = unique_path(dst, entry.name)
                shutil.move(str(entry), str(target))
                moved += 1
        return moved

    def batch(self, payload: dict[str, Any]) -> dict[str, Any]:
        """批量开启 / 关闭 / 删除订阅（前端多选后一次提交）。"""
        action = str(payload.get("action") or "")
        if action not in ("enable", "disable", "delete"):
            raise ParseError("批量操作只能是 enable / disable / delete")
        ids = {str(x) for x in (payload.get("ids") or []) if str(x)}
        if not ids:
            raise ParseError("没有选择订阅")
        if action == "delete":
            before = len(self.data["subs"])
            self.data["subs"] = [s for s in self.data["subs"] if s["id"] not in ids]
            count = before - len(self.data["subs"])
        else:
            count = 0
            for sub in self.data["subs"]:
                if sub["id"] in ids:
                    sub["enabled"] = action == "enable"
                    count += 1
        self._save()
        word = {"enable": "开启", "disable": "关闭", "delete": "删除"}[action]
        self.engine.log(f"批量{word} {count} 个订阅", "ok")
        return {"action": action, "count": count}

    def delete(self, sid: str) -> dict[str, Any]:
        before = len(self.data["subs"])
        self.data["subs"] = [s for s in self.data["subs"] if s["id"] != str(sid)]
        self._save()
        return {"deleted": before - len(self.data["subs"])}

    def set_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        for key in ("enabled", "interval", "max_new", "min_gap"):
            if key in payload and payload[key] is not None:
                self.data[key] = payload[key]
        self._normalize_config()
        self._save()
        state = "开启" if self.data["enabled"] else "关闭"
        self.engine.log(f"自动追更已{state}（间隔 {self.data['interval'] // 60} 分钟）", "info")
        return self.snapshot()

    # ------------------------------------------------------------------ 扫描
    async def check_now(self, sid: str) -> dict[str, Any]:
        sub = next((s for s in self.data["subs"] if s["id"] == str(sid)), None)
        if not sub:
            raise ParseError("订阅不存在")
        if not (sub["video"]["enabled"] or sub["opus"]["enabled"]):
            raise ParseError("这个订阅的视频与图文都已关闭，没什么可扫的")
        result = await self._scan(sub)
        return {"sub": json.loads(json.dumps(sub)), "result": result}

    async def _loop(self) -> None:
        await asyncio.sleep(8)
        while not self._closed:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.engine.log(f"自动追更调度异常：{exc}", "error")
            await asyncio.sleep(15)

    async def _tick(self) -> None:
        if self._closed or not self.data["enabled"]:
            return
        now = _now()
        # 下载侧处于风控冷却时，订阅扫描一律让路
        if getattr(self.engine, "_cooldown_until", 0.0) > now:
            return
        if now - self._last_scan < self.data["min_gap"]:
            return
        due = []
        for sub in self.data["subs"]:
            if not sub.get("enabled") or sub.get("checking"):
                continue
            if not (sub["video"]["enabled"] or sub["opus"]["enabled"]):
                continue
            if now - float(sub.get("last_check") or 0.0) >= self.interval_of(sub):
                due.append(sub)
        if not due:
            return
        due.sort(key=lambda s: float(s.get("last_check") or 0.0))
        target = due[0]
        # 抖动：不要让每次扫描都精确落在整数分钟
        await asyncio.sleep(random.uniform(1.0, 4.0))
        if target.get("checking"):
            return
        try:
            await self._scan(target)
        finally:
            self._last_scan = _now()

    async def _scan(self, sub: dict[str, Any]) -> dict[str, Any]:
        """扫一个订阅：拉列表 → 找出比起点更新的作品 → 建下载任务。"""
        started = _now()
        sub["checking"] = True
        result: dict[str, Any] = {"video": 0, "opus": 0, "message": "", "started": started}
        try:
            async with self._lock:
                skind = str(sub.get("kind") or "up")
                if skind == "up":
                    channels = ("video", "opus")
                elif skind == "readlist":
                    channels = ("opus",)   # 文集是图文源
                else:
                    channels = ("video",)
                for kind in channels:
                    ch = sub[kind]
                    if not ch.get("enabled"):
                        continue
                    try:
                        count, message = await self._scan_channel(sub, kind, ch)
                    except RiskControl:
                        raise
                    except BiliError as exc:
                        ch["last_error"] = str(exc)
                        ch["last_message"] = str(exc)
                        result["message"] += f"{'视频' if kind == 'video' else '图文'}扫描失败：{exc}；"
                        self.engine.log(f"[{sub.get('name') or sub['mid']}] {kind} 扫描失败：{exc}", "warn")
                        continue
                    result[kind] = count
                    ch["last_error"] = ""
                    ch["last_message"] = message
                    ch["last_new"] = count
                    result["message"] += f"{'视频' if kind == 'video' else '图文'}新增 {count} 个；"
                    # 两个频道之间也要留空档
                    if kind == "video" and sub["opus"]["enabled"]:
                        await asyncio.sleep(self.engine.store.get().scan_interval + random.uniform(0.8, 2.2))
        except RiskControl as exc:
            result["message"] += f"命中风控，已暂停：{exc}"
            self.engine._cooldown_until = _now() + 120  # noqa: SLF001
            self.engine.log(f"自动追更命中风控，暂停 120 秒：{exc}", "warn")
        except Exception as exc:  # noqa: BLE001
            result["message"] += f"扫描异常：{exc}"
            self.engine.log(f"自动追更扫描异常：{exc}", "error")
        finally:
            sub["checking"] = False
            sub["last_check"] = _now()
            result["finished"] = sub["last_check"]
            # 手动「立即检查」也算一次扫描：记下时间，避免调度器紧接着再扫一遍
            self._last_scan = max(self._last_scan, sub["last_check"])
            self._save()
        if result.get("video") or result.get("opus"):
            self.engine.log(
                f"[{sub.get('name') or sub['mid']}] 自动追更：{result['message']}", "ok"
            )
        elif result.get("message"):
            self.engine.log(f"[{sub.get('name') or sub['mid']}] {result['message']}", "info")
        return result

    async def _fetch(self, kind: str, sub: dict[str, Any], stop_idents: set[str]) -> tuple[list[Any], str]:
        """拉取列表；遇到「已经见过」的作品就停止翻页（增量同步，请求更少）。"""
        settings = self.engine.store.get()
        delay = settings.scan_interval
        max_pages = min(int(settings.max_pages), MAX_SCAN_PAGES)

        def stop(works: list[Any]) -> bool:
            return any(str(w.ident) in stop_idents for w in works)

        sk = str(sub.get("kind") or "up")
        target = str(sub.get("target") or sub.get("mid") or "")
        if sk == "fav":
            return await api.fav_items(
                self.engine.session, target, delay=delay, max_pages=max_pages, stop=stop
            )
        if sk == "toview":
            return await api.toview_items(self.engine.session)
        if sk == "bangumi":
            return await api.season_episodes(self.engine.session, target)
        if sk == "readlist":
            data = await api.readlist_detail(self.engine.session, target)
            rid = str(data.get("id") or target)
            title = str(data.get("title") or rid)
            works = [
                AuthorWork(
                    kind="opus",
                    ident=str(a.get("oid") or a.get("cvid") or ""),
                    title=str(a.get("title") or ""),
                    cover=str(a.get("cover") or ""),
                    pubdate=int(a.get("pubdate") or 0),
                    extra={"readlist": {"id": rid, "title": title, "order": int(a.get("order") or 0)}},
                )
                for a in (data.get("articles") or [])
                if (a.get("oid") or a.get("cvid"))
            ]
            return works, f"文集「{title}」共 {len(works)} 篇"
        if sk == "lists":
            data = await api.videolist_detail(
                self.engine.session, sub.get("mid") or "", str(sub.get("target") or "")
            )
            works = [
                AuthorWork(
                    kind="video",
                    ident=str(w.get("ident") or ""),
                    title=str(w.get("title") or ""),
                    cover=str(w.get("cover") or ""),
                    duration=int(w.get("duration") or 0),
                    pubdate=int(w.get("pubdate") or 0),
                )
                for w in (data.get("works") or [])
                if w.get("ident")
            ]
            # 合集接口给的是「合集顺序（旧→新）」；倒过来统一成「新→旧」，
            # _candidates / 起点逻辑都基于这个顺序（新作品会 append 在合集末尾）。
            works.reverse()
            return works, f"合集「{data.get('title') or ''}」共 {len(works)} 个视频"
        if kind == "video":
            return await api.space_videos(
                self.engine.session, target, delay=delay, max_pages=max_pages, stop=stop
            )
        return await api.space_opus(
            self.engine.session, target, delay=delay, max_pages=max_pages, stop=stop
        )

    def _keep(self, work: Any, ch: dict[str, Any]) -> bool:
        """按订阅的过滤规则判断某个作品要不要下载。"""
        filt = ch.get("filters") or {}
        title = str(getattr(work, "title", "") or "").lower()
        include = [t for t in str(filt.get("include") or "").lower().split() if t]
        exclude = [t for t in str(filt.get("exclude") or "").lower().split() if t]
        if include and not all(t in title for t in include):
            return False
        if exclude and any(t in title for t in exclude):
            return False
        dur = int(getattr(work, "duration", 0) or 0)
        if dur and int(filt.get("min_dur") or 0) and dur < int(filt["min_dur"]):
            return False
        if dur and int(filt.get("max_dur") or 0) and dur > int(filt["max_dur"]):
            return False
        return True

    def _candidates(
        self, kind: str, works: list[Any], ch: dict[str, Any], sub_kind: str = ""
    ) -> tuple[list[Any], bool]:
        """返回（待下载作品, 是否是首次建立基线）。

        `works` 是新→旧；本函数把候选**倒过来按时间正序**返回，这样「起点作品」
        排在最前面 —— 起点本身也下载（含），然后依次往更新的方向下。
        """
        idents = [str(w.ident) for w in works]
        since = str(ch.get("since") or "")
        seen = {str(x) for x in (ch.get("seen") or [])}
        if sub_kind == "readlist":
            # 文集的顺序是作者手动排的，不能拿位置判断新旧；用 seen 集合判断
            if not seen:
                return [], True
            return [w for w in works if str(w.ident) not in seen], False
        if not since:
            if sub_kind == "lists":
                # 合集订阅默认整季下载：没设起点就从最旧的一部开始，全部算候选
                newer = list(reversed(list(works)))
                return [w for w in newer if str(w.ident) not in seen], False
            # 没有起点：第一次只建立基线（把现有作品记为已见），之后只下更新的
            return [], True
        if since in idents:
            # 含起点：[:idx] 会漏掉用户选中的那一部，改成 [:idx + 1]
            newer = works[: idents.index(since) + 1]
        elif ch.get("since_time"):
            # 起点作品被删/超出翻页范围时，按发布时间兜底，同样包含同一时刻的作品
            newer = [w for w in works if int(getattr(w, "pubdate", 0) or 0) >= int(ch["since_time"])]
        else:
            newer = []
        newer = list(reversed(newer))
        return [w for w in newer if str(w.ident) not in seen], False

    async def _scan_channel(self, sub: dict[str, Any], kind: str, ch: dict[str, Any]) -> tuple[int, str]:
        known = set(str(x) for x in (ch.get("seen") or []))
        if ch.get("since"):
            known.add(str(ch["since"]))
        works, note = await self._fetch(kind, sub, known)
        if not works:
            return 0, note or "没有取到作品列表"
        newer, baseline = self._candidates(kind, works, ch, str(sub.get("kind") or ""))
        idents = [str(w.ident) for w in works]
        if baseline:
            ch["seen"] = idents[:SEEN_LIMIT]
            return 0, f"已建立基线（{len(idents)} 个作品），之后只下载更新的"
        before = len(newer)
        newer = [w for w in newer if self._keep(w, ch)]
        skipped = before - len(newer)
        limit = int(self.data["max_new"])
        picked = newer[:limit]
        left = len(newer) - len(picked)
        if not picked:
            return 0, "没有新作品"
        if kind == "video":
            data = await self.engine.add_video_idents(
                [str(w.ident) for w in picked],
                all_pages=True,
                directory=ch.get("dir") or "",
                template=str(ch.get("template") or ""),
            )
            done = int(data.get("count") or 0)
        else:
            targets = []
            for w in picked:
                target = {
                    "oid": str(w.ident),
                    "sub_kind": "opus",
                    "title": w.title,
                    "dir": ch.get("dir") or "",
                    "template": str(ch.get("template") or ""),
                }
                extra = getattr(w, "extra", None) or {}
                if extra.get("readlist"):
                    # 用「文集重命名规则」落盘（<readlist_title>/<order>-<opus_title>/...）
                    target["readlist"] = dict(extra["readlist"])
                targets.append(target)
            done = len(await self.engine.add_opus_targets(targets))
        ch["seen"] = [str(w.ident) for w in picked] + list(ch.get("seen") or [])
        ch["seen"] = list(dict.fromkeys(ch["seen"]))[:SEEN_LIMIT]
        message = f"新增 {len(picked)} 个作品，已建 {done} 个下载任务"
        if skipped:
            message += f"，过滤掉 {skipped} 个"
        if left > 0:
            message += f"（还有 {left} 个下一轮继续）"
        return done, message
