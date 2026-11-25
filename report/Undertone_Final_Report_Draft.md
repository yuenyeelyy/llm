# Undertone: An Evidence-Grounded Agent for Personal Relationship Questions

**COMP7608B Large Language Models — Final Project Report Draft**  
**Group 2**  
Cheung Chin Hung Nathan (2012589474), Chan Lai Yu Sonia (3036656300), Lau Yuen Yee (3036656702), and Tse Hoi Yi (3036655459)

## Abstract

Personal conversations contain useful information about preferences, commitments and shared experiences, but that information can be difficult to recall and easy to misinterpret. Undertone is a local prototype that helps a user explore authorised conversation records through evidence-linked profiles, individual questions and recommendations across people. Its agentic workflows combine scoped retrieval, structured generation, verification and, in a research controller, bounded additional evidence acquisition. The system retains original message references, distinguishes observations from tentative interpretations, and supports editable message drafts without sending them. We implemented a React and TypeScript interface, a SQLite-backed local data layer, model-provider integrations and a locally executed multilingual embedding service. Documented development checks demonstrate selected import, provenance, scope, deletion and conversation-analysis behaviours; they also expose model and integration failures. The proposed controlled comparison of fixed and adaptive retrieval has not been completed, and there are no independent human ratings from which to estimate semantic accuracy. Undertone therefore demonstrates a working prototype and an evaluation infrastructure, rather than evidence that adaptive retrieval improves relationship advice.

## 1. Introduction

People often make interpersonal decisions using fragments of past conversations: a friend's stated food preference, a colleague's availability, or a follow-up that changes the meaning of an earlier exchange. These fragments may be separated by months or distributed across several conversations. A system that simply retrieves a plausible message can overlook contradictory evidence, confuse an old commitment with current availability, or treat an ambiguous utterance as proof of another person's intentions.

Undertone addresses this problem by organising user-authorised WhatsApp text exports into source-linked individual profiles and a relationship network. Users can ask questions about an individual, compare possible activity partners across selected people, and prepare an editable message. The intended role is decision support: the system provides evidence and possible interpretations, while the user retains responsibility for judging the situation and communicating with others.

The project asks: **Does bounded, adaptive evidence acquisition improve supported completion of individual relationship questions and relationship-network recommendations over fixed retrieval with the same verification workflow, and are any gains justified by additional computation and disclosure?** This research question motivated the controller and benchmark design. The available evidence does not yet answer it: the controlled evaluation and independent semantic ratings remain outstanding.

Our contributions are (1) a runnable local application connecting conversation import, structured memory, retrieval and evidence-linked answers; (2) bounded agentic workflows that can review outputs and, in the research controller, request additional read-only evidence; (3) mechanisms for source validation, scope control, memory revision and visible failure handling; and (4) synthetic evaluation materials and scoring infrastructure for a future controlled comparison. The remaining report describes the implementation, documented observations and limitations without treating development examples as benchmark results.

## 2. Problem and design requirements

The target user has records of conversations and wants assistance recalling relevant context or considering a response. A typical individual question might ask what a person's messages suggest about planning a dinner. A network question might ask which of several friends could be suitable companions for an activity. In both cases, evidence can be incomplete, time-sensitive or ambiguous.

The system is designed around five requirements. First, each factual claim should be traceable to authorised source material. Second, direct statements, tentative interpretations and missing evidence should remain distinguishable. Third, user-selected people, imported files and date ranges should constrain the information available to a request. Fourth, new imports should not silently preserve outdated findings as current. Fifth, computation and evidence acquisition should be bounded, and failures should remain visible rather than being presented as successful answers.

These requirements impose trade-offs. Source validation can establish that a quotation is present in the authorised input, but cannot by itself establish that an interpretation is correct. Sending more context to a hosted model may reveal counterevidence, but also increases resource use and exposure of private text. Profile construction and retrieval can reduce repeated reading, but cached findings can become stale when the underlying history changes.

## 3. System architecture

### 3.1 End-to-end workflow

The local application accepts a WhatsApp TXT export after the user reviews participant identities and import settings. It parses messages and preserves their original source positions. Users can build a profile, select a person or a set of people, constrain the relevant files and dates, and submit a question. The application prepares authorised evidence, calls the selected model service, validates references and reviews generated items before displaying the accepted response. The user can inspect original messages through evidence links and, where supported, continue the conversation in a scoped room.

