# BiliDL 验收测试报告

- 测试时间：2026-10-20
- 被测产物：**`dist/win/BiliDL.exe`**（PyInstaller 打包的最终 Windows 版本，本机用 Wine 运行，端口 2197）
  —— 也就是说：报告里的每个数字都来自**最终发行文件**，不是源码直接跑。
- 下载根目录：`/tmp/dltest`（视频 `/tmp/dltest/video`，图文 `/tmp/dltest/opus`）
- 账号状态：**未登录（匿名）**，用于验证「未登录也能下到该账号能拿到的最高清晰度」
- 测试脚本：`tests/final_test.py`（走 HTTP API，与 WebUI 完全同一条链路）
- 全程日志：`/tmp/final_test2.log`、`/tmp/exe2197.log`

最终结论：

```
[通过] BV1ndJv6nEqp 视频 —— 1 个文件；任务数 1
[通过] opus 1187271566475395078（6 图） —— 目录内图片 6 个
[通过] opus 1257520704352419856（100 图） —— 新增 100 张（期望 100）
[通过] UP 585781 全部图文 55 个 —— 新增 98 张；失败任务 0
总计：全部通过
```

任务统计：`done=58 / error=0 / skipped=0 / canceled=0`，共 212 MB。

---

## 1. 视频：https://www.bilibili.com/video/BV1ndJv6nEqp/

- 解析：标题「日奈与老师结婚后依旧不厌其烦上门打扰(？)的亚子」，UP 主「冰果粒不加冰」，单分集（1 P）。
- 所在合集：「碧蓝档案 냥붑老师个人翻译合集」共 **682 集** —— 界面里 682 个合集分集**默认全部未勾选**，只勾选当前视频的 P1，符合需求。
- 下载结果：

```
/tmp/dltest/video/日奈与老师结婚后依旧不厌其烦上门打扰(？)的亚子-BV1ndJv6nEqp-1.mp4
1,076,832 字节
Duration 00:00:36.10
Stream #0:0 Video: h264 (High) (avc1) 720x1052 30fps
Stream #0:1 Audio: aac (LC) 48000 Hz stereo
```

- 清晰度：`720P`。原因：**匿名**状态下 `/x/player/playurl` 的 DASH 只给 480P 以下，progressive(mp4) 给到 720P，引擎自动选择更高的 progressive；登录后会走 DASH + ffmpeg 合并，可到 1080P60 / 1080P+ / 4K。
- 文件名为默认模板 `<video_title>-<video_id>-<video_episode>.<ext>` 的正确展开。

DASH + ffmpeg 合并链路另外单独验证过（同一次开发中，用 BV1ndJv6nEqp）：

```
fnval=4048 → dash video id=32(480P)/16, audio id=30232/30216/30280
下载 baseUrl 两段 → ffmpeg -c copy 合并 → /tmp/dash_merged.mp4（849,582 字节）
ffmpeg -i 显示 h264 480x702 + aac 双流，时长 36.10s
```

## 2. 图文（普通）：https://www.bilibili.com/opus/1187271566475395078

- 解析 `image_count=6`。
- 下载 6 张，全部成功，命名 `<标题>-1187271566475395078-<序号>.jpg`。

## 3. 图文（100+ 张）：https://www.bilibili.com/opus/1257520704352419856

- 解析：标题「28岁单身女上司高岭前辈」，`image_count=100`。
- 下载：**100/100 张全部成功**，约 20 秒，命名：

```
28岁单身女上司高岭前辈-1257520704352419856-1.jpg … -100.jpg
```

- 该作品同时验证了「一张一段落 + 多图」的复杂结构解析（`CONTENT.paragraphs[].para_type=2` 的 `pic.pics[]`）。

## 4. UP 主全部图文：https://space.bilibili.com/585781/upload/opus

- UP 主：**神秘人阿T**（UID 585781）。
- 检索接口：`x/polymer/web-dynamic/v1/opus/feed/space`，`offset` 翻页，每页 20 条，页间 `scan_interval=1.6s`。
- 检索结果：**图文 55 个**（界面上「图文作品」面板单独展示，与「视频作品」面板分开）。
- 批量下载 55 个作品：**55/55 成功，0 失败，共 98 张图**（有的作品只有 1 张图）。
- 目录样例：

```
🥒-1026355802052493316-1.jpg
2_10-840834041130254372-1.jpg
```

合计：图文目录 204 个文件（6 + 100 + 98），210 MB。

## 5. UP 主全部视频（同一接口的另外一半）

- `app.bilibili.com/x/v2/space/archive`（`pn` 翻页，`ps=30`）→ **57 个视频**全部拿到（第 1/2/3 页 20/20/17 条，第 4 页空）。
- 说明：网页版 `x/space/wbi/arc/search` 在本机 IP 实测 **412 / -352**（风控），因此代码里**刻意不再请求**它，改用 App 端接口 —— 这是「不触发风控」的关键决策之一。

## 6. 其他功能点验证

| 功能 | 验证方式 | 结果 |
| --- | --- | --- |
| 多链接同时粘贴 | WebUI 粘贴「视频 + 图文」两条，点解析 | 2 张结果卡片，各自独立勾选，一次创建 2 个任务 |
| 分集默认全选 | 解析 BV1ndJv6nEqp | P1 默认选中 |
| 合集默认不选 | 同上 | 682 集全部未勾选，可「全选合集/清空合集/单点某集」 |
| 未登录最高清晰度 | 匿名下载 | 720P（progressive），并提示「未登录（仅能下载 720P 以内）」 |
| 扫码登录 | UI 点「获取二维码」 | `passport.bilibili.com` 返回二维码，界面渲染 SVG，状态「等待扫码」；轮询返回 `86101 未扫码` |
| Cookie 登录 | 粘贴一个无效 Cookie | 返回「Cookie 无效或已过期」；**不会**把无效 Cookie 写入内存/磁盘（修复过） |
| 重命名模板独立 | 设置页两套模板 + 变量点击插入 | 视频/图文分别生效，中文别名也支持 |
| 下载目录独立 | 设置页分别填两个目录 | 视频进 `video/`，图文进 `opus/` |
| b23.tv 短链 | `b23.tv/xxxx` 跟随 302 | 展开为 `/video/BV...` 或 `/opus/...` 后正常分类 |
| 油猴脚本 | `node --check` + 注入浏览器实测 | 语法通过；按钮分别打 `/api/download`、`/?links=`、`/?scan=`；多选图文见 6.1 |
| APK 构建 | `bash android/build_apk.sh` | 复现构建成功，`apksigner verify` 通过（package `com.bilidl.app`、minSdk 21、targetSdk 34） |
| Docker | `docker` CLI 不可用；做了等价模拟 | 见第 8 节 |

## 6.1 油猴脚本：UP 主图文多选（v1.1.0）

| 用例 | 做法 | 结果 |
| --- | --- | --- |
| 页面卡片勾选 | 在仿真页放 4 张 `a[href*="/opus/"]` 卡片，注入脚本 | 4 个勾选框注入成功，勾 1 个后底部出现 `本页已选 1 个图文`，清空归 0 |
| 多选面板检索 | 点「多选图文」→ `POST /api/space/scan`（tabs=["opus"]）→ 轮询 | 约 20s 检索完，面板显示「神秘人阿T · 图文 55 个」，55 张封面网格 |
| 多选 + 统一发送 | 点 5 张封面 → `发送下载（5）` | `已创建 5 个任务`；5 个任务全部 `done`（1/1、9/9、1/1…），13 个文件落盘 |
| 全选 / 清空 | 点 `全选` / `清空` | 计数 55 / 0，按钮文案 `发送下载（55）` 同步变化 |
| 真实空间页 | 把脚本注入 `https://space.bilibili.com/585781/upload/opus` | 识别为「UP 主空间」、自动填 mid 585781、浮标+面板正常渲染（截图 `screenshots/usr-real-page.png`） |
| 断线容错 | 服务端不可达 | 请求 20s 超时并给出「当前页面是 https，浏览器会拦截到 http 本地服务的请求；装成 Tampermonkey 脚本后走 GM_xmlhttpRequest 就不会被拦」的提示；轮询连续 3 次失败 / 超 5 分钟会中止 |

注：测试是在容器 Chromium 里用 CDP 注入脚本 + 自写 `GM_*` 兼容层跑的；真实的 Tampermonkey 用
`GM_xmlhttpRequest` 从扩展后台发请求，不受页面 https→http 混合内容限制，因此实际使用比这里更宽松。

## 6.2 定时追更（订阅 UP 主）

被测服务：源码直跑（`BILIDL_DOWNLOAD_DIR=/tmp/subdl2 BILIDL_DATA_DIR=/tmp/subcfg2 python -m bilidl --port 2196`），
WebUI 用容器 Chromium 经 CDP 操作，与 exe / Docker / APK 走同一套接口。

| 用例 | 做法 | 结果 |
| --- | --- | --- |
| 建订阅（API） | `POST /api/subs {mid:"585781", opus:{enabled:true, dir:"/tmp/subdl/opus585781"}}` | 返回 `name=神秘人阿T` + 头像，落盘 `subs.json` |
| 自定义目录 | 订阅内指定 `dir` | 文件落在 `/tmp/subdl/opus585781/分享图片-1110108634957742085-1.png`（不是全局目录） |
| 起点作品（图文） | `since=1097565814355132419`（列表第 2 新） | `check` 3.5s 完成，`图文新增 1 个`，只下比起点新的那个 |
| 起点作品（视频） | `since=BV1TgULBkEMA` | `视频新增 1 个` → `【板绘】艾莲 乔-BV15ags69Ef6-1.mp4`（5.8 MB） |
| 去重 | 同一订阅连续 `check` | 第二次 `图文新增 0 个`，不重复下载 |
| 单轮限量 | `max_new=1` + 起点前移 | 提示「新增 1 个作品，已建 1 个下载任务（还有 2 个下一轮继续）」 |
| 总开关 | `enabled=false` 后等 40s | 完全不扫描（`next_run=-1`、`last_check` 不变、任务数 0） |
| 自动触发 | `enabled=true` | 35s 内自动扫描并下载，事件日志 `[神秘人阿T] 自动追更：图文新增 1 个；` |
| 空档保护 | 手动 `check` 后立即看 `next_run` | `1797s`（没有被调度器紧接着重复扫） |
| WebUI 全流程 | 填 UID → 取消「追视频」→ 填图文目录 → 添加订阅 → 点「图文起点」选第 2 个 → 点「立即检查」 | 卡片出现、起点显示「分享图片」、Toast `检查完成：视频新增 0 个，图文新增 0 个`、文件落 `/tmp/subdl2/ui585781/` |
| 风控 | 全流程 | 无 -352 / -412 / 429 |

## 7. 风控观察

- 全程 **58 个任务 / 约 230 个请求**（含 4 次空间检索翻页），**没有出现 -352 / -412 / 429**，`/tmp/exe2197.log` 无风控记录，任务统计 `error=0`。
- 命中过的真实错误与处理：无（唯一一次「失败」是测试脚本传了 `oid=None`，已修：引擎现在只接受纯数字 id）。
- 节流参数：`api_interval=1.2s`、`scan_interval=1.6s`、`file_interval=0.8s`、`concurrency=2`（同一时刻只有 1 个请求在飞）。
- 高风险端点（`x/space/wbi/arc/search`）**完全不请求**；未登录时**不请求** wbi 版 playurl。

## 8. Docker 构建说明（本机无 docker CLI）

容器内没有 docker，因此无法 `docker compose up`。做了等价的**构建/运行模拟**：

1. 按 Dockerfile 的层顺序，在干净目录 `uv venv` + `uv pip install -i <TUNA> -r requirements.txt` → **2.45 秒**完成（httpx、httpcore、h11、anyio、sniffio、idna、certifi、qrcode、typing-extensions）；
2. 只 `COPY bilidl web`，用 `BILIDL_DOWNLOAD_DIR=/tmp/dl/dock BILIDL_DATA_DIR=... python -m bilidl --host 0.0.0.0 --port 2198` 启动 → `/api/health` 200、`ffmpeg: true`、默认目录 `/tmp/dl/dock` 与 `/tmp/dl/dock/图文`；
3. `docker-compose.yml` 用 PyYAML 解析校验：`network_mode: bridge`、`ports: ["2196:2196"]`、宿主目录 `/mnt/media/video:/download`、`./data:/app/data`、build args 均正确；
4. TUNA 的 pypi 与 debian 镜像均返回 200（构建源可用）。

## 9. 测试中发现并修掉的问题

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | `api.py` 从 `.constants` 导入不存在的 `API` | 改为 `from .http import API, PASSPORT, BiliSession` |
| 2 | `http.py` 里 `self._wbi_key` 缓存与同名方法冲突 → `'str' object is not callable` | 改名 `_wbi_cache` |
| 3 | `get_app()` 在签名之后才加 `mobi_app/platform/build` → 「签名错误」 | 先合并参数再签名 |
| 4 | `user_card` 的 `relation` 可能是 int → `'int' object has no attribute 'get'` | 类型判断后再取 `follower` |
| 5 | 空间视频接口 `x/space/wbi/arc/search` 稳定 412/-352 | 改用 `app.bilibili.com/x/v2/space/archive`（pn 翻页） |
| 6 | `/api/space/scan` 只认 `tabs` 数组 | 兼容 `tab` 字符串 |
| 7 | 置顶/旧版图文在 `opus/detail` 里没有 CONTENT 图 → 「没有可下载的图片」 | 新增 `opus_from_html()` 回退解析页面 `__INITIAL_STATE__`（`MODULE_TYPE_TOP.module_top.display.album.pics`） |
| 8 | 扫码接口 404 | B站二维码在 **`passport.bilibili.com`**，不在 `api.bilibili.com` |
| 9 | 无效 Cookie 也会被写成「已登录」并落盘 | 先用临时会话验证，通过后才更新会话与 `cookie.txt` |
| 10 | d8/R8 8.2 对 javac 21 的**匿名内部类** NPE 崩溃 | APK 源码改用 lambda + 具名静态内部类 |
| 11 | APK 编译 `-bootclasspath android.jar` 导致 lambda 找不到 `LambdaMetafactory` | 改用 `-classpath android.jar` |
| 12 | 脏 `oid`（如 "None"）会生成必然失败的任务 | `add_opus_targets` 只接受纯数字 id，并支持 `opus_id` 别名 |
| 13 | 订阅调度里 `_tick` 持锁后再进 `_scan`（同样要锁）→ 死锁 | `_tick` 不再持锁，扫描只在 `_scan` 内加锁 |
| 14 | 手动「立即检查」后调度器可能紧接着再扫一遍（空档失效） | `_scan` 结束时把 `_last_scan` 推到本次检查时间，空档对「手动 + 自动」统一生效 |
| 15 | 订阅下载的视频任务一直显示 `0/1` | `_handle` 成功后把 `done_items` 至少置 1 |

## 10. 复跑方式

```bash
# 起服务（源码方式）
BILIDL_DOWNLOAD_DIR=/tmp/dltest ./.venv/bin/python -m bilidl --port 2196

# 跑验收（4297 之类同理，换成你的端口）
./.venv/bin/python tests/final_test.py http://127.0.0.1:2196 /tmp/dltest
```

> 注意：批量跑 UP 主全部作品会发出上百个请求，请把 `api_interval` 保持 ≥1.0s，最好在低峰期执行，避免给 B站服务器添麻烦。

### 6.3 手机独立版（2.0.0）

APK 内的引擎是纯 Java，与桌面 JVM 跑的是**同一份代码**，因此用桌面 JVM 实例做了端到端实测（容器无 KVM，跑不了 Android 模拟器）。

| 用例 | 结果 |
| --- | --- |
| `POST /api/links/parse` 解析 `BV1ndJv6nEqp` | 返回标题/UP主/分P/合集 683 集 |
| 解析 `b23.tv/BV1ndJv6nEqp` 短链 | 正确还原为同一视频 |
| 下载 `BV1ndJv6nEqp` | `日奈与老师结婚后依旧不厌其烦上门打扰(？)的亚子-BV1ndJv6nEqp-1.mp4` 1.07MB |
| 下载 opus `1187271566475395078` | 6 张原图，命名 `<标题>-<id>-<序号>.jpg` |
| 下载 opus `1257520704352419856`（100+ 图） | **100/100 张全部成功**，共 131MB |
| UP 主 `585781` 图文检索 | 55 个作品，封面/标题/opus_id 正常 |
| WebUI 交互（Chromium 打开手机版页面） | 粘贴链接→解析→勾选→开始下载→任务页出现任务并完成 |
| APK 构建 | `aapt2/javac/d8/apksigner` 通过，签名校验通过，`classes.dex` 83KB / 70 个类，assets 内置 4 个前端文件 |



