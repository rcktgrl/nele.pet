const DEFAULT_RESEARCH_NODES = [
  {
    "id": "duo",
    "title": "Duo",
    "cost": 1000,
    "desc": "Fusion aus Basic und Basic.",
    "recipe": "Basic + Basic",
    "x": 580,
    "y": 20
  },
  {
    "id": "trio",
    "title": "Trio",
    "cost": 5000,
    "desc": "Fusion aus Basic und Shotgun.",
    "recipe": "Basic + Shotgun",
    "x": 580,
    "y": 140
  },
  {
    "id": "basesniper",
    "title": "Basesniper",
    "cost": 1000,
    "desc": "Fusion aus Basic und Sniper.",
    "recipe": "Basic + Sniper",
    "x": 340,
    "y": 460
  },
  {
    "id": "snipegun",
    "title": "Snipegun",
    "cost": 10000,
    "desc": "Fusion aus Sniper und Shotgun.",
    "recipe": "Sniper + Shotgun",
    "x": 560,
    "y": 580
  },
  {
    "id": "tesla",
    "title": "Tesla Tower",
    "cost": 20000,
    "desc": "Langsamer Hitscan-Turm mit Kettenblitzen.",
    "recipe": "Langsamer Hitscan-Turm mit Kettenblitzen.",
    "x": 820,
    "y": 300
  },
  {
    "id": "longsniper",
    "title": "Longsniper",
    "cost": 6000,
    "desc": "Fusion aus Sniper und Sniper mit unendlicher Reichweite.",
    "recipe": "Fusion aus Sniper und Sniper mit unendlicher Reichweite.",
    "x": 560,
    "y": 460
  },
  {
    "id": "bombus",
    "title": "Bombus",
    "cost": 60000,
    "desc": "Mäßige Feuerrate, explosive Schüsse, hoher Schaden.",
    "recipe": "Bombus Tower",
    "x": 1220,
    "y": 300,
    "unlockScore": 10000
  },
  {
    "id": "mortar",
    "title": "Mortar",
    "cost": 50000,
    "desc": "Fusion aus Bombus und Sniper. Langsames Einschlagsprojektil, 300 Flächenschaden und 0.25s Stun.",
    "recipe": "Bombus + Sniper",
    "x": 820,
    "y": 580,
    "unlockScore": 15000
  },
  {
    "id": "basic_upgrade",
    "title": "Basic Upgrade",
    "cost": 4000,
    "desc": "Basic macht 20% mehr Schaden.",
    "recipe": "Basic Upgrade",
    "x": 40,
    "y": 20
  },
  {
    "id": "shotgun_upgrade",
    "title": "Shotgun Upgrade",
    "cost": 15000,
    "desc": "Shotgun macht +1 Schaden.",
    "recipe": "Shotgun Upgrade",
    "x": 40,
    "y": 220
  },
  {
    "id": "duo_upgrade",
    "title": "Duo Upgrade",
    "cost": 18000,
    "desc": "Braucht erst Basic Upgrade. Jede dritte Salve feuert direkt nochmal 2 Schüsse hinterher.",
    "recipe": "Braucht erst Basic Upgrade. Jede dritte Salve feuert direkt nochmal 2 Schüsse hinterher.",
    "x": 340,
    "y": 20
  },
  {
    "id": "sniper_upgrade",
    "title": "Sniper Upgrade",
    "cost": 8000,
    "desc": "Nach 5 Sekunden ohne Schuss macht der nächste Sniper-Schuss doppelten Schaden.",
    "recipe": "Sniper Upgrade",
    "x": 40,
    "y": 120
  },
  {
    "id": "rapid_upgrade",
    "title": "Rapid Upgrade",
    "cost": 7000,
    "desc": "Rapid lädt 30% schneller nach.",
    "recipe": "Rapid Upgrade",
    "x": 40,
    "y": 320
  },
  {
    "id": "ring",
    "title": "Ring",
    "cost": 7500,
    "desc": "Fusion aus Rapid und Shotgun. 24 Kanonen in alle Richtungen, feuert periodisch rundum wenn Gegner in der Nähe sind.",
    "recipe": "Rapid + Shotgun",
    "x": 120,
    "y": 580
  },
  {
    "id": "inferno",
    "title": "Inferno",
    "cost": 75000,
    "desc": "Fusion aus Bombus und Tesla mit rotem Laser-Targeting und stackendem Schaden auf ein festes Ziel.",
    "recipe": "Bombus + Tesla",
    "x": 1020,
    "y": 140
  },
  {
    "id": "longsniper_upgrade",
    "title": "Longsniper Upgrade",
    "cost": 20000,
    "desc": "Braucht erst Sniper Upgrade. Für je 75 Flugdistanz macht der Schuss +3 Schaden.",
    "recipe": "Braucht erst Sniper Upgrade. Für je 75 Flugdistanz macht der Schuss +3 Schaden.",
    "x": 340,
    "y": 120
  },
  {
    "id": "spraysic",
    "title": "Spraysic",
    "cost": 5000,
    "desc": "Fusion aus Rapid und Basic mit starkem Spread.",
    "recipe": "Rapid + Basic",
    "x": 120,
    "y": 460
  },
  {
    "id": "stormfork",
    "title": "Stormfork",
    "cost": 30000,
    "desc": "Fusion aus Duo und Tesla.",
    "recipe": "Duo + Tesla",
    "x": 820,
    "y": 140
  },
  {
    "id": "quicksniper",
    "title": "Quicksniper",
    "cost": 30000,
    "desc": "Fusion aus Rapid und Basesniper.",
    "recipe": "Rapid + Basesniper",
    "x": 340,
    "y": 580
  },
  {
    "id": "railgun",
    "title": "Railgun",
    "cost": 50000,
    "desc": "Fusion aus Longsniper und Tesla.",
    "recipe": "Longsniper + Tesla",
    "x": 820,
    "y": 460
  },
  {
    "id": "laser",
    "title": "Laser",
    "cost": 25000,
    "desc": "Fusion aus Tesla und Tesla.",
    "recipe": "Tesla + Tesla",
    "x": 1020,
    "y": 460
  },
  {
    "id": "pulselaser",
    "title": "Pulselaser",
    "cost": 35000,
    "desc": "Fusion aus Laser und Sniper.",
    "recipe": "Laser + Sniper",
    "x": 1220,
    "y": 460
  },
  {
    "id": "flamethrower",
    "title": "Flamethrower",
    "cost": 25000,
    "desc": "Base-Tower mit großen Piercing-Schüssen und leichter Ungenauigkeit.",
    "recipe": "Flamethrower Tower",
    "x": 1020,
    "y": 220,
    "unlockScore": 7500
  },
  {
    "id": "rituals",
    "title": "Rituals",
    "cost": 1000,
    "desc": "Erlaubt Rituale wie Penta.",
    "recipe": "Ritualsystem",
    "x": 1080,
    "y": 20,
    "unlockScore": 500
  }
];

const DEFAULT_RESEARCH_EDGES = [
  {
    "from": "basic_upgrade",
    "to": "duo_upgrade"
  },
  {
    "from": "duo",
    "to": "duo_upgrade"
  },
  {
    "from": "duo",
    "to": "trio"
  },
  {
    "from": "tesla",
    "to": "inferno"
  },
  {
    "from": "bombus",
    "to": "inferno"
  },
  {
    "from": "bombus",
    "to": "mortar"
  },
  {
    "from": "longsniper",
    "to": "mortar"
  },
  {
    "from": "duo",
    "to": "stormfork"
  },
  {
    "from": "tesla",
    "to": "stormfork"
  },
  {
    "from": "basesniper",
    "to": "quicksniper"
  },
  {
    "from": "tesla",
    "to": "railgun"
  },
  {
    "from": "sniper_upgrade",
    "to": "longsniper_upgrade"
  },
  {
    "from": "longsniper",
    "to": "railgun"
  },
  {
    "from": "tesla",
    "to": "laser"
  },
  {
    "from": "laser",
    "to": "pulselaser"
  }
];
