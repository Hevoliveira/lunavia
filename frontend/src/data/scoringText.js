/*
 * LUNAVIA — the words of mission scoring, in English and Brazilian Portuguese
 * (the game's subtitle language, audio settings subLang). Every rule is
 * worded from the constants in data/missionScoring, so the text cannot drift
 * from what is scored.
 */
import { DIFFICULTY } from "./landingPhysics";
import { DOCKING } from "./dockingSim";
import { ACHIEVEMENT_RULES as AR, DOCKING_RULES as DR, LANDING_RULES as LR, MEDALS, PHASE_MAX, REENTRY_RULES as RR } from "./missionScoring";
import { TARGET_FPA } from "./reentryGuidance";

const DEG = 180 / Math.PI;
const pc = (x) => `${Math.round(x * 100)} %`;
const f = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d));
const SITE = {
  tranquillitatis: { en: "SEA OF TRANQUILITY", pt: "MAR DA TRANQUILIDADE" },
  hadley: { en: "HADLEY–APENNINE", pt: "HADLEY–APENINOS" },
  tycho: { en: "TYCHO HIGHLANDS", pt: "PLANALTOS DE TYCHO" },
  "far-side": { en: "SILENT HORIZON", pt: "HORIZONTE SILENCIOSO" },
};
export const siteName = (id, lang) => (SITE[id] ? SITE[id][lang] || SITE[id].en : id);

