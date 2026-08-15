# 📱 股票本 · iOS 安装指南（方案 A：PWA「添加到主屏幕」）

> 苹果 App Store 上架需要开发者账号（年费 $99）和企业证书。
> 本方案用 **PWA（渐进式 Web 应用）**，免上架、免证书，iOS 用户用 Safari 打开网址就能「添加到主屏幕」，变成一个**全屏独立 App**，体验几乎和原生 App 一样。

---

## ✨ 优势

| 项目 | PWA 方案 | App Store 上架 |
|------|----------|----------------|
| 费用 | **免费** | $99/年 |
| 证书 | 不需要 | 需要 Apple 开发者证书 |
| 审核 | **无审核** | 1~7 天审核，可能被拒 |
| 更新 | 改代码推送即生效 | 需重新提交审核 |
| 离线 | ✅ Service Worker 缓存 | ✅ |
| 桌面图标 | ✅ 粉色 🌸 | ✅ |
| 全屏 | ✅ 无浏览器外壳 | ✅ |
| 数据存储 | ✅ 本地 localStorage | ✅ |

---

## 🚀 部署到公网（一次性）

iOS 的 Safari 必须**通过 HTTPS 访问**才能「添加到主屏幕」（localhost 仅用于本机调试）。
最简单的免费方案是 **GitHub Pages**（自带 HTTPS）。

### 方法一：一键脚本（推荐）

```powershell
cd E:\app\StockWorkbench
powershell -ExecutionPolicy Bypass -File .\deploy-github-pages.ps1
```

脚本会自动：初始化 Git → 创建 GitHub 仓库 → 推送 → 开启 Pages → 输出访问网址。

> 前提：已安装 [Git](https://git-scm.com/download/win) 和 [GitHub CLI](https://cli.github.com/)（`winget install --id GitHub.cli`，然后 `gh auth login`）。

### 方法二：手动上传

1. 在 GitHub 新建空仓库，例如 `stock-book`（不要勾选 README）
2. 把 `E:\app\StockWorkbench` 目录里的**所有文件**上传到仓库根目录
3. 仓库 **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**
4. 等 1~2 分钟，访问 `https://<你的用户名>.github.io/stock-book/`

---

## 📲 iOS 安装步骤（iPhone 用户）

1. 打开 **Safari 浏览器**（必须是 Safari，Chrome/微信内置浏览器都不行）
2. 输入网址：`https://<你的用户名>.github.io/stock-book/`
3. 等页面加载完成，点底部 **分享图标** ↑（方框加向上箭头）
4. 在弹出菜单里向下滑，找到 **「添加到主屏幕」**
5. 点 **「添加」**
6. 桌面出现 **粉色 🌸「股票本」图标**
7. 点图标启动 → **全屏独立 App**，没有 Safari 的地址栏和底部工具栏

---

## ⚠️ 注意事项

- **必须用 Safari**：iOS 的 PWA 安装能力只有 Safari 支持，第三方浏览器（Chrome、夸克、微信）都不行。
- **首次需联网**：第一次打开会下载并缓存资源；之后即使断网也能打开（离线模式）。
- **iOS 16.4+ 更好**：iOS 16.4 开始支持完整 Service Worker 和 Push 通知；iOS 15 也能用，但部分离线功能受限。
- **更新生效**：每次改代码推送后，用户**下次联网打开**会自动拉取新版（Service Worker 后台更新）。
- **数据不丢**：所有股票、交易、悟道数据都存在手机本地 localStorage，**不会上传服务器**，卸载 App 才会清除。
- **微信打开的链接**：在微信里点开会用微信内置浏览器，需点右上角「⋯」→「在 Safari 中打开」再操作。

---

## 🔧 本地调试（电脑/安卓）

```powershell
cd E:\app\StockWorkbench
python -m http.server 8000
```

浏览器打开 `http://localhost:8000/` 即可调试。
> 本机调试用 HTTP 即可；**iOS 真机安装必须 HTTPS**（GitHub Pages 自动满足）。

---

## 📂 PWA 关键文件

| 文件 | 作用 |
|------|------|
| `manifest.json` | 应用清单（名称、图标、显示模式、快捷方式） |
| `sw.js` | Service Worker（离线缓存、后台更新） |
| `icons/icon-180.png` | iOS 桌面图标（apple-touch-icon） |
| `icons/icon-192.png` | PWA 标准图标 |
| `icons/icon-512.png` | 高清图标 |
| `index.html` | 入口（含 iOS meta 标签 + SW 注册） |
| `.nojekyll` | 禁用 GitHub Pages 的 Jekyll 处理 |

---

## ❓ 常见问题

**Q：为什么我的 iPhone 桌面图标是白底截图，不是粉色🌸？**
A：说明 `apple-touch-icon` 没加载到。检查 `icons/icon-180.png` 是否存在、`index.html` 里 `<link rel="apple-touch-icon">` 路径是否正确。iOS 只读 `apple-touch-icon`，不读 manifest 里的 icons。

**Q：添加到主屏幕后打开还是带 Safari 地址栏？**
A：检查 `manifest.json` 的 `"display": "standalone"` 是否存在，以及 `<meta name="apple-mobile-web-app-capable" content="yes">` 是否在 `<head>` 里。

**Q：离线打不开？**
A：首次访问必须联网让 Service Worker 完成缓存。确认 `sw.js` 注册成功（Safari 开发者控制台看 `[SW] 注册成功` 日志）。

**Q：更新了代码但 iPhone 上还是旧版？**
A：iOS 的 SW 更新较慢。可在 Safari 里清除网站数据，或等 24 小时自动更新。也可以把 `sw.js` 里的 `CACHE_VERSION` 升级一档（如 `v9` → `v10`）强制刷新。
