import Link from "next/link";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  GlobeIcon,
  Loader2Icon,
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { formatDistanceToNow } from "date-fns";

import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";

import { Doc } from "../../../../convex/_generated/dataModel";

import { useProjectsPartial } from "../hooks/use-projects";
import { Button } from "@/components/ui/button";

const formatTimestamp = (timestamp: number) => {
  return formatDistanceToNow(new Date(timestamp), {
    addSuffix: true,
  });
};

const getProjectIcon = (project: Doc<"projects">) => {
  if (project.importStatus === "completed") {
    return <FaGithub className="size-3.5 text-sidebar-foreground/60" />;
  }

  if (project.importStatus === "failed") {
    return <AlertCircleIcon className="size-3.5 text-sidebar-foreground/60" />;
  }
  if (project.importStatus === "importing") {
    return (
      <Loader2Icon className="size-3.5 text-sidebar-foreground/60 animate-spin" />
    );
  }
  return <GlobeIcon className="size-3.5 text-sidebar-foreground/60" />;
};
interface ProjectsListProps {
  onViewAll: () => void;
}
const ContinueCard = ({ data }: { data: Doc<"projects"> }) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-sidebar-foreground/60">Last updated</span>
      <Button
        variant="outline"
        asChild
        className="h-auto items-start justify-start p-4
      bg-background border rounded-non flex flex-col gap-2"
      >
        <Link href={`/projects/${data._id}`} className="group">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              {getProjectIcon(data)}
              <span className="font-medium truncate">{data.name}</span>
            </div>
            <ArrowRightIcon className="size-4 text-sidebar-foreground/60 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(data.updatedAt)}
          </span>
        </Link>
      </Button>
    </div>
  );
};

const ProjectItem = ({ data }: { data: Doc<"projects"> }) => {
  return (
    <Link
      href={`/projects/${data._id}`}
      className="flex w-full items-center justify-between gap-3 py-1 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground group"
    >
      <div className="flex items-center gap-2">
        {getProjectIcon(data)}
        <span className="truncate">{data.name}</span>
      </div>
      <span className="shrink-0 text-xs text-sidebar-foreground/50 transition-colors group-hover:text-sidebar-foreground/70">
        {formatTimestamp(data.updatedAt)}
      </span>
    </Link>
  );
};

export const ProjectsList = ({ onViewAll }: ProjectsListProps) => {
  const projects = useProjectsPartial(6);

  if (projects === undefined) {
    return <Spinner className="size-4 text-ring" />;
  }

  const [mostRecent, ...rest] = projects;
  return (
    <div className="flex w-full flex-col gap-4">
      {mostRecent ? <ContinueCard data={mostRecent} /> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-sidebar-foreground/60">Recent Projects</span>
        {rest.length > 0 && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-2 text-xs text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
          >
            <span>View all</span>
            <Kbd className="bg-accent border">⌘K</Kbd>
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="border bg-background p-4 text-sm text-muted-foreground">
          No projects yet. Create one to see it here.
        </div>
      ) : (
        // <div className="flex flex-col gap-2">
        //   {projects.map((project) => (
        //     <div
        //       key={project._id}
        //       className="flex items-center justify-between border bg-background px-4 py-3 text-sm"
        //     >
        //       <span className="truncate font-medium text-foreground">
        //         {project.name}
        //       </span>
        //       <span className="text-xs text-muted-foreground">
        //         {new Date(project.updatedAt).toLocaleDateString()}
        //       </span>
        //     </div>
        //   ))}
        // </div>
        <ul className="flex flex-col gap-2">
          {rest.map((project) => (
            <ProjectItem key={project._id} data={project} />
          ))}
        </ul>
      )}
    </div>
  );
};
