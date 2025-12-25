# TypeScript Error Handling

## Overview

Proper error handling is critical for building robust, maintainable TypeScript applications. This document defines error handling patterns and best practices for Prisma teams.

## Core Principles

1. **Use Zod for Input Validation** - Validate external input at system boundaries
2. **Custom Error Classes** - Create domain-specific error classes for better error handling
3. **Structured Error Responses** - Return consistent, actionable error information
4. **Never Expose Internal Details** - Protect sensitive implementation details from clients
5. **Fail Fast** - Detect and report errors as early as possible

## Input Validation with Zod

### Why Zod?

Zod provides runtime type validation that complements TypeScript's compile-time type checking:

- Type-safe validation with automatic TypeScript inference
- Clear, composable validation schemas
- Detailed error messages for debugging
- Zero runtime overhead when validation passes

### Basic Validation

```typescript
import { z } from "zod";

// Define schema
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().positive().optional(),
});

// Infer TypeScript type from schema
type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Validate input
function createUser(input: unknown): CreateUserInput {
  // Throws ZodError if validation fails
  return CreateUserSchema.parse(input);
}

// Safe validation (doesn't throw)
function createUserSafe(input: unknown) {
  const result = CreateUserSchema.safeParse(input);

  if (!result.success) {
    console.error("Validation failed:", result.error.issues);
    return null;
  }

  return result.data; // Type-safe validated data
}
```

### Validation at Boundaries

Always validate data at system boundaries:

```typescript
// ✅ Good - validate at API boundary
export async function handleCreateUser(request: Request): Promise<Response> {
  const body = await request.json();

  // Validate before processing
  const validatedInput = CreateUserSchema.safeParse(body);

  if (!validatedInput.success) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        details: validatedInput.error.issues,
      }),
      { status: 400 },
    );
  }

  const user = await userService.createUser(validatedInput.data);
  return new Response(JSON.stringify(user), { status: 201 });
}

// ❌ Bad - no validation, trusting external input
export async function handleCreateUser(request: Request): Promise<Response> {
  const body = await request.json(); // Unsafe!
  const user = await userService.createUser(body); // Type errors possible
  return new Response(JSON.stringify(user));
}
```

### Complex Validation Scenarios

```typescript
// Nested objects
const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  postalCode: z.string().regex(/^\d{5}$/),
});

const UserWithAddressSchema = z.object({
  email: z.string().email(),
  address: AddressSchema,
});

// Arrays
const UsersSchema = z.array(UserSchema).min(1).max(100);

// Unions and discriminated unions
const ResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: z.any() }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);

// Conditional validation
const ConfigSchema = z
  .object({
    mode: z.enum(["development", "production"]),
    debugEnabled: z.boolean().optional(),
  })
  .refine((data) => {
    // Debug can only be enabled in development
    if (data.mode === "production" && data.debugEnabled) {
      return false;
    }
    return true;
  }, "Debug mode cannot be enabled in production");
```

## Custom Error Classes

### Base Error Class

Create a base error class for your application:

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.name,
      message: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
    };
  }
}
```

### Domain-Specific Error Classes

Create specific error classes for different error types:

```typescript
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found`, "NOT_FOUND", 404, { resource, identifier });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, details);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(
      message,
      "DATABASE_ERROR",
      500,
      originalError ? { cause: originalError.message } : undefined,
    );
  }
}
```

### Using Custom Errors

```typescript
// ✅ Good - using custom error classes
async function getUser(userId: string): Promise<User> {
  const user = await db.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User", userId);
  }

  return user;
}

async function createUser(input: CreateUserInput): Promise<User> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
  });

  if (existing) {
    throw new ConflictError("User with this email already exists", {
      email: input.email,
    });
  }

  try {
    return await db.user.create({ data: input });
  } catch (error) {
    throw new DatabaseError("Failed to create user", error as Error);
  }
}

// ❌ Bad - throwing generic errors
async function getUser(userId: string): Promise<User> {
  const user = await db.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new Error("User not found"); // No context, no status code
  }

  return user;
}
```

## Structured Error Responses

