# Demo script — 2 to 3 minutes

Record at **1440×900 or wider**. The desktop layout puts the four metrics on one
row and keeps every triage row on a single line; below ~1024px the sidebar
collapses and the queue drops its secondary columns.

**Before recording**

```bash
cd backend && npm run seed        # must end with 9 PASS lines
```

Then load the app once and let the backend wake — Render's free tier sleeps
after ~15 minutes and takes 30–60s to come back. Sign in as
`supervisor@resolveai.demo`.

---

## 0:00–0:20 · The problem

> "Customer support is reactive. A customer has to notice a problem, contact
> support, explain it, and wait — before anyone starts solving it.
>
> But the business already knew. A carrier hub went down at nine this morning.
> The first support ticket arrives at two in the afternoon. For five hours
> nothing was wrong with the information — only with who was looking at it.
>
> ResolveAI closes that gap."

## 0:20–0:45 · Dashboard

Land on the Command Center.

> "This isn't a reporting dashboard. It answers one question: what needs me
> right now, and is anyone falling through?"

Point at the coverage bar.

> "Zero of seventeen affected customers contacted. Five of them are high risk
> and still waiting. A hundred and one thousand rupees of orders sitting behind
> open cases."

Then the triage queue.

> "And this is the actual work — every customer who needs something, ranked
> worst first, with why, what it's worth, and a button that resolves it."

## 0:45–1:15 · Simulate the incident

Navigate to **Simulator → Simulate Delivery Delay**.

> "A carrier hub reports a seventy-two hour backlog. That's the only thing being
> simulated — everything after this is real and written to the database."

Let the result render.

> "Seventeen orders. Seventeen customers. Five of them high risk. The system
> worked out who was affected before any of them noticed."

Click **View incident**.

> "Ranked by experience risk, so the person who most needs help is the first
> row — not something you have to hunt for."

## 1:15–1:50 · Customer 360

Open the top-risk customer.

> "Priya Sharma. Premium. An eight thousand nine hundred and ninety-nine rupee
> order, three days late, with a previous complaint on record and negative
> sentiment on her last message.
>
> Risk: ninety-one out of a hundred."

Point at the factor list.

> "And critically — this score is deterministic. It's computed in the backend
> before the AI is ever called, and passed in as fact. The model reasons about a
> number it cannot change. That's not a small detail: it removes an entire class
> of hallucination from the most consequential output in the product."

## 1:50–2:20 · The AI decision

Click **Analyze**.

> "Now the AI runs. It retrieves the governing policy — delivery-compensation-v2
> — reads her context, and returns a structured recommendation: priority
> delivery plus a credit, with a one-sentence rationale and a confidence score."

Point at the decision trace.

> "Every step is shown. Incident, customer context, risk, policy, decision. What
> it does *not* show is the model's internal reasoning — we never ask for it,
> store it, or display it."

## 2:20–2:45 · Guardrails and resolution

Click **Execute**.

> "This is the part that matters. The AI proposed. The backend decides."

Point at the guardrail panel.

> "Within the five hundred rupee automatic limit. Confidence above threshold.
> Policy matched. **Safe to execute.**
>
> Had it asked for five thousand, or touched a payment method, or come back
> uncertain — it would be sitting in the approval queue instead. And a model
> claiming no approval is needed can't override that. It can ask *for* a human.
> It can never clear a rule."

Scroll to the customer message.

> "And this is what Priya receives. She never discovered the problem, never
> explained it, never asked for help."

## 2:45–3:00 · Close

Navigate to **Analytics**.

> "Coverage closes. Tickets avoided goes up. Escalation rate stays visible.
>
> The customer didn't have to find the problem, describe the problem, or ask for
> help. ResolveAI detected the incident, understood the customer, followed the
> policy, and resolved it before frustration became a support ticket."

---

## Worth mentioning if you have time

- **Sign in as the agent account** and show the approve buttons are gone — then
  note the API refuses even if the UI is bypassed, and that the *database* also
  refuses to let anyone approve their own action.
- **Toggle light mode** — both themes are independently contrast-verified.
- **Say the honest part**: notification delivery is simulated, and "tickets
  avoided" is modelled rather than measured. Judges trust a submission that
  names its own limits.

## Recording notes

- Full screen, no browser extensions or bookmarks bar visible.
- The Analyze step takes 5–20s depending on provider latency. Don't cut it —
  the loading states are part of the product.
- If the AI falls back, **say so and keep going**: "the model is rate-limited, so
  the deterministic policy engine handled it — the product is designed to
  degrade rather than break." That is a strength, not a stumble.
