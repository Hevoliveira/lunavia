#!/usr/bin/env node
/*
 * Checks that the web game bundled into the iOS app (ios/App/App/public) is
 * the build of the source next to it, and that Xcode will package exactly that.
 *
 *   yarn ios:verify            (from frontend/; also run at the end of yarn ios:sync)
 *   node scripts/verify-ios-bundle.js <path to an unpacked GitHub ZIP>
 *
 * In a Git checkout it also checks that no web source changed after the bundle
 * was built. An unpacked ZIP has no Git history, so there it checks the bundle
 * against the source files in the same folder instead (the feature markers).
 * Exits 1 on any failure.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = process.argv[2] ? path.resolve(process.argv[2], "frontend") : path.resolve(__dirname, "..");
const ios = path.join(root, "ios/App");
const pub = path.join(ios, "App/public");
const failures = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const read = (p) => fs.readFileSync(p, "utf8");
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
};

// Strings each completed feature puts into the compiled game. A marker counts
// only if the source next to the bundle has it, so this list cannot go stale:
// a feature that is in the source must be in the bundle.
const FEATURES = [
  ["Playable Earth reentry", "DROGUE CHUTES"],
  ["COMMANDER landing rebalance and guidance", "FULL THRUST - CANNOT STOP IN TIME"],
  ["Cinematic Earth departure (Flight IV)", "LEAVING THE ATMOSPHERE"],
  ["Earth-orbit finale and TLI", "FINAL EARTH PASS"],
  ["Flight Training Center", "BRAKING PRACTICE"],
  ["Training instructor and debrief", "BRAKING ALTITUDE"],
  ["Mission Control voice", "MISSION CONTROL VOICE"],
  ["Lunar orbit rotation fix", "descent-fade"],
  ["Touchdown fidelity (CONTACT LIGHT / ENGINE STOP lamps)", "lamp-engine-stop"],
  ["Lunar landing sites", "training-site-continue"],
  ["Lunar module fidelity (two-stage LM)", "engineInner"],
  ["Four lunar missions (mission selector)", "training-mission-start-"],
  ["Far side mission (Silent Horizon, no Earth link)", "FAR SIDE TOUCHDOWN CONFIRMED"],
  ["Far-side approach intro", "farside-intro-skip"],
  ["One spacecraft from Earth orbit to the Moon (shared CSM, escape tower jettison)", "ESCAPE TOWER JETTISONED"],
  ["Lunar module undocking in the mission", "UNDOCKING PREPARATION"],
  ["Laju Productions credit", "A LAJU PRODUCTIONS GAME"],
  ["Lunar module inside the launch vehicle (payload shot)", "LUNAR MODULE INSIDE THE ADAPTER"],
  ["Title reveal inside the mission, after the go for powered descent", "title-reveal-credit"],
  ["The outbound assembly arrives in lunar orbit integrated", "LM AND CSM STILL INTEGRATED"],
  ["Deployment in lunar orbit: transposition, docking, extraction", "LUNAR MODULE EXTRACTED"],
  ["Carrier left behind in lunar orbit", "CARRIER LEFT BEHIND"],
  ["Persistent title screen with START MISSIONS", "btn-start-missions"],
  ["Direct cut: 2 s after TLI cutoff straight to lunar orbit", "__lvLaunchCut"],
];

// Removed on purpose (the direct cut from TLI cutoff to lunar orbit): the translunar
// travel shots must not be in the bundled game.
const REMOVED = [
  ["Upper-stage separation shot after TLI", "THE TRANSFER CARRIER TAKES OVER"],
  ["Farewell shot (stage left behind)", "UPPER STAGE LEFT BEHIND"],
  ["Translunar coast shot", "MAIN ENGINE AFT · LM AND CSM INTEGRATED"],
  ["Deep-space midcourse correction", "MIDCOURSE CORRECTION ON THE MAIN ENGINE"],
  ["Lunar approach turn", "TURNING ENGINE FIRST ON RCS"],
  ["Lunar orbit insertion burn shot", "RETROGRADE BURN · OUT OF CONTACT WITH EARTH"],
];

function sourceText(dir) {
  let out = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += sourceText(p);
    else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out += read(p);
  }
  return out;
}

console.log(`LUNAVIA iOS bundle check: ${pub}`);

// 1. The bundle's identity
let info = null;
try {
  info = JSON.parse(read(path.join(pub, "build-info.json")));
  ok(`build-info.json: BUILD ${info.commit} · ${info.time}`);
} catch {
  fail("public/build-info.json is missing or unreadable");
}
if (info && info.commit.endsWith("+")) fail(`BUILD ${info.commit} was built from uncommitted changes`);

// 2. index.html loads exactly one script and stylesheet, and they exist
let js = "";
const html = fs.existsSync(path.join(pub, "index.html")) ? read(path.join(pub, "index.html")) : "";
const scripts = [...html.matchAll(/src="\/(static\/js\/[^"]+\.js)"/g)].map((m) => m[1]);
const styles = [...html.matchAll(/href="\/(static\/css\/[^"]+\.css)"/g)].map((m) => m[1]);
if (!html) fail("public/index.html is missing");
else if (scripts.length !== 1) fail(`index.html loads ${scripts.length} game scripts (expected 1)`);
else if (!fs.existsSync(path.join(pub, scripts[0]))) fail(`index.html loads ${scripts[0]}, which is not in public/`);
else {
  js = read(path.join(pub, scripts[0]));
  ok(`index.html → ${scripts[0]} (${(js.length / 1e6).toFixed(2)} MB)`);
}
styles.forEach((s) => (fs.existsSync(path.join(pub, s)) ? ok(`index.html → ${s}`) : fail(`index.html loads ${s}, which is not in public/`)));

// 3. No leftover bundles from older builds
const jsDir = path.join(pub, "static/js");
const extra = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter((f) => /^main\.[0-9a-f]+\.js$/.test(f) && `static/js/${f}` !== scripts[0]) : [];
extra.length ? fail(`old bundles left in public/static/js: ${extra.join(", ")}`) : ok("no leftover bundles from older builds");

// 4. The label the app shows is the same build
if (info && js) {
  js.includes(`"${info.commit}"`) && js.includes(info.time)
    ? ok(`the game script shows "BUILD ${info.commit} · ${info.time}"`)
    : fail(`the game script does not carry BUILD ${info.commit} · ${info.time}: build-info.json and the script come from different builds`);
}

// 5. The app loads its bundled files, not a server
for (const f of [path.join(ios, "App/capacitor.config.json"), path.join(root, "capacitor.config.json")]) {
  try {
    const c = JSON.parse(read(f));
    c.server && c.server.url ? fail(`${path.relative(root, f)} points the app at ${c.server.url}`) : ok(`${path.relative(root, f)}: no server URL (bundled files)`);
  } catch {
    fail(`${path.relative(root, f)} is missing or unreadable`);
  }
}

// 6. Xcode copies public/ and the Capacitor config into the app
try {
  const pbx = read(path.join(ios, "App.xcodeproj/project.pbxproj"));
  const phase = (pbx.match(/Begin PBXResourcesBuildPhase[\s\S]*?End PBXResourcesBuildPhase/) || [""])[0];
  /public in Resources/.test(phase) && /capacitor\.config\.json in Resources/.test(phase)
    ? ok("Xcode copies public/ and capacitor.config.json into the app")
    : fail("the Xcode Resources phase does not copy public/ and capacitor.config.json");
  const ids = [...new Set([...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]))];
  ids.length === 1 ? ok(`one bundle identifier: ${ids[0]}`) : fail(`several bundle identifiers: ${ids.join(", ")}`);
} catch {
  fail("ios/App/App.xcodeproj/project.pbxproj is missing");
}

// 7. The bundle is the build of this source
const head = git("rev-parse HEAD");
if (head && info && !info.commit.endsWith("+")) {
  const srcPaths = "src public package.json yarn.lock craco.config.js tailwind.config.js";
  const changed = git(`diff --name-only ${info.commit} -- ${srcPaths}`);
  if (changed === null) fail(`BUILD ${info.commit} is not a commit of this repository`);
  else if (changed) fail(`the web source changed after BUILD ${info.commit} was built (run yarn ios:sync):\n        ${changed.split("\n").join("\n        ")}`);
  else ok(`no web source changed since BUILD ${info.commit} (checkout at ${head.slice(0, 7)})`);
} else if (!head) {
  console.log("  note  no Git history here (unpacked ZIP): checking the bundle against the source files instead");
}

// 8. Every feature in the source is in the bundle
if (js) {
  const src = sourceText(path.join(root, "src"));
  for (const [name, marker] of FEATURES) {
    if (!src.includes(marker)) console.log(`  --    ${name}: not in this source`);
    else if (js.includes(marker)) ok(`${name}`);
    else fail(`${name} is in the source but not in the bundled game`);
  }
  for (const [name, marker] of REMOVED) {
    js.includes(marker) ? fail(`${name} is still in the bundled game`) : ok(`removed: ${name}`);
  }
}

console.log(failures.length ? `\n${failures.length} problem(s): the iOS app would not match this source.` : `\nThe iOS app will run BUILD ${info.commit}.`);
process.exit(failures.length ? 1 : 0);