The interface is implemented with React and TypeScript using Vinext and a Cloudflare-compatible worker environment. SQLite-backed D1 stores local application data; a separate local service runs the embedding model. Hosted model providers perform generation and checking on selected text. The application is a local demonstration, not a verified public deployment. The proposal originally specified Python and Streamlit; the implementation uses the web stack above while preserving the two-layer individual and network interaction design [1, 2].

### 3.2 Source representation and profiles

The importer retains message text, sender, timestamps and source offsets. References are checked against the original supplied material, and quotations are rendered from original spans. This allows a user to inspect the context behind an observation and makes invented or altered source references detectable. Exact source integrity is a necessary condition for an evidence-linked answer, but it is not proof of semantic support.

Profile construction processes imported conversations in bounded batches and records progress. Completed batches can be reused when a job resumes; failures remain visible instead of being counted as complete. The system consolidates observations and checks source lineage before presenting a profile. It separates directly stated information from tentative descriptions and insufficient areas. Repeated behavioural descriptions are constrained by a distinct-exchange requirement; personality reflection is optional and is not a diagnosis.

New imports mark previous findings stale, and replacements can retain links to earlier records. Source snapshots remain available for inspection. Profile deletion is intended to remove associated source data and derived records while preserving unrelated profiles. Separate individual and network rooms maintain their own context. Prior generated examples can guide follow-up questions, but are treated as untrusted context rather than original evidence.

### 3.3 Retrieval and language support

For indexed individual retrieval, Undertone combines lexical ranking and locally computed semantic embeddings using reciprocal-rank fusion. It can include neighbouring messages and source-linked profile hints. The configured product encoder is a pinned multilingual MiniLM model; the proposed English MiniLM encoder remains available as a separate benchmark configuration. These indexes are not interchangeable. Cantonese handling includes Traditional Chinese and mixed-language text, timestamp parsing and Han bigram lexical retrieval. These are implementation features, not evidence of measured Cantonese accuracy [2].

For network questions, the application combines user-provided profile context, checked profile hints and relevant original messages. When semantic indexes are not ready, it can use a limited lexical and profile-based scope and disclose that limitation. A profile entry serves as a retrieval aid; its source messages remain the evidence for factual claims. Availability is treated as unknown when it is not established for the requested time.

### 3.4 Agentic control and verification

Undertone is more than a single-prompt chatbot because its workflows maintain state, acquire and check evidence, and can take multiple bounded steps. The explicit research controller implements the proposed fixed and adaptive variants. In its adaptive configuration, the model can inspect an initial evidence packet, identify a gap and request up to two unique allowed reads in one additional acquisition round. Available read-only tools include message search, recent updates, surrounding context, profile-attribute lookup and scoped message counts. Duplicate, disallowed and excess actions are blocked and logged. Generation, review and any revision operate under explicit call, token and time budgets.

The ordinary individual conversation path is a separate quality-oriented workflow. A small scoped conversation is provided in full to generation and interpretation review. For larger histories, chronological batch extraction, selected originals and neighbouring turns support an answer, with incomplete selection disclosed. Generated items receive separate verdicts, so an unsupported item can be omitted without necessarily discarding other supported items. A separate drafting workflow checks the proposed message and supporting notes independently. The user may edit and copy a draft; the application has no sending function. User edits are not model-verified.

Both deterministic and model-based checks matter. Code validates source IDs, scopes and original spans; a model reviews whether a generated item is supported by the supplied context. A model reviewer can itself make mistakes, so its approval cannot replace independent human evaluation. Technical failures, truncated outputs and failed checks are surfaced separately from genuine lack of evidence.

### 3.5 Privacy and resource boundaries

The prototype keeps application storage and embedding inference local, while selected conversation excerpts are sent to the configured hosted model. Thus local storage does not imply fully local processing. The documented rolling seven-day source policy is enforced during authenticated access, with an hourly purge while the local encoder service runs. Provider retention, backups and exported reports are separate; a powered-off computer cannot perform a scheduled local purge. The loopback development identity is not production authentication, and hosted access controls and a remote private encoder have not been verified [2].

## 4. Evaluation design

The proposal specified a controlled comparison using synthetic conversations rather than private user histories [1]. Its intended corpus contains 24 histories across friendship, dating, partnership and work: eight development histories and 16 held-out test histories, with five tasks per history. Tasks cover explicit facts, distributed evidence, ambiguous interpretation, underdetermined requests and multi-person constraints. The repository contains draft generated histories, but their proposed annotations are not independently reviewed gold labels, and the multi-person task material requires further expansion [3].