### 6.1.1 油猴脚本 v1.3.0：空间页缩略图多选

| # | 用例 | 结果 |
|---|---|---|
| 1 | `space.bilibili.com/205342771/upload/opus` 注入脚本 | 20 张图文卡片 / 20 个勾选框，顶部提示条「点卡片/缩略图即可多选」显示 |
| 2 | 点卡片**标题**区域 | 选中 1 个，卡片粉色描边 + 打勾，页面**未跳转** |
| 3 | 点另一张卡片**封面** | 累计 2 个，仍未跳转 |
| 4 | `space.bilibili.com/546195/upload/video` | 40 张视频卡片 / 40 个勾选框 |
| 5 | 连点 3 张视频封面 | 底栏「已选 3 个（视频 3 / 图文 0）」，未跳转 |
| 6 | 发送下载 | 分组提交 `{video_idents:[...]}` 与 `{opus:[{oid,...}]}`，BiliDL 建任务成功 |

截图：`docs/screenshots/usr-select-space.png`、`docs/screenshots/usr-select-video.png`。

### 6.4 按标题搜索 UP 主作品并批量下载

| # | 平台 | 用例 | 结果 |
|---|---|---|---|
| 1 | WebUI（桌面） | 检索 UID 585781 → 输入 `分享` | 图文 55 个中匹配 **30** 个，标题「共 55 个，匹配 30 个」 |
| 2 | WebUI（桌面） | 多关键词 `分享 图片` | 仍命中 30 个（AND 语义），无匹配时网格显示占位提示 |
| 3 | WebUI（桌面） | 点 `全选匹配` | 选中 30 个，`下载选中图文` 建立 30 个任务 |
| 4 | WebUI（手机版/APK） | 检索 585781 → 输入 `分享` → `全选匹配` | 视频 57 个匹配 0、图文 55 个匹配 30，选中 30，toast「已选中匹配作品 30 个」 |
| 5 | 油猴 v1.4.0 面板 | 检索 585781 → 面板输入 `分享` | 55 张卡片过滤为 30，`全选` 选中 30 |
| 6 | 油猴 v1.4.0 面板 | 输入不存在的词 | 网格显示「没有标题匹配的作品（共 55 个）」 |
| 7 | 风控 | 全程 | 筛选是**纯前端**过滤，不产生任何 B站 请求；检索仍走 1.6s/页 串行 |

截图：`docs/screenshots/search-desktop.png`、`docs/screenshots/search-mobile.png`。

### 6.5 定时追更对齐 bili-sync-up（增量 + 过滤 + 默认 10 分钟）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 默认扫描间隔 | 全局默认改为 **600s（10 分钟）**，与 bili-sync 默认一致；每订阅仍可单独覆盖（最短 120s） |
| 2 | 增量扫描提前停止 | 订阅 585781 图文、起点设为第 3 个作品 → `check` 只用 **1.3s** 就返回（翻到起点作品立即停止，不再翻到底） |
| 3 | 标题包含过滤 | 过滤 `include=分享` → 3 个新作品里只建 **2** 个任务，消息「新增 2 个作品，已建 2 个下载任务，过滤掉 1 个」 |
| 4 | 过滤规则持久化 | `data/subs.json` 中 `opus.filters={"include":"分享",...}`，重启后仍生效 |
| 5 | 手机版 | 订阅卡片新增「只下标题含 / 排除标题含 / 时长(秒) 最短-最长」输入，改完即时保存；默认间隔输入框显示 10 |
| 6 | 风控 | 增量 + 过滤都在服务端已节流的列表请求上完成，过滤只影响「要不要建任务」，不产生额外 B站 请求 |

### 6.6 三类新视频源（收藏夹 / 番剧 / 稍后再看）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 番剧订阅 | `season_id=28747` → 拉到 **309 集**，最新一集在前；首次扫描「仅建立基线（309 个作品，不下载旧作品）」 |
| 2 | 番剧增量 | 起点设第 2 新一集 → 候选只有最新 1 集（`_candidates` 单测通过），配合过滤规则可只下想要的集数 |
| 3 | 番剧无需登录 | `pgc/view/web/season` 公开接口，未登录也可订阅与扫描 |
| 4 | 收藏夹 | `favItems(media_id)` 走 `/x/v3/fav/resource/list`（mtime 倒序、增量早停）；未登录 → 「收藏夹需要登录：请到账号登录页扫码或用 Cookie 登录后再订阅」 |
| 5 | 稍后再看 | `/x/v2/history/toview`；未登录 → 「稍后再看需要登录：…」 |
| 6 | 三端一致 | 桌面 WebUI 类型下拉 + 手机版类型下拉均可添加；服务端 `kind` 落 `data/subs.json`，重启保留 |
| 7 | 移动端实测 | 手机版添加番剧订阅 → `baseline 309`、`kind=bangumi`、`name=番剧` |

### 6.7 重命名规则支持 `/` 建子文件夹

| # | 用例 | 结果 |
|---|---|---|
| 1 | 图文规则 `<opus_author>/<opus_title>-<opus_id>-<opus_order>.<ext>` | opus 1187271566475395078 → `图文/西园寺玲-汉化/【虹咲】磨豆腐…-1187271566475395078-1..6.jpg`（6 张，父目录自动创建） |
| 2 | 非法/穿越字符 | `../../etc/<opus_title>.<ext>` → 只保留 `etc/x.jpg`（`..` 段被丢弃，不会跳出下载目录） |
| 3 | 无 `/` 的老规则 | 行为不变（仍直接落在下载目录下） |
| 4 | 桌面 UI 提示 | 设置页两条重命名规则下方都注明「写 `/` 会建子文件夹」并给出示例 |
| 5 | 手机版 / Java 引擎 | `Naming.renderPath` + `Engine` 同步改为相对路径 + `mkdirs()`，`javac` 通过 |

### 6.1.2 油猴脚本修复：第二次多选无反应 / 已选数 0↔1 抖动

| # | 用例 | 结果 |
|---|---|---|
| 1 | 原因一 | 每张卡片各绑一个 capture click 监听，页面重渲染/重复 mount 后监听叠加，一次点击切换两次 → 计数在 0 和 1 之间跳、看起来「没反应」 |
| 2 | 原因二 | 第一次发送成功后 `#bilidl-selbar-send` 被置为 `disabled` 且没有恢复逻辑 → 第二次选中后按钮点不动 |
| 3 | 修复 | 改成**全局唯一的委托监听**（`document` capture + `closest("[data-bilidl-key]")`），去掉每卡监听；`syncCount()` 里统一刷新发送按钮的 `disabled` |
| 4 | 复测（真实空间页） | 连点同一张：1→0→1 正常；连续 3 张 = 3；强制触发 3 次页面重渲染后仍单次切换 |
| 5 | 复测（连续两轮发送） | 第一轮选 3 个发送 → 计数归 0；第二轮再选 2 个发送 → 计数归 0，两次 POST 都发出（`/api/download` 各带对应用户选中作品） |
| 6 | 视频页 | `space.bilibili.com/546195/upload/video` 40 张卡片、选 3 张 → `已选 3 个（视频 3 / 图文 0）`、发送按钮可用 |

### 6.8 油猴 v1.6.0：默认不显示、手动开启多选

| # | 用例 | 结果 |
|---|---|---|
| 1 | 首次进入空间页 | 勾选框 0 个、底部选择条 `display:none`、提示条 `display:none`、面板 `display:none`，只有右侧 40px 半透明小圆点 |
| 2 | 点小圆点 | 设置面板展开（`display:block`），内含「开启多选模式」开关，默认未勾选 |
| 3 | 勾上开关 | 20 张图文卡片立刻出现 20 个勾选框，选择条与提示条出现；点缩略图计数 1→2 正常 |
| 4 | 取消勾选 | 勾选框移除、选择条隐藏、已选计数归 0，页面点击恢复原跳转 |
| 5 | 记忆开关 | 开关状态写入 `GM_setValue("selMode")`，刷新后沿用上次状态 |

### 6.9 Windows 便携版（替代单文件 exe）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 单文件 exe 问题 | PyInstaller 冻结后 `httpcore` 认为没装 anyio，下载报 `Running with asyncio requires installation of 'httpcore[asyncio]'`；补 `typing_extensions`、提前 `import anyio` 均无效 |
| 2 | 替代方案 | 改为「内置 Python 3.11 + 程序本体」便携版：`启动-BiliDL.bat` 调 `python.exe -m bilidl --port 2196 --open` |
| 3 | 实测 | 便携版启动后 `/api/health` 正常；下载 opus 1187271566475395078 → `done:1`，6 张图落到 `downloads/opus/` 下，无 asyncio 报错 |
| 4 | 体积 | 精简 `Lib/test`、`tkinter`、pip/setuptools/PyInstaller 等后 zip 50MB |

## 7. 独立版油猴脚本（tampermonkey-standalone）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 默认状态 | 页面只有右下角半透明小圆点；面板 `display:none`、勾选框 0 个、选择条隐藏 |
| 2 | 打开面板 | 渲染成功：登录区（扫码/Cookie/刷新/退出）、清晰度 9 项默认 1080P60、子目录、两条重命名规则、并发与间隔、多选开关、粘贴链接、队列、日志 |
| 3 | 开启多选 | 真实图文页 20 张卡片 → 20 个勾选框；选择条与提示条出现 |
| 4 | 多选与计数 | 点 2 张卡片 → `已选 2 个（视频 0 / 图文 2）`；全选 → 5 个（模拟页 3 视频 + 2 图文）；清空 → 0 |
| 5 | 图文下载 | 选 2 个图文 → `完成 2 · 失败 0`，文件名 `BiliDL/想跟老师延续皇家血脉的亚津子-1261577416973746177-1.jpg` |
| 6 | 视频下载 | 粘贴 `BV1ndJv6nEqp` → 队列 1 个 → `BiliDL/日奈与老师结婚后依旧不厌其烦上门打扰(？)的亚子-BV1ndJv6nEqp-1.mp4`，`完成 1 · 失败 0` |
| 7 | 生成的下载地址可用 | 用脚本给出的 URL + Referer 实测下载：视频 200（读到 400KB 正常码流）、图片 200 |
| 8 | 未登录清晰度 | `playurl` 返回 `quality=64`（720P），脚本按 1080P60→720P 逐级回退，不报错 |
| 9 | 短链 | `b23.tv` 页面内直接 fetch 被 CORS 拦（`Failed to fetch`），已改为优先 `GM_xmlhttpRequest` 跟随跳转 |
| 10 | 卡片识别 | 模拟空间页（3 视频 + 2 图文卡片）：`data-bilidl-key` 5 个、类型分别为 video/video/video/opus/opus |

## 8. 评论区图片下载按钮（油猴 1.7.0 / 独立版 1.1.0）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 按钮注入 | 评论渲染器（含 shadow DOM）下方出现「⬇ 下载图片(4)」，位置在评论正文内 |
| 2 | 数量识别 | 4 张（3 张静态图 + 1 张动图），缩略图后缀 `@176w_176h_1c_1s.avif` 被剥掉取原图 |
| 3 | 评论者昵称 | 从嵌套 shadow DOM 的 `#user-name`（含 `title`）取到「冰果粒不加冰」 |
| 4 | 评论 id | 从评论内 `data-rpid` 取到 `2512345678901234567`（DOM 无 id 时回退到 `/x/v2/reply` 按图片 URL 反查） |
| 5 | 默认命名 | `冰果粒不加冰-BV1ndJv6nEqp-2512345678901234567-1.png` … `-4.gif`，扩展名按图片真实类型 |
| 6 | 自定义模板 | 支持 `<author> / <video_id> / <comment_id> / <order> / <ext>`，写 `/` 会建子文件夹 |
| 7 | 主油猴版本 | 面板新增「评论图片重命名规则」输入框，默认值同上；点击按钮同样生成 4 个任务 |
| 8 | 真实页面观察 | `BV1ndJv6nEqp` 评论区在未登录时显示「登录后查看 16 条评论」，无法匿名验证；结构用同构 mock（`bili-comment-renderer` + `bili-comment-pictures-renderer` 双层 shadow）验证 |

## 9. 下载文件类型多选（纯音频 / 无声视频 / 字幕 / 弹幕 / 封面 / NFO）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 默认（全不勾） | 下载有声音视频 `…-BV1ndJv6nEqp-1.mp4`（1,076,832 B） |
| 2 | 只下载纯音频 | `…-BV1ndJv6nEqp-1.m4a`（423,090 B），`ffmpeg -map 0:a` 解码通过，无视频流 |
| 3 | 只下载无声视频 | `…-BV1ndJv6nEqp-1-mute.mp4`（403,051 B），`ffmpeg` 提示 `Stream map '0:a' matches no streams`（确实无音轨） |
| 4 | 额外下载封面 | `…-BV1ndJv6nEqp-1.jpg`（63,187 B，archive 原图） |
| 5 | 额外下载 NFO | `…-BV1ndJv6nEqp-1.nfo`（894 B，`<movie>` 结构，含 `uniqueid type="bilibili"`） |
| 6 | 额外下载弹幕 SRT | `BV1GJ411x7h7-1-danmaku.srt`（69,983 B，1200 条，`00:00:00,601 --> 00:00:04,601` 格式正确） |
| 7 | 无弹幕视频 | `BV1ndJv6nEqp` 的 `comment.bilibili.com/<cid>.xml` 只返回 199 B 空壳，任务备注「没有抓到弹幕内容」，不报错 |
| 8 | 字幕 SRT | 匿名访问 `player/v2` 的 subtitles 为空数组，备注「该视频没有可用字幕（多为 UP 主未上传或需登录）」；转换函数用样例 JSON 验证（`00:00:01,200 --> 00:00:03,400`） |
| 9 | 命名规则 | 所有附加文件都走视频模板：默认名 `<标题>-<BV>-<集号>.<ext>`，子文件夹模板同样生效 |
| 10 | WebUI | 设置页「下载哪些文件」6 个勾选框渲染正常、随保存写入 `settings.extras`、重载后状态保持 |
| 11 | 独立版油猴 | 面板 6 个勾选框 + 保存/回填；`exAudio` 下产出 `.m4a`；封面 `…jpg` 与 NFO `.nfo` 正常；`xmlToSrt` 单测输出 `00:00:12,500 --> 00:00:16,500` |

## 10. 多选默认关闭（两版油猴 v1.7.1 / v1.2.1）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 首次打开空间页（存储里没有 `selMode`） | `勾选框 0 个`、底栏隐藏、提示条隐藏 |
| 2 | 存储里已经有 `selMode=true`（上次开过） | 仍然 `勾选框 0 个`、底栏隐藏、面板里的勾选框为未选中 |
| 3 | 面板里勾选「开启多选模式」 | 20 张卡片出现 20 个勾选框，底栏与提示条显示 |
| 4 | 再取消勾选 | 勾选框全部移除（0 个），底栏与提示条隐藏，已选清零 |


## 11. WebUI 主题与改版（7 套配色）

服务：`BILIDL_DOWNLOAD_DIR=/tmp/extdl BILIDL_DATA_DIR=/tmp/extcfg python -m bilidl --port 2199`，用 CDP 驱动 Chromium 1440×757 实测。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 首屏默认主题 | `data-theme="sakura"`，侧栏底部 7 个色块，页面无报错 |
| 2 | 点「深海夜航」色块 | 整页配色即时切换（`--brand` #4d9bff），右下角 toast「已切换到「深海夜航」」 |
| 3 | 点「白天模式」色块 | 白底浅灰、主色转粉、文字对比度正常，侧栏/卡片/输入框全部跟着变 |
| 4 | 点「幻夜紫」色块 | 紫粉赛博配色生效，任务行/按钮/进度条同步 |
| 5 | 刷新页面 | 主题保持上次选择（`localStorage["bilidl.theme"]`），无闪白 |
| 6 | 设置页主题色卡 | 渲染 7 张卡（色块预览 + 名称 + 气质标签），当前主题有粉色描边和 `on` 类 |
| 7 | 首屏三步引导 | 显示 3 个步骤卡；点「知道了」后卡片隐藏，刷新不再出现（`localStorage["bilidl.guide"]="off"`） |
| 8 | 解析视频 + 图文两条链接 | 结果改成横向卡（176px 封面 + 标题/UP/时长/BV），不再出现整屏大图 |
| 9 | 选中分集 / 图文作品 pill | 选中态为粉色渐变胶囊，文字用 `--brand-ink`（深色），不再是浅灰看不清 |
| 10 | UP 主批量 / 任务队列 / 设置页 | 三个页面在 sakura 与 daylight 下都无溢出、无遮挡，窄屏媒体查询生效 |


