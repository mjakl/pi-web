import { Suspense } from "react";
import { homedir } from "os";
import { connection } from "next/server";
import { AppShell } from "@/components/AppShell";

export default async function Home() {
  await connection();
  return (
    <Suspense fallback={<div style={{ height: "100%", background: "var(--bg)" }} />}>
      <AppShell homeDir={homedir()} />
    </Suspense>
  );
}
