---
name: testing
description: Testing guide using Vitest. Use when writing tests (.test.ts, .test.tsx), fixing failing tests, improving test coverage, or debugging test issues. Triggers on test creation, test debugging, mock setup, or test-related questions.
---

# LobeChat Testing Guide

## Quick Reference

**Commands:**
```bash
# Run specific test file
bunx vitest run --silent='passed-only' '[file-path]'

# Database package (client)
cd packages/database && bunx vitest run --silent='passed-only' '[file]'

# Database package (server)
cd packages/database && TEST_SERVER_DB=1 bunx vitest run --silent='passed-only' '[file]'
```

**Never run** `bun run test` - it runs all 3000+ tests (~10 minutes).

## Test Categories

| Category | Location | Config |
|----------|----------|--------|
| Webapp | `src/**/*.test.ts(x)` | `vitest.config.ts` |
| Packages | `packages/*/**/*.test.ts` | `packages/*/vitest.config.ts` |
| Desktop | `apps/desktop/**/*.test.ts` | `apps/desktop/vitest.config.ts` |

## Core Principles

1. **Prefer `vi.spyOn` over `vi.mock`** - More targeted, easier to maintain
2. **Tests must pass type check** - Run `bun run type-check` after writing tests
3. **After 1-2 failed fix attempts, stop and ask for help**
4. **Test behavior, not implementation details**

## Basic Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModuleName', () => {
  describe('functionName', () => {
    it('should handle normal case', () => {
      // Arrange → Act → Assert
    });
  });
});
```

## Mock Patterns

```typescript
// ✅ Spy on direct dependencies
vi.spyOn(messageService, 'createMessage').mockResolvedValue('id');

// ✅ Use vi.stubGlobal for browser APIs
vi.stubGlobal('Image', mockImage);
vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');

// ❌ Avoid mocking entire modules globally
vi.mock('@/services/chat'); // Too broad
```

## Detailed Guides

See `references/` for specific testing scenarios:
- **Database Model testing**: `references/db-model-test.md`
- **Electron IPC testing**: `references/electron-ipc-test.md`
- **Zustand Store Action testing**: `references/zustand-store-action-test.md`
- **Agent Runtime E2E testing**: `references/agent-runtime-e2e.md`
- **Desktop Controller testing**: `references/desktop-controller-test.md`

## Common Issues

1. **Module pollution**: Use `vi.resetModules()` when tests fail mysteriously
2. **Mock not working**: Check setup position and use `vi.clearAllMocks()` in beforeEach
3. **Test data pollution**: Clean database state in beforeEach/afterEach
4. **Async issues**: Wrap state changes in `act()` for React hooks


---

## Referenced Files

> The following files are referenced in this skill and included for context.

### references/db-model-test.md

```markdown
# Database Model Testing Guide

Test `packages/database` Model layer.

## Dual Environment Verification (Required)

```bash
# 1. Client environment (fast)
cd packages/database && TEST_SERVER_DB=0 bunx vitest run --silent='passed-only' '[file]'

# 2. Server environment (compatibility)
cd packages/database && TEST_SERVER_DB=1 bunx vitest run --silent='passed-only' '[file]'
```

## User Permission Check - Security First 🔒

**Critical security requirement**: All user data operations must include permission checks.

```typescript
// ❌ DANGEROUS: Missing permission check
update = async (id: string, data: Partial<MyModel>) => {
  return this.db.update(myTable).set(data)
    .where(eq(myTable.id, id))  // Only checks ID
    .returning();
};

// ✅ SECURE: Permission check included
update = async (id: string, data: Partial<MyModel>) => {
  return this.db.update(myTable).set(data)
    .where(and(
      eq(myTable.id, id),
      eq(myTable.userId, this.userId)  // ✅ Permission check
    ))
    .returning();
};
```

## Test File Structure

```typescript
// @vitest-environment node
describe('MyModel', () => {
  describe('create', () => { /* ... */ });
  describe('queryAll', () => { /* ... */ });
  describe('update', () => {
    it('should update own records');
    it('should NOT update other users records');  // 🔒 Security
  });
  describe('delete', () => {
    it('should delete own records');
    it('should NOT delete other users records');  // 🔒 Security
  });
  describe('user isolation', () => {
    it('should enforce user data isolation');  // 🔒 Core security
  });
});
```

