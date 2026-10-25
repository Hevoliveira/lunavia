/*
 * LUNAVIA — APOLLO LEGACY: three historically inspired lunar challenges (pure; unit-tested).
 *
 * Each scenario is LUNAVIA's own landing and EVA systems (components/DescentGame, data/evaSim,
 * data/evaMissions) run from a safe historical starting point: a descent start, a landing site,
 * and an EVA configuration in the same shape as the official expeditions (EVA_MISSIONS), so the
 * same engine plays it. What is history and what is gameplay is kept apart:
 *
 *   history   documented facts (dates, crews, spacecraft names, landing places, what was done
 *             on the surface), with the sources they come from (SOURCES);
 *   gameplay  the simplified, time-compressed version the player flies and walks (start states,
 *             objective order and distances, the instruments' look), described as such.
 *
 * Radio calls in these scenarios are DRAMATIZED: written for the game, spoken by synthetic voices,
 * never presented as archival recordings, never imitating the astronauts. A documented quotation
 * is shown only as text, with its attribution.
 *
 * Apollo Legacy is separate from the official campaign: its own save (lib/legacySave), its own
 * results (legacyRecords here); it never touches the 1,000-point scoring, medals or achievements.
 */
import { AREA } from "./evaSim";
import { DIFFICULTY } from "./landingPhysics";

const T = (en, pt) => ({ en, pt });
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/* ---- sources --------------------------------------------------------------------------------- */
export const SOURCES = Object.freeze({
  a11: [
    "NASA, Apollo 11 Mission Report (MSC-00171, 1969)",
    "NASA, Apollo 11 mission overview — nasa.gov/mission/apollo-11",
    "NASA, Apollo Lunar Surface Journal: Apollo 11",
  ],
  a12: [
    "NASA, Apollo 12 Mission Report (MSC-01855, 1970)",
    "NASA, Apollo 12 mission overview — nasa.gov/mission/apollo-12",
    "NASA, Analysis of Surveyor 3 material and photographs returned by Apollo 12 (SP-284, 1972)",
    "NASA NSSDCA, Surveyor 3 (1967-035A)",
  ],
  a15: [
    "NASA, Apollo 15 Mission Report (MSC-05161, 1971)",
    "NASA, Apollo 15 mission overview — nasa.gov/mission/apollo-15",
    "NASA, Apollo Lunar Surface Journal: Apollo 15",
  ],
});

/* ---- difficulty: the descent's own (the EVA has none) ----------------------------------------- */
// fuel left at the historical start, as a share of the difficulty's full tank
const FUEL = {
  a11: { CADET: 0.75, ASTRONAUT: 0.7, COMMANDER: 0.75 },
  a12: { CADET: 0.85, ASTRONAUT: 0.8, COMMANDER: 0.85 },
};

/* ---- the three EVA configurations (data/evaMissions shape) ------------------------------------ */
const LEGACY_VOICE = { returnLM: "eva.returnLM", complete: "legacy.complete", boundary: "legacy.boundary", remind: "legacy.remind" };

const A11_EVA = {
  id: "apollo11",
  area: { warn: 26, limit: 33, zMax: 32 },
  comms: { earthLink: true },
  objectives: [
    { id: "firstSteps", kind: "firstSteps" },
    { id: "sample", kind: "sample" },
    { id: "photo", kind: "photo" },
    { id: "instrument", kind: "instrument" },
  ],
  // the contingency sample: scooped close to the LM, the first task on the surface
  samples: [{ id: "A11-CS", type: "mare", anchors: [{ ring: [7, 8.5, 10] }] }],
  photo: { subject: { id: "LM", kind: "lm" }, anchors: [{ ring: [14, 17, 20] }] },
  // the Laser Ranging Retroreflector, set up away from the LM
  instrument: { id: "LRRR", kind: "lrrr", clear: 1.3, flat: 0.7, anchors: [{ ring: [15, 18, 21], bearing: "behind" }, { ring: [12, 16, 20] }] },
  voice: {
    ...LEGACY_VOICE,
    authorized: "legacy.a11.goEva",
    firstSteps: "legacy.a11.firstSteps",
    go: { sample: "legacy.a11.goSample", photo: "legacy.a11.goPhoto", instrument: "legacy.a11.goInstrument" },
    done: { sample: "eva.sampleDone", photo: "eva.photoTaken", instrument: "legacy.a11.instrumentDone" },
  },
  text: {
    en: {
      title: "APOLLO 11 · TRANQUILITY BASE",
      expedition: "THE FIRST LANDING · FIRST STEPS",
      ascentSub: "",
      banner: "TRANQUILITY BASE",
      objectives: { firstSteps: "FIRST STEPS", sample: "CONTINGENCY SAMPLE", photo: "DOCUMENT EAGLE", instrument: "DEPLOY THE LASER RETROREFLECTOR" },
      briefing: "Step onto the surface, scoop the contingency sample, photograph Eagle and set up the laser ranging retroreflector.",
      samples: { "A11-CS": "CONTINGENCY SAMPLE · MARE SOIL" },
      subject: "THE LUNAR MODULE EAGLE",
      instrument: ["LASER RANGING RETROREFLECTOR", "An array of 100 quartz corner cubes that send laser light straight back to where it came from. Apollo 11's reflector is still used: observatories on Earth time laser pulses to it to measure the Earth–Moon distance to within centimetres."],
    },
    pt: {
      title: "APOLLO 11 · BASE TRANQUILIDADE",
      expedition: "O PRIMEIRO POUSO · PRIMEIROS PASSOS",
      ascentSub: "",
      banner: "BASE TRANQUILIDADE",
      objectives: { firstSteps: "PRIMEIROS PASSOS", sample: "AMOSTRA DE CONTINGÊNCIA", photo: "DOCUMENTAR A EAGLE", instrument: "INSTALAR O RETRORREFLETOR LASER" },
      briefing: "Pise na superfície, recolha a amostra de contingência, fotografe a Eagle e instale o retrorrefletor laser.",
      samples: { "A11-CS": "AMOSTRA DE CONTINGÊNCIA · SOLO DE MAR" },
      subject: "O MÓDULO LUNAR EAGLE",
      instrument: ["RETRORREFLETOR LASER", "Um conjunto de 100 cubos de quartzo que devolvem a luz do laser exatamente para onde veio. O refletor da Apollo 11 ainda é usado: observatórios na Terra cronometram pulsos de laser até ele para medir a distância Terra–Lua com precisão de centímetros."],
    },
  },
};

