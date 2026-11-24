import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

describe("UsageLimitsPooled reset times", () => {
  it("keeps individual reset times visible in a narrow, multi-account pool", async () => {
    const now = Date.parse(checkedAt);
    const accounts = Array.from({ length: 8 }, (_, index) => {
      const resetsAt = new Date(now + (index + 1) * 3_600_000).toISOString();
      return {
        provider: {
          ...managedChatGpt(`codex_${index}`, `Codex ${index + 1}`),
          usageLimits: {
            checkedAt,
            windows: [
              {
                id: "weekly",
                kind: "weekly",
                label: "Weekly",
                usedPercent: 40,
                resetsAt,
              },
            ],
          },
        } satisfies ServerProvider,
        resetsAt,
        countdown: `resets in ${index + 1}h 0m`,
      };
    });
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: { providers: accounts.map(({ provider }) => provider) },
        },
      ],
    ]);
    const container = document.createElement("div");
    container.style.width = "320px";
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={now} />,
      { container },
    );

    expect(container.querySelector("time")?.dateTime).toBe(accounts[0]?.resetsAt);
    await expect.element(screen.getByText("(+5%)", { exact: true })).toBeVisible();
    for (const { provider, resetsAt, countdown } of accounts) {
      const account = screen.getByRole("button", {
        name: new RegExp(`^${provider.displayName}: 60% left,`),
      });
      await expect.element(account.getByText(countdown, { exact: true })).toBeVisible();
      const accountElement = account.element();
      const resetTime = accountElement.querySelector("time");
      expect(resetTime?.dateTime).toBe(resetsAt);
      expect(resetTime?.textContent).toBeTruthy();
      expect(accountElement.scrollWidth).toBeLessThanOrEqual(accountElement.clientWidth);
    }
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });
});
