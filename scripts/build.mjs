// 读取门户 /portal（RSS 上限 50 条，门户上限 500）→ 增量截封面 → 生成卡片墙 dist/index.html。
// 封面缓存在 covers/（CI 用 actions/cache 持久化），门户里消失的项目封面会被清掉。
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.PORTAL_SITE || "https://pre.allfather.top").replace(/\/$/, "");
const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const covers = path.join(root, "covers");
const SKIP_SHOTS = process.env.SKIP_SHOTS === "1";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const unhtml = (s) =>
  String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
const attr = (tag, name) => unhtml((tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1]);

// 1. 拉门户卡片
const res = await fetch(`${SITE}/portal`, { headers: { "user-agent": "tmp-gallery-build" }, redirect: "manual" });
if (res.status !== 200) throw new Error(`拉取门户失败：HTTP ${res.status}（门户需设为公开）`);
const html = await res.text();
const seen = new Set();
const items = html.split(/(?=<div class="card[ "])/).slice(1).flatMap((chunk) => {
  const head = chunk.slice(0, chunk.indexOf(">") + 1);
  const slug = (chunk.match(/<a class="hit" href="\/v\/([^"/?#]+)"/) || [])[1];
  if (!slug || !/^[\w.-]+$/.test(slug) || seen.has(slug)) return [];
  seen.add(slug);
  return {
    slug,
    link: `${SITE}/v/${slug}`,
    title: attr(head, "data-title") || slug,
    desc: unhtml((chunk.match(/<p class="desc">([^<]*)/) || [])[1]).trim(),
    exp: Number(attr(head, "data-exp")) || 0, // 0 = 永久
  };
});
const now = Date.now();
const live = items.filter((i) => !i.exp || i.exp > now);
console.log(`门户公开项目 ${live.length} 个`);

// 2. 封面：增量截图 + 清理过期
fs.mkdirSync(covers, { recursive: true });
const alive = new Set(live.map((i) => `${i.slug}.jpg`));
for (const f of fs.readdirSync(covers)) if (!alive.has(f)) fs.rmSync(path.join(covers, f));
const todo = live.filter((i) => !fs.existsSync(path.join(covers, `${i.slug}.jpg`)));
// 纯色/加载页压成 JPEG 体积很小，用体积粗判「还没出画」
const BLANK_BYTES = 25 * 1024;
if (todo.length && !SKIP_SHOTS) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, locale: "zh-CN" });
  const shoot = async (it) => {
    const page = await ctx.newPage();
    try {
      // 截项目本体 /p/，不截带倒计时的外壳；外链项目没有 /p/ 时退回 /v/
      const r = await page.goto(`${SITE}/p/${it.slug}/`, { waitUntil: "load", timeout: 30000 }).catch(() => null);
      if (!r || r.status() >= 400) await page.goto(it.link, { waitUntil: "load", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      let buf;
      for (const wait of [3000, 5000, 7000]) {
        await page.waitForTimeout(wait);
        buf = await page.screenshot({ type: "jpeg", quality: 72 });
        if (buf.length >= BLANK_BYTES) break;
      }
      fs.writeFileSync(path.join(covers, `${it.slug}.jpg`), buf);
      console.log(`  📸 ${it.slug} ${(buf.length / 1024) | 0}KB${buf.length < BLANK_BYTES ? "（疑似空白）" : ""}`);
    } catch (e) {
      console.warn(`  ⚠️ ${it.slug} 截图失败：${e.message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  };
  const queue = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await shoot(queue.shift()); }));
  await browser.close();
}
console.log(`封面：待截 ${todo.length}，缓存 ${fs.readdirSync(covers).length}`);

// 3. 生成页面
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "covers"), { recursive: true });
const tiles = live.map((it, i) => {
  const has = fs.existsSync(path.join(covers, `${it.slug}.jpg`));
  if (has) fs.copyFileSync(path.join(covers, `${it.slug}.jpg`), path.join(dist, "covers", `${it.slug}.jpg`));
  const bg = has ? ` style="background-image:url('covers/${encodeURIComponent(it.slug)}.jpg')"` : "";
  return `<a class="tile${has ? " has-cover" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-exp="${it.exp}"${bg}>
  <span class="num">${String(i + 1).padStart(2, "0")}</span>
  <span class="meta"><b>${esc(it.title)}</b>${it.desc ? `<em>${esc(it.desc)}</em>` : ""}</span>
</a>`;
});
const tpl = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(
  path.join(dist, "index.html"),
  tpl
    .replace("<!--TILES-->", tiles.length ? tiles.join("\n") : `<p class="empty">门户暂时没有公开项目。</p>`)
    .replace("<!--COUNT-->", String(live.length))
    .replaceAll("<!--SITE-->", esc(SITE))
    .replace("<!--UPDATED-->", new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })),
);
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
console.log(`已生成 dist/，${live.length} 张卡片`);