const A12_EVA = {
  id: "apollo12",
  // Surveyor 3 is ~150 m from the target: the planned traverse covers it from any reasonable landing
  area: { warn: 215, limit: 240, zMax: 44 },
  maxRoute: 300,
  comms: { earthLink: true },
  objectives: [
    { id: "firstSteps", kind: "firstSteps" },
    { id: "survey", kind: "survey" },
    { id: "photo", kind: "photo" },
    { id: "retrieve", kind: "retrieve" },
  ],
  samples: [],
  survey: { anchors: [{ point: "surveyor3", r: [2.7, 3.1, 3.6], lookH: 1.6, formation: "surveyor" }] },
  photo: {
    subject: { id: "SURVEYOR-3", kind: "landmark", object: "surveyor3", h: 3.0 },
    // from its sunlit side (the Sun low behind the photographer), else facing the LM
    anchors: [{ point: "surveyor3", r: [7.5, 9, 10.5], sunSide: true }, { point: "surveyor3", r: [7.5, 9, 10.5] }],
  },
  retrieve: { id: "TV-CAMERA", object: "surveyor3", anchors: [{ point: "surveyor3:camera", r: [0.95, 1.1, 1.25], outward: true }] },
  voice: {
    ...LEGACY_VOICE,
    authorized: "legacy.a12.goEva",
    firstSteps: "legacy.a12.firstSteps",
    go: { survey: "legacy.a12.goSurvey", photo: "legacy.a12.goPhoto", retrieve: "legacy.a12.goRetrieve" },
    done: { survey: "legacy.a12.surveyDone", photo: "eva.photoTaken", retrieve: "legacy.a12.retrieved" },
  },
  text: {
    en: {
      title: "APOLLO 12 · OCEAN OF STORMS",
      expedition: "THE SURVEYOR 3 EXPEDITION",
      ascentSub: "",
      banner: "OCEAN OF STORMS",
      objectives: { firstSteps: "EXIT INTREPID", survey: "LOCATE AND INSPECT SURVEYOR 3", photo: "DOCUMENT SURVEYOR 3", retrieve: "RETRIEVE THE TV CAMERA" },
      briefing: "Walk to Surveyor 3 on the slope of Surveyor crater, inspect it, photograph it and bring back its television camera.",
      samples: {},
      subject: "SURVEYOR 3",
      survey: {
        surveyor: ["SURVEYOR 3 · 31 MONTHS ON THE MOON", "The robotic lander touched down here on 20 April 1967 and bounced twice before settling on this slope. Its white paint has turned tan: dust kicked up by Intrepid's landing and long exposure to sunlight. Engineers wanted parts of it back to see what years on the Moon do to materials."],
        regolith: ["THE CRATER SLOPE", "Fine mare soil on the inner slope of Surveyor crater."],
      },
      retrieve: ["SURVEYOR 3 TELEVISION CAMERA", "Apollo 12's crew cut the camera free and carried it home with the probe's scoop and pieces of cabling and tubing. Studied on Earth, the parts showed how materials had weathered after about 31 months on the lunar surface."],
      retrieveAct: "RETRIEVE CAMERA",
      retrieving: "RETRIEVING",
    },
    pt: {
      title: "APOLLO 12 · OCEANO DAS TEMPESTADES",
      expedition: "A EXPEDIÇÃO À SURVEYOR 3",
      ascentSub: "",
      banner: "OCEANO DAS TEMPESTADES",
      objectives: { firstSteps: "SAIR DA INTREPID", survey: "LOCALIZAR E INSPECIONAR A SURVEYOR 3", photo: "DOCUMENTAR A SURVEYOR 3", retrieve: "RECUPERAR A CÂMERA DE TV" },
      briefing: "Caminhe até a Surveyor 3, na encosta da cratera Surveyor, inspecione-a, fotografe-a e traga de volta sua câmera de televisão.",
      samples: {},
      subject: "SURVEYOR 3",
      survey: {
        surveyor: ["SURVEYOR 3 · 31 MESES NA LUA", "A sonda robótica pousou aqui em 20 de abril de 1967 e quicou duas vezes antes de parar nesta encosta. Sua pintura branca ficou bege: poeira levantada pelo pouso da Intrepid e longa exposição ao Sol. Os engenheiros queriam peças dela para ver o que anos na Lua fazem com os materiais."],
        regolith: ["A ENCOSTA DA CRATERA", "Solo fino de mar na encosta interna da cratera Surveyor."],
      },
      retrieve: ["CÂMERA DE TELEVISÃO DA SURVEYOR 3", "A tripulação da Apollo 12 soltou a câmera e a levou para a Terra junto com a pá da sonda e pedaços de cabos e tubos. Estudadas na Terra, as peças mostraram como os materiais envelheceram após cerca de 31 meses na superfície lunar."],
      retrieveAct: "RECUPERAR CÂMERA",
      retrieving: "RECUPERANDO",
    },
  },
};

