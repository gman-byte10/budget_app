// Subtle haptic feedback where supported (Android/Chrome). No-op elsewhere.
export function tap(): void {
  navigator.vibrate?.(8)
}

export function success(): void {
  navigator.vibrate?.([10, 40, 20])
}