export const UI = {
  en: {
    debrief: "LUNAVIA — MISSION DEBRIEF",
    complete: "MISSION COMPLETE",
    failed: "MISSION FAILED",
    aborted: "MISSION ABORTED",
    total: "TOTAL SCORE",
    medal: "MISSION MEDAL",
    noMedal: "NO MEDAL",
    newBest: "NEW PERSONAL BEST",
    prevBest: "PREVIOUS BEST",
    best: "PERSONAL BEST",
    noPrev: "FIRST SCORED MISSION HERE",
    noBestYet: "NO SUCCESSFUL MISSION HERE YET",
    lossNote: "NO MEDAL: A CAPSULE WAS LOST ON AN EARLIER ENTRY",
    unlocked: "ACHIEVEMENTS UNLOCKED",
    noneUnlocked: "NO NEW ACHIEVEMENTS",
    next: "NEXT",
    details: "DETAILED TELEMETRY",
    hideDetails: "HIDE TELEMETRY",
    missions: "MISSIONS",
    menu: "MAIN MENU",
    records: "FLIGHT RECORDS",
    skip: "SHOW ALL",
    gates: "MEDAL REQUIREMENTS",
    partial: "PARTIAL SCORE — NO MISSION MEDAL",
    notFlown: "NOT FLOWN",
    attempts: "ATTEMPTS",
    deduction: "RESTARTS AND RETRIES",
    points: "PTS",
    open: "MISSION DEBRIEF",
    medalRules: `BRONZE ${MEDALS[3].min} · SILVER ${MEDALS[2].min} · GOLD ${MEDALS[1].min} · PLATINUM ${MEDALS[0].min}`,
    medalGate: "A medal needs a safe landing, the docking and a splashdown, with no capsule lost on entry.",
    medalCap: "CADET and ASTRONAUT: up to GOLD. PLATINUM: COMMANDER only.",
    capped: (tier) => `${tier} points reached — awarded GOLD: PLATINUM is for COMMANDER missions`,
    recommendation: "NEXT TIME",
    date: "DATE",
    status: "STATUS",
    score: "SCORE",
    highlights: "HIGHLIGHTS",
    unscored: "FLOWN BEFORE MISSION SCORING · NOT SCORED",
    inFlight: "NOT FINISHED",
    log: "MISSION LOG",
    medals: "MEDALS & RECORDS",
    achievements: "ACHIEVEMENTS",
    back: "MISSIONS",
    bestScore: "BEST SCORE",
    bestLanding: "BEST LANDING",
    bestDocking: "BEST DOCKING",
    bestDockingClean: "BEST FIRST-ATTEMPT DOCKING",
    bestReentry: "BEST REENTRY",
    successes: "SUCCESSFUL MISSIONS",
    missionAttempts: "MISSION ATTEMPTS",
    dockings: "DOCKINGS · FIRST ATTEMPT / AFTER RESTARTS",
    firstAttemptDockings: "FIRST-ATTEMPT DOCKINGS",
    restartedDockings: "DOCKINGS AFTER RESTARTS",
    firstTry: "1ST ATTEMPT",
    legacy: "COMPLETED BEFORE SCORING",
    earnedHere: "ACHIEVEMENTS EARNED HERE",
    locked: "LOCKED",
    earned: "EARNED",
    progress: "PROGRESS",
    emptyLog: "No official missions flown yet. Choose a destination on MISSIONS.",
    offline: "KEPT ON THIS DEVICE · WORKS OFFLINE · NO ACCOUNT, NO LEADERBOARD",
    training: "Training Center flights are kept separately and never count here.",
    open4: "All four destinations are open from the start.",
    review: "REVIEW",
    close: "CLOSE",
    landingAttempts: (n) => `${n} DESCENTS`,
  },
  pt: {
    debrief: "LUNAVIA — RELATÓRIO DA MISSÃO",
    complete: "MISSÃO CUMPRIDA",
    failed: "MISSÃO FRACASSADA",
    aborted: "MISSÃO ABORTADA",
    total: "PONTUAÇÃO TOTAL",
    medal: "MEDALHA DA MISSÃO",
    noMedal: "SEM MEDALHA",
    newBest: "NOVO RECORDE PESSOAL",
    prevBest: "RECORDE ANTERIOR",
    best: "RECORDE PESSOAL",
    noPrev: "PRIMEIRA MISSÃO PONTUADA AQUI",
    noBestYet: "NENHUMA MISSÃO BEM-SUCEDIDA AQUI AINDA",
    lossNote: "SEM MEDALHA: UMA CÁPSULA FOI PERDIDA EM UMA REENTRADA ANTERIOR",
    unlocked: "CONQUISTAS DESBLOQUEADAS",
    noneUnlocked: "NENHUMA CONQUISTA NOVA",
    next: "PRÓXIMA",
    details: "TELEMETRIA DETALHADA",
    hideDetails: "OCULTAR TELEMETRIA",
    missions: "MISSÕES",
    menu: "MENU PRINCIPAL",
    records: "REGISTROS DE VOO",
    skip: "MOSTRAR TUDO",
    gates: "REQUISITOS DA MEDALHA",
    partial: "PONTUAÇÃO PARCIAL — SEM MEDALHA DA MISSÃO",
    notFlown: "NÃO VOADO",
    attempts: "TENTATIVAS",
    deduction: "REINÍCIOS E NOVAS TENTATIVAS",
    points: "PTS",
    open: "RELATÓRIO DA MISSÃO",
    medalRules: `BRONZE ${MEDALS[3].min} · PRATA ${MEDALS[2].min} · OURO ${MEDALS[1].min} · PLATINA ${MEDALS[0].min}`,
    medalGate: "A medalha exige pouso seguro, o acoplamento e a amerissagem, sem cápsula perdida na reentrada.",
    medalCap: "CADET e ASTRONAUT: até OURO. PLATINA: só em COMMANDER.",
    capped: (tier) => `Pontos de ${medalName(tier, "pt")} — concedido OURO: PLATINA é para missões em COMMANDER`,
    recommendation: "NA PRÓXIMA VEZ",
    date: "DATA",
    status: "SITUAÇÃO",
    score: "PONTOS",
    highlights: "DESTAQUES",
    unscored: "VOADA ANTES DA PONTUAÇÃO DE MISSÕES · SEM PONTOS",
    inFlight: "NÃO CONCLUÍDA",
    log: "DIÁRIO DE MISSÕES",
    medals: "MEDALHAS E RECORDES",
    achievements: "CONQUISTAS",
    back: "MISSÕES",
    bestScore: "MELHOR PONTUAÇÃO",
    bestLanding: "MELHOR POUSO",
    bestDocking: "MELHOR ACOPLAMENTO",
    bestDockingClean: "MELHOR ACOPLAMENTO NA 1ª TENTATIVA",
    bestReentry: "MELHOR REENTRADA",
    successes: "MISSÕES BEM-SUCEDIDAS",
    missionAttempts: "TENTATIVAS DE MISSÃO",
    dockings: "ACOPLAMENTOS · 1ª TENTATIVA / APÓS REINÍCIOS",
    firstAttemptDockings: "ACOPLAMENTOS NA 1ª TENTATIVA",
    restartedDockings: "ACOPLAMENTOS APÓS REINÍCIOS",
    firstTry: "1ª TENTATIVA",
    legacy: "CONCLUÍDAS ANTES DA PONTUAÇÃO",
    earnedHere: "CONQUISTAS OBTIDAS AQUI",
    locked: "BLOQUEADA",
    earned: "OBTIDA",
    progress: "PROGRESSO",
    emptyLog: "Nenhuma missão oficial voada ainda. Escolha um destino em MISSÕES.",
    offline: "GUARDADO NESTE APARELHO · FUNCIONA OFFLINE · SEM CONTA, SEM RANKING",
    training: "Os voos do Centro de Treinamento ficam à parte e nunca contam aqui.",
    open4: "Os quatro destinos estão abertos desde o início.",
    review: "REVER",
    close: "FECHAR",
    landingAttempts: (n) => `${n} DESCIDAS`,
  },
};
export const ui = (lang) => UI[lang] || UI.en;

