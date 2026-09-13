import { assistantEntry } from "@adapters/fake/index";

export const RAW_BLOCKS = [
  " \t# Raw *answer* & <tag>\n\n- one\n",
  '\n```ts\nconst x = "<&>";\n```\n\n',
  "last  \n",
];
export const RAW_ANSWER = RAW_BLOCKS.join("");

export function copyAnswerEntry(
  id = "answer",
  parentId: string | null = "user",
) {
  const entry = assistantEntry(id, parentId, "", 100);
  if (entry.type !== "message" || entry.message.role !== "assistant")
    throw new Error("Expected assistant fixture");
  entry.message.content = [
    { type: "thinking", thinking: "PRIVATE REASONING" },
    { type: "text", text: RAW_BLOCKS[0] ?? "" },
    {
      type: "toolCall",
      id: "call",
      name: "read",
      arguments: { path: "TOOL-ONLY.txt" },
    },
    { type: "text", text: RAW_BLOCKS[1] ?? "" },
    { type: "thinking", thinking: "MORE PRIVATE REASONING" },
    { type: "text", text: RAW_BLOCKS[2] ?? "" },
  ];
  return entry;
}
