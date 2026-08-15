import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compune clase si rezolva conflictele Tailwind: ultima castiga.
 *
 * Fara `twMerge`, un `className="px-4"` trimis din afara nu poate suprascrie un
 * `px-2` din componenta — ordinea din CSS decide, nu ordinea din sir. Cu el,
 * variantele componentelor raman suprascriabile, ceea ce e tot rostul lor.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
