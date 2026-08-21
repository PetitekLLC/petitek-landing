# ChatrBox Fit Conversation

Development module for the conversational **Will ChatrBox Work for Your Pet?** experience.

## What is implemented in the front-end prototype

- Reusable sticky launcher and modal/bottom-sheet UI.
- Natural-language opening: the visitor describes one or more problems in their own words.
- Adaptive follow-up questions instead of a fixed questionnaire.
- Local fallback interpretation for common behaviors so UX can be tested before the AI endpoint is connected.
- Behavior-specific results: Strong Fit, Potential Fit, Potential Fit — Pre-Training Recommended, Training Recommended First, or Not Recommended for This Behavior.
- Wi-Fi/manual pre-training branch for pets still learning a rule but already responsive to the owner's voice.
- Safety-sensitive hard exclusions such as chasing cars/traffic.
- Multi-pet targeting concept: evaluate whether placement can isolate the problem activity; pet-name/verbal specificity can support targeting but is not treated as a guarantee.
- Unique `fit_assessment_id` cookie (14 days) for future checkout/customer association.
- Google Analytics/custom DOM events for open, close, completion, and CTA activity.
- AI API hook with graceful local fallback.

## Preview

Open `/fit-assessment/` in the `app` site build.

## Embed

Add the stylesheet to the page head:

```html
<link rel="stylesheet" href="/fit-assessment/fit-widget.css">
```

Add the script near the end of the page:

```html
<script
  src="/fit-assessment/fit-widget.js"
  data-api="https://portal.petitek.com/api/fit-assessment/message"
  data-product-url="/embedded-checkout"
  defer></script>
```

If `data-api` is omitted or the endpoint fails, the current prototype uses its local rules fallback.

## Recommended production flow

1. Browser creates/reads `fit_assessment_id` and existing `petitek_visitor_id`.
2. Visitor types or dictates the problem in natural language.
3. Flask endpoint sends the message to OpenAI for **structured extraction**, not unrestricted fit determination.
4. Server merges extracted facts with saved assessment state.
5. Server-side rules determine:
   - whether enough information exists,
   - which fact is most valuable to clarify next,
   - hard exclusions,
   - fit category,
   - recommended ChatrBox mode.
6. AI may phrase the next question naturally and personalize the final explanation, while the server controls the allowed conclusion.
7. Each turn and result is persisted.
8. `fit_assessment_id` is carried into checkout and linked to customer/order once identity becomes known.

## API request

`POST /api/fit-assessment/message`

```json
{
  "assessment_id": "FA_...",
  "visitor_id": "...",
  "message": "My dog Delilah gets on the couch when we leave...",
  "answer_key": null,
  "client_state": {}
}
```

`answer_key` is populated for a structured chip selection, for example `knowsRule:yes`.

## API response — follow-up

```json
{
  "assessment_id": "FA_...",
  "completed": false,
  "progress": 58,
  "profile": {
    "pet_type": "dog",
    "pet_name": "Delilah",
    "current_behavior": "furniture_access",
    "knows_rule": "yes",
    "verbal_cue": "yes",
    "when_occurs": null
  },
  "message": "That sounds promising. When is Delilah most likely to get on the couch?",
  "choices": [
    {"label": "Mostly when I’m away or not watching", "key": "whenOccurs:unobserved"},
    {"label": "Both when I’m there and away", "key": "whenOccurs:both"},
    {"label": "Mostly when I’m there", "key": "whenOccurs:observed"},
    {"label": "Not sure", "key": "whenOccurs:unknown"}
  ]
}
```

## API response — completed

```json
{
  "assessment_id": "FA_...",
  "completed": true,
  "progress": 100,
  "profile": {},
  "message": "Because Delilah already understands the rule...",
  "result": {
    "fit": "Strong Fit",
    "mode": "automatic",
    "summary": "Delilah shows several strong ChatrBox indicators.",
    "why": "...",
    "steps": [
      "Position ChatrBox so the couch activity enters the detection zone.",
      "Record the same familiar correction Delilah already understands.",
      "Use consistent placement and repetition."
    ]
  }
}
```

## Suggested database entities

### `fit_assessments`
- id / public assessment UUID
- visitor id
- customer id nullable
- order id nullable
- status
- overall result nullable
- created / updated / completed timestamps
- source page / campaign / referral context

### `fit_pets`
- assessment id
- pet name
- pet type

### `fit_behaviors`
One row per problem, because one pet can be a strong fit for one behavior and a poor fit for another.
- assessment id
- pet id
- behavior family
- original description
- knows rule
- verbal cue relationship
- timing
- location predictability
- multi-pet targetability
- fit result
- recommended mode

### `fit_messages`
- assessment id
- sequence
- role (`user`/`assistant`)
- message
- structured answer key nullable
- timestamp

### `fit_events`
- assessment id
- visitor/customer/order nullable
- event name
- metadata JSON
- timestamp

### `fit_outcomes` (Phase 2)
- behavior id
- response (`great`, `better`, `not_good`)
- follow-up date
- support action
- review request eligibility/state

## OpenAI responsibility

Use AI for:
- parsing free-form descriptions,
- extracting structured facts,
- detecting multiple behaviors,
- recognizing unusual descriptions,
- identifying ambiguity,
- natural conversational phrasing,
- personalized final explanations constrained to the server's decision.

Do **not** let the model silently rewrite fit rules or override safety exclusions.

## Rules source

`rules-v1.json` is the initial human-readable source of truth. In production, migrate these rules into database/config tables with versioning so they can be updated as real outcome data accumulates.
