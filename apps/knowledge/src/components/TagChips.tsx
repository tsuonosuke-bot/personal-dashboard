import { displayTags } from "../lib/knowledge";
import type { Knowledge } from "../types";

interface Props {
  item: Pick<Knowledge, "tags" | "auto_tags">;
  /** 渡すと、自動タグに「外す」ボタンを出す。 */
  onRemoveAuto?: (tag: string) => void;
  disabled?: boolean;
  /** タグが無いときに出す文言。省略すると何も出さない。 */
  emptyLabel?: string;
}

/** 自分で付けたタグと自動タグ（#93）を1つの並びで見せる。自動タグには「自動」の印を付ける。 */
export function TagChips({ item, onRemoveAuto, disabled, emptyLabel }: Props) {
  const tags = displayTags(item);
  if (tags.length === 0) return emptyLabel ? <span className="muted">{emptyLabel}</span> : null;
  return (
    <>
      {tags.map(({ tag, auto }) => auto ? (
        <span className="tag tag-auto" key={`auto:${tag}`} title="意味の近さから自動で付いたタグ">
          #{tag}<small>自動</small>
          {onRemoveAuto && (
            <button type="button" className="tag-remove" aria-label={`自動タグ「${tag}」を外す`} onClick={() => onRemoveAuto(tag)} disabled={disabled}>×</button>
          )}
        </span>
      ) : <span className="tag" key={tag}>#{tag}</span>)}
    </>
  );
}
