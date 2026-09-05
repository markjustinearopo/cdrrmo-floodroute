import { useEffect, useRef, useState } from 'react'
import './googleSignIn.css'

/* ============================================================
   The "Sign in with Google" button, rendered by Google's own script.

   WHY GOOGLE'S BUTTON AND NOT OUR OWN
   Google Identity Services hands back a signed ID token only to a button it
   rendered itself, inside its own iframe. A hand-rolled button styled to look
   like theirs cannot produce a credential, and their brand guidelines require
   the real one anyway.

   WHY IT DISAPPEARS WHEN UNCONFIGURED
   Without VITE_GOOGLE_CLIENT_ID this renders nothing at all — no button, no
   divider, no error. A sign-in option that is visible but cannot work is worse
   than one that is absent: a resident in a flood taps it, nothing happens, and
   they conclude the whole system is broken. Same posture as the alert
   providers: no key, no feature, no half-state.

   The client id is PUBLIC by design — it identifies the app to Google and is
   visible in every OAuth redirect. What must never be here is a client
   SECRET, and this flow does not use one: the ID token is verified against
   Google's public keys server-side (functions/auth-otp/google.ts).
   ============================================================ */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SRC = 'https://accounts.google.com/gsi/client'

/** Load Google's script once, no matter how many buttons ask for it. */
let scriptPromise = null
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      /* Reset so a later attempt can retry — a resident on a flaky barangay
         connection should not be locked out of the button for the rest of the
         session by one failed script load. */
      scriptPromise = null
      reject(new Error('Could not reach Google. Check your connection, or sign in with your email instead.'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * @param onCredential  async (credential) => void — receives Google's ID token
 * @param onError       (message) => void
 * @param text          'signin_with' | 'signup_with' | 'continue_with'
 * @param disabled      true while a sign-in is already in flight
 */
export default function GoogleSignInButton({
  onCredential,
  onError,
  text = 'continue_with',
  disabled = false,
}) {
  const hostRef = useRef(null)
  const cbRef = useRef(onCredential)
  cbRef.current = onCredential
  const [failed, setFailed] = useState('')

  useEffect(() => {
    if (!CLIENT_ID) return undefined
    let cancelled = false

    loadGsi().then(() => {
      if (cancelled || !hostRef.current) return
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (res) => { cbRef.current?.(res.credential) },
        /* FedCM is where browsers are heading, and Chrome has already begun
           removing the third-party-cookie path this used to depend on. */
        use_fedcm_for_prompt: true,
        cancel_on_tap_outside: true,
      })
      window.google.accounts.id.renderButton(hostRef.current, {
        theme: 'outline',
        size: 'large',
        text,
        shape: 'pill',
        logo_alignment: 'left',
        /* Google's button needs a pixel width, not a percentage. Measured from
           the container so it lines up with the form's own inputs instead of
           sitting narrower than everything around it. */
        width: Math.min(400, Math.max(240, hostRef.current.offsetWidth || 320)),
      })
    }).catch((err) => {
      if (cancelled) return
      setFailed(err.message)
      onError?.(err.message)
    })

    return () => { cancelled = true }
    // `text` is read once at render time; re-running on every parent render
    // would tear down and rebuild Google's iframe on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!CLIENT_ID) return null

  return (
    <div className="gsi-wrap">
      <div className="gsi-divider"><span>or</span></div>
      <div
        ref={hostRef}
        className="gsi-host"
        /* Google renders into an iframe we cannot disable, so the overlay
           below is what stops a second click while the first is still in
           flight — two credentials would race to create the same account. */
        aria-busy={disabled ? 'true' : undefined}
      />
      {disabled && <div className="gsi-block" aria-hidden="true" />}
      {failed && <p className="gsi-error">{failed}</p>}
    </div>
  )
}

/** True when this deployment has Google sign-in configured at all. */
export const googleEnabled = Boolean(CLIENT_ID)
