# Grammar section: how lessons are built

Researched with two expert reviews (an SLA researcher and a CELTA/DELTA teacher of Russian speakers) on 21 November 2026.

## What the research says

- **Explicit beats implicit** for adults: a short, clear rule works better than exposure alone (Norris & Ortega 2000; Spada & Tomita 2010).
- **Notice first**: learners meet the form in a text and answer meaning questions before reading the rule (Schmidt's noticing; VanPatten's structured input). Bold text alone does little; a task that needs the form to get the meaning right does.
- **Form, meaning and use** (Larsen-Freeman): at B2 the problem is choosing the form, so exercises train choice and contrast, not conjugation.
- **Controlled → freer practice** (DeKeyser): gap fills and rewrites first, then translating and writing about your own life (pushed output, Swain).
- **Feedback**: a hint and a second try first, then the answer with a one-line reason (Lyster & Ranta; Li 2010).
- **Retrieval and spacing**: short tests on days 1, 3, 7, 14, 30, 60 beat re-reading (Roediger & Karpicke 2006; Cepeda et al. 2006; Suzuki 2017). Reviews mix in another topic (interleaving, Nakata & Suzuki 2019).
- **Russian traps**: Russian has no tense backshift after «как будто», no perfect tenses, and marks focus with word order; a short L1 contrast helps.

## The lesson format (src/lib/grammar.ts)

1. **Read**: a short dialogue with the form, and one question about its meaning.
2. **Notice**: the same text with the form highlighted, 3–4 guided-discovery questions.
3. **Rule**: 3–5 points (form, meaning and use in short Russian, examples) and traps for Russian speakers.
4. **Practice**: 10–12 exercises: choice, gap, rewrite, "right or wrong?" (some sentences are already right). A wrong typed answer gets a hint and a second try.
5. **Use it**: translate from Russian, and write 1–2 sentences about yourself (checked by the AI teacher, or compared with a model answer).
6. **Check**: 6 new sentences, one try each.
7. **Reviews**: 6 questions: last time's mistakes first, then the least recently asked, one from another lesson, and a free sentence from the third review on. ≥80% moves up the ladder, below 60% starts it again.

Every answer shows why it is right, in Russian. A question that looks wrong can be reported and is never asked again.

## New lessons from the AI (src/lib/grammarAi.ts)

The learner types a topic (and optionally what to focus on). The AI writes the lesson in two requests (rules first, then exercises that fit those rules) so each answer stays within the models' output limits. The JSON is validated (`toLesson`): broken exercises are dropped, and an incomplete lesson is rejected and retried once.