const A15_EVA = {
  id: "apollo15",
  // a longer traverse than any official EVA: the rille rim to the east, the talus to the west
  area: { warn: 74, limit: 82, zMax: 33 },
  maxRoute: 150,
  comms: { earthLink: true },
  objectives: [
    { id: "firstSteps", kind: "firstSteps" },
    { id: "survey", kind: "survey" },
    { id: "samples", kind: "sample" },
    { id: "photo", kind: "photo" },
    { id: "instrument", kind: "instrument" },
  ],
  // the geology station on Hadley Rille's rim, looking into the rille
  survey: { anchors: [{ point: [29, 18], r: [0, 2, 3.5, 5], formation: "rille", look: [48, 12], lookH: -8 }, { point: [24, 8], r: [0, 2, 3.5, 5], formation: "rille", look: [44, 4], lookH: -8 }] },
  samples: [
    // mare basalt from the rille-edge boulders; pale highland material from the Apennine talus
    { id: "A15-01", type: "basalt", anchors: [{ near: "boulder", gap: 0.75, label: /RILLE-EDGE/, sunlit: true }, { near: "boulder", gap: 0.75, label: /RILLE-EDGE/ }, { ring: [26, 30, 34] }] },
    // (the talus itself lies in the mountain's shadow at this Sun angle: the stone is taken at the
    // sunlit foot of the slope, where the highland debris reaches the plain)
    { id: "A15-02", type: "anorthosite", anchors: [{ near: "boulder", gap: 0.75, label: /TALUS/, sunlit: true }, { point: [-36, 4], r: [0, 2, 4, 6, 8], sunlit: true }, { near: "boulder", gap: 0.75, label: /TALUS/ }, { ring: [40, 48, 56] }] },
  ],
  photo: {
    subject: { id: "HADLEY-DELTA", kind: "landmark", x: -60, z: 360 },
    anchors: [{ toward: [16, 20, 24] }, { ring: [16, 20, 24] }],
  },
  instrument: { id: "PSE15", kind: "seismometer", clear: 1.6, flat: 1.1, anchors: [{ ring: [24, 28, 32], bearing: "behind" }, { ring: [20, 24, 28] }] },
  voice: {
    ...LEGACY_VOICE,
    authorized: "legacy.a15.goEva",
    firstSteps: "legacy.a15.firstSteps",
    go: { survey: "legacy.a15.goSurvey", samples: "legacy.a15.goSamples", photo: "legacy.a15.goPhoto", instrument: "legacy.a15.goInstrument" },
    done: { survey: "legacy.a15.surveyDone", samples: "eva.samplesDone", photo: "eva.photoTaken", instrument: "legacy.a15.instrumentDone" },
    sampleOne: "eva.sampleOne",
    goSecond: "legacy.a15.goSecond",
  },
  text: {
    en: {
      title: "APOLLO 15 · HADLEY–APENNINE",
      expedition: "THE GREAT EXPLORATION · ON FOOT",
      ascentSub: "",
      banner: "HADLEY–APENNINE",
      objectives: { firstSteps: "EXIT FALCON", survey: "GEOLOGY STATION · HADLEY RILLE RIM", samples: "COLLECT TWO DISTINCT SAMPLES", photo: "PHOTOGRAPH HADLEY DELTA", instrument: "DEPLOY THE SEISMOMETER" },
      briefing: "A long traverse: the rim of Hadley Rille to the east, mare basalt at the rille edge, highland material from the Apennine talus to the west, Hadley Delta on camera, then the seismometer.",
      samples: { "A15-01": "MARE BASALT · RILLE EDGE", "A15-02": "HIGHLAND BRECCIA · APENNINE TALUS" },
      subject: "HADLEY DELTA",
      survey: {
        rille: ["HADLEY RILLE", "A sinuous channel more than 100 km long and up to about 300 m deep, winding along the foot of the Apennines. Apollo 15's crew studied and photographed its walls, where layered lava flows are exposed; it is thought to have been carved or roofed by flowing lava."],
        regolith: ["THE RILLE RIM", "The soil near the rim of Hadley Rille: mare basalt broken by impacts, with blocks from the flows exposed in the wall."],
      },
      instrument: ["PASSIVE SEISMIC EXPERIMENT", "Apollo 15's ALSEP included a seismometer that joined those left by Apollo 12 and 14, forming a network on the Moon. Together they recorded moonquakes and impacts for years and helped map the lunar interior."],
    },
    pt: {
      title: "APOLLO 15 · HADLEY–APENINOS",
      expedition: "A GRANDE EXPLORAÇÃO · A PÉ",
      ascentSub: "",
      banner: "HADLEY–APENINOS",
      objectives: { firstSteps: "SAIR DA FALCON", survey: "ESTAÇÃO GEOLÓGICA · BORDA DA FENDA DE HADLEY", samples: "COLETAR DUAS AMOSTRAS DISTINTAS", photo: "FOTOGRAFAR O HADLEY DELTA", instrument: "INSTALAR O SISMÔMETRO" },
      briefing: "Uma travessia longa: a borda da Fenda de Hadley a leste, basalto de mar na beira da fenda, material das terras altas no tálus dos Apeninos a oeste, o Hadley Delta na câmera e depois o sismômetro.",
      samples: { "A15-01": "BASALTO DE MAR · BEIRA DA FENDA", "A15-02": "BRECHA DAS TERRAS ALTAS · TÁLUS DOS APENINOS" },
      subject: "HADLEY DELTA",
      survey: {
        rille: ["FENDA DE HADLEY", "Um canal sinuoso com mais de 100 km de extensão e até cerca de 300 m de profundidade, ao pé dos Apeninos. A tripulação da Apollo 15 estudou e fotografou suas paredes, onde aparecem derrames de lava em camadas; acredita-se que tenha sido escavada ou coberta por lava em movimento."],
        regolith: ["A BORDA DA FENDA", "O solo perto da borda da Fenda de Hadley: basalto de mar fragmentado por impactos, com blocos dos derrames expostos na parede."],
      },
      instrument: ["EXPERIMENTO SÍSMICO PASSIVO", "O ALSEP da Apollo 15 incluía um sismômetro que se juntou aos deixados pelas Apollo 12 e 14, formando uma rede na Lua. Juntos, registraram tremores e impactos por anos e ajudaram a mapear o interior lunar."],
    },
  },
};

