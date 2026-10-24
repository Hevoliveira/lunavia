/*
 * LUNAVIA — the lunar module's crew cabin, after the landing (pure; unit-tested).
 *
 * The cabin is the inside of the very ascent stage the player landed: it is laid
 * out in LanderModel's own model units (1 unit = 4.8 m, +Z forward through the
 * hatch, +Y up, +X the commander's side, on the left facing forward), inside the
 * exterior's profile (data/lmDesign CABIN_PROFILE), and its two windows are the
 * exterior's two triangular windows on the upper front facet (WINDOWS on
 * WINDOW_SLOPE). Whatever the player sees through them is the landing site
 * itself, from where and how the LM came to rest.
 *
 * Navigation is seated, not walked: a handful of STATIONS (an eye position and
 * a resting gaze each) the camera glides between, and a limited drag-to-look
 * around each one (clampLook). HOTSPOTS are the few panels that matter; each
 * has its own station and a short readout (panelText) built from the mission's
 * real state. Two light checklists (EVA_PREP, ASCENT_PREP) are stepped in
 * order (cabinStep) and open the way to BEGIN EVA and to the ascent.
 *
 * Nothing here touches the landing, the EVA, the ascent, the scoring or the save.
 */
import { CABIN_PROFILE, CABIN_HALF_X, WINDOWS, WINDOW_SLOPE } from "./lmDesign";
import { skyDirection } from "./terrainMesh";

const DEG = Math.PI / 180;
export const CABIN_WALL = 0.008; // interior skin inside the exterior hull (model units, ~4 cm)
export const FLOOR_Y = CABIN_PROFILE[0][1] + 0.012; // the cabin floor (model units)
export const MODEL_M = 4.8; // metres per model unit

/* ---- stations: where the camera can be ------------------------------------------------- */
/**
 * eye [x, y, z] model units (cabin frame); yaw (deg, 0 = forward +Z, positive turns to +X, the
 * commander's side) and pitch (deg, positive up) of the resting gaze; look = how far a drag can
 * turn from it; fov (deg, vertical).
 */
export const STATIONS = [
  { id: "window", eye: [0.06, 0.8061, 0.122], yaw: 4, pitch: -8, look: { yaw: 44, up: 34, down: 20 }, fov: 64, label: { en: "WINDOW", pt: "JANELA" } },
  { id: "console", eye: [0.0, 0.74, 0.03], yaw: 0, pitch: -24, look: { yaw: 70, up: 40, down: 34 }, fov: 66, label: { en: "PANELS", pt: "PAINÉIS" } },
  { id: "comms", eye: [-0.04, 0.73, 0.02], yaw: -78, pitch: -10, look: { yaw: 60, up: 38, down: 34 }, fov: 64, label: { en: "COMMS", pt: "COMUNICAÇÕES" } },
  { id: "hatch", eye: [0.0, 0.705, 0.07], yaw: 0, pitch: -38, look: { yaw: 55, up: 40, down: 22 }, fov: 66, label: { en: "HATCH", pt: "ESCOTILHA" } },
  { id: "aft", eye: [0.0, 0.74, 0.16], yaw: 180, pitch: -16, look: { yaw: 70, up: 40, down: 30 }, fov: 66, label: { en: "AFT · SUITS", pt: "POPA · TRAJES" } },
];
export const DEFAULT_STATION = "window";
export const stationById = (id) => STATIONS.find((s) => s.id === id) || STATIONS[0];
export const GLIDE_TIME = 0.9; // s between stations (eased; no cut, no whip)

/** The gaze around a station, kept within its limits (deg, deg): [yaw, pitch]. */
export function clampLook(station, yaw, pitch) {
  const s = typeof station === "string" ? stationById(station) : station;
  const dy = Math.max(-s.look.yaw, Math.min(s.look.yaw, yaw - s.yaw));
  const dp = Math.max(-s.look.down, Math.min(s.look.up, pitch - s.pitch));
  return [s.yaw + dy, s.pitch + dp];
}

/** Unit view direction in the cabin frame for a yaw and pitch (deg). */
export function lookDir(yaw, pitch) {
  const y = yaw * DEG;
  const p = pitch * DEG;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

/** Smooth glide 0..1 (ease in-out, zero speed at both ends). */
export const glide = (u) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * x * (x * (6 * x - 15) + 10);
};
/** Shortest-way blend of two angles (deg). */
export function mixAngle(a, b, u) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * u;
}

