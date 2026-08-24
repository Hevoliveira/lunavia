"""LUNAVIA — canonical Earth→Moon mission profile.

Numbers are simplified but rooted in Apollo-class free-return trajectories:
- LEO parking orbit ~185 km
- TLI Δv ~3.14 km/s from LEO to translunar coast
- Cislunar coast ~72 hours
- LOI Δv ~0.91 km/s into 100 km lunar orbit
- TEI Δv ~1.07 km/s
- Reentry ~10.9 km/s at 400,000 ft
"""

MISSION_PHASES = [
    {
        "id": "p01",
        "code": "T-00:10:00",
        "name": "PRELAUNCH",
        "t_plus_seconds": -600,
        "duration_seconds": 600,
        "delta_v_ms": 0.0,
        "altitude_km": 0.0,
        "velocity_kms": 0.0,
        "location": "CAPE CANAVERAL — 28.5°N",
        "objective": "Sistemas armados. Contagem regressiva final.",
        "description": (
            "Verificação de propelentes, telemetria e trajetória de janela de lançamento. "
            "A rotação da Terra dá 0.465 km/s de bônus para o leste; por isso lançamos "
            "para 28.5° N em direção leste."
        ),
    },
    {
        "id": "p02",
        "code": "T+00:00:00",
        "name": "LIFTOFF",
        "t_plus_seconds": 0,
        "duration_seconds": 160,
        "delta_v_ms": 2400.0,
        "altitude_km": 0.0,
        "velocity_kms": 0.0,
        "location": "TROPOSFERA → ESTRATOSFERA",
        "objective": "Vencer a maior parte do arrasto atmosférico.",
        "description": (
            "O primeiro estágio queima empuxo máximo enquanto o veículo executa o pitch-over "
            "programado. A pressão dinâmica máxima (Max-Q) ocorre em torno de T+80 s."
        ),
    },
    {
        "id": "p03",
        "code": "T+00:11:30",
        "name": "LEO INSERTION",
        "t_plus_seconds": 690,
        "duration_seconds": 60,
        "delta_v_ms": 7800.0,
        "altitude_km": 185.0,
        "velocity_kms": 7.79,
        "location": "ÓRBITA BAIXA DA TERRA",
        "objective": "Órbita de estacionamento 185 × 185 km.",
        "description": (
            "Inserção na órbita circular baixa. A partir daqui o veículo aguarda o alinhamento "
            "correto entre o plano orbital e a posição futura da Lua para iniciar a queima translunar."
        ),
    },
    {
        "id": "p04",
        "code": "T+02:44:00",
        "name": "TLI — TRANS-LUNAR INJECTION",
        "t_plus_seconds": 9840,
        "duration_seconds": 350,
        "delta_v_ms": 3140.0,
        "altitude_km": 320.0,
        "velocity_kms": 10.83,
        "location": "SAÍDA DA ÓRBITA DA TERRA",
        "objective": "Injeção em elipse Terra–Lua.",
        "description": (
            "Queima de escape parcial. A velocidade sobe de 7.79 para ~10.83 km/s: apenas o "
            "suficiente para uma órbita altamente elíptica cujo apogeu cruza a órbita da Lua "
            "aproximadamente 72 horas depois. Se o instante estiver errado, a Lua não estará lá."
        ),
    },
    {
        "id": "p05",
        "code": "T+03:00:00",
        "name": "CISLUNAR CRUISE",
        "t_plus_seconds": 10800,
        "duration_seconds": 255600,
        "delta_v_ms": 0.0,
        "altitude_km": 200000.0,
        "velocity_kms": 1.20,
        "location": "ESPAÇO CISLUNAR",
        "objective": "Coasting balístico até a esfera de influência lunar.",
        "description": (
            "Motor desligado. A gravidade da Terra desacelera continuamente a nave até o ponto de "
            "empate gravitacional (~326 000 km), depois a gravidade da Lua começa a acelerá-la. "
            "Pequenas correções de curso (MCCs) refinam a chegada."
        ),
    },
    {
        "id": "p06",
        "code": "T+75:56:00",
        "name": "LOI — LUNAR ORBIT INSERTION",
        "t_plus_seconds": 273360,
        "duration_seconds": 380,
        "delta_v_ms": 910.0,
        "altitude_km": 110.0,
        "velocity_kms": 1.68,
        "location": "PERIAPSE LUNAR",
        "objective": "Capturar-se pela gravidade da Lua.",
        "description": (
            "Queima retrógrada no periápsis da trajetória de chegada. Sem essa queima, a nave "
            "passaria pela Lua num hipérbole e voltaria à Terra (trajetória de retorno livre). "
            "Com a queima, entra em órbita de ~110 km circular."
        ),
    },
    {
        "id": "p07",
        "code": "T+80:00:00",
        "name": "LUNAR ORBIT",
        "t_plus_seconds": 288000,
        "duration_seconds": 216000,
        "delta_v_ms": 0.0,
        "altitude_km": 100.0,
        "velocity_kms": 1.63,
        "location": "ÓRBITA LUNAR",
        "objective": "Operações lunares, observação, alinhamento para retorno.",
        "description": (
            "Órbita circular de 100 km sobre a Lua. Período orbital de ~118 minutos. Cada volta "
            "atravessa 60 minutos de dia lunar e 58 minutos de noite absoluta."
        ),
    },
    {
        "id": "p08",
        "code": "T+140:00:00",
        "name": "TEI — TRANS-EARTH INJECTION",
        "t_plus_seconds": 504000,
        "duration_seconds": 210,
        "delta_v_ms": 1070.0,
        "altitude_km": 100.0,
        "velocity_kms": 2.55,
        "location": "SAÍDA DA ÓRBITA LUNAR",
        "objective": "Injeção na elipse de retorno para a Terra.",
        "description": (
            "Queima prógrada no lado apropriado da órbita lunar para colocar a nave numa "
            "trajetória cujo periápsis intercepta a atmosfera terrestre 60 horas depois."
        ),
    },
    {
        "id": "p09",
        "code": "T+195:00:00",
        "name": "REENTRY & SPLASHDOWN",
        "t_plus_seconds": 702000,
        "duration_seconds": 900,
        "delta_v_ms": 0.0,
        "altitude_km": 122.0,
        "velocity_kms": 10.9,
        "location": "INTERFACE ATMOSFÉRICA",
        "objective": "Dissipar energia orbital como calor. Voltar para casa.",
        "description": (
            "A cápsula entra na atmosfera a 10.9 km/s — 32× a velocidade do som. O escudo "
            "térmico dissipa a energia cinética como plasma incandescente. Paraquedas abrem a "
            "~7 km de altitude. Amerissagem no Pacífico."
        ),
    },
]
