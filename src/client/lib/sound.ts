/**
 * Sound effects, synthesised.
 *
 * Every tone is generated with the Web Audio API rather than loaded from a
 * file: nothing to download, nothing to license, and the whole kit costs a few
 * hundred bytes. The audio context is created on first use because browsers
 * refuse to start one before a user gesture.
 */

import { readStored, writeStored } from './storage';

type Note = { frequency: number; at: number; duration: number; gain?: number; type?: OscillatorType };

let context: AudioContext | null = null;
let muted = readStored('muted') === '1';

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  writeStored('muted', value ? '1' : '0');
}

function ensureContext(): AudioContext | null {
  if (muted) return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function play(notes: Note[]): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime;

  for (const note of notes) {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = note.type ?? 'triangle';
    oscillator.frequency.value = note.frequency;

    const peak = note.gain ?? 0.08;
    const at = start + note.at;
    // A short attack and exponential decay keeps it soft rather than clicky.
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);

    oscillator.connect(envelope).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + note.duration + 0.02);
  }
}

export const sounds = {
  flip: () => play([{ frequency: 320, at: 0, duration: 0.08, type: 'square', gain: 0.05 }]),
  select: () => play([{ frequency: 660, at: 0, duration: 0.06, gain: 0.05 }]),
  win: () =>
    play([
      { frequency: 523.25, at: 0, duration: 0.12 },
      { frequency: 783.99, at: 0.09, duration: 0.22 },
    ]),
  lose: () =>
    play([
      { frequency: 392, at: 0, duration: 0.14 },
      { frequency: 261.63, at: 0.1, duration: 0.26 },
    ]),
  draw: () =>
    play([
      { frequency: 466.16, at: 0, duration: 0.1 },
      { frequency: 466.16, at: 0.14, duration: 0.16 },
    ]),
  victory: () =>
    play([
      { frequency: 523.25, at: 0, duration: 0.12 },
      { frequency: 659.25, at: 0.11, duration: 0.12 },
      { frequency: 783.99, at: 0.22, duration: 0.12 },
      { frequency: 1046.5, at: 0.33, duration: 0.4 },
    ]),
  defeat: () =>
    play([
      { frequency: 392, at: 0, duration: 0.16 },
      { frequency: 349.23, at: 0.14, duration: 0.16 },
      { frequency: 261.63, at: 0.28, duration: 0.5 },
    ]),
};
