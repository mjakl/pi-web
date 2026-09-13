/** Shared action semantics for Settings and shell dialogs. */
export function ConfigButton({
  variant = "secondary",
  small,
  class: extraClass,
  children,
  ...rest
}: {
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}) {
  return (
    <button
      type="button"
      {...rest}
      class={`config-button config-button-${variant} config-button-${small === true ? "small" : "default"}${extraClass ? ` ${extraClass}` : ""}`}
    >
      {children}
    </button>
  );
}

/** A preference toggle retains button semantics, not a form checkbox. */
export function ConfigSwitch({
  checked,
  label,
  ...rest
}: {
  checked: boolean;
  label: string;
  [key: string]: unknown;
}) {
  return (
    <button
      type="button"
      {...rest}
      class="config-switch"
      role="switch"
      aria-checked={checked ? "true" : "false"}
      aria-label={label}
      title={label}
    >
      <span class="config-switch-knob" />
    </button>
  );
}

export function ConfigField({
  label,
  children,
}: {
  label: string;
  children: unknown;
}) {
  return (
    <div class="config-field">
      <span class="config-field-label">{label}</span>
      {children}
    </div>
  );
}
