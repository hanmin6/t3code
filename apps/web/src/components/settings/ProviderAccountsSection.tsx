import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  MAX_CODEX_AUTH_FILE_BYTES,
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import * as Redacted from "effect/Redacted";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { providerAuthLabel } from "./providerStatus";

export function ProviderAccountsSection({
  environmentId,
  accounts,
  canAddAccount,
  canImportCodex,
  onAddAccount,
  onSelectAccount,
}: {
  readonly environmentId: EnvironmentId;
  readonly accounts: readonly ServerProvider[];
  readonly canAddAccount: boolean;
  readonly canImportCodex: boolean;
  readonly onAddAccount: () => void;
  readonly onSelectAccount: (instanceId: ProviderInstanceId) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const [importOpen, setImportOpen] = useState(false);
  const supportsImport = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) => config?.environment.capabilities.codexAuthFileImport === true,
  );
  if (!canAddAccount && accounts.length === 0) return null;

  return (
    <SettingsSection
      title={gt("Provider accounts")}
      headerAction={
        canAddAccount ? (
          <div className="flex flex-wrap gap-2">
            {canImportCodex && supportsImport ? (
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <T>Import Codex auth.json</T>
              </Button>
            ) : null}
            <Button size="sm" onClick={onAddAccount}>
              <T>Add account</T>
            </Button>
          </div>
        ) : null
      }
    >
      <SettingsGroup>
        {accounts.length === 0 ? (
          <SettingsRow
            title={gt("Connect a Codex or Antigravity account")}
            description={gt(
              "Choose a connected account from the model picker when starting a thread.",
            )}
          />
        ) : (
          accounts.map((account) => (
            <SettingsRow
              key={account.instanceId}
              title={
                account.displayName ?? PROVIDER_DISPLAY_NAMES[account.driver] ?? account.driver
              }
              description={
                <span className="flex flex-col gap-1">
                  <span>
                    {PROVIDER_DISPLAY_NAMES[account.driver] ?? account.driver} ·{" "}
                    {!account.enabled
                      ? gt("Disabled", { $context: "provider status" })
                      : account.auth.status === "authenticated"
                        ? (providerAuthLabel(account.auth, m) ??
                          gt("Signed in", { $context: "account status" }))
                        : account.auth.status === "unauthenticated"
                          ? gt("Not authenticated")
                          : gt("Checking provider status")}
                  </span>
                  {account.usageLimits?.windows.map((window) => (
                    <span key={window.id}>
                      {gt("{window}: {percent}% left", {
                        window: window.label,
                        percent: remainingPercent(window),
                      })}
                      {window.resetsAt ? (
                        <>
                          {" · "}
                          <time dateTime={window.resetsAt}>
                            {formatUpcomingTimestamp(
                              window.resetsAt,
                              timestampFormat,
                              undefined,
                              undefined,
                              m,
                            )}
                          </time>
                        </>
                      ) : null}
                    </span>
                  ))}
                </span>
              }
              control={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectAccount(account.instanceId)}
                >
                  <T>View account</T>
                </Button>
              }
            />
          ))
        )}
      </SettingsGroup>
      {importOpen && canImportCodex && supportsImport ? (
        <ImportCodexAccountDialog
          environmentId={environmentId}
          onClose={() => setImportOpen(false)}
          onImported={(id) => {
            setImportOpen(false);
            onSelectAccount(id);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

function ImportCodexAccountDialog({
  environmentId,
  onClose,
  onImported,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onImported: (id: ProviderInstanceId) => void;
}) {
  const gt = useGT();
  const runImport = useAtomCommand(serverEnvironment.importCodexAccount, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={gt("Import Codex auth.json")}
          description={gt(
            "Import a ChatGPT login from the Codex CLI into a separate account on this device.",
          )}
        />
        <WizardPanel>
          <form
            id="import-codex-account"
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
              const data = new FormData(event.currentTarget);
              const displayName = String(data.get("label") ?? "").trim();
              const file = data.get("authFile");
              if (!displayName || !(file instanceof File) || file.size === 0) return;
              if (file.size > MAX_CODEX_AUTH_FILE_BYTES) {
                setError(gt("The Codex authentication file is too large."));
                return;
              }
              setError(null);
              setPending(true);
              const contents = await settlePromise(() => file.text());
              if (contents._tag !== "Success") {
                setPending(false);
                setError(gt("Could not read the selected file."));
                return;
              }
              const result = await runImport({
                environmentId,
                input: { displayName, authJson: Redacted.make(contents.value) },
              });
              setPending(false);
              if (result._tag === "Success") {
                onImported(result.value);
              } else {
                setError(
                  gt(
                    "Could not import this file. Choose an auth.json from a ChatGPT login in the Codex CLI.",
                  ),
                );
              }
            }}
          >
            <label className="grid gap-2 text-sm">
              <T>Account name</T>
              <Input name="label" required maxLength={80} disabled={pending} />
            </label>
            <label className="grid gap-2 text-sm">
              <T>Codex authentication file</T>
              <Input
                name="authFile"
                type="file"
                accept=".json,application/json"
                required
                disabled={pending}
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </WizardPanel>
        <WizardFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            <T>Cancel</T>
          </Button>
          <Button type="submit" form="import-codex-account" disabled={pending}>
            {pending ? gt("Importing…") : gt("Import account")}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
