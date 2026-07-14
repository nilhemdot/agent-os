```markdown
# agent-os Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns, coding conventions, and workflows used in the `agent-os` TypeScript codebase. You'll learn how to structure files, write imports/exports, and follow the project's testing approach using Vitest. This guide also provides suggested commands for common workflows to streamline your development process.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userAgent.ts`, `sessionManager.ts`

### Import Style
- Use **alias imports** for modules.
  - Example:
    ```typescript
    import { UserSession } from '@/sessions'
    ```

### Export Style
- Use **named exports**.
  - Example:
    ```typescript
    export function startAgent() { ... }
    export const AGENT_VERSION = '1.0.0'
    ```

### Commit Messages
- Freeform style, typically concise (~37 characters).
  - Example: `fix agent startup race condition`

## Workflows

### Running Tests
**Trigger:** When you want to run the test suite to verify code correctness.
**Command:** `/run-tests`

1. Ensure you have all dependencies installed.
2. Run the Vitest test suite:
    ```bash
    npx vitest
    ```
3. Review the output for passing and failing tests.

### Adding a New Module
**Trigger:** When you need to add a new feature or module.
**Command:** `/add-module`

1. Create a new file using camelCase naming (e.g., `newFeature.ts`).
2. Implement your logic using named exports.
    ```typescript
    export function newFeature() { ... }
    ```
3. Add any necessary imports using alias style.
4. Write corresponding tests in a file named `newFeature.test.ts`.
5. Run `/run-tests` to ensure your module works as expected.

### Writing Tests
**Trigger:** When you implement new functionality or fix a bug.
**Command:** `/write-test`

1. Create a test file with the `.test.ts` suffix (e.g., `userAgent.test.ts`).
2. Use Vitest to write your tests:
    ```typescript
    import { describe, it, expect } from 'vitest'
    import { userAgent } from './userAgent'

    describe('userAgent', () => {
      it('should return correct agent', () => {
        expect(userAgent()).toBe('agent-os')
      })
    })
    ```
3. Run `/run-tests` to verify your tests pass.

## Testing Patterns

- Tests are written in files matching `*.test.ts`.
- The [Vitest](https://vitest.dev/) framework is used.
- Example test:
    ```typescript
    import { describe, it, expect } from 'vitest'
    import { startAgent } from './startAgent'

    describe('startAgent', () => {
      it('initializes agent successfully', () => {
        expect(startAgent()).toBeTruthy()
      })
    })
    ```

## Commands
| Command       | Purpose                                 |
|---------------|-----------------------------------------|
| /run-tests    | Run the full Vitest test suite          |
| /add-module   | Scaffold and add a new module           |
| /write-test   | Create and run tests for new code       |
```
