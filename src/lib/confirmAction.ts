export type ConfirmFn = (message: string) => boolean;

export function confirmAction(message: string, action: () => void, confirmFn: ConfirmFn = window.confirm) {
  if (!confirmFn(message)) return false;
  action();
  return true;
}