### Error Response Format

Use a consistent error response structure:

```typescript
interface ErrorResponse {
  error: string; // Error name/type
  message: string; // Human-readable message
  code: string; // Machine-readable error code
  statusCode: number; // HTTP status code
  details?: Record<string, unknown>; // Additional context
  requestId?: string; // For tracing
}
```

### Error Handler Middleware

```typescript
function errorHandler(error: Error): Response {
  // Handle known application errors
  if (error instanceof AppError) {
    return new Response(JSON.stringify(error.toJSON()), {
      status: error.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle Zod validation errors
  if (error instanceof z.ZodError) {
    return new Response(
      JSON.stringify({
        error: "ValidationError",
        message: "Invalid input",
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: error.issues,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Handle unexpected errors
  console.error("Unexpected error:", error);

  return new Response(
    JSON.stringify({
      error: "InternalServerError",
      message: "An unexpected error occurred",
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
    }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" },
    },
  );
}
```

## Never Expose Internal Details

### What to Hide

- Database error messages
- Stack traces
- Internal file paths
- Configuration details
- Third-party API errors
- Authentication/authorization logic details

```typescript
// ✅ Good - generic error for client
try {
  await db.user.create(data);
} catch (error) {
  console.error("Database error:", error); // Log internally
  throw new DatabaseError("Failed to create user"); // Generic message
}

// ❌ Bad - exposing internal details
try {
  await db.user.create(data);
} catch (error) {
  throw new Error(`Database error: ${error.message}`); // Exposes DB details
}
```

### Sanitizing Errors

```typescript
function sanitizeError(error: Error): ErrorResponse {
  // In production, never include stack traces
  const isDevelopment = process.env.NODE_ENV === "development";

  if (error instanceof AppError) {
    return {
      error: error.name,
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      ...(error.details && { details: error.details }),
      ...(isDevelopment && { stack: error.stack }),
    };
  }

  // For unexpected errors, return generic message
  return {
    error: "InternalServerError",
    message: isDevelopment ? error.message : "An unexpected error occurred",
    code: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
    ...(isDevelopment && { stack: error.stack }),
  };
}
```

## Error Recovery Patterns

### Try-Catch with Graceful Degradation

```typescript
async function getUserWithFallback(userId: string): Promise<User | null> {
  try {
    return await getUser(userId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null; // Graceful degradation
    }
    throw error; // Re-throw unexpected errors
  }
}
```

### Retry Logic

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError!.message}`);
}
```

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime?: number;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime! > this.timeout) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = "open";
    }
  }
}
```

## Logging Errors

### Structured Error Logging

```typescript
interface LogContext {
  userId?: string;
  requestId?: string;
  endpoint?: string;
  [key: string]: unknown;
}

function logError(error: Error, context?: LogContext) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: "error",
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error instanceof AppError && { code: error.code }),
    },
    ...context,
  };

  // Use structured logging (JSON)
  console.error(JSON.stringify(logEntry));
}

// Usage
try {
  await processRequest(request);
} catch (error) {
  logError(error as Error, {
    userId: request.userId,
    requestId: request.id,
    endpoint: request.url,
  });
  throw error;
}
```

### Redact Sensitive Information

```typescript
function redactSensitiveData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const sensitiveKeys = ["password", "token", "apiKey", "secret", "creditCard"];

  return Object.entries(data).reduce(
    (acc, [key, value]) => {
      if (
        sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))
      ) {
        acc[key] = "[REDACTED]";
      } else {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, unknown>,
  );
}

// Usage
console.info("User data:", redactSensitiveData(userData));
```

## Summary Checklist

- [ ] Use Zod for validating all external input
- [ ] Create custom error classes for different error types
- [ ] Implement consistent error response format
- [ ] Never expose internal error details to clients
- [ ] Log errors with structured context
- [ ] Redact sensitive information from logs
- [ ] Implement retry logic for transient failures
- [ ] Use circuit breakers for unstable dependencies
- [ ] Handle errors at appropriate levels (don't swallow errors)
- [ ] Test error handling paths thoroughly