const MEDAL = { BRONZE: { en: "BRONZE", pt: "BRONZE" }, SILVER: { en: "SILVER", pt: "PRATA" }, GOLD: { en: "GOLD", pt: "OURO" }, PLATINUM: { en: "PLATINUM", pt: "PLATINA" } };
export const medalName = (m, lang) => (m && MEDAL[m] ? MEDAL[m][lang] || MEDAL[m].en : lang === "pt" ? "SEM MEDALHA" : "NO MEDAL");

const RATING = {
  OUTSTANDING: { en: "OUTSTANDING", pt: "EXCEPCIONAL" },
  EXCELLENT: { en: "EXCELLENT", pt: "EXCELENTE" },
  GOOD: { en: "GOOD", pt: "BOM" },
  FAIR: { en: "FAIR", pt: "REGULAR" },
  "NEEDS WORK": { en: "NEEDS WORK", pt: "A MELHORAR" },
  CRASH: { en: "CREW LOST", pt: "TRIPULAÇÃO PERDIDA" },
  "NOT DOCKED": { en: "NOT DOCKED", pt: "SEM ACOPLAMENTO" },
  "VEHICLE LOST": { en: "CAPSULE LOST", pt: "CÁPSULA PERDIDA" },
};
export const ratingName = (r, lang) => (RATING[r] ? RATING[r][lang] || RATING[r].en : r);
export const RATING_RULE = {
  en: "Phase ratings: OUTSTANDING 95 % · EXCELLENT 85 % · GOOD 70 % · FAIR 50 % of the phase's points.",
  pt: "Avaliação da fase: EXCEPCIONAL 95 % · EXCELENTE 85 % · BOM 70 % · REGULAR 50 % dos pontos da fase.",
};

const PHASE = { landing: { en: "LUNAR LANDING", pt: "POUSO LUNAR" }, docking: { en: "ORBITAL DOCKING", pt: "ACOPLAMENTO ORBITAL" }, reentry: { en: "EARTH REENTRY", pt: "REENTRADA NA TERRA" } };
export const phaseName = (p, lang) => PHASE[p][lang] || PHASE[p].en;

const GATE = {
  landing: { en: "LAND SAFELY ON THE MOON", pt: "POUSAR NA LUA COM SEGURANÇA" },
  docking: { en: "COMPLETE THE MANUAL DOCKING", pt: "CONCLUIR O ACOPLAMENTO MANUAL" },
  reentry: { en: "SURVIVE REENTRY · SPLASHDOWN", pt: "SOBREVIVER À REENTRADA · AMERISSAGEM" },
  survival: { en: "NO CAPSULE LOST ON ENTRY", pt: "NENHUMA CÁPSULA PERDIDA NA REENTRADA" },
};
export const gateName = (g, lang) => GATE[g][lang] || GATE[g].en;

const STATUS = {
  complete: { en: "COMPLETE", pt: "CUMPRIDA" },
  "complete-after-loss": { en: "COMPLETE · CAPSULE LOST BEFORE", pt: "CUMPRIDA · CÁPSULA PERDIDA ANTES" },
  "failed-landing": { en: "FAILED · LANDING", pt: "FRACASSO · POUSO" },
  "failed-docking": { en: "FAILED · DOCKING", pt: "FRACASSO · ACOPLAMENTO" },
  "failed-reentry": { en: "FAILED · REENTRY", pt: "FRACASSO · REENTRADA" },
  aborted: { en: "ABORTED", pt: "ABORTADA" },
};
export const statusName = (s, lang) => (STATUS[s] ? STATUS[s][lang] || STATUS[s].en : ui(lang).inFlight);

