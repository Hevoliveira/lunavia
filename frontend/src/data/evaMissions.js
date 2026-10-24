/*
 * LUNAVIA — the four lunar EVA expeditions (pure; unit-tested).
 *
 * One EVA engine (data/evaSim: walking, collisions, the LM's hatch and ladder; components/eva:
 * the astronaut, the camera, the HUD) and one configuration per destination: the objective
 * sequence, the sample types, the survey, the instrument, the photo subject, the exploration
 * bounds, the communications and the briefing. Nothing here duplicates the EVA.
 *
 *   SEA OF TRANQUILITY  first steps · one sample · photograph the LM (the approved phase 1 EVA,
 *                       unchanged: same objectives, places, record and voice)
 *   HADLEY–APENNINE     geological survey · two samples · Mons Hadley photo · seismometer
 *   TYCHO HIGHLANDS     impact material · two samples · crater photo from the rim · gnomon
 *   SILENT HORIZON      sample · LF radio antenna · far-side landscape photo · confirm the data
 *                       (no Earth link: the onboard computer, never Houston)
 *
 * Placement (planEva): every target is placed relative to the lunar module where it actually
 * landed (data/evaSim evaWorld: the saved landing pose), on the site's own terrain, rocks and
 * craters, in a fixed order of candidates, so the same landing always gives the same plan (save
 * and resume). A candidate is accepted only on gentle ground, clear of the LM, its legs and the
 * boulders, inside the exploration bounds, apart from the other targets and with a walkable route
 * from the foot of the ladder (straight, or round the LM and the boulders). A target whose
 * anchors (a real boulder, crater or melt pond within reach) all fail falls back to open ground
 * round the LM and is flagged `fallback`; the destination itself never changes.
 *
 * Units: metres, as data/evaSim.
 */
import { AREA, SUIT, photoCheck as lmPhotoCheck, slopeAt } from "./evaSim";

const DEG = Math.PI / 180;
const T = (en, pt) => ({ en, pt });
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/* ---- timings and reach (shared by every destination) ----------------------------------------- */
export const REACH = { sample: 1.5, survey: 2.0, instrument: 1.7, data: 2.0, board: 1.6 }; // m
export const SURVEY_TIME = 3.6; // s, the close look at the formation
export const DEPLOY_TIME = 6.2; // s, setting the instrument down and unfolding it
export const DATA_TIME = 24; // s after the deployment before the receiver's first data block is stored
export const PHOTO_STAND_R = 3.2; // m, how close to the observation point a landscape photo counts
const PHOTO_CENTRE = 0.35; // of the half frame, for the subject's centre

/* ---- the four expeditions ---------------------------------------------------------------------- */
/**
 * Each destination: its objectives in order (`kind` firstSteps | survey | sample | photo |
 * instrument | data; the return to the LM always closes the list), the samples and where to look
 * for them (`anchors`, tried in order), the survey, the instrument, the photo subject, the
 * exploration bounds, the voice lines and every on-screen text (EN/PT).
 */
