# Historical implementation

These SQL migrations and diagnostic scripts are retained as a reference for the
previous InsForge implementation. They are not executed by the new application,
test suite, or migration runner. They assume InsForge roles, RPCs, realtime
schemas, and old source paths and should not be run against Neon.

The active schema is `apps/api/migrations/`. Game logic now lives in the Express
services and shared TypeScript package. This rebuild starts with a fresh database;
existing games and sessions are not imported.
