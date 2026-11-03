# Intent: scheduled job without an MCP client

Refs PiotrZapolski/second_brain#175.

A nightly download of a few reports and the staff schedule was done by a language model clicking in
the panel. It was slow, costly and not repeatable. The same can be done by a plain command through
the extension, with no model at all: a fixed list of reports, a summary and an exit code a shell
script can act on.

Owner change during the work: the safe-mode rule that refused requests while the panel tab was in
the background or the computer idle is removed, in both modes and for the job. Gaps, budgets, range
and export limits and the stop after 403, 429 or a captcha stay as they were.