export const EVA_MISSIONS = Object.freeze({
  tranquillitatis: {
    id: "tranquillitatis",
    area: AREA,
    comms: { earthLink: true },
    objectives: [
      { id: "firstSteps", kind: "firstSteps" },
      { id: "sample", kind: "sample" },
      { id: "photo", kind: "photo" },
    ],
    // phase 1's own places (data/evaSim evaWorld: the sample stone and the photo stand)
    samples: [{ id: "TQ-01", type: "mare", legacy: true }],
    photo: { subject: { id: "LM", kind: "lm" }, legacy: true },
    voice: {
      authorized: "eva.authorized",
      firstSteps: "eva.firstStepsCapcom",
      go: { sample: "eva.goSample", photo: "eva.goPhoto" },
      done: { sample: "eva.sampleDone", photo: "eva.photoDone" },
      returnLM: "eva.returnLM",
      complete: "eva.complete",
      boundary: "eva.boundary",
      remind: "eva.remind",
    },
    text: {
      en: {
        title: "EVA · SEA OF TRANQUILITY",
        expedition: "FIRST STEPS ON THE MOON",
        ascentSub: "OPTIONAL · FIRST STEPS ON THE MOON",
        banner: "SEA OF TRANQUILITY",
        objectives: { firstSteps: "FIRST STEPS", sample: "COLLECT LUNAR SAMPLE", photo: "DOCUMENT THE LANDING SITE" },
        briefing: "Leave the LM, collect the marked sample and photograph the landing site.",
        samples: { "TQ-01": "MARE REGOLITH" },
        subject: "THE LUNAR MODULE",
      },
      pt: {
        title: "EVA · MAR DA TRANQUILIDADE",
        expedition: "PRIMEIROS PASSOS NA LUA",
        ascentSub: "OPCIONAL · PRIMEIROS PASSOS NA LUA",
        banner: "MAR DA TRANQUILIDADE",
        objectives: { firstSteps: "PRIMEIROS PASSOS", sample: "COLETAR AMOSTRA LUNAR", photo: "DOCUMENTAR O LOCAL DE POUSO" },
        briefing: "Saia do LM, colete a amostra marcada e fotografe o local de pouso.",
        samples: { "TQ-01": "REGOLITO DE MAR" },
        subject: "O MÓDULO LUNAR",
      },
    },
  },

  hadley: {
    id: "hadley",
    // the valley floor is wide and gentle: the rille-edge boulders ~30 m out are in reach (the
    // rille itself, 50 m and more away, is not)
    area: { warn: 32, limit: 38, zMax: 32 },
    comms: { earthLink: true },
    objectives: [
      { id: "firstSteps", kind: "firstSteps" },
      { id: "survey", kind: "survey" },
      { id: "samples", kind: "sample" },
      { id: "photo", kind: "photo" },
      { id: "instrument", kind: "instrument" },
    ],
    survey: { anchors: [{ near: "boulder", gap: 1.5 }, { near: "crater", gap: 1.6, minR: 2.5 }, { ring: [10, 14, 18] }] },
    samples: [
      // a fragment broken off a basalt boulder; a breccia from a small crater's rim
      { id: "HA-01", type: "basalt", anchors: [{ near: "boulder", gap: 0.75 }, { ring: [9, 12, 15] }] },
      { id: "HA-02", type: "breccia", anchors: [{ near: "crater", gap: 1.0, minR: 2.5 }, { ring: [8, 11, 14] }] },
    ],
    photo: {
      subject: { id: "MONS-HADLEY", kind: "landmark", x: 160, z: -330 },
      anchors: [{ toward: [13, 16, 19] }, { ring: [12, 15, 18] }],
    },
    instrument: { id: "PSE", kind: "seismometer", clear: 1.6, flat: 1.1, anchors: [{ ring: [11, 14, 17], bearing: "behind" }] },
    voice: {
      authorized: "eva.ha.authorized",
      firstSteps: "eva.ha.firstSteps",
      go: { survey: "eva.ha.goSurvey", samples: "eva.ha.goSamples", photo: "eva.ha.goPhoto", instrument: "eva.ha.goInstrument" },
      done: { survey: "eva.ha.surveyDone", samples: "eva.samplesDone", photo: "eva.photoTaken", instrument: "eva.ha.instrumentDone" },
      sampleOne: "eva.sampleOne",
      goSecond: "eva.goSecond",
      returnLM: "eva.returnLM",
      complete: "eva.complete",
      boundary: "eva.boundary",
      remind: "eva.remind",
    },
    text: {
      en: {
        title: "EVA · HADLEY–APENNINE",
        expedition: "GEOLOGICAL EXPEDITION",
        ascentSub: "OPTIONAL · GEOLOGICAL EXPEDITION",
        banner: "HADLEY–APENNINE",
        objectives: { firstSteps: "SURFACE DEPLOYMENT", survey: "GEOLOGICAL SURVEY", samples: "COLLECT TWO SAMPLES", photo: "DOCUMENT THE VALLEY", instrument: "DEPLOY THE SEISMOMETER" },
        briefing: "Survey the marked rock, collect two samples, photograph Mons Hadley across the valley and set up the seismometer.",
        samples: { "HA-01": "MARE BASALT", "HA-02": "REGOLITH BRECCIA" },
        subject: "MONS HADLEY",
        survey: {
          boulder: ["VESICULAR MARE BASALT", "Dark lava rock pitted with vesicles: gas bubbles frozen as the lava cooled. Lava flows like this flooded the Hadley valley floor more than three billion years ago. Hadley Rille, beyond these boulders, is thought to be a channel cut by flowing lava."],
          crater: ["SMALL IMPACT CRATER", "A young crater in the valley floor. Its rim is built of material thrown out of the hole: broken rock and dust (regolith) from the lava flows beneath, churned by billions of years of small impacts."],
          regolith: ["VALLEY-FLOOR REGOLITH", "The fine grey soil of the valley floor: lava rock broken and churned by billions of years of small impacts. Fragments of the Apennine mountains lie mixed into it."],
        },
        instrument: ["PASSIVE SEISMOMETER", "Set level on the regolith and shaded by its thermal skirt, the seismometer listens for moonquakes and meteorite impacts. Apollo seismometers helped reveal the Moon's layered interior."],
      },
      pt: {
        title: "EVA · HADLEY–APENINOS",
        expedition: "EXPEDIÇÃO GEOLÓGICA",
        ascentSub: "OPCIONAL · EXPEDIÇÃO GEOLÓGICA",
        banner: "HADLEY–APENINOS",
        objectives: { firstSteps: "DESCIDA À SUPERFÍCIE", survey: "LEVANTAMENTO GEOLÓGICO", samples: "COLETAR DUAS AMOSTRAS", photo: "DOCUMENTAR O VALE", instrument: "INSTALAR O SISMÔMETRO" },
        briefing: "Estude a rocha marcada, colete duas amostras, fotografe o Mons Hadley do outro lado do vale e instale o sismômetro.",
        samples: { "HA-01": "BASALTO DE MAR", "HA-02": "BRECHA DE REGOLITO" },
        subject: "MONS HADLEY",
        survey: {
          boulder: ["BASALTO DE MAR VESICULAR", "Rocha vulcânica escura, crivada de vesículas: bolhas de gás congeladas quando a lava esfriou. Derrames como este inundaram o fundo do vale de Hadley há mais de três bilhões de anos. A Fenda de Hadley, além destes blocos, é provavelmente um canal escavado por lava."],
          crater: ["PEQUENA CRATERA DE IMPACTO", "Uma cratera jovem no fundo do vale. Sua borda é feita do material lançado para fora: rocha fragmentada e poeira (regolito) dos derrames de lava abaixo, revolvidos por bilhões de anos de pequenos impactos."],
          regolith: ["REGOLITO DO FUNDO DO VALE", "O solo cinza e fino do fundo do vale: rocha vulcânica fragmentada e revolvida por bilhões de anos de pequenos impactos. Fragmentos das montanhas Apeninos estão misturados a ele."],
        },
        instrument: ["SISMÔMETRO PASSIVO", "Nivelado sobre o regolito e protegido por sua saia térmica, o sismômetro escuta tremores lunares e impactos de meteoritos. Os sismômetros Apollo ajudaram a revelar o interior em camadas da Lua."],
      },
    },
  },

  tycho: {
    id: "tycho",
    area: AREA,
    comms: { earthLink: true },
    objectives: [
      { id: "firstSteps", kind: "firstSteps" },
      { id: "survey", kind: "survey" },
      { id: "samples", kind: "sample" },
      { id: "photo", kind: "photo" },
      { id: "instrument", kind: "instrument" },
    ],
    // the ejecta blocks round the fresh craters first, then any block, a crater rim, open ground
    survey: { anchors: [{ near: "boulder", gap: 1.5, label: /CRATER/ }, { near: "boulder", gap: 1.5 }, { near: "crater", gap: 1.8, minR: 2.2 }, { ring: [9, 12, 15] }] },
    samples: [
      // dark glassy melt from the pond the LM stands on; angular ejecta from a fresh crater's blocks
      { id: "TY-01", type: "melt", anchors: [{ pond: [7, 8.5, 10, 11.5] }, { ring: [7, 9, 11] }] },
      { id: "TY-02", type: "ejecta", anchors: [{ near: "boulder", gap: 0.75, label: /CRATER/ }, { near: "boulder", gap: 0.75 }, { ring: [10, 13, 16] }] },
    ],
    photo: {
      // the crater documented from its rim, outside it: never down its wall
      subject: { id: "CRATER", kind: "crater", minR: 4 },
      anchors: [{ near: "crater", gap: 2.2, minR: 4 }, { near: "crater", gap: 2.0, minR: 2.2 }],
      fallbackSubject: { id: "CRATER", kind: "horizon", az: 95, el: 7.5, label: "CENTRAL PEAK" },
    },
    instrument: { id: "GNOMON", kind: "gnomon", clear: 1.0, flat: 0.5, slope: 14, anchors: [{ nearTarget: "survey", r: [2.6, 3.4] }, { ring: [9, 12, 15] }] },
    voice: {
      authorized: "eva.ty.authorized",
      firstSteps: "eva.ty.firstSteps",
      go: { survey: "eva.ty.goSurvey", samples: "eva.ty.goSamples", photo: "eva.ty.goPhoto", instrument: "eva.ty.goInstrument" },
      done: { survey: "eva.ty.surveyDone", samples: "eva.samplesDone", photo: "eva.photoTaken", instrument: "eva.ty.instrumentDone" },
      sampleOne: "eva.sampleOne",
      goSecond: "eva.goSecond",
      returnLM: "eva.returnLM",
      complete: "eva.complete",
      boundary: "eva.boundary",
      remind: "eva.remind",
    },
    text: {
      en: {
        title: "EVA · TYCHO HIGHLANDS",
        expedition: "IMPACT GEOLOGY INVESTIGATION",
        ascentSub: "OPTIONAL · IMPACT GEOLOGY",
        banner: "TYCHO HIGHLANDS",
        objectives: { firstSteps: "EXIT AND SURVEY", survey: "IDENTIFY IMPACT MATERIAL", samples: "COLLECT TWO SAMPLES", photo: "DOCUMENT THE CRATER", instrument: "PLACE THE GNOMON" },
        briefing: "Identify the impact material, sample the melt and the ejecta, photograph the crater from its rim and set the gnomon. Stay out of the crater.",
        samples: { "TY-01": "IMPACT MELT", "TY-02": "EJECTA BRECCIA" },
        subject: "THE CRATER",
        subjectFallback: "TYCHO'S CENTRAL PEAK",
        survey: {
          boulder: ["IMPACT MELT AND EJECTA", "This block was thrown out when a fresh crater formed. Its angular fragments are cemented by dark, glassy impact melt: rock melted by the shock of the impact. Tycho itself is one of the youngest large craters on the Moon, roughly a hundred million years old."],
          crater: ["FRESH IMPACT CRATER", "A young crater punched into Tycho's ejecta. Its raised rim is the overturned flap of rock thrown out of the hole; the freshest craters still show sharp rims and a halo of blocks."],
          regolith: ["EJECTA BLANKET", "The ground here is Tycho's ejecta: rock shattered and thrown out by the impact, splashed with glassy melt. It is still rough and blocky, because it is young."],
        },
        instrument: ["GNOMON", "A weighted rod on a gimbal hangs true vertical: its shadow gives the Sun's direction, and its colour chart and scale calibrate the photographs of the impact material."],
      },
      pt: {
        title: "EVA · PLANALTOS DE TYCHO",
        expedition: "INVESTIGAÇÃO DE GEOLOGIA DE IMPACTO",
        ascentSub: "OPCIONAL · GEOLOGIA DE IMPACTO",
        banner: "PLANALTOS DE TYCHO",
        objectives: { firstSteps: "SAIR E RECONHECER", survey: "IDENTIFICAR MATERIAL DE IMPACTO", samples: "COLETAR DUAS AMOSTRAS", photo: "DOCUMENTAR A CRATERA", instrument: "POSICIONAR O GNÔMON" },
        briefing: "Identifique o material de impacto, colete o derretido e o material ejetado, fotografe a cratera da borda e posicione o gnômon. Não desça na cratera.",
        samples: { "TY-01": "DERRETIDO DE IMPACTO", "TY-02": "BRECHA DE EJETA" },
        subject: "A CRATERA",
        subjectFallback: "O PICO CENTRAL DE TYCHO",
        survey: {
          boulder: ["DERRETIDO DE IMPACTO E EJETA", "Este bloco foi lançado quando uma cratera recente se formou. Seus fragmentos angulosos estão cimentados por derretido de impacto escuro e vítreo: rocha fundida pelo choque do impacto. A própria Tycho é uma das crateras grandes mais jovens da Lua, com cerca de cem milhões de anos."],
          crater: ["CRATERA DE IMPACTO RECENTE", "Uma cratera jovem aberta no material ejetado de Tycho. Sua borda elevada é a camada de rocha virada para fora do buraco; as crateras mais recentes ainda mostram bordas nítidas e um halo de blocos."],
          regolith: ["MANTO DE EJETA", "O solo aqui é o material ejetado de Tycho: rocha estilhaçada e lançada pelo impacto, salpicada de derretido vítreo. Ainda é áspero e cheio de blocos, porque é jovem."],
        },
        instrument: ["GNÔMON", "Uma haste com peso, num cardã, fica na vertical exata: sua sombra mostra a direção do Sol, e sua tabela de cores e escala calibram as fotografias do material de impacto."],
      },
    },
  },

  "far-side": {
    id: "far-side",
    area: AREA,
    // no line of sight to the Earth: the onboard computer gives the procedures; the crew's own
    // suit-to-suit radio still works
    comms: { earthLink: false },
    objectives: [
      { id: "firstSteps", kind: "firstSteps" },
      { id: "sample", kind: "sample" },
      { id: "instrument", kind: "instrument" },
      { id: "photo", kind: "photo" },
      { id: "data", kind: "data", after: "instrument" },
    ],
    samples: [{ id: "FS-01", type: "basin", anchors: [{ near: "boulder", gap: 0.75 }, { near: "crater", gap: 1.0, minR: 2.2 }, { ring: [8, 11, 14] }] }],
    photo: {
      subject: { id: "BASIN-RING", kind: "landmark", x: 90, z: 280 },
      anchors: [{ toward: [12, 15, 18] }, { ring: [12, 15, 18] }],
    },
    // the antenna's four elements span 5 m: open, level ground
    instrument: { id: "LFRA", kind: "antenna", clear: 3.2, flat: 2.7, anchors: [{ ring: [12, 15, 18], bearing: "behind" }, { ring: [10, 13, 16, 19] }] },
    voice: {
      authorized: "eva.fs.authorized",
      firstSteps: "eva.fs.firstSteps",
      go: { sample: "eva.fs.goSample", instrument: "eva.fs.goInstrument", photo: "eva.fs.goPhoto", data: "eva.fs.goData" },
      done: { sample: "eva.sampleDone", instrument: "eva.fs.instrumentDone", photo: "eva.photoTaken", data: "eva.fs.dataDone" },
      returnLM: "eva.fs.returnLM",
      complete: "eva.fs.complete",
      boundary: "eva.fs.boundary",
      remind: "eva.fs.remind",
    },
    text: {
      en: {
        title: "EVA · SILENT HORIZON",
        expedition: "FAR-SIDE SCIENTIFIC EXPEDITION",
        ascentSub: "OPTIONAL · FAR-SIDE SCIENCE",
        banner: "SILENT HORIZON · FAR SIDE",
        objectives: { firstSteps: "BEGIN FAR-SIDE EVA", sample: "COLLECT A SAMPLE", instrument: "DEPLOY THE RADIO ANTENNA", photo: "DOCUMENT THE FAR SIDE", data: "CONFIRM THE SCIENCE DATA" },
        briefing: "No Earth link: procedures from the onboard computer. Collect a sample, deploy the low-frequency radio antenna, photograph the basin ring and confirm the receiver's data.",
        samples: { "FS-01": "BASIN-FLOOR ROCK" },
        subject: "THE BASIN RING",
        instrument: ["LOW-FREQUENCY RADIO ANTENNA", "Here the Moon itself stands between the antenna and the Earth, shielding it from terrestrial radio interference. That makes the far side one of the quietest places in reach for listening to the low-frequency radio sky. With no line of sight to the Earth, the data are stored onboard for a later relay."],
      },
      pt: {
        title: "EVA · HORIZONTE SILENCIOSO",
        expedition: "EXPEDIÇÃO CIENTÍFICA NO LADO OCULTO",
        ascentSub: "OPCIONAL · CIÊNCIA NO LADO OCULTO",
        banner: "HORIZONTE SILENCIOSO · LADO OCULTO",
        objectives: { firstSteps: "INICIAR EVA NO LADO OCULTO", sample: "COLETAR UMA AMOSTRA", instrument: "INSTALAR A ANTENA DE RÁDIO", photo: "DOCUMENTAR O LADO OCULTO", data: "CONFIRMAR OS DADOS CIENTÍFICOS" },
        briefing: "Sem enlace com a Terra: procedimentos pelo computador de bordo. Colete uma amostra, instale a antena de rádio de baixa frequência, fotografe o anel da bacia e confirme os dados do receptor.",
        samples: { "FS-01": "ROCHA DO FUNDO DA BACIA" },
        subject: "O ANEL DA BACIA",
        instrument: ["ANTENA DE RÁDIO DE BAIXA FREQUÊNCIA", "Aqui a própria Lua fica entre a antena e a Terra, protegendo-a da interferência de rádio terrestre. Isso faz do lado oculto um dos lugares mais silenciosos ao nosso alcance para escutar o céu de rádio de baixa frequência. Sem linha de visada com a Terra, os dados ficam guardados a bordo para retransmissão posterior."],
      },
    },
  },
});

