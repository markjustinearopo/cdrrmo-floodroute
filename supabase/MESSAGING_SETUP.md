# Messaging setup — what is done, and the two things left

Verification codes and emergency alerts leave this system over two channels.
As of **2026-08-27** the code for both is finished, deployed and proven end to
end. Neither can reach a real handset or inbox yet, and in both cases the
missing piece is a credential that has to be bought or verified by a person
with account access — there is nothing left to write.

This file says exactly what to do, and how to check it worked.

---

## What was actually broken (fixed, do not re-introduce)

Two regexes had been copied into the Edge Functions with their backslashes
stripped. Both were invisible in review and both took down a channel:

| Where | Written | Should have been | Effect |
|---|---|---|---|
| `auth-otp` | `/^+/`, `/[^d+]/g`, `/^9d{9}$/` | `/^\+/`, `/[^\d+]/g`, `/^9\d{9}$/` | `/^+/` is a **SyntaxError**, so the module never parsed. Every call answered `503 BOOT_ERROR`. Registration dead-ended behind a message blaming a missing deploy — but it *was* deployed, it just could not start. |
| `sms-alert` | `/^Bearers+/i` | `/^Bearer\s+/i` | Valid syntax, wrong meaning: it matches `Bearer` followed by the *letter* s. The token never had its prefix stripped, so every service-role call was rejected with `Not authorised.` **No SMS verification code had ever been delivered.** |

Two guards now catch this class:

```bash
npm run check:functions
```

- `scripts/check-regex.mjs` finds regex literals whose backslashes went missing
  (it catches all three of the above; it is comment-aware, so quoting a broken
  regex in a comment does not trip it).
- `scripts/check-functions.mjs` compiles every function the way the edge runtime
  does, so a module that would not boot fails here instead of in production. It
  also pins the three copies of the phone normaliser against each other.

> The backslashes are not lost by hand — they are eaten in transit by anything
> that treats `\` as an escape (a shell heredoc, a JSON payload). Write regexes
> to these files with an editor, not by piping text through a shell, and run the
> check above before every deploy.

---

## 1. Email — verify a sending domain in Resend

**Symptom today**

```
You can only send testing emails to your own email address
(markjustinearopo08@gmail.com). To send emails to other recipients,
please verify a domain at resend.com/domains
```

The Resend account has no verified sending domain, so it is still in test mode
and can physically only mail the developer. Every other address fails. This is
almost certainly why real flood-alert emails never reached residents either.

**Do this**

1. Go to <https://resend.com/domains> and add a domain you control
   (e.g. `cabuyao.gov.ph`, or a subdomain such as `alerts.cabuyao.gov.ph`).
2. Add the DKIM/SPF DNS records Resend gives you. Wait for **Verified**.
3. Point the functions at an address on that domain:

```bash
npx supabase secrets set AUTH_OTP_FROM="CDRRMO FloodRoute <alerts@cabuyao.gov.ph>" --project-ref sreazvhevxijkespxxac
```

`send-alert-email` has its own `from`; update it the same way if it differs.

---

## 2. SMS — pick a gateway

**Symptom today**

```
SMS gateway is in simulation mode (no provider key)
```

No provider key is set, so `activeProvider()` falls through to `simulation`.
Messages are still composed, numbered, masked and written to `sms_messages`
with `status='simulated'` — the pipeline runs, nothing leaves the building, and
the admin panel says so rather than reporting a delivery that did not happen.

There is **no free cloud SMS API that reaches Philippine numbers.** Everything
advertised as free is either a handful of trial credits (PhilSMS ~5, iTexmo
10/day expiring after 7 idle days) or your own phone doing the sending. So
there are two real options, and the function supports both.

### Option A — textbee (free, works today)

An Android phone with a PH SIM, driven over HTTP. Free to **300 messages per
month**, no card, no expiry. Open source and self-hostable if you outgrow it.

1. Sign up at <https://textbee.dev> and install the textbee app on a spare
   Android phone with a working SIM.
2. Register the device in the app (scan the QR from the dashboard), and put the
   phone somewhere it stays **charged and in signal**.
3. Exempt the app from battery optimisation — Android will otherwise kill it
   after a few hours and sends start failing with "no device online".
4. Copy the API key from the dashboard and set it yourself:

```powershell
npx supabase secrets set TEXTBEE_API_KEY=PASTE_YOUR_TEXTBEE_KEY_HERE --project-ref sreazvhevxijkespxxac
```

`TEXTBEE_DEVICE_ID` is optional — leave it unset and textbee uses your default
device, or the enabled one with the most recent heartbeat.

**Know what you are accepting.** That handset is a single point of failure
sitting in the same city as the flood it is warning about; residents see a
personal mobile number rather than a "CDRRMO" sender ID; and PH telcos throttle
bulk sending from consumer SIMs under anti-spam rules. That is a fair trade for
verification codes and small barangay warnings. It is not one for a citywide
emergency blast.

### Option B — Semaphore (paid, the right answer for citywide alerts)

Philippine telco gateway, ~₱0.56/text ex-VAT, delivers to Globe/Smart/Sun/Dito,
and sends from an approved **CDRRMO** sender ID. A citywide blast to 1,000
residents costs about ₱560.

1. Create an account at <https://semaphore.co> and buy credits.
2. Get your sender name approved — it must match `SEMAPHORE_SENDER_NAME`, which
   is already set on this project.
3. Set the key:

```powershell
npx supabase secrets set SEMAPHORE_API_KEY=PASTE_YOUR_SEMAPHORE_KEY_HERE --project-ref sreazvhevxijkespxxac
```

**Both can be configured at once.** `activeProvider()` prefers Semaphore
whenever its key is present, so adding it later automatically promotes the city
off the phone gateway with no code change. Force one explicitly with
`SMS_PROVIDER=textbee` or `SMS_PROVIDER=semaphore` if you need to.

Twilio is also supported (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM`) but a Twilio trial can only text numbers verified in its console,
which makes it a demo channel, not a city one.

