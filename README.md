# Gallery

[临时预览站](https://pre.allfather.top/portal) 门户公开项目的卡片墙，发布在 <https://vita0519.github.io/tmp-gallery/>。

- **数据**：构建时读取门户 `rss.xml`，卡片直接跳转 `/v/<slug>`，不存源码。
- **同步**：push 到 `main` 时构建，另外每小时定时跑一次；门户里过期的项目自动下架。
- **封面**：Playwright 截项目首屏，缓存在 `covers/`（Actions cache），只给新项目截图，下架项目的封面一并清掉。

## 本地预览

```bash
npm install
npx playwright install chromium
npm run build          # SKIP_SHOTS=1 可跳过截图
npx serve dist
```

换门户地址：`PORTAL_SITE=https://example.com npm run build`。

## 重新截某个封面

本地删 `covers/<slug>.jpg`；线上到仓库 Actions → Caches 删掉缓存后重跑。
