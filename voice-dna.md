# Voice DNA

Writing guardrail for all candidate-facing generated text. See `modes/_writing.md`
→ Voice DNA for loading/precedence against `modes/_profile.md`. Section numbers
(§1-4) are referenced by name elsewhere; do not renumber. §3-4 come first in
the file on purpose: `loadApplicationVoice()` truncates to 2000 chars.

## §4: Patterns to Avoid (Tier 1, hard rule, all generated text)

- **No em-dashes.** Period, comma, or parenthesis instead.
- **No negative parallelism**: "It's not just X, it's Y" / "This isn't about
  X, it's about Y". Say the point directly: "It's Y."
- **No "not only X but also Y"** formula: same problem, say the stronger half.
- **No forced rule-of-three** padding a list to exactly three items.
- **No stacked transition openers** ("Additionally," "Furthermore,"
  "Moreover," starting consecutive sentences/paragraphs).
- **No summary-recap closers** ("In conclusion, X is a game-changer...").
- **No rhetorical-question hooks** ("Ever wondered how...?").
- **No emoji/bolded mini-headers inside prose** unless the format calls for it.
- **No symmetrical filler pairs** ("It's not about the tools. It's about the
  mindset.") that add no new information.
- **Self-check**: could this sentence appear in a draft for any other
  candidate, any other company? If yes, rewrite it with the specific fact,
  tool, number, or name that makes it true only here.

## §3: Banned List (Tier 1, hard rule, all generated text)

Name the specific thing instead of: delve, boast, leverage (as a verb),
utilize, harness, unlock, elevate, robust, seamless, cutting-edge, top-notch,
world-class, groundbreaking, revolutionary, game-changer, paradigm shift,
tapestry, realm, testament (to), plethora, myriad, synergy/synergies, thought
leader(ship), "in today's fast-paced world", "it's important to note that",
"when it comes to", "at the end of the day", "needless to say", "as an AI",
"let's dive in", plus everything in `_writing.md`'s cliché list.

---

## §1: Sentence mechanics (Tier 2, conversational text only)

- Contractions are fine and preferred: "I'm", "don't", "it's", not "I am",
  "do not", "it is".
- Sentences may open with "And"/"But" when natural. Don't force it or ban it.
- Vary sentence length on purpose.
- Default to active voice.

## §2: Hedging and direct address (Tier 2, conversational text only)

- Speak directly: "I", "you", not "the candidate", "the applicant".
- Light hedging ("I think") only where it's honest uncertainty, never to hedge
  a known fact.
- Parenthetical asides for a genuine aside, not a repeated tic.
- At most one intensifier per sentence ("truly", "incredibly", "genuinely"),
  and only when it adds real information.
