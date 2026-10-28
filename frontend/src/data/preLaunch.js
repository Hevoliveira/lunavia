/*
 * LUNAVIA — COUNTDOWN TO LAUNCH: the optional pre-launch experience (pure; unit-tested).
 *
 * From the startup screen, PRE-LAUNCH EXPERIENCE (beside, and below, LAUNCH SEQUENCE — INITIATE)
 * plays the last hours before LV-001's launch, compressed into a few minutes:
 *
 *   suit     the suit room: SUIT CHECK, COMMUNICATIONS CHECK, CREW READY, the final briefing
 *   tower    arrival at the pad, then the elevator up the umbilical tower to the crew access level
 *   walkway  first person along the crew access arm to the white room (look around by touch)
 *   cabin    aboard the command module: the couches, the main display console, four panels to
 *            inspect, the six-item launch checklist, the hatch closed
 *   count    the terminal count from T-45 to T-15 inside the cabin
 *
 * At T-15 the experience hands over to the EXISTING launch (components/scenes/LaunchCinematic),
 * which starts at T-15 on the pad and calls the count from T-10 itself (data/launchTimeline): the
 * count is continuous, nothing is said twice, and the launch is the same film, run once. SKIP
 * PRE-LAUNCH, at any moment, hands over in the same way. The checklist is a simplified LUNAVIA
 * gameplay checklist, not a historical Apollo procedure; the radio is dramatized (synthetic voices).
 *
 * Units: metres, in the pad's frame (the rocket's axis at x = z = 0, the hardstand at y = 0, the
 * tower on +x), except where the launch scene's units are named (1 unit = UNIT_M = 30 m).
 */
import { LIFTOFF_T, UNIT_M } from "./launchTimeline";
import { CM_PROFILE } from "./csmDesign";
import { CSM_MATED, ROCKET_M_PER_UNIT, UPPER_STAGE } from "./payloadDesign";

export const STAGES = ["suit", "tower", "walkway", "cabin", "count"];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/* ---- the pad, at the launch film's scale ----------------------------------------------------- */
/** The rocket in the launch scene: drawn at 0.6 of its model, 18 m per model unit → 30 m per unit. */
export const ROCKET_SCALE = 0.6;
/** The command module on the pad (m): its base (the CM / SM interface) and its hatch. */
export const CM_ON_PAD = (() => {
  const base = (UPPER_STAGE.topUnits + CSM_MATED.y / ROCKET_M_PER_UNIT) * ROCKET_SCALE * UNIT_M;
  // the hatch: centred 1.0 m up the CM's cone, on the side facing the tower (+x)
  const hatchY = 1.0;
  const [a, b] = [CM_PROFILE[1], CM_PROFILE[2]];
  const r = a[0] + ((b[0] - a[0]) * (hatchY - a[1])) / (b[1] - a[1]);
  return { base, hatch: { y: base + hatchY, r, w: 0.92, h: 0.82 }, coneSlope: Math.atan2(a[0] - b[0], b[1] - a[1]) };
})();
/** The umbilical tower's face (m from the axis) and the crew access arm (components/scenes/LaunchComplex). */
export const TOWER = { face: 1.3 * UNIT_M, half: 0.25 * UNIT_M, top: 4.7 * UNIT_M };
/** The crew access arm (m): its floor, width, inner height, and the white room at its end round the hatch. */
export const ARM = {
  floor: (0.18 + 0.32 * 9 + 0.0075) * UNIT_M, // the tower's grated floor at that level (LaunchComplex), 92.0 m: the hatch's sill ≈ 0.5 m above
  width: 1.6,
  height: 2.35,
  start: TOWER.face + 1.4, // the elevator landing inside the tower
  end: 3.4, // the arm meets the white room
  windowEvery: 2.4, // the arm's side windows, a pane every 2.4 m
};
export const WHITE_ROOM = { x0: CM_ON_PAD.hatch.r + 0.3, x1: ARM.end, width: 3.2, height: 2.7 };
export const EYE = 1.66; // eye height in the suit (m over the floor)

