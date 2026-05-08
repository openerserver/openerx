import { defineStore } from "pinia";
import { ref } from "vue";

export interface User {
  id: string;
  username: string;
  phoneNumber?: string | null;
  displayName: string;
  email?: string | null;
  role: string;
  accountStatus?: "active" | "disabled";
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  projects?: Array<{
    id: string;
    role: string;
    name?: string;
    slug?: string;
    orgId?: string | null;
    orgName?: string | null;
  }>;
}

export const useAuthStore = defineStore(
  "auth",
  () => {
    const token = ref<string | null>(null);
    const user = ref<User | null>(null);

    function login(nextToken: string, nextUser: User) {
      token.value = nextToken;
      user.value = nextUser;
    }

    function setUser(nextUser: User | null) {
      user.value = nextUser;
    }

    function patchUser(patch: Partial<User>) {
      if (!user.value) return;
      user.value = { ...user.value, ...patch };
    }

    function logout() {
      token.value = null;
      user.value = null;
    }

    return {
      token,
      user,
      login,
      setUser,
      patchUser,
      logout,
    };
  },
  {
    persist: true,
  },
);
