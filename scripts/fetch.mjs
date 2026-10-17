// Fetch the upstream icon repositories at the commits pinned in sources.lock.
// Usage: node scripts/fetch.mjs [--update-lock]
//   --update-lock  resolve the current default-branch HEAD of every source and rewrite sources.lock first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(root, "sources.lock");
const cacheDir = path.join(root, ".cache");
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

if (process.argv.includes("--update-lock")) {
  for (const [id, src] of Object.entries(lock)) {
    const out = git(["ls-remote", `https://github.com/${src.repo}.git`, "HEAD"]);
    const sha = out.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`cannot resolve HEAD of ${src.repo}`);
    if (sha !== src.commit) console.log(`${id}: ${src.commit.slice(0, 7)} -> ${sha.slice(0, 7)}`);
    src.commit = sha;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

fs.mkdirSync(cacheDir, { recursive: true });
for (const [id, src] of Object.entries(lock)) {
  const dir = path.join(cacheDir, id);
  let head = "";
  try { head = git(["rev-parse", "HEAD"], dir); } catch { /* not cloned yet */ }
  if (head === src.commit) { console.log(`${id}: already at ${src.commit.slice(0, 7)}`); continue; }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(["init", "-q"], dir);
  git(["fetch", "-q", "--depth", "1", `https://github.com/${src.repo}.git`, src.commit], dir);
  git(["checkout", "-q", "--detach", "FETCH_HEAD"], dir);
  console.log(`${id}: fetched ${src.repo}@${src.commit.slice(0, 7)}`);
}
