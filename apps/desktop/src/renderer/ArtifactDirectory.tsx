import type { Artifact } from "@openerx/contracts";
import { CaretRight, FileText, FolderSimple } from "@phosphor-icons/react";
import { useId, useMemo } from "react";
import "./artifact-directory.css";

interface OutputDirectory {
  name: string;
  path: string;
  fileCount: number;
  directories: Map<string, OutputDirectory>;
  files: { name: string; artifact: Artifact }[];
}

const nameOrder = new Intl.Collator("zh-CN", { numeric: true });

function outputDirectory(artifacts: Artifact[]): OutputDirectory {
  const root: OutputDirectory = {
    name: "输出文件",
    path: "",
    fileCount: 0,
    directories: new Map(),
    files: [],
  };
  for (const artifact of artifacts) {
    const segments = artifact.displayName
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment && segment !== ".");
    // Non-relative names stay intact in the default folder. This is a view of
    // saved outputs, not a filesystem path resolution or a move of the files.
    const parts = segments.includes("..") ? [artifact.displayName] : segments;
    const name = parts.pop() || artifact.displayName;
    let directory = root;
    directory.fileCount += 1;
    for (const segment of parts) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: directory.path ? `${directory.path}/${segment}` : segment,
          fileCount: 0,
          directories: new Map(),
          files: [],
        };
        directory.directories.set(segment, child);
      }
      child.fileCount += 1;
      directory = child;
    }
    directory.files.push({ name, artifact });
  }
  return root;
}

interface DirectoryActions {
  expandedDirectories: ReadonlySet<string>;
  compact?: boolean;
  expandAll?: boolean;
  collapsedDirectories?: ReadonlySet<string>;
  onToggleDirectory: (path: string) => void;
  onSelectArtifact: (artifactId: string) => void;
}

function DirectoryNode({
  directory,
  ...actions
}: DirectoryActions & { directory: OutputDirectory }): React.JSX.Element {
  const contentsId = useId();
  const expanded = actions.expandAll
    ? !actions.collapsedDirectories?.has(directory.path)
    : actions.expandedDirectories.has(directory.path);
  return (
    <li className="artifact-directory">
      <button
        type="button"
        className="artifact-directory-toggle"
        aria-label={`目录 ${directory.path || directory.name}`}
        aria-expanded={expanded}
        aria-controls={contentsId}
        title={directory.path || directory.name}
        onClick={() => actions.onToggleDirectory(directory.path)}
      >
        <CaretRight className="artifact-directory-caret" size={12} aria-hidden="true" />
        <FolderSimple size={18} aria-hidden="true" />
        <strong>{directory.name}</strong>
        <small>
          {directory.fileCount}
          {actions.compact ? "" : " 个文件"}
        </small>
      </button>
      <ul id={contentsId} className="artifact-directory-children" hidden={!expanded}>
        {[...directory.directories.values()]
          .sort((left, right) => nameOrder.compare(left.name, right.name))
          .map((child) => (
            <DirectoryNode key={child.path} directory={child} {...actions} />
          ))}
        {[...directory.files]
          .sort((left, right) => nameOrder.compare(left.name, right.name))
          .map(({ name, artifact }) => (
            <li key={artifact.id}>
              <button
                className="rail-item"
                type="button"
                aria-label={`预览 ${artifact.displayName}`}
                title={artifact.displayName}
                onClick={() => actions.onSelectArtifact(artifact.id)}
              >
                <FileText size={18} aria-hidden="true" />
                <span>
                  <strong>{name}</strong>
                  {actions.compact ? null : (
                    <small>
                      {artifact.format.toUpperCase()} · v{artifact.currentVersion}
                    </small>
                  )}
                </span>
                {actions.compact ? (
                  <small className="artifact-file-version">v{artifact.currentVersion}</small>
                ) : null}
              </button>
            </li>
          ))}
      </ul>
    </li>
  );
}

export function ArtifactDirectory({
  artifacts,
  ...actions
}: DirectoryActions & { artifacts: Artifact[] }): React.JSX.Element {
  const directory = useMemo(() => outputDirectory(artifacts), [artifacts]);
  return (
    <ul
      className={`artifact-directory-list ${actions.compact ? "is-compact" : ""}`}
      aria-label="输出文件目录"
    >
      <DirectoryNode directory={directory} {...actions} />
    </ul>
  );
}
