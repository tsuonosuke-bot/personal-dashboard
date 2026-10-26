export type NotationKeyEvent = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
  defaultPrevented?: boolean;
};

export declare function createNotationKeyboard(editor: { read: () => string; write: (text: string) => void }): {
  keydown: (event: NotationKeyEvent) => boolean;
  keyup: (event: Pick<NotationKeyEvent, "key">) => void;
  reset: () => void;
};
