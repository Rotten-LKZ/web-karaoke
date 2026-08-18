# Karaoke

声乐练习应用：练习页（`index.html`）+ 制谱编辑器（`editor.html`）+ MIDI 工具页（`midi.html`）。

- 前端：Vite 多页应用，部署到 Cloudflare Pages，自定义域名 `karaoke.rotcool.me`
- 后端：Cloudflare Worker（`karaoke-api/`，Hono），自定义域名 `karaoke-api.rotcool.me`，负责为七牛云对象存储签发带过期的私有访问 URL

> [!WARNING]
> 代码中有硬编码 https://karaoke-api.rotcool.me 代码，如果自行部署记得调整成自己的真实域名。如果自己部署，可以考虑修改代码不使用七牛云，可以用 Cloudflare 的产品或者选择直接静态部署，这样就不需要部署单独的 API 侧。

## 前端

### 安装

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev
# 默认 http://localhost:5173
```

如需让前端连本地 Worker，复制环境变量示例并按需修改：

```bash
cp .env.local.example .env.local
# VITE_SIGN_API=http://localhost:8787
```

### 构建

```bash
pnpm build      # tsc + vite build，产物输出到 dist/
```

### 部署（Cloudflare Pages）

Pages 项目名为 `karaoke`，已绑定自定义域名 `karaoke.rotcool.me`。确保已登录 wrangler（`wrangler whoami`）后：

```bash
pnpm build
npx wrangler pages deploy dist --project-name=karaoke
```

部署成功后，预览地址形如 `https://<hash>.karaoke-8lz.pages.dev`，自定义域名 `karaoke.rotcool.me` 会自动指向最新部署。

## 后端 API（`karaoke-api/`）

### 安装

```bash
cd karaoke-api
pnpm install
```

### 本地开发

```bash
pnpm dev
# 默认 http://localhost:8787
```

本地密钥写入 `.dev.vars`（参考 `.dev.vars.example`）：

```
CDN_DOMAIN=https://cdn.example.com
QINIU_AK=your-access-key
QINIU_SK=your-secret-key
```

### 部署（Cloudflare Workers）

Worker 名为 `karaoke-api`，已绑定自定义域名 `karaoke-api.rotcool.me`。首次部署前需注入以下 secrets（`wrangler secret put`，每个变量单独执行、粘贴值）：

```bash
cd karaoke-api
npx wrangler secret put CDN_DOMAIN   # 七牛 CDN 域名，如 https://cdn.example.com
npx wrangler secret put QINIU_AK     # 七牛 AccessKey
npx wrangler secret put QINIU_SK     # 七牛 SecretKey
```

然后部署：

```bash
pnpm deploy   # wrangler deploy
```

非密钥配置（`CORS_ORIGIN`、`TTL_SECONDS`）写在 `wrangler.toml` 的 `[vars]` 中：
- `CORS_ORIGIN` —— 允许的前端来源（逗号分隔），生产为 `https://karaoke.rotcool.me`，本地开发包含 `http://localhost:5173`

## 测试

```bash
pnpm test          # vitest run
pnpm test:watch    # watch 模式
pnpm typecheck     # 仅类型检查
```