## 12. 勾选框位置与去重（v1.7.2 / 独立版 v1.2.2）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 空间页图文列表（真实 `space.bilibili.com/205342771/upload/opus`） | 20 个作品 = 20 个勾选框，`dup=0` |
| 2 | 每个框的宿主元素 | 20/20 挂在 `.opus-card--with-cover`（封面容器），无一个挂在卡片或标题上 |
| 3 | 框相对封面容器的位置 | 全部 `8,8`（左上角内缩 8px） |
| 4 | 是否压住标题 | 与 `.opus-card__title` 的矩形求交：0 个重叠 |
| 5 | 点勾选框 | `已选 1`，`location.href` 不变（不会跳详情页） |
| 6 | 视频卡结构（同构 mock：`.bili-video-card__cover > a.bili-cover-card`） | 4 个作品 = 4 个框，宿主 `bili-video-card__cover`，位置 `8,8` |
| 7 | 标题在封面之上的异常卡（mock） | 框仍挂封面容器，`overTitle=false`（v1.7.2 改为优先用封面链接算缩略图） |
| 8 | 主脚本 + 独立版同时安装 | 仍为 4 个作品 = 4 个框（`window.__bilidlOvOwner` 让先跑的占位，后跑的不再挂框） |
| 9 | 直接子链接卡（`a.opus-card__cover` 是卡片直接子元素） | 框挂在 `<a>` 自身上，位置 `8,8`，点击不跳转 |

说明：v1.7.2 / 独立版 v1.2.2 之前，「一个作品两个框」的根因有两条——① 同一作品同时有「封面链接」和「标题链接」两个 `<a>`，按锚点算缩略图时其中一个会算成标题容器；② 主脚本与独立版各挂一套框。现在按「作品 key 去重 + 优先封面链接 + 认不出缩略图就不画」处理，并对两个脚本做了 owner 互斥。

## 13. 评论区图片：只下用户图 + 按钮美化（v1.7.3 / 独立版 v1.2.3）

测试页：`/tmp/cmtmock/index.html`（双层 shadow DOM 仿真：`bili-comment-renderer` → `.comment-item`（含 `data-rpid`、头像 `<img class="avatar">`、正文里一张表情 `<img class="emoji">`）→ `bili-comment-pictures-renderer` → 2 张用户图，分别是 `bfs/new_dyn/…jpg` 与 `bfs/comment/…png`）。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 评论里同时有头像、表情、2 张用户图 | `cmtCollect` 只返回 2 张用户图（`new_dyn` + `comment`），头像与表情被过滤 |
| 2 | 头像 URL `bfs/face/member/noface.jpg` | 命中 `CMT_DENY` 被丢弃 |
| 3 | 表情 URL `bfs/emote/…png` | 命中 `CMT_DENY` 被丢弃 |
| 4 | 深层 shadow（评论 → 图片容器 → img） | 递归 8 层穿透，2 张图全部找到 |
| 5 | 按钮数量 | 每条评论 **1 个**（同 shadow 树内去重） |
| 6 | 按钮外观 | 粉色渐变胶囊、99px 圆角、内联 SVG 下载图标、`保存图片` 文案 + 数字徽标 |
| 7 | shadow 内样式 | 计算样式 `background-image: linear-gradient(135deg, rgb(251,114,153), …)`，确认样式表已注入 shadow root |
| 8 | 独立版同场景 | 1 个按钮、2 张图、样式同样生效 |
| 9 | 非用户图兜底 | 当严格匹配（`new_dyn`/`comment`）为空时，才退回「非黑名单」结果，避免老页面拿不到图 |

## 14. 图文/专栏图片总数徽标（v1.7.4 / 独立版 v1.2.4）

| # | 用例 | 结果 |
|---|---|---|
| 1 | `https://www.bilibili.com/opus/1257520704352419856`（100 张图） | 徽标显示 **100 张图**，与页面 `.opus-module-content img` 计数一致 |
| 2 | `https://www.bilibili.com/opus/1259399413247246341`（16 张图） | 徽标显示 **16 张图** |
| 3 | 视频页 `BV1ndJv6nEqp` | 徽标不创建 / 隐藏（`exists:false`） |
| 4 | 站内 SPA 跳转（opus → 视频 → 另一个 opus） | 每次切页重新统计，数值随之更新 |
| 5 | 接口被风控（该环境 opus/detail 返回 **412**） | 仍能正确显示，因为优先用 DOM 计数；接口只在 DOM 为 0 时兜底 |
| 6 | 徽标位置/样式 | 固定右下角（圆点上方 68px），深色胶囊 + 粉色数字，白底页也清晰 |

## 15. 一键下载当前页面作品（v1.7.5 / 独立版 v1.2.5）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 主版本 · 图文页 `opus/1187271566475395078` 点「下载本页作品」 | 请求体 `{"video_idents":[],"opus":[{"oid":"1187271566475395078","sub_kind":"opus","title":"【虹咲】磨豆腐，会舒服吗？（雫霞）（抹希）"}]}`，面板提示「已创建 1 个任务」 |
| 2 | 主版本 · 视频页 `BV1ndJv6nEqp` | 请求体 `{"video_idents":["BV1ndJv6nEqp"],"opus":[]}`，提示「已创建 1 个任务」 |
| 3 | 主版本 · 标题自动清洗 | `document.title` 去掉「 - 哔哩哔哩」后作为 `title` 传给服务端 |
| 4 | 独立版 · 图文页 | 区块提示「已加入队列：图文 1187271566475395078」，队列统计 `完成 6 · 失败 0`，6 张图全部下完 |
| 5 | 独立版 · 视频页 | 入队 `BV…`，走本地下载（GM_download） |
| 6 | 非作品页（空间/首页） | 只提示「当前页面不是视频 / 图文 / 专栏页」，不发任何请求 |

## 16. 设置面板打不开的加固（v1.7.6 / 独立版 v1.2.6）

现象：点右下角圆形按钮没反应。排查结论：面板样式全部来自运行时注入的 `<style>`，B站 有些页面会拦 `style-src`、或有更高 z-index 的固定层；样式一旦没生效，面板就是 `display:none` 的一块 `div`，看起来像「点了没反应」。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 正常点击主版圆点 | 面板 `display:block`、340×585、`z-index 2147483001` |
| 2 | **删掉脚本注入的所有 `<style>`** 再点（模拟 CSP 拦截） | 仍能打开：340×504、深色背景、可操作（关键样式已内联到元素上） |
| 3 | 同上，独立版 | 372×618，正常打开 |
| 4 | 主版面板 × 关闭按钮 | 点击后 `display:none` |
| 5 | 面板内点击 | `stopPropagation`，不会误触发页面跳转/多选 |
| 6 | Tampermonkey 菜单「打开设置面板」 | 兜底入口，面板强制打开 |

## 17. 独立版下载不再新开图片标签页（v1.2.8）

现象：独立版下图文/专栏时，浏览器会自动新开一个标签页显示图片本身。

原因：旧兜底逻辑用 `a.download` + `a.target="_blank"` 指向 `hdslb.com` 的原图。跨域 URL 会被浏览器忽略 `download` 属性（安全限制），于是退化成「打开该 URL」= 新标签页预览图片。`GM_download` 不可用或失败时就会走到这条路径。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 强制 `GM_download` 失败，下载 6 张图 | `window.open` 调用 **0 次**，无新标签页 |
| 2 | 同上，实际落盘方式 | 6 次 `a[download]` + `blob:` 链接（文件名正确 `.jpg`） |
| 3 | 队列统计 | `完成 6 · 失败 0` |
| 4 | `GM_download` 正常可用时 | 仍走原生下载（不额外占用内存） |

## 18. 全量 blob 下载（v1.2.9）

v1.2.8 只在 `GM_download` 失败时走 blob，但 Tampermonkey 有个「浏览器下载模式」：`GM_download` 成功返回，内部却是用 `<a>` 打开跨域 URL → 新标签页。所以 1.2.8 仍会开标签页。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 把 `GM_download` 换成「开新标签」的实现（模拟 TM 浏览器下载模式），下载 6 张图 | `window.open` / `GM_download` 触发 **0 次**，6 个文件全部以 `a[download]` + `blob:` 保存 |
| 2 | `__bilidlDlLog` 记录 | 6 条 `{how:"blob", name:"BiliDL/【虹咲】…-4.jpg"}` |
| 3 | 队列统计 | `完成 6 · 失败 0` |
| 4 | 视频任务 | 仍走原生 `GM_download`（避免大文件占内存），失败再退回 blob |
| 5 | 封面 / 字幕 / 弹幕 / NFO | 全部走 blob 或同源 blob 链接，不再交给 TM 的跨域下载 |

## 19. 独立版设置持久化 + 恢复默认（v1.2.10）

现象：保存重命名规则后，打开新页面又回到默认值。

原因：设置只写 `GM_setValue`，而部分浏览器的 TM 沙箱里它可能静默失败（`store.set` 里 `catch` 掉了异常，什么都不存也不报错）。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 把视频/图文规则改成 `<video_author>/<video_title>-<video_episode>.<ext>` 与 `<opus_author>/<opus_title>-<opus_order>.<ext>`，点保存 | 输入框保持新值，toast「设置已保存（下次打开页面仍然生效）」 |
| 2 | **重新加载页面**后再开面板 | 两条规则仍是自定义值 ✅ |
| 3 | 点「恢复默认」→ 确认 | 两条规则回到 `<video_title>-<video_id>-<video_episode>.<ext>` / `<opus_title>-<opus_id>-<opus_order>.<ext>`，toast「已恢复默认设置」 |
| 4 | 恢复默认覆盖范围 | `DEFAULTS` 全部键（清晰度/子目录/规则/并发/间隔/六种附加文件/多选开关）+ 评论图规则 |
| 5 | 存储后端 | `GM_setValue` 与 `localStorage` 双写；读取时 GM 为空则回落 localStorage |

## 20. 独立版下载链路重做（v1.2.14）

用户反馈「1.2.10 之后连下载都失败了，而且还会开图片新标签页」。逐层定位到 4 个问题：

| # | 问题 | 版本 | 处理 |
|---|---|---|---|
| 1 | `GM_xmlhttpRequest` 用 `responseType: "blob"`，部分 Tampermonkey 版本不支持 → 响应为空 → `createObjectURL` 抛错 → 全部失败 | 1.2.10 | 改用 `"arraybuffer"`，再由 `toBlob()` 兼容 Blob / ArrayBuffer / TypedArray / 字符串 |
| 2 | 手动加了 `Origin` / `Referer` 请求头，属于浏览器受限头，带上会让请求直接失败 | 1.2.11 | 完全不设置这两个头 |
| 3 | `@connect *.hdslb.com` 这种通配写法不被所有 TM 版本识别 → 跨域被拦 | 1.2.12 | 改为 `@connect hdslb.com` / `bilivideo.com` / `bilibili.com` / `biliapi.net`，并补 `@connect *` |
| 4 | blob 失败时回落到 `GM_download`；TM「浏览器下载模式」会把跨域图片开成新标签页 | 1.2.14 | 图片**只走 blob**，失败就明确报错（宁可失败也不开标签页）；视频仍用原生下载 |

另外：保存改用合成 `MouseEvent` + `bubbles:false`（不再 `a.click()`），避免被 B站 全局点击监听改写；每次下载记 `__bilidlDlLog`（`how: blob / blob-fail / native`）。

| # | 用例 | 结果 |
|---|---|---|
| 1 | `GM_xmlhttpRequest` 返回 ArrayBuffer | 1 次调用、`saved` 1 个 `a-1.jpg`（size 17）、`native` 0、`opened` 0、日志 `how:"blob"` |
| 2 | 同上返回 Blob | 同上通过 |
| 3 | `GM_xmlhttpRequest` 直接报错 | 队列标失败并显示原因「网络错误（可能被 @connect / 防盗链拦截）」，`native` 0、`opened` 0（不回落、不开标签页） |
| 4 | 伪装 `GM_download` 为「开新标签」的实现 | 全程 0 次调用 |

## 21. 独立版 1.2.15：初始化中断 / 保存失败三连修

用户 Console 截图里的三条真错，逐条修掉：

| 报错原文 | 根因 | 修法 |
|---|---|---|
| `ReferenceError: Cannot access 'opicSeq' before initialization` at `refreshOpusCount` | `let opicSeq = 0` 声明在 797 行，`refreshOpusCount()` 在 713 行就被调用 → TDZ | 声明上移到状态变量区（`selMode` 之后），全文件只有一处声明 |
| `TypeError: Failed to construct 'MouseEvent': Failed to read the 'view' property from 'UIEventInit'` | TM 沙箱里 `window` 是代理对象，`{view: window}` 无法转成真 `Window` | `saveBlob` 去掉 `view`，改 `{bubbles:false, cancelable:true, composed:true}`，外面再包 try/catch → 回落 `a.click()` |
| `GM_getValue / GM_setValue / GM_registerMenuCommand is not supported.` | 环境里 GM_* 缺失或未授权；顶层直接调用会抛错中断整个脚本 | 主脚本新增 `gmGet/gmSet` 包一层（GM 缺失回落 `localStorage["bilidl.gm.*"]`）；`GM_registerMenuCommand` 整块包 try/catch |

验证：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 真实 opus 页加载独立版 | `window.__errs=[]`、版本 `v1.2.15`、图片计数 `100张图` |
| 2 | 真实 opus 页加载主版 | `window.__errs=[]`、标题 `推送到 BiliDL v1.7.8`、计数 `100张图` |
| 3 | `gmDownload` 走 ArrayBuffer 桩 | 保存 `t-1.jpg`、`native 0`、`opened 0` |
| 4 | 直接 `saveBlob(new Blob)` | 保存 `direct.txt`、无异常 |

## 22. 独立版 1.2.17：不再自动开标签页 + 子目录开关

两个问题分开处理：

| 问题 | 根因 | 修法 |
|---|---|---|
| 下载成功但自动开一个新标签页 | 之前把 `<a download>` **挂进 document** 再派发 click，事件在捕获阶段经过 B站 的 document 级监听，被当成「打开图片」→ 新标签 | 锚点不挂进文档，直接 `a.click()`；内核要求挂载时才走 `dispatchEvent` 兜底，并在派发前 `stopPropagation` |
| 图文重命名规则里写 `/` 不建子目录 | 浏览器 `a[download]` 只能给文件名，`/` 会被替换成 `_`（这是浏览器限制，不是脚本 bug） | 设置里新增「用 GM_download 保存小文件」开关（默认关）：开了走 TM 的 downloads API，`name` 里的相对路径能真正建目录 |

实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 页面挂 document capture 点击监听（模拟 B站），默认配置下载图片 | `opened=0`、保存 `t-1.jpg`、无异常 |
| 2 | 打开「用 GM_download 保存」后下载 `作者/子目录/b-1.jpg` | 走 native，`name` 原样带子目录 |
| 3 | 面板渲染 | 显示 `v1.2.17`，开关存在且跟随配置 |

## 23. 独立版 1.2.18：彻底不弹新标签页（A/B 定位）

A/B 实验（真实 opus 页，注册 document 捕获阶段 click 计数）：

| 做法 | 页面监听看到的点击 | 下载结果 |
|---|---|---|
| A：`<a>` 挂进 document 再 `dispatchEvent(click)`（1.2.17 及更早的兜底路径） | **1 次** → B站 当成「打开图片」，于是弹新标签 | 文件也生成了（所以表现为「下载成功 + 多一个标签页」） |
| B：`<a>` 放进 **closed shadow root**，`dispatchEvent({composed:false})` | **0 次** | 文件正常生成 |

`composed: false` 的事件不会跨出 shadow 边界，所以 document 上的捕获/冒泡监听都收不到 —— 这就是根因与修法。

1.2.18 的保存顺序：① shadow root 派发（主路径）→ ② 游离节点 `click()` → ③ 挂进文档兜底（只在前两条都失败时）。同时把评论区图片下载也改走同一套 `gmDownload`（原来直接用 `GM_download` 并带 `Referer`/`Origin` 受限头，既会失败也可能被 TM 回落到「浏览器打开」）。

实测（真实 `www.bilibili.com/opus/1187271566475395078`）：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 连下 3 张图 | 文件 `pic-0/1/2.jpg` 全部落盘 |
| 2 | 页面 capture 点击计数 | **0**（页面完全没感知） |
| 3 | `window.open` 计数 / `GM_download` 计数 | 0 / 0 |
| 4 | 标签页数量 | 5 → 5（没有新增） |

