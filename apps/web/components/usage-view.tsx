"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/errors";
import { useUsage } from "@/lib/hooks";
import { dailyTotals, summarize, type Totals } from "@/lib/usage";

const PERIODS = [7, 30, 90] as const;
const number = (value: number) => value.toLocaleString("en-US");

function Card({ label, totals, children }: { label: string; totals: Totals; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="rounded-lg border border-line bg-surface p-5">
      <p className="text-sm text-muted">{children}</p>
      <p className="mt-2 font-serif text-4xl leading-none tracking-[-0.03em] text-ink">{number(totals.tokens)}</p>
      <p className="mt-2 text-sm text-muted">
        tokens · {number(totals.requests)} {totals.requests === 1 ? "request" : "requests"}
      </p>
    </div>
  );
}

/** What the signed-in person has used of the AI provider: tokens by kind, model and day. */
export function UsageView() {
  const [days, setDays] = useState<number>(30);
  const [today] = useState(() => new Date().toISOString().slice(0, 10)); // the server counts days in UTC
  const { data, error, isLoading } = useUsage(days);

  const rows = data?.rows ?? [];
  const { chat, embedding, models } = summarize(rows);
  const perDay = dailyTotals(rows, days, today);
  const peak = Math.max(1, ...perDay.map((d) => d.tokens));

  return (
    <div className="rise mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-[-0.03em] text-ink">Usage</h1>
          <p className="mt-2 text-muted">Tokens counted by the AI provider for your answers and documents.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              onClick={() => setDays(period)}
              className={`h-9 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${
                days === period ? "bg-subtle text-ink" : "text-muted hover:bg-subtle hover:text-ink"
              }`}
            >
              {period} days
            </button>
          ))}
        </div>
      </div>

      {error && <Alert>{describeError(error)}</Alert>}

      {isLoading && (
        <div aria-busy="true" aria-label="Loading usage" className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {data && rows.length === 0 && (
        <p className="py-8 text-center text-muted">No usage yet. Add a document or ask a question, and it shows up here.</p>
      )}

      {data && rows.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card label="Chat answers" totals={chat}>
              Chat answers
            </Card>
            <Card label="Document and search embeddings" totals={embedding}>
              Embeddings (documents and searches)
            </Card>
          </div>

          <section aria-labelledby="per-day">
            <h2 id="per-day" className="text-sm font-medium text-ink">
              Tokens per day
            </h2>
            <ol className="mt-3 flex h-32 items-end gap-px">
              {perDay.map(({ day, tokens }) => (
                <li
                  key={day}
                  aria-label={`${day}: ${number(tokens)} tokens`}
                  title={`${day}: ${number(tokens)} tokens`}
                  className="flex h-full flex-1 items-end"
                >
                  <span
                    aria-hidden
                    className={`w-full rounded-t-sm ${tokens > 0 ? "bg-ink" : "bg-line"}`}
                    style={{ height: tokens > 0 ? `${Math.max(4, (tokens / peak) * 100)}%` : "2px" }}
                  />
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="per-model">
            <h2 id="per-model" className="text-sm font-medium text-ink">
              By model
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <caption className="sr-only">Tokens used per model</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">Model</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Used for</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Requests</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Sent</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Received</th>
                    <th scope="col" className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={`${m.kind}-${m.model}`} className="border-b border-line">
                      <td className="py-2 pr-4 text-ink">{m.model}</td>
                      <td className="py-2 pr-4 text-muted">{m.kind === "chat" ? "Answers" : "Embeddings"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{number(m.requests)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{number(m.promptTokens)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{number(m.completionTokens)}</td>
                      <td className="py-2 text-right tabular-nums text-ink">{number(m.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              Token counts are what the provider reports; what they cost depends on the provider&rsquo;s prices.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