/* ---- the words (EN / PT) ----------------------------------------------------------------------- */
export const PRELAUNCH_TEXT = {
  en: {
    entry: "PRE-LAUNCH EXPERIENCE",
    entrySub: "SUIT-UP · LAUNCH TOWER · CREW ACCESS ARM · COMMAND MODULE · FINAL COUNT",
    skip: "SKIP PRE-LAUNCH",
    title: "COUNTDOWN TO LAUNCH",
    dramatized: "DRAMATIZED · SIMPLIFIED LUNAVIA PROCEDURES",
    stages: { suit: "SUIT ROOM", tower: "LAUNCH COMPLEX 39", walkway: "CREW ACCESS ARM", cabin: "COMMAND MODULE", count: "TERMINAL COUNT" },
    suit: {
      suitCheck: "SUIT CHECK",
      commCheck: "COMMUNICATIONS CHECK",
      crewReady: "CREW READY",
      done: { suitCheck: "SUITS PRESSURISED · HELMETS LOCKED", commCheck: "COMMUNICATIONS LOUD AND CLEAR", crewReady: "CREW READY" },
      hint: "PREPARE THE CREW",
      briefing: "FINAL CREW BRIEFING",
      briefingItems: ["WEATHER · GO", "RANGE · GO", "LV-001 FUELLED · STABLE", "LAUNCH WINDOW · ON TIME", "RECOVERY FORCES · ON STATION"],
      toPad: "TO THE LAUNCH PAD",
    },
    tower: { arrival: "ARRIVAL AT THE PAD · LV-001 ON LAUNCH COMPLEX 39", elevator: "ELEVATOR TO THE CREW ACCESS LEVEL · 92 M" },
    walk: { look: "DRAG TO LOOK AROUND", walking: "CREW ACCESS ARM · 92 M ABOVE THE PAD", pause: "LOOK AROUND", go: "CONTINUE", whiteRoom: "THE WHITE ROOM · COMMAND MODULE HATCH", board: "BOARD THE SPACECRAFT" },
    cabin: {
      seat: "COMMANDER'S COUCH · LEFT SEAT",
      look: "DRAG TO LOOK · TAP A PANEL TO INSPECT",
      checklist: "LAUNCH CHECKLIST",
      ready: "CREW READY FOR LAUNCH",
      begin: "BEGIN FINAL COUNT",
      back: "BACK",
      note: "A SIMPLIFIED LUNAVIA CHECKLIST · NOT A HISTORICAL PROCEDURE",
    },
    count: { tminus: "T-MINUS", handoff: "LAUNCH SEQUENCE" },
  },
  pt: {
    entry: "EXPERIÊNCIA PRÉ-LANÇAMENTO",
    entrySub: "TRAJES · TORRE DE LANÇAMENTO · BRAÇO DE ACESSO · MÓDULO DE COMANDO · CONTAGEM FINAL",
    skip: "PULAR PRÉ-LANÇAMENTO",
    title: "CONTAGEM PARA O LANÇAMENTO",
    dramatized: "DRAMATIZADO · PROCEDIMENTOS SIMPLIFICADOS DO LUNAVIA",
    stages: { suit: "SALA DE TRAJES", tower: "COMPLEXO DE LANÇAMENTO 39", walkway: "BRAÇO DE ACESSO DA TRIPULAÇÃO", cabin: "MÓDULO DE COMANDO", count: "CONTAGEM FINAL" },
    suit: {
      suitCheck: "VERIFICAR TRAJES",
      commCheck: "VERIFICAR COMUNICAÇÕES",
      crewReady: "TRIPULAÇÃO PRONTA",
      done: { suitCheck: "TRAJES PRESSURIZADOS · CAPACETES TRAVADOS", commCheck: "COMUNICAÇÕES ALTO E CLARO", crewReady: "TRIPULAÇÃO PRONTA" },
      hint: "PREPARE A TRIPULAÇÃO",
      briefing: "BRIEFING FINAL DA TRIPULAÇÃO",
      briefingItems: ["TEMPO · GO", "CAMPO DE LANÇAMENTO · GO", "LV-001 ABASTECIDO · ESTÁVEL", "JANELA DE LANÇAMENTO · NO HORÁRIO", "EQUIPES DE RESGATE · EM POSIÇÃO"],
      toPad: "PARA A PLATAFORMA",
    },
    tower: { arrival: "CHEGADA À PLATAFORMA · LV-001 NO COMPLEXO 39", elevator: "ELEVADOR ATÉ O NÍVEL DE ACESSO · 92 M" },
    walk: { look: "ARRASTE PARA OLHAR EM VOLTA", walking: "BRAÇO DE ACESSO DA TRIPULAÇÃO · 92 M ACIMA DA PLATAFORMA", pause: "OLHE EM VOLTA", go: "CONTINUAR", whiteRoom: "A SALA BRANCA · ESCOTILHA DO MÓDULO DE COMANDO", board: "EMBARCAR NA NAVE" },
    cabin: {
      seat: "ASSENTO DO COMANDANTE · LADO ESQUERDO",
      look: "ARRASTE PARA OLHAR · TOQUE NUM PAINEL PARA EXAMINAR",
      checklist: "CHECKLIST DE LANÇAMENTO",
      ready: "TRIPULAÇÃO PRONTA PARA O LANÇAMENTO",
      begin: "INICIAR CONTAGEM FINAL",
      back: "VOLTAR",
      note: "CHECKLIST SIMPLIFICADO DO LUNAVIA · NÃO É UM PROCEDIMENTO HISTÓRICO",
    },
    count: { tminus: "T-MENOS", handoff: "SEQUÊNCIA DE LANÇAMENTO" },
  },
};
export const prelaunchText = (lang) => PRELAUNCH_TEXT[lang === "pt" ? "pt" : "en"];

