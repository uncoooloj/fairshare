import { useEffect, useRef } from "react";
import {
  highlightSegments,
  type SourceHighlight,
} from "../lib/source-highlights";
export function HighlightedSource({
  source,
  highlights,
  selected,
  onSelect,
}: {
  source: string;
  highlights: SourceHighlight[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);
  return (
    <div ref={root} className="review-source-text" tabIndex={0}>
      {highlightSegments(source, highlights).map((segment) =>
        segment.ids.length ? (
          <button
            type="button"
            className="source-highlight"
            key={segment.start}
            data-selected={selected !== null && segment.ids.includes(selected)}
            aria-pressed={selected !== null && segment.ids.includes(selected)}
            onClick={() => onSelect(segment.ids[0])}
          >
            {segment.text}
          </button>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        ),
      )}
    </div>
  );
}
