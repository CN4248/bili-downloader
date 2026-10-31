# 在群晖（Synology）上部署 BiliDL

> 你的目录：`/volume1/docker/bili-downloader`
> 镜像端口 **2196**，`network_mode: bridge`，构建走清华源（TUNA）。

## 最短路径（推荐，一条命令）

```bash
sudo -i
cd /volume1/docker/bili-downloader
./deploy.sh
```

它依次做：体检（docker / 目录 / 端口）→ 解析并写入下载目录 → `docker compose build`
（BuildKit 不支持时自动回退 `Dockerfile.plain`）→ `up -d` → 轮询 `/api/health` 直到就绪 →
打印 WebUI 地址。想换下载目录：`./deploy.sh --download-dir /volume1/video/Download`。
只想体检不动手：`./deploy.sh --check`。

下面是从零手工做的完整说明，脚本卡住时可以对照排查。

---

## 0. 先确认三件事

```bash
# 1) 目录里必须有 bilidl/ 和 web/（docker build 要 COPY 它们）
ls /volume1/docker/bili-downloader

# 2) 容器要用的下载目录「必须已经存在」，否则 docker 会以 root 身份建一个空目录，
#    你会以为文件丢了。先看真实路径是哪个：
ls -ld /volume1/video/Download            # 举例
ls -ld "/mnt/media/video"   # 原来的默认值，群晖上一般不存在

# 3) 端口 2196 没被占用
netstat -tlnp 2>/dev/null | grep 2196 || echo "2196 空闲"
```

> ⚠️ 群晖上 `/home/user/...` 这个路径通常**不存在**（群晖的家目录是 `/volume1/homes/<用户名>`）。
> 如果下载目录在别处，一定要改（见第 1 步），否则会挂到一个空目录里。

---

## 1. 配置 `.env`（30 秒）

```bash
cd /volume1/docker/bili-downloader
cp .env.example .env
vi .env
```

```ini
# 宿主机上真实存在的下载目录（改成你自己的）
BILIDL_HOST_DOWNLOAD=/volume1/video/Download
# 对外端口，被占用时改成 12196 之类；容器内部始终是 2196
BILIDL_PORT=2196
```

容器内的对应关系：

| 宿主机 | 容器内 | 说明 |
| --- | --- | --- |
| `$BILIDL_HOST_DOWNLOAD` | `/download` | 视频默认放这里 |
| `$BILIDL_HOST_DOWNLOAD/图文` | `/download/图文` | 图文默认放这里（WebUI 里可再改） |
| `./data` | `/app/data` | 设置、Cookie（`cookie.txt`）、临时分片 |

---

## 2. 用 SSH 部署（推荐，能看到构建日志）

```bash
ssh 你的用户名@NAS_IP
sudo -i                                   # 群晖 docker 需要 root
cd /volume1/docker/bili-downloader

docker compose version                    # 有 v2 就用 docker compose
# 只有 v1 的话把下面命令里的 "docker compose" 换成 "docker-compose"

docker compose up -d --build
```

预期输出（首次约 1–3 分钟，取决于网速）：

```
[+] Building 62.4s (12/12) FINISHED
 ✔ bilidl  Built
[+] Running 2/2
 ✔ Network bridge  Created
 ✔ Container bilidl  Started
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f --tail=50 bilidl
```

`ps` 里 `STATUS` 应该是 `Up (healthy)`（healthcheck 每 30s 打一次 `/api/health`）。

### 验证

```bash
curl -s http://127.0.0.1:2196/api/health | head -c 200
# {"ok":true,"data":{"logged_in":false,...,"ffmpeg":true,...}}
```

浏览器打开 **`http://NAS_IP:2196`** 就能看到 WebUI。

---

## 3. 用 Container Manager（GUI）部署

1. **Container Manager → 项目 → 新增**
2. 路径选 `/volume1/docker/bili-downloader`
3. 来源选「**使用现有的 docker-compose.yml**」（会自动读到 `.env`；没有 `.env` 就用默认路径）
4. 一路下一步 → 完成，它会自动 `build` 并启动

> GUI 里改下载目录最省事的办法：先按第 1 步在 SSH 里建好 `.env`，GUI 会直接沿用。
> 如果 GUI 不识别 `.env`，就直接编辑 `docker-compose.yml` 里 `BILIDL_HOST_DOWNLOAD` 的默认值那一行。

---

## 4. 第一次使用的 3 个设置

打开 WebUI 后：

