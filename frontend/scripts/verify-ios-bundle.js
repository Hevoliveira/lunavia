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
  ["Lunar landing sites (terrain, hazards, landing zones)", "OVER THE CRATER WALL"],
  ["Lunar module fidelity (two-stage LM)", "engineInner"],
  ["Four official lunar missions (MISSIONS)", "OFFICIAL LUNAR MISSIONS"],
  ["Official mission cards with START MISSION", "mission-start-"],
  ["Official mission selection kept (destination and pilot difficulty)", "lunavia.mission.selection.v1"],
  ["Sea of Tranquility lunar landing training", "LUNAR LANDING TRAINING"],
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
  ["Startup screen THE ROAD TO THE MOON with LAUNCH SEQUENCE — INITIATE", "control-launch-btn"],
  ["The launch starts from the startup screen only", "data-opening"],
  ["Lunar ascent: ascent preparation and liftoff (stages separate)", "INITIATE LUNAR ASCENT"],
  ["Automatic lunar-orbit rendezvous with the CSM", "RENDEZVOUS RADAR"],
  ["Playable docking with the CSM (LUNAVIA — DOCKING OPERATIONS)", "dock-closing"],
  ["Docking retry from the rendezvous checkpoint", "RETRY FROM RENDEZVOUS CHECKPOINT"],
  ["Hard dock, crew transfer, ascent stage jettison", "ASCENT STAGE JETTISONED"],
  ["RESTART DOCKING (hold) at any time during the approach", "dock-restart"],
  ["REINICIAR DOCKING (Portuguese)", "REINICIAR DOCKING"],
  ["Live DOCKING GUIDANCE panel (step, correction, control)", "dock-guidance-control"],
  ["Guidance from the docking telemetry (one instruction at a time)", "BEGIN SLOW APPROACH"],
  ["GUIDANCE ON / OFF", "GUIDANCE OFF"],
  ["Four docking views: the selector (NAV | WINDOW | COCKPIT | 360)", "dock-views"],
  ["WINDOW view: the overhead docking window and its readout", "dock-window-strip"],
  ["COCKPIT view: the 3D cabin and its live instruments", "LATERAL"],
  ["360 view: the free camera's gesture layer", "dock-orbit-pad"],
  ["360 view: RESET CAMERA", "RESET CAMERA"],
  ["Game menu after START MISSIONS (MISSIONS / TRAINING)", "mode-missions"],
  ["Mission scoring: the MISSION DEBRIEF and its detailed telemetry", "debrief-open-details"],
  ["Mission debrief and achievements in Portuguese", "CONQUISTAS DESBLOQUEADAS"],
  ["Medals: PLATINUM for COMMANDER only", "PLATINUM: COMMANDER only"],
  ["Achievements (FIRST FOOTPRINT … LUNAVIA MASTER)", "LUNAVIA MASTER"],
  ["Flight records kept on the device (versioned)", "lunavia.mission.records.v1"],
  ["FLIGHT RECORDS: medals, achievements, mission log", "records-page"],
  ["Docking ports: the TARGET DOCKING PORT marker on the real receiving port", "dock-target-marker"],
  ["Docking ports: the marker in Portuguese", "PORTA DE DOCKING ALVO"],
  ["Docking ports: the 360° FOCUS DOCKING PORTS camera", "dock-camera-focus"],
  ["Docking ports: the final-approach capture conditions", "PROCEED WITH FINAL APPROACH"],
  ["Docking ports: the approach corridor attached to the port", "approach-corridor"],
  ["Photorealistic planets: the shared Earth (NASA Blue Marble, clouds, limb)", "earth-atmosphere"],
  ["Photorealistic planets: the Moon (NASA LRO colour, LOLA relief)", "moon_normal_2k.jpg"],
  ["Assisted docking: AUTO-ALIGN and MATCH VELOCITY buttons", "dock-match-velocity"],
  ["Docking copilot: AUTO-CENTER", "dock-center"],
  ["Docking copilot: CENTERLINE ACQUIRED", "CENTERLINE ACQUIRED"],
  ["Docking copilot: FINE APPROACH (closing-speed steps)", "FWD/AFT SET THE CLOSING SPEED"],
  ["Docking copilot: the five steps with their reasons", "dock-copilot-why"],
  ["Docking copilot: the release cue on a held jet", "data-release"],
  ["Training Center: DOCKING TRAINING", "ORBITAL DOCKING TRAINING"],
  ["Assisted docking: the approach speed assist", "dock-speed-assist"],
  ["Assisted docking: RELATIVE MOTION STABLE / DOCKING AXIS ALIGNED", "RELATIVE MOTION STABLE"],
  ["Assisted docking: soft capture", "SOFT CAPTURE"],
  ["Docking copilot in Portuguese", "LINHA CENTRAL ADQUIRIDA"],
  ["Docking controls: FINE", "dock-fine"],
  ["Earth return: the TEI burn on the service propulsion engine", "THRUST ALONG THE AXIS"],
  ["Earth return: engine off, passive thermal control on the coast", "PASSIVE THERMAL CONTROL ROLL"],
  ["Earth return: the entry attitude before the SM separation", "SM SEPARATION NEXT"],
  ["Earth return: SKIP CINEMATIC to the reentry", "skip-return"],
  ["Splashdown: SPLASHDOWN CONFIRMED, then CREW SAFE", "splashdown-confirmed"],
  ["Descent: the cumulus layer, one ray-marched pass through a weather map", "cumulus-layer"],
  ["Clouds: each cloud's surface found by bisection (no slicing, no dither)", "its surface found exactly between the last two samples"],
  ["Clouds: empty sky skipped by the weather map's coarse levels", "empty-space skipping"],
  ["One atmosphere for the sky, the sea's haze and the clouds", "the brighter band of haze just over the horizon"],
  ["Descent: the clouds drawn at reduced resolution and composited", "cloud-composite"],
  ["Parachutes: canopies lit through the fabric", "the Sun through the fabric seen from the other side"],
  ["Descent HUD under the parachutes", "reentry-descent-panel"],
  ["Descent HUD: the splashdown checklist", "BRACE FOR SPLASHDOWN"],
  ["Captions in a corner over the descent and splashdown", "max-w-[min(420px,40vw)]"],
  ["Released canopies go under as one sheet", "going under: deep water over it, fading into the sea as one sheet"],
  ["Sea: the wind sea from a wave spectrum (two bands, Cox & Munk slopes)", "the wind sea, band A (1.8-25 m)"],
  ["Sea: ripples drawn only where a pixel resolves them", "drawn only where a pixel resolves them"],
  ["Sea: each swell wave filtered along its own direction (no stripes)", "footprint along the wave's own direction of travel"],
  ["Sea: cloud shadows per vertex, from the clouds' own weather map", "hundreds of metres across: per vertex is enough"],
  ["Sea: foam noise only round the splash and the hull", "the foam's small-scale noise, only where there is foam"],
  ["Parachutes: suspension lines as ribbons at the cord's true width", "a round cord's profile across the ribbon"],
  ["Parachutes: released canopies collapse and flutter as they fall", "released: no longer held open, the fabric folds and flutters"],
  ["Splashdown: spray as lit masses of water, not particles", "lit as a volume: the side towards the Sun white"],
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
  ["Four destinations as training exercises", "training-mission-start-"],
  ["The old return shot (the CSM broadside, no burn)", "THE LUNAR MODULE STAYED BEHIND"],
  ["The old low world at 25 m per unit (the capsule 6x too big)", "metres per scene unit in the low-altitude world"],
  ["The camera-facing cloud cards (billboards)", "the quad's corners: never inside the puff"],
  ["The pale ring and foam disc round the splash", "the impact ring running out, its ripples and foam"],
  ["The crown sheet round the splash", "the sheet flares outward as it rises"],
  ["The sea rising through sinking canopies (left as islands)", "+ 0.07 - uSink"],
  ["Every distant sea pixel reading the NASA cloud map", "float c0 = texture2D(uCover, uCoverUV + m * uCoverScale).b;"],
  ["The cumulus as unions of eroded puffs (towers of balls)", "the vapour crossed"],
  ["The splash as a burst of streak particles", "the streak: where it was a moment ago"],
  ["The NASA cloud cover read by the sea", "beyond the 3D field, the NASA cloud cover: read here, per vertex"],
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