/* ---- the three scenarios -------------------------------------------------------------------- */
export const LEGACY_SCENARIOS = Object.freeze([
  {
    id: "apollo11",
    number: 11,
    title: T("APOLLO 11", "APOLLO 11"),
    subtitle: T("THE FIRST LANDING", "O PRIMEIRO POUSO"),
    date: T("JULY 1969", "JULHO DE 1969"),
    destination: T("SEA OF TRANQUILITY", "MAR DA TRANQUILIDADE"),
    siteId: "tranquillitatis",
    lm: "EAGLE",
    cm: "COLUMBIA",
    callsign: "Eagle",
    crew: [
      { name: "Neil A. Armstrong", role: T("Commander", "Comandante") },
      { name: "Edwin E. “Buzz” Aldrin Jr.", role: T("Lunar Module Pilot", "Piloto do Módulo Lunar") },
      { name: "Michael Collins", role: T("Command Module Pilot (in lunar orbit)", "Piloto do Módulo de Comando (em órbita lunar)") },
    ],
    challenge: T("SAFE LANDING AND FIRST STEPS", "POUSO SEGURO E PRIMEIROS PASSOS"),
    summary: T("Fly the final descent past the boulder fields, land safely, and take humanity's first steps on another world.", "Pilote a descida final além dos campos de blocos, pouse com segurança e dê os primeiros passos da humanidade em outro mundo."),
    science: T(["Contingency sample", "Photograph of Eagle", "Laser Ranging Retroreflector"], ["Amostra de contingência", "Fotografia da Eagle", "Retrorrefletor laser"]),
    history: T(
      [
        "On 20 July 1969 the lunar module Eagle landed in the Sea of Tranquility: the first crewed landing on the Moon. During the descent the guidance computer raised program alarms, and Neil Armstrong took semi-manual control to fly beyond a boulder-strewn crater before touching down with little propellant to spare.",
        "Armstrong and Buzz Aldrin spent about two and a half hours outside on 21 July (UTC), collecting about 21.5 kg of lunar material and setting up a seismometer, a laser retroreflector and a solar-wind experiment. Michael Collins orbited overhead in Columbia.",
      ],
      [
        "Em 20 de julho de 1969 o módulo lunar Eagle pousou no Mar da Tranquilidade: o primeiro pouso tripulado na Lua. Durante a descida o computador de guiagem acusou alarmes de programa, e Neil Armstrong assumiu o controle semimanual para passar além de uma cratera cheia de blocos antes de tocar o solo com pouco propelente de sobra.",
        "Armstrong e Buzz Aldrin passaram cerca de duas horas e meia fora em 21 de julho (UTC), recolhendo cerca de 21,5 kg de material lunar e instalando um sismômetro, um retrorrefletor laser e um experimento de vento solar. Michael Collins orbitava acima na Columbia.",
      ]
    ),
    quote: { text: "That's one small step for [a] man, one giant leap for mankind.", by: "Neil Armstrong, 21 July 1969 (NASA transcript)" },
    gameplay: T(
      "Gameplay adaptation: the descent starts at about 160 m on the final approach, on LUNAVIA's Sea of Tranquility terrain (not the real Tranquility Base surroundings). One EVA, three tasks, with distances compressed.",
      "Adaptação para o jogo: a descida começa a cerca de 160 m na aproximação final, no terreno do Mar da Tranquilidade de LUNAVIA (não os arredores reais da Base Tranquilidade). Uma EVA, três tarefas, com distâncias comprimidas."
    ),
    sources: SOURCES.a11,
    descent: {
      init: (key, site) => {
        const cfg = DIFFICULTY[key] || DIFFICULTY.ASTRONAUT;
        const d = site.approach.dir;
        // the final approach: low, still moving downrange over the crater and the boulder field
        return { alt: 160, vy: -3.5, vx: 5 * d, xPos: -88 * d, fuel: cfg.initialFuel * FUEL.a11[key in FUEL.a11 ? key : "ASTRONAUT"], throttle: 0.3 };
      },
      voice: { start: "legacy.a11.descent", landed: "legacy.a11.landed" },
    },
    eva: A11_EVA,
  },
  {
    id: "apollo12",
    number: 12,
    title: T("APOLLO 12", "APOLLO 12"),
    subtitle: T("PRECISION LANDING", "POUSO DE PRECISÃO"),
    date: T("NOVEMBER 1969", "NOVEMBRO DE 1969"),
    destination: T("OCEAN OF STORMS", "OCEANO DAS TEMPESTADES"),
    siteId: "oceanus",
    lm: "INTREPID",
    cm: "YANKEE CLIPPER",
    callsign: "Intrepid",
    crew: [
      { name: "Charles “Pete” Conrad Jr.", role: T("Commander", "Comandante") },
      { name: "Alan L. Bean", role: T("Lunar Module Pilot", "Piloto do Módulo Lunar") },
      { name: "Richard F. Gordon Jr.", role: T("Command Module Pilot (in lunar orbit)", "Piloto do Módulo de Comando (em órbita lunar)") },
    ],
    challenge: T("PRECISION LANDING NEAR SURVEYOR 3", "POUSO DE PRECISÃO PERTO DA SURVEYOR 3"),
    summary: T("Land on target, within walking distance of the robotic Surveyor 3, then walk to it and bring back its television camera.", "Pouse no alvo, a uma caminhada da sonda robótica Surveyor 3; depois caminhe até ela e traga de volta sua câmera de televisão."),
    science: T(["Landing accuracy", "Surveyor 3 inspection and photograph", "Retrieve the TV camera"], ["Precisão do pouso", "Inspeção e fotografia da Surveyor 3", "Recuperar a câmera de TV"]),
    history: T(
      [
        "On 19 November 1969 Intrepid landed in the Ocean of Storms, demonstrating the precision landing later missions would need: it came down roughly 160–180 m from Surveyor 3, a robotic lander that had been there since April 1967.",
        "Pete Conrad and Alan Bean made two moonwalks. On the second they walked to Surveyor 3 and removed its television camera, its scoop and pieces of cable and tubing, which engineers studied on Earth. Richard Gordon remained in orbit in Yankee Clipper.",
      ],
      [
        "Em 19 de novembro de 1969 a Intrepid pousou no Oceano das Tempestades, demonstrando o pouso de precisão de que as missões seguintes precisariam: desceu a cerca de 160–180 m da Surveyor 3, uma sonda robótica que estava ali desde abril de 1967.",
        "Pete Conrad e Alan Bean fizeram duas caminhadas lunares. Na segunda, caminharam até a Surveyor 3 e retiraram sua câmera de televisão, sua pá e pedaços de cabos e tubos, que engenheiros estudaram na Terra. Richard Gordon permaneceu em órbita na Yankee Clipper.",
      ]
    ),
    quote: null,
    gameplay: T(
      "Gameplay adaptation: a focused, local-scale reconstruction of the Ocean of Storms built for this challenge, with Surveyor 3 on the inner slope of Surveyor crater about 150 m from the landing target. Crater names follow NASA's traverse maps; sizes and positions are approximate. The surface work of two EVAs is condensed into one.",
      "Adaptação para o jogo: uma reconstrução local e focada do Oceano das Tempestades feita para este desafio, com a Surveyor 3 na encosta interna da cratera Surveyor a cerca de 150 m do alvo de pouso. Os nomes das crateras seguem os mapas de travessia da NASA; tamanhos e posições são aproximados. O trabalho de duas EVAs está condensado em uma."
    ),
    sources: SOURCES.a12,
    descent: {
      init: (key, site) => {
        const cfg = DIFFICULTY[key] || DIFFICULTY.ASTRONAUT;
        const d = site.approach.dir;
        // short final, west of the target, coming in towards Surveyor crater
        return { alt: 230, vy: -5, vx: 6 * d, xPos: -125 * d, fuel: cfg.initialFuel * FUEL.a12[key in FUEL.a12 ? key : "ASTRONAUT"], throttle: 0.3 };
      },
      voice: { start: "legacy.a12.descent", landed: "legacy.a12.landed" },
    },
    precision: { targetX: 0, object: "surveyor3" },
    eva: A12_EVA,
  },
  {
    id: "apollo15",
    number: 15,
    title: T("APOLLO 15", "APOLLO 15"),
    subtitle: T("THE GREAT EXPLORATION", "A GRANDE EXPLORAÇÃO"),
    date: T("JULY–AUGUST 1971", "JULHO–AGOSTO DE 1971"),
    destination: T("HADLEY–APENNINE", "HADLEY–APENINOS"),
    siteId: "hadley",
    lm: "FALCON",
    cm: "ENDEAVOUR",
    callsign: "Falcon",
    crew: [
      { name: "David R. Scott", role: T("Commander", "Comandante") },
      { name: "James B. Irwin", role: T("Lunar Module Pilot", "Piloto do Módulo Lunar") },
      { name: "Alfred M. Worden", role: T("Command Module Pilot (in lunar orbit)", "Piloto do Módulo de Comando (em órbita lunar)") },
    ],
    challenge: T("EXTENDED GEOLOGICAL EXPLORATION", "EXPLORAÇÃO GEOLÓGICA ESTENDIDA"),
    summary: T("Land in the mountain valley, then make the longest traverse in LUNAVIA: Hadley Rille's rim, two different rock types, Hadley Delta on camera and a seismometer.", "Pouse no vale entre as montanhas e faça a travessia mais longa de LUNAVIA: a borda da Fenda de Hadley, dois tipos de rocha, o Hadley Delta na câmera e um sismômetro."),
    science: T(["Geology station at Hadley Rille", "Two distinct samples", "Landscape photograph", "Seismometer"], ["Estação geológica na Fenda de Hadley", "Duas amostras distintas", "Fotografia da paisagem", "Sismômetro"]),
    history: T(
      [
        "Apollo 15 landed Falcon at Hadley–Apennine on 30 July 1971, between the Apennine mountains and Hadley Rille. It was the first of the extended 'J' missions: about three days on the surface and three EVAs.",
        "David Scott and James Irwin drove the first Lunar Roving Vehicle, explored the rille and the flank of Hadley Delta, and returned about 77 kg of samples, among them a piece of ancient anorthosite later nicknamed the 'Genesis Rock'. Alfred Worden flew Endeavour in orbit.",
      ],
      [
        "A Apollo 15 pousou a Falcon em Hadley–Apeninos em 30 de julho de 1971, entre os montes Apeninos e a Fenda de Hadley. Foi a primeira das missões estendidas 'J': cerca de três dias na superfície e três EVAs.",
        "David Scott e James Irwin dirigiram o primeiro Veículo Lunar Itinerante, exploraram a fenda e a encosta do Hadley Delta e trouxeram cerca de 77 kg de amostras, entre elas um pedaço de anortosito antigo depois apelidado de 'Rocha do Gênesis'. Alfred Worden pilotou a Endeavour em órbita.",
      ]
    ),
    quote: null,
    gameplay: T(
      "Gameplay adaptation: LUNAVIA's approved Hadley–Apennine terrain. LUNAVIA has no Lunar Roving Vehicle yet, so this traverse is on foot and much shorter than the real drives (a rover is a possible future expansion). Distances, the station and the sample places are simplified.",
      "Adaptação para o jogo: o terreno aprovado de Hadley–Apeninos de LUNAVIA. LUNAVIA ainda não tem o Veículo Lunar Itinerante, então esta travessia é a pé e bem mais curta que os percursos reais (o rover é uma possível expansão futura). Distâncias, a estação e os pontos de amostra são simplificados."
    ),
    sources: SOURCES.a15,
    descent: { init: () => null, voice: { start: "legacy.a15.descent", landed: "legacy.a15.landed" } },
    eva: A15_EVA,
  },
]);
export const LEGACY_IDS = LEGACY_SCENARIOS.map((s) => s.id);
export const legacyScenario = (id) => LEGACY_SCENARIOS.find((s) => s.id === id) || null;
export const tx = (v, lang) => (v && typeof v === "object" && ("en" in v || "pt" in v) ? v[lang === "pt" ? "pt" : "en"] : v);

