import {
  DEFAULT_WEB_SETTINGS,
  webSettingsPatch,
  type WebSettingsStore,
} from "@core/web-settings";
import {
  readWebState,
  webStatePath,
  writeWebState,
} from "@adapters/fs/web-state";

export function createWebSettingsStore(agentDir: string): WebSettingsStore {
  const path = webStatePath(agentDir, "settings.json");
  const get = () => ({
    ...DEFAULT_WEB_SETTINGS,
    ...readWebState(path, webSettingsPatch),
  });
  get();
  return {
    get,
    update(patch) {
      const next = { ...get(), ...webSettingsPatch(patch) };
      writeWebState(path, next);
      return next;
    },
  };
}