Four variants were proposed:

| Variant | Evidence and checking | Intended role |
| --- | --- | --- |
| A | Fixed retrieval; at most one model call | Baseline for fixed retrieval |
| B | Fixed retrieval with verification | Measures verification over the common initial packet |
| C | Adaptive additional retrieval with verification | Tests whether acquiring further evidence improves outcomes |
| B-wide | Verified fixed retrieval with a wider initial packet | Tests whether a larger fixed packet explains any gain |

The primary comparison is C minus B on supported task completion for answerable tasks. A passing answer must cover essential requirements, use valid evidence, avoid material unsupported claims and respond appropriately. The proposed analysis averages within histories, then across the 16 test histories; it uses paired bootstrap resampling at the history level. Correct clarification or abstention on underdetermined tasks is assessed separately. Cost, tokens, calls, latency, failures and exposure are secondary outcomes. The proposal also calls for blinded assessment, a second-rater audit and adjudication [1, 3].

This experiment is **not complete**. The development pilot, independent gold review, frozen configuration, full 320-output comparison and human ratings are not available in the repository. Accordingly, no completion rate, C–B effect, confidence interval, inter-rater agreement or cost-effectiveness result can be reported. Six additional synthetic conversation-interpretation cases and blank rating sheets are development tools, not an independently labelled test set [4].

## 5. Implementation observations and documented checks

The repository's development records report functional tests and selected synthetic or controlled demonstrations. The latest recorded overall check states that 110 automated tests, TypeScript checking and a production build passed on 17 November 2026 [5, 6]. This is a historical development record, not a fresh test run for this report. The automated suite addresses implementation properties such as source validation, scope checks, bounded actions, import handling, failure handling and profile processing; passing it does not measure interpretation quality.

| Area | Documented observation | What it establishes and does not establish |
| --- | --- | --- |
| Scope and access | Seven isolated `/api/ask` route cases covered invalid questions, reversed dates, unauthorised profile/file IDs and permitted file/date filtering. | Control flow was exercised with mocked boundaries; this does not validate deployed authentication. |
| Deletion | Four route cases used actual migrations with in-memory SQLite to test owned deletion, isolation and report scope. | The tested data paths behaved as recorded; it is not a general security proof. |
| Profile processing | A synthetic 12-message Cantonese sample completed profile processing and exposed original evidence in the browser. | An end-to-end example worked; it does not establish general profile accuracy. |
| Interpretation | A documented synthetic Cantonese contrast distinguished possible irony from a sincere reading using surrounding context. | Illustrates the intended behaviour in a small example; no classification accuracy follows. |
| Capacity | A synthetic 6,501-message import was read back and prepared for summary scope without a model request. | Demonstrates that import and scope preparation handled this fixture; it is not a full model-processing or scale benchmark. |

Development also revealed important failures. One live critic approved an old “tonight” statement as current availability; a deterministic date guard was added after that observation. Earlier profile and answer attempts encountered malformed or truncated model outputs and invalid references; the implementation added explicit contracts, item-level validation, clearer diagnostics and resumable checkpoints. These responses reduce particular failure modes but do not demonstrate that the same class of error is eliminated [5, 6].

An independent source review reported earlier integration issues in the detailed conversation and draft paths, including inadequate counterevidence context and overly broad rejection of valid content. The documented re-review describes structural fixes and additional tests, while explicitly leaving live semantic accuracy and independent human ratings unresolved [7]. This distinction matters: a successful automated check can show that a branch or validation rule behaves as intended, but not that a model has correctly understood a real relationship.

## 6. Discussion

### 6.1 What the prototype demonstrates

Undertone demonstrates an end-to-end agentic application: it imports user-authorised records, maintains scoped state, retrieves evidence, invokes a model, validates and reviews outputs, and supports inspection and follow-up. Its research controller can decide whether and how to acquire further evidence within a bounded action space. Its default conversation workflow uses a different, fuller-context strategy for interpretation. Both workflows use multiple steps, but they should not be conflated when reporting the proposed A/B/C experiment.

The system also makes the distinction between source integrity and semantic validity concrete. Exact quotations and source links help the user inspect claims, but a genuine quotation may still be interpreted incorrectly. Separating model review from deterministic checks improves visibility into this distinction, although model review is not independent ground truth.

