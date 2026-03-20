/* eslint-disable react-hooks/purity */
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export const useProject = (projectId: Id<"projects">) => {
  return useQuery(api.projects.getById, { id: projectId });
};

export const useProjects = () => {
  return useQuery(api.projects.get);
};

export const useProjectsPartial = (limit: number) => {
  return useQuery(api.projects.getPartial, {
    limit,
  });
};

export const useCreateProject = () => {
  return useMutation(api.projects.create).withOptimisticUpdate(
    (localStore, args) => {
      const existingProjects = localStore.getQuery(api.projects.get);
      if (existingProjects !== undefined) {
        const now = Date.now();
        const newProject = {
          _id: crypto.randomUUID() as Id<"projects">,
          _creationTime: now,
          name: args.name,
          ownerId: "anonymous",
          updatedAt: now,
        };
        localStore.setQuery(api.projects.get, {}, [
          newProject,
          ...existingProjects,
        ]);
      }
    },
  );
};

export const useRenameProject = (projectId: Id<"projects">) => {
  return useMutation(api.projects.rename).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const existingProject = localStore.getQuery(api.projects.getById, {
        id: projectId,
      });

      if (existingProject !== undefined && existingProject !== null) {
        localStore.setQuery(
          api.projects.getById,
          { id: projectId },
          {
            ...existingProject,
            name: args.name,
            updatedAt: now,
          },
        );
      }

      const existingProjects = localStore.getQuery(api.projects.get);
      if (existingProjects !== undefined) {
        localStore.setQuery(
          api.projects.get,
          {},
          existingProjects.map((project) =>
            project._id === args.id
              ? { ...project, name: args.name, updatedAt: now }
              : project,
          ),
        );
      }

      for (const limit of [6]) {
        const existingProjectsPartial = localStore.getQuery(
          api.projects.getPartial,
          { limit },
        );

        if (existingProjectsPartial !== undefined) {
          localStore.setQuery(
            api.projects.getPartial,
            { limit },
            existingProjectsPartial.map((project) =>
              project._id === args.id
                ? { ...project, name: args.name, updatedAt: now }
                : project,
            ),
          );
        }
      }
    },
  );
};
