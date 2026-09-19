import { useEffect, useState } from 'react';

interface Props {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  /** Tooltip (mouse hover only). */
  title?: string;
}

/** Two-tap button for actions that are hard to undo (tap, then tap again within 3 s). */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className, title }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  return (
    <button
      type="button"
      className={`${className ?? ''}${armed ? ' is-armed' : ''}`}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
