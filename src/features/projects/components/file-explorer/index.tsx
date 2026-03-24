import { useState } from "react";
import {
  ChevronRightIcon,
  CopyMinusIcon,
  FilePlusCornerIcon,
  FolderPlusIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCreateFile,
  useCreateFolder,
  useFolderContents,
} from "../../hooks/use-files";
import { useProject } from "../../hooks/use-projects";
import { Id } from "../../../../../convex/_generated/dataModel";
import { CreateInput } from "./create-input";
import { LoadingRow } from "./loading-row";
import { Tree } from "./tree";
export const FileExplorer = ({ projectId }: { projectId: Id<"projects"> }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [collapseKey, setCollapseKey] = useState(0);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const createFile = useCreateFile();
  const project = useProject(projectId);
  const createFolder = useCreateFolder();
  const rootFiles = useFolderContents({
    projectId,
    enabled: isOpen,
  });
  const handleCreate = (name: string) => {
    setCreating(null);

    if (creating === "file") {
      createFile({
        projectId,
        name,
        content: "",
        parentId: undefined,
      });
    } else {
      createFolder({
        projectId,
        name,
        parentId: undefined,
      });
    }
  };

  return (
    <div className="h-full bg-sidebar">
      <ScrollArea>
        <div
          role="button"
          onClick={() => setIsOpen((current) => !current)}
          className="group/project relative flex h-5.5 w-full cursor-pointer items-center gap-0.5 bg-accent text-left font-bold"
        >
          <ChevronRightIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground",
              isOpen && "rotate-90",
            )}
          />
          <p className="min-w-0 flex-1 truncate pr-1 text-xs uppercase">
            {project?.name ?? "Loading..."}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 bg-accent pl-1 opacity-0 pointer-events-none transition-opacity group-hover/project:opacity-100 group-hover/project:pointer-events-auto">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("file");
              }}
              variant="highlight"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
            >
              <FilePlusCornerIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("folder");
              }}
              variant="highlight"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
            >
              <FolderPlusIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setCollapseKey((prev) => prev + 1);
              }}
              variant="highlight"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
            >
              <CopyMinusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        {isOpen && (
          <>
            {rootFiles === undefined && <LoadingRow level={0} />}
            {creating && (
              <CreateInput
                type={creating}
                level={0}
                onSubmit={handleCreate}
                onCancel={() => setCreating(null)}
              />
            )}
            {rootFiles?.map((item) => (
              <Tree
                key={`${item._id}-${collapseKey}`}
                item={item}
                level={0}
                projectId={projectId}
              />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );
};
