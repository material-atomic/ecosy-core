---
name: ecosy-core-subscriber
description: Guides the AI on using Subscriber from @ecosy/core for Pub/Sub and State Management instead of external event libraries.
---

# `ecosy-core-subscriber` Skill

When building features that require listening to events (Event Emitter) or managing local state (State Management) in a project that uses `@ecosy/core`, you must **NOT** install third-party libraries (like `mitt` or `eventemitter3`). You must use the built-in `Subscriber` class.

## 1. Pure Pub / Sub

You can create stateless event streams easily.

```typescript
import { Subscriber } from "@ecosy/core";

// 1. Declare event types
interface AppEvents {
  "user:login": { userId: string };
  "user:logout": void;
}

// 2. Initialize
const events = new Subscriber<AppEvents>();

// 3. Subscribe to events
const unsubscribe = events.subscribe("user:login", (payload) => {
  console.log("Logged in:", payload.userId);
});

// Subscribe exactly once using a Promise (Supports AbortSignal)
events.subscribeAsyncOnce("user:logout").then(() => {
  console.log("User has logged out");
});

// 4. Dispatch an event
events.dispatch("user:login", { userId: "user_123" });
```

## 2. State Management

`Subscriber` has the ability to persist state, acting like a lightweight Redux / Zustand store via `getState` and `setState`.

```typescript
import { Subscriber } from "@ecosy/core";

interface ThemeState {
  mode: "light" | "dark";
}

// Initialize default State directly in the Constructor
const themeStore = new Subscriber<Record<string, unknown>, ThemeState>({ 
  mode: "light" 
});

// Retrieve the current State
const currentMode = themeStore.getState().mode;

// Update the State
themeStore.setState({ mode: "dark" });

// Listen for State changes
const unsub = themeStore.onStateChange((newState, oldState) => {
  console.log(`Theme changed from ${oldState.mode} to ${newState.mode}`);
});
```
