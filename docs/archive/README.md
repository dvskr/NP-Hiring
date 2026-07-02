# Archived docs

Completed one-time plans, point-in-time audit reports, and finished work
trackers. Kept because they explain WHY the code is the way it is (audit
history, remediation records), but they are **not maintained** and must not
be read as current state.

Rule for archiving more docs: only move a file here after verifying zero
references from code/tests/scripts (`git grep <name> -- "*.ts" "*.tsx"
"*.mjs" "*.yml" ":!docs"`). Referenced docs stay at the top level even if
historical — stale pointers are worse than a longer folder listing.
