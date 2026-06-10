/**
 * Content + icons for the Terms, Privacy and Contact popups.
 * Kept in one place so the Login and Register pages share identical copy.
 */

/* ---------- icons ---------- */
export function DocIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="10" y2="9" />
    </svg>
  )
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  )
}

/* ---------- copy ---------- */
export function TermsContent() {
  return (
    <>
      <p className="updated-note">Last updated: January 2026</p>
      <p>
        By accessing the Cabuyao City CDRRMO Flood Risk-Aware Route System, you
        agree to the following terms. This platform is an official tool of the
        Cabuyao City Disaster Risk Reduction and Management Office.
      </p>

      <h4>1. Acceptable Use</h4>
      <p>
        The system is provided to support disaster preparedness, flood
        monitoring, and safe-route navigation. You agree to use it lawfully and
        not to interfere with its operation or misuse hazard information.
      </p>

      <h4>2. Information Accuracy</h4>
      <p>
        Flood hazard and routing data are near-real-time and sourced from
        external providers. Conditions on the ground may change faster than
        updates allow. Always supplement system guidance with official
        directives and direct field observations.
      </p>

      <h4>3. Accounts</h4>
      <p>
        You are responsible for keeping your login credentials secure.
        Activities performed under your account are your responsibility.
      </p>

      <h4>4. Limitation of Liability</h4>
      <p>
        The CDRRMO does not guarantee uninterrupted availability and is not
        liable for decisions made solely based on system output during
        emergencies.
      </p>
    </>
  )
}

export function PrivacyContent() {
  return (
    <>
      <p className="updated-note">Last updated: January 2026</p>
      <p>
        This Privacy Policy explains how the Cabuyao City CDRRMO collects, uses,
        and protects your information when you use this system.
      </p>

      <h4>1. Information We Collect</h4>
      <ul>
        <li>Account details (name, email, barangay, role).</li>
        <li>Approximate device location (only with your permission) for routing.</li>
        <li>Usage data needed to operate and improve the platform.</li>
      </ul>

      <h4>2. How We Use It</h4>
      <p>
        Your data is used to authenticate access, deliver barangay-level hazard
        alerts, generate safe routes, and coordinate disaster response.
      </p>

      <h4>3. Data Protection</h4>
      <p>
        Information is stored securely and access is restricted by role. We do
        not sell your personal information to third parties.
      </p>

      <h4>4. Your Rights</h4>
      <p>
        You may request access to or correction of your personal data by
        contacting CDRRMO IT Support.
      </p>
    </>
  )
}

export function ContactContent() {
  return (
    <>
      <p>
        Need help accessing your account or reporting a problem? Reach the
        CDRRMO IT Support team through any of the channels below.
      </p>

      <div className="contact-row">
        <svg viewBox="0 0 24 24">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        <div>
          <div className="contact-label">Hotline</div>
          <div className="contact-value">(049) 502-CDRR (2377)</div>
        </div>
      </div>

      <div className="contact-row">
        <svg viewBox="0 0 24 24">
          <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        <div>
          <div className="contact-label">Email</div>
          <div className="contact-value">itsupport@cabuyao-cdrrmo.gov.ph</div>
        </div>
      </div>

      <div className="contact-row">
        <svg viewBox="0 0 24 24">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <div>
          <div className="contact-label">Office</div>
          <div className="contact-value">CDRRMO Bldg., Cabuyao City Hall, Laguna</div>
        </div>
      </div>

      <p style={{ marginTop: 12 }}>
        Support hours: <strong>24/7</strong> during active flood monitoring.
      </p>
    </>
  )
}