export const EVA_SITE_IDS = Object.keys(EVA_MISSIONS);
/** The expedition at a destination, or null (never another destination's). */
export const evaMission = (siteId) => EVA_MISSIONS[siteId] || null;
export const evaMissionText = (cfg, lang) => (cfg ? cfg.text[lang === "pt" ? "pt" : "en"] : null);

/** The objective ids in order, the return to the LM last. */
export const objectiveIds = (cfg) => [...cfg.objectives.map((o) => o.id), "return"];
const objectiveOf = (cfg, kind) => cfg.objectives.find((o) => o.kind === kind) || null;
export const sampleIds = (cfg) => (cfg.samples || []).map((s) => s.id);

/** A fresh EVA record for a destination (what the mission saves when the EVA begins). */
export function freshEva(siteId) {
  const cfg = evaMission(siteId);
  if (!cfg) return null;
  const progress = {};
  cfg.objectives.forEach((o) => (progress[o.id] = false));
  const e = { progress, samples: [], photos: [], completed: false, distance: 0 };
  if (cfg.instrument) e.instruments = [];
  return e;
}

/** Progress for this destination, clean, from anything (unknown keys dropped). */
export function cleanProgressFor(cfg, p) {
  const o = isObj(p) ? p : {};
  const out = {};
  cfg.objectives.forEach((x) => (out[x.id] = o[x.id] === true));
  return out;
}

