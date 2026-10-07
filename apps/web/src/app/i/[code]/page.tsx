import type { Metadata } from "next";
import { AdvertiseInvite } from "@/components/AdvertiseInvite";
import { AppShowcase } from "@/components/AppShowcase";
import { isInviteCode } from "@/lib/invite";
import { pageMetadata } from "@/lib/seo";
import { InviteHero } from "./InviteHero";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/*
 * An invite link: `/i/<code>`.
 *
 * Not indexed - there is one of these per person who ever asked for a link, and every one
 * says the same thing as the homepage. Followed, so the links on it still count.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return {
    ...pageMetadata({
      path: `/i/${encodeURIComponent(code.toLowerCase())}`,
      title: "You're invited to ADCode",
      socialTitle: "You're invited to ADCode - the free AI code editor that pays you to build",
      description:
        "Someone who codes in ADCode sent you this. Describe an idea and watch it get built, with free AI from the first minute, and half the ad revenue paid to you.",
    }),
    robots: { index: false, follow: true },
  };
}

export default async function InvitePage({ params, searchParams }: Props) {
  const raw = (await params).code.toLowerCase();
  // A malformed code still sells ADCode: it just carries no invite.
  const code = isInviteCode(raw) ? raw : null;
  // A link from the pitch for companies: the advertiser offer, credited to whoever sent it.
  if ((await searchParams)["for"] === "ads") {
    return (
      <div className="marketplace-home">
        <AdvertiseInvite code={code} />
      </div>
    );
  }
  return (
    <div className="marketplace-home">
      <InviteHero code={code}>
        <AppShowcase />
      </InviteHero>
    </div>
  );
}