### 6.2 Changes from the proposal

The final prototype differs from the proposal in several respects. The interface changed from Python/Streamlit to React/TypeScript and Vinext. The product retrieval configuration uses a multilingual local encoder, while the English encoder remains a separate benchmark option. Whole-conversation profile jobs and a detailed conversation engine were developed beyond the original bounded retrieval design. These additions improve the range of workflows that can be demonstrated, but the proposed controlled benchmark was not completed. As a result, we cannot claim that the extra engineering improved the primary outcome or met the proposed latency, completion or cost targets.

### 6.3 Limitations and risks

First, the most important limitation is the absence of independently rated semantic outcomes. Synthetic examples and passing tests do not establish that advice is accurate, fair or helpful across people and contexts. The draft corpus also lacks completed independent gold review and sufficient verified multi-person task material.

Second, interpersonal meaning is inherently uncertain. Sarcasm, affection, frustration or availability cannot reliably be inferred from isolated text. Even an apparently plausible answer may omit context outside the selected records or mistake an old statement for a current condition. Full-context processing for small inputs reduces one omission risk, but large-history selection remains incomplete.

Third, the system handles sensitive records. Scope controls, deletion and retention mechanisms reduce exposure, but hosted inference receives selected text and separate provider retention may apply. The local demo identity and unverified hosting setup are unsuitable as evidence of production security. Prompt injection and forged sources remain risks requiring broader adversarial testing.

Fourth, runtime performance depends on conversation length, model response, output limits and provider availability. Batching and caching make recovery possible, but do not guarantee fast answers. Logged isolated timings should not be extrapolated to p95 latency or operating cost. Overlapping imports are not automatically deduplicated, which can also affect interpretation of repeated evidence.

## 7. Future work

The most direct next step is to complete the evaluation originally proposed. Two non-author reviewers should independently annotate the synthetic histories, resolve disagreements, and expand genuinely multi-person tasks. A development pilot should select and freeze the model, prompts, retrieval settings, budgets and scoring rules before held-out runs. The team can then generate all four variants, blind their outputs, obtain independent ratings including the planned audit, and report all failures alongside paired history-level uncertainty intervals and measured resource use.

Further work should evaluate update handling, scope isolation, prompt injection, drafting and scale using the prespecified secondary suites. Real-world usefulness would require a separately designed, consent-based study with appropriate handling of third-party privacy; synthetic success alone would not establish it. Before any public deployment, production authentication, a privately reachable embedding service, retention and deletion behaviour, and provider data-handling arrangements would need verification. A fresh-environment reproduction should also be completed and documented.

## 8. Conclusion

Undertone is a local evidence-grounded relationship assistant that combines source-linked memory, scoped retrieval, multi-step model workflows and bounded tool use. The documented prototype and functional checks show that important parts of the workflow can be implemented and exercised, while development failures illustrate why source validation, temporal reasoning and visible error handling matter. The project has not yet measured whether adaptive acquisition improves supported task completion over fixed retrieval. Completing the blinded, independently rated comparison is necessary before answering that research question or making a general effectiveness claim.

## References and project materials

[1] Group 2. *Undertone: A Bounded Evidence-Acquisition Agent for Personal Relationship Questions*. Project proposal, supplied PDF.

[2] Undertone repository. `README.md`, implementation and setup documentation. Local project repository, accessed for this draft.

[3] Undertone repository. `evaluation/README.md`, benchmark status and scoring protocol.

[4] Undertone repository. `evaluation/conversation/README.md`, conversation interpretation development evaluation.

[5] Undertone repository. `CHECKS.md`, development checks and observed failures.

[6] Undertone repository. `QA_REPORT.md`, functional QA and recorded verification status.

[7] Undertone repository. `ANALYSIS_REVIEW.md`, independent source review and re-review.

## Submission notes for the group

- Confirm the current report template, page limit, due date and detailed evaluation requirements with the teaching team. The supplied general guideline says the report requirements were to be announced separately; its four-page and NeurIPS instructions apply to the proposal, not automatically to this report.
- Replace historical verification statements with fresh dated results if the group reruns the tests. Add actual experiment results only after the prescribed reviews and ratings are complete.
- Confirm individual contributions, any required AI-use disclosure, model/provider versions, submission links and the final reference style. Add screenshots or an architecture figure if required by the final template.
- Review all content and examples as a group before submission; the proposed benchmark and any future study must not be described as completed unless supported by actual records.