/* ---- the suit room ------------------------------------------------------------------------------- */
/** The three preparations, in order; each plays its calls and its moment, then the next is offered. */
export const SUIT_STEPS = [
  { id: "suitCheck", dur: 6.5, calls: [{ at: 0.6, id: "prelaunch.suitCheck" }] },
  { id: "commCheck", dur: 7.5, calls: [{ at: 0.3, id: "prelaunch.commHouston" }, { at: 3.6, id: "prelaunch.commCrew" }] },
  { id: "crewReady", dur: 4.0, calls: [{ at: 0.3, id: "prelaunch.crewReady" }] },
];
/** The final briefing from Mission Control, after CREW READY (s), its items appearing one by one. */
export const BRIEFING = { dur: 13, call: { at: 0.4, id: "prelaunch.briefing" }, itemEvery: 1.6, itemFrom: 1.2 };
/** The helmet lowered onto each astronaut during SUIT CHECK (0 raised .. 1 locked), crew i in turn. */
export function helmetAt(i, t) {
  // t: seconds since SUIT CHECK began (null before it)
  if (t == null) return 0;
  const from = 0.6 + i * 1.6;
  return smooth((t - from) / 1.5);
}

/* ---- the tower: arrival and the elevator (launch-scene units) --------------------------------- */
export const TOWER_RIDE = { dur: 17, arrival: [0, 7.5], elevator: [7.5, 17], dip: 0.45 };
/**
 * The camera in the launch scene's units (1 = 30 m): a low push in at the pad, a short dip to black,
 * then the ride up inside the tower in the elevator at the arm's landing, the rocket beside it the
 * whole way, stopping at the arm's level exactly where the walk begins. `dip` 0..1 (the cut).
 */
