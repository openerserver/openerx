import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "../../control-plane/web-ui-bff/node_modules/jose";
import { createBffApp } from "../../control-plane/web-ui-bff/src/app";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(TEST_DIR, "../../");

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "openerx-dev-secret-change-in-production",
);

async function createAuthHeader() {
  const token = await new SignJWT({
    sub: "user-1",
    org: "org-1",
    projects: [],
    role: "platform_admin",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(JWT_SECRET);

  return `Bearer ${token}`;
}

const tempFiles: string[] = [];

afterEach(() => {
  while (tempFiles.length > 0) {
    const filePath = tempFiles.pop();
    if (filePath) {
      rmSync(filePath, { force: true });
    }
  }
});

describe("workspace file routes", () => {
  it("reads repository file content", async () => {
    const app = createBffApp("test-bff");
    const response = await app.request("/api/workspace-files/content?path=package.json", {
      headers: {
        Authorization: await createAuthHeader(),
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe("package.json");
    expect(body.content).toContain('"name": "opener-x"');
  });

  it("rejects path traversal outside workspace", async () => {
    const app = createBffApp("test-bff");
    const response = await app.request("/api/workspace-files/content?path=../package.json", {
      headers: {
        Authorization: await createAuthHeader(),
      },
    });

    expect(response.status).toBe(400);
  });

  it("returns a truncated preview for large files and supports full expansion", async () => {
    const app = createBffApp("test-bff");
    const relativeDir = "tmp/test-previews";
    const relativePath = `${relativeDir}/large-preview.md`;
    const absoluteDir = join(WORKSPACE_ROOT, relativeDir);
    const absolutePath = join(WORKSPACE_ROOT, relativePath);
    mkdirSync(absoluteDir, { recursive: true });
    writeFileSync(absolutePath, `# Large Preview\n\n${"a".repeat(80 * 1024)}`);
    tempFiles.push(absolutePath);

    const previewResponse = await app.request(
      `/api/workspace-files/content?path=${encodeURIComponent(relativePath)}`,
      {
        headers: {
          Authorization: await createAuthHeader(),
        },
      },
    );

    expect(previewResponse.status).toBe(200);
    const previewBody = await previewResponse.json();
    expect(previewBody.truncated).toBe(true);
    expect(previewBody.canExpand).toBe(true);
    expect(previewBody.previewBytes).toBeLessThan(previewBody.size);

    const fullResponse = await app.request(
      `/api/workspace-files/content?path=${encodeURIComponent(relativePath)}&full=true`,
      {
        headers: {
          Authorization: await createAuthHeader(),
        },
      },
    );

    expect(fullResponse.status).toBe(200);
    const fullBody = await fullResponse.json();
    expect(fullBody.truncated).toBe(false);
    expect(fullBody.content.length).toBeGreaterThan(previewBody.content.length);
  });
});