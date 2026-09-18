"use client";

import { type ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface BaseModalProps {
  /** Render prop for trigger - receives openModal function */
  children?: (options: { openModal: () => void }) => ReactNode;
  /** Dialog title */
  title: string;
  /** Dialog description */
  description?: string;
  /** Content to render between header and footer */
  content: ReactNode;
  /** Primary button text */
  submitLabel?: string;
  /** Primary button loading text */
  submitLoadingLabel?: string;
  /** Cancel/Close button text (defaults to "Close" for view-only, "Cancel" for action modals) */
  cancelLabel?: string;
  /** Whether the submit button is disabled */
  submitDisabled?: boolean;
  /** Whether the modal is in loading state */
  isLoading?: boolean;
  /** Called when submit button is clicked. If omitted, modal is view-only with just a close button. */
  onSubmit?: () => void | Promise<void>;
  /** Called when modal closes (cancel or outside click) */
  onClose?: () => void;
  /** Dialog max width class */
  maxWidth?: string;
  /** Whether to render the standard modal footer */
  showFooter?: boolean;
  /** Controlled mode: external open state */
  open?: boolean;
  /** Controlled mode: external state setter */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Reusable modal component with consistent structure:
 * - Header with title/description
 * - Content area (customizable)
 * - Footer with buttons (cancel + submit for actions, or just close for view-only)
 *
 * Supports both controlled and uncontrolled modes:
 * - Uncontrolled: uses internal state (default)
 * - Controlled: pass open/onOpenChange props
 *
 * @example Action modal
 * <BaseModal
 *   title="Create Item"
 *   description="Add a new item to the list"
 *   content={<form>...</form>}
 *   onSubmit={handleSubmit}
 *   submitLabel="Create"
 *   isLoading={isCreating}
 * >
 *   {({ openModal }) => (
 *     <Button onClick={openModal}>Open</Button>
 *   )}
 * </BaseModal>
 *
 * @example View-only modal (no onSubmit)
 * <BaseModal
 *   title="View Details"
 *   content={<div>...</div>}
 * >
 *   {({ openModal }) => (
 *     <Button onClick={openModal}>View</Button>
 *   )}
 * </BaseModal>
 */
export function BaseModal({
  children,
  title,
  description,
  content,
  submitLabel = "Submit",
  submitLoadingLabel = "Submitting...",
  cancelLabel,
  submitDisabled = false,
  isLoading = false,
  onSubmit,
  onClose,
  maxWidth = "sm:max-w-md",
  showFooter = true,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: BaseModalProps) {
  // Use controlled mode if open prop is provided, otherwise use internal state
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  // For view-only modals (no onSubmit), default to "Close" instead of "Cancel"
  const isViewOnly = !onSubmit;
  const closeButtonLabel = cancelLabel ?? (isViewOnly ? "Close" : "Cancel");

  const openModal = () => setOpen(true);

  const closeModal = () => {
    setOpen(false);
    onClose?.();
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      onClose?.();
    }
  };

  const handleSubmit = async () => {
    if (!onSubmit) return;
    await onSubmit();
    // In uncontrolled mode, close after successful submit
    if (!isControlled) {
      closeModal();
    }
  };

  return (
    <>
      {children?.({ openModal })}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={`grid max-h-[calc(100dvh-2rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden ${maxWidth}`}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          <div className="min-h-0 min-w-0 max-w-full overflow-y-auto overscroll-contain">
            {content}
          </div>
          {showFooter ? (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeModal}
                disabled={isLoading}
              >
                {closeButtonLabel}
              </Button>
              {onSubmit ? (
                <Button
                  onClick={handleSubmit}
                  disabled={submitDisabled || isLoading}
                >
                  {isLoading ? submitLoadingLabel : submitLabel}
                </Button>
              ) : null}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
