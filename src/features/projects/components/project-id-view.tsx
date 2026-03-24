"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Id } from "../../../../convex/_generated/dataModel";
import { FaGithub } from "react-icons/fa";
import { Allotment } from "allotment";
import { FileExplorer } from "./file-explorer";
import { EditorView } from "@/features/editor/components/editor-view";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 350;
const DEFAULT_MAIN_SIZE = 1000;
const Tab = ({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex h-full cursor-pointer items-center gap-2 border-r px-3 text-sidebar-foreground/80 hover:bg-accent/30 hover:text-sidebar-foreground",
        isActive && "bg-background text-sidebar-foreground",
      )}
    >
      <span className="text-sm">{label}</span>
    </div>
  );
};
export const ProjectIdView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const [activeView, setActiveView] = useState<"editor" | "preview">("editor");
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <nav
        className="h-8.75 flex items-center bg-sidebar
            border-b"
      >
        <Tab
          label="Code"
          isActive={activeView === "editor"}
          onClick={() => setActiveView("editor")}
        />
        <Tab
          label="Preview"
          isActive={activeView === "preview"}
          onClick={() => setActiveView("preview")}
        />
        <div className="flex-1 flex justify-end h-full">
          <div className="flex h-full cursor-pointer items-center gap-1.5 border-l px-3 text-sidebar-foreground/80 hover:bg-accent/30 hover:text-sidebar-foreground">
            <FaGithub className="size-3.5" />
            <span className="text-sm">Export</span>
          </div>
        </div>
      </nav>
      <div className="flex-1 relative">
        <div
          className={cn(
            "absolute inset-0",
            activeView === "editor" ? "visible" : "invisible",
          )}
        >
          <Allotment defaultSizes={[DEFAULT_SIDEBAR_WIDTH, DEFAULT_MAIN_SIZE]}>
            <Allotment.Pane
              snap
              minSize={MIN_SIDEBAR_WIDTH}
              maxSize={MAX_SIDEBAR_WIDTH}
              preferredSize={DEFAULT_SIDEBAR_WIDTH}
            >
              <FileExplorer projectId={projectId} />
            </Allotment.Pane>
            <Allotment.Pane>
              <div className="h-full bg-sidebar text-sidebar-foreground">
                <EditorView projectId={projectId} />
              </div>
            </Allotment.Pane>
          </Allotment>
        </div>
        <div
          className={cn(
            "absolute inset-0",
            activeView === "preview" ? "visible" : "invisible",
          )}
        >
          <div className="h-full bg-sidebar text-sidebar-foreground">
            Preview
          </div>
        </div>
      </div>
    </div>
  );
};
