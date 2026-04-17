# Express Server Architecture

<cite>
**Referenced Files in This Document**
- [server.ts](file://server.ts)
- [package.json](file://package.json)
- [src/serverUtils.ts](file://src/serverUtils.ts)
- [tsconfig.server.json](file://tsconfig.server.json)
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

## Introduction
This document provides comprehensive documentation for the Express server architecture used in the project. It covers server initialization, middleware configuration (including CORS, rate limiting, and JSON parsing), middleware stack ordering, security considerations, environment variable validation, error handling patterns, graceful shutdown procedures, and server lifecycle management. It also explains the relationships between middleware components and their impact on request processing.

## Project Structure
The server is implemented as a single-file Express application with supporting utilities and TypeScript configuration. Key elements include:
- Express server initialization and middleware stack
- Environment validation and configuration loading
- Middleware components: JSON parsing, CORS, and rate limiting
- API routes for configuration, publishing, templates, and utilities
- Logging infrastructure and graceful shutdown handling
- Development and production serving modes

```mermaid
graph TB
A["server.ts<br/>Express server and middleware stack"] --> B["src/serverUtils.ts<br/>FileLogger utility"]
A --> C["package.json<br/>Dependencies and scripts"]
A --> D["tsconfig.server.json<br/>Server TypeScript configuration"]
A --> E["Environment Variables<br/>TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, etc."]
A --> F["API Routes<br/>/api/* endpoints"]
A --> G["Static Assets<br/>Development (Vite) / Production (dist)"]
```

**Diagram sources**
- [server.ts](file://server.ts)
- [src/serverUtils.ts](file://src/serverUtils.ts)
- [package.json](file://package.json)
- [tsconfig.server.json](file://tsconfig.server.json)

**Section sources**
- [server.ts](file://server.ts)
- [package.json](file://package.json)
- [src/serverUtils.ts](file://src/serverUtils.ts)
- [tsconfig.server.json](file://tsconfig.server.json)

## Core Components
This section outlines the primary components of the Express server and their roles in the middleware stack and request processing pipeline.

- Express application initialization and trust proxy configuration
- Environment variable validation for required secrets
- Middleware stack: JSON parsing, CORS, and rate limiting
- API route groups: configuration, publishing, templates, utilities
- Logging and SSE endpoint for live logs
- Graceful shutdown and signal handling
- Development vs. production asset serving

**Section sources**
- [server.ts](file://server.ts)

## Architecture Overview
The server follows a layered architecture:
- Middleware layer: request preprocessing and security
- Route layer: API endpoints grouped by functionality
- Utility layer: logging, file system operations, and AI processing
- Lifecycle layer: initialization, scheduling, and shutdown

```mermaid
graph TB
subgraph "Middleware Layer"
M1["express.json({ limit: '50mb' })"]
M2["express.urlencoded({ limit: '50mb', extended: true })"]
M3["cors({ origin: true, credentials: true, methods: [...], allowedHeaders: [...] })"]
M4["rateLimit('/api/' -> apiLimiter)"]
M5["rateLimit('.../process-text' -> aiRateLimiter)"]
M6["rateLimit('.../mutations' -> mutationRateLimiter)"]
end
subgraph "Route Layer"
R1["/api/ping"]
R2["/api/status"]
R3["/api/config/*"]
R4["/api/bot/*"]
R5["/api/process-text"]
R6["/api/process-url"]
R7["/api/posts/*"]
R8["/api/images/*"]
R9["/api/logs/stream"]
R10["/api/logs"]
R11["/api/utils/*"]
end
subgraph "Utility Layer"
U1["FileLogger"]
U2["Storage wrappers"]
U3["AI processing (Gemini, GitHub, OpenRouter, DeepSeek)"]
U4["Telegram bot integration"]
end
M1 --> M2 --> M3 --> M4 --> M5 --> M6 --> R1
R1 --> R2 --> R3 --> R4 --> R5 --> R6 --> R7 --> R8 --> R9 --> R10 --> R11
R11 --> U1
R3 --> U2
R5 --> U3
R4 --> U4
```

**Diagram sources**
- [server.ts](file://server.ts)
- [src/serverUtils.ts](file://src/serverUtils.ts)

## Detailed Component Analysis

### Middleware Stack and Order
The middleware stack is configured early in the application lifecycle to ensure consistent request handling across all routes. The order is critical for security and performance.

- JSON and URL-encoded parsers are registered first to ensure request bodies are available to subsequent middleware and routes.
- CORS middleware is applied globally to enable cross-origin requests with credentials and specific methods/headers.
- Rate limiters are mounted to specific paths to protect high-throughput endpoints while allowing broader limits for general API routes.

```mermaid
flowchart TD
Start(["Request Received"]) --> ParseJSON["Parse JSON Body<br/>express.json({ limit: '50mb' })"]
ParseJSON --> ParseURL["Parse URL Encoded Body<br/>express.urlencoded({ limit: '50mb', extended: true })"]
ParseURL --> CORS["CORS Policy<br/>origin: true, credentials: true,<br/>methods: GET,POST,PUT,DELETE,OPTIONS,<br/>allowedHeaders: Content-Type,Accept,Origin"]
CORS --> APIPathCheck{"Is Path under '/api/'?"}
APIPathCheck --> |Yes| APILimit["Apply apiLimiter<br/>windowMs: 15min, max: 1000"]
APIPathCheck --> |No| NextMW["Next Middleware/Route"]
APILimit --> NextMW
NextMW --> RouteMatch{"Route Match"}
RouteMatch --> |Specific Rate-Limited Route| RateLimit["Apply specialized limiter<br/>aiRateLimiter or mutationRateLimiter"]
RouteMatch --> |Other Routes| Continue["Continue to Handler"]
RateLimit --> Continue
```

**Diagram sources**
- [server.ts](file://server.ts)

**Section sources**
- [server.ts](file://server.ts)

### Security Considerations
Security is addressed through several middleware and route-level safeguards:
- Trust proxy is enabled to correctly interpret forwarded headers behind reverse proxies/load balancers.
- CORS configuration allows credentials and restricts methods and headers to essential ones.
- Rate limiters reduce abuse and resource exhaustion risks.
- File upload and image serving endpoints include path traversal protections and directory restrictions.
- Environment validation ensures required secrets are present before starting the server.

```mermaid
flowchart TD
SecStart(["Incoming Request"]) --> ProxyTrust["Trust Proxy Enabled"]
ProxyTrust --> CORS["CORS Validation"]
CORS --> RateCheck{"Rate-Limited Endpoint?"}
RateCheck --> |Yes| ApplyRate["Apply Rate Limiter"]
RateCheck --> |No| FileOps{"File Upload/Image Access?"}
ApplyRate --> FileOps
FileOps --> |Yes| PathSanitize["Sanitize Paths<br/>Block Sensitive Directories<br/>Resolve and Verify"]
FileOps --> |No| EnvCheck["Validate Environment Variables"]
PathSanitize --> EnvCheck
EnvCheck --> Proceed["Proceed to Route Handler"]
```

**Diagram sources**
- [server.ts](file://server.ts)

**Section sources**
- [server.ts](file://server.ts)

### Environment Variable Validation
The server validates required environment variables before initializing the application. Missing required variables cause an immediate error, preventing unsafe operation. Optional variables trigger warnings to inform developers about potential feature limitations.

- Required: TELEGRAM_BOT_TOKEN
- Optional: GEMINI_API_KEY (warning if missing)

**Section sources**
- [server.ts](file://server.ts)

### Error Handling Patterns
Error handling is implemented at multiple levels:
- Centralized logging via FileLogger for persistent error tracking
- Route handlers return structured JSON errors with appropriate HTTP status codes
- Unhandled promise rejections are logged to stderr
- Graceful shutdown captures SIGINT/SIGTERM signals to stop dependent services

```mermaid
sequenceDiagram
participant Client as "Client"
participant Server as "Express Server"
participant Logger as "FileLogger"
participant Handler as "Route Handler"
Client->>Server : Request
Server->>Handler : Invoke Route Handler
Handler->>Handler : Business Logic
Handler-->>Server : Error Thrown
Server->>Logger : Log Error Details
Server-->>Client : 500 JSON Error Response
```

**Diagram sources**
- [server.ts](file://server.ts)
- [src/serverUtils.ts](file://src/serverUtils.ts)

**Section sources**
- [server.ts](file://server.ts)
- [src/serverUtils.ts](file://src/serverUtils.ts)

### Graceful Shutdown Procedures
The server registers signal handlers for SIGINT and SIGTERM to gracefully stop the Telegram bot and exit the process. This ensures resources are released and pending operations are completed.

```mermaid
stateDiagram-v2
[*] --> Running
Running --> Stopping : "SIGINT/SIGTERM"
Stopping --> Stopped : "Bot Stopped and Process Exited"
Stopped --> [*]
```

**Diagram sources**
- [server.ts](file://server.ts)

**Section sources**
- [server.ts](file://server.ts)

### Server Configuration and Lifecycle Management
The server supports development and production modes:
- Development: Vite middleware serves the React SPA
- Production: Static files served from dist with a fallback to index.html for SPA routing
- Initialization loads persisted configuration, starts the Telegram bot if available, and schedules periodic tasks

```mermaid
sequenceDiagram
participant Boot as "Boot Process"
participant Config as "loadAllData()"
participant Bot as "initBot(token)"
participant Dev as "Vite Middleware"
participant Prod as "Static Dist"
participant Server as "app.listen(PORT)"
Boot->>Config : Load persisted data
Config-->>Boot : Defaults and cached data
Boot->>Bot : Initialize Telegram bot (if token exists)
alt NODE_ENV !== "production"
Boot->>Dev : Enable Vite middleware
else
Boot->>Prod : Serve static files from dist
end
Boot->>Server : Start HTTP server on PORT
```

**Diagram sources**
- [server.ts](file://server.ts)

**Section sources**
- [server.ts](file://server.ts)

### API Routes and Middleware Impact
Routes are organized into functional groups, each with tailored middleware:
- Configuration routes: protected by mutationRateLimiter
- AI processing routes: protected by aiRateLimiter and mutationRateLimiter
- Image management: upload and file serving with strict path validations
- Logs: SSE endpoint for live logs and static log retrieval
- Utilities: directory listing with path restrictions

```mermaid
graph TB
subgraph "Configuration"
C1["/api/config/token"]
C2["/api/config/clear-token"]
C3["/api/config/chat-id"]
C4["/api/config/chat-id-presets"]
C5["/api/config/api-key"]
C6["/api/config/server-key"]
C7["/api/config/status"]
C8["/api/config/image-path"]
end
subgraph "Bot Control"
B1["/api/bot/test-message"]
B2["/api/bot/stop"]
B3["/api/bot/restart"]
end
subgraph "AI Processing"
A1["/api/process-text"]
A2["/api/process-url"]
A3["/api/test-key"]
A4["/api/test-ai"]
end
subgraph "Posts and Scheduling"
P1["/api/posts/drafts"]
P2["/api/posts/scheduled"]
P3["/api/posts/published"]
P4["/api/posts/schedule"]
P5["/api/posts/publish"]
end
subgraph "Templates"
T1["/api/posts/templates/buttons"]
T2["/api/posts/templates/reactions"]
end
subgraph "Images"
I1["/api/upload-images"]
I2["/api/images/sync"]
I3["/api/images/file/:filename"]
end
subgraph "Utilities"
U1["/api/utils/list-dirs"]
U2["/api/test-telegram"]
end
C1 --> B1
A1 --> P1
I1 --> T1
U1 --> A1
```

**Diagram sources**
- [server.ts](file://server.ts)

**Section sources**
- [server.ts](file://server.ts)

## Dependency Analysis
The server relies on external libraries for core functionality. The dependency graph highlights key integrations.

```mermaid
graph TB
S["server.ts"] --> E["express"]
S --> C["cors"]
S --> RL["express-rate-limit"]
S --> AX["axios"]
S --> TG["telegraf"]
S --> GM["@google/generative-ai"]
S --> MK["marked"]
S --> CH["cheerio"]
S --> DV["dotenv"]
S --> V["vite (dev)"]
S --> FS["fs"]
S --> PATH["path"]
S --> UUID["uuid"]
U["src/serverUtils.ts"] --> FS
U --> PATH
```

**Diagram sources**
- [server.ts](file://server.ts)
- [package.json](file://package.json)
- [src/serverUtils.ts](file://src/serverUtils.ts)

**Section sources**
- [package.json](file://package.json)

## Performance Considerations
- Body size limits are increased for JSON and URL-encoded payloads to accommodate larger requests.
- Rate limiters are strategically placed to prevent overload on AI and mutation endpoints.
- Static asset serving is optimized for production using a dedicated dist directory.
- Logging writes are asynchronous to minimize request latency.

## Troubleshooting Guide
Common issues and their resolution steps:
- Missing environment variables: Ensure TELEGRAM_BOT_TOKEN and optional GEMINI_API_KEY are set before starting the server.
- Rate limit errors: Review apiLimiter, aiRateLimiter, and mutationRateLimiter configurations for affected endpoints.
- File upload failures: Verify target directory permissions and path restrictions.
- Bot initialization errors: Check token validity and network connectivity; review health monitor logs.
- Graceful shutdown: Confirm SIGINT/SIGTERM handlers are invoked and the Telegram bot is stopped cleanly.

**Section sources**
- [server.ts](file://server.ts)
- [src/serverUtils.ts](file://src/serverUtils.ts)

## Conclusion
The Express server architecture integrates middleware-driven request processing with robust configuration, security, and lifecycle management. The middleware stack establishes a secure and efficient foundation, while modular API routes encapsulate functionality. Proper environment validation, error handling, and graceful shutdown procedures ensure reliable operation across development and production environments.