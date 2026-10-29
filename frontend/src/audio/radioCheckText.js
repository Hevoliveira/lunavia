/*
 * TEST RADIO's result (comms.radioCheck) in the player's words, EN / PT.
 */
export function radioCheckMessage(r, lang = "en") {
  const pt = lang === "pt";
  if (!r) return null;
  if (r.voiced) return { ok: true, text: pt ? "RÁDIO OK · HOUSTON TRANSMITIU PELO ÁUDIO DO JOGO" : "RADIO OK · HOUSTON PLAYED THROUGH THE GAME AUDIO" };
  if (r.reason === "voice-off") return { ok: false, text: pt ? "A VOZ DO CONTROLE DA MISSÃO ESTÁ DESLIGADA" : "MISSION CONTROL VOICE IS OFF" };
  if (/^context-/.test(r.reason) || r.reason === "no-gesture-yet")
    return { ok: false, text: pt ? "O APARELHO NÃO LIBEROU O ÁUDIO · TOQUE DE NOVO; CONFIRA O VOLUME E O MODO SILENCIOSO" : "THE DEVICE DID NOT START AUDIO · TAP AGAIN; CHECK THE VOLUME AND SILENT MODE" };
  if (r.reason === "clip-missing" || r.reason === "pack-unavailable") return { ok: false, text: pt ? "GRAVAÇÃO NÃO ENCONTRADA NO APLICATIVO" : "RECORDING NOT FOUND IN THE APP" };
  return { ok: false, text: pt ? "SEM TRANSMISSÃO" : "NO TRANSMISSION" };
}

