import ky, { HTTPError } from "ky";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useClerk } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

import { Id } from "../../../../convex/_generated/dataModel";

const formSchema = z.object({
  url: z.string().trim().url("Please enter a valid URL"),
});

interface ImportGithubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ImportGithubDialog = ({
  open,
  onOpenChange,
}: ImportGithubDialogProps) => {
  const router = useRouter();
  const { openUserProfile } = useClerk();

  const form = useForm({
    defaultValues: {
      url: "",
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        const { projectId } = await ky
          .post("/api/github/import", {
            json: { url: value.url },
          })
          .json<{ 
            success: boolean; 
            projectId: Id<"projects">,
            eventId: string;
          }>()

        toast.success("Importing repository...");
        onOpenChange(false);
        form.reset();

        router.push(`/projects/${projectId}`);
      } catch (error) {
        if (error instanceof HTTPError) {
          const responseText = await error.response.text();
          let body: {
            error?: string;
            code?: string;
            hasGithubConnection?: boolean;
            externalProviders?: string[];
          } = {};

          if (responseText) {
            try {
              body = JSON.parse(responseText) as { error?: string };
            } catch {
              body = { error: responseText };
            }
          }
          if (body.error?.includes("Pro plan required")) {
            toast.error("Upgrade to import repositories", {
              action: {
                label: "Upgrade",
                onClick: () => openUserProfile(),
              },
            });
            onOpenChange(false);
            return;
          }

          if (
            body.code === "GITHUB_OAUTH_TOKEN_MISSING" ||
            body.error?.includes("GitHub not connected") ||
            body.error?.includes("GitHub is connected but no OAuth token")
          ) {
            const details = body.externalProviders?.length
              ? `Providers: ${body.externalProviders.join(", ")}`
              : "No linked GitHub provider was detected for this user in Clerk.";

            toast.error("GitHub OAuth token is missing", {
              description: details,
              action: {
                label: "Connect",
                onClick: () => openUserProfile(),
              },
            });
            onOpenChange(false);
            return;
          }

          if (body.error) {
            toast.error(body.error);
            return;
          }
        }
        toast.error("Unable to import repository. Please check the URL and try again");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-sidebar text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white">Import from GitHub</DialogTitle>
          <DialogDescription className="text-white/70">
            Enter a GitHub repository URL to import. A new project will be
            created with the repository contents.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="url">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;

              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name} className="text-white">
                    Repository URL
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="https://github.com/owner/repo"
                    className="border-white/15 bg-white/5 text-white caret-white placeholder:text-white/50"
                  />
                  {isInvalid && <FieldError className="text-rose-300" errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/15 text-white hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.isSubmitting]}
            >
              {([isSubmitting]) => (
                <Button 
                  type="button"
                  className="text-white"
                  onClick={() => {
                    void form.handleSubmit();
                  }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Importing..." : "Import"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
