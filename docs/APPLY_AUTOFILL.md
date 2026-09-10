# ATS Auto-Fill Flow (Apply Mode)

The `apply` mode interactive assistant helps you fill out applications for job postings. It reads the form questions in your browser and drafts personalized answers based on your profile and the evaluated report.

**CRITICAL RULE: Career-Ops never submits.**
The agent prepares the responses, selects the options, and types out the text fields. **You always click Submit.** This ensures you have the final say and gives you a chance to review the application before it is sent.

---

## 1. How It Works Per ATS

We have field-tested the auto-fill flow across several major ATS platforms (Ashby, Greenhouse, Lever, and Workable). The agent adapts its behavior to handle specific ATS quirks silently:

### Ashby

- Yes/No controls backed by a hidden checkbox are read as two explicit options.
  Selecting No counts as an answered question even though the underlying checkbox
  remains unchecked.

- **Duplicate Prevention:** Ashby merges candidates based on their email. Before filling out the form, the agent checks if you've already applied to this company. If so, it warns you and suggests a modified email alias (like `you+teamname@domain.com`) to prevent silent failures or unintended profile merges.

### Lever

- **Checkboxes and most captchas stay yours:** Lever often pops an hCaptcha challenge when checkboxes or radio buttons are clicked programmatically. The agent therefore never writes into captcha response fields. When explicitly enabled and PinchTab is available, it may attempt compatible Cloudflare/Turnstile verification; reCAPTCHA, hCaptcha, DataDome, Arkose and other unsupported challenges remain manual. It lists skipped fields with recommended values so you can complete them safely.

### Workable

- **Stale DOM References:** Workable is a Single Page Application (SPA) that aggressively re-renders form components, which can break automated typing. The agent works around this by using direct clipboard dispatch (`Ctrl+V` pasting) and querying fresh elements right before every paste. If that fails, it will present a numbered list of answers for you to paste manually.

### Generic Quirks (React-Select)

- Dropdowns powered by `react-select` (common across Greenhouse, Ashby, and Lever) recreate their DOM on every keystroke. The agent types character-by-character with short delays and re-snapshots the DOM to pick up changes instead of caching broken references.
- For massive native dropdowns (like countries or universities with 1,000+ options), the agent won't dump them all into its context. Instead, it selects them directly by value or visible label, or asks you for the correct label.

---

## 2. The Knock-Out Pre-Scan

Before it drafts a single answer, the agent scans the form for **knock-out questions**. These are questions designed to immediately disqualify you if your answers don't match the employer's hard requirements.

The agent checks your `config/profile.yml` against questions regarding:
- Minimum years of experience
- Degree or education requirements
- Work authorization or visa sponsorship needs
- Salary floors or expectations

**How the warning works:**
If the agent detects a potential mismatch (for example, you need visa sponsorship and the form automatically filters out applicants who do), it halts the generation process immediately and shows you a warning:

> `⚠️ KNOCK-OUT WARNING: The form asks "[question text]". Based on your profile/CV, answering "[profile answer]" may trigger immediate automatic rejection by the ATS. How would you like to answer this, or do you want to skip applying?`

This saves you from spending time tailoring responses for a job that the ATS will automatically reject.

---

## 3. Troubleshooting

### Application writing

Both answer generation paths use `lib/application-writing.mjs`. User preferences
are read from the marked application-writing section of `modes/_custom.md`,
with optional `voice-dna.md` and the profile's copywriting section. The current
user preferences take precedence over older style rules.

The editing guidance was reviewed against
[Humanizer](https://github.com/blader/humanizer/blob/main/SKILL.md) and
[Writing Clearly and Concisely](https://github.com/obra/the-elements-of-style/blob/main/skills/writing-clearly-and-concisely/SKILL.md).
These are references, not installed runtime plugins. Personal claims must come
from candidate sources. Automatic cleanup changes formatting, not vocabulary or
the strength of a claim. It is not an AI-authorship detector.

Run `npm run test:writing` for regression checks on meaning preservation and
loading user preferences. These tests do not assess model-generated prose quality.

The final field check includes missing required attachments and browser/ARIA
validation errors, even for fields the runner just filled. Text entry verifies
the complete answer rather than accepting any non-empty value. Disabled,
read-only and inert controls are excluded from fill targets. Captcha detection
ignores hidden widgets and passive reCAPTCHA badges; visible challenges still
pause the flow when they cannot be resolved through the configured path.

### PinchTab navigation fallback

When direct navigation cannot reach the application form, the runner explores
the interface in an isolated PinchTab tab. It checks the page again after each
action, including the last allowed action. An authentication wall can only be
crossed through an explicit guest control; otherwise navigation stops for manual
login. Repeated Apply labels are allowed on different URLs, while a control
already attempted on the same URL is skipped to avoid click loops. The isolated
tab is closed after exploration, and the discovered URL is checked again in the
runner's browser before filling any fields.

Navigation regression tests: `node --test tests/apply-navigation.test.mjs`.

Run the focused application suite with `npm run test:apply`. Field collection,
completion checks, blocker detection and navigation live in separate
`lib/apply-*.mjs` modules shared by the runner and its tests.

- **Agent hangs or crashes mid-form:** This usually happens when an ATS updates its React DOM unexpectedly or pops a hidden captcha. When this happens, look at the agent's output—it always prints a complete list of generated answers. You can easily copy and paste the remaining answers manually.
- **Form changes:** If you notice the form on screen is for a different role than the one evaluated in your report, the agent will detect it and ask if you want to adapt the responses to the new title or stop and re-evaluate.
- **Multiple roles in one session:** Running batch applies? Always run a **Liveness sweep** (`node check-liveness.mjs --file data/pipeline.md`) first to drop dead postings from your pipeline so you never waste time opening an expired role tab.
