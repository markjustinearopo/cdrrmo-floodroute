/* ============================================================
   check-regex.mjs — find regex literals whose backslashes went missing.

   WHY THIS EXISTS
   Twice now a regex has landed in this codebase with its backslashes stripped,
   and both times it silently broke a channel residents depend on:

     auth-otp   /[^d+]/g, /^+/, /^9d{9}$/  — the module would not even parse,
                                             so every call answered 503
                                             BOOT_ERROR and registration
                                             dead-ended behind a message
                                             blaming a missing deploy.
     sms-alert  /^Bearers+/i               — valid syntax, wrong meaning. It
                                             matches "Bearer" followed by the
                                             LETTER s, so the token never had
                                             its prefix stripped, every
                                             service-role call was rejected,
                                             and SMS verification codes had
                                             never once been delivered.

   The second kind is the dangerous one: it compiles, it runs, it just quietly
   never matches. check-functions.mjs catches the first kind, because V8
   refuses to parse it. Nothing catches the second but reading carefully.

   HOW THE BACKSLASHES GO MISSING
   Not by hand. They are lost in transit — pasting through a shell heredoc, a
   JSON payload, or any other layer that treats a backslash as an escape and
   helpfully removes it. That is why this keeps happening to regexes and to
   nothing else, and why "just be careful" has already failed twice.

   This looks for the SHAPES a stripped backslash leaves behind. It is
   deliberately narrow: it reports things worth a human glance, not style.

   Run:  node scripts/check-regex.mjs
   ============================================================ */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOTS = ['src', 'supabase/functions', 'scripts']
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'])
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const BS = String.fromCharCode(92) // a literal backslash, built rather than typed

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.has(extname(p))) out.push(p)
  }
  return out
}

/**
 * Pull the bodies of regex literals out of one line.
 *
 * Hand-rolled rather than regex-matched: a regex that finds regexes is exactly
 * the kind of thing this script exists to distrust. A literal has to start
 * where a value can start (so `a / b` division is not mistaken for one) and
 * close on the same line.
 */
function regexLiterals(line) {
  const out = []
  const canOpen = new Set(['=', '(', ',', ':', '!', '&', '|', '?', '{', '}', ';', '[', ' ', '\t'])
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '/') continue
    if (line[i + 1] === '/' || line[i + 1] === '*') break // a comment: rest of line is prose
    let j = i - 1
    while (j >= 0 && (line[j] === ' ' || line[j] === '\t')) j--
    if (j >= 0 && !canOpen.has(line[j])) continue // looks like division
    let body = ''
    let k = i + 1
    let inClass = false
    let closed = false
    for (; k < line.length; k++) {
      const ch = line[k]
      if (ch === BS) {
        body += ch + (line[k + 1] ?? '')
        k++
        continue
      }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) {
        closed = true
        break
      }
      body += ch
    }
    if (!closed || body === '') continue
    let flags = ''
    let f = k + 1
    while (f < line.length && 'gimsuy'.includes(line[f])) flags += line[f++]
    out.push({ body, flags, full: '/' + body + '/' + flags })
    i = f - 1
  }
  return out
}

/* The shapes a missing backslash leaves. Each is legal, and each is almost
   never what a person meant to write. A literal that still contains a correct
   escape of the same letter is left alone — that one clearly survived. */
const SUSPECTS = [
  {
    name: 'character class holds a bare d/s/w — meant ' + BS + 'd, ' + BS + 's, ' + BS + 'w?',
    test: (b) => {
      const classes = b.match(/\[[^\]]*\]/g) || []
      return classes.some((cls) => {
        const inner = cls.slice(1, -1)
        if (inner.includes(BS)) return false // an escape in here survived
        // a lone d/s/w sitting with punctuation, e.g. [^d+]
        return /^[\^]?[dswDSW][^a-zA-Z]*$/.test(inner)
      })
    },
  },
  {
    name: 'quantified letter looks like a stripped class: d{n} / w{n} / s{n}',
    /* Scanned by hand rather than matched: building a regex to detect a
       backslash, inside the script that exists because backslashes go
       missing, is how this bug gets a third life. */
    test: (b) => {
      for (let i = 0; i < b.length - 1; i++) {
        if (!'dswDSW'.includes(b[i])) continue
        if (b[i + 1] !== '{') continue
        if (i > 0 && b[i - 1] === BS) continue // properly escaped, leave it
        if (!/\d/.test(b[i + 2] ?? '')) continue // {n} takes a number
        // "a{2}" repeating a real letter is legitimate; a lone d/s/w after a
        // non-letter is the shape a stripped class leaves (e.g. ^9d{9}$).
        if (i > 0 && /[A-Za-z]/.test(b[i - 1])) continue
        return true
      }
      return false
    },
  },
  {
    name: 'word immediately followed by s+ or s* — "' + BS + 's" with the slash gone',
    /* Narrow on purpose. "http" + "s+" is a real idiom (/^https+:/ matches
       both schemes), so flagging every word ending in s+ would cry wolf and
       get this whole check ignored. The stripped-\s shape that actually bit
       us is a PREFIX being trimmed — /^Bearers+/ — where the quantifier is
       the end of the pattern or is followed by a group, never by more
       literal text. */
    test: (b) => {
      if (b.includes(BS)) return false
      const m = b.match(/^\^?([A-Za-z]{3,})s([+*])/)
      if (!m) return false
      const rest = b.slice(m[0].length)
      return rest === '' || rest.startsWith('(') || rest.startsWith('$')
    },
  },
]

let flagged = 0
let scanned = 0
const files = ROOTS.flatMap((r) => walk(r))

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  /* Comments are where a broken regex gets QUOTED rather than run — this
     script's own header documents all three bugs, and flagging its own prose
     is the fastest way to teach someone to ignore it. */
  let inBlockComment = false
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const wasInComment = inBlockComment
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (trimmed.includes('/*') && !trimmed.includes('*/')) {
      inBlockComment = true
      return
    }
    if (wasInComment) return
    for (const lit of regexLiterals(line)) {
      scanned++
      for (const s of SUSPECTS) {
        let hit = false
        try {
          hit = s.test(lit.body)
        } catch {
          hit = false
        }
        if (hit) {
          flagged++
          console.log(RED + '✗' + OFF + ' ' + file + ':' + (i + 1))
          console.log('    ' + YELLOW + lit.full + OFF + '  ' + DIM + s.name + OFF)
          console.log('    ' + DIM + line.trim().slice(0, 100) + OFF)
          break
        }
      }
    }
  })
}

console.log()
console.log(scanned + ' regex literal(s) across ' + files.length + ' file(s)')
if (flagged) {
  console.log(RED + flagged + ' look like a backslash went missing. Check each one.' + OFF)
  process.exit(1)
}
console.log(GREEN + 'No stripped-backslash patterns found.' + OFF)