export function towerCameraAt(t) {
  const [a0, a1] = TOWER_RIDE.arrival;
  const [e0, e1] = TOWER_RIDE.elevator;
  const d = TOWER_RIDE.dip;
  const dip = Math.max(0, 1 - Math.abs(t - e0) / d);
  if (t < e0) {
    // on the hardstand by the crawlerway, looking up at LV-001 and its tower
    const k = smooth((t - a0) / (a1 - a0));
    return { pos: lerp3([-1.7, 0.07, 5.8], [-1.25, 0.08, 4.6], k), look: lerp3([0.3, 1.8, 0], [0.45, 2.2, 0], k), fov: 46, shot: "arrival", dip };
  }
  const u = clamp((t - e0) / (e1 - e0), 0, 1);
  // an elevator's ride: a gentle start, a steady climb, a gentle stop
  const A = 0.15;
  const c = 1 / (1 - A); // the steady climb's rate, so that the ramps meet it without a kink
  const k = u < A ? (c * u * u) / (2 * A) : u > 1 - A ? 1 - (c * (1 - u) * (1 - u)) / (2 * A) : c * (u - A / 2);
  const yU = lerp(0.3, (ARM.floor + EYE) / UNIT_M, clamp(k, 0, 1));
  const x = ARM.start / UNIT_M;
  // looking out at the rocket, a little up while low (its height), level at the top
  const lookY = yU + 0.9 * (1 - smooth(u / 0.9));
  return { pos: [x, yU, 0], look: [0, lookY, 0], fov: lerp(52, 62, smooth(u)), shot: "elevator", dip };
}

/* ---- the crew access arm, walked (metres) ------------------------------------------------------- */
/** The places the walk pauses (x along the arm, m from the rocket's axis) and what is said there. */
export const WALK = {
  speed: 1.35, // m/s, a measured pace in a pressure suit
  stops: [
    { x: 20, id: "view", call: "prelaunch.armView" },
    { x: WHITE_ROOM.x1 - 0.9, id: "whiteRoom", call: "prelaunch.whiteRoom" },
  ],
  pauseMax: 9, // s: the walk resumes by itself
};
export const WALK_LEN = ARM.start - WALK.stops[1].x;
/** The walker's eye (m) at a distance s walked from the elevator landing; the arm runs along −x. */
export function walkEye(s) {
  const x = ARM.start - clamp(s, 0, WALK_LEN);
  // a slight sway with the steps (a suit's gait), none when standing
  return [x, ARM.floor + EYE, 0];
}
export const stepBob = (s) => 0.022 * Math.abs(Math.sin((s / 0.72) * Math.PI));
/** Boarding (s since BOARD): to the hatch and in, the view lowered to the sill, a dip as the cabin takes over. */
export const BOARD = { dur: 3.2, dip: [2.3, 3.2] };
export function boardEye(t) {
  const k = smooth(t / BOARD.dur);
  const h = CM_ON_PAD.hatch;
  const from = walkEye(WALK_LEN);
  const to = [h.r + 0.25, h.y + 0.05, 0];
  return { pos: lerp3(from, to, k), look: [h.r - 2, h.y - 0.1 * k, 0] };
}
/** Drag-to-look limits (rad) on the walk: the view turns freely enough to see the rocket and the drop. */
export const WALK_LOOK = { yaw: [-2.0, 2.0], pitch: [-0.95, 0.75] };
export const clampLook = ({ yaw, pitch }, lim) => ({ yaw: clamp(yaw, lim.yaw[0], lim.yaw[1]), pitch: clamp(pitch, lim.pitch[0], lim.pitch[1]) });

/* ---- the command module's cabin ------------------------------------------------------------------ */
/**
 * The panels the player may inspect (the view glides to each; no switch is made functional). Each
 * has a look direction from the commander's couch (yaw, pitch rad) and its words.
 */
