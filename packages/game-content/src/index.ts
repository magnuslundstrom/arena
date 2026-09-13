export type SpecId = "frost-mage" | "subtlety-rogue" | "discipline-priest";
export type AbilityTarget = "enemy" | "ally" | "self" | "point";
export type EffectKind =
  | "damage"
  | "heal"
  | "shield"
  | "stun"
  | "fear"
  | "polymorph"
  | "root"
  | "silence"
  | "slow"
  | "teleport"
  | "stealth"
  | "immunity"
  | "damage-reduction"
  | "evasion"
  | "cloak"
  | "dispel"
  | "reset-cooldowns";

export interface AbilityEffect {
  readonly kind: EffectKind;
  readonly amount?: number;
  readonly durationTicks?: number;
}

export interface AbilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly target: AbilityTarget;
  readonly range: number;
  readonly cooldownTicks: number;
  readonly castTicks: number;
  readonly manaCost: number;
  readonly effects: readonly AbilityEffect[];
}

export interface SpecDefinition {
  readonly id: SpecId;
  readonly name: string;
  readonly color: string;
  readonly maxHealth: number;
  readonly maxMana: number;
  readonly speed: number;
  readonly abilities: readonly AbilityDefinition[];
}

const s = (value: number) => value * 30;
const a = (
  id: string,
  name: string,
  target: AbilityTarget,
  range: number,
  cooldownTicks: number,
  castTicks: number,
  manaCost: number,
  effects: readonly AbilityEffect[],
): AbilityDefinition => ({
  id,
  name,
  target,
  range,
  cooldownTicks,
  castTicks,
  manaCost,
  effects,
});