/* ---- the cabin's shape ------------------------------------------------------------------- */
/** True when [x, y, z] (model units) is inside the cabin's inner skin. */
export function insideCabin([x, y, z], margin = CABIN_WALL) {
  if (Math.abs(x) > CABIN_HALF_X - margin) return false;
  if (y < FLOOR_Y) return false;
  // point in the profile polygon (z, y), shrunk by the margin (tested on the normals of each edge)
  const P = CABIN_PROFILE;
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [zi, yi] = P[i];
    const [zj, yj] = P[j];
    if (yi > y !== yj > y && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi) inside = !inside;
  }
  if (!inside) return false;
  for (let i = 0; i < P.length; i++) {
    const [z0, y0] = P[i];
    const [z1, y1] = P[(i + 1) % P.length];
    const ez = z1 - z0;
    const ey = y1 - y0;
    const L = Math.hypot(ez, ey);
    // distance from the edge's line
    const d = Math.abs((z - z0) * ey - (y - y0) * ez) / L;
    const t = ((z - z0) * ez + (y - y0) * ey) / (L * L);
    if (t >= 0 && t <= 1 && d < margin) return false;
  }
  return true;
}

/** A window's triangle corners in the cabin frame (model units), as data/lmDesign places the glass. */
export function windowCorners(i) {
  const S = WINDOW_SLOPE;
  return WINDOWS[i].map(([u, v]) => [S.c[0] + u, S.c[1] + v * S.v[1], S.c[2] + v * S.v[2]]);
}
/** The commander's window (left, +X) and the pilot's (right). */
export const CDR_WINDOW = 1;
export const LMP_WINDOW = 0;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Does the ray from `eye` along `dir` (cabin frame) pass through window i? (Möller–Trumbore) */
export function throughWindow(eye, dir, i) {
  const [a, b, c] = windowCorners(i);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(dir, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-9) return false;
  const inv = 1 / det;
  const s = sub(eye, a);
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return false;
  const q = cross(s, e1);
  const v = dot(dir, q) * inv;
  if (v < 0 || u + v > 1) return false;
  return dot(e2, q) * inv > 0;
}
/** Through either window. */
export const throughAnyWindow = (eye, dir) => throughWindow(eye, dir, 0) || throughWindow(eye, dir, 1);

/**
 * The window station's view: the range of depression angles (deg below the horizon, straight
 * ahead) that reach the ground through the commander's window, and where on the ground they land
 * (m ahead), for an eye `eyeHeight` metres above the surface.
 */
export function windowGroundBand(eyeHeight) {
  const s = stationById("window");
  let lo = null;
  let hi = null;
  for (let p = 0; p >= -80; p -= 0.25) {
    if (throughWindow(s.eye, lookDir(0, p), CDR_WINDOW)) {
      if (hi === null) hi = p;
      lo = p;
    }
  }
  const dist = (p) => (p < 0 ? eyeHeight / Math.tan(-p * DEG) : Infinity);
  return { top: hi, bottom: lo, near: lo !== null ? dist(lo) : null, far: hi !== null ? dist(hi) : null };
}

/* ---- where the cabin sits on the Moon ---------------------------------------------------- */
/**
 * A direction given in the site's sky (skyDirection: world frame) in the cabin frame, for the
 * LM's resting attitude (pose pitch, tilt deg: the group's rotation is Rx(pitch)·Rz(-tilt)).
 */
export function worldToCabin(dir, pose = null) {
  const p = ((pose && pose.pitch) || 0) * DEG;
  const t = -((pose && pose.tilt) || 0) * DEG;
  // inverse of Rx(p)·Rz(t): Rz(-t)·Rx(-p)
  const [x, y, z] = dir;
  const y1 = Math.cos(p) * y + Math.sin(p) * z;
  const z1 = -Math.sin(p) * y + Math.cos(p) * z;
  return [Math.cos(t) * x + Math.sin(t) * y1, -Math.sin(t) * x + Math.cos(t) * y1, z1];
}

/** Is a sky direction (the Sun, the Earth) visible through a window from some station? */
export function inWindowView(skyDir, pose = null, stations = STATIONS) {
  const d = worldToCabin(skyDir, pose);
  return stations.some((s) => throughAnyWindow(s.eye, d));
}

