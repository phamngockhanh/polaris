import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

import { getItemPadding } from "./constants";

export const LoadingRow = ({
  className,
  level = 0,
}: {
  className?: string;
  level?: number;
}) => {
  return (
    <div className={cn(
      "h-5.5 flex items-center text-white/70",
      className,
    )}
      style={{ paddingLeft: getItemPadding(level, true) }}
    >
      <Spinner className="ml-0.5 size-4 text-white/70" />
    </div>
  );
};