1. **下载设置** → 视频目录填 `/download`，图文目录填 `/download/图文`
   （在容器里务必用容器内路径，不要填 `/volume1/...`）
2. **下载设置** → 清晰度默认 `1080P60`；未登录只能拿到 720P，想 1080P60 请先登录
3. **账号登录** → 扫码（B站 App）或粘贴 Cookie

---

## 5. 日常运维

```bash
cd /volume1/docker/bili-downloader

docker compose ps                 # 状态
docker compose logs -f bilidl     # 实时日志（Ctrl+C 退出）
docker compose restart bilidl     # 重启
docker compose down               # 停止并删除容器（./data 与下载文件都还在）
docker compose up -d              # 再启动
docker compose up -d --build      # 改了代码后重建
docker compose down -v            # 连匿名卷一起删（下载目录不受影响，谨慎）
```

升级代码：覆盖 `bilidl/`、`web/` 后 `docker compose up -d --build` 即可；
依赖清单变了的话先改 `requirements.txt`（改完必须重建，因为它是 `COPY` 进镜像的）。

---

## 6. 常见问题

**① 构建报 `the --mount option requires BuildKit`**
群晖旧版 docker 把 BuildKit 关了。二选一：

```bash
# 方案 A：打开 BuildKit 再构建
DOCKER_BUILDKIT=1 docker compose build

# 方案 B：用不带缓存挂载的 Dockerfile
docker build -f docker/Dockerfile.plain -t bilidl:1.0.0 .
docker compose up -d
```

**② 下载目录里没文件 / 文件在别处**
`docker compose config` 看一下卷的真实解析结果；再 `docker inspect bilidl --format '{{json .Mounts}}'` 确认
`/download` 的 Source 是不是你想要的目录。目录不存在时 docker 会**静默新建空目录**（属主 root）。

**③ 群晖的 File Station 看不到下载的文件**
容器内以 root 运行，落到宿主机的文件属主是 `root:root`。要么用 SSH 看，要么放行 ACL：

```bash
chown -R 1026:100 /volume1/video/Download     # 1026/100 换成你的 DSM 用户 uid/gid（id 命令查）
```

**④ 端口 2196 被占用**
改 `.env` 的 `BILIDL_PORT=12196`，然后 `docker compose up -d`，访问 `http://NAS_IP:12196`。

**⑤ 拉不到 `python:3.12-slim`**
DSM 的 Docker 里配镜像加速（Container Manager → 注册表 → 设置），或先把镜像拉下来再 build。

**⑥ ARM 机型（如 DS223j）行不行**
可以。`python:3.12-slim` 与 Debian 的 `ffmpeg` 都有 arm64 包，构建时自动选架构。

**⑦ 容器里连不上 B站**
在容器里测一下 DNS：`docker exec -it bilidl python -c "import httpx;print(httpx.get('https://api.bilibili.com/x/web-interface/nav',timeout=8).status_code)"`
不通就在 compose 的 `bilidl` 下加 `dns: [223.5.5.5, 1.1.1.1]`。

**⑧ 忘记开了什么设置**
`./data/settings.json` 就是全部设置；删掉它重启即恢复默认。`./data/cookie.txt` 是登录态（权限 600），迁移机器时一起带走。

**⑨ 从公网访问安全吗**
WebUI **没有密码**，建议只在局域网用；要公网访问就套一层反向代理（群晖「登录门户 → 反向代理」）并加 Basic Auth / 只允许内网 IP。

---

## 7. 一条命令自测（部署完跑一遍）

```bash
# 解析一个视频，确认引擎与 ffmpeg 正常
curl -s -X POST http://127.0.0.1:2196/api/parse \
  -H 'Content-Type: application/json' \
  -d '{"text":"https://www.bilibili.com/video/BV1ndJv6nEqp/"}' | head -c 300
```

返回里能看到 `"title"`、`"pages"`、`"season_episodes"` 就说明整条链路是通的。
真正下载在 WebUI 里点，或：

```bash
curl -s -X POST http://127.0.0.1:2196/api/download \
  -H 'Content-Type: application/json' \
  -d '{"video_idents":["BV1ndJv6nEqp"]}'
curl -s http://127.0.0.1:2196/api/tasks | head -c 400
```

---

## 8. 风控提醒

- 保持默认节流（API 1.2s / 扫描 1.6s / 文件 0.8s），**不要**为了快把间隔调到 0；
- 批量抓 UP 主全部作品会发出上百个请求，建议在低峰期做；
- 全程串行、遇风控码自动退避，正常情况下不会触发 -352/-412。
