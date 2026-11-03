import { Fragment } from "react";
import { isolateLatin } from "@/lib/bidi";

const LINK = /(https?:\/\/[^\s]+|t\.me\/[^\s]+)/g;

/**
 * A teacher's text from «تنظیمات عمومی» (support, terms, privacy): blank lines make paragraphs, a line
 * that starts with «- » is a list item, and web addresses become links.
 */
export function PlainText({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => line.trimStart().startsWith("- "))) {
          return (
            <ul key={index}>
              {lines.map((line, i) => (
                <li key={i}>
                  <Linked text={line.trimStart().slice(2)} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                <Linked text={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Linked({ text }: { text: string }) {
  return text.split(LINK).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part.startsWith("http") ? part : `https://${part}`} target="_blank" rel="noreferrer" dir="ltr">
        {part.replace(/^https?:\/\//, "")}
      </a>
    ) : (
      <Fragment key={index}>{isolateLatin(part)}</Fragment>
    ),
  );
}