/* ---- results -------------------------------------------------------------------------------- */
/** Apollo 12: how close to the target (m along the track) and to Surveyor 3. */
export const PRECISION_BANDS = [
  { max: 10, id: "PINPOINT", text: T("PINPOINT", "NO ALVO") },
  { max: 30, id: "PRECISE", text: T("PRECISE", "PRECISO") },
  { max: 70, id: "ACCEPTABLE", text: T("ACCEPTABLE", "ACEITÁVEL") },
  { max: Infinity, id: "WIDE", text: T("WIDE OF THE TARGET", "LONGE DO ALVO") },
];
export function landingPrecision(scenario, pose, site) {
  if (!scenario || !scenario.precision || !pose || !fin(pose.x)) return null;
  const P = scenario.precision;
  const dTarget = Math.abs(pose.x - P.targetX);
  const obj = (site && site.objects ? site.objects : []).find((o) => o.id === P.object);
  const dObject = obj ? Math.hypot(obj.x - pose.x, obj.z - 0) : null;
  const band = PRECISION_BANDS.find((b) => dTarget <= b.max);
  return { dTarget: +dTarget.toFixed(1), dObject: dObject == null ? null : +dObject.toFixed(0), band: band.id };
}

/**
 * The challenge's result (nothing of the official score): what was done, from the landing and the
 * EVA record. Completed = a safe landing, every surface objective done and the astronaut back in
 * the LM (eva.completed).
 */
