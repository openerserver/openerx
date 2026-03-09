import { defineStore } from "pinia";
import { ref } from "vue";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  projects?: Array<{ id: string; role: string }>;
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

    function logout() {
      token.value = null;
      user.value = null;
    }

    return {
      token,
      user,
      login,
      logout,
    };
  },
  {
    persist: true,
  },
);
