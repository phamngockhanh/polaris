import { useCallback, useEffect, useRef, useState } from "react";
import { WebContainer } from "@webcontainer/api";

import {
  buildFileTree,
  getFilePath
} from "@/features/preview/utils/file-tree";
import { useFiles } from "@/features/projects/hooks/use-files";

import { Doc, Id } from "../../../../convex/_generated/dataModel";

type FileDoc = Doc<"files">;

// Singleton WebContainer instance
let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

const INSTALL_TIMEOUT_MS = 120_000;
const DEV_SERVER_READY_TIMEOUT_MS = 60_000;

const getWebContainer = async (): Promise<WebContainer> => {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }

  if (!bootPromise) {
    bootPromise = WebContainer.boot();
  }

  webcontainerInstance = await bootPromise;
  return webcontainerInstance;
};

const teardownWebContainer = () => {
  if (webcontainerInstance) {
    try {
      webcontainerInstance.teardown();
    } catch {
      // WebContainer can throw "Process aborted" during teardown;
      // ignore and continue resetting singleton state.
    } finally {
      webcontainerInstance = null;
    }
  }
  bootPromise = null;
};

const splitCommand = (command: string): [string, string[]] => {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ["", []];
  }

  return [parts[0], parts.slice(1)];
};

const getRuntimeCommands = (settings?: {
  installCommand?: string;
  devCommand?: string;
}) => {
  const installCommand =
    settings?.installCommand?.trim() || "npm install --no-fund --no-audit";
  const devCommand =
    settings?.devCommand?.trim() ||
    "npm run dev -- --host 0.0.0.0 --port 4173 --strictPort";

  return { installCommand, devCommand };
};

const normalizePreviewUrl = (url: string) => {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
};

const waitWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

interface UseWebContainerProps {
  projectId: Id<"projects">;
  enabled: boolean;
  settings?: {
    installCommand?: string;
    devCommand?: string;
  };
};