export function legacyResult(scenario, { landing = null, eva = null } = {}) {
  const cfg = scenario.eva;
  const prog = isObj(eva) && isObj(eva.progress) ? eva.progress : {};
  const objectives = cfg.objectives.map((o) => ({ id: o.id, done: prog[o.id] === true }));
  const done = objectives.filter((o) => o.done).length;
  const safe = !!(landing && landing.safe);
  const backInLM = !!(eva && eva.completed);
  return {
    scenario: scenario.id,
    landed: safe,
    precision: landing && landing.precision ? landing.precision : null,
    touchdownSpeed: landing && fin(landing.touchdownSpeed) ? landing.touchdownSpeed : null,
    objectives,
    done,
    total: objectives.length,
    samples: isObj(eva) && Array.isArray(eva.samples) ? eva.samples.length : 0,
    photos: isObj(eva) && Array.isArray(eva.photos) ? Math.min(1, eva.photos.length) : 0,
    retrieved: isObj(eva) && Array.isArray(eva.retrieved) ? eva.retrieved.length : 0,
    instruments: isObj(eva) && Array.isArray(eva.instruments) ? eva.instruments.length : 0,
    backInLM,
    completed: safe && backInLM && done === objectives.length,
  };
}

/* ---- historical records (separate from the campaign's records) ------------------------------ */
export const LEGACY_RECORDS_KEY = "lunavia.legacy.records.v1";
export const emptyLegacyRecords = () => ({ v: 1, scenarios: {} });