/** The current objective: the first one not done, in order; "return" when all are. */
export function nextObjective(cfg, progress) {
  const o = cfg.objectives.find((x) => !progress[x.id]);
  return o ? o.id : "return";
}

/** How much of the expedition a record holds: { total, done, complete } (the return not counted). */
export function evaSummary(siteId, eva) {
  const cfg = evaMission(siteId);
  if (!cfg || !isObj(eva) || !isObj(eva.progress)) return { total: cfg ? cfg.objectives.length : 0, done: 0, complete: false };
  const done = cfg.objectives.filter((o) => eva.progress[o.id] === true).length;
  return { total: cfg.objectives.length, done, complete: done === cfg.objectives.length && eva.completed === true };
}

/**
 * A saved EVA record checked against its destination (lib/missionSave): only that destination's
 * objectives, samples, photo subject and instrument, consistent with one another. Returns a clean
 * copy or null. The Sea of Tranquility's record is exactly phase 1's.
 */
export function validateEvaRecord(siteId, e) {
  const cfg = evaMission(siteId);
  if (!cfg || !isObj(e) || !isObj(e.progress)) return null;
  const p = cleanProgressFor(cfg, e.progress);
  const samples = Array.isArray(e.samples) ? e.samples : [];
  const photos = Array.isArray(e.photos) ? e.photos : [];
  const instruments = Array.isArray(e.instruments) ? e.instruments : [];
  const ids = sampleIds(cfg);
  if (samples.length > ids.length || photos.length > 8 || instruments.length > (cfg.instrument ? 1 : 0)) return null;
  if (!samples.every((x) => isObj(x) && typeof x.id === "string" && ids.includes(x.id) && fin(x.x) && fin(x.z))) return null;
  if (new Set(samples.map((x) => x.id)).size !== samples.length) return null;
  const subject = cfg.photo.subject.id;
  if (!photos.every((x) => isObj(x) && x.subject === subject && fin(x.distance) && x.distance >= 0 && x.distance <= 5000)) return null;
  if (cfg.instrument && !instruments.every((x) => isObj(x) && x.id === cfg.instrument.id && fin(x.x) && fin(x.z))) return null;
  const so = objectiveOf(cfg, "sample");
  const po = objectiveOf(cfg, "photo");
  const io = objectiveOf(cfg, "instrument");
  const dob = objectiveOf(cfg, "data");
  if (so && p[so.id] !== (samples.length === ids.length)) return null;
  if (po && p[po.id] !== photos.length > 0) return null;
  if (io && p[io.id] !== instruments.length > 0) return null;
  if (dob && p[dob.id] && !p[io.id]) return null;
  const any = cfg.objectives.some((o) => o.kind !== "firstSteps" && p[o.id]) || samples.length > 0;
  if ((any || e.completed === true) && !p.firstSteps) return null;
  const out = {
    progress: p,
    samples: samples.map((x) => ({ id: x.id, x: x.x, z: x.z })),
    photos: photos.map((x) => ({ subject, distance: x.distance })),
    completed: e.completed === true,
    distance: fin(e.distance) && e.distance >= 0 && e.distance < 1e5 ? e.distance : 0,
  };
  if (cfg.instrument) out.instruments = instruments.map((x) => ({ id: x.id, x: x.x, z: x.z }));
  return out;
}

