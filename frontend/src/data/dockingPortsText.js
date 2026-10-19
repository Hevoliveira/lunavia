/*
 * LUNAVIA — the docking-port displays' words, English and Brazilian Portuguese
 * (by the subtitle language, like the rest of the docking UI).
 */
const DEG = 180 / Math.PI;

export const PORT_TEXT = {
  en: {
    target: "TARGET DOCKING PORT",
    targetShort: "TARGET PORT",
    active: "ACTIVE PORT · YOUR DROGUE",
    activeShort: "YOUR PORT",
    hidden: "HIDDEN",
    outWindow: "OUT OF WINDOW VIEW",
    offscreen: "TARGET PORT",
    focus: "FOCUS DOCKING PORTS",
    reset: "RESET CAMERA",
    readyHead: "FINAL APPROACH · CAPTURE CONDITIONS",
    proceed: "PROCEED WITH FINAL APPROACH",
    inside: "INSIDE CORRIDOR",
    outside: "OUTSIDE CORRIDOR",
    portDist: "PORT–PORT",
    closing: "CLOSING",
    offLR: "OFFSET R/L",
    offUD: "OFFSET U/D",
    drift: "DRIFT",
    angle: "PORT ANGLE",
    att: "ATT P/Y/R",
    legend: "● YOUR PORT ±1 m · + ATTITUDE ±10°",
  },
  pt: {
    target: "PORTA DE DOCKING ALVO",
    targetShort: "PORTA ALVO",
    active: "PORTA ATIVA · SEU DROGUE",
    activeShort: "SUA PORTA",
    hidden: "OCULTA",
    outWindow: "FORA DA JANELA",
    offscreen: "PORTA ALVO",
    focus: "FOCAR PORTAS DE DOCKING",
    reset: "CENTRALIZAR CÂMERA",
    readyHead: "APROXIMAÇÃO FINAL · CONDIÇÕES DE CAPTURA",
    proceed: "PROSSIGA COM A APROXIMAÇÃO FINAL",
    inside: "NO CORREDOR",
    outside: "FORA DO CORREDOR",
    portDist: "PORTA–PORTA",
    closing: "APROXIM.",
    offLR: "DESVIO D/E",
    offUD: "DESVIO C/B",
    drift: "DERIVA",
    angle: "ÂNGULO",
    att: "ATIT A/G/R",
    legend: "● SUA PORTA ±1 m · + ATITUDE ±10°",
  },
};

const STATUS = {
  acquired: ["TARGET ACQUIRED", "ALVO ADQUIRIDO"],
  alignPorts: ["ALIGN DOCKING PORTS", "ALINHE AS PORTAS DE DOCKING"],
  lateral: ["CORRECT LATERAL OFFSET", "CORRIJA O DESVIO LATERAL"],
  attitude: ["CORRECT ATTITUDE", "CORRIJA A ATITUDE"],
  aligned: ["APPROACH CORRIDOR ALIGNED", "CORREDOR DE APROXIMAÇÃO ALINHADO"],
  reduce: ["REDUCE CLOSING VELOCITY", "REDUZA A VELOCIDADE DE APROXIMAÇÃO"],
  authorized: ["FINAL APPROACH AUTHORIZED", "APROXIMAÇÃO FINAL AUTORIZADA"],
  contact: ["DOCKING CONTACT", "CONTATO DE DOCKING"],
  hardDock: ["HARD DOCK CONFIRMED", "ACOPLAMENTO FIRME CONFIRMADO"],
  failed: ["DOCKING FAILED", "DOCKING FALHOU"],
};
const UNSAFE = {
  facing: ["UNSAFE APPROACH — DROGUE NOT FACING THE PROBE", "APROXIMAÇÃO INSEGURA — DROGUE NÃO APONTA PARA A SONDA"],
  behind: ["UNSAFE APPROACH — BESIDE THE PROBE, BACK OUT", "APROXIMAÇÃO INSEGURA — AO LADO DA SONDA, RECUE"],
  miss: ["UNSAFE APPROACH — DRIFTING OUTSIDE THE DROGUE", "APROXIMAÇÃO INSEGURA — DERIVANDO PARA FORA DO DROGUE"],
};
export const STATUS_SEV = { acquired: "info", alignPorts: "correct", lateral: "correct", attitude: "correct", aligned: "go", reduce: "safety", authorized: "ok", unsafe: "safety", contact: "ok", hardDock: "ok", failed: "safety" };

/** The approach status line (dockingPorts.approachStatus). */
export function statusText(st, lang = "en") {
  if (!st) return "";
  const i = lang === "pt" ? 1 : 0;
  if (st.key === "unsafe") return (UNSAFE[st.unsafe] || UNSAFE.miss)[i];
  return (STATUS[st.key] || ["", ""])[i];
}

/** The final-approach checklist (dockingPorts.captureReadiness): label, state word, ok. */
export function readinessRows(r, lang = "en") {
  if (!r) return [];
  const pt = lang === "pt";
  const it = r.items;
  const dg = (v) => `${(Math.abs(v) * DEG).toFixed(1)}°`;
  const angleWorst = it.align.angle / it.align.limit >= Math.abs(it.align.roll) / it.align.rollLimit;
  return [
    {
      id: "align",
      label: pt ? "ALINHAMENTO DAS PORTAS" : "PORT ALIGNMENT",
      ok: it.align.ok,
      value: it.align.ok ? (pt ? "BOM" : "GOOD") : angleWorst ? `${dg(it.align.angle)} > ${dg(it.align.limit)}` : `${pt ? "ROL" : "ROLL"} ${dg(it.align.roll)} > ${dg(it.align.rollLimit)}`,
    },
    { id: "offset", label: pt ? "DESVIO LATERAL" : "LATERAL OFFSET", ok: it.offset.ok, value: it.offset.ok ? (pt ? "CENTRADO" : "CENTRED") : `${it.offset.value.toFixed(2)} > ${it.offset.limit.toFixed(2)} m` },
    { id: "drift", label: pt ? "DERIVA LATERAL" : "LATERAL DRIFT", ok: it.drift.ok, value: it.drift.ok ? (pt ? "BAIXA" : "LOW") : `${it.drift.value.toFixed(3)} > ${it.drift.limit.toFixed(3)}` },
    {
      id: "closing",
      label: pt ? "VELOCIDADE DE APROXIMAÇÃO" : "CLOSING VELOCITY",
      ok: it.closing.ok,
      value: it.closing.ok ? (pt ? "SEGURA" : "SAFE") : it.closing.high ? `${pt ? "ALTA" : "HIGH"} ${it.closing.value.toFixed(3)}` : `${pt ? "LENTA" : "SLOW"} ${it.closing.value.toFixed(3)}`,
    },
    { id: "rate", label: pt ? "ROTAÇÃO" : "ROTATION", ok: it.rate.ok, value: it.rate.ok ? (pt ? "ESTÁVEL" : "STABLE") : `${dg(it.rate.value)}/s` },
    { id: "corridor", label: pt ? "CORREDOR DE DOCKING" : "DOCKING CORRIDOR", ok: it.corridor.ok, value: it.corridor.ok ? (pt ? "ALINHADO" : "ALIGNED") : pt ? "FORA" : "OUTSIDE" },
  ];
}
