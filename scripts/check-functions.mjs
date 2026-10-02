/* ============================================================
   check-functions.mjs — does every Edge Function actually PARSE?

   WHY THIS EXISTS
   `normalisePH` was copied into supabase/functions/auth-otp with its regex
   backslashes stripped, leaving the literal `/^+/` — which is not a slow
   regex or a wrong one, it is a SyntaxError. JavaScript validates regex
   literals while parsing, so the module never loaded at all: every call to
   auth-otp answered 503 BOOT_ERROR, and resident registration dead-ended
   behind a message blaming a missing deploy. It had been deployed. It could
   not start.

   That went unnoticed because the obvious check does not catch it. esbuild
   transpiles the broken file without complaint — it does not validate the
   body of a regex literal. V8 does, at parse time, which is precisely what
   the Deno edge runtime does on boot.

   So: transpile each function, then hand the result to `new vm.Script(...)`.
   Nothing executes — no network, no secrets, no side effects — but the code
   goes through the same parse that decides whether a deploy boots or bricks.

   Run before every `supabase functions deploy`:  node scripts/check-functions.mjs
   ============================================================ */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const ROOT = 'supabase/functions'
const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m'

if (!existsSync(ROOT)) {
  console.error(`No ${ROOT} directory here.`)
  process.exit(1)
}

const fns = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, 'index.ts')))
  .map((d) => d.name)
const files = fns.map((name) => [name, join(ROOT, name, 'index.ts')])
if (existsSync(join(ROOT, '_shared'))) {
  for (const name of readdirSync(join(ROOT, '_shared')).filter((name) => name.endsWith('.ts'))) {
    files.push([`_shared/${name}`, join(ROOT, '_shared', name)])
  }
}

let failed = 0
console.log(`Parse-checking ${fns.length} Edge Function(s)\n`)

for (const [name, file] of files) {
  const src = readFileSync(file, 'utf8')
  try {
    const { code } = transformSync(src, { loader: 'ts', format: 'cjs', target: 'es2022' })
    /* Compile only. `new vm.Script` runs V8's parser over the whole module,
       which is where an invalid regex literal, a bad escape or a stray token
       is rejected — the same failure the edge runtime reports as BOOT_ERROR.
       Transpiled to CJS so the import statements become plain calls: nothing
       is resolved or executed, the point is only to get every line parsed. */
    new vm.Script(code, { filename: file })
    console.log(`  ${GREEN}✓${OFF} ${name}`)
  } catch (err) {
    failed++
    console.log(`  ${RED}✗ ${name} — WILL NOT BOOT${OFF}`)
    console.log(`    ${RED}${err.message}${OFF}`)
    if (err.stack?.includes('SyntaxError')) {
      const line = err.stack.split('\n').find((l) => l.includes('/^') || l.includes('regular expression'))
      if (line) console.log(`    ${DIM}${line.trim()}${OFF}`)
    }
  }
}

console.log()
if (failed) {
  console.log(`${RED}${failed} function(s) would fail to start. Do NOT deploy.${OFF}`)
  process.exit(1)
}

/* ============================================================
   Second check: the two copies of normalisePH must agree.

   auth-otp and sms-alert each carry their own normalisePH, because an Edge
   Function cannot import from a sibling. That duplication is what broke: the
   copy in auth-otp was transcribed without its backslashes, so it disagreed
   with the original on every input — including, silently, on valid numbers.
   Parsing alone would not have caught that half of the bug.

   So both are pulled out of the shipped source (never a transcription of it)
   and run against the formats a Cabuyao resident actually types.
   ============================================================ */

function extractNormaliser(path, fnName) {
  if (!existsSync(path)) return null
  const src = readFileSync(path, 'utf8')
  const start = src.indexOf(`function ${fnName}`)
  if (start === -1) return null
  const end = src.indexOf('\n}', start) + 2
  const { code } = transformSync(src.slice(start, end), { loader: 'ts' })
  return new Function(`${code}; return ${fnName}`)()
}

const PHONE_CASES = [
  ['0917 123 4567', '+639171234567'],
  ['09171234567', '+639171234567'],
  ['+639171234567', '+639171234567'],
  ['639171234567', '+639171234567'],
  ['0917-123-4567', '+639171234567'],
  ['(0917) 123 4567', '+639171234567'],
  ['12345', null],
  ['08171234567', null],  // not a 9xx mobile prefix
  ['0917123456', null],   // one digit short
  ['', null],
]

/* The browser has a third copy (normalisePhone in services/smsAlert.js). It
   decides what the resident is told BEFORE anything is sent, so if it drifts
   from the server's the form rejects numbers the gateway would have accepted,
   or accepts ones it cannot reach. Pinned here with the other two. */
const impls = [
  ...fns.map((name) => [name, extractNormaliser(join(ROOT, name, 'index.ts'), 'normalisePH')]),
  ['smsAlert.js (browser)', extractNormaliser('src/services/smsAlert.js', 'normalisePhone')],
].filter(([, fn]) => fn)

if (impls.length) {
  console.log(`Phone normalisation — ${impls.map(([n]) => n).join(', ')}\n`)
  let phoneFailed = 0
  for (const [input, want] of PHONE_CASES) {
    const got = impls.map(([name, fn]) => [name, fn(input)])
    const ok = got.every(([, v]) => v === want)
    if (!ok) {
      phoneFailed++
      console.log(`  ${RED}✗ ${JSON.stringify(input)} → ${got.map(([n, v]) => `${n}=${v}`).join(', ')} ${DIM}(want ${want})${OFF}`)
    }
  }
  if (phoneFailed) {
    console.log(`\n${RED}${phoneFailed} phone case(s) disagree or are wrong.${OFF}`)
    process.exit(1)
  }
  console.log(`  ${GREEN}✓${OFF} ${PHONE_CASES.length} formats, all copies agree\n`)
}

console.log(`${GREEN}All functions parse and phone formats agree. Runtime and deployment checks are still required.${OFF}`)