## 24. 面板「点一下就自己关掉」的根治（1.2.19 / 主版 1.7.9）

排查：把面板里每个按钮/输入框逐个点了一遍，**脚本自己没有关闭逻辑**（`setSaPanel(false)` 只挂在 × 上）。所以关闭一定来自外部：B站 的全局点击监听、SPA 重渲染把 `<div id="bilidl-sa-wrap">` 整块摘掉、或别的脚本抢焦点。

做法：**面板自愈**——用户主动打开后记 `saPanelWanted = true`，每 700ms 检查一次：wrap 不在文档里就重新 append，`display` 不是 `block` 就改回来；用户点 × 或再点圆点关闭时 `saPanelWanted = false`，之后不再自动恢复。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 打开面板 | `display: block` |
| 2 | 外部把 `display` 改成 `none` | 1.5s 内自动恢复 `block` |
| 3 | 把整个 `#bilidl-sa-wrap` 从 DOM 移除 | 自动重新挂回、面板可见 |
| 4 | 用户点 × 主动关闭 | 保持 `none`，不会被自愈强行弹回来 |

## 25. 圆点「点一下打开后立刻关闭」的真因（1.2.20 / 主版 1.7.10）

真因就一行：**一次真实点击同时触发了两个开关** ——
- `document` 上的 `mousedown` 捕获兜底（当初为了防止 B站 吞 click 加的）→ `setSaPanel()` 打开；
- 紧接着的 `click` → `setSaPanel()` 又把它关掉。

于是表现为「点一下，面板闪一下就没了」。

修法：两个入口统一走 `toggleSaPanel()`，400ms 内只认第一次（去抖）。

真实鼠标事件实测（CDP `Input.dispatchMouseEvent`，press+release，不是 `el.click()`）：

| # | 操作 | 结果 |
|---|---|---|
| 1 | 第 1 次点圆点 | `display: block`（372×576） |
| 2 | 第 2 次点圆点 | `display: none` |
| 3 | 第 3 次点圆点 | `display: block` |
| 4 | 主版圆点同样操作 | 打开后保持 `block`（340 宽） |

## 26. 登录了还是 720P？两条链路分别卡在哪

| 链路 | 为什么只有 720P | 现在的处理 |
|---|---|---|
| 独立版油猴（浏览器里跑） | 只用渐进式 `playurl?fnval=0&type=mp4`，B站 这种地址最高就是 720P；1080P/1080P60 只有 DASH 分离流，浏览器没有 ffmpeg 合不了 | 当选中清晰度高于渐进式可得时，自动改下 **视频轨 + 音频轨**（`-v.mp4` / `-a.m4a`），并 toast 说明；想要单文件请用 EXE/Docker/APK |
| 主版油猴 → 服务端（EXE/Docker/APK/WebUI） | 浏览器里登录 ≠ 服务端登录；服务端匿名时最高 720P | 面板新增「服务端：已登录 / 未登录（只能 720P）」提示，打开面板即检测 `/api/status` |

实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 主版面板 + 桩 `/api/status`（logged_in=false） | 显示「服务端：未登录 —— 服务端只能下 720P…」（黄色） |
| 2 | 主版版本号 | `v1.7.11` |
| 3 | 独立版选 1080P60（未登录/无权限时） | 走 DASH 双轨分支并 toast 说明（`-v` / `-a` 两个文件） |

## 27. 多种文件类型可以同时勾选（v2.1.1 / 独立版 1.2.22）

以前的问题：`纯音频` / `无声视频` 是 `if / else if` 的二选一，勾两个只会出一个文件；服务端 `normalize_extras()` 还会把 `audio_only` 强制关掉。

现在：勾几个出几个，互不覆盖。

| 勾选 | 产出（同名规则，加后缀区分） |
|---|---|
| 纯音频 | `<名>.m4a` |
| 无声视频 | `<名>-mute.mp4` |
| 两个都勾 | `<名>.m4a` + `<名>-mute.mp4` |
| 再加 srt 字幕 / srt 弹幕 / 封面 / NFO | 各再加 `<名>.srt`、`<名>-danmaku.srt`、`<名>.jpg`、`<名>.nfo` |

服务端实测（`BILIDL_DOWNLOAD_DIR=/tmp/md`，`audio_only+video_only+danmaku+cover`）：

| # | 视频 | 产出 |
|---|---|---|
| 1 | `BV1ndJv6nEqp`（弹幕为空） | `.m4a`（音频）+ `-mute.mp4`（无声）+ `.jpg`（封面），弹幕无内容自动跳过 |
| 2 | `BV1GJ411x7h7` | `.m4a` + `-mute.mp4` + `-danmaku.srt`（1200 条）+ `.jpg` |

顺带修掉一个 bug：附加文件原来对每个主文件类型各写一次，封面会重复成 `xx.jpg` 和 `xx-1.jpg` —— 现在只写一份。

独立版（1.2.22）实测 `buildVideoJobs()`：`exVideoMute+exAudio` → 两个 job（`.m4a`、`-mute.mp4`），且每个 job 都带 `extra`（字幕/弹幕/封面/NFO 只跑一次）。

## 28. 推送版圆点改蓝色并上移，避免与独立版重叠（1.7.13 / 独立版 1.2.23）

| # | 项 | 结果 |
|---|---|---|
| 1 | 推送版圆点位置 | `bottom: 132px`（原来 16px，与独立版完全重合） |
| 2 | 推送版圆点配色 | 蓝色渐变 `linear-gradient(135deg, #2f81f7, #1f6feb)` + hover 提亮 |
| 3 | 推送版图文计数条 | 同步上移到 `bottom: 184px`（图标与数字改蓝 `#4c9bff`） |
| 4 | 推送版面板 | 底边上移到 184px，正好在蓝圆点上方，不再压住独立版 |
| 5 | 两个脚本同时装（真实 opus 页） | 实测坐标：独立版圆点 757–797、推送版 641–681、计数条 601–629 —— 三者零重叠 |
| 6 | 计数气泡去重 | 谁先渲染谁占位（`__bilidlOpicOwner`），只显示一个「N 张图」，不再叠两层 |

## 29. 评论区「9 张只显示 8 张」（1.2.24 / 主版 1.7.14）

真因：图片收集只认 `img[src*="hdslb.com"]` 和 `source[srcset]`，于是漏掉两类很常见的渲染方式：

1. **懒加载**：`<img src="占位图" data-src="真正的 hdslb 地址">` —— `src` 不含 hdslb，选择器直接跳过；
2. **背景图**：`<div style="background-image:url(https://i0.hdslb.com/bfs/new_dyn/….jpg)">`（九宫格最后一张常用这种裁切容器）。

再加上 `srcset` 里有多个候选时只取了第一个（低分辨率那份），数量对得上但丢图。

修法：收集器改成扫描元素的所有图片属性 —— `src / data-src / data-original / data-fail-src / srcset / data-srcset / href / poster`，外加 `style.background-image:url(...)`；`srcset` 取**最后一项**（清晰度最高）；统一剥掉 `@480w_360h_1c.webp` 这类缩放后缀并按去后缀结果去重。

实测（同构 mock：7 张普通图 + 1 张 `data-src` 懒加载 + 1 张背景图 + 1 张双候选 `srcset` + 头像/表情干扰）：

| # | 用例 | 修复前 | 修复后 |
|---|---|---|---|
| 1 | 收集到的图片数 | 8（丢懒加载/背景图） | **10**（`a1..a7` + `lazy8` + `bg9` + `s10big`） |
| 2 | 头像 `bfs/face/`、表情 `bfs/emote/` | 已排除 | 仍然排除 |
| 3 | 按钮文案（独立版） | 保存图片 8 | **保存图片 10** |
| 4 | 按钮文案（推送版） | 保存图片 8 | **保存图片 10** |
| 5 | `srcset` 双候选 | 取 240w 小图 | **取 720w 大图** |

## 30. 九宫格「+1」隐藏图也算上（1.2.25 / 主版 1.7.15）

现象：评论 9 张图，按钮写「保存图片 8」，因为第 9 张被折进九宫格的 **`+1`** 遮罩里，DOM 里根本没有那个 `<img>`。

修法：不再只数 DOM，**用评论接口的图片列表兜底**：

- `cmtLoadMap()` 拉 `/x/v2/reply?oid=<aid>&type=1&pn=1..3&ps=20&sort=2`，把每条评论的 `content.pictures[]` 记成 `rpid → 图片列表`（含楼中楼）；
- 挂按钮时先按 DOM 数量显示，再用接口列表校正（`8 → 9`）；点下载时同样以接口列表为准，**一张不漏**；
- 接口图与 DOM 图用「去掉 `@480w` 缩放后缀」的 URL 对齐；找不到 rpid 时用图片 URL 反查，避免 `rpid` 超过 2^53 被 JSON 解析掉精度（`…567` 变 `…700`）导致对不上；
- `aid` 优先取页面 `__INITIAL_STATE__.aid`，没有再从 BV 号查，评论区页面没有 BV 也能用。

实测（mock：DOM 只放 8 张，接口返回 9 张，第 9 张只在接口里）：

| # | 用例 | 结果 |
|---|---|---|
| 1 | DOM 收集数 | 8 |
| 2 | 接口校正后 | **9** |
| 3 | 独立版按钮文案（3s 后校正） | **保存图片 9** |
| 4 | 推送版按钮文案 | **保存图片 9** |
| 5 | 下载循环使用的列表 | 接口 9 张（含 `+1` 那张） |

## 31. 失败任务可重试 + 图文连下防风控（服务端 2.1.2 / 独立版不变）

### 31.1 失败任务重试

| # | 用例（服务端） | 结果 |
|---|---|---|
| 1 | 造一个失败任务（opus id 999…） | `stats.error=1`，`message` 有原因 |
| 2 | `POST /api/tasks/retry` | `{"retried":1}`，任务回到 `queued` 并重新执行 |
| 3 | `POST /api/tasks/clear`（清除已完成） | 失败任务**保留**（`error` 仍在列表里） |
| 4 | WebUI 按钮 | 任务队列页新增「重试失败」，点了提示「已重新排队 N 个失败任务」 |

| # | 用例（手机版） | 结果 |
|---|---|---|
| 5 | 失败任务 + `POST /api/tasks/retry` | `{"retried":1}`，任务重新排队后再次失败 |
| 6 | `POST /api/tasks/clear` | `{"cleared":0}`，失败任务保留 |
| 7 | 手机界面 | 任务页顶部「重试失败」「清除已完成」，失败行单独有「重试」按钮 |

### 31.2 图文连下防风控

- 图文任务基准间隔从 `file_interval`(0.8s) 提到 **≥2.6s**，并叠加 `0.4~1.8s` 随机抖动；
- 每连续 8 个图文任务**强制休息 25~45 秒**（日志会写「图文已连下 8 个，休息 N 秒」）；
- 手机版同样处理（`max(fileInterval,2.6s)` + 抖动 + 每 8 个休息 25~45s）。

实测：一次提交 2 个图文（6 图 + 16 图），两个任务全部 `done`，22 个文件落盘，全程无 -352/-412/429。

## 32. 多选发送后按钮卡在「解析中/发送中」（1.7.17 / 独立版 1.2.28）

真因：`sendPicked()`（推送版）/ 独立版发送按钮在 `finally` 里只恢复了 `disabled`，**没把文案改回来**；而且独立版是在 `await addWorks(list)` 之后才恢复，接口一慢（几个作品逐个取详情）按钮就一直停在「解析中…」，用户以为卡死、也没法再选。

修法：

- 推送版：`finally` 里同时恢复文案 `发送下载` 和模态框按钮；另加 **12s 兜底定时器**，服务端无响应也会把按钮还回去。
- 独立版：改成**不阻塞**——点发送后立即 `clearPicked()+restore()`，把「加入队列」放到后台 Promise 链里执行，成功/失败都只弹 toast；再选作品时 `syncSel()` 也会顺手把残留的「解析中…」文字改回去。

实测（mock 3 个图文卡）：

| # | 场景 | 推送版 | 独立版 |
|---|---|---|---|
| 1 | 选 2 个后按钮 | `发送下载（2）` 可点 | `发送下载` 可点 |
| 2 | 点发送瞬间 | `发送中…` 禁用 | `解析中…`（瞬时） |
| 3 | 发送完成后 | **`发送下载`**（不再是发送中） | **`发送下载`**，可继续操作 |
| 4 | 再选 1 个 | `发送下载（1）` 可点 → 能再发一次 | 可点 → 能再发一次 |
| 5 | 连发两轮 | 两轮都成功入队 | 两轮都成功入队 |

## 33. 图文图片数显示翻倍（1.7.18 / 独立版 1.2.29）

现象：`opus/1261473128725348356` 实际 10 张图，右下角气泡显示 20。

原因：B站 图文详情页会把每张图**渲染两遍**（SSR 直出的一份 + 前端 hydration 再渲染的一份），`querySelectorAll('img')` 数到的是节点数（该页 DOM 里 21 个 `<img>`、11 个唯一地址），旧实现按节点计数所以正好翻倍。

修法：`opicCountFromDom()` 改成「按图片地址去重」——`currentSrc/src/data-src` 先剥掉 `@480w_1c` 这类缩放后缀和 query，再放进 `Set` 取 `size`；仍然只统计 `hdslb.com/bfs/` 的图。

| # | 页面 | 图片数 | 修复后显示 |
|---|---|---|---|
| 1 | `opus/1261473128725348356` | 10 | **10 张图**（原来 20） |
| 2 | `opus/1257520704352419856` | 100 | 100 张图（无回归） |
| 3 | `opus/1259399413247246341` | 16 | 16 张图（无回归） |

## 34. 刷新 WebUI 后继续显示任务进度（服务端 2.1.3）

原来任务只在「任务队列」页轮询（`if (state.page === "tasks") pollTasks()`），刷新后回到下载页就看不到任何进度，用户以为任务丢了。

改动：

1. 轮询改成**全局每 1.5s**（不再依赖当前页面）；
2. 新增底部悬浮进度条 `#miniTasks`：`正在下载 N 个 · 72%` + 进度条 + 「查看」+「×」，任意页面都显示，只在有 `running/pending` 任务时出现；
3. 「查看」跳到任务队列；「×」只是收起当前提示，任务本身照常跑；
4. 任务跑完/排空后进度条自动消失。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 下载中打开 WebUI | 底部出现 `正在下载 1 个 · 17%` |
| 2 | **F5 刷新** | 进度条仍在，继续更新到 `68%` |
| 3 | 再等到完成 | 到 `91%` 后自动隐藏（`display:none`） |
| 4 | 点「查看」 | 切到任务队列页，列表与进度一致 |
| 5 | 点「×」 | 只收起悬浮条，任务继续（服务端状态不变） |

## 35. Docker 连不上 / 下载失败的自检（服务端 2.1.4 / 推送版 1.7.20）

### 35.1 新增 `/api/diagnose`

`GET /api/diagnose` 会依次探测 B站 主接口、Passport、视频 CDN，并检查两个下载目录能否写入，返回 `ok/status/ms/writable`。「下载设置」页新增「**网络自检**」卡片，点「运行网络诊断」直接显示结果。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 正常环境 | `✅ B站 主接口 200 71ms`、`✅ Passport 200 64ms`、`✅ 视频 CDN 403 164ms`（403 属正常，说明能连通）、两个目录「可写」 |
| 2 | UI 按钮 | 结果按行渲染，失败项标 ❌ 并给出错误文本 |
| 3 | 全部失败 | 追加提示「容器可能没有外网 / DNS」 |

### 35.2 推送版油猴支持局域网地址

`@connect` 补 `192.168.*`、`10.*`、`172.*`、`*`；`probeServer()` 连不上时改为给出 4 条排查提示（写全 `http://IP:2196`、同网段、Docker 端口映射、@connect 已放行）。

## 36. 视频下载报 `referer` / `dest` 未赋值（服务端 2.1.5，回归修复）

回归来源：2.1.1 支持「同时下纯音频+无声视频」时，把 `referer` 和 `dest` 的赋值挪进了 `if audio_only or video_only` 分支，导致**默认（普通有声视频）路径**里这两个变量从来没被赋值，于是：

- 第一次报 `未知错误：cannot access local variable 'referer' where it is not associated with a value`
- 补 `referer` 后又报 `... 'dest' ...`

修法：把 `referer = f"https://www.bilibili.com/video/{bvid}"` 提到分支之前；普通路径在分支之后统一算 `rel/base/dest`（`base` 用于判断「已下过」，`dest` 再走 `unique_path`）；`skip_existing` 改成判断 `base.exists()`，避免每次重复下载都生成 `-1` 副本。

