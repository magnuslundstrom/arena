#!/usr/bin/env python3
"""Generate the original, deterministic ability SFX used by the browser client."""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 44_100
OUT = Path(__file__).parents[1] / "apps/client/public/audio/abilities"
SOURCES = Path(__file__).parent / "sfx-sources/cc0"

MAGE = [
    "frostbolt", "ice-lance", "polymorph", "frost-nova", "blink",
    "ice-barrier", "counterspell", "cone-of-cold", "cold-snap",
    "fire-blast", "ice-block",
]
ROGUE = [
    "hemorrhage", "shadowstep", "cheap-shot", "kidney-shot", "gouge",
    "kick", "cloak-of-shadows", "vanish", "evasion", "eviscerate", "stealth",
]
PRIEST = [
    "power-word-shield", "flash-heal", "renew", "dispel-magic",
    "pain-suppression", "psychic-scream", "mana-burn", "shadow-word-death",
    "prayer-of-mending",
]


def envelope(t, duration, attack=.012, release=.22):
    return min(1, t / attack) * min(1, (duration - t) / release)


def tone(t, frequency, sweep=0, phase=0):
    return math.sin(2 * math.pi * (frequency * t + sweep * t * t / 2) + phase)


def lowpass(samples, amount=.93):
    output = []
    state = 0
    for sample in samples:
        state = state * amount + sample * (1 - amount)
        output.append(state)
    return output


def read_mono(path):
    with wave.open(str(path), "rb") as source:
        channels = source.getnchannels()
        assert source.getframerate() == RATE and source.getsampwidth() == 2
        values = struct.unpack(f"<{source.getnframes() * channels}h", source.readframes(source.getnframes()))
    return [sum(values[i:i + channels]) / (32768 * channels) for i in range(0, len(values), channels)]


def sample_based_sound(name):
    source_files = {
        "frostbolt": [("ice/ice.wav", 1.08, 0, .78), ("ice/coldsnap.wav", 1.42, 0, .20)],
        "blink": [("short-wind.wav", 1.85, 0, .92), ("teleport.wav", 2.15, .24, .18), ("body-impact-mono.wav", 1.35, .29, .34)],
        "eviscerate": [("swish-heavy-mono.wav", 1.12, 0, .80), ("swish-light-mono.wav", 1.24, .13, .52), ("body-impact-mono.wav", .72, .27, .96)],
        "power-word-shield": [("short-wind.wav", .68, 0, .58), ("body-impact-mono.wav", .52, .02, .66), ("body-impact-mono.wav", 1.18, .17, .18)],
        "flash-heal": [("short-wind.wav", 1.32, 0, .70), ("teleport.wav", 1.72, .08, .22)],
        "renew": [("short-wind.wav", .88, 0, .58), ("teleport.wav", 1.48, .16, .12)],
        "dispel-magic": [("short-wind.wav", -1.34, 0, .90), ("teleport.wav", -1.92, .02, .20), ("glass-breaking.wav", 2.18, .31, .32)],
        "pain-suppression": [("body-impact-mono.wav", .46, 0, .62), ("short-wind.wav", .72, .04, .50)],
        "psychic-scream": [("teleport.wav", .54, 0, .60), ("short-wind.wav", .61, .05, .54)],
        "mana-burn": [("teleport.wav", .71, 0, .52), ("ice/coldsnap.wav", 1.86, .08, .20)],
        "shadow-word-death": [("ghost-breath-mono.wav", 2.35, 0, .70), ("swish-light-mono.wav", .84, .16, .44), ("body-impact-mono.wav", .54, .25, 1.0)],
        "prayer-of-mending": [("short-wind.wav", 1.04, 0, .62), ("body-impact-mono.wav", 1.34, .23, .25)],
    }
    if name not in source_files:
        return None
    duration = {
        "frostbolt": .88, "blink": .72, "eviscerate": .68,
        "power-word-shield": .92, "flash-heal": .70, "renew": .78,
        "dispel-magic": .58, "pain-suppression": .88,
        "psychic-scream": 1.02, "mana-burn": .84, "shadow-word-death": .62,
        "prayer-of-mending": .76,
    }[name]
    output = [0.0] * int(duration * RATE)
    for filename, speed, offset, gain in source_files[name]:
        source = read_mono(SOURCES / filename)
        start = int(offset * RATE)
        for i in range(start, len(output)):
            position = (
                (i - start) * speed
                if speed > 0
                else (len(source) - 2) + (i - start) * speed
            )
            left = int(position)
            if left < 0 or left + 1 >= len(source):
                break
            fraction = position - left
            sample = source[left] * (1 - fraction) + source[left + 1] * fraction
            output[i] += sample * gain

    rng = random.Random(f"foley-{name}")
    noise = lowpass([rng.uniform(-1, 1) for _ in output], .90)
    for i in range(len(output)):
        t = i / RATE
        if name == "frostbolt":
            output[i] += noise[i] * math.sin(math.pi * t / duration) * .24
            output[i] += tone(t, 104, -42) * math.exp(-t * 7) * .16
        elif name == "blink":
            # A pressure dip leading into the pop, without a pitched sci-fi chirp.
            output[i] += noise[i] * min(1, t / .27) * math.exp(-max(0, t - .31) * 12) * .34
        elif name == "eviscerate" and t < .34:
            output[i] += noise[i] * (math.sin(math.pi * t / .34) ** 2) * .16
        elif name == "power-word-shield":
            # A dense enclosure followed by a brittle seal locking into place.
            output[i] += noise[i] * (1 - math.exp(-t * 28)) * math.exp(-t * 4.8) * .22
        elif name in {"flash-heal", "renew", "prayer-of-mending"}:
            rise = 1 - math.exp(-t * (18 if name == "flash-heal" else 9))
            output[i] += noise[i] * rise * math.exp(-t * (4.2 if name == "flash-heal" else 2.8)) * .30
        elif name == "dispel-magic":
            suction = min(1, t / .30) ** 2
            release = math.exp(-max(0, t - .33) * 18)
            output[i] += noise[i] * suction * release * .34
        elif name == "pain-suppression":
            output[i] += noise[i] * (1 - math.exp(-t * 26)) * math.exp(-t * 2.6) * .28
        elif name in {"psychic-scream", "mana-burn"}:
            output[i] += noise[i] * (1 - math.exp(-t * 12)) * math.exp(-t * 1.9) * .48
        elif name == "shadow-word-death":
            whisper = min(1, t / .20) * math.exp(-max(0, t - .24) * 9)
            output[i] += noise[i] * whisper * .24

    # Remove DC, tame the top edge, and fade cleanly to silence.
    mean = sum(output) / len(output)
    output = lowpass([x - mean for x in output], .18)
    fade = int(.06 * RATE)
    for i in range(fade):
        output[-1 - i] *= i / fade
    peak = max(abs(sample) for sample in output) or 1
    return output, .72 / peak


