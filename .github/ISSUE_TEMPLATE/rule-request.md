---
name: Rule request
about: Propose a new rule or a change to an existing one
title: 'Rule: '
labels: rule-request
---

## Rule

<!-- Existing rule letter (A–H) to change, or "new". -->

## Signal

<!-- What in a diff or its history should this detect? Why does it make a hunk riskier to merge unreviewed? -->

## Evidence source

<!-- One of: git log / coverage report / commit size / dependency manifest / path heuristic.
     A new source needs a justification: why none of the existing ones fit. -->

## Level

<!-- HIGH, MED or LOW, and why. -->

## Minimal fixture that triggers it

<!-- Describe a tiny repo: the files, the commits before the change, and the change itself. -->

## False positive to avoid

<!-- A similar-looking change that should NOT be flagged. -->
