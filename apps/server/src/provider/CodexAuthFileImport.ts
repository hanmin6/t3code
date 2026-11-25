import {
  MAX_CODEX_AUTH_FILE_BYTES,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSetupError,
  type CodexImportAccountInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const ImportedCodexId = /^codex_import_[a-f0-9-]{36}$/u;
const Token = Schema.NonEmptyString.check(Schema.isMaxLength(32_768));
const AuthFile = Schema.fromJsonString(
  Schema.Struct({
    auth_mode: Schema.optionalKey(Schema.Literal("chatgpt")),
    tokens: Schema.Struct({
      id_token: Token,
      access_token: Token,
      refresh_token: Token,
      account_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    last_refresh: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);
const decodeAuthFile = Schema.decodeUnknownResult(AuthFile);
const encodeAuthFile = Schema.encodeSync(AuthFile);

export const importCodexAccount = Effect.fn("CodexAuthFileImport.importAccount")(function* (
  input: CodexImportAccountInput,
) {
  const config = yield* ServerConfig;
  const settings = yield* ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const uuid = yield* random.uuidV4().pipe(Effect.orDie);
  const instanceId = ProviderInstanceId.make(`codex_import_${uuid}`);
  const failure = (detail: string) =>
    new ProviderSetupError({ instanceId, operation: "import", detail });

  const json = Redacted.value(input.authJson);
  if (Buffer.byteLength(json, "utf8") > MAX_CODEX_AUTH_FILE_BYTES) {
    return yield* failure("The Codex authentication file is too large.");
  }
  const parsed = decodeAuthFile(json);
  if (parsed._tag === "Failure") {
    return yield* failure("Choose a valid auth.json from a ChatGPT login in the Codex CLI.");
  }
  const root = path.join(config.stateDir, "codex-account-imports");
  const homePath = path.join(root, instanceId);
  const fileOptions = { flag: "wx", mode: 0o600 } as const;
  const writeFailure = () =>
    failure("Could not save the imported Codex login on this environment.");

  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      yield* fs
        .makeDirectory(root, { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError(writeFailure));
      yield* fs.makeDirectory(homePath, { mode: 0o700 }).pipe(Effect.mapError(writeFailure));
      yield* Effect.gen(function* () {
        yield* fs
          .writeFileString(
            path.join(homePath, "auth.json"),
            encodeAuthFile(parsed.success),
            fileOptions,
          )
          .pipe(Effect.mapError(writeFailure));
        yield* fs
          .writeFileString(
            path.join(homePath, "config.toml"),
            'cli_auth_credentials_store = "file"\n',
            fileOptions,
          )
          .pipe(Effect.mapError(writeFailure));
        yield* settings.updateProviderInstance({
          operation: "create",
          instanceId,
          instance: {
            driver: ProviderDriverKind.make("codex"),
            displayName: input.displayName,
            enabled: true,
            config: { setupMode: "existing", homePath },
          },
        });
      }).pipe(
        Effect.onError(() =>
          fs.remove(homePath, { recursive: true, force: true }).pipe(Effect.ignore),
        ),
      );
      return instanceId;
    }),
  );
});

export const removeImportedCodexCredentials = Effect.fn("CodexAuthFileImport.removeCredentials")(
  function* (instanceId: ProviderInstanceId) {
    if (!ImportedCodexId.test(instanceId)) return;
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.remove(path.join(config.stateDir, "codex-account-imports", instanceId, "auth.json"), {
      force: true,
    });
  },
);