## Security Test Example

```typescript
it('should not update records of other users', async () => {
  const [otherUserRecord] = await serverDB
    .insert(myTable)
    .values({ userId: 'other-user', data: 'original' })
    .returning();

  const result = await myModel.update(otherUserRecord.id, { data: 'hacked' });

  expect(result).toBeUndefined();
  const unchanged = await serverDB.query.myTable.findFirst({
    where: eq(myTable.id, otherUserRecord.id),
  });
  expect(unchanged?.data).toBe('original');
});
```

## Data Management

```typescript
const userId = 'test-user';
const otherUserId = 'other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});
```

## Foreign Key Handling

```typescript
// ❌ Wrong: Invalid foreign key
const testData = { asyncTaskId: 'invalid-uuid', fileId: 'non-existent' };

// ✅ Correct: Use null
const testData = { asyncTaskId: null, fileId: null };

// ✅ Or: Create referenced record first
beforeEach(async () => {
  const [asyncTask] = await serverDB.insert(asyncTasks)
    .values({ id: 'valid-id', status: 'pending' }).returning();
  testData.asyncTaskId = asyncTask.id;
});
```

## Predictable Sorting

```typescript
// ✅ Use explicit timestamps
const oldDate = new Date('2024-01-01T10:00:00Z');
const newDate = new Date('2024-01-02T10:00:00Z');
await serverDB.insert(table).values([
  { ...data1, createdAt: oldDate },
  { ...data2, createdAt: newDate },
]);

// ❌ Don't rely on insert order
await serverDB.insert(table).values([data1, data2]);  // Unpredictable
```

```

### references/electron-ipc-test.md

```markdown
# Electron IPC Testing Strategy

For Electron IPC tests, use **Mock return values** instead of real Electron environment.

## Basic Mock Setup

```typescript
import { vi } from 'vitest';
import { electronIpcClient } from '@/server/modules/ElectronIPCClient';

vi.mock('@/server/modules/ElectronIPCClient', () => ({
  electronIpcClient: {
    getFilePathById: vi.fn(),
    deleteFiles: vi.fn(),
  },
}));
```

## Setting Mock Behavior

```typescript
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(electronIpcClient.getFilePathById).mockResolvedValue('/path/to/file.txt');
  vi.mocked(electronIpcClient.deleteFiles).mockResolvedValue({ success: true });
});
```

## Testing Different Scenarios

```typescript
it('should handle successful file deletion', async () => {
  vi.mocked(electronIpcClient.deleteFiles).mockResolvedValue({ success: true });

  const result = await service.deleteFiles(['desktop://file1.txt']);

  expect(electronIpcClient.deleteFiles).toHaveBeenCalledWith(['desktop://file1.txt']);
  expect(result.success).toBe(true);
});

it('should handle file deletion failure', async () => {
  vi.mocked(electronIpcClient.deleteFiles).mockRejectedValue(new Error('Delete failed'));

  const result = await service.deleteFiles(['desktop://file1.txt']);

  expect(result.success).toBe(false);
  expect(result.errors).toBeDefined();
});
```

## Advantages

1. **Environment simplification**: No complex Electron setup
2. **Controlled testing**: Precise control over IPC return values
3. **Scenario coverage**: Easy to test success/failure cases
4. **Speed**: Mock calls are faster than real IPC

## Notes

- Ensure mock behavior matches real IPC interface
- Use `vi.mocked()` for type safety
- Reset mocks in `beforeEach` to avoid test interference
- Verify both return values and that IPC methods were called correctly

```

### references/zustand-store-action-test.md

```markdown
# Zustand Store Action Testing Guide

## Basic Structure

```typescript
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../store';

vi.mock('zustand/traditional');

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    activeId: 'test-session-id',
    messagesMap: {},
    loadingIds: [],
  }, false);

  vi.spyOn(messageService, 'createMessage').mockResolvedValue('new-message-id');

  act(() => {
    useChatStore.setState({
      refreshMessages: vi.fn(),
      internal_coreProcessMessage: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

## Key Principles

### 1. Spy Direct Dependencies Only

```typescript
// ✅ Good: Spy on direct dependency
const fetchAIChatSpy = vi.spyOn(result.current, 'internal_fetchAIChatMessage')
  .mockResolvedValue({ isFunctionCall: false, content: 'AI response' });

