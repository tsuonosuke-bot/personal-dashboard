/** Focus the list heading without opening a mobile keyboard or changing URL/list state. */
export function focusKnowledgeList(heading: HTMLElement, charts: HTMLElement | null): () => void {
  const doc = heading.ownerDocument;
  let active = true;
  const align = () => {
    if (active && doc.activeElement === heading) heading.scrollIntoView({ block: "start", behavior: "instant" });
  };
  heading.focus({ preventScroll: true });
  align();
  // The summary and chart bundle load independently. Keep the destination visible if they
  // expand above it, until the user starts another action (including normal scrolling).
  const observer = charts && typeof ResizeObserver !== "undefined" ? new ResizeObserver(align) : null;
  observer?.observe(charts!);
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const stop = () => {
    active = false;
    observer?.disconnect();
    for (const event of events) doc.removeEventListener(event, stop, true);
  };
  for (const event of events) doc.addEventListener(event, stop, { capture: true, passive: true });
  return stop;
}
