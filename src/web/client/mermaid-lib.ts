// The lazy half of the diagram support: bundled separately and only fetched
// when a reader asks for a preview. Mermaid is larger than the whole rest of
// this application, so it never enters the main bundle.
export { default } from "mermaid";
