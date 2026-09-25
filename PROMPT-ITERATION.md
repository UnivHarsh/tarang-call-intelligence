# Prompt iteration, work in progress

Run `npm run eval` on these before believing any of it. The free-tier daily
quota ran out mid-iteration, so iteration 2 has never been measured.

## Iteration 1 (measured, 45 calls)

Rewrote the `resolved`, `resolution` and `contained` descriptions, which were
either one ambiguous line or, in the case of `resolution`, an eight-value enum
with no description at all.

| field | baseline | iteration 1 |
|---|---|---|
| primaryIntent | 84% | 96% |
| csatPredicted | 80% | 89% |
| refundRequested | 93% | 98% |
| resolved | 60% | 64% |
| resolution | 38% | 24% |
| rootCause | 87% | 80% |
| churnRisk | 100% | 91% |

Two things went wrong and both are worth keeping.

`resolution` got worse because the priority order I wrote told the model to
prefer `resolved_self_serve` over `info_provided`, and it over-applied: the
confusion flipped to 7x info_provided -> resolved_self_serve. My rule was wrong,
not the model.

`rootCause` and `churnRisk` moved 7 and 9 points and neither description was
touched. That is the noise floor of a 45-call sample, which means field-level
differences under roughly ten points here are not distinguishable from run-to-run
variance, and changing three definitions at once made attribution impossible
anyway. Change one field per run.

## Iteration 2 (written, never run)

Reverts the priority-order mistake and narrows `resolved_self_serve` to the case
where the customer themselves carried out a fix. Kept in `prompt.iteration.ts.wip`.

## The thing prompting cannot fix

`resolution` is capped by the labels, not the model. The corpus contains
structurally identical calls labelled `resolved_self_serve` in one scenario and
`info_provided` in another; the distinction is not recoverable from the
transcript. The keyword baseline only reaches 42% on the same field, which is
the corroboration: neither a model nor a rule can separate classes that the
ground truth does not separate consistently. The fix is to merge the two classes
or rewrite the taxonomy, not to write a better prompt.