export const CABIN_PANELS = [
  {
    id: "flight",
    look: { yaw: 0.42, pitch: 0.46 },
    en: { name: "FLIGHT CONTROLS", body: "Attitude ball (FDAI), rate and error needles, the event timer and the abort handle's lamp: what the commander flies by in the boost." },
    pt: { name: "CONTROLES DE VOO", body: "A esfera de atitude (FDAI), os ponteiros de razão e de erro, o cronômetro de eventos e a luz de aborto: o que o comandante acompanha na subida." },
  },
  {
    id: "guidance",
    look: { yaw: 0.0, pitch: 0.5 },
    en: { name: "GUIDANCE COMPUTER", body: "The display and keyboard of the guidance computer: program, verb and noun, three registers. It takes over the count's last seconds when guidance goes internal." },
    pt: { name: "COMPUTADOR DE GUIAGEM", body: "O display e o teclado do computador de guiagem: programa, verbo e nome, três registradores. Ele assume os últimos segundos quando a guiagem passa a interna." },
  },
  {
    id: "caution",
    look: { yaw: -0.42, pitch: 0.46 },
    en: { name: "CAUTION AND WARNING", body: "Forty annunciators for the spacecraft's systems. Before launch every one must be dark, then the master alarm is tested." },
    pt: { name: "ALERTA E AVISO", body: "Quarenta anunciadores dos sistemas da nave. Antes do lançamento todos precisam estar apagados; depois o alarme geral é testado." },
  },
  {
    id: "comms",
    look: { yaw: -1.1, pitch: 0.2 },
    en: { name: "COMMUNICATIONS", body: "The audio panel: each crew member's loops to Launch Control and Houston, the volume knobs and the push-to-talk modes." },
    pt: { name: "COMUNICAÇÕES", body: "O painel de áudio: os canais de cada tripulante com o Controle de Lançamento e Houston, os volumes e os modos de transmissão." },
  },
];
export const panelById = (id) => CABIN_PANELS.find((p) => p.id === id) || null;
/** The couch's resting view and how far the view may turn (rad) — on one's back, the console overhead. */
export const CABIN_LOOK = { rest: { yaw: 0.0, pitch: 0.36 }, yaw: [-1.45, 1.45], pitch: [-0.35, 1.15] };

/**
 * The launch checklist (simplified for LUNAVIA): in order, each item confirmed with a tap; each
 * confirmation lights its panel (`panel`) and plays its call. HATCH — CLOSED swings the hatch shut.
 */
export const CHECKLIST = [
  { id: "pressure", panel: "caution", call: "prelaunch.ckPressure", en: ["CABIN PRESSURE", "VERIFIED"], pt: ["PRESSÃO DA CABINE", "VERIFICADA"] },
  { id: "guidance", panel: "guidance", call: "prelaunch.ckGuidance", en: ["GUIDANCE", "READY"], pt: ["GUIAGEM", "PRONTA"] },
  { id: "comms", panel: "comms", call: "prelaunch.ckComms", en: ["COMMUNICATIONS", "GO"], pt: ["COMUNICAÇÕES", "GO"] },
  { id: "restraints", panel: null, call: "prelaunch.ckRestraints", en: ["CREW RESTRAINTS", "SECURE"], pt: ["CINTOS DA TRIPULAÇÃO", "TRAVADOS"] },
  { id: "hatch", panel: null, call: "prelaunch.ckHatch", en: ["HATCH", "CLOSED"], pt: ["ESCOTILHA", "FECHADA"] },
  { id: "launchControl", panel: "flight", call: "prelaunch.ckLaunchControl", en: ["LAUNCH CONTROL", "GO"], pt: ["CONTROLE DE LANÇAMENTO", "GO"] },
];
export const HATCH_CLOSE = 2.6; // s for the hatch to swing shut and latch
export function createChecklist() {
  return { done: [], at: {} };
}
/** The next item to confirm (null when complete). */
export const nextItem = (ck) => CHECKLIST.find((c) => !ck.done.includes(c.id)) || null;
export const checklistComplete = (ck) => ck.done.length === CHECKLIST.length;
/** Confirm an item: only the next one in order; returns the same state for anything else. */
export function confirmItem(ck, id, now = 0) {
  const n = nextItem(ck);
  if (!n || n.id !== id) return ck;
  return { done: [...ck.done, id], at: { ...ck.at, [id]: now } };
}
/** The hatch (0 open .. 1 shut and latched), from the time HATCH — CLOSED was confirmed. */
export function hatchClosedAt(ck, now) {
  const t0 = ck.at.hatch;
  if (t0 == null) return 0;
  return smooth((now - t0) / HATCH_CLOSE);
}

