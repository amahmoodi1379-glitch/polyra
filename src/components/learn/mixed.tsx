import { Fragment } from "react";
import { splitLatin } from "@/lib/bidi";

/** Persian text with French or German words in it: each Latin run is isolated and set in the target typeface. */
export function Mixed({ text }: { text: string }) {
  return splitLatin(text).map((part, index) =>
    part.latin ? (
      <bdi key={index} className="lat" dir="ltr">
        {part.text}
      </bdi>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}
