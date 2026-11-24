// 把 works/NN-name 逐个输出到 dist/N/，并生成画廊首页 dist/index.html。
// 作品两种形态：有 package.json 的走 vite build；否则当静态目录原样复制。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const works = path.join(root, "works");
const dist = path.join(root, "dist");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const run = (cmd, args, cwd) => {
  const { status } = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (status !== 0) throw new Error(`${cmd} ${args.join(" ")} 失败：${cwd}`);
};

const items = fs.readdirSync(works, { withFileTypes: true }).flatMap((e) => {
  const m = e.isDirectory() && e.name.match(/^(\d+)-(.+)$/);
  if (!m) return [];
  const dir = path.join(works, e.name);
  const metaFile = path.join(dir, "meta.json");
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
  return { folder: e.name, dir, n: Number(m[1]), title: meta.title || m[2], desc: meta.desc || "", tags: meta.tags || [], date: meta.date || "" };
}).sort((a, b) => a.n - b.n);

const seen = new Set();
for (const it of items) {
  if (seen.has(it.n)) throw new Error(`编号重复：${it.n}`);
  seen.add(it.n);
  if (fs.existsSync(path.join(it.dir, ".git"))) throw new Error(`${it.folder} 内有嵌套 .git，请删除`);
}

const footer = (it) => `\n<a href="../" style="position:fixed;left:12px;bottom:10px;z-index:99999;font:12px/1.4 system-ui,sans-serif;color:#fff;mix-blend-mode:difference;text-decoration:none;opacity:.8">← 画廊 · ${it.n} ${esc(it.title)}</a>\n`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const it of items) {
  const out = path.join(dist, String(it.n));
  if (fs.existsSync(path.join(it.dir, "package.json"))) {
    if (!fs.existsSync(path.join(it.dir, "node_modules"))) run("npm", ["ci"], it.dir);
    run("npx", ["vite", "build", "--base", "./", "--outDir", out, "--emptyOutDir"], it.dir);
  } else {
    fs.cpSync(it.dir, out, { recursive: true, filter: (s) => !/node_modules|meta\.json$/.test(s) });
  }
  for (const f of fs.readdirSync(out).filter((x) => x.endsWith(".html"))) {
    const p = path.join(out, f);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("</body>", `${footer(it)}</body>`));
  }
  it.cover = ["cover.jpg", "cover.png", "cover.webp"].find((c) => fs.existsSync(path.join(out, c)));
}

const tiles = items.map((it) => {
  const bg = it.cover ? ` style="background-image:url(${it.n}/${it.cover})"` : "";
  const cls = it.cover ? "tile has-cover" : "tile";
  const tags = it.tags.map((t) => `<span>${esc(t)}</span>`).join("");
  return `<a class="${cls}" href="${it.n}/"${bg}>
  <span class="num">${String(it.n).padStart(2, "0")}</span>
  <span class="meta"><b>${esc(it.title)}</b>${it.desc ? `<em>${esc(it.desc)}</em>` : ""}${tags ? `<i>${tags}</i>` : ""}</span>
</a>`;
});

const tpl = fs.readFileSync(path.join(root, "index.html"), "utf8");
fs.writeFileSync(path.join(dist, "index.html"), tpl.replace("<!--TILES-->", tiles.join("\n")).replace("<!--COUNT-->", String(items.length)));
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
console.log(`\n已输出 ${items.length} 个作品到 dist/`);