/** Bearing words for a sky direction relative to the cabin (forward +Z, left +X). */
export function bearing(skyDir, pose = null) {
  const [x, , z] = worldToCabin(skyDir, pose);
  const a = Math.atan2(x, z) / DEG; // 0 ahead, +90 left
  if (Math.abs(a) <= 30) return "AHEAD";
  if (Math.abs(a) >= 150) return "BEHIND";
  return a > 0 ? (Math.abs(a) < 75 ? "AHEAD LEFT" : a > 115 ? "BEHIND LEFT" : "LEFT") : Math.abs(a) < 75 ? "AHEAD RIGHT" : -a > 115 ? "BEHIND RIGHT" : "RIGHT";
}
const BEARING_PT = { AHEAD: "À FRENTE", BEHIND: "ATRÁS", LEFT: "À ESQUERDA", RIGHT: "À DIREITA", "AHEAD LEFT": "À FRENTE, À ESQUERDA", "AHEAD RIGHT": "À FRENTE, À DIREITA", "BEHIND LEFT": "ATRÁS, À ESQUERDA", "BEHIND RIGHT": "ATRÁS, À DIREITA" };

/* ---- hotspots: the panels that matter ------------------------------------------------------ */
/** pos [x, y, z] model units (cabin frame); station: where the camera goes to read it. */
export const HOTSPOTS = [
  { id: "window", station: "window", pos: [0.075, 0.795, 0.15], label: { en: "WINDOW", pt: "JANELA" } },
  { id: "landing", station: "console", pos: [0.15, 0.655, 0.257], label: { en: "LANDING STATUS", pt: "STATUS DO POUSO" } },
  { id: "checklist", station: "console", pos: [0.0, 0.69, 0.245], label: { en: "MISSION CHECKLIST", pt: "CHECKLIST DA MISSÃO" } },
  { id: "ascent", station: "console", pos: [-0.15, 0.655, 0.257], label: { en: "ASCENT READINESS", pt: "PRONTIDÃO DA ASCENSÃO" } },
  { id: "comms", station: "comms", pos: [-0.282, 0.7, 0.02], label: { en: "COMMUNICATIONS", pt: "COMUNICAÇÕES" } },
  { id: "hatch", station: "hatch", pos: [0.0, 0.548, 0.272], label: { en: "FORWARD HATCH", pt: "ESCOTILHA DIANTEIRA" } },
  { id: "eva", station: "aft", pos: [0.0, 0.64, -0.218], label: { en: "EVA PREPARATION", pt: "PREPARAÇÃO DA EVA" } },
];
export const hotspotById = (id) => HOTSPOTS.find((h) => h.id === id) || null;

/* ---- the two checklists -------------------------------------------------------------------- */
export const STEP_TIME = 1.3; // s each step takes once tapped (lights, sounds; never a timing test)
export const EVA_PREP = [
  { id: "suit", label: { en: "SUIT CHECK", pt: "VERIFICAÇÃO DOS TRAJES" }, done: { en: "SUITS PRESSURIZED · 3.8 PSI · NO LEAKS", pt: "TRAJES PRESSURIZADOS · 3,8 PSI · SEM VAZAMENTOS" } },
  { id: "hatch", label: { en: "HATCH READY", pt: "ESCOTILHA PRONTA" }, done: { en: "CABIN DEPRESSURIZED · HATCH UNLATCHED", pt: "CABINE DESPRESSURIZADA · ESCOTILHA DESTRAVADA" } },
  { id: "systems", label: { en: "EVA SYSTEMS GO", pt: "SISTEMAS EVA PRONTOS" }, done: { en: "PLSS ON · COMMS CHECK · GO FOR EGRESS", pt: "PLSS LIGADO · TESTE DE RÁDIO · LIBERADOS PARA SAIR" } },
];
export const ASCENT_PREP = [
  { id: "systems", label: { en: "ASCENT SYSTEMS CHECK", pt: "VERIFICAÇÃO DOS SISTEMAS DE ASCENSÃO" }, done: { en: "ENGINE ARMED · GUIDANCE ALIGNED · RCS PRESSURIZED", pt: "MOTOR ARMADO · GUIAGEM ALINHADA · RCS PRESSURIZADO" } },
  { id: "secure", label: { en: "CABIN SECURE", pt: "CABINE PROTEGIDA" }, done: { en: "HATCH CLOSED · CABIN REPRESSURIZED · STOWAGE SECURED", pt: "ESCOTILHA FECHADA · CABINE REPRESSURIZADA · CARGA PRESA" } },
  { id: "ready", label: { en: "READY FOR ASCENT", pt: "PRONTO PARA ASCENSÃO" }, done: { en: "CREW RESTRAINED · ABORT STAGE SET · READY", pt: "TRIPULAÇÃO PRESA · ABORT STAGE ARMADO · PRONTOS" } },
];