/* ---- placement --------------------------------------------------------------------------------- */
const SLOPE = { sample: 14, stand: 16, instrument: 8, node: 22 }; // deg at the spot
const ROUTE_SLOPE = 24; // deg: no stretch of a route steeper than this (the suit stops at 30)
const MIN_LM = 6.5; // m from the LM's axis: nothing under or against the LM
const SEP = 4.5; // m between two targets
const MAX_ROUTE = 70; // m of walking to any target from the ladder

function context(world, cfg) {
  const { lm, cols, ground, site } = world;
  const [ax, az] = lm.axis;
  const area = cfg.area || AREA;
  const ox = lm.board[0] - ax;
  const oz = lm.board[2] - az;
  const ol = Math.hypot(ox, oz) || 1;
  const out = [ox / ol, oz / ol];
  const start = [lm.board[0] + out[0] * 1.6, lm.board[2] + out[1] * 1.6];
  const c = { world, site, lm, cols, ground, ax, az, area, place: area.warn - 2, out, start, taken: [], memo: new Map() };
  c.nodes = routeNodes(c);
  return c;
}

/** How far (m) a point is from the colliders' edges; `skip` is left out. */
function clearance(c, x, z, skip = null, cols = c.cols) {
  let d = Infinity;
  for (const k of cols.circles) if (k !== skip) d = Math.min(d, Math.hypot(x - k.x, z - k.z) - k.r);
  for (const k of cols.capsules) {
    const vx = k.bx - k.ax;
    const vz = k.bz - k.az;
    const u = Math.max(0, Math.min(1, ((x - k.ax) * vx + (z - k.az) * vz) / (vx * vx + vz * vz)));
    d = Math.min(d, Math.hypot(x - (k.ax + vx * u), z - (k.az + vz * u)) - k.r);
  }
  return d;
}

/** A straight stretch the astronaut can walk: clear of everything, inside the bounds, not too steep. */
function segmentOk(c, a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L / 0.4));
  const step = L / n;
  let h0 = c.ground(a[0], a[1]);
  const lim = c.area.limit - 1;
  // only the colliders that can come near this stretch
  const m = SUIT.radius + 0.2;
  const x0 = Math.min(a[0], b[0]) - m;
  const x1 = Math.max(a[0], b[0]) + m;
  const z0 = Math.min(a[1], b[1]) - m;
  const z1 = Math.max(a[1], b[1]) + m;
  const near = {
    circles: c.cols.circles.filter((k) => k.x + k.r > x0 && k.x - k.r < x1 && k.z + k.r > z0 && k.z - k.r < z1),
    capsules: c.cols.capsules.filter((k) => Math.max(k.ax, k.bx) + k.r > x0 && Math.min(k.ax, k.bx) - k.r < x1 && Math.max(k.az, k.bz) + k.r > z0 && Math.min(k.az, k.bz) - k.r < z1),
  };
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const x = a[0] + (b[0] - a[0]) * u;
    const z = a[1] + (b[1] - a[1]) * u;
    if (Math.hypot(x - c.ax, z - c.az) > lim || Math.abs(z) > c.area.zMax - 0.5) return false;
    if (clearance(c, x, z, null, near) < SUIT.radius + 0.1) return false;
    const h = c.ground(x, z);
    if (Math.atan(Math.abs(h - h0) / step) / DEG > ROUTE_SLOPE) return false;
    h0 = h;
  }
  return true;
}

/** Waypoints round the LM and out across the area, for routes that cannot go straight. */
function routeNodes(c) {
  const out = [];
  for (const r of [5.5, 8, 11.5, 15, 19, 23, 27, 31]) {
    if (r > c.area.limit - 2) break;
    const n = r < 10 ? 12 : 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = c.ax + Math.cos(a) * r;
      const z = c.az + Math.sin(a) * r;
      if (Math.abs(z) > c.area.zMax - 1.5) continue;
      if (clearance(c, x, z) < SUIT.radius + 0.6) continue;
      if (slopeAt(c.ground, x, z) > SLOPE.node) continue;
      out.push([x, z]);
    }
  }
  return out;
}

/**
 * A walkable route from the foot of the ladder to (x, z): straight, or through the waypoints
 * (shortest first). Returns { points, length } or null.
 */
export function routeTo(c, x, z) {
  const from = c.start;
  const to = [x, z];
  if (segmentOk(c, from, to)) return { points: [from, to], length: Math.hypot(x - from[0], z - from[1]) };
  const nodes = [from, ...c.nodes, to];
  const n = nodes.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[0] = 0;
  const edge = (i, j) => {
    // waypoint to waypoint is the same for every target: remembered
    if (i > 0 && j > 0 && i < n - 1 && j < n - 1) {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (!c.memo.has(key)) c.memo.set(key, segmentOk(c, nodes[i], nodes[j]));
      return c.memo.get(key);
    }
    return segmentOk(c, nodes[i], nodes[j]);
  };
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return null;
    if (u === n - 1) break;
    done[u] = true;
    for (let v = 1; v < n; v++) {
      if (done[v]) continue;
      const d = Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]);
      if (dist[u] + d >= dist[v] || d > 16) continue;
      if (!edge(u, v)) continue;
      dist[v] = dist[u] + d;
      prev[v] = u;
    }
  }
  const points = [];
  for (let i = n - 1; i >= 0; i = prev[i]) {
    points.unshift(nodes[i]);
    if (i === 0) break;
  }
  return { points, length: dist[n - 1] };
}

