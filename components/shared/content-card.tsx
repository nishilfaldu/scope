import type { ReactNode } from "react";
import { cn } from "cn";

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
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  size?: "default" | "sm";
  headerBorder?: boolean;
  titleClassName?: string;
}) {
  return (
    <Card size={size}>
      <CardHeader className={headerBorder ? "border-b" : undefined}>
        <CardTitle className={cn(action && "self-center", titleClassName)}>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children ?? null}
    </Card>
  );
}
