import { useEffect, useState } from 'react'
import api from '../services/api.js'
import db from '../services/db.js'

/**
 * Profile-photo plumbing shared by every portal.
 *
 * A user's avatar (a small data-URL image) lives on their `accounts` row and is
 * cached on the session user object, so it shows in the topbar of whatever page
 * they're on — "visible across the whole system". When the account modal saves a
 * new photo it calls `notifyAvatarChange`, which updates the session cache and
 * broadcasts an event so every mounted topbar repaints instantly.
 */
const AVATAR_EVENT = 'cdrrmo-avatar'

/** Update the cached session avatar + broadcast so every topbar refreshes. */
export function notifyAvatarChange(avatar) {
  const me = api.getUser()
  if (me) api.setUser({ ...me, avatar: avatar || '' })
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { avatar: avatar || '' } }))
}

/**
 * The signed-in user's avatar (data URL) or '' when none. Paints from the cached
 * session first, then refreshes from the DB once on mount (so it appears even
 * for sessions created before a photo was set), and live-updates on save.
 */
export function useCurrentAvatar() {
  const [avatar, setAvatar] = useState(() => api.getUser()?.avatar || '')

  useEffect(() => {
    let alive = true
    const me = api.getUser()
    if (me?.id) {
      db.users.profile(me.id)
        .then((p) => {
          if (!alive || !p) return
          const next = p.avatar || ''
          const cur = api.getUser()
          if (cur && (cur.avatar || '') !== next) api.setUser({ ...cur, avatar: next })
          setAvatar(next)
        })
        .catch(() => {})
    }
    const onChange = (e) => setAvatar(e.detail?.avatar || '')
    window.addEventListener(AVATAR_EVENT, onChange)
    return () => { alive = false; window.removeEventListener(AVATAR_EVENT, onChange) }
  }, [])

  return avatar
}

/**
 * Renders the signed-in user's photo if set, else the supplied initials.
 * Designed to sit inside the circular/rounded `.avatar` topbar button.
 */
export function Avatar({ initials }) {
  const avatar = useCurrentAvatar()
  if (avatar) return <img className="avatar-img" src={avatar} alt="Your profile" />
  return <>{initials}</>
}

export default Avatar
