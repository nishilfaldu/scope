import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ContentCard({
  title,
  description,
  action,
  children,
  size = "default",
  headerBorder = true,
  titleClassName,
  headerClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  size?: "default" | "sm";
  headerBorder?: boolean;
  titleClassName?: string;
  headerClassName?: string;
}) {
  return (
    <Card size={size}>
      <CardHeader
        className={cn(headerBorder && "border-b", headerClassName)}
      >
        <CardTitle className={titleClassName}>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children ?? null}
    </Card>
  );
}
