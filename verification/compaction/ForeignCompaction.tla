----------------------- MODULE ForeignCompaction -----------------------
EXTENDS Naturals
CONSTANTS AllowForeign, CheckResults, FenceSDK, PreserveOnFailure
VARIABLES phase, provider, complete, saved, opened, restarted
vars == <<phase, provider, complete, saved, opened, restarted>>

Init ==
  /\ phase = "ready"
  /\ provider \in {"sdk", "foreign"}
  /\ complete \in BOOLEAN
  /\ saved = "original"
  /\ opened = FALSE
  /\ restarted = FALSE

Prepare ==
  /\ phase = "ready"
  /\ LET fallback == AllowForeign /\ provider = "foreign" /\ (complete \/ ~CheckResults)
     IN /\ phase' = IF fallback THEN "summarizing" ELSE "rejected"
        /\ saved' = IF fallback /\ ~PreserveOnFailure THEN "premature" ELSE saved
  /\ UNCHANGED <<provider, complete, opened, restarted>>

SwitchModel ==
  /\ phase = "summarizing"
  /\ provider' = IF provider = "sdk" THEN "foreign" ELSE "sdk"
  /\ UNCHANGED <<phase, complete, saved, opened, restarted>>

SaveSummary ==
  /\ phase = "summarizing"
  /\ phase' = "published"
  /\ saved' = "summary"
  /\ UNCHANGED <<provider, complete, opened, restarted>>

SaveReceipt ==
  /\ phase = "published"
  /\ phase' = "done"
  /\ saved' = "blocked"
  /\ UNCHANGED <<provider, complete, opened, restarted>>

SummaryFailsOrStops ==
  /\ phase = "summarizing"
  /\ phase' = "failed"
  /\ UNCHANGED <<provider, complete, saved, opened, restarted>>

Restart ==
  /\ ~restarted
  /\ phase \in {"summarizing", "published", "done", "failed"}
  /\ restarted' = TRUE
  /\ phase' = IF phase = "summarizing" THEN "failed" ELSE IF phase = "published" THEN "done" ELSE phase
  /\ UNCHANGED <<provider, complete, saved, opened>>

TrySDK ==
  /\ phase = "done"
  /\ opened' = (opened \/ ~FenceSDK)
  /\ UNCHANGED <<phase, provider, complete, saved, restarted>>

Done ==
  /\ phase \in {"done", "rejected", "failed"}
  /\ UNCHANGED vars

Next == Prepare \/ SwitchModel \/ SaveSummary \/ SaveReceipt \/ SummaryFailsOrStops \/ Restart \/ TrySDK \/ Done

ForeignCanCompact == phase = "rejected" => ~(provider = "foreign" /\ complete)
MissingResultsBlock == saved \in {"summary", "blocked"} => complete
SDKNeedsReceipt == ~opened
FailurePreservesState == phase = "failed" => saved = "original"

Spec == Init /\ [][Next]_vars
=============================================================================
