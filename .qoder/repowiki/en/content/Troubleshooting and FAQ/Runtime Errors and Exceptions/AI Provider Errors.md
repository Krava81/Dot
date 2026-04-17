# AI Provider Errors

<cite>
**Referenced Files in This Document**
- [server.ts](file://server.ts)
- [useAiKeys.ts](file://src/hooks/useAiKeys.ts)
- [standaloneService.ts](file://src/services/standaloneService.ts)
- [storageWrapper.ts](file://src/services/storageWrapper.ts)
- [SettingsModal.tsx](file://src/components/SettingsModal.tsx)
- [App.tsx](file://src/App.tsx)
- [serverUtils.ts](file://src/serverUtils.ts)
- [types.ts](file://src/types.ts)
- [package.json](file://package.json)
- [environment.toml](file://.codex/environments/environment.toml)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document provides comprehensive troubleshooting guidance for AI provider connectivity and operational errors across Gemini, GitHub, OpenRouter, and DeepSeek. It covers authentication failures (invalid/expired keys, permissions), rate limiting (429 responses, quota exhaustion), model availability issues (unsupported/deprecated models, fallback failures), provider-specific error codes, diagnostic curl commands, log analysis techniques, and step-by-step resolution procedures. It also includes configuration validation steps and testing procedures to verify AI provider connectivity.

## Project Structure
The project consists of:
- A Node.js/Express server that orchestrates AI processing and exposes endpoints for configuration, testing, and logging.
- A React client (Capacitor-based) that can operate in two modes:
  - Standalone mode: Uses a local AI service to call Gemini directly.
  - Server mode: Sends requests to the Express server for AI processing.
- Utilities for persistent storage, logging, and settings management.

```mermaid
graph TB
subgraph "Client (React)"
A_App["App.tsx"]
A_Settings["SettingsModal.tsx"]
A_Keys["useAiKeys.ts"]
A_Storage["storageWrapper.ts"]
end
subgraph "Server (Express)"
S_Server["server.ts"]
S_Logger["serverUtils.ts"]
end
subgraph "Services"
C_Standalone["standaloneService.ts"]
end
A_App --> A_Settings
A_App --> A_Keys
A_App --> A_Storage
A_App --> S_Server
A_App --> C_Standalone
S_Server --> S_Logger
```

**Diagram sources**
- [server.ts:1-1454](file://server.ts#L1-L1454)
- [App.tsx:168-1754](file://src/App.tsx#L168-L1754)
- [SettingsModal.tsx:1-107](file://src/components/SettingsModal.tsx#L1-L107)
- [useAiKeys.ts:1-57](file://src/hooks/useAiKeys.ts#L1-L57)
- [storageWrapper.ts:1-100](file://src/services/storageWrapper.ts#L1-L100)
- [standaloneService.ts:1-175](file://src/services/standaloneService.ts#L1-L175)
- [serverUtils.ts:1-23](file://src/serverUtils.ts#L1-L23)

**Section sources**
- [server.ts:1-1454](file://server.ts#L1-L1454)
- [App.tsx:168-1754](file://src/App.tsx#L168-L1754)
- [SettingsModal.tsx:1-107](file://src/components/SettingsModal.tsx#L1-L107)
- [useAiKeys.ts:1-57](file://src/hooks/useAiKeys.ts#L1-L57)
- [storageWrapper.ts:1-100](file://src/services/storageWrapper.ts#L1-L100)
- [standaloneService.ts:1-175](file://src/services/standaloneService.ts#L1-L175)
- [serverUtils.ts:1-23](file://src/serverUtils.ts#L1-L23)

## Core Components
- AI orchestration and provider selection with fallback:
  - Iterates through providers in order, attempting each until successful or retries exhausted.
  - Implements provider-specific retry logic and quota detection.
- Authentication and key management:
  - Loads keys from persistent storage or environment variables.
  - Supports per-provider keys and a preferred provider setting.
- Logging and diagnostics:
  - File logger and server-side SSE logs for real-time visibility.
- Client-side connectivity:
  - Standalone vs server mode switching.
  - Validation of base URL and network reachability.

**Section sources**
- [server.ts:412-645](file://server.ts#L412-L645)
- [server.ts:1038-1064](file://server.ts#L1038-L1064)
- [server.ts:342-352](file://server.ts#L342-L352)
- [serverUtils.ts:7-22](file://src/serverUtils.ts#L7-L22)
- [useAiKeys.ts:4-56](file://src/hooks/useAiKeys.ts#L4-L56)
- [App.tsx:811-864](file://src/App.tsx#L811-L864)

## Architecture Overview
The system routes AI requests through either a local service (Gemini) or the server endpoint, depending on mode. The server applies rate limits, selects a provider, and performs retries with exponential backoff for transient errors.

```mermaid
sequenceDiagram
participant Client as "Client App"
participant App as "App.tsx"
participant Keys as "useAiKeys.ts"
participant Server as "server.ts"
participant Gemini as "Gemini API"
participant GitHub as "GitHub API"
participant OpenRouter as "OpenRouter API"
participant DeepSeek as "DeepSeek API"
Client->>App : "User triggers AI processing"
App->>Keys : "Load provider keys"
alt Standalone mode
App->>Server : "Skip (use local service)"
App->>Gemini : "Call Gemini directly"
else Server mode
App->>Server : "POST /api/process-text"
Server->>Server : "Select provider and iterate attempts"
opt Gemini
Server->>Gemini : "Generate content"
Gemini-->>Server : "Response or error"
end
opt GitHub
Server->>GitHub : "Chat completions"
GitHub-->>Server : "Response or error"
end
opt OpenRouter
Server->>OpenRouter : "Chat completions"
OpenRouter-->>Server : "Response or error"
end
opt DeepSeek
Server->>DeepSeek : "Chat completions"
DeepSeek-->>Server : "Response or error"
end
end
Server-->>App : "Processed text or error"
App-->>Client : "Display result or error"
```

**Diagram sources**
- [server.ts:412-645](file://server.ts#L412-L645)
- [server.ts:1328-1339](file://server.ts#L1328-L1339)
- [App.tsx:811-864](file://src/App.tsx#L811-L864)
- [useAiKeys.ts:4-56](file://src/hooks/useAiKeys.ts#L4-L56)

## Detailed Component Analysis

### AI Provider Orchestration and Fallback
- Provider order:
  - Attempts the preferred provider first, then falls back across Gemini, GitHub, OpenRouter, DeepSeek.
- Retry and backoff:
  - GitHub, OpenRouter: retry on 429/503 with incremental delay.
  - Gemini: detects quota exhaustion (429/quota exhaustion) and disables provider temporarily.
- Model fallback (Gemini):
  - Iterates through supported models and continues on “not found” errors.
- Error aggregation:
  - Collects reasons for each provider failure to present a consolidated error message.

```mermaid
flowchart TD
Start(["Start AI Processing"]) --> LoadKeys["Load keys and preferred provider"]
LoadKeys --> IterateProviders["Iterate providers in order"]
IterateProviders --> TryProvider{"Try provider"}
TryProvider --> |GitHub| GH["POST /chat/completions<br/>Retry 429/503"]
TryProvider --> |Gemini| GM["Iterate models<br/>Fallback on 404/not found<br/>Disable on quota"]
TryProvider --> |OpenRouter| OR["POST /chat/completions<br/>Retry 429/503"]
TryProvider --> |DeepSeek| DS["POST /chat/completions"]
GH --> Success{"Success?"}
GM --> Success
OR --> Success
DS --> Success
Success --> |Yes| Return["Return processed text"]
Success --> |No| Next{"More providers?"}
Next --> |Yes| IterateProviders
Next --> |No| Aggregate["Aggregate last errors"]
Aggregate --> ReturnError["Return combined error"]
```

**Diagram sources**
- [server.ts:412-645](file://server.ts#L412-L645)
- [server.ts:508-536](file://server.ts#L508-L536)
- [server.ts:456-499](file://server.ts#L456-L499)
- [server.ts:570-589](file://server.ts#L570-L589)
- [server.ts:598-626](file://server.ts#L598-L626)

**Section sources**
- [server.ts:412-645](file://server.ts#L412-L645)
- [server.ts:508-536](file://server.ts#L508-L536)
- [server.ts:456-499](file://server.ts#L456-L499)
- [server.ts:570-589](file://server.ts#L570-L589)
- [server.ts:598-626](file://server.ts#L598-L626)

### Authentication and Key Management
- Key loading:
  - Standalone: reads from Capacitor preferences/local storage.
  - Server mode: reads from browser local storage or persists via server endpoints.
- Key persistence:
  - Server endpoints support saving keys per provider and setting preferred provider.
- Client-side key updates:
  - Updates in-memory state and persists to appropriate storage.

```mermaid
sequenceDiagram
participant UI as "SettingsModal.tsx"
participant App as "App.tsx"
participant Keys as "useAiKeys.ts"
participant Storage as "storageWrapper.ts"
participant Server as "server.ts"
UI->>App : "User saves keys"
App->>Keys : "updateAiKey(provider, key)"
alt Standalone
Keys->>Storage : "setSetting(api_key_provider)"
else Server mode
Keys->>Server : "POST /api/config/api-key"
Server-->>Keys : "200 OK"
end
App->>Keys : "loadAiKeys()"
Keys->>Storage : "getSetting(api_key_provider)"
Storage-->>Keys : "Value or null"
Keys-->>App : "aiKeys"
```

**Diagram sources**
- [SettingsModal.tsx:1-107](file://src/components/SettingsModal.tsx#L1-L107)
- [App.tsx:811-864](file://src/App.tsx#L811-L864)
- [useAiKeys.ts:37-56](file://src/hooks/useAiKeys.ts#L37-L56)
- [storageWrapper.ts:9-99](file://src/services/storageWrapper.ts#L9-L99)
- [server.ts:1038-1048](file://server.ts#L1038-L1048)

**Section sources**
- [useAiKeys.ts:4-56](file://src/hooks/useAiKeys.ts#L4-L56)
- [storageWrapper.ts:9-99](file://src/services/storageWrapper.ts#L9-L99)
- [server.ts:1038-1048](file://server.ts#L1038-L1048)
- [SettingsModal.tsx:1-107](file://src/components/SettingsModal.tsx#L1-L107)

### Logging and Diagnostics
- Server-side file logging:
  - Writes structured log entries with timestamps and levels.
- Real-time logs via SSE:
  - Client subscribes to /api/logs/stream for live updates.
- Client-side log display:
  - Collapsible panel with color-coded entries.

```mermaid
sequenceDiagram
participant Server as "server.ts"
participant Logger as "serverUtils.ts"
participant SSE as "SSE Endpoint"
participant Client as "App.tsx"
Server->>Logger : "log(ERROR/WARN/INFO, message)"
Logger-->>Server : "Append to app.log"
Server->>SSE : "Broadcast log lines"
Client->>SSE : "Subscribe to /api/logs/stream"
SSE-->>Client : "Push log events"
```

**Diagram sources**
- [server.ts:19-22](file://server.ts#L19-L22)
- [server.ts:342-352](file://server.ts#L342-L352)
- [serverUtils.ts:7-22](file://src/serverUtils.ts#L7-L22)
- [App.tsx:652-675](file://src/App.tsx#L652-L675)

**Section sources**
- [server.ts:19-22](file://server.ts#L19-L22)
- [server.ts:342-352](file://server.ts#L342-L352)
- [serverUtils.ts:7-22](file://src/serverUtils.ts#L7-L22)
- [App.tsx:652-675](file://src/App.tsx#L652-L675)

### Standalone vs Server Mode
- Standalone mode:
  - Calls Gemini directly using a local service.
  - Requires a valid Gemini API key.
- Server mode:
  - Routes requests to server endpoints (/api/process-text, /api/test-ai).
  - Validates base URL and handles CORS/network restrictions.

```mermaid
flowchart TD
Mode{"Mode?"}
Mode --> |Standalone| Local["aiService.processWithAI()<br/>Gemini SDK"]
Mode --> |Server| Remote["universalFetch()<br/>POST /api/process-text"]
Local --> Done["Render result"]
Remote --> Done
```

**Diagram sources**
- [standaloneService.ts:148-159](file://src/services/standaloneService.ts#L148-L159)
- [App.tsx:811-838](file://src/App.tsx#L811-L838)

**Section sources**
- [standaloneService.ts:148-159](file://src/services/standaloneService.ts#L148-L159)
- [App.tsx:811-838](file://src/App.tsx#L811-L838)

## Dependency Analysis
- External libraries:
  - @google/generative-ai, axios, express, telegraf, cheerio, dotenv, uuid, marked, cors, express-rate-limit.
- Internal modules:
  - AI orchestration, logging, storage wrappers, settings hooks, UI components.

```mermaid
graph LR
A["@google/generative-ai"] --> S["server.ts"]
B["axios"] --> S
C["express"] --> S
D["telegraf"] --> S
E["cheerio"] --> S
F["dotenv"] --> S
G["uuid"] --> S
H["marked"] --> S
I["cors"] --> S
J["express-rate-limit"] --> S
K["storageWrapper.ts"] --> S
L["serverUtils.ts"] --> S
M["useAiKeys.ts"] --> N["App.tsx"]
O["SettingsModal.tsx"] --> N
P["standaloneService.ts"] --> N
```

**Diagram sources**
- [package.json:19-56](file://package.json#L19-L56)
- [server.ts:1-17](file://server.ts#L1-L17)
- [storageWrapper.ts:1-100](file://src/services/storageWrapper.ts#L1-L100)
- [serverUtils.ts:1-23](file://src/serverUtils.ts#L1-L23)
- [useAiKeys.ts:1-57](file://src/hooks/useAiKeys.ts#L1-L57)
- [SettingsModal.tsx:1-107](file://src/components/SettingsModal.tsx#L1-L107)
- [standaloneService.ts:1-175](file://src/services/standaloneService.ts#L1-L175)

**Section sources**
- [package.json:19-56](file://package.json#L19-L56)
- [server.ts:1-17](file://server.ts#L1-L17)

## Performance Considerations
- Rate limiting:
  - Global API limiter and dedicated AI limiter reduce overload risk.
- Retries with backoff:
  - Exponential delays mitigate transient provider issues.
- Timeout configuration:
  - Provider calls include timeouts to prevent hanging requests.
- Model fallback:
  - Reduces downtime by switching among supported models.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide

### General Diagnostic Steps
- Verify mode:
  - Confirm whether operating in Standalone or Server mode.
- Check keys:
  - Ensure keys are saved and loaded correctly for the active provider.
- Inspect logs:
  - Use SSE logs (/api/logs/stream) or file logs for error details.
- Test connectivity:
  - Use the built-in “Test internet” and “Check connection” actions.

**Section sources**
- [App.tsx:811-864](file://src/App.tsx#L811-L864)
- [server.ts:342-352](file://server.ts#L342-L352)
- [serverUtils.ts:7-22](file://src/serverUtils.ts#L7-L22)
- [SettingsModal.tsx:88-96](file://src/components/SettingsModal.tsx#L88-L96)

### Authentication Failures

#### Gemini
Symptoms:
- “AI returned error” messages indicating key issues.
- Server logs show authentication or quota-related errors.

Resolution steps:
1. Validate key presence:
   - Confirm the stored Gemini key is present and not empty.
2. Test key validity:
   - Use the server’s test endpoint to validate the key against a model.
3. Check quotas:
   - If quota exceeded, wait for the suggested retry period or switch provider.
4. Verify model:
   - Ensure the configured model is supported; the server iterates fallback models automatically.

Diagnostic commands:
- Test key/model:
  - POST to /api/test-ai with provider=gemini and a test apiKey.

**Section sources**
- [server.ts:1328-1339](file://server.ts#L1328-L1339)
- [server.ts:508-536](file://server.ts#L508-L536)
- [App.tsx:844-847](file://src/App.tsx#L844-L847)

#### GitHub (Azure AI)
Symptoms:
- 401/403 errors indicating invalid/expired token or insufficient permissions.
- Provider disabled after repeated failures.

Resolution steps:
1. Verify token:
   - Ensure the GitHub token is set and has required scopes.
2. Retry logic:
   - The server retries on 429/503 with backoff; monitor logs for transient errors.
3. Switch provider:
   - If quota exhausted, temporarily disable GitHub or choose another provider.

Diagnostic commands:
- curl with Authorization header to the GitHub endpoint.

**Section sources**
- [server.ts:456-499](file://server.ts#L456-L499)

#### OpenRouter
Symptoms:
- 429/503 responses during high load.
- Provider disabled after retries.

Resolution steps:
1. Retry with backoff:
   - The server retries on 429/503; monitor logs for transient conditions.
2. Adjust rate:
   - Reduce concurrent requests or wait for cooldown.
3. Switch provider:
   - Temporarily disable OpenRouter if quota is exceeded.

Diagnostic commands:
- curl to the OpenRouter endpoint with Authorization header.

**Section sources**
- [server.ts:570-589](file://server.ts#L570-L589)

#### DeepSeek
Symptoms:
- Provider errors reported in logs; check for malformed responses.

Resolution steps:
1. Validate token:
   - Ensure the DeepSeek API key is set.
2. Inspect response:
   - Review logs for error details and adjust payload if needed.

Diagnostic commands:
- curl to the DeepSeek endpoint with Authorization header.

**Section sources**
- [server.ts:598-626](file://server.ts#L598-L626)

### Rate Limiting and Quota Exhaustion

Common indicators:
- 429 Too Many Requests.
- Quota exhaustion messages including resource exhaustion or retry hints.

Resolution steps:
- Wait for cooldown:
  - Respect provider-specified retry windows.
- Reduce concurrency:
  - Apply backoff or throttle requests.
- Switch provider:
  - The server disables providers experiencing quota issues and moves to next.

Diagnostic commands:
- Use /api/test-ai to validate provider limits under controlled load.

**Section sources**
- [server.ts:548-559](file://server.ts#L548-L559)
- [server.ts:584-587](file://server.ts#L584-L587)
- [server.ts:1315-1319](file://server.ts#L1315-L1319)

### Model Availability Issues

Symptoms:
- “not found” or 404 responses for specific models.
- Fallback chain continues through supported models.

Resolution steps:
- Confirm model support:
  - The server maintains a list of supported Gemini models and iterates them.
- Update configuration:
  - Change preferred provider or model if necessary.

Diagnostic commands:
- Use /api/test-ai to validate model availability.

**Section sources**
- [server.ts:355-363](file://server.ts#L355-L363)
- [server.ts:529-534](file://server.ts#L529-L534)
- [server.ts:1307-1322](file://server.ts#L1307-L1322)

### Provider-Specific Error Codes and Messages
- Gemini:
  - 404 “not found” indicates unsupported model; fallback continues.
  - 429/“quota”/“RESOURCE_EXHAUSTED” disables provider temporarily.
- GitHub:
  - 401/403 indicate invalid/expired token or permissions.
  - 429/503 trigger retries with backoff.
- OpenRouter:
  - 429/503 trigger retries with backoff.
- DeepSeek:
  - Provider-level errors logged; inspect response details.

**Section sources**
- [server.ts:529-534](file://server.ts#L529-L534)
- [server.ts:548-559](file://server.ts#L548-L559)
- [server.ts:484-487](file://server.ts#L484-L487)
- [server.ts:584-587](file://server.ts#L584-L587)
- [server.ts:621-625](file://server.ts#L621-L625)

### Diagnostic Commands Using curl
Replace placeholders with your actual values:
- Test Gemini:
  - POST https://api.gemini.example/v1/models/{model}:generateContent with Authorization header.
- Test GitHub:
  - POST https://models.inference.ai.azure.com/chat/completions with Authorization: Bearer YOUR_GITHUB_TOKEN.
- Test OpenRouter:
  - POST https://openrouter.ai/api/v1/chat/completions with Authorization: Bearer YOUR_OPENROUTER_KEY.
- Test DeepSeek:
  - POST https://api.deepseek.com/chat/completions with Authorization: Bearer YOUR_DEEPSEEK_KEY.

Notes:
- Ensure Content-Type: application/json.
- Include a minimal prompt payload.

**Section sources**
- [server.ts:458-473](file://server.ts#L458-L473)
- [server.ts:572-576](file://server.ts#L572-L576)
- [server.ts:599-615](file://server.ts#L599-L615)

### Log Analysis Techniques
- Locate logs:
  - Server writes to app.log; SSE endpoint streams logs to the UI.
- Interpret severity:
  - ❌ errors, ⚠️ warnings, ✅ successes.
- Identify root cause:
  - Look for provider-specific error messages, 429/quota mentions, or model-not-found patterns.

**Section sources**
- [server.ts:19-22](file://server.ts#L19-L22)
- [server.ts:342-352](file://server.ts#L342-L352)
- [serverUtils.ts:7-22](file://src/serverUtils.ts#L7-L22)
- [App.tsx:1584-1596](file://src/App.tsx#L1584-L1596)

### Step-by-Step Resolution Guides

#### Gemini Authentication Failure
1. Confirm key presence in settings.
2. Use /api/test-ai with provider=gemini to validate.
3. If quota exceeded, wait for retry window or switch provider.
4. Verify model support; the server will fall back automatically.

**Section sources**
- [server.ts:1328-1339](file://server.ts#L1328-L1339)
- [server.ts:508-536](file://server.ts#L508-L536)

#### GitHub Token Invalid/Permissions Issue
1. Re-enter GitHub token in settings.
2. Verify token permissions for Azure AI inference.
3. Retry; the server retries on 429/503.

**Section sources**
- [server.ts:456-499](file://server.ts#L456-L499)

#### OpenRouter Quota Exhaustion
1. Reduce request frequency or apply backoff.
2. Retry; the server retries on 429/503.
3. Temporarily disable OpenRouter if needed.

**Section sources**
- [server.ts:570-589](file://server.ts#L570-L589)

#### DeepSeek Provider Failure
1. Confirm DeepSeek API key is set.
2. Inspect logs for error details.
3. Retry or switch provider.

**Section sources**
- [server.ts:598-626](file://server.ts#L598-L626)

#### Model Not Found (Gemini)
1. Check supported models list.
2. Allow fallback chain to select a working model.
3. Manually adjust preferred provider if necessary.

**Section sources**
- [server.ts:355-363](file://server.ts#L355-L363)
- [server.ts:529-534](file://server.ts#L529-L534)

### Configuration Validation and Connectivity Testing
- Validate base URL:
  - Ensure a valid URL is set when in Server mode.
- Test connection:
  - Use the “Check connection” action to verify server reachability.
- Test AI:
  - Use the “Test AI” endpoint to validate provider connectivity with a test payload.
- Preferred provider:
  - Set a preferred provider to streamline fallback behavior.

**Section sources**
- [SettingsModal.tsx:88-96](file://src/components/SettingsModal.tsx#L88-L96)
- [server.ts:1038-1064](file://server.ts#L1038-L1064)
- [server.ts:1328-1339](file://server.ts#L1328-L1339)

## Conclusion
By leveraging the built-in logging, SSE diagnostics, provider-specific retry/backoff logic, and model fallbacks, most AI provider errors can be diagnosed and resolved quickly. Use the provided curl commands and server endpoints to validate connectivity and quotas, and rely on the UI’s settings and logs to manage keys and monitor health.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Provider Endpoints and Headers
- Gemini:
  - Endpoint: model-specific generation endpoint.
  - Header: Authorization: Bearer YOUR_GEMINI_KEY.
- GitHub (Azure AI):
  - Endpoint: https://models.inference.ai.azure.com/chat/completions.
  - Header: Authorization: Bearer YOUR_GITHUB_TOKEN.
- OpenRouter:
  - Endpoint: https://openrouter.ai/api/v1/chat/completions.
  - Header: Authorization: Bearer YOUR_OPENROUTER_KEY.
- DeepSeek:
  - Endpoint: https://api.deepseek.com/chat/completions.
  - Header: Authorization: Bearer YOUR_DEEPSEEK_KEY.

**Section sources**
- [server.ts:458-473](file://server.ts#L458-L473)
- [server.ts:572-576](file://server.ts#L572-L576)
- [server.ts:599-615](file://server.ts#L599-L615)