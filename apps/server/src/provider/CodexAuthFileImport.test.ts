import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { importCodexAccount, removeImportedCodexCredentials } from "./CodexAuthFileImport.ts";

const testLayer = Layer.merge(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-codex-import-" }),
  ServerSettingsService.layerTest(),
).pipe(Layer.provideMerge(Layer.merge(NodeServices.layer, NodeCrypto.layer)));

const fixture = {
  auth_mode: "chatgpt",
  tokens: {
    id_token: "synthetic-id",
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    account_id: "synthetic-account",
  },
};

describe("Codex authentication file import", () => {
  it.effect("isolates each import and never stores authentication data in settings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig;
      const settings = yield* ServerSettingsService;
      const authJson = Redacted.make(JSON.stringify({ ...fixture, unknown: "discard me" }));
      const work = yield* importCodexAccount({ displayName: "Work", authJson });
      const personal = yield* importCodexAccount({
        displayName: "Personal",
        authJson: Redacted.make(
          JSON.stringify({
            ...fixture,
            tokens: { ...fixture.tokens, refresh_token: "synthetic-personal-refresh" },
          }),
        ),
      });
      const home = path.join(stateDir, "codex-account-imports", work);
      const otherHome = path.join(stateDir, "codex-account-imports", personal);
      const saved = yield* settings.getSettings;
      expect(work).not.toBe(personal);
      expect(saved.providerInstances[work]?.config).toMatchObject({
        setupMode: "existing",
        homePath: home,
      });
      expect(saved.providerInstances[personal]?.config).toMatchObject({ homePath: otherHome });
      expect(JSON.stringify(saved)).not.toContain(fixture.tokens.refresh_token);
      expect(JSON.parse(yield* fs.readFileString(path.join(home, "auth.json")))).toEqual(fixture);
      yield* removeImportedCodexCredentials(work);
      expect(yield* fs.exists(path.join(home, "auth.json"))).toBe(false);
      expect(yield* fs.exists(path.join(otherHome, "auth.json"))).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects malformed and non-ChatGPT credentials without creating an instance", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig;
      const settings = yield* ServerSettingsService;
      const before = yield* settings.getSettings;
      const result = yield* importCodexAccount({
        displayName: "Work",
        authJson: Redacted.make(JSON.stringify({ ...fixture, auth_mode: "apikey" })),
      }).pipe(Effect.flip);
      expect(result.message).toContain("Choose a valid auth.json");
      expect(result.message).not.toContain("synthetic");
      expect(yield* fs.exists(path.join(stateDir, "codex-account-imports"))).toBe(false);
      expect(yield* settings.getSettings).toEqual(before);
    }).pipe(Effect.provide(testLayer)),
  );
});
