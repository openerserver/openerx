import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  type AppServiceAuthorization,
  appServiceBootstrapSchema,
  appServiceRequestFrameSchema,
  automationCommandEnvelopeSchema,
  chatCommandEnvelopeSchema,
  type ErrorEnvelope,
  remoteApplyCommandRequestFrameSchema,
  remoteConnectorConfigureFrameSchema,
  remoteConnectorDisableFrameSchema,
  remoteRevisionRequestFrameSchema,
  safeErrorMessage,
} from "@openerx/contracts";
import { FileAppService } from "@openerx/file-service";
import { projectChatEventForRemote } from "@openerx/remote-host";
import { SkillPackageService, SkillToolAdapter } from "@openerx/skills";
import {
  AutomationRepository,
  ChatRepository,
  FileRepository,
  MemoryRepository,
  RemoteRepository,
  SkillRepository,
  ToolRepository,
} from "@openerx/storage";
import type { MessagePortMain } from "electron";
import { AutomationAppService } from "./automation-app-service";
import { AutomationScheduler, ChatAutomationDispatcher } from "./automation-scheduler";
import { ChatAppService } from "./chat-app-service";
import { MainCapabilityClient } from "./main-capability-client";
import { MemoryExtractionScheduler, PiMemoryExtractor } from "./memory-extraction-scheduler";
import { MessagePortPiHostClient } from "./pi-host-client";
import { HttpAccountSyncTransport, SyncCoordinator } from "./sync-coordinator";
import { ToolAppService } from "./tool-app-service";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("App Service requires an Electron utility-process parent port");