/* ---- the terminal count ------------------------------------------------------------------------- */
/**
 * From T-45 to the handover at T-15, where the launch film (data/launchTimeline) begins: its own
 * count starts at T-10 (launch.count10). The calls here end before T-15, so none is repeated.
 */
export const COUNT = {
  from: 45,
  handoff: LIFTOFF_T, // T-15
  calls: [
    { tMinus: 45, id: "prelaunch.t45" },
    { tMinus: 32, id: "prelaunch.t30" },
    { tMinus: 22, id: "prelaunch.t20" },
    { tMinus: 18.2, id: "prelaunch.guidanceInternal" },
  ],
  dip: 0.8, // s of dip to black into the launch film
};
export const COUNT_DUR = COUNT.from - COUNT.handoff;
/** The count `elapsed` s after BEGIN FINAL COUNT: T-minus (s), the calls due, and whether to hand over. */
export function countAt(elapsed) {
  const tMinus = Math.max(COUNT.handoff, COUNT.from - elapsed);
  return { tMinus, shown: Math.ceil(tMinus - 1e-9), handoff: elapsed >= COUNT_DUR, dip: smooth((elapsed - (COUNT_DUR - COUNT.dip)) / COUNT.dip) };
}
export const dueCalls = (elapsed, said) => COUNT.calls.filter((c) => COUNT.from - elapsed <= c.tMinus && !said.has(c.id));

/* ---- the whole experience ------------------------------------------------------------------------ */
/**
 * The experience's state (React holds it; this decides what may follow what):
 * { stage, suitDone: [], briefing: bool, launched: bool }. The launch is requested once only:
 * requestLaunch() returns { state, launch } with launch true the first time and never again.
 */
export function createPreLaunch() {
  return { stage: "suit", suitDone: [], briefing: false, launched: false };
}
export const nextSuitStep = (st) => SUIT_STEPS.find((s) => !st.suitDone.includes(s.id)) || null;
export function doSuitStep(st, id) {
  const n = nextSuitStep(st);
  if (st.stage !== "suit" || !n || n.id !== id) return st;
  const suitDone = [...st.suitDone, id];
  return { ...st, suitDone, briefing: suitDone.length === SUIT_STEPS.length };
}
const ORDER = { suit: 0, tower: 1, walkway: 2, cabin: 3, count: 4 };
/** Move on to a later stage (never back; the count only once the checklist is complete). */
export function advance(st, stage, { checklistDone = false } = {}) {
  if (st.launched || !(stage in ORDER) || ORDER[stage] <= ORDER[st.stage]) return st;
  if (stage === "tower" && st.suitDone.length < SUIT_STEPS.length) return st;
  if (stage === "count" && !checklistDone) return st;
  return { ...st, stage };
}
export function requestLaunch(st) {
  if (st.launched) return { state: st, launch: false };
  return { state: { ...st, launched: true }, launch: true };
}

/* ---- sound cues on the walk (procedural, hooks/useMissionAudio prelaunchCue) ------------------- */
/** Footfalls on the arm's grating: one per step while walking (0.72 m a step). */
export const footfallsBetween = (s0, s1) => Math.max(0, Math.floor(s1 / 0.72) - Math.floor(s0 / 0.72));