// ❌ Bad: Spy on lower-level implementation
const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream')
  .mockImplementation(...);
```

### 2. Minimize Global Spies

```typescript
// ✅ Spy only when needed
it('should process message', async () => {
  const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream')
    .mockImplementation(...);
  // test logic
  streamSpy.mockRestore();
});

// ❌ Don't setup all spies globally
beforeEach(() => {
  vi.spyOn(chatService, 'createAssistantMessageStream').mockResolvedValue({});
  vi.spyOn(fileService, 'uploadFile').mockResolvedValue({});
});
```

### 3. Use act() for Async Operations

```typescript
it('should send message', async () => {
  const { result } = renderHook(() => useChatStore());

  await act(async () => {
    await result.current.sendMessage({ message: 'Hello' });
  });

  expect(messageService.createMessage).toHaveBeenCalled();
});
```

### 4. Test Organization

```typescript
describe('sendMessage', () => {
  describe('validation', () => {
    it('should not send when session is inactive');
    it('should not send when message is empty');
  });
  describe('message creation', () => {
    it('should create user message and trigger AI processing');
  });
  describe('error handling', () => {
    it('should handle message creation errors gracefully');
  });
});
```

## Streaming Response Mock

```typescript
it('should handle streaming chunks', async () => {
  const { result } = renderHook(() => useChatStore());

  const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream')
    .mockImplementation(async ({ onMessageHandle, onFinish }) => {
      await onMessageHandle?.({ type: 'text', text: 'Hello' } as any);
      await onMessageHandle?.({ type: 'text', text: ' World' } as any);
      await onFinish?.('Hello World', {});
    });

  await act(async () => {
    await result.current.internal_fetchAIChatMessage({...});
  });

  streamSpy.mockRestore();
});
```

## SWR Hook Testing

```typescript
it('should fetch data', async () => {
  const mockData = [{ id: '1', name: 'Item 1' }];
  vi.spyOn(discoverService, 'getPluginCategories').mockResolvedValue(mockData);

  const { result } = renderHook(() => useStore.getState().usePluginCategories(params));

  await waitFor(() => {
    expect(result.current.data).toEqual(mockData);
  });
});
```

**Key points for SWR:**
- DO NOT mock useSWR - let it use real implementation
- Only mock service methods (fetchers)
- Use `waitFor` for async operations

## Anti-Patterns

```typescript
// ❌ Don't mock entire store
vi.mock('../../store', () => ({ useChatStore: vi.fn(() => ({...})) }));

// ❌ Don't test internal state structure
expect(result.current.messagesMap).toHaveProperty('test-session');

// ✅ Test behavior instead
expect(result.current.refreshMessages).toHaveBeenCalled();
```

```

### references/agent-runtime-e2e.md

