import { paragraphs, rich } from "@revision-desk/shared";

/** Text with **key terms** highlighted. `rich()` escapes everything before adding <mark>. */
export function Rich({ text, as: Tag = "span" }: { text: string; as?: "span" | "p" | "li" }) {
  return <Tag dangerouslySetInnerHTML={{ __html: rich(text) }} />;
}

export function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {paragraphs(text).map((p, i) => (
        <Rich key={i} as="p" text={p} />
      ))}
    </>
  );
}
