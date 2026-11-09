// Deploy only the five affected Lambda code bundles. No infrastructure,
// permissions, environment variables or Strava activity descriptions change.
// Saves the previous bundles for rollback and pins each update's revision.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const root = process.env.PORTFOLIO_RELEASE_DIR;
  if (!root || !root.startsWith("/Users/jason/Documents/Codex/2026-10-09/can/work/portfolio-release-")) {
    throw new Error("Set PORTFOLIO_RELEASE_DIR to a dedicated portfolio-release-* directory");
  }
  const functions = [
    ["publicRuns", "api/publicRuns.ts", "StravifyStack-PublicRunsFn868A0DA5-pG28w0kOELxj"],
    ["runById", "api/runById.ts", "StravifyStack-RunByIdFnE4E3D4B6-o94QUPxRd0Ef"],
    ["sync", "api/sync.ts", "StravifyStack-SyncFn22B512F6-aredXNj5sJs7"],
    ["webhook", "webhook/stravaWebhook.ts", "StravifyStack-WebhookFnD222FF15-MH0Yt1D3feQI"],
    ["publish", "api/publish.ts", "StravifyStack-PublishFnB0C9E186-ODOGT5Dw67m0"],
  ];
  const aws = (args: string[]) => execFileSync("aws", ["lambda", ...args, "--profile", "stravify-deploy", "--region", "us-west-1", "--output", "json"], { encoding: "utf8" });
  const builds: { name: string; zip: string; revision: string; previousHash: string }[] = [];
  for (const [label, entry, name] of functions) {
    const folder = resolve(root, label);
    mkdirSync(folder, { recursive: true });
    const previous = JSON.parse(aws(["get-function", "--function-name", name]));
    const backup = await fetch(previous.Code.Location, { signal: AbortSignal.timeout(20000) });
    if (!backup.ok) throw new Error(`Cannot save rollback bundle for ${label}`);
    writeFileSync(resolve(folder, "previous.zip"), Buffer.from(await backup.arrayBuffer()));
    execFileSync("./node_modules/.bin/esbuild", [`src/${entry}`, "--bundle", "--platform=node", "--target=node20", "--minify", "--external:@aws-sdk/*", `--outfile=${folder}/index.js`], { stdio: "pipe" });
    execFileSync("zip", ["-q", "bundle.zip", "index.js"], { cwd: folder });
    builds.push({ name, zip: resolve(folder, "bundle.zip"), revision: previous.Configuration.RevisionId, previousHash: previous.Configuration.CodeSha256 });
  }
  writeFileSync(resolve(root, "rollback-metadata.json"), JSON.stringify(builds, null, 2));
  console.log(JSON.stringify({ backupsSaved: builds.length, folder: root }));
  for (const build of builds) {
    const result = JSON.parse(aws(["update-function-code", "--function-name", build.name, "--zip-file", `fileb://${build.zip}`, "--revision-id", build.revision]));
    aws(["wait", "function-updated-v2", "--function-name", build.name]);
    const final = JSON.parse(aws(["get-function-configuration", "--function-name", build.name]));
    if (final.LastUpdateStatus !== "Successful" || final.CodeSha256 !== result.CodeSha256) throw new Error(`Deployment did not verify for ${build.name}`);
    console.log(JSON.stringify({ name: build.name, status: final.LastUpdateStatus, hash: final.CodeSha256 }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
