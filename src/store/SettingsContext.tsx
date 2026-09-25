import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Settings } from "@/domain/types";
import { settingsRepo } from "./settings";

interface SettingsContextValue {
  settings: Settings;
  saveSettings: (s: Settings) => void;
}

const Ctx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => settingsRepo.load());
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      saveSettings: (s) => {
        settingsRepo.save(s);
        setSettings({ ...s });
      },
    }),
    [settings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings debe usarse dentro de SettingsProvider");
  return ctx;
}