def designed_sound(name):
    """Hand-designed reference cues: weighty, soft-edged, and intentionally dry."""
    durations = {
        "frostbolt": .72,
        "blink": .48,
        "eviscerate": .58,
        "power-word-shield": .82,
    }
    if name not in durations:
        return None
    duration = durations[name]
    count = int(RATE * duration)
    rng = random.Random(name)
    raw_noise = [rng.uniform(-1, 1) for _ in range(count)]
    soft_noise = lowpass(raw_noise, .88)
    samples = []
    for n in range(count):
        t = n / RATE
        if name == "frostbolt":
            # A dense cold launch, then a few irregular ice fragments.
            body = tone(t, 118, -48) * math.exp(-t * 5.2) * .54
            wind_env = math.sin(math.pi * min(1, t / duration)) ** 1.4
            wind = soft_noise[n] * wind_env * .82
            shards = 0
            for at, pitch in ((.08, 1060), (.15, 790), (.29, 1240), (.43, 930)):
                age = t - at
                if age >= 0:
                    shards += tone(age, pitch, -230) * math.exp(-age * 31) * .14
            value = body + wind + shards
        elif name == "blink":
            # Reverse-like air suction into a compact, low teleport snap.
            swell = (min(1, t / .27) ** 2) * (1 if t < .29 else math.exp(-(t - .29) * 25))
            air = soft_noise[n] * swell * .76
            phase = max(0, t - .255)
            snap = tone(phase, 185, -310) * math.exp(-phase * 18) * .55 if phase else 0
            value = air + snap
        elif name == "eviscerate":
            # Two broad blade passes followed by a blunt leather/body impact.
            slash = 0
            for at, length in ((.03, .17), (.16, .19)):
                age = t - at
                if 0 <= age <= length:
                    shape = math.sin(math.pi * age / length) ** 2
                    slash += soft_noise[n] * shape * 1.2
                    slash += tone(age, 720, -2100) * shape * .17
            age = t - .29
            impact = (tone(age, 92, -95) * .68 + soft_noise[n] * .75) * math.exp(-age * 15) if age >= 0 else 0
            value = slash + impact
        else:
            # Warm protective bloom with a restrained glass overtone.
            bloom = (1 - math.exp(-t * 20)) * math.exp(-t * 2.9)
            chord = (
                tone(t, 196) * .32 + tone(t, 294, -8) * .22 + tone(t, 392, -13) * .14
            ) * bloom
            glass = tone(t, 784, -90) * math.exp(-t * 7.5) * .10
            breath = soft_noise[n] * bloom * .28
            value = chord + glass + breath
        samples.append(value)

    # Smooth the harshest digital edge while retaining the transient.
    smoothed = lowpass(samples, .42)
    peak = max(abs(sample) for sample in smoothed) or 1
    return smoothed, .66 / peak


