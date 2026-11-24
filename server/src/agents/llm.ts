import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { config, type Effort } from "../config.ts";

/** Credentials come from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile. */
export const anthropic = new Anthropic();

/** An error whose message is safe and useful to show the person using the app. */
export class AgentError extends Error {
  constructor(message: string, readonly agent?: string) {
    super(message);
    this.name = "AgentError";
  }
}

/** Shared ground rules every agent follows. Kept byte-stable so it stays in the prompt cache. */
const TEAM_RULES = `You are one agent in Revision Desk, a team of agents that turns transcripts (lectures, classes, talks, podcasts, meetings), plus any slides and images the student uploads, into revision notes for students.

House style for everything you write:
- Plain, simple language: short sentences and everyday words. Explain any jargon the first time it appears.
- Stay faithful to the transcript. You may add simple everyday examples and analogies to make an idea clear, but never invent facts the transcript does not support.
- Ignore filler, small talk and housekeeping (greetings, reminders about homework, audio problems).
- In explanations, wrap 1-3 key terms in **double asterisks** so the app can highlight them. Use no other markdown.`;

export interface AgentCall<Schema extends z.ZodType> {
  /** Name shown in logs and errors, e.g. "outline". */
  agent: string;
  /** Large, reusable source material (usually the transcript). Placed in the cached system prefix. */
  context: string;
  /** The specific job for this call: text, or content blocks when images are included. */
  task: string | BetaContentBlockParam[];
  schema: Schema;
  signal?: AbortSignal;
  effort?: Effort;
}

/**
 * Run one agent: a single Claude call with structured JSON output.
 * The shared rules + source material sit in a cached system prefix, so agents that
 * work over the same transcript (outline, then each section writer) reuse the cache.
 */
export async function runAgent<Schema extends z.ZodType>(call: AgentCall<Schema>): Promise<z.infer<Schema>> {
  const started = Date.now();
  try {
    const stream = anthropic.beta.messages.stream(
      {
        model: config.model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: call.effort ?? config.effort, format: betaZodOutputFormat(call.schema) },
        system: [
          { type: "text", text: TEAM_RULES },
          { type: "text", text: `SOURCE MATERIAL\n<<<\n${call.context}\n>>>`, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: call.task }],
      },
      { signal: call.signal },
    );

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new AgentError("Claude declined to process this content, so nothing was changed.", call.agent);
    }
    if (message.stop_reason === "max_tokens") {
      throw new AgentError("Claude's answer was too long and got cut off. Try a shorter transcript or add it in parts.", call.agent);
    }
    const parsed = message.parsed_output;
    if (parsed == null) {
      throw new AgentError("Claude's answer couldn't be read. Nothing was changed. Try again.", call.agent);
    }

    const u = message.usage;
    console.log(
      `[agent:${call.agent}] ${Date.now() - started}ms in=${u.input_tokens} cached=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens}`,
    );
    return parsed as z.infer<Schema>;
  } catch (err) {
    throw toAgentError(err, call.agent);
  }
}

function toAgentError(err: unknown, agent: string): Error {
  if (err instanceof AgentError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AgentError("Cancelled. Nothing was changed.", agent);
  if (err instanceof Anthropic.AuthenticationError)
    return new AgentError("The server's Anthropic credentials are missing or invalid. Set ANTHROPIC_API_KEY or run `ant auth login`.", agent);
  if (err instanceof Anthropic.RateLimitError) return new AgentError("Claude is rate limited right now. Wait a minute and try again.", agent);
  if (err instanceof Anthropic.BadRequestError) {
    console.error(`[agent:${agent}] bad request`, err.message);
    return new AgentError("Claude couldn't accept this request. If the transcript is very long, add it in parts.", agent);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AgentError("Couldn't reach Claude. Check the server's internet connection.", agent);
  if (err instanceof Anthropic.APIError) {
    console.error(`[agent:${agent}] API error ${err.status}`, err.message);
    return new AgentError("Claude had a problem answering. Try again in a moment.", agent);
  }
  console.error(`[agent:${agent}]`, err);
  return new AgentError("Something went wrong while making the notes. Try again.", agent);
}

/** Run async jobs with a concurrency limit, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
