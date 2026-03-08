import { defineStore } from "pinia";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  projects?: Array<{ id: string; role: string }>;
}

interface AuthState {
  token: string | null;
  user: User | null;
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    token: null,
    user: null,
  }),
  actions: {
    login(token: string, user: User) {
      this.token = token;
      this.user = user;
    },
    logout() {
      this.token = null;
      this.user = null;
    },
  },
  persist: true,
});