/** The cabin's own state (nothing of it is saved: a resume starts the checklists again). */
export function createCabin({ evaAvailable = false, evaDone = false } = {}) {
  return { evaAvailable: !!evaAvailable && !evaDone, evaDone: !!evaDone, eva: 0, ascent: 0, busy: null };
}
export const checklist = (kind) => (kind === "eva" ? EVA_PREP : ASCENT_PREP);
export const evaReady = (c) => c.evaAvailable && c.eva >= EVA_PREP.length;
export const ascentReady = (c) => c.ascent >= ASCENT_PREP.length;

/**
 * Tap the next step of a checklist: it starts (busy) and completes STEP_TIME later (cabinTick).
 * Out of order, a step already busy, or the EVA list when there is no EVA to prepare: unchanged.
 */
export function cabinStep(c, kind, index) {
  if (c.busy) return c;
  if (kind === "eva" && !c.evaAvailable) return c;
  const n = kind === "eva" ? c.eva : c.ascent;
  if (index !== n || n >= checklist(kind).length) return c;
  return { ...c, busy: { kind, index, t: 0 } };
}
/** Advance a busy step by dt seconds; it completes after STEP_TIME. */
export function cabinTick(c, dt) {
  if (!c.busy) return c;
  const t = c.busy.t + dt;
  if (t < STEP_TIME) return { ...c, busy: { ...c.busy, t } };
  const k = c.busy.kind;
  return { ...c, busy: null, [k]: c[k] + 1 };
}

/* ---- readouts ----------------------------------------------------------------------------- */
const fmt = (v, d = 1, lang = "en") => {
  const s = Math.abs(v).toFixed(d);
  return lang === "pt" ? s.replace(".", ",") : s;
};

/**
 * What a panel says (pure): { title, lines: [[label, value, tone?]], note }. ctx: { site, pose,
 * farSide, cabin (createCabin state), result (the landing result if known) }.
 */
