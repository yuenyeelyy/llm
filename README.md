# Undertone · demo implementation

Version 0.3 · updated 17 November 2026 (Hong Kong)

A local, source-linked relationship assistant. Create a person, confirm a WhatsApp TXT import, read a concise profile, inspect original evidence, and ask follow-up questions in English or written Cantonese. Individual and selected-network rooms keep separate context.

## What changed

- **Whole-conversation profiles:** resumable read/aggregate/check jobs process every imported message in bounded batches. Coverage, preprocessing calls and provider tokens are recorded separately. A failed batch does not become a completed profile. Pause/resume is available; closed-page jobs retain completed batches.
- **Readable profiles:** short checked statements such as “Elly studies computer science” and “Elly enjoys programming and Korean food”. An Evidence button opens original messages, dates and source spans. Missing areas stay explicitly insufficient.
- **Interpretations and advice:** descriptive communication observations can be inferred from text, not only explicit self-descriptions. Limited examples are tentative; recurring habits/personality need three exchanges over two days. Personality reflection is opt-in. One-off food choices can motivate tentative suggestions without being promoted to stable preferences. General suggestions remain available when personalised checking fails; failures remain visible and cannot earn benchmark success.
- **Cantonese:** Traditional Chinese and mixed Cantonese/English content, 上午/下午 timestamps and full-width sender punctuation. Replies match the question language. Cantonese retrieval uses Han bigrams and a pinned local multilingual encoder; this is a language-support implementation, not a measured Cantonese-accuracy claim.
- **Retrieval:** local embeddings, keyword ranking, reciprocal-rank fusion, source-linked profile hints, neighbour context, date scope, snapshot/query cache and exact original-span checks. No chat text is sent to Hugging Face; the service downloads public model assets and runs inference locally.
- **Research controller:** explicit independent benchmark runs and selected legacy workflows retain A/B/C/B-wide; at most four model calls, two unique allowed reads and one acquisition round. Tools: message search, recent updates, surrounding context, profile-attribute lookup and deterministic scoped message counts. Disallowed/duplicate/excess actions are blocked and logged.
- **Legacy controller limits:** o200k_base conservative accounting (+100 wrapper tokens), 2,000 initial evidence tokens (4,000 for B-wide), 4,000 later evidence tokens, 8,000 per online input, 1,000 online output, 90-second answer deadline. Offline preprocessing has a separate 16,000-input / up to 8,000-output for Poe Sonnet reading batches (otherwise up to 5,000) / 1,000-call job ceiling. Provider failures are counted, not silently retried.
- **Revisable memory:** imports mark prior findings stale; new checked records link predecessors/replacements. Source snapshots remain intact. Finding history and JSON report export are available. Deleting a profile removes its sources, jobs, index and related turns while preserving unrelated conversations.
- **Drafting:** a separate budgeted draft action, editable by the user, without any send capability. User edits are not model-verified.
- **Retention:** authenticated access enforces a rolling seven-day source policy; the local encoder process also runs an hourly local purge while it is running. Backups, exported reports and provider retention are separate. No promise of purging a powered-off computer is made.

## Detailed conversation analysis (17 November)

Existing individual chat now calls the detailed conversation engine; there is no extra user mode or intent router. A scoped conversation fitting 24,000 conservative packet tokens is supplied in full to generation **and** interpretation review. Larger conversations are read in chronological exchanges with resumable cached extraction, selected original evidence and deterministic neighboring turns. Large-history selection remains incomplete for any particular answer; omitted extraction items do not establish absence. Cache keys include owner, model, prompt revision, profile snapshot/context and original message contents. Completed reading usage is recorded separately from the current HTTP request's calls/tokens.

Choose imported files and dates before asking. Server-side ownership and profile checks authorise those files; chat rooms, retrieval caches and follow-up context preserve this scope. Overlapping imports are not automatically deduplicated. Replies can show dated positive, negative, mixed and ambiguous episodes, exact short quotations, plausible implied meaning, contextual clues, alternatives and source buttons. Patterns remain tentative. Previous examples are retained as untrusted follow-up context, never promoted to originals.

