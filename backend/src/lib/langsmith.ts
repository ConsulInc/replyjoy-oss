import { traceable, getCurrentRunTree, type TraceableConfig } from "langsmith/traceable";

import "./env.js";

const tracingEnabled = Boolean(process.env.LANGSMITH_API_KEY?.trim());
const projectName = process.env.LANGSMITH_PROJECT?.trim() || undefined;

export function traceableIfEnabled<Func extends (...args: any[]) => any>(
  wrappedFunc: Func,
  config?: TraceableConfig<Func>,
) {
  return traceable(wrappedFunc, {
    ...config,
    project_name: config?.project_name ?? projectName,
    tracingEnabled,
  });
}

export function addTraceEvent(
  name: string,
  payload?: {
    message?: string;
    kwargs?: Record<string, unknown>;
  },
) {
  const runTree = getCurrentRunTree(true);
  if (!runTree || typeof (runTree as { addEvent?: unknown }).addEvent !== "function") {
    return;
  }

  runTree.addEvent({
    name,
    time: new Date().toISOString(),
    message: payload?.message,
    kwargs: payload?.kwargs,
  });
}

export function mergeTraceMetadata(metadata: Record<string, unknown>) {
  const runTree = getCurrentRunTree(true);
  if (!runTree) {
    return;
  }

  runTree.metadata = {
    ...runTree.metadata,
    ...metadata,
  };
}
