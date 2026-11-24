// 读取门户 RSS → 增量截封面 → 生成卡片墙 dist/index.html。
// RSS 没有到期时间：顺带读一次 /portal 补 data-exp（失败不影响构建，只是少了前端实时下架）。
// 封面缓存在 covers/（CI 用 actions/cache 持久化），门户里消失的项目封面会被清掉。
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.PORTAL_SITE || "https://pre.allfather.top").replace(/\/$/, "");
const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const covers = path.join(root, "covers");
const SKIP_SHOTS = process.env.SKIP_SHOTS === "1";
const UA = { "user-agent": "tmp-gallery-build" };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const unent = (s) =>
  String(s || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
const tag = (xml, name) => unent((xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]).trim();

// 1. RSS：项目清单
const res = await fetch(`${SITE}/rss.xml`, { headers: UA });
if (!res.ok) throw new Error(`拉取 RSS 失败：HTTP ${res.status}（门户需设为公开）`);
const xml = await res.text();
const seen = new Set();
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, it]) => {
  const link = tag(it, "link");
  const slug = (link.match(/\/v\/([^/?#]+)/) || [])[1];
  if (!slug || !/^[\w.-]+$/.test(slug) || seen.has(slug)) return [];
  seen.add(slug);
  const tags = [...it.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => unent(m[1]).trim()).filter(Boolean);
  return { slug, link: `${SITE}/v/${slug}`, title: tag(it, "title") || slug, desc: tag(it, "description"), tags, exp: 0 };
});
console.log(`RSS 项目 ${items.length} 个`);

// 2. 门户：只为补到期时间
try {
  const r = await fetch(`${SITE}/portal`, { headers: UA, redirect: "manual" });
  if (r.status === 200) {
    const html = await r.text();
    const expBy = new Map();
    for (const chunk of html.split(/(?=<div class="card[ "])/).slice(1)) {
      const slug = (chunk.match(/<a class="hit" href="\/v\/([^"/?#]+)"/) || [])[1];
      const exp = Number((chunk.match(/\bdata-exp="(\d+)"/) || [])[1]) || 0;
      if (slug) expBy.set(slug, exp);
    }
    for (const it of items) it.exp = expBy.get(it.slug) || 0;
    console.log(`到期时间：匹配 ${items.filter((i) => expBy.has(i.slug)).length}/${items.length}`);
  } else console.warn(`门户 HTTP ${r.status}，跳过到期时间`);
} catch (e) {
  console.warn(`门户读取失败，跳过到期时间：${e.message}`);
}
const now = Date.now();
const live = items.filter((i) => !i.exp || i.exp > now);

// 3. 封面：增量截图 + 清理过期
fs.mkdirSync(covers, { recursive: true });
const alive = new Set(live.map((i) => `${i.slug}.jpg`));
for (const f of fs.readdirSync(covers)) if (!alive.has(f)) fs.rmSync(path.join(covers, f));
const todo = live.filter((i) => !fs.existsSync(path.join(covers, `${i.slug}.jpg`)));
const BLANK_BYTES = 25 * 1024; // 纯色/加载页压成 JPEG 很小，用体积粗判「还没出画」
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

// 4. 生成页面
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "covers"), { recursive: true });
const tiles = live.map((it, i) => {
  const has = fs.existsSync(path.join(covers, `${it.slug}.jpg`));
  if (has) fs.copyFileSync(path.join(covers, `${it.slug}.jpg`), path.join(dist, "covers", `${it.slug}.jpg`));
  const bg = has ? ` style="background-image:url('covers/${encodeURIComponent(it.slug)}.jpg')"` : "";
  const search = [it.title, it.desc, it.slug, ...it.tags].join(" ");
  const tags = it.tags.slice(0, 4).map((t) => `<span>${esc(t)}</span>`).join("");
  return `<a class="tile${has ? " has-cover" : ""}" href="${esc(it.link)}" target="_blank" rel="noopener" data-exp="${it.exp}" data-s="${esc(search)}"${bg}>
  <span class="num">${String(i + 1).padStart(2, "0")}</span>
  <span class="meta"><b>${esc(it.title)}</b>${it.desc ? `<em>${esc(it.desc)}</em>` : ""}${tags ? `<i>${tags}</i>` : ""}</span>
</a>`;
});
const tpl = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(
  path.join(dist, "index.html"),
  tpl
    .replace("<!--TILES-->", tiles.join("\n"))
    .replace("<!--COUNT-->", String(live.length))
    .replaceAll("<!--SITE-->", esc(SITE))
    .replaceAll("<!--HOST-->", esc(new URL(SITE).host))
    .replace("<!--UPDATED-->", new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })),
);
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
console.log(`已生成 dist/，${live.length} 张卡片`);