/**
 * A finished attempt into the records (pure): the completion badge once per scenario, the count,
 * the best landing precision (Apollo 12). The same attempt id is counted once.
 */
export function applyLegacyResult(records, attemptId, difficulty, result, at = Date.now()) {
  const r = isObj(records) && isObj(records.scenarios) ? JSON.parse(JSON.stringify(records)) : emptyLegacyRecords();
  if (!result || !LEGACY_IDS.includes(result.scenario)) return r;
  const s = r.scenarios[result.scenario] || { completed: false, completions: 0, attempts: [], best: null, firstAt: null, lastAt: null };
  if (s.attempts.includes(attemptId)) return r;
  s.attempts = [...s.attempts, attemptId].slice(-50);
  if (result.completed) {
    s.completions += 1;
    if (!s.completed) s.firstAt = at;
    s.completed = true;
    s.lastAt = at;
    s.lastDifficulty = difficulty;
    const p = result.precision && fin(result.precision.dTarget) ? result.precision.dTarget : null;
    if (p != null && (!s.best || s.best.dTarget == null || p < s.best.dTarget)) s.best = { dTarget: p, band: result.precision.band, difficulty };
  }
  r.scenarios[result.scenario] = s;
  return r;
}
/** The records, read defensively (anything unreadable is an empty record). */
export function readLegacyRecords(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isObj(v) || !isObj(v.scenarios)) return emptyLegacyRecords();
    return v;
  } catch {
    return emptyLegacyRecords();
  }
}

