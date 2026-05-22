import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import api from "../api/axios";

export interface User {
  id: number;
  email: string;
  username: string;
  created_at: string;
  cash_balance?: number | string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    username: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function storeSession(token: string, user: User) {
  localStorage.setItem("token", token);
  return { token, user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem("token")
  );
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>(
      "/auth/login",
      { email, password }
    );
    const session = storeSession(data.token, data.user);
    setToken(session.token);
    setUser(session.user);
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const { data } = await api.post<{ token: string; user: User }>(
        "/auth/register",
        { email, username, password }
      );
      const session = storeSession(data.token, data.user);
      setToken(session.token);
      setUser(session.user);
    },
    []
  );

  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = localStorage.getItem("token");
      if (!storedToken) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await api.get<User>("/auth/me");
        setToken(storedToken);
        setUser(data);
      } catch {
        localStorage.removeItem("token");
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout }),
    [user, token, loading, login, register, logout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
