#include <CoreGraphics/CoreGraphics.h>
#include <node_api.h>

// Run inside Electron's main process so macOS registers the application that
// the user opened. Request authorization only; do not capture screen contents.
static napi_value request_screen_capture(napi_env env, napi_callback_info info) {
  (void)info;
  const bool granted = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess();
  napi_value result;
  if (napi_get_boolean(env, granted, &result) != napi_ok) return NULL;
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value request;
  if (napi_create_function(env, "requestScreenCapture", NAPI_AUTO_LENGTH,
                           request_screen_capture, NULL, &request) != napi_ok ||
      napi_set_named_property(env, exports, "requestScreenCapture", request) != napi_ok) {
    return NULL;
  }
  return exports;
}

NAPI_MODULE(openerx_screen_permission, initialize)