// 9. The planets play offline: every texture the game asks for is in the app, decodable, and
// identical to the source copy; the retired textures are gone.
if (js) {
  const asked = [...new Set([...js.matchAll(/textures\/planets\/([\w.-]+\.(?:jpg|png))/g)].map((m) => m[1]))];
  asked.length ? ok(`the game loads ${asked.length} planet textures: ${asked.join(", ")}`) : fail("the game script names no planet textures");
  for (const f of asked) {
    const p = path.join(pub, "textures/planets", f);
    const src = path.join(root, "public/textures/planets", f);
    if (!fs.existsSync(p)) {
      fail(`textures/planets/${f} is not in the iOS bundle (it would be missing offline)`);
      continue;
    }
    const b = fs.readFileSync(p);
    const jpeg = b[0] === 0xff && b[1] === 0xd8;
    const png = b[0] === 0x89 && b[1] === 0x50;
    if (!(jpeg || png) || b.length < 100000) fail(`textures/planets/${f} is not a valid image (${b.length} bytes)`);
    else if (fs.existsSync(src) && !fs.readFileSync(src).equals(b)) fail(`textures/planets/${f} differs from the source copy`);
    else ok(`textures/planets/${f} (${(b.length / 1e6).toFixed(2)} MB) bundled`);
  }
  ["earth_atmos_2048.jpg", "earth_clouds_1024.png", "earth_normal_2048.jpg", "earth_specular_2048.jpg", "moon_1024.jpg"].forEach((f) =>
    fs.existsSync(path.join(pub, "textures/planets", f)) ? fail(`retired texture ${f} is still in the bundle`) : ok(`retired texture ${f} not bundled`)
  );
  fs.existsSync(path.join(pub, "textures/planets/SOURCES.md")) ? ok("planet texture sources and rights (SOURCES.md) bundled") : fail("textures/planets/SOURCES.md is missing");
}

console.log(failures.length ? `\n${failures.length} problem(s): the iOS app would not match this source.` : `\nThe iOS app will run BUILD ${info.commit}.`);
process.exit(failures.length ? 1 : 0);