/* ---- the score's components: what was measured, and how it is scored ---------------------------- */
const T = (en, pt) => ({ en, pt });
/** { label, value, how } of one component, for a phase's snapshot. */
export function componentText(phase, c, snap, lang) {
  const L = (o) => o[lang] || o.en;
  if (phase === "landing") {
    const cfg = DIFFICULTY[snap.difficulty];
    switch (c.id) {
      case "vertical":
        return { label: L(T("VERTICAL TOUCHDOWN SPEED", "VELOCIDADE VERTICAL NO TOQUE")), value: `${f(c.value, 2)} m/s`, how: L(T(`Full marks up to ${pc(LR.vertical.free)} of the ${cfg.safeVy} m/s limit, none at the limit.`, `Nota máxima até ${pc(LR.vertical.free)} do limite de ${cfg.safeVy} m/s, zero no limite.`)) };
      case "horizontal":
        return { label: L(T("HORIZONTAL TOUCHDOWN SPEED", "VELOCIDADE HORIZONTAL NO TOQUE")), value: `${f(c.value, 2)} m/s`, how: L(T(`Full marks up to ${pc(LR.horizontal.free)} of the ${cfg.safeVx} m/s limit.`, `Nota máxima até ${pc(LR.horizontal.free)} do limite de ${cfg.safeVx} m/s.`)) };
      case "attitude":
        return { label: L(T("ATTITUDE AT TOUCHDOWN", "ATITUDE NO TOQUE")), value: `${f(c.value, 1)}°`, how: L(T(`Tilt: full marks up to ${pc(LR.attitude.free)} of the ${cfg.safeTilt}° limit.`, `Inclinação: nota máxima até ${pc(LR.attitude.free)} do limite de ${cfg.safeTilt}°.`)) };
      case "accuracy":
        return { label: L(T("TOUCHDOWN ACCURACY", "PRECISÃO DO POUSO")), value: `${f(c.value, 1)} m`, how: L(T(`From the primary LZ's centre: full within ${LR.accuracy.full} m, none at ${LR.accuracy.zero} m.`, `Do centro da LZ principal: nota máxima até ${LR.accuracy.full} m, zero a ${LR.accuracy.zero} m.`)) };
      case "fuel":
        return {
          label: L(T("FUEL & DESCENT EFFICIENCY", "COMBUSTÍVEL E EFICIÊNCIA")),
          value: `${Math.round(c.fuelPct)} % · ${f(c.usedRatio, 2)}×`,
          how: L(T(`Fuel used against the ideal braking burn from this start (1.00×): full at ${f(1 / LR.fuel.full, 2)}× or better, none at ${f(1 / LR.fuel.zero, 2)}×. A fuller tank earns nothing more.`, `Combustível usado contra a queima ideal de frenagem deste início (1,00×): nota máxima até ${f(1 / LR.fuel.full, 2)}×, zero a ${f(1 / LR.fuel.zero, 2)}×. Sobra maior não rende mais.`)),
        };
      default:
        return { label: c.id, value: "", how: "" };
    }
  }
  if (phase === "docking") {
    const t = DOCKING[snap.difficulty].tol;
    switch (c.id) {
      case "closing":
        return { label: L(T("CONTACT SPEED", "VELOCIDADE NO CONTATO")), value: `${f(c.value, 3)} m/s`, how: L(T(`Capture window ${t.vMin}–${t.vMax} m/s: full marks up to ${pc(DR.closing.free)} of ${t.vMax} m/s.`, `Janela de captura ${t.vMin}–${t.vMax} m/s: nota máxima até ${pc(DR.closing.free)} de ${t.vMax} m/s.`)) };
      case "alignment":
        return { label: L(T("DOCKING-PORT ALIGNMENT", "ALINHAMENTO COM A PORTA")), value: `${f(c.value * 100, 1)} cm`, how: L(T(`Probe tip off the drogue's axis: full up to ${pc(DR.alignment.free)} of ${Math.round(t.lateral * 100)} cm.`, `Ponta da sonda fora do eixo do drogue: nota máxima até ${pc(DR.alignment.free)} de ${Math.round(t.lateral * 100)} cm.`)) };
      case "drift":
        return { label: L(T("LATERAL / VERTICAL DRIFT", "DERIVA LATERAL / VERTICAL")), value: `${f(c.value * 100, 1)} cm/s`, how: L(T(`At contact: full up to ${pc(DR.drift.free)} of ${Math.round(t.vLat * 100)} cm/s.`, `No contato: nota máxima até ${pc(DR.drift.free)} de ${Math.round(t.vLat * 100)} cm/s.`)) };
      case "angle":
        return { label: L(T("ANGULAR ALIGNMENT", "ALINHAMENTO ANGULAR")), value: `${f(c.value * DEG, 2)}°`, how: L(T(`Between the docking axes: full up to ${pc(DR.angle.free)} of ${f(t.angle * DEG, 1)}°.`, `Entre os eixos de acoplamento: nota máxima até ${pc(DR.angle.free)} de ${f(t.angle * DEG, 1)}°.`)) };
      case "roll":
        return { label: L(T("ROLL ALIGNMENT", "ALINHAMENTO DE ROLAGEM")), value: `${f(c.value * DEG, 2)}°`, how: L(T(`Full up to ${pc(DR.roll.free)} of ${f(t.roll * DEG, 0)}°.`, `Nota máxima até ${pc(DR.roll.free)} de ${f(t.roll * DEG, 0)}°.`)) };
      case "rate":
        return { label: L(T("ROTATION AT CONTACT", "ROTAÇÃO NO CONTATO")), value: `${f(c.value * DEG, 2)}°/s`, how: L(T(`Full up to ${pc(DR.rate.free)} of ${f(t.rate * DEG, 1)}°/s.`, `Nota máxima até ${pc(DR.rate.free)} de ${f(t.rate * DEG, 1)}°/s.`)) };
      case "rcs":
        return { label: L(T("RCS EFFICIENCY", "EFICIÊNCIA DO RCS")), value: `${Math.round(c.value * 100)} % ${L(T("LEFT", "RESTANTE"))}`, how: L(T(`RCS left of the attempt's budget: full at ${pc(DR.rcs.full)}, none at ${pc(DR.rcs.zero)}.`, `RCS restante do orçamento da tentativa: nota máxima a ${pc(DR.rcs.full)}, zero a ${pc(DR.rcs.zero)}.`)) };
      case "clean":
        return { label: L(T("CLEAN CAPTURE", "CAPTURA LIMPA")), value: `${c.value} ${L(T(c.value === 1 ? "CONTACT" : "CONTACTS", c.value === 1 ? "CONTATO" : "CONTATOS"))}`, how: L(T(`−${DR.clean.perContact} for each contact that bounced off before the capture.`, `−${DR.clean.perContact} por contato que ricocheteou antes da captura.`)) };
      default:
        return { label: c.id, value: "", how: "" };
    }
  }
  switch (c.id) {
    case "corridor":
      return { label: L(T("ENTRY CORRIDOR", "CORREDOR DE REENTRADA")), value: `${f(c.value, 2)}°`, how: L(T(`Entry angle against the ${f(TARGET_FPA, 2)}° target: full within ${RR.corridor.full}°, none at ${RR.corridor.zero}° off.`, `Ângulo de entrada contra o alvo de ${f(TARGET_FPA, 2)}°: nota máxima até ${RR.corridor.full}°, zero a ${RR.corridor.zero}° de erro.`)) };
    case "gload":
      return { label: L(T("PEAK G-LOAD", "CARGA G MÁXIMA")), value: `${f(c.value, 1)} g`, how: L(T(`Full up to ${RR.gload.full} g, none at the ${RR.gload.zero} g structural limit.`, `Nota máxima até ${RR.gload.full} g, zero no limite estrutural de ${RR.gload.zero} g.`)) };
    case "heating":
      return { label: L(T("PEAK HEATING", "AQUECIMENTO MÁXIMO")), value: `${Math.round(c.value)} W/cm²`, how: L(T(`Full up to ${RR.heating.full} W/cm², none at the shield's ${RR.heating.zero} W/cm² design rate or any overheat.`, `Nota máxima até ${RR.heating.full} W/cm², zero na taxa de projeto de ${RR.heating.zero} W/cm² ou com superaquecimento.`)) };
    case "shield":
      return { label: L(T("HEAT SHIELD USED", "ESCUDO TÉRMICO USADO")), value: `${Math.round(c.value)} %`, how: L(T(`Full up to ${RR.shield.full} % of the shield, none at ${RR.shield.zero} %.`, `Nota máxima até ${RR.shield.full} % do escudo, zero a ${RR.shield.zero} %.`)) };
    case "control":
      return { label: L(T("FLIGHT CONTROL", "CONTROLE DE VOO")), value: c.value === null ? "—" : `${Math.round(c.value * 100)} %`, how: L(T(`Hypersonic flight with the lift vector on guidance: full at ${pc(RR.control.full)}, none at ${pc(RR.control.zero)}.`, `Voo hipersônico com o vetor de sustentação na orientação: nota máxima a ${pc(RR.control.full)}, zero a ${pc(RR.control.zero)}.`)) };
    default:
      return { label: c.id, value: "", how: "" };
  }
}
export const DEDUCTION_HOW = {
  en: `−${DR.attempt.each} for each docking restart or retry, at most −${DR.attempt.max}.`,
  pt: `−${DR.attempt.each} por reinício ou nova tentativa de acoplamento, no máximo −${DR.attempt.max}.`,
};

