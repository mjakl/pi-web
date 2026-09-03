import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/AppShell";

export default async function Home() {
  await connection();
  const piVersion = process.env.PI_WEB_PI_VERSION;
  if (!piVersion) throw new Error("Validated host Pi runtime version is missing. Start Pi Web through its pi-web, dev, or start command.");
  return (
    <Suspense fallback={<div style={{ height: "100%", background: "var(--bg)" }} />}>
      <AppShell piVersion={piVersion} />
    </Suspense>
  );
}