/**
 * A walkable route between two points of this landing (validation tooling and guidance): straight,
 * or through the waypoints round the LM and the boulders. Returns { points, length } or null.
 */
export function routeBetween(world, from, to) {
  const cfg = evaMission(world.site.id);
  if (!cfg) return null;
  const c = context(world, cfg);
  c.start = [from[0], from[1]];
  return routeTo(c, to[0], to[1]);
}

/** Why a spot will not do (null: it will). */
function rejectSpot(c, x, z, o) {
  const r = Math.hypot(x - c.ax, z - c.az);
  if (r < MIN_LM || r > c.place) return "range";
  if (Math.abs(z) > c.area.zMax - 3) return "range";
  if (Math.hypot(x - c.lm.board[0], z - c.lm.board[2]) < 3) return "ladder";
  if (clearance(c, x, z, o.anchor) < o.clear) return "blocked";
  if (o.anchor && Math.hypot(x - o.anchor.x, z - o.anchor.z) - o.anchor.r < o.anchorGap) return "blocked";
  if (slopeAt(c.ground, x, z) > o.slope) return "slope";
  if (o.flat) {
    // the instrument's footprint: level all round (no corner in a hollow or on a hump)
    const h = c.ground(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (Math.abs(c.ground(x + Math.cos(a) * o.flat, z + Math.sin(a) * o.flat) - h) > 0.22) return "slope";
    }
  }
  for (const t of c.taken) if (Math.hypot(x - t.x, z - t.z) < separation(o, t)) return "near";
  const route = routeTo(c, x, z);
  if (!route || route.length > MAX_ROUTE) return "route";
  o.route = route;
  return null;
}

/**
 * How far apart two targets must be (m): two samples are taken at clearly different places; a
 * sample (or Tycho's gnomon) may sit by the rock that was surveyed; the rest keep their distance.
 */
function separation(a, b) {
  const pair = [a.group, b.group].sort().join("-");
  if (pair === "sample-sample") return 6;
  if (pair === "sample-survey") return 2.5;
  if (pair === "instrument-survey" && (a.bySurvey || b.bySurvey)) return 2.0;
  if (pair === "instrument-sample" && (a.bySurvey || b.bySurvey)) return 1.8; // a gnomon stands by the sample it scales
  return Math.max(SEP, a.sepMin || 0, b.sepMin || 0);
}

const ANG = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8];
const lmBearingFrom = (c, x, z) => Math.atan2(c.az - z, c.ax - x); // angle in the x-z plane (cos, sin)

/** Boulders by distance from the LM (site rocks with their collider). */
function boulders(c, label = null) {
  return c.site.rocks
    .filter((r) => r.boulder && (!label || label.test(r.label || "")))
    .map((r) => ({ r, d: Math.hypot(r.x - c.ax, r.z - c.az) }))
    .filter((o) => o.d < c.place + 6 && o.d > 4)
    .sort((a, b) => a.d - b.d || a.r.x - b.r.x)
    .slice(0, 14)
    .map(({ r }) => ({ rock: r, col: c.cols.circles.find((k) => k.kind === "rock" && k.x === r.x && k.z === r.z) || null }));
}

/** Craters by the distance of their rim from the LM (not the one the LM sits in). */
function craters(c, minR = 2) {
  return c.site.features
    .filter((f) => f.type === "crater" && f.r >= minR)
    .map((f) => ({ f, d: Math.hypot(f.x - c.ax, f.z - c.az) }))
    .filter((o) => o.d > o.f.r + 4 && o.d - o.f.r < c.place)
    .sort((a, b) => a.d - a.f.r - (b.d - b.f.r) || a.f.x - b.f.x)
    .slice(0, 8)
    .map((o) => o.f);
}

/** The candidates of one anchor, in order: { x, z, anchor?, look?, formation?, feature? }. */
function candidates(c, a, plan) {
  const out = [];
  if (a.near === "boulder") {
    for (const { rock, col } of boulders(c, a.label || null)) {
      const a0 = lmBearingFrom(c, rock.x, rock.z);
      for (const da of ANG) {
        const ang = a0 + da;
        const d = rock.r + a.gap;
        out.push({ x: rock.x + Math.cos(ang) * d, z: rock.z + Math.sin(ang) * d, anchor: col, anchorGap: Math.min(a.gap, 0.6), look: [rock.x, null, rock.z], lookH: rock.h || rock.r, formation: "boulder", feature: rock });
      }
    }
  } else if (a.near === "crater") {
    for (const f of craters(c, a.minR || 2)) {
      const a0 = lmBearingFrom(c, f.x, f.z);
      for (const da of ANG) {
        const ang = a0 + da;
        const d = f.r + a.gap;
        out.push({ x: f.x + Math.cos(ang) * d, z: f.z + Math.sin(ang) * d, look: [f.x, null, f.z], formation: "crater", feature: f });
      }
    }
  } else if (a.pond) {
    for (const p of c.site.ponds || []) {
      if (Math.hypot(p.x - c.ax, (p.z || 0) - c.az) > p.r) continue; // the pond the LM stands on
      for (const r of a.pond) {
        for (let i = 0; i < 16; i++) {
          const ang = c.outAng + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
          const x = c.ax + Math.cos(ang) * r;
          const z = c.az + Math.sin(ang) * r;
          if (Math.hypot(x - p.x, z - (p.z || 0)) < p.r - 1.5) out.push({ x, z, formation: "melt" });
        }
      }
    }
  } else if (a.toward) {
    const s = plan.subject;
    const b0 = Math.atan2(s.z - c.az, s.x - c.ax);
    for (const r of a.toward) for (const da of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8]) out.push({ x: c.ax + Math.cos(b0 + da) * r, z: c.az + Math.sin(b0 + da) * r });
  } else if (a.nearTarget) {
    const t = plan.targets[a.nearTarget];
    if (t) {
      const cx = t.look ? t.look[0] : t.x;
      const cz = t.look ? t.look[2] : t.z;
      const a0 = Math.atan2(t.z - cz, t.x - cx);
      for (const r of a.r) for (const da of [0.9, -0.9, 1.4, -1.4, 0.5, -0.5, 2, -2]) out.push({ x: cx + Math.cos(a0 + da) * r, z: cz + Math.sin(a0 + da) * r });
    }
  } else if (a.ring) {
    let b0 = c.outAng + Math.PI / 4;
    if (a.bearing === "behind") b0 = c.outAng + Math.PI * 0.62; // round to the side of the LM, off the ladder's line
    for (const r of a.ring) for (let i = 0; i < 16; i++) out.push({ x: c.ax + Math.cos(b0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8)) * r, z: c.az + Math.sin(b0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8)) * r });
  }
  return out;
}

