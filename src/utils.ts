/**
 * Returns a styled (Y/n) or (y/N) string for inquirer confirm prompts,
 * highlighting the default answer in bold green and dimming the other.
 */
export function confirmDefaultAnswer(defaultYes: boolean): string {
  const yes = '\x1b[1;32mY\x1b[0m'
  const no = '\x1b[1;32mN\x1b[0m'
  const dimYes = '\x1b[2;37my\x1b[0m'
  const dimNo = '\x1b[2;37mn\x1b[0m'
  return defaultYes ? `(${yes}/${dimNo})` : `(${dimYes}/${no})`
}
