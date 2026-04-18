import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "./apps/notes/types";
import { listUsers, createUser as apiCreateUser } from "./apps/notes/api";

type Ctx = {
  users: User[];
  current: User | null;
  loading: boolean;
  selectUser: (name: string) => void;
  createAndSelect: (displayName: string) => Promise<User>;
  refresh: () => Promise<void>;
  logout: () => void;
};

const UserCtx = createContext<Ctx | null>(null);

const STORAGE_KEY = "istickmd.currentUser";

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [current, setCurrent] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await listUsers();
    setUsers(list);
    const stored = localStorage.getItem(STORAGE_KEY);
    const found = stored ? list.find((u) => u.name === stored) : null;
    setCurrent(found ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [refresh]);

  const selectUser = useCallback(
    (name: string) => {
      const u = users.find((x) => x.name === name);
      if (!u) return;
      localStorage.setItem(STORAGE_KEY, name);
      setCurrent(u);
    },
    [users],
  );

  const createAndSelect = useCallback(async (displayName: string) => {
    const u = await apiCreateUser(displayName);
    const list = await listUsers();
    setUsers(list);
    localStorage.setItem(STORAGE_KEY, u.name);
    setCurrent(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setCurrent(null);
  }, []);

  return (
    <UserCtx.Provider
      value={{ users, current, loading, selectUser, createAndSelect, refresh, logout }}
    >
      {children}
    </UserCtx.Provider>
  );
}

export function useUser(): Ctx {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error("useUser outside UserProvider");
  return ctx;
}

export function useRequireUser(): User {
  const { current } = useUser();
  if (!current) throw new Error("no user selected");
  return current;
}