export const useWebContainer = ({
  projectId,
  enabled,
  settings,
}: UseWebContainerProps) => {
  const [status, setStatus] = useState<
    "idle" | "booting" | "installing" | "starting" | "running" | "error"
  >("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const [terminalOutput, setTerminalOutput] = useState("");

  const containerRef = useRef<WebContainer | null>(null);
  const hasStartedRef = useRef(false);
  const previousFilesRef = useRef<FileDoc[] | null>(null);

  // Fetch files from Convex (auto-updates on changes)
  const files = useFiles(projectId);

  // Initial boot and mount
  useEffect(() => {
    if (!enabled || !files || files.length === 0 || hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;
    let serverReadyUnsubscribe: (() => void) | null = null;

    const start = async () => {
      try {
        if (typeof window !== "undefined") {
          if (!window.crossOriginIsolated) {
            throw new Error(
              "Preview requires cross-origin isolation. Reload the page on the deployed app domain and use Chrome or Edge."
            );
          }

          if (typeof SharedArrayBuffer === "undefined") {
            throw new Error(
              "This browser does not support WebContainer preview. Use the latest Chrome or Edge desktop."
            );
          }
        }

        setStatus("booting");
        setError(null);
        setTerminalOutput("");

        const appendOutput = (data: string) => {
          setTerminalOutput((prev) => prev + data);
        };

        let resolveServerReady: (() => void) | null = null;
        const serverReadyPromise = new Promise<void>((resolve) => {
          resolveServerReady = resolve;
        });

        const container = await getWebContainer();
        containerRef.current = container;

        const fileTree = buildFileTree(files);
        await container.mount(fileTree);

        const unsubscribeServerReady = container.on("server-ready", (_port, url) => {
          const nextUrl = normalizePreviewUrl(url);
          if (!nextUrl) {
            setError("Received invalid preview URL from WebContainer.");
            setStatus("error");
            return;
          }

          setPreviewUrl(nextUrl);
          setStatus("running");
          resolveServerReady?.();
        });
        if (typeof unsubscribeServerReady === "function") {
          serverReadyUnsubscribe = unsubscribeServerReady;
        }

        setStatus("installing");
        appendOutput("Booting preview container...\n");

        // Parse install command (default: npm install)
        const { installCommand, devCommand } = getRuntimeCommands(settings);

        const [installBin, installArgs] = splitCommand(installCommand);
        if (!installBin) {
          throw new Error("Invalid install command.");
        }
        appendOutput(`\n$ ${installCommand}\n`);
        const installProcess = await container.spawn(installBin, installArgs);
        void installProcess.output
          .pipeTo(
            new WritableStream({
              write(data) {
                appendOutput(data);
              },
            })
          )
          .catch(() => {
            // Stream rejects when process exits/aborts; do not crash the app.
          });
        const installExitCode = await waitWithTimeout(
          installProcess.exit,
          INSTALL_TIMEOUT_MS,
          `Dependency installation is taking too long. Check the terminal output or update the Preview Settings install command.`
        );

        if (installExitCode !== 0) {
          throw new Error(
            `${installCommand} failed with code ${installExitCode}`
          );
        }

        appendOutput("\nDependencies installed successfully.\n");

        // Parse dev command (default: npm run dev with explicit host/port)
        const [devBin, devArgs] = splitCommand(devCommand);
        if (!devBin) {
          throw new Error("Invalid dev command.");
        }

        setStatus("starting");
        appendOutput(`\n$ ${devCommand}\n`);
        const devProcess = await container.spawn(devBin, devArgs, {
          env: {
            __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".webcontainer-api.io",
          },
        });
        void devProcess.output
          .pipeTo(
            new WritableStream({
              write(data) {
                appendOutput(data);
              },
            })
          )
          .catch(() => {
            // Stream rejects when process exits/aborts; do not crash the app.
          });

        void devProcess.exit
          .then((exitCode) => {
            if (exitCode === 0) return;

            setError(`Dev server exited with code ${exitCode}`);
            setStatus("error");
          })
          .catch(() => {
            // Process can reject on teardown/abort; ignore to avoid runtime overlay.
          });

        await waitWithTimeout(
          serverReadyPromise,
          DEV_SERVER_READY_TIMEOUT_MS,
          `The dev server did not become ready in time. Check the terminal output or update the Preview Settings start command.`
        );

      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        setTerminalOutput((prev) =>
          prev.endsWith("\n") ? `${prev}[preview-error] ${message}\n` : `${prev}\n[preview-error] ${message}\n`
        );
        setError(message);
        setStatus("error");
      }
    };

    void start();
    return () => {
      serverReadyUnsubscribe?.();
      serverReadyUnsubscribe = null;
    };
  }, [
    enabled,
    files,
    restartKey,
    settings,
  ]);

  // Sync file changes (hot-reload)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !files || status !== "running") return;

    const filesMap = new Map(files.map((f) => [f._id, f] as const));

    const syncFiles = async () => {
      const previousFiles = previousFilesRef.current ?? [];
      const previousMap = new Map(previousFiles.map((f) => [f._id, f] as const));

      for (const prev of previousFiles) {
        if (filesMap.has(prev._id)) continue;
        const prevPath = getFilePath(prev, previousMap);
        await container.fs.rm(prevPath, { recursive: true, force: true });
      }

      for (const file of files) {
        if (file.type === "folder") {
          const folderPath = getFilePath(file, filesMap);
          await container.fs.mkdir(folderPath, { recursive: true });
          continue;
        }

        if (file.storageId || file.content === undefined) continue;

        const filePath = getFilePath(file, filesMap);
        await container.fs.writeFile(filePath, file.content);
      }

      previousFilesRef.current = files;
    };

    void syncFiles().catch((syncError) => {
      setError(syncError instanceof Error ? syncError.message : "File sync failed");
      setStatus("error");
    });
  }, [files, status]);

  // Reset when disabled
  useEffect(() => {
    if (!enabled) {
      hasStartedRef.current = false;
      previousFilesRef.current = null;
      setStatus("idle");
      setPreviewUrl(null);
      setError(null);
    }
  }, [enabled]);

  // Intentionally do not teardown on unmount in dev StrictMode.
  // React mounts/unmounts effects twice and tearing down the singleton
  // causes WebContainer "Process aborted" runtime overlays.

  // Restart the entire WebContainer process
  const restart = useCallback(() => {
    teardownWebContainer();
    containerRef.current = null;
    hasStartedRef.current = false;
    previousFilesRef.current = null;
    setStatus("idle");
    setPreviewUrl(null);
    setError(null);
    setRestartKey((k) => k + 1);
  }, []);

  return {
    status,
    previewUrl,
    error,
    restart,
    terminalOutput,
  };
};