export function panelText(id, ctx, lang = "en") {
  const pt = lang === "pt";
  const L = (en, p) => (pt ? p : en);
  const site = ctx.site;
  const pose = ctx.pose || {};
  const c = ctx.cabin || createCabin();
  const farSide = !!ctx.farSide;
  const h = hotspotById(id);
  const title = h ? h.label[pt ? "pt" : "en"] : "";
  if (id === "window") {
    const sunDir = skyDirection(site.sun);
    const sunB = bearing(sunDir, pose);
    const lines = [
      [L("SITE", "LOCAL"), site.name],
      [L("SUN", "SOL"), `${fmt(site.sun.el, 0, lang)}° · ${pt ? BEARING_PT[sunB] : sunB}`],
    ];
    if (site.earth) {
      const eB = bearing(skyDirection(site.earth), pose);
      const seen = inWindowView(skyDirection(site.earth), pose);
      lines.push([L("EARTH", "TERRA"), `${fmt(site.earth.el, 0, lang)}° · ${pt ? BEARING_PT[eB] : eB}${seen ? L(" · IN THE WINDOW", " · NA JANELA") : ""}`]);
    } else {
      lines.push([L("EARTH", "TERRA"), L("BELOW THE HORIZON · FAR SIDE", "ABAIXO DO HORIZONTE · LADO OCULTO"), "far"]);
    }
    return { title, lines, note: L("The landing site, as the LM came to rest. Drag to look around the window frame.", "O local do pouso, como o LM parou. Arraste para olhar ao redor da moldura.") };
  }
  if (id === "landing") {
    const r = ctx.result || {};
    const lines = [
      [L("DESTINATION", "DESTINO"), site.name],
      [L("LM TILT", "INCLINAÇÃO DO LM"), `${fmt(Math.hypot(pose.tilt || 0, pose.pitch || 0), 1, lang)}°`, Math.hypot(pose.tilt || 0, pose.pitch || 0) > 6 ? "warn" : "ok"],
      [L("DESCENT ENGINE", "MOTOR DE DESCIDA"), L("SAFED", "DESATIVADO"), "ok"],
    ];
    if (Number.isFinite(r.touchdownSpeed)) lines.push([L("TOUCHDOWN SPEED", "VELOCIDADE NO TOQUE"), `${fmt(r.touchdownSpeed, 1, lang)} m/s`]);
    if (Number.isFinite(r.fuelPct)) lines.push([L("DESCENT FUEL LEFT", "COMBUSTÍVEL RESTANTE"), `${fmt(r.fuelPct, 0, lang)} %`]);
    return { title, lines, note: L("Touchdown confirmed. The descent stage is now the launch pad.", "Pouso confirmado. O estágio de descida agora é a plataforma de lançamento.") };
  }
  if (id === "checklist") {
    const lines = [
      [L("LUNAR LANDING", "POUSO LUNAR"), L("COMPLETE", "CONCLUÍDO"), "ok"],
      c.evaDone
        ? [L("LUNAR EVA", "EVA LUNAR"), L("COMPLETE", "CONCLUÍDA"), "ok"]
        : c.evaAvailable
          ? [L("LUNAR EVA", "EVA LUNAR"), evaReady(c) ? L("READY", "PRONTA") : L("OPTIONAL · NOT STARTED", "OPCIONAL · NÃO INICIADA")]
          : [L("LUNAR EVA", "EVA LUNAR"), L("NOT PLANNED", "NÃO PREVISTA")],
      [L("ASCENT PREPARATION", "PREPARAÇÃO DA ASCENSÃO"), ascentReady(c) ? L("COMPLETE", "CONCLUÍDA") : `${c.ascent} / ${ASCENT_PREP.length}`, ascentReady(c) ? "ok" : null],
      [L("RENDEZVOUS & DOCKING", "ENCONTRO E ACOPLAMENTO"), L("AHEAD", "A SEGUIR")],
    ];
    return { title, lines, note: L("Nothing is forced: the EVA is optional, and the ascent can be prepared at any time.", "Nada é obrigatório: a EVA é opcional, e a ascensão pode ser preparada a qualquer momento.") };
  }
  if (id === "ascent") {
    const lines = ASCENT_PREP.map((s, i) => [s.label[pt ? "pt" : "en"], i < c.ascent ? L("GO", "OK") : c.busy && c.busy.kind === "ascent" && c.busy.index === i ? "…" : "—", i < c.ascent ? "ok" : null]);
    lines.push([L("CSM IN ORBIT", "CSM EM ÓRBITA"), L("TRACKING", "RASTREANDO")]);
    return { title, lines, note: L("The ascent stage lifts off from the descent stage and climbs to the CSM.", "O estágio de ascensão decola do estágio de descida e sobe até o CSM.") };
  }
  if (id === "comms") {
    const lines = farSide
      ? [
          [L("EARTH LINK", "LINK COM A TERRA"), L("UNAVAILABLE · FAR SIDE", "INDISPONÍVEL · LADO OCULTO"), "far"],
          [L("S-BAND", "BANDA S"), L("NO EARTH IN VIEW", "TERRA FORA DE VISTA"), "far"],
          [L("VHF · CREW", "VHF · TRIPULAÇÃO"), L("LOUD AND CLEAR", "ALTO E CLARO"), "ok"],
          [L("CSM RELAY", "RELÉ DO CSM"), L("NEXT PASS · ON ASCENT", "PRÓXIMA PASSAGEM · NA ASCENSÃO")],
        ]
      : [
          [L("EARTH LINK", "LINK COM A TERRA"), L("HOUSTON · GO", "HOUSTON · OK"), "ok"],
          [L("S-BAND", "BANDA S"), L("STEERABLE ANTENNA LOCKED", "ANTENA ORIENTÁVEL TRAVADA"), "ok"],
          [L("ONE-WAY DELAY", "ATRASO (IDA)"), "1.3 s".replace(".", pt ? "," : ".")],
          [L("VHF · CREW", "VHF · TRIPULAÇÃO"), L("LOUD AND CLEAR", "ALTO E CLARO"), "ok"],
        ];
    return { title, lines, note: farSide ? L("Behind the Moon there is no line of sight to Earth: only the crew talks.", "Atrás da Lua não há linha de visada com a Terra: só a tripulação fala.") : L("Mission Control hears you with a 1.3-second delay each way.", "O Controle da Missão ouve vocês com 1,3 segundo de atraso em cada sentido.") };
  }
  if (id === "hatch") {
    const open = c.evaAvailable && c.eva >= 2;
    const lines = [
      [L("FORWARD HATCH", "ESCOTILHA DIANTEIRA"), open ? L("UNLATCHED", "DESTRAVADA") : L("CLOSED · LATCHED", "FECHADA · TRAVADA"), open ? "warn" : "ok"],
      [L("CABIN PRESSURE", "PRESSÃO DA CABINE"), open ? "0.0 psi" : "4.8 psi".replace(".", pt ? "," : ".")],
      [L("EXIT", "SAÍDA"), L("PORCH · LADDER · SURFACE", "VARANDA · ESCADA · SUPERFÍCIE")],
    ];
    return { title, lines, note: L("The way out to the surface: through the hatch, onto the porch and down the ladder.", "A saída para a superfície: pela escotilha, para a varanda e escada abaixo.") };
  }
  if (id === "eva") {
    if (c.evaDone) return { title, lines: [[L("LUNAR EVA", "EVA LUNAR"), L("COMPLETE", "CONCLUÍDA"), "ok"], [L("PLSS", "PLSS"), L("STOWED · RECHARGING", "GUARDADO · RECARREGANDO")]], note: L("Samples are stowed for the ride home.", "As amostras estão guardadas para a volta.") };
    if (!c.evaAvailable) return { title, lines: [[L("LUNAR EVA", "EVA LUNAR"), L("NOT PLANNED", "NÃO PREVISTA")]], note: "" };
    const lines = EVA_PREP.map((s, i) => [s.label[pt ? "pt" : "en"], i < c.eva ? L("GO", "OK") : c.busy && c.busy.kind === "eva" && c.busy.index === i ? "…" : "—", i < c.eva ? "ok" : null]);
    return { title, lines, note: L("Suits, hatch and backpacks: three checks, then the surface.", "Trajes, escotilha e mochilas: três verificações, depois a superfície.") };
  }
  return { title, lines: [], note: "" };
}

