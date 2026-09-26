'use client'

/**
 * Generated sound cues, so the app ships with no audio assets.
 *
 * The AudioContext is created lazily on the first user gesture, which is what
 * browsers require before audio can play.
 */

type Cue = 'call' | 'reveal' | 'mark' | 'accept' | 'reject' | 'win' | 'tick'

let ctx: AudioContext | null = null
let muted = false

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function setMuted(value: boolean): void {
  muted = value
}

export function isMuted(): boolean {
  return muted
}

/** Must be called from a click handler so the first cue is not swallowed. */
export function primeAudio(): void {
  context()
}

interface Note {
  freq: number
  at: number
  duration: number
  type: OscillatorType
  gain: number
}

const CUES: Record<Cue, Note[]> = {
  tick: [{ freq: 880, at: 0, duration: 0.05, type: 'square', gain: 0.06 }],
  call: [
    { freq: 523.25, at: 0, duration: 0.12, type: 'triangle', gain: 0.12 },
    { freq: 783.99, at: 0.1, duration: 0.16, type: 'triangle', gain: 0.12 },
  ],
  reveal: [
    { freq: 392, at: 0, duration: 0.18, type: 'sawtooth', gain: 0.1 },
    { freq: 587.33, at: 0.12, duration: 0.28, type: 'sawtooth', gain: 0.1 },
  ],
  mark: [{ freq: 1046.5, at: 0, duration: 0.04, type: 'sine', gain: 0.05 }],
  accept: [
    { freq: 523.25, at: 0, duration: 0.1, type: 'square', gain: 0.1 },
    { freq: 659.25, at: 0.09, duration: 0.1, type: 'square', gain: 0.1 },
    { freq: 880, at: 0.18, duration: 0.22, type: 'square', gain: 0.12 },
  ],
  reject: [
    { freq: 220, at: 0, duration: 0.18, type: 'sawtooth', gain: 0.12 },
    { freq: 155.56, at: 0.14, duration: 0.26, type: 'sawtooth', gain: 0.12 },
  ],
  win: [
    { freq: 523.25, at: 0, duration: 0.16, type: 'triangle', gain: 0.14 },
    { freq: 659.25, at: 0.14, duration: 0.16, type: 'triangle', gain: 0.14 },
    { freq: 783.99, at: 0.28, duration: 0.16, type: 'triangle', gain: 0.14 },
    { freq: 1046.5, at: 0.42, duration: 0.5, type: 'triangle', gain: 0.16 },
  ],
}

export function play(cue: Cue): void {
  if (muted) return
  const audio = context()
  if (!audio) return

  const now = audio.currentTime
  for (const note of CUES[cue]) {
    const osc = audio.createOscillator()
    const amp = audio.createGain()
    osc.type = note.type
    osc.frequency.setValueAtTime(note.freq, now + note.at)
    amp.gain.setValueAtTime(0.0001, now + note.at)
    amp.gain.exponentialRampToValueAtTime(note.gain, now + note.at + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration)
    osc.connect(amp).connect(audio.destination)
    osc.start(now + note.at)
    osc.stop(now + note.at + note.duration + 0.02)
  }
}

/** Read the clue out loud through the host machine's speakers. */
export function speak(text: string): void {
  if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.05
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  } catch {
    // Speech is a nice-to-have; ignore any failure.
  }
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
}