/* ---- achievements ------------------------------------------------------------------------- */
const pctOf = (x) => `${Math.round(x * 100)} %`;
export const ACHIEVEMENT_TEXT = {
  FIRST_FOOTPRINT: { en: ["FIRST FOOTPRINT", "Complete your first safe lunar landing on an official mission."], pt: ["PRIMEIRA PEGADA", "Faça seu primeiro pouso lunar seguro em uma missão oficial."] },
  SOFT_TOUCHDOWN: {
    en: ["SOFT TOUCHDOWN", `Land safely with vertical and horizontal speeds both at or under ${pctOf(AR.softShare)} of your difficulty's limits.`],
    pt: ["TOQUE SUAVE", `Pouse com as velocidades vertical e horizontal até ${pctOf(AR.softShare)} dos limites da sua dificuldade.`],
  },
  PRECISION_PILOT: { en: ["PRECISION PILOT", `Land safely within ${AR.precisionDistance.toFixed(1)} m of the primary landing zone's centre.`], pt: ["PILOTO DE PRECISÃO", `Pouse com segurança a até ${AR.precisionDistance.toFixed(1).replace(".", ",")} m do centro da zona de pouso principal.`] },
  FUEL_MASTER: {
    en: ["FUEL MASTER", `Land safely using at most ${(1 / AR.fuelEfficiency).toFixed(2)}× the fuel of the ideal braking burn.`],
    pt: ["MESTRE DO COMBUSTÍVEL", `Pouse usando no máximo ${(1 / AR.fuelEfficiency).toFixed(2).replace(".", ",")}× o combustível da queima ideal de frenagem.`],
  },
  FIRST_CONTACT: { en: ["FIRST CONTACT", "Complete your first manual docking with the CSM."], pt: ["PRIMEIRO CONTATO", "Conclua seu primeiro acoplamento manual com o CSM."] },
  PRECISION_DOCKING: {
    en: ["PRECISION DOCKING", `Capture with the probe within ${pctOf(AR.dockLateral)} of the alignment tolerance, the axes within ${pctOf(AR.dockAngle)} of the angle tolerance, contact speed at most ${pctOf(AR.dockClosing)} of the capture window and drift at most ${pctOf(AR.dockDrift)} of its limit.`],
    pt: ["ACOPLAMENTO DE PRECISÃO", `Capture com a sonda a até ${pctOf(AR.dockLateral)} da tolerância de alinhamento, os eixos a até ${pctOf(AR.dockAngle)} da tolerância angular, velocidade de contato até ${pctOf(AR.dockClosing)} da janela de captura e deriva até ${pctOf(AR.dockDrift)} do limite.`],
  },
  FIRST_ATTEMPT_DOCKING: { en: ["FIRST-ATTEMPT DOCKING", "Dock on the first attempt: no RESTART DOCKING and no failed attempt."], pt: ["ACOPLAMENTO NA PRIMEIRA", "Acople na primeira tentativa: sem REINICIAR DOCKING e sem tentativa fracassada."] },
  RENDEZVOUS_MASTER: { en: ["RENDEZVOUS MASTER", `Score at least ${Math.round(PHASE_MAX.docking * AR.phaseMaster)} of ${PHASE_MAX.docking} for a docking.`], pt: ["MESTRE DO ENCONTRO", `Faça ao menos ${Math.round(PHASE_MAX.docking * AR.phaseMaster)} de ${PHASE_MAX.docking} pontos em um acoplamento.`] },
  WELCOME_HOME: { en: ["WELCOME HOME", "Complete an Earth reentry and splash down safely."], pt: ["BEM-VINDO DE VOLTA", "Conclua uma reentrada na Terra e amerisse com segurança."] },
  REENTRY_SPECIALIST: { en: ["REENTRY SPECIALIST", `Score at least ${Math.round(PHASE_MAX.reentry * AR.phaseMaster)} of ${PHASE_MAX.reentry} for a reentry.`], pt: ["ESPECIALISTA EM REENTRADA", `Faça ao menos ${Math.round(PHASE_MAX.reentry * AR.phaseMaster)} de ${PHASE_MAX.reentry} pontos em uma reentrada.`] },
  FOUR_DESTINATIONS: { en: ["FOUR DESTINATIONS", "Complete a successful mission at all four official destinations (any difficulty)."], pt: ["QUATRO DESTINOS", "Cumpra uma missão bem-sucedida nos quatro destinos oficiais (qualquer dificuldade)."] },
  MOUNTAIN_NAVIGATOR: { en: ["MOUNTAIN NAVIGATOR", "Complete a successful mission to Hadley–Apennine."], pt: ["NAVEGADOR DAS MONTANHAS", "Cumpra uma missão bem-sucedida a Hadley–Apeninos."] },
  CRATER_SPECIALIST: { en: ["CRATER SPECIALIST", "Complete a successful mission to the Tycho Highlands."], pt: ["ESPECIALISTA EM CRATERAS", "Cumpra uma missão bem-sucedida aos Planaltos de Tycho."] },
  SILENT_HORIZON_VETERAN: { en: ["SILENT HORIZON VETERAN", "Complete a successful mission to Silent Horizon, on the far side."], pt: ["VETERANO DO HORIZONTE SILENCIOSO", "Cumpra uma missão bem-sucedida ao Horizonte Silencioso, no lado oculto."] },
  COMMANDER_QUALIFIED: { en: ["COMMANDER QUALIFIED", "Complete a successful mission on COMMANDER."], pt: ["QUALIFICADO COMMANDER", "Cumpra uma missão bem-sucedida em COMMANDER."] },
  PERFECT_EXPEDITION: {
    en: ["PERFECT EXPEDITION", `In one successful mission, score at least ${pctOf(AR.phaseMaster)} of the points in the landing, the docking and the reentry.`],
    pt: ["EXPEDIÇÃO PERFEITA", `Em uma missão bem-sucedida, faça ao menos ${pctOf(AR.phaseMaster)} dos pontos no pouso, no acoplamento e na reentrada.`],
  },
  LUNAVIA_MASTER: { en: ["LUNAVIA MASTER", "Earn PLATINUM at all four destinations on COMMANDER."], pt: ["MESTRE LUNAVIA", "Conquiste PLATINA nos quatro destinos em COMMANDER."] },
};
export const achievementName = (id, lang) => (ACHIEVEMENT_TEXT[id][lang] || ACHIEVEMENT_TEXT[id].en)[0];
export const achievementDesc = (id, lang) => (ACHIEVEMENT_TEXT[id][lang] || ACHIEVEMENT_TEXT[id].en)[1];
const GROUP = { LANDING: { en: "LUNAR LANDING", pt: "POUSO LUNAR" }, DOCKING: { en: "ORBITAL DOCKING", pt: "ACOPLAMENTO ORBITAL" }, "EARTH RETURN": { en: "EARTH RETURN", pt: "RETORNO À TERRA" }, DESTINATIONS: { en: "DESTINATIONS", pt: "DESTINOS" }, ELITE: { en: "ELITE", pt: "ELITE" } };
export const groupName = (g, lang) => GROUP[g][lang] || GROUP[g].en;