def make_sound(name, family, index):
    designed = sample_based_sound(name) or designed_sound(name)
    if designed:
        frames, gain = designed
        pcm = bytearray()
        for sample in frames:
            mono = max(-1, min(1, sample * gain))
            pcm.extend(struct.pack("<hh", int(mono * 32767), int(mono * .985 * 32767)))
        return pcm
    seed = sum((i + 1) * ord(c) for i, c in enumerate(name))
    rng = random.Random(seed)
    duration = .46 + (seed % 31) / 100
    if name in {"ice-block", "psychic-scream", "mass-dispel", "vanish"}:
        duration += .32
    frames = []
    noise_state = 0
    for n in range(int(RATE * duration)):
        t = n / RATE
        e = envelope(t, duration)
        white = rng.uniform(-1, 1)
        noise_state = noise_state * .82 + white * .18

        if family == "mage":
            base = 520 + index * 31
            shimmer = tone(t, base, 360) * .34 + tone(t, base * 2.03, -90) * .18
            crystals = tone(t, 1550 + index * 73, 850) * math.exp(-t * 8) * .30
            wind = noise_state * .23 * math.sin(math.pi * min(1, t / duration))
            value = shimmer + crystals + wind
            if name == "fire-blast":
                value = noise_state * math.exp(-t * 5) * .65 + tone(t, 180, -100) * .35
            elif name == "blink":
                value = tone(t, 320, 1900) * .38 + tone(t, 900, 2600) * .22
            elif name == "polymorph":
                value += tone(t, 760 + 110 * math.sin(t * 22), 80) * .28
        elif family == "rogue":
            hit = math.exp(-t * (13 + index % 4))
            blade = tone(t, 2200 + index * 61, -1300) * hit * .40
            cut = white * hit * .42
            shadow = noise_state * math.sin(math.pi * t / duration) * .25
            value = blade + cut + shadow
            if name in {"stealth", "vanish", "cloak-of-shadows", "shadowstep"}:
                value = noise_state * .38 * math.sin(math.pi * t / duration) + tone(t, 410, -260) * .18
            elif name in {"kidney-shot", "kick"}:
                value += tone(t, 105, -55) * math.exp(-t * 14) * .55
            elif name == "eviscerate":
                value += tone(t, 135, -80) * math.exp(-t * 6) * .55
        else:
            base = 430 + index * 29
            holy = tone(t, base, 70) * .30 + tone(t, base * 1.5, 30) * .23
            bell = tone(t, 1050 + index * 47, -35) * math.exp(-t * 4) * .27
            air = noise_state * .10
            value = holy + bell + air
            if name in {"psychic-scream", "mana-burn", "shadow-word-death"}:
                value = tone(t, 190 + index * 8, -115) * .36 + noise_state * .31
                value += tone(t, 680, -420) * math.exp(-t * 3) * .22
            elif name in {"dispel-magic", "mass-dispel"}:
                value += tone(t, 1250, -900) * .25

        # A quiet signature pitch makes every cue distinct within its family.
        value += tone(t, 285 + (seed % 190), (index % 3 - 1) * 55) * .09
        value *= e
        frames.append(value)

    peak = max(abs(sample) for sample in frames) or 1
    gain = .82 / peak
    pcm = bytearray()
    for sample in frames:
        mono = max(-1, min(1, sample * gain))
        # Tiny deterministic stereo spread keeps the cues spacious on headphones.
        left = int(mono * 32767)
        right = int(mono * (0.96 + (index % 3) * .015) * 32767)
        pcm.extend(struct.pack("<hh", left, right))
    return pcm


def write(name, family, index):
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(make_sound(name, family, index))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for family, names in (("mage", ["frostbolt", "blink"]), ("rogue", ["eviscerate"]), ("priest", PRIEST)):
        for index, name in enumerate(names):
            write(name, family, index)
    print(f"Generated {3 + len(PRIEST)} approved/sample-based sounds in {OUT}")


if __name__ == "__main__":
    main()
