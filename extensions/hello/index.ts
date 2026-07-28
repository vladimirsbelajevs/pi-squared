import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function helloExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, context) => {
    context.ui.notify("Hello extension loaded", "info");
  });

  pi.registerCommand("hello", {
    description: "Test the local extension",
    handler: async (args, context) => {
      const name = args.trim() || "Vladimirs";
      context.ui.notify(`Hello, ${name}`, "info");
    }
  });
}