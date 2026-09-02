import { getUserLanguage, setUserLanguage, useT } from '../services/i18n.js'
import { useSystemConfig } from '../services/systemConfig.js'
import './languageToggle.css'

/**
 * English / Filipino switch, placed BEFORE authentication.
 *
 * The switch already existed — buried in admin System Configuration, which
 * only a CDRRMO operator can open. So the one group who most needs Filipino,
 * residents, had no way to reach it, and the one group fluent in English
 * controlled it. This puts it on the login and registration screens, where a
 * resident meets the system.
 *
 * It writes the same per-user override the operator setting uses, so a choice
 * made here survives sign-in and follows the person through the whole app.
 */
export default function LanguageToggle({ className = '' }) {
  const t = useT()
  const { language } = useSystemConfig()
  const active = getUserLanguage() || language || 'en'

  return (
    <div className={`lang-toggle ${className}`} role="group" aria-label={t('Language')}>
      <button
        type="button"
        className={active === 'en' ? 'active' : ''}
        aria-pressed={active === 'en'}
        onClick={() => setUserLanguage('en')}
      >
        English
      </button>
      <button
        type="button"
        className={active === 'fil' ? 'active' : ''}
        aria-pressed={active === 'fil'}
        onClick={() => setUserLanguage('fil')}
      >
        Filipino
      </button>
    </div>
  )
}
