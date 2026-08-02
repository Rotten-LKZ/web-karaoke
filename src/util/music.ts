/** 频率 → MIDI note number（浮点，A4=440Hz=69）。 */
export const freqToMidi = (freq: number): number =>
  69 + 12 * Math.log2(freq / 440);

/** MIDI note number → 频率（A4=69=440Hz）。 */
export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** 应用半音偏移。 */
export const applySemitones = (midi: number, semitones: number): number =>
  midi + semitones;

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** MIDI note → 名称（如 60 → "C4"，61 → "C#4"）。 */
export const midiToName = (midi: number): string =>
  `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
