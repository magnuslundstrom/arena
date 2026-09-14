const abilitySounds = new Map<string, HTMLAudioElement[]>();
const poolCursor = new Map<string, number>();
const POOL_SIZE = 3;
const AVAILABLE_SOUNDS = new Set([
  "frostbolt",
  "blink",
  "eviscerate",
  "power-word-shield",
  "flash-heal",
  "renew",
  "dispel-magic",
  "pain-suppression",
  "psychic-scream",
  "mana-burn",
  "shadow-word-death",
  "prayer-of-mending",
]);

function poolFor(abilityId: string) {
  let pool = abilitySounds.get(abilityId);
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const audio = new Audio(`/audio/abilities/${abilityId}.wav`);
      audio.preload = "auto";
      return audio;
    });
    abilitySounds.set(abilityId, pool);
  }
  return pool;
}

/** Play a confirmed ability cue. A small pool allows rapid repeated attacks. */
export function playAbilitySound(abilityId: string, pan = 0, volume = 1) {
  if (!AVAILABLE_SOUNDS.has(abilityId)) return;
  const pool = poolFor(abilityId);
  const cursor = poolCursor.get(abilityId) ?? 0;
  const audio = pool[cursor % pool.length]!;
  poolCursor.set(abilityId, cursor + 1);
  audio.currentTime = 0;
  audio.volume = Math.max(0, Math.min(1, volume * 0.22));

  // StereoPannerNode support is not universal on HTMLMediaElement, so use the
  // portable balance property when a browser exposes it.
  const balanced = audio as HTMLAudioElement & { balance?: number };
  if ("balance" in balanced) balanced.balance = Math.max(-1, Math.min(1, pan));
  void audio.play().catch(() => {
    // Browsers may decline remote-player audio until the first user gesture.
  });
}