> Set these with the command above rather than pasting a key into a chat or a
> file. Anything pasted into a transcript should be treated as disclosed and
> rotated.

---

## 3. Check it worked

```bash
npm run check:backend
```

`SMS` under `INTEGRATIONS` should stop reading `disconnected`, and the
`EDGE FUNCTIONS` block should show all three as deployed with no `BOOT_ERROR`.

Then confirm the provider is really live rather than simulating:

```bash
curl -s -X POST "https://sreazvhevxijkespxxac.supabase.co/functions/v1/sms-alert" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" -d "{\"action\":\"config\"}"
```

`{"provider":"textbee","simulation":false}` — or `"semaphore"` — is the answer
you want. While it still says `"simulation":true`, the key has not taken effect.

On textbee, send one real message to your own handset before trusting it:

```powershell
npx supabase functions invoke sms-alert --project-ref sreazvhevxijkespxxac --no-verify-jwt --body '{\"action\":\"test\",\"phone\":\"09171234567\"}'
```

If that returns `"simulated": true`, the key is not set. If it returns a
"no device online" error, the gateway phone is asleep, offline, or the app was
killed by battery optimisation.

Finally, register a test resident with a real mobile number. A code should
arrive by **SMS** (it is tried before email, because in Cabuyao a text lands on
the phone already in the reader's hand). Verifying by SMS also enrols that
handset for emergency alerts automatically — it has just been proven.

---

## 4. Two things to turn on once delivery is real

Both are deliberately off right now, because switching them on against a channel
that cannot deliver is what stranded residents the first time.

**Close the unverified-registration fallback.** When neither channel can carry a
code, `auth-otp` currently *activates* the account rather than leaving a real
resident locked out of one they can never open, and labels it plainly in a
CDRRMO notification. That is the right trade while delivery is broken and the
wrong one once it is not. In **System Configuration**, set
`verificationFallback: false` — registration then fails loudly instead.

**Re-enable two-factor for residents.** `mfa_enabled` is `false` on every
existing account. New registrations already request it. Turn it on for existing
residents only after a test code actually arrives.

---

## Leftover test data

Proving the flow end to end created two throwaway resident accounts on the live
database. They are inert, but they are junk — delete them from
**Settings → Users** when convenient:

- id **189** — `mobiletest.1787794976890@cdrrmo.test`
- id **190** — `smstest.1787796465562@cdrrmo.test`
