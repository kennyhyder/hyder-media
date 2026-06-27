// Renders JSON-LD into a <script type="application/ld+json"> tag.
// Accepts a single schema object or an array of them.

type Json = Record<string, unknown>;

export default function JsonLd({ data }: { data: Json | Json[] }) {
  const json = Array.isArray(data) ? data : [data];
  return (
    <>
      {json.map((obj, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }}
        />
      ))}
    </>
  );
}