export const SPECS: Readonly<Record<SpecId, SpecDefinition>> = {
  "frost-mage": {
    id: "frost-mage",
    name: "Frost Mage",
    color: "#66ccff",
    maxHealth: 1900,
    maxMana: 2800,
    speed: 11,
    abilities: [
      a("frostbolt", "Frostbolt", "enemy", 1700, 0, 36, 120, [
        { kind: "damage", amount: 260 },
        { kind: "slow", durationTicks: s(5) },
      ]),
      a("ice-lance", "Ice Lance", "enemy", 1400, 0, 0, 80, [
        { kind: "damage", amount: 120 },
      ]),
      a("polymorph", "Polymorph", "enemy", 1500, 0, 45, 160, [
        { kind: "polymorph", durationTicks: s(8) },
      ]),
      a("frost-nova", "Frost Nova", "enemy", 700, s(21), 0, 140, [
        { kind: "root", durationTicks: s(5) },
      ]),
      a("blink", "Blink", "point", 650, s(15), 0, 100, [
        { kind: "teleport", amount: 650 },
      ]),
      a("ice-barrier", "Ice Barrier", "self", 0, s(30), 0, 180, [
        { kind: "shield", amount: 500 },
      ]),
      a("counterspell", "Counterspell", "enemy", 1400, s(24), 0, 0, [
        { kind: "silence", durationTicks: s(4) },
      ]),
      a("cone-of-cold", "Cone of Cold", "enemy", 650, s(10), 0, 130, [
        { kind: "damage", amount: 180 },
        { kind: "slow", durationTicks: s(5) },
      ]),
      a("cold-snap", "Cold Snap", "self", 0, s(120), 0, 0, [
        { kind: "reset-cooldowns" },
      ]),
      a("fire-blast", "Fire Blast", "enemy", 1200, s(8), 0, 150, [
        { kind: "damage", amount: 210 },
      ]),
      a("ice-block", "Ice Block", "self", 0, s(240), 0, 0, [
        { kind: "dispel" },
        { kind: "immunity", durationTicks: s(10) },
      ]),
    ],
  },
  "subtlety-rogue": {
    id: "subtlety-rogue",
    name: "Subtlety Rogue",
    color: "#e7cc80",
    maxHealth: 2200,
    maxMana: 100,
    speed: 13,
    abilities: [
      a("hemorrhage", "Hemorrhage", "enemy", 180, 0, 0, 25, [
        { kind: "damage", amount: 150 },
      ]),
      a("shadowstep", "Shadowstep", "enemy", 1000, s(30), 0, 10, [
        { kind: "teleport", amount: 100 },
      ]),
      a("cheap-shot", "Cheap Shot", "enemy", 180, 0, 0, 40, [
        { kind: "damage", amount: 70 },
        { kind: "stun", durationTicks: s(4) },
      ]),
      a("kidney-shot", "Kidney Shot", "enemy", 180, s(20), 0, 25, [
        { kind: "stun", durationTicks: s(5) },
      ]),
      a("gouge", "Gouge", "enemy", 180, s(10), 0, 30, [
        { kind: "polymorph", durationTicks: s(4) },
      ]),
      a("kick", "Kick", "enemy", 180, s(10), 0, 25, [
        { kind: "silence", durationTicks: s(3) },
      ]),
      a("cloak-of-shadows", "Cloak of Shadows", "self", 0, s(60), 0, 0, [
        { kind: "dispel" },
        { kind: "cloak", durationTicks: s(5) },
      ]),
      a("vanish", "Vanish", "self", 0, s(120), 0, 0, [
        { kind: "stealth", durationTicks: s(10) },
      ]),
      a("evasion", "Evasion", "self", 0, s(120), 0, 0, [
        { kind: "evasion", durationTicks: s(15) },
      ]),
      a("eviscerate", "Eviscerate", "enemy", 180, 0, 0, 35, [
        { kind: "damage", amount: 330 },
      ]),
      a("stealth", "Stealth", "self", 0, s(10), 0, 0, [
        { kind: "stealth", durationTicks: s(600) },
      ]),
    ],
  },
  "discipline-priest": {
    id: "discipline-priest",
    name: "Discipline Priest",
    color: "#ffffff",
    maxHealth: 2100,
    maxMana: 3400,
    speed: 11,
    abilities: [
      a("power-word-shield", "Power Word: Shield", "ally", 1500, s(4), 0, 180, [
        { kind: "shield", amount: 450 },
      ]),
      a("flash-heal", "Flash Heal", "ally", 1500, 0, 30, 220, [
        { kind: "heal", amount: 420 },
      ]),
      a("renew", "Renew", "ally", 1500, 0, 0, 160, [
        { kind: "heal", amount: 230 },
      ]),
      a("dispel-magic", "Dispel Magic", "ally", 1500, s(8), 0, 130, [
        { kind: "dispel" },
      ]),
      a("mass-dispel", "Mass Dispel", "ally", 1500, s(15), 30, 280, [
        { kind: "dispel" },
        { kind: "shield", amount: 100 },
      ]),
      a("pain-suppression", "Pain Suppression", "ally", 1500, s(120), 0, 100, [
        { kind: "damage-reduction", durationTicks: s(8) },
      ]),
      a("psychic-scream", "Psychic Scream", "enemy", 650, s(30), 0, 180, [
        { kind: "fear", durationTicks: s(6) },
      ]),
      a("mana-burn", "Mana Burn", "enemy", 1500, 0, 60, 100, [
        { kind: "damage", amount: 180 },
      ]),
      a(
        "shadow-word-death",
        "Shadow Word: Death",
        "enemy",
        1400,
        s(12),
        0,
        120,
        [{ kind: "damage", amount: 250 }],
      ),
      a("prayer-of-mending", "Prayer of Mending", "ally", 1500, s(10), 0, 210, [
        { kind: "heal", amount: 320 },
      ]),
    ],
  },
};

export const SPEC_IDS = Object.keys(SPECS) as SpecId[];
export function getAbility(specId: SpecId, abilityId: string) {
  return SPECS[specId].abilities.find((ability) => ability.id === abilityId);
}