/* ---- the recommendation --------------------------------------------------------------------- */
const COMP_SHORT = {
  vertical: T("vertical touchdown speed", "a velocidade vertical no toque"),
  horizontal: T("horizontal touchdown speed", "a velocidade horizontal no toque"),
  attitude: T("touchdown attitude", "a atitude no toque"),
  accuracy: T("touchdown accuracy", "a precisão do pouso"),
  fuel: T("descent fuel efficiency", "a eficiência de combustível na descida"),
  closing: T("docking contact speed", "a velocidade de contato no acoplamento"),
  alignment: T("docking-port alignment", "o alinhamento com a porta de acoplamento"),
  drift: T("drift at docking contact", "a deriva no contato do acoplamento"),
  angle: T("docking angular alignment", "o alinhamento angular do acoplamento"),
  roll: T("docking roll alignment", "o alinhamento de rolagem do acoplamento"),
  rate: T("rotation at docking contact", "a rotação no contato do acoplamento"),
  rcs: T("docking RCS efficiency", "a eficiência do RCS no acoplamento"),
  clean: T("a clean docking capture", "uma captura limpa no acoplamento"),
  corridor: T("the entry corridor angle", "o ângulo do corredor de reentrada"),
  gload: T("the reentry G-load", "a carga G da reentrada"),
  heating: T("reentry peak heating", "o aquecimento máximo da reentrada"),
  shield: T("heat shield use", "o uso do escudo térmico"),
  control: T("reentry lift-vector control", "o controle do vetor de sustentação na reentrada"),
};

