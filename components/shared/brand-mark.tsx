import Image from "next/image";

import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/scope-mark.svg?v=dark-green"
      alt=""
      width={32}
      height={32}
      priority={priority}
      className={cn("rounded-lg", className)}
    />
  );
}