Each generated item receives its own verdict; unsupported examples are omitted independently. Scope/limits prose comes from server coverage facts. Preparation performs one new extraction batch per request; the page continues from saved checkpoints. The answer stage is capped at six model calls per request, with a 45,000 conservative input-packet ceiling, 12,000 answer-output allowance, 8,000 extraction allowance and 8,000 check allowance. These larger quality-oriented calls are not an instant-response guarantee. Provider output truncation is a failure; partial JSON is never accepted and no hidden retry is added.

Default Ask across my people now also uses two calls: generation and independent candidate/note checks. It retrieves source-linked profile context and relevant originals with nearby replies, keeps supported people when another fails, excludes messages with conflicting cross-profile speaker attribution from preference evidence, and always leaves unsupported availability unknown. One-person network rooms are separate from individual chat rooms, with legacy network history read compatibly. The explicit research controller remains available. Its surrounding-context tool now resolves source IDs to same-file adjacent messages rather than rerunning semantic search. The people engine has a separate 24,000 conservative input-packet ceiling, 6,000 generation output and 8,000 review output; no paid hidden retry.

Message drafting uses two calls: generation then independent item checks. The sendable invitation is checked separately from each supporting note. An invitation need not establish the recipient's preferences or availability; asserted agreement or other factual premises still need support. A rejected note cannot discard an independently accepted message. The editable Copy message box remains separate from supporting evidence, and no contact message is sent.

Development evaluation: [evaluation/conversation/README.md](evaluation/conversation/README.md), six synthetic contrast cases and `node scripts/evaluate-conversation.mjs`. Default execution prepares a plan and blank independent human ratings without inference. `--live` intentionally uses the privately saved Poe credential for synthetic cases; outputs are ignored. `--score PATH` requires completed identified ratings. Independent human semantic ratings and general accuracy claims remain outstanding.

## Local setup

Use Node 24 LTS and npm. First run downloads public ONNX model files; allow network access for that download. Application data is stored in ignored `.wrangler/state`; public model assets are in ignored `.cache/models`.

```sh
npm ci --no-audit --no-fund
npm run build
npm run db:migrate:local
```

The migration helper applies all three immutable migrations and preserves existing records. It can be run again safely.

Configure only the provider(s) you use, through hidden terminal prompts:

```sh
node scripts/configure-hku-key.mjs
node scripts/configure-poe-key.mjs
```

Both preserve unrelated provider/encoder settings. Keys are saved only in the ignored mode-0600 `.dev.vars` file; never paste them into source, shell arguments or chat. The local encoder creates its private service token automatically.

Start both processes:

```sh
npm run dev:demo
```

Open http://127.0.0.1:5173/. This command starts the encoder, waits until it is ready, then starts the local app. Stop other copies on ports 5173/8788 before using the combined launcher. For development, the two processes can instead run in separate terminals:

```sh
node scripts/retrieval-service.mjs
npm run dev -- --port 5173 --hostname 127.0.0.1
```

Restart the app once if the encoder created its token after the app had already started. Select HKU or Poe in the **Model service** control. Poe Claude Sonnet 5.5 is the default. GPT-5.4 and HKU remain selectable; GPT-6 Luna is disabled while absent from the API catalogue. If Sonnet availability cannot be confirmed, GPT-5.4 is explicitly shown as the active fallback. Provider rate windows are enforced server-side; a whole-conversation job may take minutes on the HKU quota. Progress is shown instead of silently summarising only a sample.

The starter supplies a development identity on loopback. This is not verified production authentication and must not be exposed as a public development server.

## Providers and encoder revisions