| # | 用例 | 结果 |
|---|---|---|
| 1 | `BV1hWp76FEQd` 默认下载（未登录 720P） | `done`，`…-BV1hWp76FEQd-1.mp4` |
| 2 | 同一视频再下一次 | `skipped`「已存在，跳过」，不再产生 `-1-1.mp4` |
| 3 | 勾「纯音频+无声视频+封面」 | 同时产出 `.m4a`、`-mute.mp4`、`.jpg` 三个文件 |
| 4 | 任务列表错误字段 | 三条路径都不再出现 `referer`/`dest` 未赋值 |

## 37. 文集（readlist）下载 + 视频合集变量（服务端 2.1.6 / 推送版 1.7.21）

### 37.1 新增变量与规则

- 文集规则变量：`<readlist_title>` 文集标题、`<readlist_order>` 文集内文章序号、`<readlist_id>` 文集 ID（`rl1100717`），并复用 `opus_*`；默认模板 `<readlist_title>/<readlist_order>-<opus_title>/<opus_id>-<opus_order>.<ext>`。
- 视频新增：`<videolist_title>`、`<videolist_order>`、`<videolist_id>`、`<video_author_uid>`；不在合集里时前三个是空串，`naming` 会把变量连同相邻的 `-` `/` 分隔符一起删掉（实测 `<合集标题>/<序号>-<标题>` → `标题.mp4`，`<标题>-<序号>-<BV>` → `标题BV1x.mp4`）。

### 37.2 实测

| # | 用例 | 结果 |
|---|---|---|
| 1 | 文集规则渲染 | `画集/02-第一章/cv123-3.jpg` |
| 2 | 带文集上下文下图文（服务端） | `图文/画集测试/02-【虹咲】磨豆腐…/1187271566475395078-1.jpg` |
| 3 | 视频合集变量 | 模板 `<videolist_title>/<videolist_order>-<video_title>-<video_id>` → `碧蓝档案 냥붑老师个人翻译合集/677-日奈与老师…-BV1ndJv6nEqp.mp4` |
| 4 | 解析视频合集链接 `space…/lists/6413356` | `kind=videolist`、`count=600` |
| 5 | 解析文集链接 `read/readlist/rl1100717`（未登录） | `需要登录：账号未登录`（B站 该接口强制登录） |

### 37.3 接口事实

- 文集：`/x/readlist/detail/meta` 与 `/x/readlist/detail/all` 必须 **WBI 签名 + 登录**，匿名一律 `-101`；
- 视频合集：`/x/polymer/web-space/seasons_archives_list?mid=&season_id=` 匿名可用，返回 `archives[]`（bvid/title/pic/duration/ctime）与 `meta.name`。

## 38. 失败任务「重试」按钮（服务端 2.1.7 / 手机 / 独立版 1.2.30）

| 端 | 入口 |
|---|---|
| WebUI / EXE / Docker | 任务队列：每个失败任务行右侧「重试」，页面顶部「重试失败」批量；`POST /api/tasks/retry {"id": "..."}` 可只重试一个 |
| 手机 APK | 任务页「重试失败」，失败行「重试」（改为只重试该条） |
| 独立版油猴 | 队列区「重试失败」：把所有失败的文件重新排队（`failedJobs` 保留原 job） |

实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 造失败任务 `opus 999…` | `status=error` |
| 2 | `POST /api/tasks/retry {"id":"19c87395236e"}` | `{"retried":1}`，任务回到队列重跑 |
| 3 | 只传 id 不影响其它任务 | 其它任务状态不变 |
| 4 | Java 编译 + APK 重新构建 | 通过，`versionCode=3` |

## 39. 视频合集链接「解析后没有视频」（服务端 2.1.9）

原因有两个：

1. **解析太慢**：`seasons_archives_list` 原来按 `page_size=30` 翻页，每页还 sleep 0.6s，688 个视频要 ~24s，UI 一直显示「解析中…」，看起来像没结果。
2. 合集卡片默认把 688 个视频全勾上，容易误点「下载选中视频」一次排 688 个任务。

修法：

- `page_size` 30 → **100**，页间 sleep 0.6 → 0.4s：688 个视频 **8.8s** 解析完；
- 合集卡片默认**不勾选**任何视频，需要自己点「全选」或逐个勾。

| # | 用例 | 结果 |
|---|---|---|
| 1 | `POST /api/parse` 合集链接 | 8.8s 返回 `kind=videolist`、`count=688`、`works=688` |
| 2 | WebUI 渲染 | 1 张卡片、688 个视频 pill、标题「合集·碧蓝档案 냥붑老师个人翻译合集」 |
| 3 | 默认勾选 | 0 项（`已选择 0 项`），点「全选」才 688 项 |
| 4 | 侧栏版本 | v2.1.9 |

## 40. 合集 / 分集缩略图（服务端 2.2.0）

| 位置 | 改动 |
|---|---|
| 合集（videolist） | pill 列表换成**缩略图网格**（`168px` 起自适应、`16:10` 封面、懒加载、选中粉色描边），688 个视频也能流畅滚 |
| 合集 episodes | 每个 pill 前置 `44×26` 小封面 |
| 视频 pages（多分集） | 同上，取 `pages[].first_frame` |
| 单分集视频 | 不显示分集缩略图（首帧常是黑帧，卡片本身已有大封面） |
| 协议 | 接口返回的 `http://` 首帧/封面统一升级成 `https://`，避免 https 页面被混合内容拦截 |
| 兜底 | 图片加载失败时回落视频封面（`data-fb`），仍失败则隐藏，不留黑块 |

实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 合集 6413356（688 个） | 688 张缩略图，可见区域 60 张已加载，滚动懒加载 |
| 2 | 合集选中态 | 点卡片变粉色描边 + 文字提亮 |
| 3 | 视频 BV1ndJv6nEqp 的合集 episodes | 688 个 pill 全部带 `44×26` 缩略图 |
| 4 | 同上分集 pill | 单分集视频不显示缩略图（干净，无黑块） |
| 5 | 缩略图 URL | 全部 `https://`，无混合内容告警 |

## 41. 文集批量下载 & 文集/合集重命名变量（服务端 2.2.1 / 独立版 1.2.33 / 推送版 1.7.23）

| 能力 | 端 | 状态 |
|---|---|---|
| 粘贴文集链接 → 列出全部文章、可逐篇勾选、批量下载 | WebUI / EXE / Docker | ✅（2.1.6 起，需登录才取得到文章列表） |
| 独立「文集重命名规则」`<readlist_title>/<readlist_order>-<opus_title>/<opus_id>-<opus_order>.<ext>` | WebUI 设置页 | ✅ |
| 视频重命名新增 `<videolist_title>`/`<videolist_order>`/`<videolist_id>`/`<video_author_uid>` | WebUI 设置页 | ✅ 并在「视频变量」里统一提示 |
| 不在合集里 → 三个 videolist 变量连同 `-/` 一起消失 | 服务端 naming | ✅ 实测 `T-BV1x-2.mp4` / `合集A/677-T-601598.mp4` |
| 文集页开多选、按篇挑选后发送 | 推送版油猴 | ✅ |
| 文集页开多选、按篇挑选后本地下载 | 独立版油猴 | ✅ 本次新增（原先不支持 article） |
| 列表页多个作品共用一个勾选框 | 两个油猴 | ✅ 本次修复：容器里有多个作品链接时以链接自身为卡片 |

独立版实测（mock 文集页 `rl1100717`，3 篇文章）：

```
boxes=3  → 已选 2 个（视频 0 / 图文 2）
renderPath(readlistTpl, {readlist_title:"イドラ老师作品合集", readlist_order:2, opus_title:"第一篇",
                         opus_id:"10000001", opus_order:3}) 
→ BiliDL/イドラ老师作品合集/2-第一篇/10000001-3.jpg
```

服务端命名单测：

```
<video_title>-<video_id>-<video_episode>.<ext>   → T-BV1x-2.mp4
<videolist_title>/<videolist_order>-<video_title>-<video_author_uid>.<ext> → 合集A/677-T-601598.mp4
（非合集视频）<videolist_title>/<videolist_order>-<video_title>.<ext> → T.mp4
文集默认模板 → RL合集/3-P/118-2.jpg
```

## 42. 独立版油猴补齐文集 / 合集变量（1.2.35）

| 能力 | 实现 |
|---|---|
| 文集页多选 | `workOf()` 在 `/read/readlist/rl…` 页给每篇文章挂 `readlist{id,title,order}`（序号按页面上 `a[href*="/read/cv"]` 的顺序） |
| 专栏文章下载 | 新增 `buildArticleJobs()`：GM 抓 `read/cv` 页面 → 解析正文 `img` → 逐张下载（原来直接报「暂不支持的链接类型：article」） |
| 文集重命名 | 面板新增「文集重命名规则」输入框，默认 `<readlist_title>/<readlist_order>-<opus_title>/<opus_id>-<opus_order>.<ext>` |
| 合集变量 | 视频任务新增 `<videolist_title>`/`<videolist_order>`/`<videolist_id>`/`<video_author_uid>`：合集页取页面上下文，普通视频页取 `ugc_season` |
| 缺失变量 | `renderPath()` 现在会把缺失变量连同相邻 `- _ / 空格` 一起删掉（原来会留下 `-单集.mp4` 这种残渣） |
| 面板提示 | 视频/文集变量说明直接写在输入框下面 |

实测：

```
# 文集命名（mock 文集页 3 篇，选 2 篇；boxes=3、已选 2）
renderPath(readlistTpl, {readlist_title:"イドラ老师作品合集", readlist_order:2,
           opus_title:"第一篇", opus_id:"10000001", opus_order:3})
→ BiliDL/イドラ老师作品合集/2-第一篇/10000001-3.jpg

# 合集页上下文
getWorkOf(<a href="//www.bilibili.com/video/BV1ndJv6nEqp">)
→ {kind:"video", ident:"BV1ndJv6nEqp", videolist:{id:"6413356",
   title:"碧蓝档案 냥붑老师个人翻译合集", order:1}}

# 真实视频（在 688 集合集里），模板
# <videolist_title>/<videolist_order>-<video_title>-<video_author_uid>-<video_episode>.<ext>
→ BiliDL/碧蓝档案 냥붑老师个人翻译合集/677-日奈与老师结婚后依旧不厌其烦上门打扰(？)的亚子-601598-1.mp4

# 不在合集的视频，同一模板
→ BiliDL/单集.mp4（不会留下 - 或空目录）
```

## 43. 文集 404 修复（服务端 2.2.2 / 独立版 1.2.37）

**现象**：解析 `https://www.bilibili.com/read/readlist/rl1100717` 报
`HTTP 404：https://api.bilibili.com/x/readlist/detail/meta`。

**原因**：B站 已下线 `/x/readlist/detail/meta`、`/x/readlist/detail/all`（现在一律 404）。网页实际用的是
`GET /x/article/list/web/articles?id=<纯数字>&web_location=333.1400`，**匿名可用**。

**修法**：

| 位置 | 改动 |
|---|---|
| `bilidl/api.py readlist_detail()` | 换成 `/x/article/list/web/articles`，参数 `id=rl1100717 → 1100717`；从 `data.list` 取标题/作者，从 `data.articles[]` 取 `id/title/image_urls/publish_time`，封面统一 https |
| `bilidl/api.py article_detail()` | 新版专栏正文是「动态图文」：先用 `/x/article/view?id=<cv>` 拿 `dyn_id_str`，再调 `opus/detail` 取全部图片（`image_urls` 只有封面）。旧专栏仍走 HTML 解析兜底 |
| `web/app.js` | 文集文章 pill 前置封面缩略图；提示语改成「文章列表匿名可读；下载单篇若需要登录会提示」 |
| 独立版油猴 1.2.37 | `buildArticleJobs()` 同样先 `article/view` → `dyn_id_str` → `opus/detail` 取图 |

实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `GET /x/article/list/web/articles?id=1100717`（匿名） | `code=0`，`list.name=イドラ老师作品合集`，3 篇文章 |
| 2 | `POST /api/parse rl1100717` | `kind=readlist`，3 篇，带封面 |
| 3 | WebUI 渲染 | 卡片「文集 · 3 篇文章 · rl1100717」+ 3 个带封面 pill |
| 4 | 下载第 1 篇（`53550628`，带 readlist 上下文） | `done`，75 张图 → `图文/イドラ老师作品合集/1-【碧蓝档案】…②/53550628-<n>.jpg` |
| 5 | 独立版 `buildArticleJobs` | 75 张图，`BiliDL/イドラ老师作品合集/1-【碧蓝档案】…②/53550628-1.jpg` |

## 44. 合集卡片「选中」不明显 / 点了没反应（服务端 2.2.3）

两个问题：

1. **点击无效**：解析结果的点击委托只认 `.pill`，合集缩略图用的是 `.mini`，所以点封面根本不会切换选中状态（只有默认勾选/全选才有）；用户看到的就是「点了一个视频没有任何变化」。
2. **选中态太弱**：原来只有 1px 边框 + 外发光，和「没选中」差别很小。

修法：

- 点击委托改成 `event.target.closest(".pill, .mini")`，合集缩略图现在可点、可取消；
- 每个 `.mini` 左上角加**勾选框**（22×22、白色描边、毛玻璃底），选中后变粉色并显示白色对勾；卡片同时加粉色描边 + 淡粉底色；
- 「全选 / 清空」沿用 `work-all` / `work-none`。

| # | 用例 | 结果 |
|---|---|---|
| 1 | 解析合集 6413356 | 688 个 `.mini`、688 个 `.chk` |
| 2 | 点 3 张封面 | `.mini.on` = 3，左上角 3 个粉色对勾，底部「已选择 3 项（视频 3 个分集）」 |
| 3 | 再点一次 | 取消选中，计数回到 2 |
| 4 | 全选 / 清空 | 688 / 0 |
| 5 | 侧栏版本 | v2.2.3 |

## 45. 文集/专栏的 `<opus_id>` 用了 cv 号（服务端 2.2.4 / 独立版 1.2.38）

**现象**：`rl1099181` 第一篇文章 `<opus_id>` 出来是 `53451745`（cv 号），应该是 `1259399413247246341`（`https://www.bilibili.com/opus/1259399413247246341`）。

**原因**：文集解码时把 `articles[].id`（cv 号）当成了 `opus_id`；新版专栏真正的 opus id 在 `articles[].dyn_id_str` 里（等同 `/x/article/view` 返回的 `data.opus.opus_id`）。

| 位置 | 改动 |
|---|---|
| `bilidl/api.py readlist_detail()` | 每篇文章新增 `"oid": dyn_id_str`（缺失时回落 cv 号），保留 `cvid` 备查 |
| `bilidl/api.py article_detail()` | 单篇专栏优先用 `data.opus` 的 `paragraphs` 取图与 `opus_id`（原来只看 `image_urls`，只有封面） |
| `web/app.js` | 文集下载改用 `a.oid`，`sub_kind` 由 `article` 改为 `opus` |
| 独立版油猴 1.2.38 | `buildArticleJobs()` 用 `vd.opus.opus_id`（缺失用 `dyn_id_str`）作为 `<opus_id>` |

实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `readlist_detail('rl1099181')` | 6 篇；第 1 篇 `cvid=53451745`、`oid=1259399413247246341` |
| 2 | 下载第 1 篇（带 readlist 上下文） | 16 张图 → `图文/夏莱的魅魔老师/1-夏莱的魅魔老师①…/1259399413247246341-<n>.png` |
| 3 | 独立版 `buildArticleJobs` | 75 张图，文件名首段为 opus id（`1261882634483531800-1.jpg`） |
| 4 | 侧栏版本 | v2.2.4 |

## 46. 合集整季下载：35 个文件全叫入口视频的标题（服务端 2.2.4 / WebUI）

**现象**：贴 `https://www.bilibili.com/video/BV1V7nU6mE24/`（合集 4104277「碧蓝档案-角色广播剧」共 35 集），点「全选合集」下载，
35 个任务的标题 / 文件名里的 `<video_title>` 全是入口视频那一集的
「…为这位深闺门主献上约会！…牵绊对白Vol.29…」，只有 `<video_id>`（BV 号）不同。

**原因**：`web/app.js collectDownloads()` 里给所有任务都写 `video_title: item.title`（`item` = 解析入口那个视频）。
分P 场景这是对的（同一视频的 P 共用一个标题），但合集里每一集是**另一个独立视频**，
它自己的标题只被塞进了 `page_title`；而默认模板用的是 `<video_title>`，于是 35 个文件同名。
后端 `add_video_targets()` 只负责使用前端给的 `video_title`，不会再去查一次 B站，所以错在采集阶段。

