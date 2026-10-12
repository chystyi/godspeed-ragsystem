import type { Metadata } from "next";
import { UsageView } from "@/components/usage-view";

export const metadata: Metadata = { title: "Usage" };

// Filled in by the browser after sign-in; see the layout of the documents section.
export const instant = false;

export default function UsagePage() {
  return (
    <main className="h-full w-full overflow-y-auto">
      <UsageView />
    </main>
  );
}
