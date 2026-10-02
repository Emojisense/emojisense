// Usage: node scripts/pickver.mjs <pkg>[@major]...  (honours the 7-day min-release-age policy)
// Pick the newest stable version published at least 7 days ago (honours user's min-release-age).
import { execSync } from "node:child_process";

const cutoff = Date.now() - 7 * 864e5;
for (const arg of process.argv.slice(2)) {
  const [pkg, major] = arg.startsWith("@")
    ? ["@" + arg.slice(1).split("@")[0], arg.slice(1).split("@")[1]]
    : arg.split("@");
  const time = JSON.parse(execSync(`npm view ${pkg} time --json 2>/dev/null`).toString());
  const ok = Object.entries(time)
    .filter(
      ([v, t]) =>
        /^\d+\.\d+\.\d+$/.test(v) && (!major || v.startsWith(major + ".")) && Date.parse(t) < cutoff,
    )
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  console.log(`${pkg}@${ok[0]?.[0]}  (${ok[0]?.[1]?.slice(0, 10)})`);
}
