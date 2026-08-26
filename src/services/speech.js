/* ============================================================
   speech.js — spoken guidance for the evacuation navigator.

   Thin, defensive wrapper over the browser's SpeechSynthesis API. Voice is not
   decoration here: someone evacuating is holding a phone in the rain, in the
   dark, with a child on their hip. They are not reading a banner.

   Three things this handles that a bare `speechSynthesis.speak()` does not:

   1. PRIMING. Mobile browsers refuse to speak until the page has had a real
      user gesture. `prime()` is called from the "Start" tap, so the first
      instruction actually comes out instead of being silently dropped.

   2. PRIORITY. "Turn left now" must not queue behind "in 400 metres, turn
      left" — by the time the queue drains, the junction is behind you. Urgent
      lines cancel whatever is mid-sentence.

   3. VOICE CHOICE. Filipino guidance in a US English voice mangles street
      names. We pick the closest installed voice for the requested language and
      fall back gracefully, because which voices exist is entirely up to the
      device.
   ============================================================ */

const MUTE_KEY = 'cdrrmo_nav_voice_muted'

let voicesCache = []
let primed = false
let audioCtx = null

function synth() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null
}

/** Is spoken guidance possible on this device at all? */
export function isSpeechSupported() {
  return Boolean(synth())
}

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* private mode — the toggle still works for this session */
  }
  if (muted) cancel()
}

/* Voices load asynchronously in Chrome: the first getVoices() is usually empty
   and a `voiceschanged` event follows. Cache both times. */
function loadVoices() {
  const s = synth()
  if (!s) return []
  const list = s.getVoices()
  if (list.length) voicesCache = list
  return voicesCache
}

if (synth()) {
  loadVoices()
  synth().addEventListener?.('voiceschanged', loadVoices)
}

/**
 * Best installed voice for a language.
 * 'fil' tries Filipino/Tagalog, then Philippine English (which pronounces
 * local place names far better than en-US), then anything English.
 */
function pickVoice(lang) {
  const voices = loadVoices()
  if (!voices.length) return null
  const wants = lang === 'fil'
    ? [/^fil/i, /^tl/i, /^en[-_]PH/i, /^en/i]
    : [/^en[-_]PH/i, /^en[-_](US|GB|AU)/i, /^en/i]
  for (const re of wants) {
    const hit = voices.find((v) => re.test(v.lang))
    if (hit) return hit
  }
  return voices[0] || null
}

/**
 * Unlock audio from inside a user gesture. Speaks an empty utterance, which
 * satisfies the gesture requirement without making a sound.
 */
export function prime() {
  const s = synth()
  if (!s || primed) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    s.speak(u)
    primed = true
  } catch {
    /* ignore — speak() will simply be a no-op on this device */
  }
  // A tiny WebAudio context for the attention chime, also unlocked by the tap.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx && !audioCtx) audioCtx = new Ctx()
    if (audioCtx?.state === 'suspended') audioCtx.resume()
  } catch {
    audioCtx = null
  }
}

/** Short two-note chime before an instruction — the "listen now" cue. */
export function chime(urgent = false) {
  if (isMuted() || !audioCtx) return
  try {
    const now = audioCtx.currentTime
    const notes = urgent ? [880, 1174] : [660, 880]
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = now + i * 0.11
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(urgent ? 0.16 : 0.1, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.18)
    })
  } catch {
    /* audio is a nicety; never let it break navigation */
  }
}

export function cancel() {
  try {
    synth()?.cancel()
  } catch {
    /* ignore */
  }
}

/**
 * Say something.
 *
 * @param {string} text
 * @param {{ lang?: 'en'|'fil', urgent?: boolean, withChime?: boolean, rate?: number }} opts
 * @returns {boolean} whether the line was handed to the synthesiser
 */
export function speak(text, opts = {}) {
  const s = synth()
  if (!s || !text || isMuted()) return false
  const { lang = 'en', urgent = false, withChime = true, rate } = opts
  try {
    // Urgent lines pre-empt; ordinary ones wait their turn but never pile up
    // behind a backlog (an instruction three junctions stale is worse than
    // silence, so the queue is capped by cancelling when it runs long).
    if (urgent || s.pending) s.cancel()
    if (withChime) chime(urgent)
    const u = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(lang)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    } else {
      u.lang = lang === 'fil' ? 'fil-PH' : 'en-PH'
    }
    // Slightly brisk, because instructions arrive with a deadline attached.
    u.rate = rate ?? (urgent ? 1.12 : 1.02)
    u.pitch = 1
    u.volume = 1
    // Chrome drops the first word if speak() lands in the same tick as cancel().
    setTimeout(() => {
      try {
        s.speak(u)
      } catch {
        /* ignore */
      }
    }, withChime ? 230 : 30)
    return true
  } catch {
    return false
  }
}

/** Stop everything and forget the priming (used when navigation exits). */
export function shutdown() {
  cancel()
  primed = false
}

export default { speak, cancel, prime, chime, isMuted, setMuted, isSpeechSupported, shutdown }