/** Place one target from its anchors (then open ground, flagged); never null. */
function place(c, name, anchors, o, plan) {
  const tries = [...anchors, { ring: [9, 12, 15, 18, 21], fallback: true }];
  for (let i = 0; i < tries.length; i++) {
    const a = tries[i];
    for (const k of candidates(c, a, plan)) {
      const opts = { ...o, anchor: k.anchor || null, anchorGap: k.anchorGap || 0 };
      if (rejectSpot(c, k.x, k.z, opts)) continue;
      const t = { name, group: o.group, bySurvey: o.bySurvey, sepMin: o.sepMin, x: k.x, z: k.z, y: c.ground(k.x, k.z), fallback: !!a.fallback, anchorIndex: i, route: opts.route };
      if (k.formation) t.formation = k.formation;
      if (k.look) t.look = [k.look[0], c.ground(k.look[0], k.look[2]) + (k.lookH ? k.lookH * 0.5 : 0), k.look[2]];
      if (k.feature) t.feature = k.feature;
      c.taken.push(t);
      return t;
    }
  }
  // nothing anywhere (not expected: the tests sweep every site): the open ground in front of the
  // ladder, recorded as forced
  const x = c.start[0] + c.out[0] * 8;
  const z = c.start[1] + c.out[1] * 8;
  const t = { name, group: o.group, x, z, y: c.ground(x, z), fallback: true, forced: true, anchorIndex: -1 };
  c.taken.push(t);
  return t;
}

/**
 * The expedition's plan for one landing: where every target is, relative to the LM as it landed.
 * world: data/evaSim evaWorld. Returns { siteId, cfg, area, start, samples: [{ id, type, x, y, z,
 * formation?, fallback }], survey?, photo: { x, y, z, subject }, instrument?, fallbacks: [names] }.
 */
export function planEva(world) {
  const cfg = evaMission(world.site.id);
  if (!cfg) return null;
  const c = context(world, cfg);
  c.outAng = Math.atan2(c.out[1], c.out[0]);
  const plan = { siteId: cfg.id, cfg, area: c.area, start: c.start, samples: [], targets: {}, fallbacks: [] };
  if (cfg.id === "tranquillitatis") {
    // phase 1's places, exactly (data/evaSim evaWorld)
    plan.samples.push({ id: "TQ-01", type: cfg.samples[0].type, x: world.sample.x, z: world.sample.z, y: world.sample.y, fallback: false });
    plan.photo = { x: world.photo.x, z: world.photo.z, y: world.photo.y, subject: { ...cfg.photo.subject }, legacy: true, fallback: false };
    return plan;
  }
  // the survey first (the gnomon may stand by it), then the samples, the photo stand, the instrument
  if (cfg.survey) {
    const t = place(c, "survey", cfg.survey.anchors, { group: "survey", slope: SLOPE.stand, clear: 0.9 }, plan);
    if (!t.formation) t.formation = "regolith";
    if (!t.look) {
      const ang = Math.atan2(t.z - c.az, t.x - c.ax);
      t.look = [t.x + Math.cos(ang) * 1.2, t.y, t.z + Math.sin(ang) * 1.2];
    }
    plan.survey = t;
    plan.targets.survey = t;
  }
  for (const s of cfg.samples) {
    const t = place(c, s.id, s.anchors, { group: "sample", slope: SLOPE.sample, clear: 1.3 }, plan);
    plan.samples.push({ ...t, id: s.id, type: s.type });
  }
  // the photo: its subject, then a stand from which to take it
  let subject = { ...cfg.photo.subject };
  if (subject.kind === "landmark") {
    subject.y = world.ground(subject.x, subject.z);
  }
  plan.subject = subject;
  let stand = null;
  if (subject.kind === "crater") {
    // the nearest fresh crater with a rim to stand on; the stand outside the rim
    stand = place(c, "photo", cfg.photo.anchors, { group: "photo", slope: SLOPE.stand, clear: 0.9 }, plan);
    if (stand.feature && stand.formation === "crater") {
      const f = stand.feature;
      subject = { ...subject, x: f.x, z: f.z, r: f.r, y: world.ground(f.x, f.z) };
    } else {
      subject = { ...cfg.photo.fallbackSubject };
      stand.fallback = true;
    }
  } else {
    stand = place(c, "photo", cfg.photo.anchors, { group: "photo", slope: SLOPE.stand, clear: 0.9 }, plan);
  }
  plan.photo = { x: stand.x, z: stand.z, y: stand.y, subject, fallback: stand.fallback, route: stand.route };
  plan.targets.photo = plan.photo;
  if (cfg.instrument) {
    const I = cfg.instrument;
    const t = place(c, "instrument", I.anchors, { group: "instrument", slope: I.slope || SLOPE.instrument, clear: I.clear, flat: I.flat, sepMin: I.clear + 2, bySurvey: I.anchors.some((a) => a.nearTarget === "survey") }, plan);
    // the instrument faces the LM (its panel and cable side towards where the crew comes from)
    t.heading = Math.atan2(c.ax - t.x, c.az - t.z);
    plan.instrument = { ...t, id: I.id, kind: I.kind };
    plan.targets.instrument = plan.instrument;
  }
  plan.fallbacks = [plan.survey, ...plan.samples, plan.photo, plan.instrument].filter((t) => t && t.fallback).map((t) => t.name || t.id || "photo");
  return plan;
}

