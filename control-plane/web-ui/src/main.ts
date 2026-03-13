import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import { createApp } from "vue";
import "ant-design-vue/dist/reset.css";
import "highlight.js/styles/github.css";

import App from "./App.vue";
import router from "./router";

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

const app = createApp(App);
app.use(pinia);
app.use(router);
app.mount("#app");
