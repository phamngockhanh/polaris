import { ShieldAlertIcon } from "lucide-react";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export const UnauthenticatedView = () => {
  return (
    <div className="flex h-screen items-center justify-center bg-sidebar text-sidebar-foreground">
      <div className="w-full max-w-lg bg-unmuted">
        <Item variant="outline" className="text-sidebar-foreground">
          <ItemMedia variant="icon" className="text-sidebar-foreground">
            <ShieldAlertIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="text-sidebar-foreground">
              Unauthorized Access
            </ItemTitle>
            <ItemDescription className="text-sidebar-foreground/80">
              You are not authorized to access this resource.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <SignInButton>
              <Button variant="outline" size="sm">
                Sign in
              </Button>
            </SignInButton>
          </ItemActions>
        </Item>
      </div>
    </div>
  );
};
