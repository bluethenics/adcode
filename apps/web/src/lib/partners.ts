/**
 * The companies ADCode works with, shown under the hero recording.
 *
 * One row per partner. A partner's logo is their own file, never a drawing of one: until
 * the file is in `public/partners/`, the strip shows the name alone, which is honest and
 * still links them. To add a logo, put the file there (SVG or PNG, cropped tight to the mark)
 * and set `logo` below; add `logoDark` when the mark needs a light version for dark mode.
 */

export interface PartnerLogo {
  /** Under /partners/, so every logo the site shows is a file committed here. */
  readonly src: `/partners/${string}`;
  readonly width: number;
  readonly height: number;
}

export interface Partner {
  /** As the partner writes it. */
  readonly name: string;
  readonly href: `https://${string}`;
  readonly logo?: PartnerLogo;
  /** The same mark for dark backgrounds, when the default would disappear on one. */
  readonly logoDark?: PartnerLogo;
}

export const PARTNERS: readonly Partner[] = [
  {
    name: "Tagflow AI",
    href: "https://tagflow-ai.com",
  },
];
