-- quiz_log.format に四択を追加する。既存の値はそのまま許可したままの追加のみ。
-- ダッシュボードの出題形式選択（四択）を有効にする前に一度だけ実行する。
alter table public.quiz_log drop constraint quiz_log_format_check;

alter table public.quiz_log add constraint quiz_log_format_check
  check (format in ('一問一答', '四択', 'ソクラテス式', '記述説明', '産出'));
