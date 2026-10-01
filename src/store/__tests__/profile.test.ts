import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserProfile } from "@/domain/profile";

// ─── Mocks (hoisted para que vi.mock los vea) ────────────────────────────────
const { mockRow, mockSession } = vi.hoisted(() => ({
  mockRow: { current: null as Record<string, unknown> | null },
  mockSession: { userId: "user-1" as string | null },
}));

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: mockSession.userId ? { user: { id: mockSession.userId } } : null },
      }),
    },
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        mockRow.current = row;
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mockRow.current, error: null }),
        }),
      }),
    }),
  },
}));

import { loadProfile, saveProfile, pushProfile, pullProfile, syncProfile } from "../profile";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "p1",
    wakeTime: "07:00",
    sleepTime: "22:30",
    chronotype: "matutino",
    workStart: "09:00",
    workEnd: "18:00",
    activities: ["Leer"],
    breakMin: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  mockRow.current = null;
  mockSession.userId = "user-1";
});

describe("profile sync (sin cifrado falso)", () => {
  it("sube JSON claro en la columna `data`, nunca en `encrypted`", async () => {
    saveProfile(makeProfile({ wakeTime: "06:15" }));

    const res = await pushProfile();

    expect(res.ok).toBe(true);
    expect(mockRow.current).not.toBeNull();
    expect(mockRow.current).toHaveProperty("data");
    expect(mockRow.current).not.toHaveProperty("encrypted");
    const parsed = JSON.parse(mockRow.current!.data as string) as UserProfile;
    expect(parsed.wakeTime).toBe("06:15");
    expect(parsed.activities).toEqual(["Leer"]);
  });

  it("baja y parsea el JSON remoto", async () => {
    mockRow.current = {
      data: JSON.stringify(
        makeProfile({ id: "p2", wakeTime: "05:30", updatedAt: "2030-01-01T00:00:00.000Z" }),
      ),
      updated_at: "2030-01-01T00:00:00.000Z",
    };

    const pulled = await pullProfile();

    expect(pulled?.wakeTime).toBe("05:30");
    expect(loadProfile()?.id).toBe("p2");
  });

  it("ignora una fila heredada con AES-GCM sin romper", async () => {
    // base64 de un ciphertext viejo: no es JSON válido.
    mockRow.current = { data: "q83v6wFjaXBoZXJ0ZXh0", updated_at: "2030-01-01T00:00:00.000Z" };

    const pulled = await pullProfile();

    expect(pulled).toBeNull();
    expect(loadProfile()).toBeNull();
  });

  it("sin sesión no sube nada a la nube", async () => {
    mockSession.userId = null;
    saveProfile(makeProfile());

    const res = await pushProfile();

    expect(res.ok).toBe(false);
    expect(mockRow.current).toBeNull();
  });

  it("no pisa un perfil local más reciente que el remoto", async () => {
    // saveProfile sella updatedAt con "ahora" (2026) → local más nuevo que 2020.
    saveProfile(makeProfile({ wakeTime: "10:00" }));
    mockRow.current = {
      data: JSON.stringify(makeProfile({ wakeTime: "04:00", updatedAt: "2020-01-01T00:00:00.000Z" })),
      updated_at: "2020-01-01T00:00:00.000Z",
    };

    const pulled = await pullProfile();

    expect(pulled?.wakeTime).toBe("10:00");
    expect(loadProfile()?.wakeTime).toBe("10:00");
  });
});

describe("syncProfile: pull ANTES de push (una sola fila, gana el reciente)", () => {
  it("adopta el remoto más nuevo y luego lo deja subido", async () => {
    saveProfile(makeProfile({ wakeTime: "07:00" })); // updatedAt = ahora (2026)
    mockRow.current = {
      data: JSON.stringify(makeProfile({ wakeTime: "05:30", updatedAt: "2030-01-01T00:00:00.000Z" })),
      updated_at: "2030-01-01T00:00:00.000Z",
    };

    const res = await syncProfile();

    expect(res.ok).toBe(true);
    expect(loadProfile()?.wakeTime).toBe("05:30");
    // El push posterior subió el ganador (el remoto), no el local viejo.
    expect(JSON.parse(mockRow.current!.data as string).wakeTime).toBe("05:30");
  });

  it("conserva el local más nuevo y sube ESE, sin pisarlo con el remoto viejo", async () => {
    saveProfile(makeProfile({ wakeTime: "10:00" })); // updatedAt = ahora
    mockRow.current = {
      data: JSON.stringify(makeProfile({ wakeTime: "04:00", updatedAt: "2020-01-01T00:00:00.000Z" })),
      updated_at: "2020-01-01T00:00:00.000Z",
    };

    await syncProfile();

    expect(loadProfile()?.wakeTime).toBe("10:00");
    expect(JSON.parse(mockRow.current!.data as string).wakeTime).toBe("10:00");
  });
});
