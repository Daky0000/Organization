import { create } from "zustand";
import api from "../utils/api";

interface User {
  id: string;
  email: string;
  username?: string | null;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  signup: (
    email: string,
    password: string,
    agencyName: string,
    username?: string
  ) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
}

const safeUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null") as User | null;
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: safeUser(),
  token: localStorage.getItem("token"),
  isLoading: false,

  signup: async (
    email: string,
    password: string,
    agencyName: string,
    username?: string
  ) => {
    set({ isLoading: true });
    try {
      const response = await api.post("/auth/signup", {
        email,
        password,
        agencyName,
        username,
      });
      const { user, token, refreshToken } = response.data;

      localStorage.setItem("token", token);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));

      set({ user, token, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  login: async (identifier: string, password: string) => {
    set({ isLoading: true });
    try {
      const response = await api.post("/auth/login", {
        identifier,
        password,
      });
      const { user, token, refreshToken } = response.data;

      localStorage.setItem("token", token);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));

      set({ user, token, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    set({ user: null, token: null });
  },
}));
