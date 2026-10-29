/*
 * LUNAVIA — COUNTDOWN TO LAUNCH: the optional pre-launch experience (pure; unit-tested).
 *
 * From the startup screen, PRE-LAUNCH EXPERIENCE (beside, and below, LAUNCH SEQUENCE — INITIATE)
 * plays the last minutes before LV-001's launch:
 *
 *   pad      LV-001 on Launch Complex 39, seen from the hardstand (a short exterior shot), then a
 *            cut to the cabin — no boarding is played
 *   cabin    aboard the command module: the couches, the main display console, six panels to
 *            inspect, the six-item launch checklist, the hatch closed
 *   count    the terminal count from T-45 to T-15 inside the cabin
 *
 * At T-15 the experience hands over to the EXISTING launch (components/scenes/LaunchCinematic),
 * which starts at T-15 on the pad and calls the count from T-10 itself (data/launchTimeline): the
 * count is continuous, nothing is said twice, and the launch is the same film, run once. SKIP
 * PRE-LAUNCH, at any moment, hands over in the same way. The checklist is a simplified LUNAVIA
 * gameplay checklist, not a historical Apollo procedure; the radio is dramatized (synthetic voices).
 *
 * The pad shot is in the launch scene's units (1 unit = 30 m; the rocket's axis at x = z = 0, the
 * hardstand at y = 0, the tower on +x).
 */
import { LIFTOFF_T } from "./launchTimeline";

export const STAGES = ["pad", "cabin", "count"];
/**
 * Stage names of the earlier, longer experience (suit room, tower ride, crew access arm), mapped to
 * the stage that now stands in their place: anything before the cabin is the pad, the arm the cabin.
 * Nothing stores a pre-launch stage (the mission's save starts at lunar descent), so this only
 * keeps older tooling and any stale value harmless.
 */
const LEGACY_STAGE = { suit: "pad", tower: "pad", walkway: "cabin" };
export function normalizeStage(stage) {
  if (typeof stage !== "string") return null;
  if (STAGES.includes(stage)) return stage;
  return Object.prototype.hasOwnProperty.call(LEGACY_STAGE, stage) ? LEGACY_STAGE[stage] : null;
}

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

