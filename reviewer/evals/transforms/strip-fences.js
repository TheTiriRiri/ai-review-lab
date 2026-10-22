// promptfoo transform (defaultTest.options.transform): some models wrap the JSON in a Markdown code fence even
// when the prompt asks them not to. Removing one surrounding fence lets is-json grade the object, not the wrapping.
const FENCED = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i;

export default function stripFences(output) {
  if (typeof output !== "string") {
    return output;
  }
  const trimmed = output.trim();
  return FENCED.exec(trimmed)?.[1] ?? trimmed;
}
