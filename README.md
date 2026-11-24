# Gallery

作品卡片墙，push 到 `main` 后 GitHub Actions 自动构建并发布到 GitHub Pages：
<https://vita0519.github.io/tmp-gallery/>

`works/` 下每个 `NN-name` 文件夹是一个作品，构建到 `dist/NN/`（编号去掉前导零）。构建产物不提交。

## 添加作品

1. 新建 `works/NN-name/`。
   - **静态作品**：直接放 `index.html` 和资源，原样复制。
   - **Vite 项目**：带 `package.json`，自动 `npm ci` + `vite build --base ./`。不要留嵌套的 `.git`。
2. 可选：放 `cover.jpg`（或 `.png` / `.webp`，Vite 项目放 `public/`）作为卡片封面，建议 4:3。
3. 可选：`meta.json` 写标题、简介、标签：
   ```json
   { "title": "Hello", "desc": "一句话简介", "tags": ["webgl"] }
   ```

每个作品页面左下角会自动加一个「← 画廊」返回链接。

## 本地预览

```bash
node scripts/build.mjs
npx serve dist
```

## 首次启用 Pages

仓库 Settings → Pages → Source 选 **GitHub Actions**。
