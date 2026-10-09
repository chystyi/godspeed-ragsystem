import type { ChatSource } from "@kb/shared";
import { splitCitations } from "@/lib/citations";

interface AnswerTextProps {
  text: string;
  sources: ChatSource[];
  /** Called when a citation marker is pressed. */
  onCite: (number: number) => void;
}

/** The answer with its [1] markers turned into buttons that open the source. */
export function AnswerText({ text, sources, onCite }: AnswerTextProps) {
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-body">
      {splitCitations(text, sources.length).map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span key={index} className="whitespace-nowrap">
            {part.numbers.map((number) => (
              <button
                key={number}
                type="button"
                onClick={() => onCite(number)}
                aria-label={`Source ${number}: ${sources[number - 1]?.documentTitle ?? ""}`}
                className="mx-0.5 inline-flex h-[1.2rem] min-w-[1.2rem] items-center justify-center rounded border border-line bg-subtle px-1 align-baseline font-mono text-[11px] leading-none text-ink transition-colors duration-150 hover:border-ink"
              >
                {number}
              </button>
            ))}
          </span>
        ),
      )}
    </p>
  );
}
