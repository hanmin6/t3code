import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ runImport: vi.fn() }));
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make({ environment: { capabilities: { codexAuthFileImport: true } } });
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      configValueAtom: (() => config) as never,
    },
  };
});
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => mocks.runImport) as never,
}));

import { ProviderAccountsSection } from "./ProviderAccountsSection";

const environmentId = EnvironmentId.make("desk");
const accountId = ProviderInstanceId.make("codex_import_synthetic");
const base = {
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  checkedAt: "2026-07-24T12:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
} as const;
const accounts: readonly ServerProvider[] = [
  {
    ...base,
    instanceId: accountId,
    driver: ProviderDriverKind.make("codex"),
    displayName: "Work",
    auth: { status: "authenticated" },
    usageLimits: {
      checkedAt: base.checkedAt,
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          kind: "weekly",
          usedPercent: 30,
          resetsAt: "2030-01-01T18:00:00.000Z",
        },
      ],
    },
  },
  {
    ...base,
    instanceId: ProviderInstanceId.make("antigravity_personal"),
    driver: ProviderDriverKind.make("antigravity"),
    displayName: "Personal",
    auth: { status: "unauthenticated" },
  },
];

it("lists both providers and opens the selected account", async () => {
  const selectAccount = vi.fn();
  const addAccount = vi.fn();
  await using screen = await render(
    <ProviderAccountsSection
      environmentId={environmentId}
      accounts={accounts}
      canAddAccount
      canImportCodex
      onAddAccount={addAccount}
      onSelectAccount={selectAccount}
    />,
  );
  await expect.element(screen.getByText(/Weekly: 70% left/)).toBeVisible();
  await expect.element(screen.getByText("Personal", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "View account" }).first().click();
  expect(selectAccount).toHaveBeenCalledWith(accountId);
  await screen.getByRole("button", { name: "Add account" }).click();
  expect(addAccount).toHaveBeenCalledOnce();
});

it("sends the selected Codex file as a redacted value to the chosen environment", async () => {
  const selectAccount = vi.fn();
  mocks.runImport.mockResolvedValue({ _tag: "Success", value: accountId });
  await using screen = await render(
    <ProviderAccountsSection
      environmentId={environmentId}
      accounts={[]}
      canAddAccount
      canImportCodex
      onAddAccount={() => {}}
      onSelectAccount={selectAccount}
    />,
  );
  await screen.getByRole("button", { name: "Import Codex auth.json" }).click();
  await userEvent.fill(page.getByLabelText("Account name"), "Work");
  const content = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"synthetic"}}';
  await userEvent.upload(
    page.getByLabelText("Codex authentication file"),
    new File([content], "auth.json", { type: "application/json" }),
  );
  await page.getByRole("button", { name: "Import account" }).click();
  await expect.poll(() => selectAccount.mock.calls).toEqual([[accountId]]);
  const [request] = mocks.runImport.mock.calls[0]!;
  expect(request.environmentId).toBe(environmentId);
  expect(request.input.displayName).toBe("Work");
  expect(Redacted.isRedacted(request.input.authJson)).toBe(true);
  expect(Redacted.value(request.input.authJson)).toBe(content);
});