| 位置 | 改动 |
|---|---|
| `web/app.js collectDownloads()` | `push()` 增加第 6 个参数 `videoTitle`；合集分集传 `ep.title`（缺失回落 BV 号），分P 仍用 `item.title` |
| `README.md` §1 | 写明合集每一集的 `<video_title>` 取该集自己的标题 |
| `tests/collect_season_test.js` | 新增回归测试：从 `web/app.js` 抽出 `collectDownloads()` 跑假 state，断言 3 集 3 个标题 |

**实测**（本机起 `python -m bilidl --port 2197`，`/tmp/bilidl-verify`；解析用真实接口，未登录）：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `POST /api/parse` 上述链接 | `season=4104277`、`episodes=35`，每集 `title` 各不相同（Vol.29 / 青春合唱Vol.19 / 牵绊对白Vol.26 …） |
| 2 | 修复前的 `collectDownloads()`（去掉第 6 参数复现） | 35 个任务、**1** 个不同的 `video_title`，34 个不匹配 |
| 3 | 修复后的 `collectDownloads()` | 35 个任务、**35** 个不同 `video_title`，不匹配 0 |
| 4 | 把两种 payload 交给 `add_video_targets()` + `build_relative()`（模板 `<videolist_title>/<video_title>-<video_id>-<video_episode>.<ext>`） | 修复后文件名首段依次为 `…Vol.29`、`…Vol.19`、`…Vol.26`，末个为 `…青春合唱 Vol.1…` |
| 5 | `node tests/collect_season_test.js web/app.js` | `PASS：合集 3 集各自使用自己的标题`；对修复前代码跑则 FAIL（3 集 1 个标题） |
| 6 | `node --check web/app.js` | 通过 |

**部署注意**：`web/` 是 `COPY web ./web` 打进镜像的，改完必须 `docker compose up -d --build` 重建，再刷新页面；
已下载的 35 个旧文件不会自动改名。

## 47. 纯音频没声音 / 标题里的 `/` 被当成目录（服务端 2.2.5）

### 47.1 纯音频没有声音

**现象**：勾「只下载纯音频」后拿到 `.m4a`，播放器里没有声音（文件在、时长也在）。

**排查**：用本机 `python -m bilidl`（临时数据目录）+ 真实接口，分别用匿名和已登录账号下载合集 4104277 里最短的一集
（`BV1amBgByEwb`，10:09）。两种状态拿到的文件都是 **AAC-LC 48kHz stereo、101 kbps**，`ffmpeg` 解码通过，
`volumedetect` 的 `mean_volume = -20.4 dB`（不是静音）——说明「所有纯音频都坏」不成立，
问题只可能出在**音轨选择**、**容器格式**或**落盘完整性**这三处，于是三处一起加固：

| 位置 | 改动 |
|---|---|
| `bilidl/api.py` | 音频轨排序改成 `_audio_rank()`：AAC(`mp4a`) 优先，杜比(`ec-3`) 等靠后；返回值新增 `audio_codec` |
| `bilidl/downloader.py` | 纯音频落盘后用 `ffmpeg.remux()` 重封装成标准 m4a（`-c copy`，不转码）；失败只 WARN 并保留原文件 |
| `bilidl/ffmpeg.py` | 新增 `remux()`（`-c copy -movflags +faststart -f mp4`） |
| `bilidl/downloader.py` | 下载到 0 字节视为失败换线路；音轨不是 AAC 时写 WARN |
| `bilidl/http.py` | 下载带 `Accept-Encoding: identity`；按 `Content-Length/Content-Range` 校验完整性，长度不够报错而不是留残缺文件；顺手修了 206 续传时总长被重复加 `start` 的 bug |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 合成轨 `ec-3 448k` + `mp4a 192k` 交给 `_audio_rank` | 选中 `mp4a.40.2`（不再按码率选到杜比） |
| 2 | `play_streams(BV1amBgByEwb, 1080P60)`（已登录） | `mode=dash`、`audio_codec=mp4a.40.2`、3 条备用音频地址 |
| 3 | 无 ffmpeg 模拟（`ffmpeg_ok=False`） | 退化为 `progressive 720P`，`dash_audio_urls` 仍有 3 条，纯音频照样能下 |
| 4 | 修复前端到后端全链路下载该集纯音频 | `.m4a` 7,740,702 B；`moof` 已消失（`-1`）、`moov` 在文件头；`ffmpeg` 解码 AAC、`mean_volume=-20.4 dB` |
| 5 | 普通视频回归（`BV1ndJv6nEqp`，36s，已登录 1080P60） | 1,990,587 B，`Stream #0:0 h264 1080x1580` + `Stream #0:1 aac`，合并路径未受影响 |
| 6 | 本机 Range 服务：整段下载 / 120000 字节续传 / 服务器忽略 Range | 三次都得到 200000 B 且与源文件逐字节一致，进度末值 `(200000, 200000)` |
| 7 | 走 HTTP：`POST /api/settings`(纯音频) + `POST /api/download`（BV1amBgByEwb / cid 34937112893） | 落盘 `碧蓝档案-角色广播剧/测试标题_带斜杠-BV1amBgByEwb-15.m4a`（7,740,702 B）：`moof` 消失、`moov` 在头部、AAC 48kHz、`mean_volume=-20.4 dB`，无 WARN |

### 47.2 标题里的 `/` 会建出一层目录

**现象**：模板 `<videolist_title>/<video_title>-<video_id>-<video_episode>.<ext>`，标题是「【官方广播剧/中文字幕】…」，实际落盘成
`碧蓝档案-角色广播剧/【官方广播剧/中文字幕】…-BV….m4a` —— 多了一层 `【官方广播剧` 文件夹。
原因：`build_relative()` 是**先渲染整串、再按 `/` 切段**，变量值里的斜杠于是冒充了模板分隔符。

| 位置 | 改动 |
|---|---|
| `bilidl/naming.py` | `_render()` 里把变量值的 `/`、`\` 统一换成 `_`；只有**模板里写的** `/` 才建子目录 |
| `tests/naming_test.py` | 新增 8 条单测：变量斜杠、模板斜杠、反斜杠、缺失变量残渣、`../` 穿越、中文别名、`build_filename` |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/naming_test.py` | `Ran 8 tests … OK` |
| 2 | 真实下载（模板同上） | 落盘为 **2 段**：`碧蓝档案-角色广播剧/【官方广播剧_中文字幕】…-BV1amBgByEwb-1.m4a` |
| 3 | `../etc/passwd` 当标题 | 仍只有 2 段，不产生 `..` 段 |
| 4 | `<videolist_title>` 为空 | 不出现 `_` / `-` 开头的残渣段，仍是 1 段 |
| 4b | 合集 4104277 全 35 集按 `<videolist_title>/<video_title>-<video_id>-<video_episode>.<ext>` 计算 | 35 个任务 / 35 个不同文件名，**段数分布只有 `[2]`**（合集目录 + 文件名），标题里 `/` 均变成 `_` |
| 5 | `node tests/collect_season_test.js web/app.js` | `PASS`（合集分集标题回归仍通过） |
| 6 | `py_compile bilidl/*.py`、`node --check web/app.js` | 通过；侧栏版本升到 **v2.2.5** |

注意：改的是「以后新下载」的落盘路径；已经下好的带 `/` 的旧文件不会自动移动。

## 48. 纯音频「有音轨但没声音」：加 MP3 输出 + 标准 m4a 封装（服务端 2.2.6）

**背景**：用户反馈 v2.2.5 下好的 `.m4a`（`BV1Qr421M7Zv-34`）在播放器里没声音。`ffmpeg -i` 显示
`Audio: aac (LC) 44100 Hz stereo 100 kb/s`，容器已是重封装后的 `M4A`/`isom` 结构，我也在同一集上测到
`mean_volume = -18.7 dB`（三条音轨 30280/30232/30216 全部有声，单声道下混 -18.8 dB，不存在反相抵消）。
即：文件本身有声音，问题在**播放端**——最常见就是设备没有 AAC 解码器（能读容器、进度条会走、就是不出声）。

**改动**（只影响「纯音频」，视频/无声视频不变）：

| 位置 | 改动 |
|---|---|
| `bilidl/config.py` | 新增设置 `audio_format`（`m4a` / `mp3`，默认 `m4a`；非法值回落 `m4a`） |
| `bilidl/downloader.py` | 纯音频按 `audio_format` 选扩展名；`_finalize_audio()`：m4a → 重封装，mp3 → 转码；转码失败自动退回 m4a（不丢文件，写 WARN） |
| `bilidl/ffmpeg.py` | 新增 `transcode_audio()`：`libmp3lame` / 192k CBR / 44.1kHz / ID3v2.3 + title/artist/album/comment；`remux()` 改用 `-f ipod`，major_brand 从 `isom` 变标准 `M4A ` |
| `web/index.html`、`web/app.js` | 设置页「下载哪些文件」里新增「纯音频格式」下拉框，随其他设置一起保存 |
| `tests/settings_test.py` | 5 条单测：默认值、大小写、非法值回落、`to_dict`、落盘/重载 |
| `data/settings.json` | 本机现有配置改为 `"audio_format": "mp3"`（用户当前设备放不出 AAC） |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/settings_test.py` | `Ran 5 tests … OK` |
| 2 | `python3 tests/naming_test.py` / `node tests/collect_season_test.js web/app.js` | 8 条 OK / PASS（命名回归未受影响） |
| 3 | `audio_format=mp3` 下 `BV1Qr421M7Zv`（15:02） | `.mp3` 21,653,038 B；`MPEG ADTS, layer III, 192 kbps, 44.1 kHz, Stereo`；ID3v2.3 带 title/artist/album；`mean_volume=-19.0 dB` |
| 4 | `audio_format=mp3` 下 `BV1amBgByEwb`（10:09） | `.mp3` 14,628,070 B；`mean_volume=-20.7 dB`；无 `.raw.m4a` 残留 |
| 5 | `audio_format=m4a` 回归 | `.m4a` 7,740,702 B、`moof` 消失、`moov` 在头、`mean_volume=-18.7 dB`；`major_brand` 已从 `isom` 变为 `M4A `（`compatible_brands: M4A isomiso2`） |
| 6 | 模拟 ffmpeg 缺失（`FFMPEG = ""`）走 mp3 | 任务 `done`，落盘 `回退测试-BV1amBgByEwb-15.m4a`，两条 WARN（转码失败→改存 m4a、重封装失败→保留原文件），没有丢文件 |
| 7 | HTTP 全链路：`/api/settings` 改 `audio_format=mp3` + `/api/download` | 返回 `settings.audio_format=mp3`；任务落盘 `MP3测试_斜杠-BV1amBgByEwb-15.mp3`（标题里的 `/` 变 `_`），无 WARN |
| 8 | 版本 | `/api/health` 返回 `version 2.2.6` |

**结论**：默认仍是 m4a（品牌已修正为 `M4A `）；设备放不出 AAC 时把「纯音频格式」切到 mp3 即可，设置会持久化。

## 49. 「取消全部任务」改成直接从队列删除（服务端 2.2.7 / 手机版 2.0.1 / 独立版 1.2.39）

**需求**：点「取消全部」时，不想在任务列表里留下一排 `canceled` 占位，要求直接把任务从下载队列里删掉。

| 客户端 | 改动 |
|---|---|
| Docker / EXE（Python + WebUI） | `Engine.cancel_all()` 现在返回删除数量：给在跑的 task 打 cancel 标记 → 清空 `asyncio.Queue` → 从 `tasks/order/specs` 删除；worker 新增 `_active` 记账与「开始下载前二次确认任务还在」，避免删掉后又被跑起来；被删任务的取消中断不再记成失败日志。`POST /api/tasks/cancel {"all":true}` 返回 `{"removed":N}`；按钮改名「取消全部任务」，提示「已取消并移除 N 个任务」 |
| 手机版（Java + 内嵌 WebUI） | `Engine.cancelAll()` 清 `tasks/pendingSpecs/pendingOpus/queue`；`Http.download()` 新增 `BooleanSupplier stop`，视频/图片下载循环里检查 `t.cancel`，在途文件立刻断掉；任务页新增「取消全部」按钮；版本 `versionCode 4 / versionName 2.0.1` |
| 独立版油猴 | 队列工具行新增「取消全部」：清空排队、中止在途 `GM_download` / `GM_xmlhttpRequest`（记录句柄并 `abort()`）、清失败与计数；版本 `1.2.39` |
| 推送版油猴 | 没有自己的任务队列（只把任务推给服务端），无需改动 |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/cancel_all_test.py` | 3 条通过：删光 tasks/order/specs/queue；二次调用返回 0；删完还能继续加新任务 |
| 2 | 引擎实测：3 个 pending 任务 | `cancel_all() -> 3`，`tasks=0 order=0 specs=0 queue=0`，`snapshot().tasks=[]` |
| 3 | 引擎实测：正在下载 `BV1amBgByEwb` | 取消后任务立即消失；3 秒后无复活、`error` 日志 0 条、`cancel_flags` 清空 |
| 4 | HTTP：创建 2 个任务后立刻取消 | `{"canceled":"all","removed":2}`；`/api/tasks` 返回 0 个任务、stats 全 0；再点一次返回 `removed:0` |
| 5 | HTTP：先跑 3 秒再取消（真正在下载） | `removed:1`，2 秒后任务仍为 0，无 error 日志，下载目录无残留文件 |
| 6 | 手机版 Java 编译 | `javac -source 8 -target 8 ...` 退出码 0 |
| 7 | 手机版 APK | 重打包签名通过，`versionCode=4 / versionName=2.0.1`；APK 内 `assets/web/app.js` 含 `cancelAll`，`index.html` 含「取消全部」 |
| 8 | 独立版油猴 | `node --check` 通过；压缩包重新生成（`dist/BiliDL-standalone-userscript.zip`，`@version 1.2.39`） |
| 9 | 版本 | `/api/health` 返回 `2.2.7` |

**说明**：Windows 便携版（`dist/BiliDL-2.2.4-win64.zip`）里是同一套 `app/bilidl` + `app/web` 源码，但本次没有条件在 Windows 上重打运行时包，
需要下次打包时重新压入（源码已同步，行为与 Docker 一致）。

## 50. 定时追更：起点作品也下载（含起点，从它开始往后）（服务端 2.2.8 / 手机版 2.0.2）

**问题**：设置「视频起点 / 图文起点」后，起点那一部永远不下载（代码是 `works[: index]`，把起点排除了），
用户要的是「从选中的作品开始往后下载，**包括起点作品**」。

| 位置 | 改动 |
|---|---|
| `bilidl/subs.py _candidates()` | `works[: idx]` → `works[: idx + 1]`（含起点）；`since_time` 兜底从 `>` 改 `>=`（含同一时刻）；候选**倒序**成时间正序，起点排最前，`max_new` 截断时起点不会排在后面被跳过 |
| `android-app/.../Subs.java scanChannel()` | `idx > 0 / subList(0, idx)` → `idx >= 0 / subList(0, idx+1)`；兜底按 `since_time` 折算日期 `>=`（原来是把所有未见作品都算进来）；同样 `Collections.reverse()` |
| `web/index.html`、`web/app.js` | 追更页说明、起点选择弹窗、Toast、订阅卡片上的起点显示都改成「含起点」 |
| `android-app/src/main/assets/web/app.js` | 起点选择弹窗标题与 Toast 同步改成「含它本身」 |
| `README.md` | §1 / §3.5 / 防风控说明同步：起点本身会下，起点之前的历史不下；不设起点仍只建基线 |
| `tests/subs_since_test.py` | 新增 10 条单测：含起点、起点在最新/最旧/中间、`max_new` 截断时起点在第一批、`seen` 过滤、时间兜底含相同时间、扫描两轮不重复、无起点建基线 |

