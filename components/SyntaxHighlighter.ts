// The react-syntax-highlighter package root eagerly requires every build it
// ships -- the full Prism (all 297 refractor grammars), highlight.js, and the
// async variants -- so importing anything from it puts ~1.1 MB on the page's
// first-paint chunk. Deep-import the light build instead and register only the
// languages this app can actually ask for. Each grammar registers its own
// dependencies and declares its aliases, so "ts" and "yml" keep working.
import PrismLight from "react-syntax-highlighter/dist/cjs/prism-light";

// Every language app/api/files/[...path]/route.ts can return from getLanguage().
import bash from "refractor/bash";
import c from "refractor/c";
import cpp from "refractor/cpp";
import csharp from "refractor/csharp";
import css from "refractor/css";
import docker from "refractor/docker";
import go from "refractor/go";
import graphql from "refractor/graphql";
import hcl from "refractor/hcl";
import java from "refractor/java";
import javascript from "refractor/javascript";
import json from "refractor/json";
import kotlin from "refractor/kotlin";
import makefile from "refractor/makefile";
import markdown from "refractor/markdown";
import markup from "refractor/markup";
import python from "refractor/python";
import ruby from "refractor/ruby";
import rust from "refractor/rust";
import sql from "refractor/sql";
import swift from "refractor/swift";
import toml from "refractor/toml";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";

// Fence languages that only reach the chat transcript, never the file viewer.
import dart from "refractor/dart";
import diff from "refractor/diff";
import elixir from "refractor/elixir";
import git from "refractor/git";
import haskell from "refractor/haskell";
import ini from "refractor/ini";
import jsx from "refractor/jsx";
import less from "refractor/less";
import lua from "refractor/lua";
import nginx from "refractor/nginx";
import objectivec from "refractor/objectivec";
import perl from "refractor/perl";
import php from "refractor/php";
import powershell from "refractor/powershell";
import protobuf from "refractor/protobuf";
import r from "refractor/r";
import regex from "refractor/regex";
import scala from "refractor/scala";
import scss from "refractor/scss";
import tsx from "refractor/tsx";

for (const language of [
  bash, c, cpp, csharp, css, docker, go, graphql, hcl, java, javascript, json,
  kotlin, makefile, markdown, markup, python, ruby, rust, sql, swift, toml,
  typescript, yaml,
  dart, diff, elixir, git, haskell, ini, jsx, less, lua, nginx, objectivec,
  perl, php, powershell, protobuf, r, regex, scala, scss, tsx,
]) {
  PrismLight.registerLanguage("", language);
}

// getLanguage() also returns "html" and "xml", which Prism serves from "markup".
PrismLight.alias("markup", ["html", "xml"]);

export { PrismLight as SyntaxHighlighter };
export { default as renderSyntaxNode } from "react-syntax-highlighter/dist/cjs/create-element";
