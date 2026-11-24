// 拉取门户 RSS → 给每个公开项目截封面（已有则跳过）→ 生成卡片墙 dist/index.html。
// 封面缓存在 covers/（CI 用 actions/cache 持久化），门户里消失的项目封面会被清掉。
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.PORTAL_SITE || "https://pre.allfather.top").replace(/\/$/, "");
const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const covers = path.join(root, "covers");
const SKIP_SHOTS = process.env.SKIP_SHOTS === "1";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const unxml = (s) =>
  String(s || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
const tag = (xml, name) => unxml((xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]).trim();

// 1. 拉 RSS
const res = await fetch(`${SITE}/rss.xml`, { headers: { "user-agent": "tmp-gallery-build" } });
if (!res.ok) throw new Error(`拉取 RSS 失败：HTTP ${res.status}`);
const xml = await res.text();
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, it]) => {
  const link = tag(it, "link");
  const slug = (link.match(/\/v\/([^/?#]+)/) || [])[1];
  if (!slug || !/^[\w.-]+$/.test(slug)) return [];
  return { slug, link, title: tag(it, "title") || slug, desc: tag(it, "description") };
});
console.log(`门户公开项目 ${items.length} 个`);

// 2. 封面：增量截图 + 清理过期
fs.mkdirSync(covers, { recursive: true });
const alive = new Set(items.map((i) => `${i.slug}.jpg`));
for (const f of fs.readdirSync(covers)) if (!alive.has(f)) fs.rmSync(path.join(covers, f));
const todo = items.filter((i) => !fs.existsSync(path.join(covers, `${i.slug}.jpg`)));
if (todo.length && !SKIP_SHOTS) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, locale: "zh-CN" });
  for (const it of todo) {
    const page = await ctx.newPage();
    try {
      // 截项目本体 /p/，不截带倒计时的外壳；外链项目没有 /p/ 时退回 /v/
      const r = await page.goto(`${SITE}/p/${it.slug}/`, { waitUntil: "load", timeout: 30000 }).catch(() => null);
      if (!r || r.status() >= 400) await page.goto(it.link, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(4000); // 给动画/WebGL 出画时间
      await page.screenshot({ path: path.join(covers, `${it.slug}.jpg`), type: "jpeg", quality: 72 });
      console.log(`  📸 ${it.slug}`);
    } catch (e) {
      console.warn(`  ⚠️ ${it.slug} 截图失败：${e.message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
}
console.log(`封面：待截 ${todo.length}，缓存 ${fs.readdirSync(covers).length}`);

// 3. 生成页面
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "covers"), { recursive: true });
const tiles = items.map((it, i) => {
  const has = fs.existsSync(path.join(covers, `${it.slug}.jpg`));
  if (has) fs.copyFileSync(path.join(covers, `${it.slug}.jpg`), path.join(dist, "covers", `${it.slug}.jpg`));
  const bg = has ? ` style="background-image:url(covers/${encodeURIComponent(it.slug)}.jpg)"` : "";
  return `<a class="tile${has ? " has-cover" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener">
  <span class="num">${String(i + 1).padStart(2, "0")}</span>
  <span class="meta"><b>${esc(it.title)}</b>${it.desc ? `<em>${esc(it.desc)}</em>` : ""}</span>
</a>`;
});
const tpl = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(
  path.join(dist, "index.html"),
  tpl
    .replace("<!--TILES-->", tiles.length ? tiles.join("\n") : `<p class="empty">门户暂时没有公开项目。</p>`)
    .replace("<!--COUNT-->", String(items.length))
    .replaceAll("<!--SITE-->", esc(SITE))
    .replace("<!--UPDATED-->", new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })),
);
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
console.log(`已生成 dist/，${items.length} 张卡片`);