**实测**（真实接口 + 用户现有订阅 `丸い园 (299983037)`，只读，不建任务）：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/subs_since_test.py` | `Ran 10 tests … OK` |
| 2 | 视频频道 `_candidates`（起点 `BV1L8Yc67ENM`） | 候选 1 个，**第一个候选 = 起点**，`since in works = True` |
| 3 | 图文频道 `_candidates`（起点 `1264196728515461122`） | 候选 1 个，**第一个候选 = 起点** |
| 4 | 起点设置在中间位置（单测） | 候选 = `[W3, W4, W5]`（含 W3，时间正序），更早的 W1/W2 不在 |
| 5 | `max_new=3` + 10 个作品（单测） | 建任务顺序 `[W1, W2, W3]`，起点 W1 在第一批 |
| 6 | 第二轮扫描（单测） | 0 个新作品，不重复下载 |
| 7 | 手机版 Java 编译 / APK | `javac` 退出码 0；APK 重打签名通过，`versionCode=5 / versionName=2.0.2` |
| 8 | 版本 | `/api/health` → `2.2.8` |

**对已有订阅的影响**：起点作品的 ident 从来没有进过 `seen`，所以升级后下一次扫描会把它当新作品补下（不需要重建订阅）；
如果之前不想下它、后来手动把它塞进过 seen，可在订阅里重新点一次起点（会清空 seen）。

## 51. 定时追更支持合集订阅 + 订阅列表筛选 / 多选批量操作（服务端 2.2.9）

### 51.1 合集订阅

| 位置 | 改动 |
|---|---|
| `bilidl/subs.py` | 订阅类型新增 `lists`：校验必须同时有 UP `mid` 和合集 `target`；加订阅时用 `videolist_detail(max_pages=1)` 取合集标题当订阅名；`_fetch()` 新增合集分支（翻页最多 20 页 / 100 个一页，结果统一成「新→旧」） |
| `bilidl/subs.py _candidates()` | 合集**不设起点**时不再只建基线：整季按合集顺序（旧→新）补全；设起点时与 UP 主一样「含起点、从起点往新」 |
| `bilidl/subs.py _scan_channel()` | 合集复用视频下载链路 `add_video_idents(..., all_pages=True)` —— 每个视频的**全部分P**一起下 |
| `bilidl/api.py` | `videolist_detail()` 新增 `max_pages` 参数（加订阅取标题只翻 1 页，避免一上来 7 个请求） |
| `web/index.html`、`web/app.js` | 「添加订阅」类型加「合集」；粘贴合集链接自动拆 `UID + 合集ID`；合集卡片可点「视频起点」（走 `/api/parse` 读合集列表）；文案说明全部分P/补全顺序 |

### 51.2 订阅列表按类型筛选

- 订阅列表上方新增筛选条：**全部 / UP 主投稿 / 收藏夹 / 番剧影视 / 稍后再看 / 合集**；
- 过滤后空列表会提示切回「全部」。

### 51.3 多选 + 批量开启 / 关闭 / 删除

- 每张订阅卡片新增「选择」勾选框，顶部有「全选当前 / 已选 N 个」；
- 新增接口 `POST /api/subs/batch`，body `{"action":"enable|disable|delete","ids":[...]}`，
  返回 `{"action","count","state"}`，前端一次请求完成并刷新；
- 批量删除有确认框，只删订阅记录，已下载文件不动。

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/subs_lists_test.py` | `Ran 10 tests … OK`（合集无起点=整季按顺序、起点含自身、UP 主无起点仍是基线、扫描建任务 `all_pages=True`、合集 kind 重载不丢、批量开/关/删/非法 action/空选） |
| 2 | 真实合集 `601598/lists/6413356`（只读） | 取到 **694** 个视频；标题「合集·碧蓝档案 냥붑老师个人翻译合集」；无起点时候选 694 个、第一个 = 合集第一个 `BV1EipFzMEDx` |
| 3 | 同上，起点设为倒数第 10 个 | 候选 685 个，**第一个候选 = 起点** |
| 4 | `POST /api/subs`（kind=lists, 601598/6413356） | 成功，订阅名自动填合集标题，`opus.enabled=false`、`target=6413356` |
| 5 | `POST /api/subs/batch` disable / enable | `count=1`，快照里 enabled 状态正确翻转 |
| 6 | 非法 action / 合集缺 target | 分别返回「批量操作只能是 enable / disable / delete」「请填写合集链接…」 |
| 7 | `node --check web/app.js`、`node tests/collect_season_test.js web/app.js` | 通过 / PASS |
| 8 | 回归 | `subs_since`(10)、`cancel_all`(3)、`settings`(5)、`naming`(8) 全过 |
| 9 | 版本 | 服务端 `2.2.9` |

**说明**：本轮改的是 Docker / EXE 那套 Python + WebUI；手机版（Java）的订阅页暂未加「合集类型 / 类型筛选 / 多选批量」，
需要的话下一轮按同样语义补。

## 52. 定时追更支持「文集」订阅（服务端 2.2.10）

**需求**：定时追更增加文集类型/分类，粘文集链接即可解析；文集里有新图文更新时自动下载图片。

