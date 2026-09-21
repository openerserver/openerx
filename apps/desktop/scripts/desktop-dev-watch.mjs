// Native compilers replace/lock executables in these generated directories.
// Watching them on Windows can raise EBUSY and terminate the renderer server.
// Keep native source files watched so editing the helper still triggers updates.
export function isDesktopBuildArtifact(file) {
  const normalized = file.replaceAll("\\", "/");
  return (
    /(?:^|\/)(?:out|\.native-build)(?:\/|$)/u.test(normalized) ||
    /(?:^|\/)native\/windows-desktop-helper\/(?:bin|obj)(?:\/|$)/u.test(normalized)
  );
}