/* ---- the words (EN / PT) ----------------------------------------------------------------------- */
export const PRELAUNCH_TEXT = {
  en: {
    entry: "PRE-LAUNCH EXPERIENCE",
    entrySub: "LAUNCH COMPLEX · COMMAND MODULE · FINAL COUNT",
    skip: "SKIP PRE-LAUNCH",
    title: "COUNTDOWN TO LAUNCH",
    dramatized: "DRAMATIZED · SIMPLIFIED LUNAVIA PROCEDURES",
    stages: { pad: "LAUNCH COMPLEX 39", cabin: "COMMAND MODULE", count: "TERMINAL COUNT" },
    pad: { arrival: "LV-001 ON LAUNCH COMPLEX 39 · CREW ABOARD", toCabin: "TO THE COMMAND MODULE" },
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
    entrySub: "COMPLEXO DE LANÇAMENTO · MÓDULO DE COMANDO · CONTAGEM FINAL",
    skip: "PULAR PRÉ-LANÇAMENTO",
    title: "CONTAGEM PARA O LANÇAMENTO",
    dramatized: "DRAMATIZADO · PROCEDIMENTOS SIMPLIFICADOS DO LUNAVIA",
    stages: { pad: "COMPLEXO DE LANÇAMENTO 39", cabin: "MÓDULO DE COMANDO", count: "CONTAGEM FINAL" },
    pad: { arrival: "LV-001 NO COMPLEXO DE LANÇAMENTO 39 · TRIPULAÇÃO A BORDO", toCabin: "PARA O MÓDULO DE COMANDO" },
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

/* ---- the launch complex: one exterior shot (launch-scene units, 1 = 30 m) ---------------------- */
/**
 * LV-001 on its pad from the hardstand by the crawlerway: a slow push in towards the vehicle and
 * its tower over Mission Control's final briefing (`call`), then a dip to black and a cut into the
 * cabin. TO THE COMMAND MODULE is offered after `cta` s.
 */
export const PAD_SHOT = { dur: 9, cta: 3, call: { at: 0.6, id: "prelaunch.briefing" } };
export function padCameraAt(t) {
  const k = smooth(t / PAD_SHOT.dur);
  return { pos: lerp3([-1.7, 0.07, 5.8], [-1.25, 0.08, 4.6], k), look: lerp3([0.3, 1.8, 0], [0.45, 2.2, 0], k), fov: 46 };
}
export const clampLook = ({ yaw, pitch }, lim) => ({ yaw: clamp(yaw, lim.yaw[0], lim.yaw[1]), pitch: clamp(pitch, lim.pitch[0], lim.pitch[1]) });

/* ---- the command module's cabin ------------------------------------------------------------------ */
/**
 * The panels the player may inspect (the view glides to each; no switch is made functional). Each
 * has a look direction from the commander's couch (yaw, pitch rad) and its words.
 */
export const CABIN_PANELS = [
  {
    id: "entry",
    look: { yaw: 0.84, pitch: 0.42 },
    en: { tag: "ENTRY", name: "ENTRY MONITOR", body: "The entry monitor's scroll and the g-meter, with the stabilization and control switches below: little to do at launch, everything on the way home." },
    pt: { tag: "REENTRADA", name: "MONITOR DE REENTRADA", body: "O registro do monitor de reentrada e o acelerômetro (g), com as chaves de estabilização e controle abaixo: pouco a fazer no lançamento, tudo na volta para casa." },
  },
  {
    id: "flight",
    look: { yaw: 0.42, pitch: 0.46 },
    en: { tag: "FLIGHT", name: "FLIGHT CONTROLS", body: "Attitude ball (FDAI), rate and error needles, the event timer and the abort handle's lamp: what the commander flies by in the boost." },
    pt: { tag: "VOO", name: "CONTROLES DE VOO", body: "A esfera de atitude (FDAI), os ponteiros de razão e de erro, o cronômetro de eventos e a luz de aborto: o que o comandante acompanha na subida." },
  },
  {
    id: "guidance",
    look: { yaw: 0.0, pitch: 0.5 },
    en: { tag: "GUIDANCE", name: "GUIDANCE COMPUTER", body: "The display and keyboard of the guidance computer: program, verb and noun, three registers. It takes over the count's last seconds when guidance goes internal." },
    pt: { tag: "GUIAGEM", name: "COMPUTADOR DE GUIAGEM", body: "O display e o teclado do computador de guiagem: programa, verbo e nome, três registradores. Ele assume os últimos segundos quando a guiagem passa a interna." },
  },
  {
    id: "caution",
    look: { yaw: -0.42, pitch: 0.46 },
    en: { tag: "C&W", name: "CAUTION AND WARNING", body: "Forty annunciators for the spacecraft's systems. Before launch every one must be dark, then the master alarm is tested." },
    pt: { tag: "ALERTAS", name: "ALERTA E AVISO", body: "Quarenta anunciadores dos sistemas da nave. Antes do lançamento todos precisam estar apagados; depois o alarme geral é testado." },
  },
  {
    id: "power",
    look: { yaw: -0.8, pitch: 0.42 },
    en: { tag: "POWER", name: "ELECTRICAL POWER", body: "Voltage and current of the main buses, the fuel cells, the entry batteries and the inverters: on internal power before the umbilicals let go." },
    pt: { tag: "ENERGIA", name: "ENERGIA ELÉTRICA", body: "Tensão e corrente dos barramentos principais, as células de combustível, as baterias e os inversores: energia interna antes de os umbilicais se soltarem." },
  },
  {
    id: "comms",
    look: { yaw: -1.14, pitch: 0.62 },
    en: { tag: "COMMS", name: "COMMUNICATIONS", body: "The audio panel: each crew member's loops to Launch Control and Houston, the volume knobs and the push-to-talk modes." },
    pt: { tag: "ÁUDIO", name: "COMUNICAÇÕES", body: "O painel de áudio: os canais de cada tripulante com o Controle de Lançamento e Houston, os volumes e os modos de transmissão." },
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
 * { stage, launched: bool }. The launch is requested once only:
 * requestLaunch() returns { state, launch } with launch true the first time and never again.
 */
export function createPreLaunch(stage = "pad") {
  return { stage: normalizeStage(stage) || "pad", launched: false };
}
const ORDER = { pad: 0, cabin: 1, count: 2 };
/** Move on to a later stage (never back; the count only once the checklist is complete). */
export function advance(st, stage, { checklistDone = false } = {}) {
  if (st.launched || !(stage in ORDER) || !(st.stage in ORDER) || ORDER[stage] <= ORDER[st.stage]) return st;
  if (stage === "count" && !checklistDone) return st;
  return { ...st, stage };
}
export function requestLaunch(st) {
  if (st.launched) return { state: st, launch: false };
  return { state: { ...st, launched: true }, launch: true };
}
