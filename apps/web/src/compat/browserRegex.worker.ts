type WorkerRequest =
  | {
      id: number;
      operation: "replace";
      text: string;
      scripts: Array<{ source: string; flags: string; replacement: string }>;
    }
  | {
      id: number;
      operation: "find-index";
      texts: string[];
      source: string;
      flags: string;
    };

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const value =
      request.operation === "replace"
        ? request.scripts.reduce(
            (text, script) =>
              text.replace(
                new RegExp(script.source, script.flags),
                script.replacement,
              ),
            request.text,
          )
        : request.texts.findIndex((text) =>
            new RegExp(request.source, request.flags).test(text),
          );
    self.postMessage({ id: request.id, ok: true, value });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