/* ---- playing it ----------------------------------------------------------------------------------- */
/**
 * The state the engine keeps (components/eva/LunarEva): { progress, samples: [{ id, … }],
 * instruments: [{ id, … }], photos }. What the astronaut is guided to now:
 * { objective, kind, x, y, z, id? } (for the samples, the nearest one still on the ground).
 */
export function currentTarget(plan, st, w = null) {
  const cfg = plan.cfg;
  const obj = nextObjective(cfg, st.progress);
  if (obj === "return") return { objective: "return", kind: "board" };
  const o = cfg.objectives.find((x) => x.id === obj);
  if (o.kind === "firstSteps") return { objective: obj, kind: "firstSteps" };
  if (o.kind === "sample") {
    const left = plan.samples.filter((s) => !st.samples.some((x) => x.id === s.id));
    if (!left.length) return { objective: obj, kind: "board" };
    const near = w ? left.slice().sort((a, b) => Math.hypot(a.x - w.x, a.z - w.z) - Math.hypot(b.x - w.x, b.z - w.z))[0] : left[0];
    return { objective: obj, kind: "sample", id: near.id, x: near.x, y: near.y, z: near.z };
  }
  if (o.kind === "survey") return { objective: obj, kind: "survey", x: plan.survey.x, y: plan.survey.y, z: plan.survey.z };
  if (o.kind === "photo") return { objective: obj, kind: "photo", x: plan.photo.x, y: plan.photo.y, z: plan.photo.z };
  if (o.kind === "instrument" || o.kind === "data") return { objective: obj, kind: o.kind, x: plan.instrument.x, y: plan.instrument.y, z: plan.instrument.z };
  return { objective: obj, kind: "board" };
}

/**
 * What the astronaut can do where he stands: { kind: "sample", id } | { kind: "survey" } |
 * { kind: "instrument" } | { kind: "data" } | { kind: "board" } | null; the nearest when two are
 * in reach. Nothing before the first steps.
 */
export function actionAt(plan, world, w, st) {
  const cfg = plan.cfg;
  const p = st.progress;
  if (!p.firstSteps) return null;
  const opts = [];
  const d = (x, z) => Math.hypot(w.x - x, w.z - z);
  for (const s of plan.samples) if (!st.samples.some((x) => x.id === s.id) && d(s.x, s.z) <= REACH.sample) opts.push({ kind: "sample", id: s.id, d: d(s.x, s.z) });
  if (plan.survey && !p.survey && d(plan.survey.x, plan.survey.z) <= REACH.survey) opts.push({ kind: "survey", d: d(plan.survey.x, plan.survey.z) });
  const io = objectiveOf(cfg, "instrument");
  if (io && !p[io.id] && d(plan.instrument.x, plan.instrument.z) <= REACH.instrument) opts.push({ kind: "instrument", d: d(plan.instrument.x, plan.instrument.z) });
  const dob = objectiveOf(cfg, "data");
  if (dob && p[io.id] && !p[dob.id] && d(plan.instrument.x, plan.instrument.z) <= REACH.data) opts.push({ kind: "data", d: d(plan.instrument.x, plan.instrument.z) });
  const lm = world.lm;
  if (d(lm.board[0], lm.board[2]) <= REACH.board) opts.push({ kind: "board", d: d(lm.board[0], lm.board[2]) + 0.01 });
  if (!opts.length) return null;
  opts.sort((a, b) => a.d - b.d);
  const { kind, id } = opts[0];
  return id ? { kind, id } : { kind };
}

/**
 * The photo's verdict for this destination's subject (no device camera: the in-game viewfinder).
 * The Sea of Tranquility keeps phase 1's check of the LM (data/evaSim photoCheck). A landscape is
 * taken from its observation point, the subject centred and whole in the frame: a landmark (the
 * mountain's summit and foot in frame), a crater (its centre and floor in frame), or a direction
 * on the horizon. view: { pos [x, y, z], yaw, pitch, vfov, aspect }.
 * Returns { ok, verdict, distance (to the subject, m; 0 for the horizon), dYaw, standDist }.
 */
export function photoCheckFor(plan, world, view) {
  const s = plan.photo.subject;
  if (s.kind === "lm") return lmPhotoCheck(world, view);
  const standDist = Math.hypot(view.pos[0] - plan.photo.x, view.pos[2] - plan.photo.z);
  const hfov = 2 * Math.atan(Math.tan(view.vfov / 2) * view.aspect);
  const halfV = view.vfov / 2;
  let bearing;
  let dist = 0;
  let top;
  let bottom;
  if (s.kind === "horizon") {
    const az = s.az * DEG;
    bearing = Math.atan2(Math.cos(az), -Math.sin(az));
    top = s.el * DEG - view.pitch;
    bottom = -0.02 - view.pitch;
  } else {
    const dx = s.x - view.pos[0];
    const dz = s.z - view.pos[2];
    dist = Math.hypot(dx, dz);
    bearing = Math.atan2(dx, dz);
    if (s.kind === "landmark") {
      top = Math.atan2(s.y - view.pos[1], dist) - view.pitch;
      bottom = Math.atan2(world.ground(view.pos[0] + (dx / dist) * Math.min(dist, 60), view.pos[2] + (dz / dist) * Math.min(dist, 60)) - view.pos[1], Math.min(dist, 60)) - view.pitch;
    } else {
      // a crater: its floor's centre, and its far rim
      const floor = Math.atan2(s.y - view.pos[1], dist) - view.pitch;
      const far = Math.atan2(world.ground(s.x + (dx / dist) * s.r, s.z + (dz / dist) * s.r) - view.pos[1], dist + s.r) - view.pitch;
      top = far;
      bottom = floor;
    }
  }
  const dYaw = wrapPi(bearing - view.yaw);
  let verdict = "ok";
  if (standDist > PHOTO_STAND_R) verdict = "goToPoint";
  else if (Math.abs(dYaw) > hfov / 2) verdict = "aimSubject";
  else if (bottom < -halfV * 0.92) verdict = "tiltDown";
  else if (top > halfV * 0.92) verdict = "tiltUp";
  else if (Math.abs(dYaw) > (hfov / 2) * PHOTO_CENTRE) verdict = "centreSubject";
  return { ok: verdict === "ok", verdict, distance: dist, dYaw, standDist };
}