HKU uses the student-specific Chat Completions endpoint, API version 2024-10-21, `api-key`, and `gpt-4.1-nano`. Poe Claude Sonnet 5.5 uses Chat Completions with strict JSON schemas; GPT-5.4 uses Responses. Both use the same saved Poe bearer credential. Configuration is server-side; workspace responses expose only availability flags. Provider response model IDs and attempted-call usage are logged without transcripts. Cost fields remain null when the provider does not report attributable USD; `scripts/check-poe-usage.mjs` separately reads actual account-wide API spending.

Production-language retrieval uses `Xenova/paraphrase-multilingual-MiniLM-L12-v2` at revision `2c4055b12046f11709e9df2c122e59ffbdc2f900` (q8 ONNX, mean pooled, normalised, 384 dimensions). The proposal's English encoder remains available for a **separate clean benchmark index**:

```sh
MINILM_BENCHMARK=1 node scripts/retrieval-service.mjs
```

That mode uses `Xenova/all-MiniLM-L6-v2` at revision `751bff37182d3f1213fa05d7196b954e230abad9`. Do not silently mix encoder modes or reuse an incompatible index; encoder mismatches fail explicitly. Multilingual product results are separate from a frozen English primary benchmark.

## Verification and evaluation

```sh
npm run typecheck
npm test
npm run build
npm run evaluation:plan
```

Tests cover source offsets/normalisation, isolation guards, bounded actions, safe fallbacks, Cantonese imports, token splitting, whole-conversation batch coverage and temporal availability checks. CHECKS.md records real synthetic-provider runs and failures. A few successful live examples do not establish reasoning accuracy.

`evaluation/` contains a draft 24-history corpus, a gated runner, blinding helper and history-level bootstrap scorer. Human gold review, pilot approval, genuinely multi-person task expansion, the full 320-output comparison, independent ratings and the complete prespecified secondary suites are **not completed**. Draft generation is not equivalent to an independent benchmark. See evaluation/README.md. The current UI is React/TypeScript/Vinext with SQLite-based D1, a deliberate stack change from Python/Streamlit.

## Hosting status and remaining release work

This is a working local demo, **not a deployed public product**. Previous Sites source synchronization was rejected by automatic approval policy. Hosted authentication, database migrations and a private CPU embedding-service deployment have not been verified. Cloudflare Workers cannot use this computer's loopback encoder in production; a private reachable encoder service is required before hosting. Previously configured remote model credentials predate rotation and must be refreshed. Do not publish a development identity or claim the local URL is online hosting.

The repository contains no API keys or private conversation database. Do not package `.dev.vars`, `.wrangler`, `.cache`, usage ledgers, private rating mappings or private exports. Synthetic fixtures are clearly labelled.

Recommendation priorities: respect applicable restrictions first; then prefer the person’s explicit current request, stated preference, repeated choices, one-off observations, and finally clearly labelled general advice. Recency, scope and counterexamples matter; these are model instructions, not calibrated numeric confidence scores. Final checking retains all retrieved evidence to inspect overlooked stronger signals. Replies follow the question language; Cantonese questions receive natural written Cantonese in Traditional Chinese.

Profile performance: Poe and HKU read one batch at a time; HKU remains paced. If a reading response is truncated at its output limit, the job splits that unfinished batch and processes the smaller batches in order; completed checkpoints remain saved. Splitting is bounded and stops if a single fragment still cannot fit. Successful reading batches are cached privately for seven days, scoped by owner/person, exact source packet, context, model/provider, behaviour setting, current day and prompt revision. Refreshes and appended imports reuse unchanged batches; changed batches and final synthesis/review are rerun. New jobs benefit from caches populated after this upgrade. A reload can restore a clearly labelled preliminary summary from its saved job; it is not exported or used as a checked profile. Summary generation does not wait for semantic indexing; question submission prepares its own index. Empty export records are counted for coverage but do not need search embeddings. Storage limits are 50,000 messages per workspace and 20,000 per person; uploads support 10,000 messages / 1.5 MB each. These are configured PoC capacities, not a validated unlimited-scale service.