/* ---- text ---------------------------------------------------------------------------------- */
export const CABIN_TEXT = {
  en: {
    cabin: "LM CABIN",
    enter: "ENTER CABIN",
    enterSub: "OPTIONAL · INSIDE THE LUNAR MODULE",
    back: "RETURN TO CABIN",
    backSub: "OPTIONAL · BACK INSIDE THE LM",
    exit: "EXIT CABIN",
    close: "BACK",
    drag: "DRAG TO LOOK · TAP A PANEL",
    tasks: "CABIN TASKS",
    evaPrep: "EVA PREPARATION",
    ascentPrep: "ASCENT PREPARATION",
    beginEva: "BEGIN EVA",
    beginEvaSub: "THROUGH THE HATCH · TO THE SURFACE",
    toAscent: "CONTINUE TO ASCENT",
    toAscentSub: "GUIDED OR MANUAL ASCENT",
    evaDone: "EVA COMPLETE",
    evaNone: "NO EVA PLANNED",
    working: "IN PROGRESS",
    view: "VIEW",
  },
  pt: {
    cabin: "CABINE DO LM",
    enter: "ENTRAR NA CABINE",
    enterSub: "OPCIONAL · DENTRO DO MÓDULO LUNAR",
    back: "VOLTAR À CABINE",
    backSub: "OPCIONAL · DE VOLTA AO LM",
    exit: "SAIR DA CABINE",
    close: "VOLTAR",
    drag: "ARRASTE PARA OLHAR · TOQUE UM PAINEL",
    tasks: "TAREFAS DA CABINE",
    evaPrep: "PREPARAÇÃO DA EVA",
    ascentPrep: "PREPARAÇÃO DA ASCENSÃO",
    beginEva: "INICIAR EVA",
    beginEvaSub: "PELA ESCOTILHA · ATÉ A SUPERFÍCIE",
    toAscent: "SEGUIR PARA A ASCENSÃO",
    toAscentSub: "ASCENSÃO GUIADA OU MANUAL",
    evaDone: "EVA CONCLUÍDA",
    evaNone: "SEM EVA PREVISTA",
    working: "EM ANDAMENTO",
    view: "VISTA",
  },
};
export const cabinText = (lang) => CABIN_TEXT[lang === "pt" ? "pt" : "en"];
