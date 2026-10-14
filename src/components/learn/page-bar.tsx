import Link from "next/link";
import { Icon } from "@/components/learn/icons";
import { t } from "@/i18n";

/** The bar of a reading page: back, and the page's name. */
export function PageBar({ title, back }: { title: string; back: string }) {
  return (
    <div className="sbar">
      <Link className="icon-btn" href={back} aria-label={t("learn.back")}>
        <Icon name="l-fwd" className="i fwd" />
      </Link>
      <h1 className="page-title">{title}</h1>
      <span className="icon-btn" aria-hidden="true" />
    </div>
  );
}