parentPort.once("message", async (bootstrapEvent) => {
  const bootstrap = appServiceBootstrapSchema.parse(bootstrapEvent.data);
  const [mainPort, piHostPort, remotePort] = bootstrapEvent.ports as MessagePortMain[];
  if (!mainPort || !piHostPort || !remotePort) {
    throw new Error("App Service bootstrap ports are missing");
  }

  const piHost = new MessagePortPiHostClient(piHostPort, bootstrap.piHostNonce);
  const mainCapabilities = new MainCapabilityClient(mainPort);
  await piHost.ready();
  const repository = new ChatRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    {
      ownerProfileId: bootstrap.ownerProfileId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
      deviceId: bootstrap.deviceId,
    },
  );
  const fileRepository = new FileRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    { ownerProfileId: bootstrap.ownerProfileId, deviceId: bootstrap.deviceId },
  );
  const files = new FileAppService(fileRepository, bootstrap.profileDirectory);
  const toolRepository = new ToolRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    { ownerProfileId: bootstrap.ownerProfileId },
  );
  const remoteRepository = new RemoteRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
  );
  const skillRepository = new SkillRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    { ownerProfileId: bootstrap.ownerProfileId, deviceId: bootstrap.deviceId },
  );
  const skills = new SkillPackageService(skillRepository, bootstrap.profileDirectory);
  const memoryRepository = new MemoryRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    { ownerProfileId: bootstrap.ownerProfileId, deviceId: bootstrap.deviceId },
  );
  skills.seedBuiltIns();
  const workspaceDirectory = path.join(bootstrap.profileDirectory, "pi-workspace");
  mkdirSync(workspaceDirectory, { recursive: true });
  let service: ChatAppService;
  const toolService = new ToolAppService({
    repository: toolRepository,
    workspaceDirectory,
    host: mainCapabilities,
    oauth: mainCapabilities,
    resolveUploadPath: (fileId) => files.resolvePersonalFilePath(fileId),
    ingestDownload: async (downloadPath) => {
      const [file] = await files.importPaths([downloadPath]);
      if (!file) throw new Error("BROWSER_DOWNLOAD_IMPORT_FAILED");
      return { fileId: file.id, displayName: file.displayName };
    },
    writeBrokeredBashLogArtifact: ({ displayName, content }) =>
      files.createArtifact({
        displayName,
        format: "text",
        mediaType: "text/plain; charset=utf-8",
        bytesBase64: Buffer.from(content, "utf8").toString("base64"),
      }).id,
    selectedModelRef: (assistantMessageId) =>
      repository.selectedModelForMessage(assistantMessageId),
    emit: (event) => service.emitExternal(event),
    additionalAdapters: [new SkillToolAdapter(skills)],
  });
  service = new ChatAppService(
    repository,
    piHost,
    new SyncCoordinator(repository, new HttpAccountSyncTransport(), files),
    files,
    toolService,
    remoteRepository,
    skills,
    memoryRepository,
  );
  const automationRepository = new AutomationRepository(
    path.join(bootstrap.profileDirectory, "openerx-v2.sqlite"),
    { ownerProfileId: bootstrap.ownerProfileId },
  );
  const automationScheduler = new AutomationScheduler({
    repository: automationRepository,
    dispatcher: new ChatAutomationDispatcher(service, () =>
      mainCapabilities.automationExecutionContext(),
    ),
    hostId: bootstrap.deviceId,
    onRunChanged: (run) => mainPort.postMessage({ kind: "automation.run.event", run }),
  });
  const automationService = new AutomationAppService(automationRepository, () =>
    automationScheduler.tick(),
  );
  const memoryExtractionScheduler = new MemoryExtractionScheduler({
    chatRepository: repository,
    memoryRepository,
    extractor: new PiMemoryExtractor(piHost, () => mainCapabilities.automationExecutionContext()),
    onMemoriesCreated: (memories, job) =>
      mainPort.postMessage({
        kind: "memory.created.event",
        event: {
          eventId: randomUUID(),
          jobId: job.id,
          conversationId: job.conversationId,
          memories,
          createdAt: job.completedAt ?? job.updatedAt,
        },
      }),
  });
  service.onEvent((event) => mainPort.postMessage({ kind: "app-service.event", event }));
  service.onEvent((event) => void automationScheduler.handleChatEvent(event));
  service.onEvent((event) => memoryExtractionScheduler.handleChatEvent(event));
  service.onEvent((event) => {
    const projected = projectChatEventForRemote(event);
    if (!projected) return;
    remotePort.postMessage({
      kind: "remote.event.publish",
      eventKind: projected.kind,
      conversationId: projected.conversationId,
      occurredAt: projected.occurredAt,
      payload: projected.payload,
    });
  });
  service.initialize();
  automationScheduler.start();
  memoryExtractionScheduler.start();
  let remoteAuthorization: AppServiceAuthorization | null = null;

  remotePort.on("message", async (event) => {
    const revisionRequest = remoteRevisionRequestFrameSchema.safeParse(event.data);
    if (revisionRequest.success) {
      remotePort.postMessage({
        kind: "remote.revision.response",
        requestId: revisionRequest.data.requestId,
        revision: service.currentRemoteRevision(revisionRequest.data.conversationId),
      });
      return;
    }
    const applyRequest = remoteApplyCommandRequestFrameSchema.safeParse(event.data);
    if (!applyRequest.success) return;
    if (!remoteAuthorization) {
      remotePort.postMessage({
        kind: "remote.command.result",
        requestId: applyRequest.data.requestId,
        ok: false,
        errorCode: "REMOTE_AUTHORIZATION_REQUIRED",
        currentRevision: service.currentRemoteRevision(applyRequest.data.command.conversationId),
      });
      return;
    }
    try {
      const result = await service.applyRemoteCommand(
        applyRequest.data.command,
        applyRequest.data.payload,
        remoteAuthorization,
      );
      remotePort.postMessage({ ...result, requestId: applyRequest.data.requestId });
    } catch (error) {
      remotePort.postMessage({
        kind: "remote.command.result",
        requestId: applyRequest.data.requestId,
        ok: false,
        errorCode:
          error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message.split(":", 1)[0] ?? "")
            ? error.message.split(":", 1)[0]
            : "REMOTE_COMMAND_APPLY_FAILED",
        currentRevision: service.currentRemoteRevision(applyRequest.data.command.conversationId),
      });
    }
  });
  remotePort.start();

  mainPort.on("message", async (event) => {
    if (mainCapabilities.handleMessage(event.data)) return;
    const remoteConfiguration = remoteConnectorConfigureFrameSchema.safeParse(event.data);
    if (remoteConfiguration.success) {
      remoteAuthorization = remoteConfiguration.data.authorization;
      remotePort.postMessage(remoteConfiguration.data);
      return;
    }
    if (remoteConnectorDisableFrameSchema.safeParse(event.data).success) {
      remoteAuthorization = null;
      remotePort.postMessage({ kind: "remote-connector.disable" });
      return;
    }
    const request = appServiceRequestFrameSchema.safeParse(event.data);
    if (!request.success) return;
    try {
      const automationRequest = automationCommandEnvelopeSchema.safeParse(request.data.request);
      const data = automationRequest.success
        ? await automationService.handle(automationRequest.data)
        : await service.handle(
            chatCommandEnvelopeSchema.parse(request.data.request),
            request.data.authorization,
            request.data.byok,
          );
      mainPort.postMessage({
        kind: "app-service.response",
        requestId: request.data.requestId,
        ok: true,
        data,
      });
    } catch (error) {
      const envelope: ErrorEnvelope = {
        code: "APP_SERVICE_ERROR",
        message: safeErrorMessage(error, "Unknown App Service error"),
        correlationId: request.data.requestId,
        retryable: false,
      };
      mainPort.postMessage({
        kind: "app-service.response",
        requestId: request.data.requestId,
        ok: false,
        error: envelope,
      });
    }
  });
  mainPort.start();
  mainPort.postMessage({
    kind: "app-service.ready",
    contractVersion: 1,
    nonce: bootstrap.nonce,
  });
  process.once("exit", () => {
    memoryExtractionScheduler.stop();
    automationScheduler.stop();
    automationRepository.close();
    mainCapabilities.close();
    service.close();
  });
});