```markdown
# Agent Runtime E2E Testing Guide

## Core Principles

### Minimal Mock Principle

Only mock **three external dependencies**:

| Dependency | Mock | Description |
|------------|------|-------------|
| Database | PGLite | In-memory database from `@lobechat/database/test-utils` |
| Redis | InMemoryAgentStateManager | Memory implementation |
| Redis | InMemoryStreamEventManager | Memory implementation |

**NOT mocked:**
- `model-bank` - Uses real model config
- `Mecha` (AgentToolsEngine, ContextEngineering)
- `AgentRuntimeService`
- `AgentRuntimeCoordinator`

### Use vi.spyOn, not vi.mock

Different tests need different LLM responses. `vi.spyOn` provides:
- Flexible return values per test
- Easy testing of different scenarios
- Better test isolation

### Default Model: gpt-5

- Always available in `model-bank`
- Stable across model updates

## Technical Implementation

### Database Setup

```typescript
import { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';

let testDB: LobeChatDatabase;

beforeEach(async () => {
  testDB = await getTestDB();
});
```

### OpenAI Stream Response Helper

```typescript
export const createOpenAIStreamResponse = (options: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: 'stop' | 'tool_calls';
}) => {
  const { content, toolCalls, finishReason = 'stop' } = options;

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        if (content) {
          const chunk = {
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            model: 'gpt-5',
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }

        // ... tool_calls handling
        // ... finish chunk
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
};
```

### State Management

```typescript
import { InMemoryAgentStateManager, InMemoryStreamEventManager } from '@/server/modules/AgentRuntime';

const stateManager = new InMemoryAgentStateManager();
const streamEventManager = new InMemoryStreamEventManager();

const service = new AgentRuntimeService(serverDB, userId, {
  coordinatorOptions: { stateManager, streamEventManager },
  queueService: null,
  streamEventManager,
});
```

### Mock OpenAI API

```typescript
const fetchSpy = vi.spyOn(globalThis, 'fetch');

it('should handle text response', async () => {
  fetchSpy.mockResolvedValueOnce(createOpenAIStreamResponse({ content: 'Response text' }));
  // ... execute test
});

it('should handle tool calls', async () => {
  fetchSpy.mockResolvedValueOnce(createOpenAIStreamResponse({
    toolCalls: [{
      id: 'call_123',
      name: 'lobe-web-browsing____search____builtin',
      arguments: JSON.stringify({ query: 'weather' }),
    }],
    finishReason: 'tool_calls',
  }));
  // ... execute test
});
```

## Notes

1. **Test isolation**: Clean `InMemoryAgentStateManager` and `InMemoryStreamEventManager` after each test
2. **Timeout**: E2E tests may need longer timeouts
3. **Debug**: Use `DEBUG=lobe-server:*` for detailed logs

```

### references/desktop-controller-test.md

```markdown
# Desktop Controller Unit Testing Guide

## Testing Framework & Directory Structure

LobeChat Desktop uses Vitest as the test framework. Controller unit tests should be placed in the `__tests__` directory adjacent to the controller file, named with the original controller filename plus `.test.ts`.

```plaintext
apps/desktop/src/main/controllers/
├── __tests__/
│   ├── index.test.ts
│   ├── MenuCtr.test.ts
│   └── ...
├── McpCtr.ts
├── MenuCtr.ts
└── ...
```

## Basic Test File Structure

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import YourController from '../YourControllerName';

// Mock dependencies
vi.mock('dependency-module', () => ({
  dependencyFunction: vi.fn(),
}));

// Mock App instance
const mockApp = {
  // Mock necessary App properties and methods as needed
} as unknown as App;

describe('YourController', () => {
  let controller: YourController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new YourController(mockApp);
  });

  describe('methodName', () => {
    it('test scenario description', async () => {
      // Prepare test data

      // Execute method under test
      const result = await controller.methodName(params);

      // Verify results
      expect(result).toMatchObject(expectedResult);
    });
  });
});
```

## Mocking External Dependencies

### Module Functions

```typescript
const mockFunction = vi.fn();

vi.mock('module-name', () => ({
  functionName: mockFunction,
}));
```

### Node.js Core Modules

Example: mocking `child_process.exec` and `util.promisify`:

```typescript
const mockExecImpl = vi.fn();

vi.mock('child_process', () => ({
  exec: vi.fn((cmd, callback) => {
    return mockExecImpl(cmd, callback);
  }),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => {
    return async (cmd: string) => {
      return new Promise((resolve, reject) => {
        mockExecImpl(cmd, (error: Error | null, result: any) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    };
  }),
}));
```

## Best Practices

1. **Isolate tests**: Use `beforeEach` to reset mocks and state
2. **Comprehensive coverage**: Test normal flows, edge cases, and error handling
3. **Clear naming**: Test names should describe content and expected results
4. **Avoid implementation details**: Test behavior, not implementation
5. **Mock external dependencies**: Use `vi.mock()` for all external dependencies

## Example: Testing IPC Event Handler

```typescript
it('should handle IPC event correctly', async () => {
  mockSomething.mockReturnValue({ result: 'success' });

  const result = await controller.ipcMethodName({
    param1: 'value1',
    param2: 'value2',
  });

  expect(result).toEqual({
    success: true,
    data: { result: 'success' },
  });

  expect(mockSomething).toHaveBeenCalledWith('value1', 'value2');
});
```

```

