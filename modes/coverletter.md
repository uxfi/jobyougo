# Mode: coverletter — Tailored Cover Letter Generator

Generates a targeted cover letter from the full evaluation report and candidate profile. Must be triggered from a specific application row (report required).

## Sources used

| Source | Purpose |
|--------|---------|
| Raw JD (fetched live) | Exact vocabulary, requirements, keywords to mirror |
| Evaluation report | Proof point selection, score rationale, identified gaps |
| `cv.md` | Canonical experience and proof points |
| `config/profile.yml` | Identity, contact, compensation targets |
| `modes/_profile.md` | Archetype framing, narrative, superpowers |

**NEVER invent experience or metrics.** Only reformulate real experience with the vocabulary of the JD.

**Priority:** Raw JD > Report > cv.md. The raw JD contains the exact words the hiring team wrote — mirror them.

---

## Pipeline

```
1. LOAD       → Raw JD (fetched live from job URL) + full evaluation report
2. EXTRACT    → 10-15 exact keywords/phrases from the JD (role title, tech stack, key verbs, must-haves)
3. DETECT     → Language of JD → cover letter language (EN default)
4. DETECT     → Archetype of the role → load framing from _profile.md
5. SELECT     → Top 2-3 candidate projects most directly relevant to this JD
6. MATCH      → Map each selected project/skill to a specific JD requirement using JD's exact vocabulary
7. GENERATE   → Three versions (short, email, full) + project highlight summary
8. OUTPUT     → Structured markdown with clear section separators
```

---

## JD keyword mirroring (critical)

Before writing anything, extract the key terms from the raw JD:
- **Role title / seniority signals** → use the exact title in the subject line and opening
- **Technical keywords** → if the JD says "RAG pipelines", write "RAG pipelines", not "LLM workflows"
- **Action verbs** → if the JD says "drive", "architect", "ship", use those verbs
- **Company-specific language** → product names, team names, frameworks they mention
- **Must-have requirements** → address each one explicitly (even if brief)

The cover letter should feel like it was written specifically for this JD, not adapted from a template.

---

## Project and capability selection

From `cv.md` and `modes/_profile.md`, select **2-3 projects** that best answer the JD's core ask:

**Selection criteria:**
1. **Closest technical match** — the project that most directly demonstrates the JD's primary requirement
2. **Quantified impact** — prefer projects with measurable results (+20%, 300 users, $100K raised)
3. **Recency** — more recent = more weight

**Output a "Projets mis en avant" section** at the end listing the selected projects with one line of justification tied to the specific JD requirement they answer.

**Never use the same 2-3 projects for every cover letter.** The selection must be re-evaluated per JD.

---

## Structure (output format — strict)

```markdown
# Cover Letter — {Company} — {Role}

## Version courte
[120-180 words — ready to paste into a form field, no greeting, no signature, starts with a concrete proof point]

## Version email
Subject: {Role} — {First Name} {Last Name}

Hi {Hiring Manager first name, or "there"},

{email body — 3 paragraphs: specific hook tied to JD / proof point + capability / CTA closing}

Best,
{Full Name}

## Version longue
{Full formal cover letter — 350-450 words, formal greeting, structured body, formal closing}

## Projets mis en avant
- **{Project name}** — {why relevant to THIS specific JD, 1 line}
- **{Project name}** — {why relevant, 1 line}
[2-3 projects max, selected based on JD requirements]
```

Always output all four sections, even if only one was requested. The user will pick.

---

## Language detection

- JD in French → write in French
- JD in English → write in English
- JD in German → write in German
- Mixed → match the dominant language of the JD
- If uncertain → default to English

Apply the same language to all three versions.

---

## Tone — "I'm choosing you" (not "please pick me")

**Core principle:** The candidate is evaluating the company as much as the company is evaluating the candidate.

- **Confident, not arrogant:** "I've spent the past year building production AI systems — this role is where I want to apply that next."
- **Selective, not pretentious:** "I've been deliberate about where I apply. Your scope maps exactly to what I'm building toward."
- **Specific and concrete:** Every claim must be backed by a real proof point from cv.md or the report.
- **Direct:** No filler. No "I'm passionate about…", "I would love the opportunity to…", or "I am writing to express my interest in…"
- **Lead with proof, not claims:** Instead of "I'm great at AI product management", say "I shipped Creads.io solo — full pipeline from brand scraping to video generation."

---

## Proof point selection

From the evaluation report, identify which proof points scored highest in Block B (CV match). Prioritize:

1. The one proof point that most directly mirrors the JD's core ask
2. A quantified enterprise impact (if the role is enterprise-facing)
3. A builder/founder signal (if the role values autonomy or speed)

**Maximum 3 proof points per version.** One is better than three if one is strong enough.

---

## Archetype-specific framing (from _profile.md)

| Role archetype | Lead with | Proof point priority |
|----------------|-----------|---------------------|
| AI PM / Head of AI | Product ownership, roadmap, metrics | Creads roadmap, UpViral overhaul |
| AI Product Designer | UX depth + AI understanding | LVMH, Shiseido, Société Générale |
| Agentic / Automation | End-to-end pipeline, speed of delivery | Creads pipeline (scrape → match → brief → video) |
| AI Solutions Architect | Full-stack architecture, solo delivery | Creads stack (Vercel, Supabase, Claude, Firecrawl) |
| AI Forward Deployed | Client-facing delivery speed, prototyping | Agence V0, Creads MVP to prod |
| Product Design (senior) | Systems thinking, measurable impact | +20% Shiseido, +12% SG, LVMH multi-maisons |

---

## Paragraph structure (email and full versions)

**Opening (1 sentence):** What caught your attention — specific to this company/role, not generic.

**Body paragraph 1 — The match:** Your most relevant proof point, tied directly to the JD's core requirement. Quantified if possible.

**Body paragraph 2 — The differentiator:** What makes you rare for this specific role. Reference _profile.md "Avantage Distinctif" if applicable.

**Closing (2-3 sentences):** Call to action without begging. "Happy to share a demo / walkthrough of [X] if useful." End clean.

---

## Short version rules (for form fields)

- 120–180 words strict
- No greeting, no signature
- Starts directly with a proof point or specific signal, not "I am a designer with 10 years of experience"
- Ends with one forward-looking sentence, not "Thank you for your consideration"
- Written in first person, present tense where possible

---

## Post-generation

After outputting the three versions:
- Remind the user to use `/career-ops apply` if the form has additional questions
- Suggest `/career-ops pdf` if a PDF cover letter attachment is needed (generates a styled PDF matching the CV design)
- If the offer status in the tracker is still `Evaluated`, offer to move it to `Applied` once sent