/** The recommendation (missionScoring recommendation) in words. */
export function recommendationText(r, lang) {
  const pt = lang === "pt";
  const m = (x) => medalName(x, lang);
  switch (r.id) {
    case "gate-landing":
      return pt ? "Primeiro, pouse com segurança: mantenha as velocidades e a inclinação dentro dos limites até o toque." : "First, land safely: keep the speeds and the tilt inside their limits down to touchdown.";
    case "gate-docking":
      return pt ? "Conclua o acoplamento: o REINICIAR DOCKING está sempre disponível para treinar a aproximação." : "Complete the docking: RESTART DOCKING is always there to practise the approach.";
    case "gate-reentry":
      return pt ? "Sobreviva à reentrada: ajuste o ângulo de entrada para −6,50° no ENTRY PREP e siga a orientação de sustentação." : "Survive the reentry: trim the entry angle to −6.50° in ENTRY PREP and follow the lift guidance.";
    case "gate-survival":
      return pt ? "Para uma medalha, a cápsula precisa amerissar na primeira reentrada." : "For a medal, the capsule has to splash down on its first entry.";
    case "next-attempts":
      return pt ? `Acople sem reiniciar para chegar a ${m(r.medal)}: os reinícios custaram ${r.lost} pontos e faltam ${r.need}.` : `Dock without restarting to earn ${m(r.medal)}: restarts cost ${r.lost} points, and ${r.need} more earn it.`;
    case "next-component": {
      const what = (COMP_SHORT[r.component] || T(r.component, r.component))[pt ? "pt" : "en"];
      return pt ? `Melhore ${what} para chegar a ${m(r.medal)}: custou ${r.lost} pontos, e faltam ${r.need}.` : `Improve ${what} to earn ${m(r.medal)}: it cost ${r.lost} points, and ${r.need} more earn it.`;
    }
    case "commander":
      return pt ? `Voe ${siteName(r.siteId, lang)} em COMMANDER para disputar a PLATINA.` : `Fly ${siteName(r.siteId, lang)} on COMMANDER to compete for PLATINUM.`;
    case "platinum-at":
      return pt ? `Conquiste PLATINA em ${siteName(r.siteId, lang)} em COMMANDER (${r.done}/4 para MESTRE LUNAVIA).` : `Earn PLATINUM at ${siteName(r.siteId, lang)} on COMMANDER (${r.done}/4 for LUNAVIA MASTER).`;
    case "phase-best":
      return pt ? `Sua melhor nota de ${phaseName(r.phase, lang).toLowerCase()} aqui é ${r.best}/${r.max}: é a fase com mais margem.` : `Your best ${phaseName(r.phase, lang).toLowerCase()} score here is ${r.best}/${r.max}: the phase with the most room left.`;
    default:
      return "";
  }
}
