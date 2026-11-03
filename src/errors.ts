export type ErrorCode =
  | 'bridge_port_busy'
  | 'bridge_not_connected'
  | 'bridge_timeout'
  | 'panel_tab_missing'
  | 'panel_tab_discarded'
  | 'panel_not_ready'
  | 'not_logged_in'
  | 'captcha_protected'
  | 'blocked_by_booksy'
  | 'budget_exhausted'
  | 'safe_mode_limit'
  | 'booksy_error'
  | 'request_failed'
  | 'rule_rejected'
  | 'writes_disabled_in_extension'
  | 'tool_disabled'
  | 'invalid_confirmation'
  | 'declined_by_user'
  | 'invalid_input'
  | 'chat_failed'
  | 'extension_outdated';

/** An error whose message is written for the person using the tool, including what to do next. */
export class BooksyError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BooksyError';
  }
}