The home view, Ask across my people, accepts activity-first questions and includes all profiles by default with explicit scope chips to exclude people. It combines source-linked checked profile hints, relevant chat excerpts and versioned user-provided relationship/context records. It can suggest someone from supplied context without requiring a generated profile. Candidate cards explain the fit, link to evidence and keep unknown availability provisional. Explicit preferences rank above weaker contextual/observational matches; raw citation counts do not determine rank. The network assistant uses its own 4,000-token evidence / 12,000-input / 1,800-output limits and is separate from primary benchmark chat mode. It does not infer that two candidates know each other or send invitations.

The top-layer network assistant does not wait for indexing every relationship. It uses bounded, labelled user-provided profile excerpts, checked summary citations and relevant lexical chat excerpts (including café/study aliases across English/Cantonese); ready indexes additionally supply semantic matches. It discloses that limited scope and does not claim a full-history search when indexes are unavailable. Individual chat/benchmark retrieval still requires its complete index.

Offline Poe profile requests allow up to 180 seconds each; HKU requests keep 90 seconds. A running job cannot be reclaimed until its provider deadline plus a 30-second lease margin. Timeouts stop with a readable resume instruction and retain completed batch checkpoints/caches. They are not automatically retried and do not imply invalid credentials. New requests without an explicit provider default to Poe; existing saved jobs retain their original provider. Online answer deadlines remain bounded separately.

Consolidation uses short observation_N handles with full supporting/contrary lineage retained server-side and restored before source validation. Groups are budgeted using the actual compact payload, up to 64 observations / 6,000 input tokens. Each merge outputs at most eight observations; each completed round must shrink, and synthesis starts at eight or fewer observations regardless of original citation length. Nonshrinking or incomplete-lineage output fails with a saved checkpoint rather than repeating reduction rounds. Legacy reduction checkpoints migrate without rereading completed message batches. Profile output caps are 3,000 for reading, 5,000 for consolidation/synthesis and 1,200 for final review. Incomplete provider responses retain status/reason, configured output cap and reported usage in timing records without logging response text. Sonnet and Luna availability is checked against Poe’s public model catalogue (five-minute cache); unavailable Luna is disabled and labelled, with no silent model substitution or hidden inference request. Existing saved jobs retain their service/model choice.

Conversation meaning: shared prompts cover sarcasm/irony, teasing, exaggeration, indirect requests/invitations, softened refusals, frustration and reassurance. Interpretations use tentative findings with contextual citations, distinguish literal wording from implied meaning, and preserve plausible alternatives. Profile summaries place examples under Communication style; repeated tendencies retain the distinct-exchange requirement. This is model interpretation, not a validated intent classifier.

Online model packets send each original evidence body once. Draft/candidate citations are reduced to source IDs for model review, while saved/UI citations retain verbatim originals and coordinates. This avoids double-counting quotations after adaptive retrieval; the 8,000-token individual request ceiling remains enforced.

Adaptive evidence retention: sources cited by the draft findings, candidate preferences and constraints remain pinned through additional retrieval and final review. Both tool result sets are interleaved within the evidence budget. A foreign citation is still rejected; existing failed answers are historical and require a new question to retry.

Failure feedback distinguishes output truncation, citation mismatch, input-size limits, timeouts and semantic rejection, including for historical saved answers. Sonnet online output ceilings are 4,000 tokens for individual drafting/revision, 6,000 for network drafting/revision and 3,000 for checks; concise-answer prompts and strict rejection of incomplete JSON remain.

Message drafting returns a dedicated draft_message separate from evidence/reasoning findings. The draft tab provides an editable message box and Copy message action; copying uses only the edited message, never supporting notes or source quotations. Both proposed message premises and supporting findings undergo the same review workflow. Failed personalisation does not expose a copyable personalised draft. Nothing is sent automatically.
