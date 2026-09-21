const projectIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

module.exports = ({ config }) => {
  const releaseMode = process.env.OPENERX_RELEASE_MODE === "1";
  const projectId = process.env.EXPO_PROJECT_ID?.trim() ?? "";
  if (releaseMode && !projectIdPattern.test(projectId)) {
    throw new Error("RELEASE_ENV_REQUIRED:EXPO_PROJECT_ID");
  }
  return {
    ...config,
    updates: projectId
      ? {
          enabled: true,
          url: `https://u.expo.dev/${projectId}`,
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
        }
      : { enabled: false },
    ...(projectId
      ? {
          extra: {
            ...(config.extra ?? {}),
            eas: { projectId },
          },
        }
      : {}),
  };
};