/* ---- the screens' text ---------------------------------------------------------------------- */
export const LEGACY_TEXT = {
  en: {
    mode: "APOLLO LEGACY",
    modeSub: "HISTORICAL MISSIONS · 11 · 12 · 15",
    intro: "Three historically inspired challenges on LUNAVIA's landing and EVA systems. History is documented; the gameplay is simplified.",
    start: "START MISSION",
    resume: "RESUME",
    completed: "COMPLETED",
    notYet: "NOT YET COMPLETED",
    crew: "CREW",
    lm: "LUNAR MODULE",
    objective: "HISTORICAL OBJECTIVE",
    science: "SCIENCE",
    difficulty: "LANDING DIFFICULTY",
    begin: "BEGIN DESCENT",
    back: "BACK",
    menu: "MENU",
    dramatized: "RADIO CALLS ARE DRAMATIZED · SYNTHETIC VOICES · NOT ARCHIVAL AUDIO",
    gameplayNote: "GAMEPLAY ADAPTATION",
    history: "THE HISTORY",
    sources: "SOURCES",
    landed: "TOUCHDOWN CONFIRMED",
    landedSub: "SAFE LANDING",
    crashed: "LANDING FAILED",
    retry: "RETRY THE DESCENT",
    prepareEva: "PREPARE EVA",
    precision: "LANDING PRECISION",
    toTarget: "FROM THE TARGET",
    toObject: "TO SURVEYOR 3",
    complete: "HISTORICAL MISSION COMPLETE",
    incomplete: "MISSION NOT COMPLETED",
    results: "APOLLO LEGACY RESULTS",
    separate: "Recorded in Apollo Legacy only: no campaign score, medal or achievement.",
    again: "FLY AGAIN",
    others: "APOLLO LEGACY",
    resumeOf: "UNFINISHED",
    abandon: "ABANDON",
    samples: "SAMPLES",
    photos: "PHOTOGRAPH",
    retrieved: "HARDWARE RETRIEVED",
    instrument: "INSTRUMENT DEPLOYED",
    backInLM: "SAFE RETURN TO THE LM",
    objectivesDone: "OBJECTIVES",
    best: "BEST",
    replaceTitle: "REPLACE THE UNFINISHED HISTORICAL MISSION?",
    replaceSub: (name) => `${name} is saved in Apollo Legacy. Starting another mission discards it. The campaign's own mission is never affected.`,
    replace: "START NEW",
    keep: "KEEP IT",
    leaveTitle: "LEAVE THE EVA?",
    leaveSub: "Progress is saved: RESUME from the Apollo Legacy menu continues at the foot of the ladder.",
    leave: "LEAVE",
    stay: "STAY",
    touchdown: "TOUCHDOWN RATE",
    fuel: "FUEL REMAINING",
    quoteNote: "DOCUMENTED QUOTATION · TEXT ONLY",
    completions: "COMPLETIONS",
    saved: "CHECKPOINT SAVED",
    reason: "CAUSE",
    walked: "DISTANCE WALKED",
    checkpointAt: { DESCENT: "DESCENT", LANDED: "ON THE SURFACE", EVA: "EVA IN PROGRESS" },
    roverNote: "No rover in LUNAVIA yet: this traverse is on foot.",
  },
  pt: {
    mode: "APOLLO LEGACY",
    modeSub: "MISSÕES HISTÓRICAS · 11 · 12 · 15",
    intro: "Três desafios inspirados na história, com os sistemas de pouso e EVA de LUNAVIA. A história é documentada; a jogabilidade é simplificada.",
    start: "INICIAR MISSÃO",
    resume: "RETOMAR",
    completed: "CONCLUÍDA",
    notYet: "AINDA NÃO CONCLUÍDA",
    crew: "TRIPULAÇÃO",
    lm: "MÓDULO LUNAR",
    objective: "OBJETIVO HISTÓRICO",
    science: "CIÊNCIA",
    difficulty: "DIFICULDADE DO POUSO",
    begin: "INICIAR DESCIDA",
    back: "VOLTAR",
    menu: "MENU",
    dramatized: "CHAMADAS DE RÁDIO DRAMATIZADAS · VOZES SINTÉTICAS · NÃO SÃO ÁUDIO DE ARQUIVO",
    gameplayNote: "ADAPTAÇÃO PARA O JOGO",
    history: "A HISTÓRIA",
    sources: "FONTES",
    landed: "POUSO CONFIRMADO",
    landedSub: "POUSO SEGURO",
    crashed: "POUSO FALHOU",
    retry: "REPETIR A DESCIDA",
    prepareEva: "PREPARAR EVA",
    precision: "PRECISÃO DO POUSO",
    toTarget: "DO ALVO",
    toObject: "ATÉ A SURVEYOR 3",
    complete: "MISSÃO HISTÓRICA CONCLUÍDA",
    incomplete: "MISSÃO NÃO CONCLUÍDA",
    results: "RESULTADOS APOLLO LEGACY",
    separate: "Registrado apenas no Apollo Legacy: sem pontuação, medalha ou conquista da campanha.",
    again: "VOAR DE NOVO",
    others: "APOLLO LEGACY",
    resumeOf: "INACABADA",
    abandon: "ABANDONAR",
    samples: "AMOSTRAS",
    photos: "FOTOGRAFIA",
    retrieved: "EQUIPAMENTO RECUPERADO",
    instrument: "INSTRUMENTO INSTALADO",
    backInLM: "RETORNO SEGURO AO LM",
    objectivesDone: "OBJETIVOS",
    best: "MELHOR",
    replaceTitle: "SUBSTITUIR A MISSÃO HISTÓRICA INACABADA?",
    replaceSub: (name) => `${name} está salva no Apollo Legacy. Iniciar outra missão a descarta. A missão da campanha nunca é afetada.`,
    replace: "INICIAR NOVA",
    keep: "MANTER",
    leaveTitle: "SAIR DA EVA?",
    leaveSub: "O progresso está salvo: RETOMAR no menu do Apollo Legacy continua ao pé da escada.",
    leave: "SAIR",
    stay: "FICAR",
    touchdown: "VELOCIDADE NO TOQUE",
    fuel: "COMBUSTÍVEL RESTANTE",
    quoteNote: "CITAÇÃO DOCUMENTADA · APENAS TEXTO",
    completions: "CONCLUSÕES",
    saved: "PONTO DE CONTROLE SALVO",
    reason: "CAUSA",
    walked: "DISTÂNCIA PERCORRIDA",
    checkpointAt: { DESCENT: "DESCIDA", LANDED: "NA SUPERFÍCIE", EVA: "EVA EM ANDAMENTO" },
    roverNote: "LUNAVIA ainda não tem rover: esta travessia é a pé.",
  },
};
export const legacyText = (lang) => LEGACY_TEXT[lang === "pt" ? "pt" : "en"];
export const DEFAULT_LEGACY_AREA = AREA;