| 位置 | 改动 |
|---|---|
| `bilidl/subs.py` | 订阅类型新增 `readlist`（白名单、重载白名单、校验、`target` 支持整条链接自动抽 `rl…`）；加订阅时用 `readlist_detail` 取文集标题当订阅名；文集只开**图文通道**（video 关、opus 开） |
| `bilidl/subs.py _scan()` | 修掉「非 UP 订阅只扫 video 通道」的写死逻辑：文集走 **opus 通道**，否则视频关了会直接跳过 |
| `bilidl/subs.py _fetch()` | 文集分支：`readlist_detail` 取文章，`ident = oid`，并把 `readlist{id,title,order}` 塞进 `AuthorWork.extra` |
| `bilidl/subs.py _candidates()` | 文集首次扫描**只建基线**；之后用 `seen`（oid 集合）判断新文章——文集顺序是作者手排的，不能按位置判断新旧 |
| `bilidl/subs.py _scan_channel()` | 建图文任务时带上 `readlist` 上下文 → 落盘走「文集重命名规则」 |
| `web/index.html`、`web/app.js` | 类型下拉加「文集」、筛选分类加「文集」；粘贴文集链接自动抽 `rl…`；添加后提示「首次建基线，之后新图文自动下载」；卡片显示文集专属起点说明 |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/subs_readlist_test.py` | `Ran 5 tests … OK`（首次基线、新 oid 识别、图文任务带 readlist 上下文、只扫 opus 通道、已见不重复） |
| 2 | `POST /api/subs`（target 传整条 `…/readlist/rl1099181?spm=1`） | 成功；`target` 归一为 `rl1099181`，名称自动为「夏莱的魅魔老师」，`video=False / opus=True` |
| 3 | 重建容器进程后读取 `data/subs.json` | `kind=readlist` 保持、通道状态保持（重载白名单已修） |
| 4 | 真实文集首次「立即检查」 | `已建立基线（6 个作品），之后只下载更新的`；建任务 0 个（符合语义） |
| 5 | 模拟新文章（从 `seen` 删掉第 6 篇后检查） | 识别到 **1** 篇新文章 → 建 1 个图文任务 → 下载 **9 张图 / 37.8MB**，落盘 `图文/夏莱的魅魔老师/6-基沃托斯把妹王⑥/1261983398752157780-{1..9}.png`（文集重命名规则生效） |
| 6 | 链接/ID 兼容 | 传整条 URL 或 `rl1099181` 均可；前端只抽 `rl` 段 |
| 7 | 回归 | `subs_lists`(10)、`subs_since`(10)、`cancel_all`(3)、`settings`(5)、`naming`(8)、`collect_season` 全过；`node --check` 通过 |
| 8 | 版本 | 服务端 `2.2.10` |

**说明**：文集首次只建基线（现有文章不下载），避免订阅一加就批量拉几百篇；要补已有文章，用「链接下载」解析同一个文集、勾选即可。
本轮仍只改 Docker / EXE 这套 Python + WebUI，手机版（Java）订阅页暂未加「文集」。

## 53. 定时追更：订阅目录可随时改（改了就搬文件）+ 每个订阅独立重命名规则（服务端 2.2.11）

### 53.1 修改保存路径 → 自动搬移旧目录全部内容

| 位置 | 改动 |
|---|---|
| `bilidl/subs.py` | 频道新增 `template` 字段；`upsert()` 里检测 `dir` 变化 → `_move_dir()`；搬完再写新路径 |
| `bilidl/subs.py _move_dir() / _merge_move()` | 递归合并搬移：同名目录合并、同名文件自动 `-1` 后缀**不覆盖**；搬完删除空旧目录；返回搬移文件数 |
| 安全约束 | 旧目录是全局下载根（或包含它）→ 只改路径不搬，写 WARN；新旧目录互相包含 → 报错拒绝；旧/新为空（用全局）→ 不搬 |
| `bilidl/server.py` | `/api/subs` 保存超时 120s → 600s（大目录搬移） |
| `web/app.js` | 保存时若目录变了先 `confirm` 提示「全部文件会移动、同名加 -1」；保存后 toast 提示已迁移 |

### 53.2 每个订阅独立视频 / 图文重命名规则

| 位置 | 改动 |
|---|---|
| `bilidl/subs.py` | `sub.video.template` / `sub.opus.template`（留空=全局）；`_scan_channel()` 建任务时把模板传给引擎 |
| `bilidl/downloader.py` | 任务 spec 新增 `template`；`_download_video()` 用它算主文件 + 附属文件（字幕/封面/NFO）；`_download_opus()` 用它算图片（文集订阅仍可用 `<readlist_*>` 变量） |
| `web/app.js`、`web/index.html` | 卡片里新增折叠的「重命名规则」：视频/图文两个 textarea，变量块复用 `/api/vars`（与「下载设置」完全一致，点一下插入）；文集订阅额外显示 `<readlist_*>` 变量 |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `python3 tests/subs_template_move_test.py` | `Ran 9 tests … OK`（文件+子目录搬移、同名不覆盖、全局根不搬、嵌套拒绝、空目录、视频/图文/文集模板透传、spec 保存模板） |
| 2 | 真实视频 + 自定义模板 `<video_author>/<video_id>-<video_episode>.<ext>` | 落盘 `v/冰果粒不加冰/BV1ndJv6nEqp-1.mp4` |
| 3 | 真实图文 + 自定义模板 `<opus_author>/<opus_id>-<opus_order>.<ext>` | 落盘 `o/西园寺玲-汉化/1187271566475395078-1..6.jpg`，走订阅 spec 模板而不是全局 |
| 4 | HTTP：订阅 dir 从 `/tmp/bilidl-move/old` 改到 `new` | `old` 下 2 个文件（含子目录）全部移动到 `new`，旧目录被删；同时保存的 `<video_id>/<video_title>.<ext>` 模板生效 |
| 5 | 回归 | `subs_readlist`(5)、`subs_lists`(10)、`subs_since`(10)、`cancel_all`(3)、`settings`(5)、`naming`(8)、`collect_season` 全过；`node --check` 通过 |
| 6 | 版本 | 服务端 `2.2.11` |

**说明**：本轮仍只改 Docker / EXE（Python + WebUI）；手机版订阅页暂未加「自定义模板 / 目录自动迁移」。

## 54. 评论区图片下载按钮出现太慢（主版 1.7.24 / 独立版 1.2.40）

**现象**：滚动到评论区后，「保存图片」按钮要等几分钟才出现，有时几乎不出现。

**根因（三个叠加）**：

1. `cmtMountIn()` 在**确认有图之前**就把评论记进 `cmtMounted`：首次扫描时图片还没懒加载出来 → pics 为空 → 直接 return，
   但这条评论已经被记为「已挂过」→ 后续扫描永远跳过，按钮再也不会出现（最致命）；
2. `cmtSchedule()` 是**防抖**（`clearTimeout` + 700ms）：B站 页面 DOM 一直在变化，定时器被无限重置，扫描可能一直不执行；
3. 评论卡片和图片都在 **shadow DOM** 里，document 上的 MutationObserver 看不到；图片懒加载写入 `src` 时不触发重扫，
   只有滚动等事件才碰巧扫一次。

**改动**：

| 位置 | 改动 |
|---|---|
| 两个油猴脚本 `cmtMountIn()` | 先 `cmtCollect()` 确认有图，**最后**才 `cmtMounted.add(key)`；没图时记录时间，1.5 秒后才允许再试（避免每次扫描空转） |
| `cmtSchedule()` | 防抖改 **500ms 节流**（定时器存在时直接忽略新的触发，不再重置） |
| 新增 `cmtObserve()` / `cmtMo` | 每棵 shadowRoot 单独挂 MutationObserver，监听 `childList` + `attributes(src/data-src/srcset/style)` |
| `cmtScanAll()` / `cmtMountIn()` | 遍历到/挂载到 shadowRoot 时调用 `cmtObserve()`，覆盖评论卡片、图片容器 |
| 启动 | `cmtSchedule()` 后追加 0.3/0.9/1.8/3.5/6 秒兜底扫描，不依赖某一次 DOM 变化 |

**实测**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `node tests/cmt_schedule_test.js tampermonkey/bilidl-pusher.user.js tampermonkey-standalone/bilidl-standalone.user.js` | 两个脚本都是「持续变化 2s 内扫描 **4** 次」PASS（旧防抖逻辑会被重置为 0 次） |
| 2 | 同上（结构断言） | 两个脚本都满足「`cmtCollect` 在 `cmtMounted.add` 之前」→ PASS |
| 3 | `node --check` 两个脚本 | 通过 |
| 4 | 版本 | 主版 **1.7.24**、独立版 **1.2.40**；`dist/BiliDL-standalone-userscript.zip` 已重打 |

## 55. Windows 端同步最新 Docker 端（2.2.11）

**问题**：前几轮只改了 Python/Web 源码和 Docker，`dist/` 里的 Windows 产物没有重新打，仍是旧版。
本次把 Windows 的两个产物都重建到 **2.2.11**。

| 产物 | 改动 |
|---|---|
| `dist/BiliDL-2.2.11-win64.zip`（便携版） | 基于旧包重打：替换 `app/bilidl/*.py`(15 个)、`app/web/*`(3 个)、`app/README.md`、根 `README.md`、`app/bilidl-pusher.user.js`、`tampermonkey/*`、`tampermonkey-standalone/*`、`BiliDL.apk`(2.0.2)、`USAGE.txt`；保留 `python/` 运行时、`app/ffmpeg.exe`、`start-BiliDL.bat`、`data/` 结构 |
| `dist/win/BiliDL.exe`（单文件桌面版） | 用 **Windows Python 3.11.9 + PyInstaller 6.22.3** 在 Wine 下重新打包（`--onefile --console --add-data "web;web" --hidden-import qrcode.image.svg build/win_entry.py`）；旧版备份为 `dist/win/BiliDL-2.2.4.exe` |

**验证**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 便携包内容 | `app/bilidl/__init__.py` = `2.2.11`；`app/web/app.js` 含 `cancelAllBtn/renameBlock`；`tampermonkey` 脚本 1.7.24、独立版 1.2.40；`USAGE.txt`/README 已写 2.2.11 |
| 2 | 便携包运行（解压后 app 源码 + 本机 Python） | `/api/health` 返回 `version 2.2.11`、`ffmpeg true`；首页含 `subToolbar` |
| 3 | 新 exe 在 Wine 下启动 | `/api/health` → `version 2.2.11`、`ffmpeg true` |
| 4 | 新 exe 的 WebUI | `/` 含 `subToolbar`；`/app.js` 含 `cancelAllBtn/renameBlock`；`/api/vars` 返回 video 12 / readlist 9 个变量 |
| 5 | 新 exe 走真实网络 | `POST /api/parse` 解析 `BV1ndJv6nEqp` 成功（标题/分P/合集都在），说明 PyInstaller 打包后 httpx/anyio 正常 |
| 6 | 体积 | exe 16.9 MB（PyInstaller 6 比旧版 9.4 MB 大，正常）；zip 51.6 MB |

**说明**：
- exe 在 Wine 下验证通过，**尚未在真 Windows 机器上跑**（按项目规则属于“上机检查项”）；如遇杀软误报/缺 DLL，请反馈。
- 覆盖升级：便携版解压新 zip 后，把旧目录的 `data\` 拷进新目录即可保留 Cookie/设置/订阅；只换 exe 的用户直接替换 `BiliDL.exe`，旁边的 `ffmpeg.exe` 和 `data\` 不动。

## 56. 直播间聊天区图片下载（主版 1.7.25 / 独立版 1.2.41）

**需求**：两个油猴脚本都要能下载直播间聊天区（评论区）里的图片，示例 `https://live.bilibili.com/27263119`。

**实现**：

| 位置 | 改动 |
|---|---|
| `@match` | 两个脚本都新增 `https://live.bilibili.com/*` |
| `cmtLivePics()` | 优先读弹幕节点 `data-image`（原图），再用正文区 `.danmaku-item-right img` 兜底；剥离 `@20h.webp` 等后缀；`http://i0.hdslb.com/bfs/...` 升为 `https://` |
| `CMT_LIVE_DENY` | 放行 `/bfs/live/`、`/bfs/emote/`；排除 `face/garb/vip/pendant/static/small_dynamic_cover`，以及正文区头像/粉丝牌/等级/用户名 |
| `cmtLiveMountIn()` | 只处理 `#chat-items .chat-item`；`data-bilidl-cmt="1"` 去重；按钮 `.bilidl-cmt-live` 追加到 `.danmaku-item-right`；没图不挂 |
| `cmtAuthor` / `cmtIdFrom` / `cmtBvid` | live 分支：`data-uname`、`data-id_str`（或 `data-ct+data-ts`）、`live<房间号>` |
| `cmtDownload()` | live 跳过视频评论的 `cmtFullPics`/API 反查，直接下载 `cmtLivePics`；扩展名支持 gif/png/webp/jpg/avif；提示改为「弹幕图片」 |
| `cmtScanAll()` / 初始化 | live 走 `cmtLiveScanAll()`；启动时观察 `#chat-items` 与 `.chat-history-list`；属性监听增加 `data-image` |
| 推送助手 | 发现 pusher 的 `cmtDownload` 调用未定义的 `gmDownload`（点击会 `ReferenceError`，实测 0/1）；补 `gmDownload`：优先 `GM_download`，失败走 `GM_xmlhttpRequest` + `a[download]` 平铺兜底 |

**验证**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `node --check tampermonkey/bilidl-pusher.user.js` / `node --check tampermonkey-standalone/bilidl-standalone.user.js` | 通过 |
| 2 | `node tests/live_cmt_test.js tampermonkey/bilidl-pusher.user.js tampermonkey-standalone/bilidl-standalone.user.js` | 两个脚本各 15 项全部 PASS（@match、data-image、live 放行 emote/排除 face、http 升 https、去重、img 兜底、有图挂一个、重复不挂、无图不挂） |
| 3 | `node tests/cmt_schedule_test.js ...` | 两个脚本各 2 项 PASS（2s 内扫描 4 次；先确认图片再记 mounted） |
| 4 | 真实直播间 DOM 注入（Chromium CDP，`live.bilibili.com/27263119`） | 页面存在 `#chat-items .chat-item`；用页面里实际抓到的 `chat-emoticon` 结构（`data-image=http://i0.hdslb.com/bfs/live/...png`，正文 `<img src="...@20h.webp">`）插入一条；pusher 挂出 1 个 `.bilidl-cmt-live`，`data-bilidl-cmt=1` |
| 5 | 同上点击按钮（`GM_download` 用桩回调 `onload`） | 按钮文字从 `1` 变 `1/1`，`disabled=false`，无异常；修复前 pusher 为 `0/1`（`gmDownload` 未定义） |
| 6 | 独立版同一真实 DOM | 挂出 1 个 `.bilidl-cmt-live`，标题「保存这条弹幕里的图片」，正文区不显示「保存图片」文字（紧凑样式） |
| 7 | 发布物 | `dist/BiliDL-standalone-userscript.zip` 重打（独立版 1.2.41，35,062 B）；`dist/BiliDL-2.2.11-win64.zip` 内 `app`/`tampermonkey` 推送脚本 1.7.25、独立版 1.2.41，README 同步；两个 zip `unzip -t` 均退出 0 |

**说明**：
- 本次重打后 Windows 便携包内脚本为 **1.7.25 / 1.2.41**（#55 记录的 1.7.24 / 1.2.40 是当时版本，已被本次覆盖）。
- 最终一次真实页面加载时聊天区没有正好出现表情弹幕，因此第 4–6 项用「真实页面 + 真实抓取的同构 `chat-emoticon` HTML」验证；选择器、`data-image`、`http` 升级、按钮挂载位置都按真实结构走。
- 无登录态，未在真实账号上点「保存」落盘（headless 里 `GM_download` 是桩）；Tampermonkey 真机首次使用请确认浏览器下载目录出现 `<author>-live<房间号>-...png`，若被 TM 的跨域/下载设置拦截，脚本会走 `GM_xmlhttpRequest` 兜底并可在控制台看到 `[BiliDL] 评论图片失败`。
- 目前观察到的直播聊天图是表情/大航海表情（`/bfs/live/`、`/bfs/emote/`）；若 B站后续增加新的图源目录，需要同步调整 `CMT_LIVE_DENY`/采集规则。

## 57. 直播间「主播动态」图片下载（主版 1.7.26 / 独立版 1.2.42）

**需求**：用户 m02004 要求：直播间下面的主播动态图片也能下载（示例仍是 `https://live.bilibili.com/27263119`）。

**实现**：

| 位置 | 改动 |
|---|---|
| `@match` | 沿用两个脚本已有的 `https://live.bilibili.com/*` |
| 新增 `dynPics(node)` | 取 `.dyn-card-opus__pics img` / `.bili-album__preview__picture img`，`source srcset` 兜底；`cmtNorm()` 剥离 `@720w...`、`http` 升 `https`、去重；`/bfs/face/` 等头像/角标继续排除 |
| 新增 `dynMountIn(node)` | 每条 `.bili-dyn-item` 只挂一个 `.bilidl-cmt.bilidl-dyn`，追加到 `.bili-dyn-item__body` 下方；`data-bilidl-dyn="1"` 去重；没图不挂 |
| 新增 `dynScanAll()` | `cmtScanAll()` 的 live 分支现在同时执行 `cmtLiveScanAll(); dynScanAll()` |
| `cmtAuthor()` | live 分支新增 `.bili-dyn-title__text`（动态作者），再回退 `.user-name` |
| `cmtIdFrom()` | 动态节点没有 `data-id_str`，用「作者 + 时间 + 第一张图」生成稳定 `dyn<hash>`，避免多条动态重名 |
| `cmtDownload()` | 支持传入 `picsFn` 与提示文案；动态按钮传 `dynPics` + `"动态图片"`，点击保存该动态全部相册图 |
| CSS | `.bilidl-dyn` 紧凑按钮，正文下方一行，不遮挡动态卡片操作区 |

**验证**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `node --check tampermonkey/bilidl-pusher.user.js` / `node --check tampermonkey-standalone/bilidl-standalone.user.js` | 通过 |
| 2 | `node tests/live_cmt_test.js ...` | 两个脚本各 15 项全部 PASS（原扫描断言已更新为同时扫动态） |
| 3 | `node tests/dyn_pics_test.js ...` | 两个脚本各 15 项全部 PASS（`@match`、`dynPics`、缩略参数剥离、http 升 https、srcset 兜底、头像排除、有图挂一个、重复不挂、无图不挂） |
| 4 | `node tests/cmt_schedule_test.js ...` | 两个脚本各 2 项 PASS（2s 内扫描 4 次；先确认图片再记 mounted） |
| 5 | 真实页面 `live.bilibili.com/27263119`（Chromium CDP） | 动态区实际有 **12** 个 `.bili-dyn-item`，其中 **8** 条带图并各挂 1 个按钮；9 图动态点击后 `GM_download` 桩收到 **9** 个文件，命名 `崩坏星穹铁道-live27263119-dyn91w5qf-1..9.png`，无重复；1 图动态收到 1 个 |
| 6 | 独立版同构 DOM（真实页面 + 注入真实 `bili-dyn-item` 结构） | 挂出 1 个按钮，点击后 2/2，命名 `测试UP-live27263119-dyn1a8lcqo-1.jpg` / `-2.png` |
| 7 | 发布物 | `dist/BiliDL-standalone-userscript.zip` 重打（独立版 1.2.42）；`dist/BiliDL-2.2.11-win64.zip` 内 `tampermonkey`/`app` 推送版 1.7.26、独立版 1.2.42、README 同步；两个 zip `unzip -t` 退出 0 |

**说明**：
- 27263119 的动态接口有时会返回空（同一页面多次刷新会出现「TA的动态 / 好像没有东西诶」）；第 5 项是在动态已加载的状态下测的。真实页面首次打开若为空，滚动到底/点一下「TA的动态」再等加载即可。
- 无登录态，headless 里 `GM_download` 用桩回调；真实落盘仍需 Tampermonkey 真机确认。
- 独立版默认 `gmSave=false` 时动态图走 blob 下载（与评论区图片一致）；第 6 项用 `gmSave=true` 走原生 `GM_download`，两条链路的按钮/命名逻辑共用。
- 动态视频封面（`/bfs/small_dynamic_cover/`）不抓，只抓图文相册；如需连封面一起下，需要单独开关，避免误下视频封面。

## 58. 移除直播间弹幕/聊天评论区图片下载（1.7.27 / 1.2.43）

**需求**：用户 m02205 要求把直播间弹幕评论下载图片的功能去掉（主播动态图片保留）。

**改动**：

| 位置 | 改动 |
|---|---|
| `@match` | 保留 `https://live.bilibili.com/*`（主播动态仍需要） |
| 采集 | 删除 `cmtLivePics` / `cmtLiveNorm` / `CMT_LIVE_DENY`；不再读取 `data-image`、`.danmaku-item-right img` |
| 挂载 | 删除 `cmtLiveMountIn`；`cmtMountIn` 不再在 live 页分流到聊天 |
| 扫描 | 删除 `cmtLiveScanAll`；live 分支改为只执行 `dynScanAll()` |
| 下载 | `cmtDownload(node, btn, picsFn, extra)` 只保留通用 `picsFn` 逻辑：动态图传 `dynPics` 并跳过视频评论 API 补全；普通评论逻辑不变 |
| 观察器 | 删除 `#chat-items` / `.chat-history-list` 监听；live 只观察 `.room-feed, .bili-dyn-list` |
| CSS | 删除 `.bilidl-cmt-live` 紧凑按钮样式；保留 `.bilidl-dyn` |
| 文案 | 面板改为「评论/动态图片重命名规则」；直播聊天不再出现任何按钮 |

**验证**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | `node --check tampermonkey/bilidl-pusher.user.js` / `node --check tampermonkey-standalone/bilidl-standalone.user.js` | 通过 |
| 2 | `node tests/live_cmt_test.js ...` | 两个脚本各 13 项全部 PASS（断言 `cmtLivePics/cmtLiveMountIn/cmtLiveScanAll/CMT_LIVE_DENY/bilidl-cmt-live/data-bilidl-cmt="1"/danmaku-item-right/data-image/chat-items` 全部消失） |
| 3 | `node tests/dyn_pics_test.js ...` | 两个脚本各 15 项全部 PASS（动态功能无回归） |
| 4 | `node tests/cmt_schedule_test.js ...` | 两个脚本各 2 项 PASS |
| 5 | 真实页面 `live.bilibili.com/27263119`（Chromium CDP，注入 1.7.27） | 聊天区 **10** 条 `.chat-item`，按钮数 **0**，`bilidl-cmt-live` 数 **0**；注入动态 fixture 后挂出 **1** 个 `.bilidl-dyn`，点击保存 **2/2**，命名 `测试UP-live27263119-dyn1a8lcqo-1.jpg` / `-2.png`；聊天区仍为 0 |
| 6 | 发布物 | `dist/BiliDL-standalone-userscript.zip` 重打（1.2.43）；`dist/BiliDL-2.2.11-win64.zip` 内推送版 1.7.27、独立版 1.2.43、README 同步；`unzip -t` 退出 0 |

**说明**：
- 本次是功能移除，未改动普通视频评论区：`bili-comment-renderer` / `.reply-item` / `.comment-item` 的按钮、九宫格补全、API 反查仍保留。
- 直播间聊天只保留 B站原始渲染，不再注入按钮/监听；如果后续要恢复，需要重新引入采集/挂载/样式，不要把 `data-image` 当成普通评论图。

## 59. 图文（opus）新版 TOP 相册提取修复（独立版 1.2.44）

**现象**：用户 m02284 打开 `https://www.bilibili.com/opus/1262380051833290755`，独立版提示
「22:04:55 铭音_MeioN的动态：图文里没有找到图片」。

**根因**：
- 该图文接口 `x/polymer/web-dynamic/v1/opus/detail?id=1262380051833290755` 返回的 `modules` 中，
  6 张图在 `MODULE_TYPE_TOP.module_top.display.album.pics`；
- `MODULE_TYPE_CONTENT.module_content.paragraphs` 只有文字段，没有 `para_type=2` 的图片段；
- 旧 `opusPics()` 只扫 `MODULE_TYPE_CONTENT.paragraphs[].pic.pics`，因此得到空数组，
  `buildOpusJobs()` 抛出「图文里没有找到图片」。

**修复**：
- `opusPics()` 同时扫描 `MODULE_TYPE_TOP.module_top.display.album.pics` 与原有 `MODULE_TYPE_CONTENT`；
- 统一 `http://` → `https://`、`//` 补 `https:`、剥 `@720w_406h_1e_1c.avif` 等后缀；
- 按 URL 去重；没有时用 `basic.image` 兜底；
- 独立版版本 1.2.43 → **1.2.44**。

**验证**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 真实接口 `opus/detail?id=1262380051833290755` | `code=0`；`MODULE_TYPE_TOP` 相册 6 张；`MODULE_TYPE_CONTENT` 只有文字段 |
| 2 | 用真实接口 JSON 跑修复后的 `opusPics()` | 返回 **6** 张，全部 `https://i0.hdslb.com/bfs/new_dyn/...jpg`，无 `@` 后缀 |
| 3 | `node tests/opus_pics_test.js ...` | 8 项 PASS（TOP 相册、http 升 https、剥 @、CONTENT 旧路径、TOP+CONTENT 合并、URL 去重、basic.image 兜底、无图返回空） |
| 4 | `node --check tampermonkey-standalone/bilidl-standalone.user.js` | 通过 |
| 5 | 真实页面 DOM（Chromium） | 页面有 6 个相册项（首图 1 张 `@1084w` + 6 张 `@80w` 缩略图，轮播其余主图懒加载），与接口 6 张一致；正文文字为「在找我？…」 |
| 6 | 发布物 | `dist/BiliDL-standalone-userscript.zip` 重打（1.2.44）；`dist/BiliDL-2.2.11-win64.zip` 内独立版同步 1.2.44；`unzip -t` 退出 0 |

**说明**：
- 本次只改独立版；主推送版把 opus 链接交给服务端，服务端走自己的 `_opus_from_modules()` + HTML 兜底，未在本次改动。
- 新版图文如果既没有 TOP 相册也没有 CONTENT 图片，仍会按原逻辑报错，不会静默成功。

## 60. 图文右下角图片数 6→3 修复（1.7.28 / 1.2.45）

**现象**：用户 m02379 打开 `https://www.bilibili.com/opus/1262380051833290755`，接口/相册实际 6 张图，
右下角「N 张图」气泡只显示 3 张。

**根因**：
- 真实 DOM 中 `.opus-module-content img` 只有 **3 个 `/bfs/emote/` 文字表情**（「在找我？」正文里的表情）；
- 6 张相册图在 `.horizontal-scroll-album img`（父级 `.opus-module-top`），首图 1 个 + 6 个 `@80w` 缩略图；
- 旧 `opicCountFromDom()` 的 opus 选择器只有 `.opus-module-content img / .bili-album img / .opus-card img`，
  没选 `.horizontal-scroll-album`，所以只数到 3 个表情；
- `opicCountFromModules()` 也只数 `MODULE_TYPE_CONTENT`，没数 `MODULE_TYPE_TOP` 的相册。

**修复**：
- DOM 选择器加 `.opus-module-top img` / `.horizontal-scroll-album img`；
- 计数前排除 `/bfs/emote|face|garb|pendant|banner|small_dynamic_cover/`，避免把正文表情、头像、横幅算进去；
- 仍按 base URL 去重（首图与缩略图同源，6 个缩略图去重后仍是 6）；
- 接口兜底加 `MODULE_TYPE_TOP.module_top.display.album.pics`；
- 主版 1.7.27 → **1.7.28**，独立版 1.2.44 → **1.2.45**。

**验证**：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 真实页面 DOM：`.opus-module-content img` | 3 个，全部是 `/bfs/emote/` 表情 |
| 2 | 真实页面 DOM：`.opus-module-top img` | 7 个节点（1 首图 + 6 缩略图），base URL 去重后 6 |
| 3 | 在真实页面执行修复后的 `opicCountFromDom(false)` | **6** |
| 4 | 真实接口 JSON 跑 `opicCountFromModules(item.modules)` | **6** |
| 5 | `node tests/opic_count_test.js ...` | 两个脚本各 3 项 PASS（接口 6、DOM 去重 6、不再只数 3 个表情） |
| 6 | `node --check` 两个脚本 | 通过 |
| 7 | 发布物 | 独立版 zip 与 Windows zip 重打（1.7.28 / 1.2.45）；`unzip -t` 退出 0 |

**说明**：该修复只影响右下角计数，不改变下载逻辑；下载仍由 `opusPics()` 的 TOP 相册提取负责。
